import { getAuth, getDb } from '../config/firebase.js';
import { AppError, formatErrorResponse } from '../utils/errors.js';

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const isDevOrTest = ['development', 'test'].includes(process.env.NODE_ENV || 'development');

    // Demo/test header support (backward compatibility for dev/test execution)
    if (isDevOrTest && req.headers['x-demo-uid']) {
      req.user = {
        uid: req.headers['x-demo-uid'],
        email: req.headers['x-demo-email'] || 'demo@healthcare.org',
        role: req.headers['x-demo-role'] || 'patient'
      };
      return next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(formatErrorResponse('UNAUTHORIZED', 'Unauthorized access. Authentication token missing or invalid.'));
    }

    const token = authHeader.split('Bearer ')[1];

    if (isDevOrTest && (token.startsWith('test-') || token.startsWith('mock-') || !token.includes('.'))) {
      req.user = {
        uid: token,
        email: req.headers['x-demo-email'] || `${token}@healthcare.org`,
        role: req.headers['x-demo-role'] || 'patient'
      };
      return next();
    }

    const auth = getAuth();

    if (!auth) {
      // Mock mode fallback when Firebase Admin is not connected in tests
      req.user = {
        uid: token,
        email: 'user@healthcare.org',
        role: req.headers['x-demo-role'] || 'patient'
      };
      return next();
    }

    const decodedToken = await auth.verifyIdToken(token);
    let role = decodedToken.role || 'patient';
    let doctorId = decodedToken.doctorId || null;
    const db = getDb();
    
    if (db) {
      try {
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          role = userData.role || role;
          doctorId = userData.doctorId || doctorId;
        }
      } catch (dbErr) {
        if (dbErr.code === 8 || dbErr.message?.includes('RESOURCE_EXHAUSTED') || dbErr.message?.includes('Quota exceeded')) {
          console.warn('⚠️ Firestore quota exceeded in authMiddleware, falling back to token claims/email');
          if (decodedToken.email?.includes('admin')) role = 'admin';
          else if (decodedToken.email?.includes('doctor')) role = 'doctor';
          else if (decodedToken.email?.includes('reception')) role = 'reception';
          else if (decodedToken.email?.includes('nurse')) role = 'nurse';
          else if (decodedToken.email?.includes('pharmacy')) role = 'pharmacy';
        } else {
          throw dbErr;
        }
      }
    }

    const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];
    if (!role || !ALLOWED_ROLES.includes(role)) {
      role = 'patient'; // Safe default
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role,
      doctorId
    };

    next();
  } catch (error) {
    return res.status(401).json(formatErrorResponse('UNAUTHORIZED', 'Invalid or expired authentication token.'));
  }
};

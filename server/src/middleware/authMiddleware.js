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
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        role = userData.role || role;
        doctorId = userData.doctorId || doctorId;
      }
    }

    const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return res.status(401).json(formatErrorResponse('UNAUTHORIZED_ROLE', 'Missing or unknown role in authentication token. Please log in again.'));
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

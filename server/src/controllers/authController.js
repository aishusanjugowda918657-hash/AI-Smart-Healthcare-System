import { assertDbConnected, auth } from '../config/firebase.js';
import { generateAtomicPatientHealthId } from '../services/healthIdGenerator.js';
import { formatSuccessResponse, formatErrorResponse, AppError } from '../utils/errors.js';

const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];

/**
 * Register a new user & create self patient profile with a Health ID
 * Defined as per PRD Section 6 F1
 */
export const registerUser = async (req, res, next) => {
  try {
    const { email, password, role: requestedRole, fullName, displayName, phone, dob, gender, bloodGroup } = req.body;
    const role = 'patient'; // Force role to patient
    const nameToUse = fullName || displayName || 'New User';

    if (!email || !password) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Email and password are required.'));
    }

    if (requestedRole && !ALLOWED_ROLES.includes(requestedRole)) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', `Invalid role '${requestedRole}'. Allowed roles: [${ALLOWED_ROLES.join(', ')}]`));
    }

    const db = assertDbConnected();
    let uid;

    if (auth) {
      try {
        const userRecord = await auth.createUser({
          email,
          password,
          displayName: nameToUse
        });
        uid = userRecord.uid;
        await auth.setCustomUserClaims(uid, { role: role || 'patient' });
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-exists') {
          return res.status(409).json(formatErrorResponse('POSSIBLE_DUPLICATE', 'Email address is already registered in Firebase Authentication.'));
        }
        throw authErr;
      }
    } else {
      uid = `usr-${Date.now().toString(36)}`;
    }

    const healthId = await generateAtomicPatientHealthId();

    const userDoc = {
      uid,
      role: role || 'patient',
      displayName: nameToUse,
      email,
      phone: phone || '',
      language: 'en',
      fcmTokens: [],
      prefs: {
        quietHours: { start: '22:00', end: '07:00' },
        privacyMode: false,
        mealTimes: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const patientDoc = {
      healthId,
      patientHealthId: healthId,
      ownerUid: uid,
      relation: 'self',
      isTemporary: false,
      name: nameToUse.trim(),
      searchName: nameToUse.trim().toLowerCase(),
      dob: dob || '1990-01-01',
      gender: gender || 'other',
      bloodGroup: bloodGroup || '',
      allergies: [],
      conditions: [],
      flags: { pregnant: false, disability: false },
      emergencyContact: null,
      accessList: {},
      emergencyQrEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const batch = db.batch();
    batch.set(db.collection('users').doc(uid), userDoc);
    batch.set(db.collection('patients').doc(healthId), patientDoc);
    await batch.commit();

    return res.status(201).json(formatSuccessResponse({
      uid,
      email,
      role: role || 'patient',
      healthId,
      name: nameToUse
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Get logged in user details and their self patient profile
 */
export const getMe = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const userDoc = await db.collection('users').doc(uid).get();
    let userData = userDoc.exists ? userDoc.data() : { email: req.user.email || 'demo@healthcare.org', role: req.user.role || 'patient' };

    const patientSnap = await db.collection('patients')
      .where('ownerUid', '==', uid)
      .where('relation', '==', 'self')
      .limit(1)
      .get();

    const selfPatient = !patientSnap.empty ? patientSnap.docs[0].data() : null;

    return res.status(200).json(formatSuccessResponse({
      uid,
      ...userData,
      patient: selfPatient
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Update user preferences
 */
export const updatePreferences = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { language, prefs } = req.body;
    const db = assertDbConnected();

    const updateData = { updatedAt: new Date() };
    if (language) updateData.language = language;
    if (prefs) {
      const userSnap = await db.collection('users').doc(uid).get();
      const currentPrefs = userSnap.exists ? (userSnap.data().prefs || {}) : {};
      updateData.prefs = { ...currentPrefs, ...prefs };
    }

    await db.collection('users').doc(uid).set(updateData, { merge: true });

    return res.status(200).json(formatSuccessResponse({
      message: 'Preferences updated successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Add FCM device token for push notifications
 */
export const addDeviceToken = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { token, device = 'web' } = req.body;

    if (!token) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'FCM device token is required.'));
    }

    const db = assertDbConnected();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const currentTokens = userSnap.exists ? (userSnap.data().fcmTokens || []) : [];

    const filteredTokens = currentTokens.filter((t) => t.token !== token);
    filteredTokens.push({ token, device, updatedAt: new Date().toISOString() });

    await userRef.set({ fcmTokens: filteredTokens, updatedAt: new Date() }, { merge: true });

    return res.status(200).json(formatSuccessResponse({
      message: 'Device token added successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Remove FCM device token
 */
export const removeDeviceToken = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'FCM device token is required.'));
    }

    const db = assertDbConnected();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const currentTokens = userSnap.exists ? (userSnap.data().fcmTokens || []) : [];

    const filteredTokens = currentTokens.filter((t) => t.token !== token);
    await userRef.set({ fcmTokens: filteredTokens, updatedAt: new Date() }, { merge: true });

    return res.status(200).json(formatSuccessResponse({
      message: 'Device token removed successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Change Doctor Password
 */
export const changeDoctorPassword = async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'New password must be at least 6 characters long.'));
    }

    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. Only doctor accounts can update password through this endpoint.'));
    }

    const db = assertDbConnected();

    if (auth) {
      try {
        await auth.updateUser(uid, { password: newPassword });
      } catch (authErr) {
        console.warn('⚠️ Firebase Admin password update notice:', authErr.message);
      }
    }

    const updateData = {
      mustChangePassword: false,
      updatedAt: new Date()
    };

    await db.collection('users').doc(uid).set(updateData, { merge: true });

    const doctorDoc = await db.collection('doctors').doc(uid).get();
    if (doctorDoc.exists) {
      await db.collection('doctors').doc(uid).set(updateData, { merge: true });
    }

    return res.status(200).json(formatSuccessResponse({
      uid,
      mustChangePassword: false
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Login sync endpoint
 */
export const loginSync = async (req, res, next) => {
  try {
    const { uid, email, role } = req.user;
    const db = assertDbConnected();

    let userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      const newDoc = {
        uid,
        email: email || '',
        role: role || 'patient',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await db.collection('users').doc(uid).set(newDoc);
      userDoc = await db.collection('users').doc(uid).get();
    }

    const userData = userDoc.data();

    return res.status(200).json(formatSuccessResponse({
      uid: userData.uid,
      email: userData.email,
      role: userData.role,
      displayName: userData.displayName || '',
      mustChangePassword: userData.mustChangePassword || false
    }));
  } catch (error) {
    next(error);
  }
};

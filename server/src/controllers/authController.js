import { assertDbConnected, auth } from '../config/firebase.js';
import { generateAtomicPatientHealthId } from '../services/healthIdGenerator.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { assignDoctorDisplayId } from '../services/doctorDisplayIdService.js';

const ALLOWED_ROLES = ['patient', 'doctor', 'nurse', 'reception', 'pharmacy', 'admin'];

/**
 * Register a new patient account & create self patient profile with a Health ID
 * Implements PRD Section 6 F1 & Safe Registration Protocol
 */
export const registerUser = async (req, res, next) => {
  try {
    let { email, password, fullName, displayName, phone, dob, gender, bloodGroup } = req.body;
    const role = 'patient'; // Public registration ALWAYS creates role 'patient'. Ignore body role.

    if (!email || !password) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Email and password are required.'));
    }

    email = String(email).trim().toLowerCase();
    const nameToUse = (fullName || displayName || 'New User').trim();

    const db = assertDbConnected();
    let uid;
    let authUserCreated = false;

    if (auth) {
      try {
        const userRecord = await auth.createUser({
          email,
          password,
          displayName: nameToUse
        });
        uid = userRecord.uid;
        authUserCreated = true;
        await auth.setCustomUserClaims(uid, { role: 'patient' });
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-exists') {
          // Idempotent Check: Check whether users doc and self-patient profile exist for that email
          try {
            const existingRecord = await auth.getUserByEmail(email);
            const existingUid = existingRecord.uid;

            const userDocSnap = await db.collection('users').doc(existingUid).get();
            const patientSnap = await db.collection('patients')
              .where('ownerUid', '==', existingUid)
              .where('relation', '==', 'self')
              .limit(1)
              .get();

            const isUserComplete = userDocSnap.exists;
            const isPatientComplete = !patientSnap.empty;

            if (!isUserComplete || !isPatientComplete) {
              return res.status(409).json(
                formatErrorResponse('ACCOUNT_INCOMPLETE', 'This account was not finished. Please sign in to complete it.')
              );
            }

            return res.status(409).json(
              formatErrorResponse('EMAIL_IN_USE', 'This email already has an account. Sign in, or reset your password.')
            );
          } catch (e) {
            return res.status(409).json(
              formatErrorResponse('EMAIL_IN_USE', 'This email already has an account. Sign in, or reset your password.')
            );
          }
        }

        if (authErr.code === 'auth/weak-password') {
          return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Password must be at least 6 characters long.'));
        }
        if (authErr.code === 'auth/invalid-email') {
          return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Please enter a valid email address.'));
        }
        if (authErr.code === 'app/network-error' || (authErr.message && authErr.message.includes('ECONNREFUSED'))) {
          uid = `usr-${Date.now().toString(36)}`;
        } else {
          throw authErr;
        }
      }
    } else {
      uid = `usr-${Date.now().toString(36)}`;
    }

    // Wrap Firestore writes in try/catch to roll back Auth user if Firestore setup fails
    try {
      const healthId = await generateAtomicPatientHealthId();

      const userDoc = {
        uid,
        role: 'patient',
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
        email,
        relation: 'self',
        isTemporary: false,
        name: nameToUse,
        searchName: nameToUse.toLowerCase(),
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

      await db.runTransaction(async (transaction) => {
        transaction.set(db.collection('users').doc(uid), userDoc);
        transaction.set(db.collection('patients').doc(healthId), patientDoc);
      });

      return res.status(201).json(formatSuccessResponse({
        uid,
        email,
        role: 'patient',
        healthId,
        name: nameToUse
      }));
    } catch (fsErr) {
      // Rollback newly created Auth user if database setup failed
      if (auth && authUserCreated && uid) {
        try {
          await auth.deleteUser(uid);
          console.warn(`🧹 Rolled back Auth user ${uid} due to Firestore setup failure.`);
        } catch (delErr) {
          console.error(`Failed to rollback Auth user ${uid}:`, delErr.message);
        }
      }
      return res.status(503).json(
        formatErrorResponse('SERVICE_UNAVAILABLE', 'Registration database setup failed. Please try again.')
      );
    }
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
    let userData = userDoc.exists
      ? userDoc.data()
      : { email: req.user.email || 'demo@healthcare.org', role: req.user.role || 'patient' };

    const patientSnap = await db.collection('patients')
      .where('ownerUid', '==', uid)
      .where('relation', '==', 'self')
      .limit(1)
      .get();

    let selfPatient = null;
    if (!patientSnap.empty) {
      selfPatient = { id: patientSnap.docs[0].id, ...patientSnap.docs[0].data() };
    } else {
      const directPatientDoc = await db.collection('patients').doc(uid).get();
      if (directPatientDoc.exists) {
        selfPatient = { id: directPatientDoc.id, ...directPatientDoc.data() };
      }
    }

    let doctorDisplayId = userData.displayId || userData.doctorDisplayId || null;
    let resolvedDoctorId = userData.doctorId || null;
    if (userData.role === 'doctor' || userData.doctorId) {
      const docLookupId = userData.doctorId || uid;
      let dSnap = await db.collection('doctors').doc(docLookupId).get();
      if (!dSnap.exists) {
        const qSnap = await db.collection('doctors').where('doctorId', '==', docLookupId).limit(1).get();
        if (!qSnap.empty) dSnap = qSnap.docs[0];
      }
      if (dSnap && dSnap.exists) {
        const dData = dSnap.data();
        resolvedDoctorId = dData.doctorId || resolvedDoctorId;
        doctorDisplayId = dData.displayId || dData.doctorDisplayId || assignDoctorDisplayId(dData);
      }
    }

    return res.status(200).json(formatSuccessResponse({
      uid,
      ...userData,
      doctorId: resolvedDoctorId,
      displayId: doctorDisplayId,
      doctorDisplayId: doctorDisplayId,
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
 * Login sync endpoint with profile repair & role safety
 */
export const loginSync = async (req, res, next) => {
  try {
    const { uid, email, role: claimedRole } = req.user;
    const db = assertDbConnected();

    let userDocSnap;
    try {
      userDocSnap = await db.collection('users').doc(uid).get();
    } catch (readErr) {
      if (readErr.code === 8 || readErr.message?.includes('RESOURCE_EXHAUSTED') || readErr.message?.includes('Quota exceeded')) {
        console.warn('⚠️ Firestore quota exceeded while reading users doc in loginSync, falling back to authenticated token claims');
        const fallbackRole = req.user.role || 'patient';
        const fallbackName = (req.user.name || email?.split('@')[0] || 'User').trim();
        return res.status(200).json(formatSuccessResponse({
          uid,
          email: email || '',
          role: fallbackRole,
          displayName: fallbackName,
          doctorId: req.user?.doctorId || null,
          displayId: null,
          doctorDisplayId: null,
          mustChangePassword: false,
          quotaExceededFallback: true
        }));
      }
      throw readErr;
    }

    if (!userDocSnap.exists) {
      const PRIVILEGED_ROLES = ['doctor', 'nurse', 'reception', 'pharmacy', 'admin'];
      if (claimedRole && PRIVILEGED_ROLES.includes(claimedRole)) {
        return res.status(403).json(
          formatErrorResponse('PROFILE_MISSING', 'Profile missing, contact the administrator.')
        );
      }

      // Unprivileged / patient user: auto-create users doc with role 'patient'
      const nameToUse = (req.user.name || email?.split('@')[0] || 'Patient').trim();
      const newDoc = {
        uid,
        email: email || '',
        displayName: nameToUse,
        role: 'patient',
        phone: '',
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
      try {
        await db.collection('users').doc(uid).set(newDoc);
        userDocSnap = await db.collection('users').doc(uid).get();
      } catch (writeErr) {
        if (writeErr.code === 8 || writeErr.message?.includes('RESOURCE_EXHAUSTED') || writeErr.message?.includes('Quota exceeded')) {
          console.warn('⚠️ Firestore quota exceeded while auto-creating user doc in loginSync, proceeding with memory profile');
          return res.status(200).json(formatSuccessResponse({
            uid,
            email: email || '',
            role: 'patient',
            displayName: nameToUse,
            doctorId: null,
            displayId: null,
            doctorDisplayId: null,
            mustChangePassword: false,
            quotaExceededFallback: true
          }));
        }
        throw writeErr;
      }
    }

    const userData = userDocSnap.data();

    if (!ALLOWED_ROLES.includes(userData.role)) {
      return res.status(403).json(
        formatErrorResponse('UNAUTHORIZED_ROLE', 'Unknown or unauthorized user role. Please contact support.')
      );
    }

    // Check & repair missing self patient profile for patient accounts
    if (userData.role === 'patient') {
      try {
        const patientSnap = await db.collection('patients')
          .where('ownerUid', '==', uid)
          .where('relation', '==', 'self')
          .limit(1)
          .get();

        if (patientSnap.empty) {
          const directDoc = await db.collection('patients').doc(uid).get();
          if (directDoc.exists) {
            const directData = directDoc.data();
            await directDoc.ref.set({
              ownerUid: uid,
              relation: 'self',
              name: directData.name || directData.fullName || userData.displayName || 'Patient',
              healthId: directData.healthId || directData.patientHealthId
            }, { merge: true });
          } else {
            const healthId = await generateAtomicPatientHealthId();
            const nameToUse = userData.displayName || 'Patient';
            const patientDoc = {
              healthId,
              patientHealthId: healthId,
              ownerUid: uid,
              relation: 'self',
              isTemporary: false,
              name: nameToUse,
              searchName: nameToUse.toLowerCase(),
              dob: '1990-01-01',
              gender: 'other',
              bloodGroup: '',
              allergies: [],
              conditions: [],
              flags: { pregnant: false, disability: false },
              emergencyContact: null,
              accessList: {},
              emergencyQrEnabled: false,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            await db.collection('patients').doc(healthId).set(patientDoc);
          }
        }
      } catch (patErr) {
        if (patErr.code === 8 || patErr.message?.includes('RESOURCE_EXHAUSTED') || patErr.message?.includes('Quota exceeded')) {
          console.warn('⚠️ Firestore quota exceeded while syncing patient profile in loginSync');
        } else {
          throw patErr;
        }
      }
    }

    let doctorDisplayId = userData.displayId || userData.doctorDisplayId || null;
    if (userData.role === 'doctor' || userData.doctorId) {
      try {
        const docLookupId = userData.doctorId || uid;
        let dSnap = await db.collection('doctors').doc(docLookupId).get();
        if (!dSnap.exists) {
          const qSnap = await db.collection('doctors').where('doctorId', '==', docLookupId).limit(1).get();
          if (!qSnap.empty) dSnap = qSnap.docs[0];
        }
        if (dSnap && dSnap.exists) {
          const dData = dSnap.data();
          doctorDisplayId = dData.displayId || dData.doctorDisplayId || assignDoctorDisplayId(dData);
        }
      } catch (docErr) {
        if (docErr.code === 8 || docErr.message?.includes('RESOURCE_EXHAUSTED') || docErr.message?.includes('Quota exceeded')) {
          console.warn('⚠️ Firestore quota exceeded while looking up doctor in loginSync');
        } else {
          throw docErr;
        }
      }
    }

    return res.status(200).json(formatSuccessResponse({
      uid: userData.uid,
      email: userData.email,
      role: userData.role,
      displayName: userData.displayName || '',
      doctorId: userData.doctorId || req.user?.doctorId || null,
      displayId: doctorDisplayId,
      doctorDisplayId: doctorDisplayId,
      mustChangePassword: userData.mustChangePassword || false
    }));
  } catch (error) {
    if (error.code === 8 || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Quota exceeded')) {
      console.warn('⚠️ Firestore quota exceeded in loginSync catch handler, falling back to safe user profile');
      const { uid, email } = req.user || {};
      const fallbackRole = req.user?.role || 'patient';
      const fallbackName = (req.user?.name || email?.split('@')[0] || 'User').trim();
      return res.status(200).json(formatSuccessResponse({
        uid: uid || 'user',
        email: email || '',
        role: fallbackRole,
        displayName: fallbackName,
        doctorId: req.user?.doctorId || null,
        displayId: null,
        doctorDisplayId: null,
        mustChangePassword: false,
        quotaExceededFallback: true
      }));
    }
    next(error);
  }
};

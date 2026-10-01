import { assertDbConnected, auth } from '../config/firebase.js';

/**
 * Register a new user & create document in 'users' collection
 */
export const registerUser = async (req, res, next) => {
  try {
    const { email, password, role = 'patient', fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Email and password are required.'
      });
    }

    const validRoles = ['patient', 'doctor', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: Invalid role '${role}'. Allowed roles: [${validRoles.join(', ')}]`
      });
    }

    const db = assertDbConnected();
    let uid;

    // Firebase Auth user creation if connected
    if (auth) {
      try {
        const userRecord = await auth.createUser({
          email,
          password,
          displayName: fullName
        });
        uid = userRecord.uid;
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-exists') {
          return res.status(409).json({
            success: false,
            message: 'Email address is already registered in Firebase Authentication.'
          });
        }
        throw authErr;
      }
    } else {
      uid = `usr-${Date.now().toString(36)}`;
    }

    const userDoc = {
      uid,
      email,
      role,
      fullName: fullName || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').doc(uid).set(userDoc);

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: {
        uid,
        email,
        role
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login sync endpoint to verify token & return user role claims
 */
export const loginSync = async (req, res, next) => {
  try {
    const { uid, email, role } = req.user;
    const db = assertDbConnected();

    let userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      // Initialize missing user document
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

    // Check if doctor has mustChangePassword flag and verify status
    let mustChangePassword = false;
    let doctorStatus = 'ACTIVE';
    let doctorProfileData = {};
    if (userData.role === 'doctor') {
      const docRef = await db.collection('doctors').doc(uid).get();
      if (docRef.exists) {
        const docData = docRef.data();
        mustChangePassword = !!docData.mustChangePassword;
        doctorStatus = docData.status || 'ACTIVE';
        doctorProfileData = {
          doctorId: docData.doctorId || '',
          departmentId: docData.departmentId || '',
          specialization: docData.specialization || '',
          qualification: docData.qualification || '',
          experience: docData.experience || '',
          phone: docData.phone || '',
          name: docData.name || docData.fullName || ''
        };
      } else {
        mustChangePassword = !!userData.mustChangePassword;
        doctorStatus = userData.status || 'ACTIVE';
      }

      if (doctorStatus !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          message: `Doctor account status is '${doctorStatus}'. Access permitted for ACTIVE doctors only. Please contact hospital administrator.`
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'User authentication synchronized successfully.',
      data: {
        uid: userData.uid,
        email: userData.email,
        role: userData.role,
        fullName: userData.fullName || doctorProfileData.name || '',
        mustChangePassword,
        status: doctorStatus,
        ...doctorProfileData
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get logged in user profile & permissions
 */
export const getMe = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User record not found.'
      });
    }

    const userData = userDoc.data();

    // Check if doctor has mustChangePassword flag & status
    let mustChangePassword = false;
    let doctorStatus = 'ACTIVE';
    let doctorProfileData = {};
    if (userData.role === 'doctor') {
      const docRef = await db.collection('doctors').doc(uid).get();
      if (docRef.exists) {
        const docData = docRef.data();
        mustChangePassword = !!docData.mustChangePassword;
        doctorStatus = docData.status || 'ACTIVE';
        doctorProfileData = {
          doctorId: docData.doctorId || '',
          departmentId: docData.departmentId || '',
          specialization: docData.specialization || '',
          qualification: docData.qualification || '',
          experience: docData.experience || '',
          phone: docData.phone || '',
          name: docData.name || docData.fullName || ''
        };
      } else {
        mustChangePassword = !!userData.mustChangePassword;
        doctorStatus = userData.status || 'ACTIVE';
      }

      if (doctorStatus !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          message: `Doctor account status is '${doctorStatus}'. Access permitted for ACTIVE doctors only.`
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...userData,
        ...doctorProfileData,
        mustChangePassword,
        status: doctorStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change Doctor Password (Mandatory on first login if mustChangePassword is true)
 */
export const changeDoctorPassword = async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: New password must be at least 6 characters long.'
      });
    }

    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Only doctor accounts can update password through this endpoint.'
      });
    }

    const db = assertDbConnected();

    // 1. Update Firebase Auth password if connected
    if (auth) {
      try {
        await auth.updateUser(uid, {
          password: newPassword
        });
      } catch (authErr) {
        console.warn('⚠️ Firebase Admin password update notice:', authErr.message);
      }
    }

    // 2. Update Firestore records
    const updateData = {
      mustChangePassword: false,
      updatedAt: new Date()
    };

    await db.collection('users').doc(uid).set(updateData, { merge: true });

    const doctorDoc = await db.collection('doctors').doc(uid).get();
    if (doctorDoc.exists) {
      await db.collection('doctors').doc(uid).set(updateData, { merge: true });
    }

    res.status(200).json({
      success: true,
      message: 'Password updated successfully. Access to Doctor Workspace granted.',
      data: {
        uid,
        mustChangePassword: false
      }
    });
  } catch (error) {
    next(error);
  }
};


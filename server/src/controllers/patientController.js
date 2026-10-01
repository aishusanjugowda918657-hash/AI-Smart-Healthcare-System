import { assertDbConnected } from '../config/firebase.js';
import { generateAtomicPatientHealthId } from '../services/healthIdGenerator.js';

export const calculateAge = (dobString) => {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : 0;
};

/**
 * Create or update patient profile & generate Unique Patient Health ID
 */
export const createOrUpdatePatientProfile = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const {
      fullName,
      phone,
      dob,
      gender = 'male',
      address = '',
      bloodGroup = '',
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelationship,
      allergies = [],
      existingConditions = []
    } = req.body;

    if (!fullName || !phone || !dob || !address || !gender) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Full Name, Mobile Number, Date of Birth, Gender, and Address are required.'
      });
    }

    const db = assertDbConnected();
    const patientRef = db.collection('patients').doc(uid);
    const patientDoc = await patientRef.get();

    let patientHealthId;
    let createdAt = new Date();

    if (patientDoc.exists) {
      patientHealthId = patientDoc.data().patientHealthId;
      createdAt = patientDoc.data().createdAt || new Date();
    } else {
      patientHealthId = await generateAtomicPatientHealthId();
    }

    const emergencyContact = {
      name: emergencyContactName || '',
      phone: emergencyContactPhone || '',
      relationship: emergencyContactRelationship || 'Relative'
    };

    const parsedAllergies = Array.isArray(allergies)
      ? allergies
      : typeof allergies === 'string'
      ? allergies.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const parsedConditions = Array.isArray(existingConditions)
      ? existingConditions
      : typeof existingConditions === 'string'
      ? existingConditions.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // Store Date of Birth as the source of truth (no independently editable age field saved)
    const profileData = {
      patientUid: uid,
      patientHealthId,
      fullName,
      nameLower: fullName.trim().toLowerCase(),   // ← Patient Lookup Agent index field
      phone,
      dob,
      gender,
      address,
      bloodGroup,
      emergencyContact,
      allergies: parsedAllergies,
      existingConditions: parsedConditions,
      profileCompleted: true,
      consentStatus: true,
      createdAt,
      updatedAt: new Date()
    };

    await patientRef.set(profileData, { merge: true });

    // Also update users collection for role consistency
    await db.collection('users').doc(uid).set({
      fullName,
      patientHealthId,
      updatedAt: new Date()
    }, { merge: true });

    // Dynamically calculate current age attribute from DOB
    const computedYears = calculateAge(dob);
    const ageAttr = computedYears !== null ? `${computedYears} years` : '';

    res.status(200).json({
      success: true,
      message: 'Patient profile created/updated successfully.',
      data: {
        ...profileData,
        age: ageAttr
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current patient profile
 */
export const getMyPatientProfile = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const patientDoc = await db.collection('patients').doc(uid).get();
    if (!patientDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Patient profile not found. Please complete profile registration.'
      });
    }

    const data = patientDoc.data();
    const computedYears = calculateAge(data.dob);
    data.age = computedYears !== null ? `${computedYears} years` : '';

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient profile by Health ID (Doctor/Admin access)
 */
export const getPatientByHealthId = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const db = assertDbConnected();

    const snapshot = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({
        success: false,
        message: `Patient with Health ID '${healthId}' not found.`
      });
    }

    const patientData = snapshot.docs[0].data();
    const computedYears = calculateAge(patientData.dob);
    patientData.age = computedYears !== null ? `${computedYears} years` : '';

    res.status(200).json({
      success: true,
      data: patientData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a Family Member / Dependent for the authenticated patient
 */
export const addFamilyMember = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const {
      fullName,
      dob,
      gender,
      relationship,
      customRelationship = '',
      relationshipOther = ''
    } = req.body;

    const allowedRelationships = [
      'Father', 'Mother', 'Husband', 'Wife',
      'Son', 'Daughter', 'Brother', 'Sister',
      'Grandfather', 'Grandmother', 'Other'
    ];

    if (!fullName || !fullName.trim() || !dob || !gender || !relationship) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Full Name, Date of Birth, Gender, and Relationship are required.'
      });
    }

    if (!allowedRelationships.includes(relationship)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: Invalid relationship '${relationship}'.`
      });
    }

    const customText = (customRelationship || relationshipOther || '').trim();

    if (relationship === 'Other' && !customText) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Please specify the relationship when selecting "Other".'
      });
    }

    const finalRelationship = relationship === 'Other' ? customText : relationship;

    const db = assertDbConnected();

    // Generate atomic unique Patient Health ID for dependent
    const patientHealthId = await generateAtomicPatientHealthId();

    const dependentRef = db.collection('patients').doc();
    const dependentId = dependentRef.id;

    const dependentData = {
      patientUid: dependentId,
      patientHealthId,
      fullName: fullName.trim(),
      nameLower: fullName.trim().toLowerCase(),   // ← Patient Lookup Agent index field
      dob,
      gender,
      relationship: finalRelationship,
      relationshipOther: relationship === 'Other' ? customText : null,
      primaryAccountUid: uid,
      isDependent: true,
      profileCompleted: true,
      consentStatus: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const computedYears = calculateAge(dob);
    dependentData.age = computedYears !== null ? `${computedYears} years` : '';

    await dependentRef.set(dependentData);

    // Audit log
    await db.collection('auditLogs').add({
      userId: uid,
      userRole: req.user.role || 'patient',
      action: 'ADD_FAMILY_MEMBER',
      resourceType: 'patient',
      resourceId: dependentId,
      patientHealthId,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: `Family member ${fullName} added successfully with Health ID ${patientHealthId}.`,
      data: dependentData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all family members / dependents for the authenticated patient
 */
export const getFamilyMembers = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('patients')
      .where('primaryAccountUid', '==', uid)
      .where('isDependent', '==', true)
      .get();

    const familyMembers = snapshot.docs.map((d) => {
      const data = d.data();
      const computedYears = calculateAge(data.dob);
      return {
        ...data,
        age: computedYears !== null ? `${computedYears} years` : ''
      };
    });

    res.status(200).json({
      success: true,
      data: familyMembers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a family member / dependent
 */
export const deleteFamilyMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const db = assertDbConnected();

    const dependentRef = db.collection('patients').doc(id);
    const dependentDoc = await dependentRef.get();

    if (!dependentDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Family member record not found.'
      });
    }

    const data = dependentDoc.data();
    if (data.primaryAccountUid !== uid) {
      return res.status(403).json({
        success: false,
        message: 'Security Error: You are only authorized to delete your own family members.'
      });
    }

    await dependentRef.delete();

    res.status(200).json({
      success: true,
      message: 'Family member removed successfully.'
    });
  } catch (error) {
    next(error);
  }
};



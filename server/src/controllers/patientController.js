import { assertDbConnected, getDb } from '../config/firebase.js';
import { generateAtomicPatientHealthId } from '../services/healthIdGenerator.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { writeAuditLog } from '../utils/audit.js';

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
 * Create or update patient profile (backward compatibility)
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
      existingConditions = [],
      emergencyQrEnabled
    } = req.body;

    if (!fullName || !phone || !dob || !address || !gender) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Validation Error: Full Name, Mobile Number, Date of Birth, Gender, and Address are required.'));
    }

    const db = assertDbConnected();

    let patientRef = null;
    let patientHealthId = null;
    let createdAt = new Date();
    let existingData = {};

    const selfSnap = await db.collection('patients')
      .where('ownerUid', '==', uid)
      .where('relation', '==', 'self')
      .limit(1)
      .get();

    if (!selfSnap.empty) {
      const docSnap = selfSnap.docs[0];
      patientRef = docSnap.ref;
      existingData = docSnap.data();
      patientHealthId = existingData.patientHealthId || existingData.healthId;
      createdAt = existingData.createdAt || new Date();
    } else {
      const legacyDoc = await db.collection('patients').doc(uid).get();
      if (legacyDoc.exists) {
        patientRef = legacyDoc.ref;
        existingData = legacyDoc.data();
        patientHealthId = existingData.patientHealthId || existingData.healthId;
        createdAt = existingData.createdAt || new Date();
      } else {
        patientHealthId = await generateAtomicPatientHealthId();
        patientRef = db.collection('patients').doc(patientHealthId);
      }
    }

    const emergencyContact = {
      name: emergencyContactName !== undefined ? emergencyContactName : (existingData.emergencyContact?.name || ''),
      phone: emergencyContactPhone !== undefined ? emergencyContactPhone : (existingData.emergencyContact?.phone || ''),
      relationship: emergencyContactRelationship !== undefined ? emergencyContactRelationship : (existingData.emergencyContact?.relationship || 'Relative')
    };

    const parsedAllergies = Array.isArray(allergies)
      ? allergies
      : typeof allergies === 'string'
      ? allergies.split(',').map((s) => s.trim()).filter(Boolean)
      : (existingData.allergies || []);

    const parsedConditions = Array.isArray(existingConditions)
      ? existingConditions
      : typeof existingConditions === 'string'
      ? existingConditions.split(',').map((s) => s.trim()).filter(Boolean)
      : (existingData.conditions || []);

    const profileData = {
      patientUid: uid,
      patientHealthId,
      healthId: patientHealthId,
      ownerUid: uid,
      primaryAccountUid: uid,
      relation: 'self',
      isTemporary: false,
      fullName,
      name: fullName,
      nameLower: fullName.trim().toLowerCase(),
      searchName: fullName.trim().toLowerCase(),
      phone,
      dob,
      gender,
      address,
      bloodGroup,
      emergencyContact,
      allergies: parsedAllergies,
      existingConditions: parsedConditions,
      conditions: parsedConditions,
      flags: { pregnant: false, disability: false, ...(existingData.flags || {}) },
      accessList: existingData.accessList || {},
      emergencyQrEnabled: emergencyQrEnabled !== undefined ? !!emergencyQrEnabled : (existingData.emergencyQrEnabled || false),
      qrVersion: existingData.qrVersion || 1,
      profileCompleted: true,
      consentStatus: true,
      createdAt,
      updatedAt: new Date()
    };

    await patientRef.set(profileData, { merge: true });

    await db.collection('users').doc(uid).set({
      fullName,
      displayName: fullName,
      patientHealthId,
      updatedAt: new Date()
    }, { merge: true });

    const computedYears = calculateAge(dob);
    const ageAttr = computedYears !== null ? `${computedYears} years` : '';

    return res.status(200).json(formatSuccessResponse({
      ...profileData,
      age: ageAttr
    }));
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

    const snap = await db.collection('patients')
      .where('ownerUid', '==', uid)
      .where('relation', '==', 'self')
      .limit(1)
      .get();

    let data = null;

    if (!snap.empty) {
      data = snap.docs[0].data();
    } else {
      const directDoc = await db.collection('patients').doc(uid).get();
      if (directDoc.exists) {
        data = directDoc.data();
      }
    }

    if (!data) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient profile not found. Please complete profile registration.'));
    }

    const computedYears = calculateAge(data.dob);
    data.age = computedYears !== null ? `${computedYears} years` : '';

    return res.status(200).json(formatSuccessResponse(data));
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

    let snapshot = await db.collection('patients').doc(healthId).get();
    if (!snapshot.exists) {
      const qSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
      if (!qSnap.empty) {
        snapshot = qSnap.docs[0];
      }
    }

    if (!snapshot || !snapshot.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', `Patient with Health ID '${healthId}' not found.`));
    }

    const patientData = snapshot.data();
    const computedYears = calculateAge(patientData.dob);
    patientData.age = computedYears !== null ? `${computedYears} years` : '';

    return res.status(200).json(formatSuccessResponse(patientData));
  } catch (error) {
    next(error);
  }
};

/**
 * Get family profiles owned by account or permitted via accessList
 */
export const getFamilyMembers = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const [ownerSnap, primarySnap] = await Promise.all([
      db.collection('patients').where('ownerUid', '==', uid).get(),
      db.collection('patients').where('primaryAccountUid', '==', uid).get()
    ]);

    const docsMap = new Map();
    [...ownerSnap.docs, ...primarySnap.docs].forEach((doc) => {
      docsMap.set(doc.id, doc.data());
    });

    const familyMembers = Array.from(docsMap.values())
      .filter((data) => data.relation !== 'self')
      .map((data) => {
        const computedYears = calculateAge(data.dob);
        return {
          ...data,
          age: computedYears !== null ? `${computedYears} years` : ''
        };
      });

    return res.status(200).json(formatSuccessResponse(familyMembers));
  } catch (error) {
    next(error);
  }
};

const ALLOWED_RELATIONSHIPS = [
  'Father', 'Mother', 'Husband', 'Wife',
  'Son', 'Daughter', 'Brother', 'Sister',
  'Grandfather', 'Grandmother', 'Other',
  'self', 'child', 'spouse', 'other'
];

/**
 * Add a Family Member / Dependent with Duplicate Check
 */
export const addFamilyMember = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const {
      name,
      fullName,
      dob,
      gender,
      relation = 'child',
      relationship,
      customRelationship = '',
      relationshipOther = '',
      bloodGroup = '',
      allergies = [],
      conditions = [],
      flags = { pregnant: false, disability: false },
      confirmDuplicate = false
    } = req.body;

    const nameToUse = name || fullName;
    const relationRaw = relationship || relation || 'child';

    if (!nameToUse || !nameToUse.trim() || !dob || !gender || !relationRaw) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Validation Error: Full Name, Date of Birth, Gender, and Relationship are required.'));
    }

    if (!ALLOWED_RELATIONSHIPS.includes(relationRaw)) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', `Validation Error: Invalid relationship '${relationRaw}'.`));
    }

    const customText = (customRelationship || relationshipOther || '').trim();

    if (relationRaw === 'Other' && !customText) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Validation Error: Please specify the relationship when selecting "Other".'));
    }

    const finalRelationship = relationRaw === 'Other' ? customText : relationRaw;
    const searchName = nameToUse.trim().toLowerCase();
    const db = assertDbConnected();

    if (!confirmDuplicate) {
      const dupQuery = await db.collection('patients')
        .where('ownerUid', '==', uid)
        .where('searchName', '==', searchName)
        .where('dob', '==', dob)
        .get();

      if (!dupQuery.empty) {
        const matches = dupQuery.docs.map((d) => d.data());
        return res.status(409).json(formatErrorResponse('POSSIBLE_DUPLICATE', 'A family member with similar name and date of birth already exists.', { matches }));
      }
    }

    const healthId = await generateAtomicPatientHealthId();

    const patientDoc = {
      patientUid: healthId,
      patientHealthId: healthId,
      healthId,
      ownerUid: uid,
      primaryAccountUid: uid,
      relation: finalRelationship,
      relationship: finalRelationship,
      relationshipOther: relationRaw === 'Other' ? customText : null,
      isDependent: true,
      isTemporary: false,
      fullName: nameToUse.trim(),
      name: nameToUse.trim(),
      nameLower: searchName,
      searchName,
      dob,
      gender,
      bloodGroup,
      allergies: Array.isArray(allergies) ? allergies : [],
      conditions: Array.isArray(conditions) ? conditions : [],
      flags: {
        pregnant: !!flags.pregnant,
        disability: !!flags.disability
      },
      accessList: {},
      emergencyQrEnabled: false,
      qrVersion: 1,
      profileCompleted: true,
      consentStatus: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('patients').doc(healthId).set(patientDoc);

    await writeAuditLog({
      actorUid: uid,
      actorRole: req.user.role || 'patient',
      action: 'ADD_FAMILY_MEMBER',
      targetType: 'patient',
      targetId: healthId,
      healthId,
      requestId: req.requestId
    });

    const computedYears = calculateAge(dob);
    patientDoc.age = computedYears !== null ? `${computedYears} years` : '';

    return res.status(201).json(formatSuccessResponse(patientDoc));
  } catch (error) {
    next(error);
  }
};

/**
 * Update family member profile
 */
export const updateFamilyMember = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    if (doc.data().ownerUid !== uid && doc.data().primaryAccountUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Only the profile owner can update family member details.'));
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };
    if (req.body.name) {
      updateData.searchName = req.body.name.trim().toLowerCase();
    }

    await docRef.set(updateData, { merge: true });

    return res.status(200).json(formatSuccessResponse({ message: 'Family member profile updated successfully.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Delete family member profile
 */
export const deleteFamilyMember = async (req, res, next) => {
  try {
    const id = req.params.healthId || req.params.id;
    const { uid } = req.user;
    const db = assertDbConnected();

    const dependentRef = db.collection('patients').doc(id);
    const dependentDoc = await dependentRef.get();

    if (!dependentDoc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Family member record not found.'));
    }

    const data = dependentDoc.data();
    if (data.ownerUid !== uid && data.primaryAccountUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Security Error: You are only authorized to delete your own family members.'));
    }

    await dependentRef.delete();

    return res.status(200).json(formatSuccessResponse({ message: 'Family member removed successfully.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Create temporary patient profile ("Someone else")
 */
export const createTemporaryPatient = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { name, dob, age, gender, phone } = req.body;

    if (!name) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Patient name is required for temporary profile.'));
    }

    const healthId = await generateAtomicPatientHealthId();
    const db = assertDbConnected();

    const tempDoc = {
      healthId,
      patientHealthId: healthId,
      ownerUid: uid,
      relation: 'other',
      isTemporary: true,
      name: name.trim(),
      fullName: name.trim(),
      searchName: name.trim().toLowerCase(),
      dob: dob || '1995-01-01',
      gender: gender || 'other',
      phone: phone || '',
      allergies: [],
      conditions: [],
      flags: { pregnant: false, disability: false },
      accessList: {},
      emergencyQrEnabled: false,
      qrVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('patients').doc(healthId).set(tempDoc);

    return res.status(201).json(formatSuccessResponse(tempDoc));
  } catch (error) {
    next(error);
  }
};

/**
 * Convert temporary patient to saved family member
 */
export const convertTemporaryPatient = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { relation = 'other' } = req.body;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Temporary patient record not found.'));
    }

    if (doc.data().ownerUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Only the creator can convert temporary profiles.'));
    }

    await docRef.update({
      isTemporary: false,
      relation,
      updatedAt: new Date()
    });

    return res.status(200).json(formatSuccessResponse({ message: 'Profile converted to saved family member.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Add / Invite Caregiver
 */
export const addCaregiver = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { email, role = 'caregiver', permissions = {}, isPrimary = false } = req.body;
    const { uid } = req.user;

    if (!email) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Caregiver email is required.'));
    }

    const db = assertDbConnected();
    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    if (doc.data().ownerUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Only owner can manage caregivers.'));
    }

    const userQuery = await db.collection('users').where('email', '==', email.trim()).limit(1).get();
    if (userQuery.empty) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', `User with email '${email}' not found.`));
    }

    const caregiverUid = userQuery.docs[0].id;
    const defaultPermissions = {
      book: true,
      cancel: true,
      checkin: true,
      medicines: true,
      viewRecords: role === 'guardian'
    };

    const accessEntry = {
      role,
      status: 'pending',
      isPrimary: !!isPrimary,
      permissions: { ...defaultPermissions, ...permissions },
      invitedAt: new Date().toISOString()
    };

    const accessList = doc.data().accessList || {};
    accessList[caregiverUid] = accessEntry;

    await docRef.update({ accessList, updatedAt: new Date() });

    await writeAuditLog({
      actorUid: uid,
      actorRole: req.user.role || 'patient',
      action: 'INVITE_CAREGIVER',
      targetType: 'patient',
      targetId: healthId,
      healthId,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({ message: 'Caregiver invitation sent.', inviteId: caregiverUid }));
  } catch (error) {
    next(error);
  }
};

/**
 * Accept Caregiver Invitation
 */
export const acceptCaregiverInvite = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    const accessList = doc.data().accessList || {};
    if (!accessList[uid]) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Caregiver invite not found.'));
    }

    accessList[uid].status = 'active';
    accessList[uid].acceptedAt = new Date().toISOString();

    await docRef.update({ accessList, updatedAt: new Date() });

    await writeAuditLog({
      actorUid: uid,
      actorRole: req.user.role || 'patient',
      action: 'ACCEPT_CAREGIVER_INVITE',
      targetType: 'patient',
      targetId: healthId,
      healthId,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({ message: 'Caregiver invitation accepted.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Update / Remove Caregiver Permissions
 */
export const updateCaregiver = async (req, res, next) => {
  try {
    const { healthId, caregiverUid } = req.params;
    const { role, permissions, isPrimary } = req.body;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists || doc.data().ownerUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. Only owner can modify caregiver settings.'));
    }

    const accessList = doc.data().accessList || {};
    if (!accessList[caregiverUid]) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Caregiver record not found.'));
    }

    if (role) accessList[caregiverUid].role = role;
    if (typeof isPrimary === 'boolean') accessList[caregiverUid].isPrimary = isPrimary;
    if (permissions) accessList[caregiverUid].permissions = { ...accessList[caregiverUid].permissions, ...permissions };

    await docRef.update({ accessList, updatedAt: new Date() });
    return res.status(200).json(formatSuccessResponse({ message: 'Caregiver permissions updated.' }));
  } catch (error) {
    next(error);
  }
};

export const removeCaregiver = async (req, res, next) => {
  try {
    const { healthId, caregiverUid } = req.params;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();

    if (!doc.exists || doc.data().ownerUid !== uid) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. Only owner can remove caregivers.'));
    }

    const accessList = doc.data().accessList || {};
    delete accessList[caregiverUid];

    await docRef.update({ accessList, updatedAt: new Date() });
    return res.status(200).json(formatSuccessResponse({ message: 'Caregiver removed.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Health ID Card Endpoint
 */
export const getHealthIdCard = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const doc = await db.collection('patients').doc(healthId).get();
    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    const data = doc.data();
    const isOwner = data.ownerUid === uid || data.primaryAccountUid === uid;
    const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
    const accessEntry = (data.accessList || {})[uid];
    const isCaregiver = accessEntry && accessEntry.status === 'active';

    if (!isOwner && !isStaff && !isCaregiver) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. You do not have permission to access this Health ID card.'));
    }

    const qrVersion = data.qrVersion || 1;
    const qrPayload = `PHI:${healthId}:${qrVersion}`;

    return res.status(200).json(formatSuccessResponse({
      healthId: data.healthId || data.patientHealthId,
      name: data.name || data.fullName,
      dob: data.dob,
      gender: data.gender,
      bloodGroup: data.bloodGroup || '',
      qrPayload,
      qrVersion,
      emergencyQrEnabled: !!data.emergencyQrEnabled,
      emergencyContact: data.emergencyQrEnabled ? data.emergencyContact : null,
      allergies: data.emergencyQrEnabled ? data.allergies : []
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh QR Code
 */
export const refreshHealthIdQr = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('patients').doc(healthId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    const isOwner = doc.data().ownerUid === uid || doc.data().primaryAccountUid === uid;
    const isStaff = ['doctor', 'admin'].includes(role);

    if (!isOwner && !isStaff) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. Only profile owner or authorized staff can refresh QR code.'));
    }

    const newVersion = (doc.data().qrVersion || 1) + 1;
    await docRef.update({ qrVersion: newVersion, updatedAt: new Date() });

    return res.status(200).json(formatSuccessResponse({
      qrVersion: newVersion,
      qrPayload: `PHI:${healthId}:${newVersion}`
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Staff Patient Lookup with Audit Logging
 */
export const staffPatientLookup = async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Search query (Health ID, phone, or name prefix) is required.'));
    }

    const db = assertDbConnected();
    const qLower = query.trim().toLowerCase();

    // First, check exact Health ID
    const exactDoc = await db.collection('patients').doc(query.trim()).get();
    if (exactDoc.exists) {
      const pData = exactDoc.data();
      const computedYears = calculateAge(pData.dob);
      pData.age = computedYears !== null ? `${computedYears} years` : '';
      await writeAuditLog({
        actorUid: req.user.uid,
        actorRole: req.user.role,
        action: 'STAFF_PATIENT_LOOKUP',
        targetType: 'patient_search',
        targetId: query,
        requestId: req.requestId
      });
      return res.status(200).json(formatSuccessResponse([pData]));
    }

    const snap = await db.collection('patients')
      .where('searchName', '>=', qLower)
      .where('searchName', '<=', qLower + '\uf8ff')
      .limit(10)
      .get();

    const results = snap.docs.map((d) => {
      const pData = d.data();
      const computedYears = calculateAge(pData.dob);
      return { ...pData, age: computedYears !== null ? `${computedYears} years` : '' };
    });

    await writeAuditLog({
      actorUid: req.user.uid,
      actorRole: req.user.role,
      action: 'STAFF_PATIENT_LOOKUP',
      targetType: 'patient_search',
      targetId: query,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse(results));
  } catch (error) {
    next(error);
  }
};

/**
 * Admin Patient Profile Merge
 */
export const adminMergePatients = async (req, res, next) => {
  try {
    const { sourceHealthId, targetHealthId } = req.body;
    if (!sourceHealthId || !targetHealthId) {
      return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'sourceHealthId and targetHealthId are required.'));
    }

    const db = assertDbConnected();
    const sourceRef = db.collection('patients').doc(sourceHealthId);
    const targetRef = db.collection('patients').doc(targetHealthId);

    const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);

    if (!sourceSnap.exists || !targetSnap.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Source or target patient profile not found.'));
    }

    await sourceRef.update({
      mergedInto: targetHealthId,
      updatedAt: new Date()
    });

    await writeAuditLog({
      actorUid: req.user.uid,
      actorRole: req.user.role,
      action: 'ADMIN_MERGE_PATIENTS',
      targetType: 'patient',
      targetId: sourceHealthId,
      healthId: targetHealthId,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      message: `Patient profile ${sourceHealthId} successfully merged into ${targetHealthId}.`
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Caregiver Activity History
 */
export const getPatientActivityHistory = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const patientDoc = await db.collection('patients').doc(healthId).get();
    if (!patientDoc.exists) {
      return res.status(404).json(formatErrorResponse('NOT_FOUND', 'Patient record not found.'));
    }

    const data = patientDoc.data();
    const isOwner = data.ownerUid === uid || data.primaryAccountUid === uid;
    const isStaff = ['doctor', 'admin'].includes(role);
    const accessEntry = (data.accessList || {})[uid];
    const isCaregiver = accessEntry && accessEntry.status === 'active';

    if (!isOwner && !isStaff && !isCaregiver) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. You do not have access to this patient activity history.'));
    }

    const logsSnap = await db.collection('auditLogs')
      .where('healthId', '==', healthId)
      .limit(50)
      .get();

    const activity = logsSnap.docs.map((d) => d.data());
    return res.status(200).json(formatSuccessResponse(activity));
  } catch (error) {
    next(error);
  }
};

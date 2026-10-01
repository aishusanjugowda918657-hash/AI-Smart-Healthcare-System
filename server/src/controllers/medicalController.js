import { assertDbConnected } from '../config/firebase.js';

/**
 * Create Clinical Medical Record (Doctor only)
 */
export const createMedicalRecord = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    const {
      id: customId,
      patientUid,
      patientHealthId,
      appointmentId,
      symptoms = [],
      diagnosisNotes,
      vitals = {}
    } = req.body;

    if (!patientHealthId || !diagnosisNotes) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and Diagnosis Notes are required.'
      });
    }

    const db = assertDbConnected();
    let id = customId;
    let existingDoc = null;

    if (!id && appointmentId) {
      const snap = await db.collection('medicalRecords').where('appointmentId', '==', appointmentId).get();
      if (!snap.empty) {
        existingDoc = snap.docs[0];
        id = existingDoc.id;
      }
    }

    if (!id) {
      id = `med-${Date.now().toString(36)}`;
    }

    const dateStr = new Date().toISOString().split('T')[0];

    const recordData = {
      id,
      patientUid: patientUid || 'demo-patient-001',
      patientHealthId,
      doctorUid,
      appointmentId: appointmentId || '',
      date: dateStr,
      symptoms: Array.isArray(symptoms) ? symptoms : [symptoms],
      diagnosisNotes,
      vitals: {
        bp: vitals.bp || '120/80',
        hr: vitals.hr || '72 bpm',
        temp: vitals.temp || '98.6 °F',
        weight: vitals.weight || '70 kg',
        height: vitals.height || '175 cm'
      },
      updatedAt: new Date()
    };

    if (existingDoc || customId) {
      await db.collection('medicalRecords').doc(id).set(recordData, { merge: true });
    } else {
      recordData.createdAt = new Date();
      await db.collection('medicalRecords').doc(id).set(recordData);
    }

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'CREATE_MEDICAL_RECORD',
      resourceType: 'medicalRecord',
      resourceId: id,
      patientHealthId,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Clinical medical record saved successfully.',
      data: recordData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient medical history (Role restricted & patient-isolated)
 */
export const getPatientMedicalHistory = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;

    const db = assertDbConnected();

    // Patient self-access: resolve their own Health ID or their dependents' Health IDs from the database
    if (role === 'patient') {
      let isAuthorized = false;
      const patientDoc = await db.collection('patients').doc(uid).get();

      if (patientDoc.exists && patientDoc.data().patientHealthId === patientHealthId) {
        isAuthorized = true;
      } else {
        const famSnap = await db
          .collection('patients')
          .where('primaryAccountUid', '==', uid)
          .where('patientHealthId', '==', patientHealthId)
          .limit(1)
          .get();
        if (!famSnap.empty) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden Access: Patients are only authorized to access their own or their dependents\' medical records.'
        });
      }
    }

    const snapshot = await db
      .collection('medicalRecords')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const records = snapshot.docs.map((d) => d.data());

    await db.collection('auditLogs').add({
      userId: uid,
      userRole: role,
      action: 'VIEW_MEDICAL_HISTORY',
      resourceType: 'medicalHistory',
      patientHealthId,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      patientHealthId,
      data: records
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get logged-in patient's own medical history
 */
export const getMyMedicalHistory = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const patientDoc = await db.collection('patients').doc(uid).get();
    const healthId = patientDoc.exists ? patientDoc.data().patientHealthId : 'HID-2026-00001';

    const snapshot = await db
      .collection('medicalRecords')
      .where('patientHealthId', '==', healthId)
      .get();

    const records = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      data: records
    });
  } catch (error) {
    next(error);
  }
};

import { assertDbConnected } from '../config/firebase.js';
import PDFDocument from 'pdfkit';

/**
 * Helper to build PDF Buffer asynchronously from PDFDocument
 */
function generatePdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));
    buildFn(doc);
    doc.end();
  });
}

/**
 * Check access rights for medical records / history
 */
export async function verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery = {}, reqBody = {} }) {
  if (role === 'admin') {
    return { authorized: true, reason: 'admin' };
  }

  // 1. Patient self or dependent access
  if (role === 'patient') {
    const patientDoc = await db.collection('patients').doc(uid).get();
    if (patientDoc.exists) {
      const pData = patientDoc.data();
      if (pData.patientHealthId === patientHealthId) {
        return { authorized: true, reason: 'self' };
      }
      if (pData.guardianHealthId === patientHealthId) {
        return { authorized: true, reason: 'guardian' };
      }
    }

    // Check dependents
    const famSnap = await db
      .collection('patients')
      .where('primaryAccountUid', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .limit(1)
      .get();
    if (!famSnap.empty) {
      return { authorized: true, reason: 'dependent' };
    }

    // Check caregiver grants
    const grantSnap = await db
      .collection('caregiverAccess')
      .where('caregiverUid', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'active')
      .get();

    const now = new Date();
    const activeGrant = grantSnap.docs.find((d) => {
      const exp = d.data().expiryDate ? new Date(d.data().expiryDate) : null;
      return !exp || exp > now;
    });

    if (activeGrant) {
      return { authorized: true, reason: 'caregiver_grant' };
    }

    return { authorized: false, reason: 'Forbidden: Patient not authorized for requested record' };
  }

  // 2. Doctor or Nurse Access
  if (role === 'doctor' || role === 'nurse') {
    // Check break-glass option
    const isBreakGlass = reqQuery.breakGlass === 'true' || reqBody.breakGlass === true;
    const breakGlassReason = reqQuery.breakGlassReason || reqBody.breakGlassReason;

    if (isBreakGlass) {
      if (!breakGlassReason || typeof breakGlassReason !== 'string' || breakGlassReason.trim().length < 10) {
        return {
          authorized: false,
          reason: 'BREAK_GLASS_REASON_REQUIRED',
          message: 'Emergency Break-Glass access requires a detailed justification (min 10 characters).'
        };
      }

      await db.collection('auditLogs').add({
        userId: uid,
        userRole: role,
        action: 'AUDIT_LOG_BREAK_GLASS',
        resourceType: 'medicalHistory',
        patientHealthId,
        breakGlassReason: breakGlassReason.trim(),
        timestamp: new Date()
      });

      return { authorized: true, reason: 'break_glass', isBreakGlass: true, breakGlassReason: breakGlassReason.trim() };
    }

    // Check doctor-patient share grant
    const docShareSnap = await db
      .collection('accessGrants')
      .where('granteeUid', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'active')
      .get();

    const activeDocGrant = docShareSnap.docs.find((d) => {
      const exp = d.data().expiryDate ? new Date(d.data().expiryDate) : null;
      return !exp || exp > new Date();
    });

    if (activeDocGrant) {
      return { authorized: true, reason: 'doctor_share_grant' };
    }

    // Check treating doctor status: active appointment or visit within 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const apptSnap = await db
      .collection('appointments')
      .where('doctorId', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const hasRecentAppt = apptSnap.docs.some((d) => {
      const data = d.data();
      const apptDate = new Date(data.date || data.createdAt || Date.now());
      return apptDate >= ninetyDaysAgo || ['booked', 'confirmed', 'checked_in', 'called', 'in_consultation'].includes(data.status);
    });

    if (hasRecentAppt) {
      return { authorized: true, reason: 'treating_doctor_90days' };
    }

    // Default for dev/demo testing if doctor uid starts with demo-doctor
    if (uid.startsWith('demo-doctor')) {
      return { authorized: true, reason: 'demo_treating_doctor' };
    }

    return {
      authorized: false,
      reason: 'Forbidden: Doctor does not have an active treatment relationship within 90 days. Use break-glass for emergencies.'
    };
  }

  return { authorized: false, reason: 'Forbidden Role' };
}

/**
 * Create Clinical Medical Record (Doctor/Admin only) with Versioning & Audit
 */
export const createMedicalRecord = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    const {
      id: customId,
      patientUid,
      patientHealthId,
      appointmentId,
      visitType = 'new',
      departmentId = 'dept-gen',
      symptoms = [],
      diagnosisNotes,
      vitals = {},
      isRestricted = false
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
    } else if (id) {
      const docSnap = await db.collection('medicalRecords').doc(id).get();
      if (docSnap.exists) {
        existingDoc = docSnap;
      }
    }

    if (!id) {
      id = `med-${Date.now().toString(36)}`;
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    let version = 1;
    let editHistory = [];

    if (existingDoc) {
      const oldData = existingDoc.data();
      version = (oldData.version || 1) + 1;
      editHistory = oldData.editHistory || [];
      editHistory.push({
        version: oldData.version || 1,
        diagnosisNotes: oldData.diagnosisNotes,
        vitals: oldData.vitals,
        updatedBy: oldData.doctorUid,
        updatedAt: oldData.updatedAt || oldData.createdAt
      });
    }

    const recordData = {
      id,
      patientUid: patientUid || 'demo-patient-001',
      patientHealthId,
      doctorUid,
      appointmentId: appointmentId || '',
      visitType,
      departmentId,
      date: dateStr,
      symptoms: Array.isArray(symptoms) ? symptoms : [symptoms],
      diagnosisNotes,
      vitals: {
        bp: vitals.bp || '120/80',
        hr: vitals.hr || '72 bpm',
        temp: vitals.temp || '98.6 °F',
        weight: vitals.weight || '70 kg',
        height: vitals.height || '175 cm',
        spO2: vitals.spO2 || '98%',
        bg: vitals.bg || '100 mg/dL'
      },
      isRestricted: Boolean(isRestricted),
      version,
      editHistory,
      updatedAt: now
    };

    if (existingDoc || customId) {
      await db.collection('medicalRecords').doc(id).set(recordData, { merge: true });
    } else {
      recordData.createdAt = now;
      await db.collection('medicalRecords').doc(id).set(recordData);
    }

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: existingDoc ? 'UPDATE_MEDICAL_RECORD' : 'CREATE_MEDICAL_RECORD',
      resourceType: 'medicalRecord',
      resourceId: id,
      patientHealthId,
      version,
      timestamp: now
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
 * Get Patient Medical History Timeline with Filtering, Cursor & Access Control
 */
export const getPatientMedicalHistory = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;
    const { startDate, endDate, departmentId, visitType, search, limit = 20, cursor } = req.query;

    const db = assertDbConnected();

    // Verify Access Control Rights
    const access = await verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery: req.query });
    if (!access.authorized) {
      await db.collection('auditLogs').add({
        actorUid: uid,
        actorRole: role,
        userId: uid,
        userRole: role,
        action: 'PATIENT_HISTORY_ACCESS_DENIED',
        targetType: 'patient',
        patientHealthId,
        reason: access.message || access.reason,
        timestamp: new Date()
      });
      return res.status(403).json({
        success: false,
        message: access.message || access.reason
      });
    }

    let snapshot = await db
      .collection('medicalRecords')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    let records = snapshot.docs.map((d) => d.data());

    // Filter restricted records if unauthorized
    records = records.filter((r) => {
      if (!r.isRestricted) return true;
      // Restricted record requires break-glass, admin, or self access
      return access.reason === 'self' || access.reason === 'admin' || access.isBreakGlass;
    });

    // Apply filters
    if (startDate) {
      records = records.filter((r) => r.date >= startDate);
    }
    if (endDate) {
      records = records.filter((r) => r.date <= endDate);
    }
    if (departmentId) {
      records = records.filter((r) => r.departmentId === departmentId);
    }
    if (visitType) {
      records = records.filter((r) => r.visitType === visitType);
    }
    if (search) {
      const q = search.toLowerCase();
      records = records.filter(
        (r) =>
          (r.diagnosisNotes && r.diagnosisNotes.toLowerCase().includes(q)) ||
          (r.symptoms && r.symptoms.some((s) => s.toLowerCase().includes(q)))
      );
    }

    // Sort chronologically descending
    records.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

    // Audit log read access for staff or doctor
    if (role === 'doctor' || role === 'nurse' || role === 'reception') {
      await db.collection('auditLogs').add({
        userId: uid,
        userRole: role,
        action: 'VIEW_MEDICAL_HISTORY',
        resourceType: 'medicalHistory',
        patientHealthId,
        breakGlassReason: access.breakGlassReason || null,
        timestamp: new Date()
      });
    }

    res.status(200).json({
      success: true,
      patientHealthId,
      accessReason: access.reason,
      data: records
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Logged-in Patient's Own Medical History
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

/**
 * Get Vitals Trend for Patient
 */
export const getVitalsTrend = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const snapshot = await db
      .collection('medicalRecords')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const vitalsTrend = snapshot.docs
      .map((d) => {
        const data = d.data();
        return {
          date: data.date,
          visitType: data.visitType,
          vitals: data.vitals || {}
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({
      success: true,
      patientHealthId,
      data: vitalsTrend
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Share Medical Record Access with Caregiver / Doctor
 */
export const shareAccess = async (req, res, next) => {
  try {
    const { uid: granterUid } = req.user;
    const { patientHealthId, granteeUid, granteeEmail, durationDays = 30 } = req.body;

    if (!patientHealthId || (!granteeUid && !granteeEmail)) {
      return res.status(400).json({ success: false, message: 'Patient Health ID and Grantee UID/Email required.' });
    }

    const db = assertDbConnected();
    const grantId = `grant-${Date.now().toString(36)}`;
    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + Number(durationDays));

    const grantData = {
      id: grantId,
      granterUid,
      patientHealthId,
      granteeUid: granteeUid || granteeEmail,
      status: 'active',
      createdAt: now,
      expiryDate: expiryDate.toISOString()
    };

    await db.collection('accessGrants').doc(grantId).set(grantData);

    res.status(201).json({
      success: true,
      message: `Medical record access shared successfully until ${expiryDate.toISOString().split('T')[0]}.`,
      data: grantData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Revoke Access Grant
 */
export const revokeAccess = async (req, res, next) => {
  try {
    const { grantId } = req.body;
    if (!grantId) {
      return res.status(400).json({ success: false, message: 'Grant ID required.' });
    }

    const db = assertDbConnected();
    await db.collection('accessGrants').doc(grantId).update({
      status: 'revoked',
      revokedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Access grant revoked successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate Medical History PDF Export (pdfkit)
 */
export const exportMedicalHistoryPdf = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const snapshot = await db
      .collection('medicalRecords')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const records = snapshot.docs.map((d) => d.data());
    records.sort((a, b) => new Date(b.date) - new Date(a.date));

    const pdfBuffer = await generatePdfBuffer((doc) => {
      // Header
      doc.fontSize(20).text('AI Smart Healthcare - Medical History Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Patient Health ID: ${patientHealthId} | Exported: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1.5);

      if (records.length === 0) {
        doc.fontSize(12).text('No clinical medical records found for this patient.');
        return;
      }

      records.forEach((r, idx) => {
        doc.fontSize(14).text(`Visit #${records.length - idx}: ${r.date} (${r.visitType || 'Routine'})`);
        doc.fontSize(10).text(`Doctor UID: ${r.doctorUid} | Department: ${r.departmentId || 'General'}`);
        doc.text(`Vitals: BP ${r.vitals?.bp || 'N/A'}, HR ${r.vitals?.hr || 'N/A'}, Temp ${r.vitals?.temp || 'N/A'}`);
        doc.text(`Symptoms: ${(r.symptoms || []).join(', ')}`);
        doc.text(`Diagnosis & Notes: ${r.diagnosisNotes}`);
        doc.moveDown(1);
      });
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="medical_history_${patientHealthId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

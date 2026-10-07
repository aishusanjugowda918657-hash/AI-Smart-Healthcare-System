import { assertDbConnected } from '../config/firebase.js';
import { verifyRecordAccess } from './medicalController.js';

/**
 * Format audit log entry as per PRD 4.2 / Section 8
 */
async function recordAuditLog(db, { actorUid, actorRole, action, targetType, targetId, healthId, details = {}, req }) {
  try {
    const requestId = req?.requestId || req?.headers?.['x-request-id'] || `req-${Date.now()}`;
    await db.collection('auditLogs').add({
      actorUid,
      actorRole,
      action,
      targetType,
      targetId: targetId || null,
      healthId: healthId || null,
      details,
      at: new Date(),
      requestId
    });
  } catch (err) {
    console.error('Audit log write error:', err.message);
  }
}

/**
 * POST /api/visits
 * Create Visit Record (Doctor Only)
 * PRD 4.2: healthId, appointmentId, doctorId, date, reason, findings, diagnosis, advice,
 *          vitals{bp,pulse,spo2,temp,sugar,weightKg}, followupId?, notes[{text,by,at}],
 *          version, supersedes?, restricted:boolean
 */
export const createVisit = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only doctors or administrators can create clinical visit records.'
      });
    }

    const {
      id: customId,
      healthId,
      patientHealthId,
      appointmentId = '',
      date,
      reason = '',
      findings = '',
      diagnosis = '',
      diagnosisNotes,
      advice = '',
      vitals = {},
      notes = [],
      prescriptionId = null,
      followupId = null,
      restricted = false,
      departmentId = 'dept-gen'
    } = req.body;

    const targetHealthId = healthId || patientHealthId;
    const finalDiagnosis = diagnosis || diagnosisNotes || '';

    if (!targetHealthId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Health ID is required.'
      });
    }

    if (!finalDiagnosis && !reason) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Diagnosis or Reason is required to save a visit.'
      });
    }

    const db = assertDbConnected();
    const now = new Date();
    const visitDate = date || now.toISOString().split('T')[0];

    // Check if a visit already exists for this appointment
    let existingVisit = null;
    let visitDocId = customId;

    if (!visitDocId && appointmentId) {
      const snap = await db.collection('visits').where('appointmentId', '==', appointmentId).limit(1).get();
      if (!snap.empty) {
        existingVisit = snap.docs[0];
        visitDocId = existingVisit.id;
      }
    } else if (visitDocId) {
      const snap = await db.collection('visits').doc(visitDocId).get();
      if (snap.exists) {
        existingVisit = snap;
      }
    }

    if (!visitDocId) {
      visitDocId = `vis-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    }

    let version = 1;
    let supersedes = null;
    let editHistory = [];

    if (existingVisit) {
      const prev = existingVisit.data();
      version = (prev.version || 1) + 1;
      supersedes = existingVisit.id;
      editHistory = Array.isArray(prev.editHistory) ? [...prev.editHistory] : [];
      editHistory.push({
        version: prev.version || 1,
        diagnosis: prev.diagnosis || prev.diagnosisNotes || '',
        findings: prev.findings || '',
        advice: prev.advice || '',
        vitals: prev.vitals || {},
        updatedBy: prev.doctorId || doctorUid,
        updatedAt: prev.updatedAt || prev.createdAt || now
      });
    }

    const cleanVitals = {
      bp: vitals.bp || '',
      pulse: vitals.pulse || vitals.hr || '',
      spo2: vitals.spo2 || vitals.spO2 || '',
      temp: vitals.temp || '',
      sugar: vitals.sugar || vitals.bg || '',
      weightKg: vitals.weightKg || vitals.weight || ''
    };

    const parsedNotes = Array.isArray(notes)
      ? notes.map((n) => (typeof n === 'string' ? { text: n, by: doctorUid, at: now } : n))
      : notes
      ? [{ text: String(notes), by: doctorUid, at: now }]
      : [];

    const visitData = {
      id: visitDocId,
      healthId: targetHealthId,
      patientHealthId: targetHealthId,
      appointmentId,
      doctorId: doctorUid,
      departmentId,
      date: visitDate,
      reason,
      findings,
      diagnosis: finalDiagnosis,
      diagnosisNotes: finalDiagnosis,
      advice,
      vitals: cleanVitals,
      notes: parsedNotes,
      prescriptionId: prescriptionId || null,
      followupId: followupId || null,
      version,
      supersedes,
      editHistory,
      restricted: Boolean(restricted),
      isRestricted: Boolean(restricted),
      updatedAt: now
    };

    if (existingVisit || customId) {
      await db.collection('visits').doc(visitDocId).set(visitData, { merge: true });
    } else {
      visitData.createdAt = now;
      await db.collection('visits').doc(visitDocId).set(visitData);
    }

    // Also sync to legacy medicalRecords collection for backward compatibility
    await db.collection('medicalRecords').doc(visitDocId).set({
      ...visitData,
      patientUid: req.body.patientUid || 'patient',
      doctorUid
    }, { merge: true });

    await recordAuditLog(db, {
      actorUid: doctorUid,
      actorRole: role,
      action: existingVisit ? 'UPDATE_VISIT' : 'CREATE_VISIT',
      targetType: 'visit',
      targetId: visitDocId,
      healthId: targetHealthId,
      details: { version, appointmentId },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Clinical visit record saved successfully.',
      data: visitData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/visits/:id
 * Correct a Visit Record -> Creates a NEW version with a reason; version 1 remains readable
 */
export const updateVisit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid: doctorUid, role } = req.user;

    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only doctors or administrators can edit visit records.'
      });
    }

    const {
      reasonForEdit,
      reason,
      findings,
      diagnosis,
      advice,
      vitals,
      notes,
      restricted
    } = req.body;

    const db = assertDbConnected();
    const docRef = db.collection('visits').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Visit record not found.'
      });
    }

    const prev = docSnap.data();
    const now = new Date();
    const newVersion = (prev.version || 1) + 1;

    // Archive previous version state
    const editHistory = Array.isArray(prev.editHistory) ? [...prev.editHistory] : [];
    editHistory.push({
      version: prev.version || 1,
      reasonForEdit: reasonForEdit || 'Clinical amendment',
      diagnosis: prev.diagnosis || prev.diagnosisNotes || '',
      findings: prev.findings || '',
      advice: prev.advice || '',
      vitals: prev.vitals || {},
      notes: prev.notes || [],
      restricted: prev.restricted || false,
      updatedBy: doctorUid,
      updatedAt: now
    });

    const updatedData = {
      ...prev,
      version: newVersion,
      supersedes: id,
      editHistory,
      updatedAt: now
    };

    if (reason !== undefined) updatedData.reason = reason;
    if (findings !== undefined) updatedData.findings = findings;
    if (diagnosis !== undefined) {
      updatedData.diagnosis = diagnosis;
      updatedData.diagnosisNotes = diagnosis;
    }
    if (advice !== undefined) updatedData.advice = advice;
    if (vitals !== undefined) {
      updatedData.vitals = {
        bp: vitals.bp ?? prev.vitals?.bp ?? '',
        pulse: vitals.pulse ?? vitals.hr ?? prev.vitals?.pulse ?? '',
        spo2: vitals.spo2 ?? vitals.spO2 ?? prev.vitals?.spo2 ?? '',
        temp: vitals.temp ?? prev.vitals?.temp ?? '',
        sugar: vitals.sugar ?? vitals.bg ?? prev.vitals?.sugar ?? '',
        weightKg: vitals.weightKg ?? vitals.weight ?? prev.vitals?.weightKg ?? ''
      };
    }
    if (notes !== undefined) {
      const addedNotes = Array.isArray(notes)
        ? notes.map((n) => (typeof n === 'string' ? { text: n, by: doctorUid, at: now } : n))
        : [{ text: String(notes), by: doctorUid, at: now }];
      updatedData.notes = [...(prev.notes || []), ...addedNotes];
    }
    if (restricted !== undefined) {
      updatedData.restricted = Boolean(restricted);
      updatedData.isRestricted = Boolean(restricted);
    }

    await docRef.set(updatedData);

    // Keep legacy collection synced
    await db.collection('medicalRecords').doc(id).set(updatedData, { merge: true });

    await recordAuditLog(db, {
      actorUid: doctorUid,
      actorRole: role,
      action: 'UPDATE_VISIT_VERSION',
      targetType: 'visit',
      targetId: id,
      healthId: prev.healthId,
      details: { newVersion, reasonForEdit },
      req
    });

    res.status(200).json({
      success: true,
      message: `Visit updated to version ${newVersion}. Previous version archived in edit history.`,
      data: updatedData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/visits/:id
 * Retrieve specific Visit Record
 */
export const getVisitById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    let docSnap = await db.collection('visits').doc(id).get();
    if (!docSnap.exists) {
      docSnap = await db.collection('medicalRecords').doc(id).get();
    }

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Visit record not found' });
    }

    const data = docSnap.data();
    const healthId = data.healthId || data.patientHealthId;

    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: healthId,
      reqQuery: req.query
    });

    if (!access.authorized) {
      await recordAuditLog(db, {
        actorUid: uid,
        actorRole: role,
        action: 'VISIT_ACCESS_DENIED',
        targetType: 'visit',
        targetId: id,
        healthId,
        details: { reason: access.reason },
        req
      });
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    // Check restricted visit visibility:
    // Restricted records are visible only to the treating doctor who wrote it or patient/admin/break-glass
    if (data.restricted || data.isRestricted) {
      const isAuthorDoctor = data.doctorId === uid || data.doctorUid === uid;
      const isPermitted = isAuthorDoctor || role === 'patient' || role === 'admin' || access.isBreakGlass;
      if (!isPermitted) {
        return res.status(403).json({
          success: false,
          message: 'Access Forbidden: This visit record has been marked as restricted by the treating physician.'
        });
      }
    }

    // Log read if doctor/staff
    if (['doctor', 'nurse', 'reception'].includes(role)) {
      await recordAuditLog(db, {
        actorUid: uid,
        actorRole: role,
        action: 'READ_VISIT',
        targetType: 'visit',
        targetId: id,
        healthId,
        req
      });
    }

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/visits/:id/flag
 * Flag a visit record (wrong or unclear data)
 */
export const flagVisit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;
    const { reason = 'Unclear clinical documentation' } = req.body;

    if (!['doctor', 'nurse', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions to flag records.' });
    }

    const db = assertDbConnected();
    const docRef = db.collection('visits').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Visit record not found' });
    }

    const now = new Date();
    await docRef.set({
      flagged: true,
      flagReason: reason,
      flaggedBy: uid,
      flaggedAt: now
    }, { merge: true });

    await recordAuditLog(db, {
      actorUid: uid,
      actorRole: role,
      action: 'FLAG_VISIT',
      targetType: 'visit',
      targetId: id,
      healthId: snap.data().healthId,
      details: { reason },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Visit record has been flagged for clinical review.',
      flagged: true,
      flagReason: reason
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/visits/:id/notes
 * Append clinical note to a visit
 */
export const addVisitNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Note text is required.' });
    }

    if (!['doctor', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Doctor role required.' });
    }

    const db = assertDbConnected();
    const docRef = db.collection('visits').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Visit not found.' });
    }

    const prev = snap.data();
    const now = new Date();
    const newNote = { text: text.trim(), by: uid, at: now };
    const notes = Array.isArray(prev.notes) ? [...prev.notes, newNote] : [newNote];

    await docRef.update({ notes, updatedAt: now });

    await recordAuditLog(db, {
      actorUid: uid,
      actorRole: role,
      action: 'ADD_VISIT_NOTE',
      targetType: 'visit',
      targetId: id,
      healthId: prev.healthId,
      req
    });

    res.status(200).json({
      success: true,
      message: 'Note added successfully.',
      notes
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/visits/:id/restricted
 * Toggle Restricted status on a visit
 */
export const toggleVisitRestricted = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;
    const { restricted } = req.body;

    if (!['doctor', 'admin'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Doctor role required.' });
    }

    const db = assertDbConnected();
    const docRef = db.collection('visits').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({ success: false, message: 'Visit not found.' });
    }

    const isRestricted = restricted !== undefined ? Boolean(restricted) : !snap.data().restricted;
    await docRef.update({
      restricted: isRestricted,
      isRestricted,
      updatedAt: new Date()
    });

    await recordAuditLog(db, {
      actorUid: uid,
      actorRole: role,
      action: 'TOGGLE_RESTRICTED',
      targetType: 'visit',
      targetId: id,
      healthId: snap.data().healthId,
      details: { restricted: isRestricted },
      req
    });

    res.status(200).json({
      success: true,
      message: `Visit marked as ${isRestricted ? 'Restricted' : 'Standard'}.`,
      restricted: isRestricted
    });
  } catch (error) {
    next(error);
  }
};

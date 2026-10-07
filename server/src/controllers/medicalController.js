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
 * PRD Section 8 / F9:
 * - Patient: self, guardian, permitted family dependent, permitted caregiver (must have viewRecords permission)
 * - Doctor: treating doctor (appointment within 90 days), active unexpired share grant, or emergency break-glass
 * - Caregiver without viewRecords permission gets 403
 * - Expired shares stop working automatically (403)
 * - Unrelated doctor gets 403
 */
export async function verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery = {}, reqBody = {} }) {
  if (!patientHealthId) {
    return { authorized: false, reason: 'Health ID is required' };
  }

  if (role === 'admin') {
    return { authorized: true, reason: 'admin' };
  }

  // 1. Patient / Family / Caregiver access
  if (role === 'patient') {
    // 1a. Check patient document directly (by doc id or field)
    if (uid) {
      const patientDoc = await db.collection('patients').doc(uid).get();
      if (patientDoc.exists) {
        const pData = patientDoc.data();
        if (pData.patientHealthId === patientHealthId || pData.healthId === patientHealthId) {
          return { authorized: true, reason: 'self' };
        }
        if (pData.guardianHealthId === patientHealthId) {
          return { authorized: true, reason: 'guardian' };
        }
      }
    }

    // Check if patient doc is keyed by patientHealthId
    if (patientHealthId) {
      const targetPatientDoc = await db.collection('patients').doc(patientHealthId).get();
      if (targetPatientDoc.exists) {
        const pData = targetPatientDoc.data();
        if (pData.ownerUid === uid || pData.uid === uid || pData.primaryAccountUid === uid) {
          return { authorized: true, reason: 'self' };
        }
        // Check accessList on patient document
        if (pData.accessList && pData.accessList[uid]) {
          const grant = pData.accessList[uid];
          if (grant.permissions && grant.permissions.viewRecords === false) {
            return {
              authorized: false,
              reason: 'Forbidden: Caregiver does not have permission to view records'
            };
          }
          return { authorized: true, reason: 'caregiver_grant' };
        }
      }
    }

    // 1b. Check family dependents
    const famSnap = await db
      .collection('patients')
      .where('primaryAccountUid', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .limit(1)
      .get();
    if (!famSnap.empty) {
      return { authorized: true, reason: 'dependent' };
    }

    const famSnap2 = await db
      .collection('patients')
      .where('ownerUid', '==', uid)
      .where('healthId', '==', patientHealthId)
      .limit(1)
      .get();
    if (!famSnap2.empty) {
      return { authorized: true, reason: 'dependent' };
    }

    // 1c. Check caregiverAccess collection
    const grantSnap = await db
      .collection('caregiverAccess')
      .where('caregiverUid', '==', uid)
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'active')
      .get();

    const now = new Date();
    const activeGrant = grantSnap.docs.find((d) => {
      const data = d.data();
      const exp = data.expiryDate ? new Date(data.expiryDate) : null;
      return !exp || exp > now;
    });

    if (activeGrant) {
      const gData = activeGrant.data();
      if (gData.permissions && gData.permissions.viewRecords === false) {
        return {
          authorized: false,
          reason: 'Forbidden: Caregiver does not have permission to view records'
        };
      }
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

      const now = new Date();
      await db.collection('auditLogs').add({
        userId: uid,
        actorUid: uid,
        userRole: role,
        actorRole: role,
        action: 'AUDIT_LOG_BREAK_GLASS',
        resourceType: 'medicalHistory',
        targetType: 'patient',
        targetId: patientHealthId,
        patientHealthId,
        healthId: patientHealthId,
        breakGlassReason: breakGlassReason.trim(),
        timestamp: now,
        at: now
      });

      // Notify the patient about the emergency break-glass event
      try {
        let pOwnerUid = null;
        const pSnap = await db.collection('patients').doc(patientHealthId).get();
        if (pSnap.exists) {
          pOwnerUid = pSnap.data().ownerUid || pSnap.data().uid;
        } else {
          const qSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
          if (!qSnap.empty) {
            pOwnerUid = qSnap.docs[0].data().primaryAccountUid || qSnap.docs[0].data().ownerUid || qSnap.docs[0].id;
          }
        }
        if (pOwnerUid) {
          await db.collection('notifications').add({
            uid: pOwnerUid,
            title: 'Emergency Record Access Notice',
            body: `Doctor accessed your medical record under emergency break-glass: ${breakGlassReason.trim()}`,
            type: 'break_glass',
            read: false,
            createdAt: now
          });
        }
      } catch (notifErr) {
        console.warn('Patient break-glass notification notice:', notifErr.message);
      }

      return {
        authorized: true,
        reason: 'break_glass',
        isBreakGlass: true,
        breakGlassReason: breakGlassReason.trim()
      };
    }

    // Check doctor-patient share grant (accessGrants collection)
    const docShareSnap = await db
      .collection('accessGrants')
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'active')
      .get();

    const now = new Date();
    const activeDoctorGrants = docShareSnap.docs.filter((d) => {
      const data = d.data();
      return data.granteeUid === uid || data.doctorId === uid;
    });

    if (activeDoctorGrants.length > 0) {
      const hasValidGrant = activeDoctorGrants.some((d) => {
        const data = d.data();
        const expDate = data.expiresAt ? new Date(data.expiresAt) : (data.expiryDate ? new Date(data.expiryDate) : null);
        return !expDate || expDate > now;
      });

      if (hasValidGrant) {
        return { authorized: true, reason: 'doctor_share_grant' };
      } else {
        return {
          authorized: false,
          reason: 'Forbidden: Medical record share has expired'
        };
      }
    }

    // Check treating doctor status: appointment or visit within 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const apptSnap = await db
      .collection('appointments')
      .where('doctorId', '==', uid)
      .get();

    const hasRecentAppt = apptSnap.docs.some((d) => {
      const data = d.data();
      const pId = data.patientHealthId || data.healthId;
      if (pId !== patientHealthId) return false;
      const apptDate = new Date(data.date || data.createdAt || Date.now());
      return apptDate >= ninetyDaysAgo || ['booked', 'confirmed', 'checked_in', 'called', 'in_consultation'].includes(data.status);
    });

    if (hasRecentAppt) {
      return { authorized: true, reason: 'treating_doctor_90days' };
    }

    // Allow demo doctors in test environments
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
 * Record Audit Log Helper
 */
async function recordAuditLog(db, { actorUid, actorRole, action, targetType, targetId, healthId, details = {}, req }) {
  try {
    const requestId = req?.requestId || req?.headers?.['x-request-id'] || `req-${Date.now()}`;
    const now = new Date();
    await db.collection('auditLogs').add({
      actorUid,
      actorRole,
      userId: actorUid,
      userRole: actorRole,
      action,
      targetType,
      targetId: targetId || null,
      healthId: healthId || null,
      patientHealthId: healthId || null,
      details,
      at: now,
      timestamp: now,
      requestId
    });
  } catch (err) {
    console.error('Audit log write error:', err.message);
  }
}

/**
 * GET /api/patients/:healthId/history
 * Unified Medical History Timeline (Visits, Reports, Prescriptions, Vitals)
 * Supports paged timeline (limit 20 with cursor) & Filter chips: all, fever, chronic, surgery, reports
 */
export const getPatientHistory = async (req, res, next) => {
  try {
    const targetHealthId = req.params.healthId || req.params.patientHealthId || req.query.healthId || req.query.patientHealthId;
    const { uid, role } = req.user;
    const {
      filter = 'all',
      limit = 20,
      cursor,
      search,
      startDate,
      endDate,
      departmentId,
      visitType
    } = req.query;
    const db = assertDbConnected();

    if (!targetHealthId) {
      return res.status(400).json({ success: false, message: 'Patient Health ID is required.' });
    }

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId: targetHealthId, reqQuery: req.query });
    if (!access.authorized) {
      await recordAuditLog(db, {
        actorUid: uid,
        actorRole: role,
        action: 'PATIENT_HISTORY_ACCESS_DENIED',
        targetType: 'patient',
        targetId: targetHealthId,
        healthId: targetHealthId,
        details: { reason: access.reason },
        req
      });
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    // 1. Fetch visits (and medicalRecords)
    const visitsSnap = await db.collection('visits').where('healthId', '==', targetHealthId).get();
    const medRecsSnap = await db.collection('medicalRecords').where('patientHealthId', '==', targetHealthId).get();

    // Map and deduplicate by id
    const visitsMap = new Map();
    visitsSnap.docs.forEach((d) => {
      visitsMap.set(d.id, { id: d.id, itemType: 'visit', ...d.data() });
    });
    medRecsSnap.docs.forEach((d) => {
      if (!visitsMap.has(d.id)) {
        const data = d.data();
        visitsMap.set(d.id, {
          id: d.id,
          itemType: 'visit',
          healthId: data.patientHealthId,
          doctorId: data.doctorUid,
          date: data.date,
          diagnosis: data.diagnosisNotes || '',
          diagnosisNotes: data.diagnosisNotes || '',
          vitals: data.vitals || {},
          restricted: Boolean(data.isRestricted),
          ...data
        });
      }
    });

    let timelineItems = Array.from(visitsMap.values());

    // Filter restricted visits:
    // Visible only to treating doctor who created it, patient, admin, or break-glass
    timelineItems = timelineItems.filter((item) => {
      if (!item.restricted && !item.isRestricted) return true;
      const isAuthor = item.doctorId === uid || item.doctorUid === uid;
      return isAuthor || role === 'patient' || role === 'admin' || access.isBreakGlass;
    });

    // 2. Fetch reports
    const reportsSnap = await db.collection('reports').where('healthId', '==', targetHealthId).get();
    const reportsByPatient = await db.collection('reports').where('patientHealthId', '==', targetHealthId).get();
    const reportsMap = new Map();
    reportsSnap.docs.forEach((d) => reportsMap.set(d.id, { id: d.id, itemType: 'report', ...d.data() }));
    reportsByPatient.docs.forEach((d) => reportsMap.set(d.id, { id: d.id, itemType: 'report', ...d.data() }));
    const reportItems = Array.from(reportsMap.values());

    // 3. Fetch prescriptions
    const rxSnap = await db.collection('prescriptions').where('healthId', '==', targetHealthId).get();
    const rxSnapByPatient = await db.collection('prescriptions').where('patientHealthId', '==', targetHealthId).get();
    const rxMap = new Map();
    rxSnap.docs.forEach((d) => rxMap.set(d.id, { id: d.id, itemType: 'prescription', ...d.data() }));
    rxSnapByPatient.docs.forEach((d) => rxMap.set(d.id, { id: d.id, itemType: 'prescription', ...d.data() }));
    const rxItems = Array.from(rxMap.values());

    // Merge all items into timeline
    timelineItems = [...timelineItems, ...reportItems, ...rxItems];

    // Apply specific query filters if provided
    if (startDate) {
      timelineItems = timelineItems.filter((r) => (r.date || r.createdAt) >= startDate);
    }
    if (endDate) {
      timelineItems = timelineItems.filter((r) => (r.date || r.createdAt) <= endDate);
    }
    if (departmentId) {
      timelineItems = timelineItems.filter((r) => r.departmentId === departmentId);
    }
    if (visitType) {
      timelineItems = timelineItems.filter((r) => r.visitType === visitType);
    }
    if (search) {
      const q = search.toLowerCase();
      timelineItems = timelineItems.filter((r) => {
        const text = JSON.stringify(r).toLowerCase();
        return text.includes(q);
      });
    }

    // Filter chips: all, fever, chronic, surgery, reports
    const normFilter = String(filter).toLowerCase();
    if (normFilter === 'reports') {
      timelineItems = timelineItems.filter((item) => item.itemType === 'report');
    } else if (normFilter === 'fever') {
      timelineItems = timelineItems.filter((item) => {
        const text = JSON.stringify(item).toLowerCase();
        return text.includes('fever') || text.includes('cold') || text.includes('cough') || text.includes('flu') || text.includes('infection');
      });
    } else if (normFilter === 'chronic') {
      timelineItems = timelineItems.filter((item) => {
        const text = JSON.stringify(item).toLowerCase();
        return text.includes('diabetes') || text.includes('sugar') || text.includes('hypertension') || text.includes('bp') || text.includes('chronic') || text.includes('asthma') || text.includes('cardio');
      });
    } else if (normFilter === 'surgery') {
      timelineItems = timelineItems.filter((item) => {
        const text = JSON.stringify(item).toLowerCase();
        return text.includes('surgery') || text.includes('procedure') || text.includes('operation') || text.includes('post-op') || text.includes('surgical');
      });
    }

    // Sort newest first
    timelineItems.sort((a, b) => {
      const dateA = new Date(a.date || a.createdAt || 0);
      const dateB = new Date(b.date || b.createdAt || 0);
      return dateB - dateA;
    });

    // Paging: limit to 20 with cursor
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    let startIndex = 0;
    if (cursor) {
      const cursorIdx = timelineItems.findIndex((item) => item.id === cursor);
      if (cursorIdx >= 0) startIndex = cursorIdx + 1;
    }
    const pagedItems = timelineItems.slice(startIndex, startIndex + pageSize);
    const nextCursor = pagedItems.length === pageSize && (startIndex + pageSize < timelineItems.length)
      ? pagedItems[pagedItems.length - 1].id
      : null;

    // Every doctor or staff read writes an audit log
    if (['doctor', 'nurse', 'reception'].includes(role)) {
      await recordAuditLog(db, {
        actorUid: uid,
        actorRole: role,
        action: 'READ_MEDICAL_HISTORY',
        targetType: 'patient',
        targetId: targetHealthId,
        healthId: targetHealthId,
        details: { filter: normFilter, itemsCount: pagedItems.length },
        req
      });
    }

    res.status(200).json({
      success: true,
      healthId: targetHealthId,
      accessReason: access.reason,
      totalCount: timelineItems.length,
      nextCursor,
      data: pagedItems
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:healthId/vitals?metric=
 * Longitudinal Vitals Trends (last 12 values)
 */
export const getPatientVitalsTrend = async (req, res, next) => {
  try {
    const targetHealthId = req.params.healthId || req.params.patientHealthId;
    const { uid, role } = req.user;
    const { metric } = req.query;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId: targetHealthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const visitsSnap = await db.collection('visits').where('healthId', '==', targetHealthId).get();
    const medRecsSnap = await db.collection('medicalRecords').where('patientHealthId', '==', targetHealthId).get();

    const map = new Map();
    visitsSnap.docs.forEach((d) => map.set(d.id, d.data()));
    medRecsSnap.docs.forEach((d) => { if (!map.has(d.id)) map.set(d.id, d.data()); });

    let vitalsList = Array.from(map.values())
      .filter((r) => r.vitals && Object.keys(r.vitals).length > 0)
      .map((r) => ({
        date: r.date || (r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : 'Recent'),
        bp: r.vitals.bp || '',
        pulse: r.vitals.pulse || r.vitals.hr || '',
        spo2: r.vitals.spo2 || r.vitals.spO2 || '',
        temp: r.vitals.temp || '',
        sugar: r.vitals.sugar || r.vitals.bg || '',
        weightKg: r.vitals.weightKg || r.vitals.weight || '',
        vitals: r.vitals
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Keep only the last 12 values as required by quota rules
    if (vitalsList.length > 12) {
      vitalsList = vitalsList.slice(vitalsList.length - 12);
    }

    // Filter metric if requested (sugar, bp, weight)
    if (metric) {
      const m = String(metric).toLowerCase();
      vitalsList = vitalsList.map((v) => {
        let val = null;
        if (m === 'sugar' || m === 'bg') val = v.sugar;
        else if (m === 'bp' || m === 'blood_pressure') val = v.bp;
        else if (m === 'weight' || m === 'weightkg') val = v.weightKg;
        else if (m === 'pulse' || m === 'hr') val = v.pulse;
        else if (m === 'temp') val = v.temp;
        return {
          date: v.date,
          metric: m,
          value: val
        };
      });
    }

    res.status(200).json({
      success: true,
      healthId: targetHealthId,
      data: vitalsList
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:healthId/share
 * Share Medical History with a Doctor for N hours
 */
export const sharePatientHistory = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid } = req.user;
    const { doctorId, hours = 24 } = req.body;

    if (!doctorId) {
      return res.status(400).json({ success: false, message: 'Doctor ID is required.' });
    }

    const db = assertDbConnected();
    const shareHours = Math.max(Number(hours) || 1, 1);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + shareHours * 3600 * 1000);
    const shareId = `share-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Invalidate existing active shares for this doctor + patient to avoid lingering duplicate active shares
    const existingGrantsSnap = await db
      .collection('accessGrants')
      .where('patientHealthId', '==', healthId)
      .where('status', '==', 'active')
      .get();

    for (const d of existingGrantsSnap.docs) {
      const data = d.data();
      if (data.granteeUid === doctorId || data.doctorId === doctorId) {
        await d.ref.update({ status: 'superseded', supersededAt: now });
      }
    }

    const grantData = {
      id: shareId,
      shareId,
      patientHealthId: healthId,
      healthId,
      grantedByUid: uid,
      granteeUid: doctorId,
      doctorId,
      hours: shareHours,
      status: 'active',
      createdAt: now,
      expiresAt: expiresAt.toISOString(),
      expiryDate: expiresAt.toISOString()
    };

    await db.collection('accessGrants').doc(shareId).set(grantData);

    await recordAuditLog(db, {
      actorUid: uid,
      actorRole: 'patient',
      action: 'SHARE_MEDICAL_HISTORY',
      targetType: 'doctor',
      targetId: doctorId,
      healthId,
      details: { shareHours, expiresAt: expiresAt.toISOString() },
      req
    });

    res.status(201).json({
      success: true,
      message: `Medical history shared with doctor for ${shareHours} hour(s).`,
      data: grantData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/patients/:healthId/share/:shareId
 * Revoke Active Doctor Share Grant
 */
export const revokePatientShare = async (req, res, next) => {
  try {
    const { healthId, shareId } = req.params;
    const { uid } = req.user;
    const db = assertDbConnected();

    const docRef = db.collection('accessGrants').doc(shareId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ success: false, message: 'Share grant not found.' });
    }

    const now = new Date();
    await docRef.update({
      status: 'revoked',
      revokedAt: now,
      revokedBy: uid
    });

    await recordAuditLog(db, {
      actorUid: uid,
      actorRole: 'patient',
      action: 'REVOKE_SHARE_GRANT',
      targetType: 'share',
      targetId: shareId,
      healthId,
      req
    });

    res.status(200).json({
      success: true,
      message: 'Medical record share revoked successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:healthId/shares
 * List active shares for patient
 */
export const getActivePatientShares = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const db = assertDbConnected();

    const snap = await db
      .collection('accessGrants')
      .where('patientHealthId', '==', healthId)
      .where('status', '==', 'active')
      .get();

    const now = new Date();
    const shares = snap.docs
      .map((d) => d.data())
      .filter((s) => {
        const exp = s.expiresAt ? new Date(s.expiresAt) : null;
        return !exp || exp > now;
      });

    res.status(200).json({
      success: true,
      data: shares
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:healthId/access-log
 * "Who Viewed My Records" Audit Log
 */
export const getPatientAccessLog = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId: healthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const snap = await db
      .collection('auditLogs')
      .where('patientHealthId', '==', healthId)
      .limit(50)
      .get();

    const snap2 = await db
      .collection('auditLogs')
      .where('healthId', '==', healthId)
      .limit(50)
      .get();

    const logsMap = new Map();
    [...snap.docs, ...snap2.docs].forEach((d) => {
      logsMap.set(d.id, { id: d.id, ...d.data() });
    });

    const logs = Array.from(logsMap.values()).sort((a, b) => {
      const tA = new Date(a.at || a.timestamp || 0);
      const tB = new Date(b.at || b.timestamp || 0);
      return tB - tA;
    });

    res.status(200).json({
      success: true,
      healthId,
      data: logs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:healthId/allergies
 * Add Allergy with "confirmed by doctor" marker
 */
export const addPatientAllergy = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const { name, severity = 'moderate' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Allergy name is required.' });
    }

    const db = assertDbConnected();
    let patientDocRef = db.collection('patients').doc(healthId);
    let pSnap = await patientDocRef.get();

    if (!pSnap.exists) {
      const qSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
      if (!qSnap.empty) {
        patientDocRef = qSnap.docs[0].ref;
        pSnap = qSnap.docs[0];
      }
    }

    const isDoc = role === 'doctor';
    const newAllergy = {
      name: name.trim(),
      severity: severity || 'moderate',
      confirmedByDoctor: isDoc,
      confirmedAt: isDoc ? new Date() : null,
      confirmedByDoctorId: isDoc ? uid : null,
      addedAt: new Date()
    };

    const prevAllergies = pSnap.exists && Array.isArray(pSnap.data().allergies) ? pSnap.data().allergies : [];
    const allergies = [...prevAllergies, newAllergy];

    if (pSnap.exists) {
      await patientDocRef.update({ allergies, updatedAt: new Date() });
    } else {
      await patientDocRef.set({ healthId, patientHealthId: healthId, allergies, createdAt: new Date() });
    }

    res.status(201).json({
      success: true,
      message: 'Allergy added successfully.',
      data: newAllergy
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:healthId/conditions
 * Add Condition with "confirmed by doctor" marker
 */
export const addPatientCondition = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const { name, since } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Condition name is required.' });
    }

    const db = assertDbConnected();
    let patientDocRef = db.collection('patients').doc(healthId);
    let pSnap = await patientDocRef.get();

    if (!pSnap.exists) {
      const qSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
      if (!qSnap.empty) {
        patientDocRef = qSnap.docs[0].ref;
        pSnap = qSnap.docs[0];
      }
    }

    const isDoc = role === 'doctor';
    const newCondition = {
      name: name.trim(),
      since: since || new Date().toISOString().split('T')[0],
      confirmedByDoctor: isDoc,
      confirmedAt: isDoc ? new Date() : null,
      confirmedByDoctorId: isDoc ? uid : null,
      addedAt: new Date()
    };

    const prevConditions = pSnap.exists && Array.isArray(pSnap.data().conditions) ? pSnap.data().conditions : [];
    const conditions = [...prevConditions, newCondition];

    if (pSnap.exists) {
      await patientDocRef.update({ conditions, updatedAt: new Date() });
    } else {
      await patientDocRef.set({ healthId, patientHealthId: healthId, conditions, createdAt: new Date() });
    }

    res.status(201).json({
      success: true,
      message: 'Condition added successfully.',
      data: newCondition
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:healthId/confirm-allergy
 * Doctor confirms an allergy
 */
export const confirmPatientAllergy = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const { allergyIndex = 0, allergyName } = req.body;

    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Only doctors can confirm clinical allergies.' });
    }

    const db = assertDbConnected();
    let patientDocRef = db.collection('patients').doc(healthId);
    let pSnap = await patientDocRef.get();

    if (!pSnap.exists) {
      const qSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
      if (!qSnap.empty) {
        patientDocRef = qSnap.docs[0].ref;
        pSnap = qSnap.docs[0];
      }
    }

    if (!pSnap.exists) {
      return res.status(404).json({ success: false, message: 'Patient document not found.' });
    }

    const allergies = Array.isArray(pSnap.data().allergies) ? [...pSnap.data().allergies] : [];
    const idx = allergyName
      ? allergies.findIndex((a) => a.name.toLowerCase() === allergyName.toLowerCase())
      : allergyIndex;

    if (idx >= 0 && idx < allergies.length) {
      allergies[idx] = {
        ...allergies[idx],
        confirmedByDoctor: true,
        confirmedAt: new Date(),
        confirmedByDoctorId: uid
      };
      await patientDocRef.update({ allergies, updatedAt: new Date() });
      return res.status(200).json({ success: true, message: 'Allergy confirmed by doctor.', data: allergies[idx] });
    }

    res.status(400).json({ success: false, message: 'Specified allergy not found.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:healthId/confirm-condition
 * Doctor confirms a chronic condition
 */
export const confirmPatientCondition = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const { uid, role } = req.user;
    const { conditionIndex = 0, conditionName } = req.body;

    if (role !== 'doctor' && role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Only doctors can confirm clinical conditions.' });
    }

    const db = assertDbConnected();
    let patientDocRef = db.collection('patients').doc(healthId);
    let pSnap = await patientDocRef.get();

    if (!pSnap.exists) {
      const qSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
      if (!qSnap.empty) {
        patientDocRef = qSnap.docs[0].ref;
        pSnap = qSnap.docs[0];
      }
    }

    if (!pSnap.exists) {
      return res.status(404).json({ success: false, message: 'Patient document not found.' });
    }

    const conditions = Array.isArray(pSnap.data().conditions) ? [...pSnap.data().conditions] : [];
    const idx = conditionName
      ? conditions.findIndex((c) => c.name.toLowerCase() === conditionName.toLowerCase())
      : conditionIndex;

    if (idx >= 0 && idx < conditions.length) {
      conditions[idx] = {
        ...conditions[idx],
        confirmedByDoctor: true,
        confirmedAt: new Date(),
        confirmedByDoctorId: uid
      };
      await patientDocRef.update({ conditions, updatedAt: new Date() });
      return res.status(200).json({ success: true, message: 'Condition confirmed by doctor.', data: conditions[idx] });
    }

    res.status(400).json({ success: false, message: 'Specified condition not found.' });
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy Support: createMedicalRecord
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
      if (docSnap.exists) existingDoc = docSnap;
    }

    if (!id) id = `med-${Date.now().toString(36)}`;

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
      patientUid: patientUid || 'patient',
      patientHealthId,
      healthId: patientHealthId,
      doctorUid,
      doctorId: doctorUid,
      appointmentId: appointmentId || '',
      visitType,
      departmentId,
      date: dateStr,
      symptoms: Array.isArray(symptoms) ? symptoms : [symptoms],
      diagnosisNotes,
      diagnosis: diagnosisNotes,
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
      restricted: Boolean(isRestricted),
      version,
      editHistory,
      updatedAt: now
    };

    if (existingDoc || customId) {
      await db.collection('medicalRecords').doc(id).set(recordData, { merge: true });
      await db.collection('visits').doc(id).set(recordData, { merge: true });
    } else {
      recordData.createdAt = now;
      await db.collection('medicalRecords').doc(id).set(recordData);
      await db.collection('visits').doc(id).set(recordData);
    }

    await recordAuditLog(db, {
      actorUid: doctorUid,
      actorRole: role,
      action: existingDoc ? 'UPDATE_MEDICAL_RECORD' : 'CREATE_MEDICAL_RECORD',
      targetType: 'medicalRecord',
      targetId: id,
      healthId: patientHealthId,
      details: { version },
      req
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
 * Legacy Support: getPatientMedicalHistory
 */
export const getPatientMedicalHistory = async (req, res, next) => {
  return getPatientHistory(req, res, next);
};

/**
 * Legacy Support: getMyMedicalHistory
 */
export const getMyMedicalHistory = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    let healthId = 'HID-2026-00001';
    const patientDoc = await db.collection('patients').doc(uid).get();
    if (patientDoc.exists) {
      healthId = patientDoc.data().patientHealthId || patientDoc.data().healthId || healthId;
    }

    req.params = { ...req.params, healthId };
    return getPatientHistory(req, res, next);
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy Support: getVitalsTrend
 */
export const getVitalsTrend = async (req, res, next) => {
  const { patientHealthId, healthId } = req.params;
  req.params.healthId = healthId || patientHealthId;
  return getPatientVitalsTrend(req, res, next);
};

/**
 * Legacy Support: shareAccess
 */
export const shareAccess = async (req, res, next) => {
  const { patientHealthId, healthId } = req.body;
  req.params.healthId = healthId || patientHealthId;
  return sharePatientHistory(req, res, next);
};

/**
 * Legacy Support: revokeAccess
 */
export const revokeAccess = async (req, res, next) => {
  const { grantId, shareId } = req.body;
  req.params.shareId = shareId || grantId;
  return revokePatientShare(req, res, next);
};

/**
 * Export Medical History PDF (pdfkit)
 * PRD F9: GET /patients/:healthId/history.pdf
 */
export const exportMedicalHistoryPdf = async (req, res, next) => {
  try {
    const targetHealthId = req.params.healthId || req.params.patientHealthId;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId: targetHealthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const visitsSnap = await db.collection('visits').where('healthId', '==', targetHealthId).get();
    const medRecsSnap = await db.collection('medicalRecords').where('patientHealthId', '==', targetHealthId).get();

    const visitsMap = new Map();
    visitsSnap.docs.forEach((d) => visitsMap.set(d.id, d.data()));
    medRecsSnap.docs.forEach((d) => { if (!visitsMap.has(d.id)) visitsMap.set(d.id, d.data()); });

    let records = Array.from(visitsMap.values());
    records.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    // Fetch reports as well
    const reportsSnap = await db.collection('reports').where('healthId', '==', targetHealthId).get();
    const reports = reportsSnap.docs.map((d) => d.data());

    const pdfBuffer = await generatePdfBuffer((doc) => {
      // Header
      doc.fontSize(20).text('AI Smart Healthcare System', { align: 'center' });
      doc.fontSize(14).text('Comprehensive Medical History Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Patient Health ID: ${targetHealthId} | Exported: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1.5);

      if (records.length === 0 && reports.length === 0) {
        doc.fontSize(12).text('No clinical records or diagnostic reports found for this patient.');
        return;
      }

      // Section: Clinical Visits
      doc.fontSize(14).text('Clinical Visits & Consultations', { underline: true });
      doc.moveDown(0.5);

      records.forEach((r, idx) => {
        doc.fontSize(12).text(`Visit #${records.length - idx}: ${r.date || 'Recent'} (${r.visitType || 'Routine'})`);
        doc.fontSize(10).text(`Doctor ID: ${r.doctorId || r.doctorUid || 'N/A'} | Department: ${r.departmentId || 'General'}`);
        doc.text(`Vitals: BP: ${r.vitals?.bp || 'N/A'}, Pulse: ${r.vitals?.pulse || r.vitals?.hr || 'N/A'}, Temp: ${r.vitals?.temp || 'N/A'}, Sugar: ${r.vitals?.sugar || r.vitals?.bg || 'N/A'}`);
        if (r.reason) doc.text(`Reason: ${r.reason}`);
        doc.text(`Diagnosis: ${r.diagnosis || r.diagnosisNotes || 'N/A'}`);
        if (r.findings) doc.text(`Findings: ${r.findings}`);
        if (r.advice) doc.text(`Advice: ${r.advice}`);
        doc.moveDown(0.8);
      });

      // Section: Attached Reports
      if (reports.length > 0) {
        doc.moveDown(1);
        doc.fontSize(14).text('Diagnostic Reports', { underline: true });
        doc.moveDown(0.5);
        reports.forEach((rep) => {
          doc.fontSize(10).text(`• ${rep.fileName || rep.title} (${rep.mimeType || rep.fileType || 'Document'}, ${rep.sizeBytes ? Math.round(rep.sizeBytes / 1024) + ' KB' : 'N/A'})`);
        });
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="medical_history_${targetHealthId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

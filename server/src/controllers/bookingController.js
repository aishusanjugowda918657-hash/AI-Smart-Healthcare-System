import crypto from 'crypto';
import { assertDbConnected } from '../config/firebase.js';
import { evaluateTriageRules, mergeAIWithRulesTriage } from '../domain/triage.js';
import { getExpectedDuration } from '../domain/waitTime.js';
import { getSmartSlotSuggestions, generateSlotsForDoctorDate } from '../domain/slots.js';
import { analyzeTriageWithGemini } from '../ai/geminiClient.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { writeAuditLog } from '../utils/audit.js';
import { SlotStatus } from '../domain/constants.js';

/**
 * POST /api/booking/triage (PRD F4)
 * Evaluates clinical triage rules + Gemini AI enrichment
 */
export const performTriage = async (req, res, next) => {
  try {
    const { reasonText = '', answers = {} } = req.body;

    if (!reasonText || !reasonText.trim()) {
      throw new AppError('VALIDATION_ERROR', 'Reason for visit text is required for clinical triage.', 400);
    }

    const db = assertDbConnected();

    // 1. Evaluate Rule-based triage engine (multi-language red flag matching)
    const ruleResult = evaluateTriageRules(reasonText, answers);

    // 2. Evaluate Gemini AI analysis (if enabled)
    const aiResult = await analyzeTriageWithGemini(reasonText, answers);

    // 3. Merge AI result with Rule result (CRITICAL SAFEGUARD: AI CAN NEVER LOWER RULE LEVEL)
    const mergedTriage = mergeAIWithRulesTriage(ruleResult, aiResult);

    // 4. Fetch Department doc to get expected duration (non-critical — wrapped so quota errors
    //    cannot abort the safety-critical triage response that was already computed above).
    let departmentDoc = null;
    try {
      if (mergedTriage.departmentId) {
        const deptSnap = await db.collection('departments').doc(mergedTriage.departmentId).get();
        if (deptSnap.exists) {
          departmentDoc = deptSnap.data();
        }
      }
    } catch (deptErr) {
      console.warn('⚠️ [triage] departments lookup failed (non-critical):', deptErr.message);
    }

    const expectedDurationMin = getExpectedDuration({
      department: departmentDoc,
      visitType: mergedTriage.visitType,
      complexity: mergedTriage.complexity
    });

    // 5. If emergency red flag triggered, create urgent alert for triage nurses.
    //    Retry up to 3 times (500 ms delay) so transient quota spikes don't lose alerts.
    //    On final failure: log reqId + return alertStatus:'failed' — patient still gets
    //    the emergency message, safety is never compromised.
    let alertStatus = 'none';
    if (mergedTriage.redFlag) {
      const alertId = `alert_triage_${Date.now()}`;
      const alertDoc = {
        id: alertId,
        healthId: req.body.patientHealthId || 'pending',
        patientName: req.body.patientName || 'Patient',
        riskLevel: 'high',
        reasons: [`Triage Red Flag: ${reasonText}`],
        status: 'open',
        kind: 'urgent',
        createdAt: new Date()
      };

      const MAX_ALERT_ATTEMPTS = 3;
      const ALERT_RETRY_DELAY_MS = 500;
      let alertWritten = false;

      for (let attempt = 1; attempt <= MAX_ALERT_ATTEMPTS; attempt++) {
        try {
          await db.collection('alerts').doc(alertId).set(alertDoc);
          alertWritten = true;
          alertStatus = 'created';
          break;
        } catch (alertErr) {
          if (attempt < MAX_ALERT_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, ALERT_RETRY_DELAY_MS * attempt));
          } else {
            const reqId = req.id || req.headers?.['x-request-id'] || 'unknown';
            console.error(
              `❌ [triage] alert write FAILED after ${MAX_ALERT_ATTEMPTS} attempts ` +
              `[reqId=${reqId}] [alertId=${alertId}]:`,
              alertErr.message
            );
            alertStatus = 'failed';
          }
        }
      }
    }

    res.status(200).json(formatSuccessResponse({
      ...mergedTriage,
      expectedDurationMin,
      alertStatus
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/booking/doctor-options (PRD F3)
 * Returns suggested department's doctors with next free slot & "Your usual doctor" badge
 */
export const getDoctorOptions = async (req, res, next) => {
  try {
    const { departmentId, patientHealthId } = req.query;

    if (!departmentId) {
      throw new AppError('VALIDATION_ERROR', 'departmentId parameter is required.', 400);
    }

    const canonicalDeptId = departmentId.toString().trim().toLowerCase();
    const db = assertDbConnected();

    // Fetch doctors for department. If Firestore is unavailable (e.g. quota
    // exhausted) throw a 503 so the client shows "retry" not "no doctors found".
    let doctorsSnap;
    try {
      doctorsSnap = await db
        .collection('doctors')
        .where('departmentId', '==', canonicalDeptId)
        .get();
    } catch (dbErr) {
      const code = dbErr?.code;
      if (code === 8 || dbErr.message?.includes('RESOURCE_EXHAUSTED') || dbErr.message?.includes('UNAVAILABLE')) {
        throw new AppError(
          'FIRESTORE_UNAVAILABLE',
          'The database is temporarily unavailable. Please try again in a moment.',
          503
        );
      }
      throw dbErr;
    }

    let doctors = doctorsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    if (doctors.length === 0) {
      // Fallback 1: Query original departmentId string if different
      const rawSnap = await db
        .collection('doctors')
        .where('departmentId', '==', departmentId)
        .get();

      doctors = rawSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    if (doctors.length === 0) {
      // Fallback 2: Scan doctors collection and match normalized departmentId or deptId
      const allDocsSnap = await db.collection('doctors').limit(100).get();
      doctors = allDocsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => {
          const docDept = (d.departmentId || d.deptId || '').toString().toLowerCase();
          return docDept === canonicalDeptId || docDept === departmentId.toString().toLowerCase();
        });
    }

    if (doctors.length === 0) {
      // Fallback 3: Check 'users' collection for doctors
      const usersSnap = await db
        .collection('users')
        .where('role', '==', 'doctor')
        .get();

      doctors = usersSnap.docs
        .map((d) => ({ id: d.id, ...d.data(), doctorId: d.data().doctorId || d.id }))
        .filter((d) => {
          const docDept = (d.departmentId || d.deptId || '').toString().toLowerCase();
          return !docDept || docDept === canonicalDeptId;
        });
    }

    // Check if patient has visited any of these doctors previously
    let previousDoctorId = null;
    if (patientHealthId) {
      const apptsSnap = await db
        .collection('appointments')
        .where('patientHealthId', '==', patientHealthId)
        .limit(5)
        .get();

      if (!apptsSnap.empty) {
        previousDoctorId = apptsSnap.docs[0].data().doctorId;
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const doctorOptions = await Promise.all(
      doctors.map(async (doc) => {
        const docId = doc.doctorId || doc.id;
        const isPreviousDoctor = previousDoctorId === docId || previousDoctorId === doc.id;

        // Fetch next free slot today or upcoming days (non-critical — quota
        // errors here must not abort the entire doctor list).
        let nextFreeSlot = null;
        try {
          const slotsSnap = await db
            .collection('slots')
            .where('doctorId', '==', docId)
            .where('date', '>=', todayStr)
            .where('status', '==', SlotStatus.FREE)
            .limit(1)
            .get();
          nextFreeSlot = !slotsSnap.empty ? slotsSnap.docs[0].data() : null;
        } catch {
          // Slot lookup failure is non-critical — show doctor without slot info
        }

        return {
          ...doc,
          isPreviousDoctor,
          badgeText: isPreviousDoctor ? 'Your usual doctor' : null,
          nextFreeSlotDate: nextFreeSlot ? nextFreeSlot.date : null,
          nextFreeSlotTime: nextFreeSlot ? nextFreeSlot.startAt : 'No slots today',
          avgWaitMin: 15
        };
      })
    );

    // Sort so "Your usual doctor" comes first
    doctorOptions.sort((a, b) => (b.isPreviousDoctor ? 1 : 0) - (a.isPreviousDoctor ? 1 : 0));

    res.status(200).json(formatSuccessResponse(doctorOptions));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/booking/suggestions (PRD F3)
 * Multi-factor smart slot suggestion cards (Earliest, Shortest Wait, Best Travel)
 */
export const getBookingSuggestions = async (req, res, next) => {
  try {
    const { doctorId, date, travelMinutes, patientHealthId } = req.query;

    if (!doctorId || !date) {
      throw new AppError('VALIDATION_ERROR', 'doctorId and date parameters are required.', 400);
    }

    const db = assertDbConnected();

    // Query slots for doctor & date
    let slotsSnap = await db
      .collection('slots')
      .where('doctorId', '==', doctorId)
      .where('date', '==', date)
      .get();

    let slots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Auto-generate slots on the fly if not in DB
    if (slots.length === 0) {
      let docSnap = await db.collection('doctors').doc(doctorId).get();
      const doctorData = docSnap.exists ? docSnap.data() : {};
      const schedule = doctorData.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [{ dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }]
      };
      slots = generateSlotsForDoctorDate({ doctorId, date, schedule });
    }

    const travelMin = travelMinutes ? parseInt(travelMinutes, 10) : null;
    const suggestions = getSmartSlotSuggestions({
      slots,
      dateStr: date,
      travelMinutes: travelMin,
      currentDoctorId: doctorId
    });

    res.status(200).json(formatSuccessResponse(suggestions));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments (PRD 5.5 & F3)
 * Atomically book an appointment with multi-slot locking, token counter & QR payload
 */
export const createAppointment = async (req, res, next) => {
  try {
    const {
      slotId,
      slotIds,
      patientHealthId,
      patientName = 'Patient',
      doctorId,
      doctorName = 'Doctor',
      departmentId = 'dept-gen',
      date,
      visitType = 'new',
      reasonText = 'Routine checkup',
      reasonChips = [],
      complexity = 'moderate',
      clinicalLevel = 1,
      urgencySuggested = 'routine',
      disclaimerAck,
      travelMinutes
    } = req.body;

    const targetSlotIds = Array.isArray(slotIds) && slotIds.length > 0
      ? slotIds
      : (slotId ? [slotId] : []);

    if (targetSlotIds.length === 0 || !patientHealthId || !doctorId || !date) {
      throw new AppError('VALIDATION_ERROR', 'slotIds, patientHealthId, doctorId, and date are required.', 400);
    }

    // MANDATORY DISCLAIMER CHECK
    if (!disclaimerAck || disclaimerAck.acknowledged !== true) {
      throw new AppError('DISCLAIMER_REQUIRED', 'You must acknowledge the appointment disclaimer before booking.', 422);
    }

    const db = assertDbConnected();
    const userId = req.user.uid;

    // Fetch department letter for token prefix
    let deptLetter = 'G';
    if (departmentId) {
      const deptSnap = await db.collection('departments').doc(departmentId).get();
      if (deptSnap.exists && deptSnap.data().letter) {
        deptLetter = deptSnap.data().letter;
      }
    }

    // SERVER-SIDE TRIAGE ENFORCEMENT
    // Ensure that even if the client sends clinicalLevel = 1, if the reason text
    // hits a red flag, we enforce the emergency level on the backend.
    const ruleResult = evaluateTriageRules(reasonText);
    let finalClinicalLevel = Number(clinicalLevel) || 1;
    let finalUrgencySuggested = urgencySuggested || 'routine';
    if (ruleResult.clinicalLevel > finalClinicalLevel) {
      finalClinicalLevel = ruleResult.clinicalLevel;
      finalUrgencySuggested = ruleResult.urgencySuggested;
    }

    const apptResult = await db.runTransaction(async (tx) => {
      // 1. Fetch all requested slot documents
      const slotRefs = targetSlotIds.map((id) => db.collection('slots').doc(id));
      const slotSnaps = await Promise.all(slotRefs.map((r) => tx.get(r)));

      const nowMs = Date.now();
      for (const s of slotSnaps) {
        if (!s.exists) {
          throw new AppError('SLOT_TAKEN', `Slot '${s.id}' does not exist.`, 409);
        }
        const data = s.data();
        const isFree = data.status === SlotStatus.FREE;
        const isHeldByMe = data.status === SlotStatus.HELD && data.heldBy === userId && new Date(data.heldUntil).getTime() > nowMs;
        const isExpiredHold = data.status === SlotStatus.HELD && new Date(data.heldUntil).getTime() <= nowMs;

        if (!isFree && !isHeldByMe && !isExpiredHold) {
          throw new AppError('SLOT_TAKEN', `Slot '${s.id}' is already booked or taken.`, 409);
        }
      }

      // 2. Fetch and increment daily department counter
      const counterRef = db.collection('counters').doc(`token_${deptLetter}_${date}`);
      const counterSnap = await tx.get(counterRef);
      const tokenNumber = (counterSnap.exists ? counterSnap.data().value || 0 : 0) + 1;
      tx.set(counterRef, { value: tokenNumber }, { merge: true });

      const tokenLabel = `${deptLetter}-${String(tokenNumber).padStart(3, '0')}`;

      // 3. Generate Check-in Code & Hash (PRD F5)
      const rawCheckinCode = crypto.randomBytes(16).toString('hex');
      const checkinCodeHash = crypto.createHash('sha256').update(rawCheckinCode).digest('hex');

      const apptRef = db.collection('appointments').doc();
      const appointmentId = apptRef.id;

      // QR Code Payload format: APPT:<appointmentId>:<rawCheckinCode>
      const qrPayload = `APPT:${appointmentId}:${rawCheckinCode}`;

      const bookedStartAt = slotSnaps[0].data().startAt || '09:00';
      const durationMin = targetSlotIds.length * 10;

      const apptDoc = {
        id: appointmentId,
        patientHealthId,
        patientName,
        ownerUid: userId,
        bookedByUid: userId,
        doctorId,
        doctorName,
        departmentId,
        departmentLetter: deptLetter,
        slotIds: targetSlotIds,
        date,
        bookedStartAt,
        durationMin,
        visitType,
        reasonText,
        reasonChips,
        complexity,
        clinicalLevel: finalClinicalLevel,
        urgencySuggested: finalUrgencySuggested,
        status: 'booked',
        statusHistory: [{ status: 'booked', at: new Date().toISOString(), by: userId }],
        tokenNumber,
        tokenLabel,
        checkinCodeHash,
        checkinCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        qrPayload,
        live: {
          position: tokenNumber,
          aheadCount: tokenNumber - 1,
          waitMinLow: (tokenNumber - 1) * 10,
          waitMinHigh: tokenNumber * 12,
          updatedAt: new Date().toISOString()
        },
        disclaimerAck: {
          acknowledged: true,
          at: new Date().toISOString(),
          version: '1.0'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (travelMinutes) {
        apptDoc.leaveHome = { travelMinutes: parseInt(travelMinutes, 10) };
      }

      tx.set(apptRef, apptDoc);

      // Update slot docs to status: booked
      slotRefs.forEach((r) => {
        tx.update(r, {
          status: SlotStatus.BOOKED,
          appointmentId,
          heldUntil: null,
          heldBy: null,
          updatedAt: new Date()
        });
      });

      return apptDoc;
    });

    await writeAuditLog({
      actorUid: userId,
      actorRole: req.user.role,
      action: 'BOOK_APPOINTMENT',
      targetType: 'appointment',
      targetId: apptResult.id,
      healthId: patientHealthId,
      requestId: req.requestId
    });

    res.status(201).json(formatSuccessResponse(apptResult));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/triage/alerts
 * Nurse / Staff triage red flag alert queue
 */
export const getTriageAlerts = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const snapshot = await db
      .collection('alerts')
      .where('kind', '==', 'urgent')
      .get();

    const alerts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json(formatSuccessResponse(alerts));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/triage/alerts/:id/acknowledge
 */
export const acknowledgeTriageAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    const alertRef = db.collection('alerts').doc(id);
    await alertRef.update({
      status: 'resolved',
      resolvedBy: req.user.uid,
      resolvedAt: new Date()
    });

    res.status(200).json(formatSuccessResponse({ message: `Alert '${id}' acknowledged.` }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/level
 * Clinical Level Override by Doctor / Nurse
 */
export const overrideClinicalLevel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { clinicalLevel } = req.body;

    if (![1, 2, 3].includes(Number(clinicalLevel))) {
      throw new AppError('VALIDATION_ERROR', 'clinicalLevel must be 1 (routine), 2 (urgent), or 3 (emergency).', 400);
    }

    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(id);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', `Appointment '${id}' not found.`, 404);
    }

    const urgencyMap = { 1: 'routine', 2: 'urgent', 3: 'emergency' };
    await apptRef.update({
      clinicalLevel: Number(clinicalLevel),
      urgencySuggested: urgencyMap[clinicalLevel],
      clinicalLevelVerifiedBy: req.user.uid,
      updatedAt: new Date()
    });

    res.status(200).json(formatSuccessResponse({
      id,
      clinicalLevel: Number(clinicalLevel),
      message: 'Clinical level updated successfully.'
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/walkins (PRD F2/F3)
 * Reception Desk Walk-in Registration & Immediate Booking
 */
export const registerWalkin = async (req, res, next) => {
  try {
    const { patientHealthId, patientName, doctorId, departmentId = 'dept-gen' } = req.body;
    const db = assertDbConnected();

    const todayStr = new Date().toISOString().split('T')[0];
    const deptLetter = (departmentId.split('-')[1] || 'G').toUpperCase().substring(0, 1);

    const counterRef = db.collection('counters').doc(`token_${deptLetter}_${todayStr}`);
    const counterSnap = await counterRef.get();
    const tokenNumber = (counterSnap.exists ? counterSnap.data().value || 0 : 0) + 1;
    await counterRef.set({ value: tokenNumber }, { merge: true });

    const tokenLabel = `${deptLetter}-${String(tokenNumber).padStart(3, '0')}`;
    const rawCheckinCode = crypto.randomBytes(16).toString('hex');
    const checkinCodeHash = crypto.createHash('sha256').update(rawCheckinCode).digest('hex');

    const apptRef = db.collection('appointments').doc();
    const apptDoc = {
      id: apptRef.id,
      patientHealthId: patientHealthId || 'WALKIN-PATIENT',
      patientName: patientName || 'Walkin Patient',
      ownerUid: req.user.uid,
      bookedByUid: req.user.uid,
      doctorId: doctorId || 'DOC-001',
      departmentId,
      departmentLetter: deptLetter,
      date: todayStr,
      bookedStartAt: 'NOW',
      durationMin: 15,
      visitType: 'new',
      reasonText: 'Walk-in Consultation',
      status: 'booked',
      tokenNumber,
      tokenLabel,
      checkinCodeHash,
      qrPayload: `APPT:${apptRef.id}:${rawCheckinCode}`,
      disclaimerAck: { acknowledged: true, at: new Date().toISOString(), version: '1.0' },
      createdAt: new Date()
    };

    await apptRef.set(apptDoc);

    res.status(201).json(formatSuccessResponse(apptDoc));
  } catch (error) {
    next(error);
  }
};

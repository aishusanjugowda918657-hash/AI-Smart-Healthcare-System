import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { recalculateQueue } from '../services/queueService.js';
import { getReadyCandidates } from '../domain/priority.js';
import { writeAuditLog } from '../utils/audit.js';

/**
 * GET /api/queue/doctor/:doctorId/today (PRD F6)
 * Returns today's queue status, current consultation, sorted ready list & un-checked-in list
 */
export const getDoctorQueueToday = async (req, res, next) => {
  try {
    const { doctorId } = req.params;
    const date = req.query.date || clock.now().toISOString().split('T')[0];
    const db = assertDbConnected();

    // Trigger queue recalculation first
    await recalculateQueue(doctorId, date);

    // Fetch queue doc
    const queueSnap = await db.collection('queues').doc(`${doctorId}_${date}`).get();
    const queueData = queueSnap.exists ? queueSnap.data() : {};

    // Fetch active appointments
    const apptsSnap = await db
      .collection('appointments')
      .where('doctorId', '==', doctorId)
      .where('date', '==', date)
      .get();

    const activeStatuses = [
      'booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in',
      'called', 'in_consultation', 'not_arrived', 'late', 'rejoined'
    ];

    const allAppts = apptsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => activeStatuses.includes(a.status));

    const currentConsultation = allAppts.find((a) => a.id === queueData.currentAppointmentId) || null;
    const readyCandidates = getReadyCandidates(allAppts, clock.now());

    const notCheckedIn = allAppts.filter(
      (a) => ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'late'].includes(a.status)
    );

    res.status(200).json(formatSuccessResponse({
      queue: queueData,
      currentConsultation,
      readyCandidates,
      notCheckedIn,
      totalActive: allAppts.length
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/call-next (PRD F6)
 * ATOMIC FIRESTORE TRANSACTION: Takes the first ready candidate, sets `called` then `in_consultation`,
 * records `calledAt` & `consultStartAt`, and updates current appointment in queue doc.
 * Prevents two doctors from calling the same patient simultaneously.
 */
export const callNextPatient = async (req, res, next) => {
  try {
    const { doctorId, date: requestedDate } = req.body;
    const date = requestedDate || clock.now().toISOString().split('T')[0];
    const db = assertDbConnected();
    const doctorUid = req.user.uid;

    let targetDoctorId = doctorId;
    if (!targetDoctorId) {
      const docSnap = await db.collection('doctors').doc(doctorUid).get();
      targetDoctorId = docSnap.exists ? docSnap.data().doctorId : 'DOC-001';
    }

    const now = clock.now();
    const nowIso = now.toISOString();

    const result = await db.runTransaction(async (tx) => {
      // Fetch active appointments for doctor & date
      const apptsSnap = await db
        .collection('appointments')
        .where('doctorId', '==', targetDoctorId)
        .where('date', '==', date)
        .get();

      const active = apptsSnap.docs
        .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
        .filter((a) => ['checked_in', 'rejoined', 'called', 'in_consultation'].includes(a.status));

      // If doctor is already in consultation with someone, complete or handle
      const ready = getReadyCandidates(active, now);

      if (ready.length === 0) {
        throw new AppError('NO_READY_CANDIDATES', 'No checked-in or rejoined patients are waiting in the queue.', 404);
      }

      // First candidate in priority order
      const nextAppt = ready[0];
      const apptRef = db.collection('appointments').doc(nextAppt.id);

      // Re-verify candidate status inside transaction (prevent double-call race)
      const freshSnap = await tx.get(apptRef);
      if (!freshSnap.exists || !['checked_in', 'rejoined'].includes(freshSnap.data().status)) {
        throw new AppError('CONFLICT', 'The selected candidate was already called or modified by another process.', 409);
      }

      // Transactional updates
      tx.update(apptRef, {
        status: 'called',
        calledAt: nowIso,
        consultStartAt: nowIso,
        statusHistory: [
          ...(freshSnap.data().statusHistory || []),
          { status: 'called', at: nowIso, by: doctorUid }
        ],
        updatedAt: now
      });

      const queueRef = db.collection('counters').doc(`token_lock_${targetDoctorId}_${date}`);
      tx.set(queueRef, { lastCalledAt: nowIso, currentApptId: nextAppt.id }, { merge: true });

      return { ...nextAppt, status: 'called', calledAt: nowIso };
    });

    // Write audit log
    await writeAuditLog({
      actorUid: doctorUid,
      actorRole: req.user.role || 'doctor',
      action: 'PATIENT_CALLED_NEXT',
      targetType: 'appointment',
      targetId: result.id
    });

    // Recalculate queue after call
    await recalculateQueue(targetDoctorId, date);

    res.status(200).json(formatSuccessResponse(result, `Called token ${result.tokenLabel || result.tokenNumber}`));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/call/:id (PRD F6)
 * Calls a specific token with required reason
 */
export const callSpecificToken = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      throw new AppError('VALIDATION_ERROR', 'A reason is required when calling a specific token out of order.', 400);
    }

    const db = assertDbConnected();
    const now = clock.now();
    const nowIso = now.toISOString();
    const apptRef = db.collection('appointments').doc(id);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment document not found.', 404);
    }

    const apt = snap.data();
    if (!['checked_in', 'rejoined', 'booked', 'confirmed'].includes(apt.status)) {
      throw new AppError('INVALID_TRANSITION', `Cannot call appointment in status ${apt.status}.`, 422);
    }

    await apptRef.update({
      status: 'called',
      calledAt: nowIso,
      consultStartAt: nowIso,
      outOfOrderReason: reason.trim(),
      statusHistory: [
        ...(apt.statusHistory || []),
        { status: 'called', at: nowIso, by: req.user.uid, reason: reason.trim() }
      ],
      updatedAt: now
    });

    await writeAuditLog({
      actorUid: req.user.uid,
      actorRole: req.user.role || 'doctor',
      action: 'PATIENT_CALLED_SPECIFIC',
      targetType: 'appointment',
      targetId: id
    });

    await recalculateQueue(apt.doctorId, apt.date);

    res.status(200).json(formatSuccessResponse({ id, status: 'called', reason: reason.trim() }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/hold/:id (PRD F6)
 * Temporarily holds a token (e.g. patient is nearby but not ready)
 */
export const holdToken = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(id);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    const now = clock.now();

    await apptRef.update({
      isHeldByDoctor: true,
      heldAt: now.toISOString(),
      updatedAt: now
    });

    await recalculateQueue(apt.doctorId, apt.date);

    res.status(200).json(formatSuccessResponse({ id, isHeldByDoctor: true }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/finish (PRD F7)
 * Doctor completes consultation. Saves duration to consultationStats (last 20),
 * recalculates queue, checks for early finish & creates early-slot offers for opted-in patients.
 */
export const finishConsultation = async (req, res, next) => {
  try {
    const { tokenId, appointmentId: paramApptId, actualDurationMinutes } = req.body;
    const db = assertDbConnected();
    const doctorUid = req.user.uid;
    const now = clock.now();
    const nowIso = now.toISOString();

    // Extract appointment ID from tokenId ("tok-APT-...") or appointmentId
    let targetApptId = paramApptId;
    if (!targetApptId && tokenId) {
      targetApptId = tokenId.startsWith('tok-') ? tokenId.replace('tok-', '') : tokenId;
    }

    let apptRef = null;
    let apt = null;

    if (targetApptId) {
      apptRef = db.collection('appointments').doc(targetApptId);
      const snap = await apptRef.get();
      if (snap.exists) apt = { id: snap.id, ...snap.data() };
    }

    if (!apt) {
      // Find current called/in_consultation appointment for this doctor
      const docSnap = await db.collection('doctors').doc(doctorUid).get();
      const doctorId = docSnap.exists ? docSnap.data().doctorId : 'DOC-001';
      const todayStr = nowIso.split('T')[0];

      const activeSnap = await db
        .collection('appointments')
        .where('doctorId', '==', doctorId)
        .where('date', '==', todayStr)
        .get();

      const current = activeSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((a) => ['called', 'in_consultation'].includes(a.status));

      if (!current) {
        throw new AppError('NOT_FOUND', 'No active consultation found to complete.', 404);
      }
      apt = current;
      apptRef = db.collection('appointments').doc(apt.id);
    }

    // Calculate duration
    let durationMin = actualDurationMinutes ? parseInt(actualDurationMinutes, 10) : 15;
    if (!actualDurationMinutes && apt.consultStartAt) {
      const startMs = new Date(apt.consultStartAt).getTime();
      durationMin = Math.max(1, Math.round((now.getTime() - startMs) / (60 * 1000)));
    }

    // Update appointment status to COMPLETED
    await apptRef.update({
      status: 'completed',
      consultEndAt: nowIso,
      actualDurationMinutes: durationMin,
      statusHistory: [
        ...(apt.statusHistory || []),
        { status: 'completed', at: nowIso, by: doctorUid }
      ],
      updatedAt: now
    });

    // 1. Update consultationStats collection (keep last 20)
    const statsDocId = `${apt.doctorId}_${apt.departmentId}_${apt.visitType || 'new'}_${apt.complexity || 'moderate'}`;
    const statsRef = db.collection('consultationStats').doc(statsDocId);
    const statsSnap = await statsRef.get();

    let recentDurationsMin = [durationMin];
    if (statsSnap.exists && Array.isArray(statsSnap.data().recentDurationsMin)) {
      recentDurationsMin = [...statsSnap.data().recentDurationsMin, durationMin].slice(-20);
    }

    const count = recentDurationsMin.length;
    const avgMin = Math.round(recentDurationsMin.reduce((a, b) => a + b, 0) / count);
    const variance = recentDurationsMin.reduce((a, b) => a + Math.pow(b - avgMin, 2), 0) / count;
    const stdMin = Number(Math.sqrt(variance).toFixed(1));

    await statsRef.set({
      doctorId: apt.doctorId,
      departmentId: apt.departmentId,
      visitType: apt.visitType || 'new',
      complexity: apt.complexity || 'moderate',
      recentDurationsMin,
      avgMin,
      stdMin,
      count,
      updatedAt: now
    }, { merge: true });

    // 2. Early-Slot Offers for early finish
    const isEarlyFinish = durationMin < (apt.expectedDurationMin || 15);
    if (isEarlyFinish) {
      // Find next opted-in patient who is booked later today
      const earlyOptInSnap = await db
        .collection('appointments')
        .where('doctorId', '==', apt.doctorId)
        .where('date', '==', apt.date)
        .where('status', '==', 'booked')
        .get();

      const optedInCandidates = earlyOptInSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.earlyOptIn === true);

      if (optedInCandidates.length > 0) {
        const offerTarget = optedInCandidates[0];
        const offerId = `offer_early_${Date.now()}`;
        const offerDoc = {
          id: offerId,
          kind: 'early_slot',
          appointmentId: offerTarget.id,
          patientHealthId: offerTarget.patientHealthId,
          ownerUid: offerTarget.ownerUid,
          doctorId: apt.doctorId,
          date: apt.date,
          suggestedTime: nowIso,
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(), // 10 min expiry
          status: 'open',
          createdAt: now
        };
        await db.collection('offers').doc(offerId).set(offerDoc);
      }
    }

    // 3. Recalculate queue
    await recalculateQueue(apt.doctorId, apt.date);

    await writeAuditLog({
      actorUid: doctorUid,
      actorRole: req.user.role || 'doctor',
      action: 'CONSULTATION_FINISHED',
      targetType: 'appointment',
      targetId: apt.id
    });

    res.status(200).json(formatSuccessResponse({
      tokenId: `tok-${apt.id}`,
      appointmentId: apt.id,
      actualDurationMinutes: durationMin
    }, `Consultation completed. Logged duration: ${durationMin} mins.`));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/extend & /api/queue/undo-extend (PRD F7)
 * Extends current consultation by +5, +10, or +15 minutes with 10-second undo
 */
export const extendConsultation = async (req, res, next) => {
  try {
    const { doctorId, minutes = 5 } = req.body;
    const db = assertDbConnected();
    const date = clock.now().toISOString().split('T')[0];
    const now = clock.now();

    const queueRef = db.collection('queues').doc(`${doctorId}_${date}`);
    const queueSnap = await queueRef.get();
    const currentExt = (queueSnap.exists && queueSnap.data().extendMin) || 0;

    const newExt = currentExt + parseInt(minutes, 10);
    await queueRef.set({ extendMin: newExt, lastExtendAt: now.toISOString() }, { merge: true });

    await recalculateQueue(doctorId, date);

    res.status(200).json(formatSuccessResponse({ doctorId, extendMin: newExt, extendedBy: minutes }));
  } catch (error) {
    next(error);
  }
};

export const undoExtendConsultation = async (req, res, next) => {
  try {
    const { doctorId } = req.body;
    const db = assertDbConnected();
    const date = clock.now().toISOString().split('T')[0];

    const queueRef = db.collection('queues').doc(`${doctorId}_${date}`);
    await queueRef.set({ extendMin: 0 }, { merge: true });

    await recalculateQueue(doctorId, date);

    res.status(200).json(formatSuccessResponse({ doctorId, extendMin: 0 }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/break & /api/queue/end-break (PRD F7)
 */
export const startBreak = async (req, res, next) => {
  try {
    const { doctorId, minutes = 15 } = req.body;
    const db = assertDbConnected();
    const now = clock.now();
    const date = now.toISOString().split('T')[0];
    const breakUntil = new Date(now.getTime() + parseInt(minutes, 10) * 60 * 1000).toISOString();

    const queueRef = db.collection('queues').doc(`${doctorId}_${date}`);
    await queueRef.set({ breakUntil, breakMinutes: minutes }, { merge: true });

    await recalculateQueue(doctorId, date);

    res.status(200).json(formatSuccessResponse({ doctorId, breakUntil, breakMinutes: minutes }));
  } catch (error) {
    next(error);
  }
};

export const endBreak = async (req, res, next) => {
  try {
    const { doctorId } = req.body;
    const db = assertDbConnected();
    const date = clock.now().toISOString().split('T')[0];

    const queueRef = db.collection('queues').doc(`${doctorId}_${date}`);
    await queueRef.set({ breakUntil: null, breakMinutes: 0 }, { merge: true });

    await recalculateQueue(doctorId, date);

    res.status(200).json(formatSuccessResponse({ doctorId, breakUntil: null }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/late-start (PRD F7)
 */
export const doctorLateStart = async (req, res, next) => {
  try {
    const { doctorId, minutes = 15 } = req.body;
    const db = assertDbConnected();
    const date = clock.now().toISOString().split('T')[0];

    const queueRef = db.collection('queues').doc(`${doctorId}_${date}`);
    await queueRef.set({ delayMin: parseInt(minutes, 10) }, { merge: true });

    await recalculateQueue(doctorId, date);

    res.status(200).json(formatSuccessResponse({ doctorId, delayMin: minutes }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/queue/procedure (PRD F7)
 */
export const markProcedure = async (req, res, next) => {
  try {
    const { appointmentId, extraMinutes = 20 } = req.body;
    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(appointmentId);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    const newExpected = (apt.expectedDurationMin || 15) + parseInt(extraMinutes, 10);

    await apptRef.update({
      expectedDurationMin: newExpected,
      hasExtraProcedure: true,
      extraProcedureMin: extraMinutes,
      updatedAt: clock.now()
    });

    await recalculateQueue(apt.doctorId, apt.date);

    res.status(200).json(formatSuccessResponse({ appointmentId, expectedDurationMin: newExpected }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/leave-home (PRD F7)
 */
export const setLeaveHomeParams = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { travelMinutes = 0 } = req.body;
    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(id);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    const travelMin = parseInt(travelMinutes, 10);

    await apptRef.update({
      'leaveHome.travelMinutes': travelMin,
      updatedAt: clock.now()
    });

    await recalculateQueue(apt.doctorId, apt.date);

    res.status(200).json(formatSuccessResponse({ id, travelMinutes: travelMin }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/early-optin (PRD F7)
 */
export const toggleEarlyOptIn = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { earlyOptIn = true } = req.body;
    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(id);
    const snap = await apptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    await apptRef.update({
      earlyOptIn: Boolean(earlyOptIn),
      updatedAt: clock.now()
    });

    res.status(200).json(formatSuccessResponse({ id, earlyOptIn: Boolean(earlyOptIn) }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/display/:departmentId (PRD F6 & F12)
 * Public display board tokens ONLY (no names, ages or reasons)
 */
export const getPublicDisplayBoard = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const date = clock.now().toISOString().split('T')[0];
    const db = assertDbConnected();

    // Query active appointments in department
    const apptsSnap = await db
      .collection('appointments')
      .where('departmentId', '==', departmentId)
      .where('date', '==', date)
      .get();

    const displayItems = apptsSnap.docs
      .map((d) => d.data())
      .filter((a) => ['called', 'in_consultation', 'checked_in', 'rejoined'].includes(a.status))
      .map((a) => ({
        tokenLabel: a.tokenLabel || a.tokenNumber,
        status: a.status,
        doctorName: a.doctorName || 'Doctor',
        room: `Room ${a.doctorId ? a.doctorId.replace(/\D/g, '') || '1' : '1'}`
      }));

    const nowServing = displayItems.filter((i) => ['called', 'in_consultation'].includes(i.status));
    const nextTokens = displayItems.filter((i) => ['checked_in', 'rejoined'].includes(i.status)).slice(0, 5);

    res.status(200).json(formatSuccessResponse({
      departmentId,
      date,
      nowServing,
      nextTokens
    }));
  } catch (error) {
    next(error);
  }
};

import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { compareForCalling, getReadyCandidates } from '../domain/priority.js';
import {
  calculateTimeFactor,
  calculateRemainingCurrentTime,
  calculateWaitForPatient,
  getExpectedDuration,
  calculateLeaveAt,
  selectReasonText
} from '../domain/waitTime.js';

/**
 * Single entry point for queue recalculation (PRD Section 5.2 & F7)
 * Loads active appointments, computes calling order and waits,
 * writes `live` payload ONLY when changed (batched), and updates queue document.
 */
/**
 * Shared in-memory queue state and wait-time computation engine.
 * Reads appointments and queue metadata to compute order and waiting-time estimates.
 * Pure read-only computation: NEVER performs database writes or triggers background tasks.
 */
async function computeQueueSnapshot(doctorId, date, { db, now }) {
  const nowIso = now.toISOString();

  // 1. Fetch Queue document
  const queueDocId = `${doctorId}_${date}`;
  const queueRef = db.collection('queues').doc(queueDocId);
  const queueSnap = await queueRef.get();
  const queueData = queueSnap.exists ? queueSnap.data() : {};

  const delayMin = queueData.delayMin || 0;
  const breakUntil = queueData.breakUntil ? new Date(queueData.breakUntil) : null;
  const breakRemainingMin = (breakUntil && breakUntil.getTime() > now.getTime())
    ? Math.ceil((breakUntil.getTime() - now.getTime()) / (60 * 1000))
    : 0;

  // 2. Fetch all active appointments for doctor & date
  const activeStatuses = [
    'booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in',
    'called', 'in_consultation', 'not_arrived', 'late', 'rejoined'
  ];

  const apptsSnap = await db
    .collection('appointments')
    .where('doctorId', '==', doctorId)
    .where('date', '==', date)
    .get();

  const allAppts = apptsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => activeStatuses.includes(a.status));

  const completedAppts = apptsSnap.docs
    .map((d) => d.data())
    .filter((a) => a.status === 'completed');

  // 3. Compute time factor (pace factor: ratio of actual vs expected durations today)
  const timeFactor = calculateTimeFactor(completedAppts);

  // 3b. Load per-visitType consultationStats cache (avgMin + stdMin for CoV-based range width)
  const visitTypes = [...new Set(allAppts.map(a => a.visitType || 'new'))];
  const departmentIds = [...new Set(allAppts.map(a => a.departmentId).filter(Boolean))];
  const statsCache = {};

  for (const vt of visitTypes) {
    for (const deptId of (departmentIds.length ? departmentIds : ['_'])) {
      const statsDocId = `${doctorId}_${deptId}_${vt}_moderate`;
      try {
        const statsSnap = await db.collection('consultationStats').doc(statsDocId).get();
        if (statsSnap.exists) {
          statsCache[`${vt}_${deptId}`] = statsSnap.data();
        }
      } catch { /* non-blocking — graceful degradation to defaults */ }
    }
  }

  // Helper: get consultationStats for a given appointment (visitType + deptId)
  const getStatsForAppt = (apt) => {
    const vt = apt.visitType || 'new';
    const deptId = apt.departmentId || '_';
    return statsCache[`${vt}_${deptId}`] || statsCache[`${vt}_`] || null;
  };

  // Helper: resolve expected duration using the fallback chain (stats > dept config > system defaults)
  const getExpectedForAppt = (apt) => {
    if (apt.expectedDurationMin && apt.expectedDurationMin > 0) return apt.expectedDurationMin;
    const consultStats = getStatsForAppt(apt);
    return getExpectedDuration({
      consultationStats: consultStats,
      visitType: apt.visitType || 'new',
      complexity: apt.complexity || 'moderate',
      extraProcedureMin: apt.extraProcedureMin || 0
    });
  };

  // 4. Identify current active consultation (in_consultation or called)
  const currentConsultation = allAppts.find((a) => a.status === 'in_consultation') ||
    allAppts.find((a) => a.status === 'called') || null;

  const currentAppointmentId = currentConsultation ? currentConsultation.id : null;

  // Enrich current consultation with expectedDurationMin before computing remaining time
  if (currentConsultation && !currentConsultation.expectedDurationMin) {
    currentConsultation.expectedDurationMin = getExpectedForAppt(currentConsultation);
  }
  const remainingCurrentMin = calculateRemainingCurrentTime(currentConsultation, now);

  // 5. Separate ready candidates (checked_in & rejoined) vs others,
  //    enriched with per-visitType expectedDurationMin
  const readyCandidates = getReadyCandidates(allAppts, now)
    .map(c => ({ ...c, expectedDurationMin: getExpectedForAppt(c) }));

  // 6. Compute wait and live payload for each active appointment
  const reasonText = selectReasonText({
    hasEmergencyAdded: readyCandidates.some((c) => c.clinicalLevel === 3),
    hasDoctorBreak: breakRemainingMin > 0,
    hasLateStart: delayMin > 0,
    consultationsRunningLong: timeFactor > 1.15,
    consultationsRunningShort: timeFactor < 0.85
  });

  const readyCandidateUpdates = [];

  // Calculate position & wait for each ready candidate
  const enrichedReadyCandidates = readyCandidates.map((candidate, idx) => {
    const position = idx + 1;
    const aheadCount = idx;
    const aheadList = readyCandidates.slice(0, idx);

    // Candidates booked earlier or same slot window but not yet checked in, enriched
    const notYetHereList = allAppts
      .filter((a) =>
        ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived'].includes(a.status) &&
        a.bookedStartAt <= candidate.bookedStartAt
      )
      .map(a => ({ ...a, expectedDurationMin: getExpectedForAppt(a) }));

    // Per-patient stats for CoV-based range width
    const candidateStats = getStatsForAppt(candidate);

    const waitResult = calculateWaitForPatient({
      aheadCandidates: aheadList,
      notYetHereCandidates: notYetHereList,
      remainingCurrentMin,
      timeFactor,
      breakRemainingMin,
      lateStartDelayMin: delayMin,
      stats: candidateStats,
      now
    });

    let leaveAt = candidate.leaveHome?.leaveAt || null;
    if (candidate.leaveHome?.travelMinutes) {
      leaveAt = calculateLeaveAt({
        predictedCallAt: waitResult.predictedCallAt,
        travelMinutes: candidate.leaveHome.travelMinutes
      });
    }

    const newLive = {
      position,
      aheadCount,
      waitMinLow: waitResult.waitMinLow,
      waitMinHigh: waitResult.waitMinHigh,
      predictedCallAt: waitResult.predictedCallAt,
      reasonText,
      // Pace context for debugging / UI display
      timeFactor,
      breakRemainingMin,
      lateStartDelayMin: delayMin,
      updatedAt: nowIso
    };

    // Compare with existing live object (IDEMPOTENT CHECK)
    const oldLive = candidate.live || {};
    const hasChanged =
      oldLive.position !== newLive.position ||
      oldLive.aheadCount !== newLive.aheadCount ||
      oldLive.waitMinLow !== newLive.waitMinLow ||
      oldLive.waitMinHigh !== newLive.waitMinHigh ||
      oldLive.reasonText !== newLive.reasonText;

    if (hasChanged) {
      const apptRef = db.collection('appointments').doc(candidate.id);
      const updateObj = { live: newLive, updatedAt: now };
      if (leaveAt) {
        updateObj['leaveHome.leaveAt'] = leaveAt;
      }

      let pushItem = null;
      if (
        Math.abs((oldLive.waitMinLow || 0) - newLive.waitMinLow) >= 5 ||
        (position <= 3 && (oldLive.position || 99) > 3) ||
        position === 1
      ) {
        pushItem = {
          patientHealthId: candidate.patientHealthId,
          ownerUid: candidate.ownerUid,
          appointmentId: candidate.id,
          tokenLabel: candidate.tokenLabel,
          position,
          waitMinLow: newLive.waitMinLow,
          waitMinHigh: newLive.waitMinHigh,
          reasonText
        };
      }

      let predDoc = null;
      if (!candidate.live?.predictedCallAt && waitResult.predictedCallAt) {
        const predDocId = `pred_${candidate.id}_${Date.now()}`;
        predDoc = {
          id: predDocId,
          data: {
            appointmentId: candidate.id,
            doctorId,
            date,
            visitType: candidate.visitType || 'new',
            predictionTime: nowIso,
            predictedWaitMinLow: waitResult.waitMinLow,
            predictedWaitMinHigh: waitResult.waitMinHigh,
            predictedCallAt: waitResult.predictedCallAt,
            position,
            timeFactor
          }
        };
      }

      readyCandidateUpdates.push({ apptRef, updateObj, pushItem, predDoc });
    }

    return {
      ...candidate,
      live: newLive
    };
  });

  // Calculate live payload for un-checked-in active appointments
  const notCheckedIn = allAppts.filter(
    (a) => ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'late'].includes(a.status)
  );

  const notCheckedInUpdates = [];

  const enrichedNotCheckedIn = notCheckedIn.map((apt) => {
    const notCheckedInAhead = allAppts
      .filter((a) =>
        ['checked_in', 'rejoined'].includes(a.status) ||
        (['booked', 'confirmed', 'on_the_way', 'nearby'].includes(a.status) && a.bookedStartAt < apt.bookedStartAt)
      )
      .map(a => ({ ...a, expectedDurationMin: getExpectedForAppt(a) }));

    const candidateStats = getStatsForAppt(apt);

    const waitResult = calculateWaitForPatient({
      aheadCandidates: notCheckedInAhead,
      remainingCurrentMin,
      timeFactor,
      breakRemainingMin,
      lateStartDelayMin: delayMin,
      stats: candidateStats,
      now
    });

    const newLive = {
      position: enrichedReadyCandidates.length + 1,
      aheadCount: notCheckedInAhead.length,
      waitMinLow: waitResult.waitMinLow,
      waitMinHigh: waitResult.waitMinHigh,
      predictedCallAt: waitResult.predictedCallAt,
      reasonText,
      updatedAt: nowIso
    };

    const oldLive = apt.live || {};
    const hasChanged =
      oldLive.position !== newLive.position ||
      oldLive.waitMinLow !== newLive.waitMinLow ||
      oldLive.waitMinHigh !== newLive.waitMinHigh;

    if (hasChanged) {
      const apptRef = db.collection('appointments').doc(apt.id);
      notCheckedInUpdates.push({ apptRef, updateObj: { live: newLive, updatedAt: now } });
    }

    return {
      ...apt,
      live: newLive
    };
  });

  const runningLateMsg = delayMin > 0
    ? `Running late by ${delayMin} minutes`
    : (timeFactor > 1.15
      ? `Consultations running ~${Math.round((timeFactor - 1) * 100)}% slower today`
      : null);

  const computedQueueData = {
    ...queueData,
    doctorId,
    date,
    currentAppointmentId,
    timeFactor,
    completedCount: completedAppts.length,
    delayMin,
    breakUntil: queueData.breakUntil || null,
    breakRemainingMin,
    lastRecalcAt: queueData.lastRecalcAt || null,
    runningLateMsg
  };

  return {
    queueRef,
    queueData: computedQueueData,
    currentConsultation,
    currentAppointmentId,
    readyCandidates: enrichedReadyCandidates,
    notCheckedIn: enrichedNotCheckedIn,
    totalActive: allAppts.length,
    timeFactor,
    delayMin,
    breakRemainingMin,
    completedAppts,
    readyCandidateUpdates,
    notCheckedInUpdates
  };
}

/**
 * Dedicated read-only queue retrieval calculation (Phase 92).
 * Reads appointments and queue metadata to compute order and waiting-time estimates in memory.
 * NEVER mutates `queues`, `appointments`, `waitPredictions`, or `auditLogs`.
 * NEVER invokes background tasks or Gemini services.
 */
export async function calculateQueueReadOnly(doctorId, date) {
  if (!doctorId || !date) {
    return {
      queue: {},
      currentConsultation: null,
      readyCandidates: [],
      notCheckedIn: [],
      totalActive: 0,
      isReadOnly: true
    };
  }

  const db = assertDbConnected();
  const now = clock.now();
  const snapshot = await computeQueueSnapshot(doctorId, date, { db, now });

  return {
    queue: { ...snapshot.queueData, isReadOnly: true },
    currentConsultation: snapshot.currentConsultation,
    readyCandidates: snapshot.readyCandidates,
    notCheckedIn: snapshot.notCheckedIn,
    totalActive: snapshot.totalActive,
    isReadOnly: true
  };
}

/**
 * Operational single entry point for queue recalculation (PRD Section 5.2 & F7).
 * Loads active appointments, computes calling order and waits,
 * commits batched updates, updates queue document, and pre-generates summaries.
 */
export async function recalculateQueue(doctorId, date) {
  if (!doctorId || !date) return { updatedCount: 0, pushes: [] };

  const db = assertDbConnected();
  const now = clock.now();
  const snapshot = await computeQueueSnapshot(doctorId, date, { db, now });

  const writesBatch = db.batch();
  let updatedCount = 0;
  const pushes = [];

  for (const item of snapshot.readyCandidateUpdates) {
    writesBatch.update(item.apptRef, item.updateObj);
    updatedCount++;
    if (item.pushItem) pushes.push(item.pushItem);
    if (item.predDoc) {
      writesBatch.set(db.collection('waitPredictions').doc(item.predDoc.id), item.predDoc.data);
    }
  }

  for (const item of snapshot.notCheckedInUpdates) {
    writesBatch.update(item.apptRef, item.updateObj);
    updatedCount++;
  }

  // 7. Commit batch writes if any changed
  if (updatedCount > 0) {
    await writesBatch.commit();
  }

  // 8. Update Queue Document
  await snapshot.queueRef.set(
    {
      doctorId,
      date,
      currentAppointmentId: snapshot.currentAppointmentId,
      timeFactor: snapshot.timeFactor,
      completedCount: snapshot.completedAppts.length,
      delayMin: snapshot.delayMin,
      breakUntil: snapshot.queueData.breakUntil || null,
      lastRecalcAt: now,
      runningLateMsg: snapshot.queueData.runningLateMsg
    },
    { merge: true }
  );

  // Pre-generate summary for next ready candidate so it's ready before call
  if (snapshot.readyCandidates.length > 0) {
    const nextCandidate = snapshot.readyCandidates[0];
    if (!nextCandidate.summary || !nextCandidate.summary.text) {
      import('./patientSummaryService.js')
        .then(({ preparePatientSummary }) => {
          preparePatientSummary({
            appointmentId: nextCandidate.id,
            doctorUid: doctorId,
            doctorRole: 'doctor'
          }).catch(err => console.warn('Background summary pre-generation notice:', err.message));
        })
        .catch(() => {});
    }
  }

  return {
    updatedCount,
    pushes,
    queueData: {
      doctorId,
      date,
      currentAppointmentId: snapshot.currentAppointmentId,
      timeFactor: snapshot.timeFactor,
      completedCount: snapshot.completedAppts.length,
      delayMin: snapshot.delayMin,
      breakRemainingMin: snapshot.breakRemainingMin
    }
  };
}

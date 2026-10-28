import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { getHospitalTodayStr, parseSlotTimeToDate } from '../utils/timezoneDate.js';
import { compareForCalling, getReadyCandidates } from '../domain/priority.js';
import { notify } from './notify.js';
import {
  calculateTimeFactor,
  calculateRemainingCurrentTime,
  calculateWaitForPatient,
  getExpectedDuration,
  selectReasonText
} from '../domain/waitTime.js';

/**
 * Single entry point for queue recalculation (PRD Section 5.2 & F7)
 * Loads active appointments, computes calling order and waits,
 * writes `live` payload ONLY when changed (batched), and updates queue document.
 */
/**
 * Parses diverse time representations (HH:mm, 12h AM/PM, ISO string, Date object)
 * to total integer minutes from midnight for safe, deterministic sorting.
 */
function parseTimeToMinutes(timeVal) {
  if (!timeVal) return 999999;
  if (typeof timeVal === 'number') return timeVal;
  if (timeVal instanceof Date) return timeVal.getHours() * 60 + timeVal.getMinutes();
  if (timeVal?.toMillis) {
    const d = new Date(timeVal.toMillis());
    return d.getHours() * 60 + d.getMinutes();
  }
  if (typeof timeVal === 'string') {
    const trimmed = timeVal.trim();
    if (trimmed.includes('T')) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        return d.getHours() * 60 + d.getMinutes();
      }
    }
    const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1], 10);
      const m = parseInt(ampmMatch[2], 10);
      const period = ampmMatch[3]?.toUpperCase();
      if (period === 'PM' && h < 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }
    const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }
  }
  return 999999;
}

/**
 * Shared in-memory queue state and wait-time computation engine.
 * Reads appointments and queue metadata to compute order and waiting-time estimates.
 * Pure read-only computation: NEVER performs database writes or triggers background tasks.
 */
export async function computeQueueSnapshot(doctorId, date, { db = assertDbConnected(), now = clock.now() } = {}) {
  const nowIso = now.toISOString();

  // Resolve canonical doctor identifiers
  const candidateDocIds = new Set([doctorId]);
  try {
    const directDocSnap = await db.collection('doctors').doc(doctorId).get();
    if (directDocSnap.exists) {
      const d = directDocSnap.data();
      if (d.doctorId) candidateDocIds.add(d.doctorId);
      if (d.uid) candidateDocIds.add(d.uid);
      if (d.doctorUid) candidateDocIds.add(d.doctorUid);
      if (d.displayId) candidateDocIds.add(d.displayId);
    } else {
      const qSnap = await db.collection('doctors').where('doctorId', '==', doctorId).limit(1).get();
      if (!qSnap.empty) {
        candidateDocIds.add(qSnap.docs[0].id);
        const d = qSnap.docs[0].data();
        if (d.doctorId) candidateDocIds.add(d.doctorId);
        if (d.uid) candidateDocIds.add(d.uid);
        if (d.doctorUid) candidateDocIds.add(d.doctorUid);
        if (d.displayId) candidateDocIds.add(d.displayId);
      } else {
        const qDisp = await db.collection('doctors').where('displayId', '==', doctorId).limit(1).get();
        if (!qDisp.empty) {
          candidateDocIds.add(qDisp.docs[0].id);
          const d = qDisp.docs[0].data();
          if (d.doctorId) candidateDocIds.add(d.doctorId);
          if (d.uid) candidateDocIds.add(d.uid);
          if (d.doctorUid) candidateDocIds.add(d.doctorUid);
        }
      }
    }
  } catch (_) {}

  const docIdList = Array.from(candidateDocIds).filter(Boolean);
  const canonicalDoctorId = docIdList.find((id) => id.startsWith('DOC-')) || doctorId;

  // 1. Fetch Queue document
  const queueDocId = `${canonicalDoctorId}_${date}`;
  const queueRef = db.collection('queues').doc(queueDocId);
  const queueSnap = await queueRef.get();
  const queueData = queueSnap.exists ? queueSnap.data() : {};

  const delayMin = queueData.delayMin || 0;
  const breakUntil = queueData.breakUntil ? new Date(queueData.breakUntil) : null;
  const breakRemainingMin = (breakUntil && breakUntil.getTime() > now.getTime())
    ? Math.ceil((breakUntil.getTime() - now.getTime()) / (60 * 1000))
    : 0;

  // 2. Fetch all active appointments for doctor & date
  const todayIST = getHospitalTodayStr(now);
  const isPastDate = date < todayIST;

  const activeStatuses = [
    'booked', 'confirmed', 'on_the_way', 'nearby', 'checked_in', 'waiting',
    'called', 'in_consultation', 'not_arrived', 'late', 'rejoined'
  ];

  const apptsSnap = await db
    .collection('appointments')
    .where('doctorId', 'in', docIdList.slice(0, 10))
    .where('date', '==', date)
    .get();

  // If date is in the past, uncompleted appointments are not active in today's live queue
  const allAppts = isPastDate
    ? []
    : apptsSnap.docs
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

  // 4. Identify current active consultation in room vs called (waiting for arrival)
  const activeInRoom = allAppts.find((a) => a.status === 'in_consultation' || a.status === 'in_room');
  const calledPatient = allAppts.find((a) => a.status === 'called' && !a.isHeldByDoctor);

  // An absent patient whose turn is held or who is merely waiting for arrival without having entered the room
  // must NOT count as a consultation currently in progress (PRD Section 3).
  const activeConsultationForWait = activeInRoom || null;
  const currentConsultation = activeInRoom || calledPatient || null;
  const currentAppointmentId = activeInRoom ? activeInRoom.id : (calledPatient ? calledPatient.id : null);

  // Enrich active in-room consultation with expectedDurationMin before computing remaining time
  if (activeConsultationForWait && !activeConsultationForWait.expectedDurationMin) {
    activeConsultationForWait.expectedDurationMin = getExpectedForAppt(activeConsultationForWait);
  }
  const remainingCurrentMin = activeConsultationForWait ? calculateRemainingCurrentTime(activeConsultationForWait, now) : 0;

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

  // Active in-room consultation live payload synchronization
  if (activeInRoom) {
    const curLive = activeInRoom.live || {};
    if (curLive.reasonText !== 'Consultation in progress' || curLive.waitMinLow !== 0 || curLive.waitMinHigh !== 0 || curLive.aheadCount !== 0) {
      const activeLive = {
        position: 1,
        aheadCount: 0,
        waitMinLow: 0,
        waitMinHigh: 0,
        predictedCallAt: null,
        reasonText: 'Consultation in progress',
        timeFactor,
        updatedAt: nowIso
      };
      readyCandidateUpdates.push({
        apptRef: db.collection('appointments').doc(activeInRoom.id),
        updateObj: { live: activeLive, updatedAt: now }
      });
      activeInRoom.live = activeLive;
    }
  }

  // Called patient live payload synchronization (they are proceeding to room, ahead count must be 0)
  if (calledPatient && !activeInRoom) {
    const curLive = calledPatient.live || {};
    if (curLive.aheadCount !== 0 || curLive.position !== 1) {
      const calledLive = {
        ...curLive,
        position: 1,
        aheadCount: 0,
        waitMinLow: 0,
        waitMinHigh: 0,
        predictedCallAt: null,
        reasonText: 'Turn called - please proceed inside consultation room',
        timeFactor,
        updatedAt: nowIso
      };
      readyCandidateUpdates.push({
        apptRef: db.collection('appointments').doc(calledPatient.id),
        updateObj: { live: calledLive, updatedAt: now }
      });
      calledPatient.live = calledLive;
    }
  }

  // Calculate position & wait for each ready candidate
  const enrichedReadyCandidates = readyCandidates.map((candidate, idx) => {
    const position = idx + 1;
    const aheadCount = idx;
    const aheadList = readyCandidates.slice(0, idx);

    // Candidates booked earlier or same slot window but not yet checked in, enriched.
    // Exclude slots whose grace period has already expired without check-in.
    const notYetHereList = allAppts
      .filter((a) => {
        if (!['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived'].includes(a.status)) return false;
        if (a.bookedStartAt > candidate.bookedStartAt) return false;
        const apptDateObj = parseSlotTimeToDate(date, a.bookedStartAt || a.timeSlot);
        if (apptDateObj && now.getTime() > apptDateObj.getTime() + 5 * 60 * 1000) {
          return false;
        }
        return true;
      })
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

      let pushItem = null;
      const isWaitChange = Math.abs((oldLive.waitMinLow || 0) - newLive.waitMinLow) >= 5;
      const isUpcoming = (position <= 3 && (oldLive.position || 99) > 3) || (position === 1 && oldLive.position !== 1);
      if (isWaitChange || isUpcoming) {
        pushItem = {
          patientHealthId: candidate.patientHealthId,
          patientName: candidate.patientName || 'Patient',
          ownerUid: candidate.ownerUid,
          patientUid: candidate.patientUid || candidate.patientId || candidate.ownerUid,
          appointmentId: candidate.id,
          tokenLabel: candidate.tokenLabel || String(candidate.tokenNumber || ''),
          position,
          waitMinLow: newLive.waitMinLow,
          waitMinHigh: newLive.waitMinHigh,
          reasonText,
          isUpcomingTurn: isUpcoming,
          isWaitTimeChange: isWaitChange
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
  const notCheckedIn = allAppts
    .filter((a) => ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'late'].includes(a.status))
    .sort((a, b) => {
      const minA = parseTimeToMinutes(a.timeSlot || a.bookedStartAt);
      const minB = parseTimeToMinutes(b.timeSlot || b.bookedStartAt);
      if (minA !== minB) return minA - minB;
      const tokA = String(a.tokenNumber ?? a.id ?? '');
      const tokB = String(b.tokenNumber ?? b.id ?? '');
      return tokA.localeCompare(tokB);
    });

  const notCheckedInUpdates = [];

  const enrichedNotCheckedIn = notCheckedIn.map((apt) => {
    const notCheckedInAhead = allAppts
      .filter((a) =>
        ['checked_in', 'waiting', 'rejoined'].includes(a.status) ||
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

  // PRD F6 & F8: Dispatch notifications for upcoming turns and wait-time changes
  for (const push of pushes) {
    const receiverUid = push.patientUid || push.ownerUid;
    if (!receiverUid) continue;

    const patientName = push.patientName || 'Patient';
    if (push.isUpcomingTurn) {
      try {
        await notify({
          uids: [receiverUid],
          title: `${patientName}: Your turn is coming up soon!`,
          body: `Token ${push.tokenLabel}: You are #${push.position} in line. Estimated wait: ${push.waitMinLow}-${push.waitMinHigh} mins. Please head near the clinic room.`,
          privacyBody: `${patientName}: Your turn is coming up soon`,
          type: 'QUEUE_UPCOMING_TURN',
          urgent: true,
          groupKey: `upcoming_${push.appointmentId}_pos${push.position}`,
          data: {
            appointmentId: push.appointmentId,
            position: String(push.position),
            waitMinLow: String(push.waitMinLow),
            waitMinHigh: String(push.waitMinHigh)
          }
        });
      } catch (notifErr) {
        console.warn('Upcoming turn notify warning:', notifErr.message);
      }
    } else if (push.isWaitTimeChange) {
      try {
        await notify({
          uids: [receiverUid],
          title: `${patientName}: Queue wait-time update`,
          body: `Token ${push.tokenLabel}: Estimated wait is now ${push.waitMinLow}-${push.waitMinHigh} mins${push.reasonText ? ` (${push.reasonText})` : ''}.`,
          privacyBody: `${patientName}: Queue wait-time update`,
          type: 'QUEUE_WAIT_TIME_CHANGED',
          groupKey: `wait_${push.appointmentId}`,
          data: {
            appointmentId: push.appointmentId,
            waitMinLow: String(push.waitMinLow),
            waitMinHigh: String(push.waitMinHigh)
          }
        });
      } catch (notifErr) {
        console.warn('Wait time change notify warning:', notifErr.message);
      }
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

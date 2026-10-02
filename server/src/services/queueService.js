import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { compareForCalling, getReadyCandidates } from '../domain/priority.js';
import {
  calculateTimeFactor,
  calculateRemainingCurrentTime,
  calculateWaitForPatient,
  calculateLeaveAt,
  selectReasonText
} from '../domain/waitTime.js';

/**
 * Single entry point for queue recalculation (PRD Section 5.2 & F7)
 * Loads active appointments, computes calling order and waits,
 * writes `live` payload ONLY when changed (batched), and updates queue document.
 */
export async function recalculateQueue(doctorId, date) {
  if (!doctorId || !date) return { updatedCount: 0, pushes: [] };

  const db = assertDbConnected();
  const now = clock.now();
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

  // 3. Compute time factor
  const timeFactor = calculateTimeFactor(completedAppts);

  // 4. Identify current active consultation (in_consultation or called)
  const currentConsultation = allAppts.find((a) => a.status === 'in_consultation') ||
    allAppts.find((a) => a.status === 'called');

  const currentAppointmentId = currentConsultation ? currentConsultation.id : null;
  const remainingCurrentMin = calculateRemainingCurrentTime(currentConsultation, now);

  // 5. Separate ready candidates (checked_in & rejoined) vs others
  const readyCandidates = getReadyCandidates(allAppts, now);

  // 6. Compute wait and live payload for each active appointment
  const writesBatch = db.batch();
  let updatedCount = 0;
  const pushes = [];

  const reasonText = selectReasonText({
    hasEmergencyAdded: readyCandidates.some((c) => c.clinicalLevel === 3),
    hasDoctorBreak: breakRemainingMin > 0,
    hasLateStart: delayMin > 0,
    consultationsRunningLong: timeFactor > 1.15,
    consultationsRunningShort: timeFactor < 0.85
  });

  // Calculate position & wait for each ready candidate
  readyCandidates.forEach((candidate, idx) => {
    const position = idx + 1;
    const aheadCount = idx;
    const aheadList = readyCandidates.slice(0, idx);

    // Candidates booked earlier or same slot window but not yet checked in
    const notYetHereList = allAppts.filter(
      (a) =>
        ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived'].includes(a.status) &&
        a.bookedStartAt <= candidate.bookedStartAt
    );

    const waitResult = calculateWaitForPatient({
      aheadCandidates: aheadList,
      notYetHereCandidates: notYetHereList,
      remainingCurrentMin,
      timeFactor,
      breakRemainingMin,
      lateStartDelayMin: delayMin,
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
      writesBatch.update(apptRef, updateObj);
      updatedCount++;

      // Check push triggers
      if (
        Math.abs((oldLive.waitMinLow || 0) - newLive.waitMinLow) >= 5 ||
        (position <= 3 && (oldLive.position || 99) > 3) ||
        position === 1
      ) {
        pushes.push({
          patientHealthId: candidate.patientHealthId,
          ownerUid: candidate.ownerUid,
          appointmentId: candidate.id,
          tokenLabel: candidate.tokenLabel,
          position,
          waitMinLow: newLive.waitMinLow,
          waitMinHigh: newLive.waitMinHigh,
          reasonText
        });
      }
    }
  });

  // Calculate live payload for un-checked-in active appointments
  const notCheckedIn = allAppts.filter(
    (a) => ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'late'].includes(a.status)
  );

  notCheckedIn.forEach((apt) => {
    const notCheckedInAhead = allAppts.filter(
      (a) =>
        ['checked_in', 'rejoined'].includes(a.status) ||
        (['booked', 'confirmed', 'on_the_way', 'nearby'].includes(a.status) && a.bookedStartAt < apt.bookedStartAt)
    );

    const waitResult = calculateWaitForPatient({
      aheadCandidates: notCheckedInAhead,
      remainingCurrentMin,
      timeFactor,
      breakRemainingMin,
      lateStartDelayMin: delayMin,
      now
    });

    const newLive = {
      position: readyCandidates.length + 1,
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
      writesBatch.update(apptRef, { live: newLive, updatedAt: now });
      updatedCount++;
    }
  });

  // 7. Commit batch writes if any changed
  if (updatedCount > 0) {
    await writesBatch.commit();
  }

  // 8. Update Queue Document
  await queueRef.set(
    {
      doctorId,
      date,
      currentAppointmentId,
      timeFactor,
      completedCount: completedAppts.length,
      delayMin,
      breakUntil: queueData.breakUntil || null,
      lastRecalcAt: now
    },
    { merge: true }
  );

  return {
    updatedCount,
    pushes,
    queueData: {
      doctorId,
      date,
      currentAppointmentId,
      timeFactor,
      completedCount: completedAppts.length
    }
  };
}

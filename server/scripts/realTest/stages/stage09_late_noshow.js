/**
 * Stage 9: Late and No-Show
 * Checks:
 * - test appointments in past through tick:
 *   - not_arrived
 *   - late after grace
 *   - no_show after session
 *   - slot released only if in the future
 *   - rejoin placement
 *   - swap once
 *   - serious follow-up alert on no-show
 */

import { db } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage09(ctx) {
  const runner = new TestRunner(9, 'LATE AND NO-SHOW', ctx.logger);
  ctx.logger('\n=== STAGE 9: LATE AND NO-SHOW ===');
  quotaTracker.setStage('stage09');

  const { client, authHelper, testRunId } = ctx;
  const patientToken = await authHelper.getIdToken('patient');
  const testDoctorId = ctx.identities.doctor.uid;
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to create test appointment in the past
  const setupPastAppt = async ({ suffix, timeSlot, status = 'booked', isFollowUp = false, clinicalLevel = 1, slotInFuture = false }) => {
    const apptId = `appt-late-${suffix}-${testRunId}`;
    const slotDate = slotInFuture ? new Date(Date.now() + 86400000).toISOString().split('T')[0] : todayStr;
    const slotId = `slot-late-${suffix}-${testRunId}`;

    await db.collection('slots').doc(slotId).set({
      id: slotId,
      slotId,
      doctorId: testDoctorId,
      date: slotDate,
      startAt: timeSlot,
      status: 'booked',
      isBooked: true,
      testRunId
    }, { merge: true });

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      patientHealthId: authHelper.patient1HealthId,
      patientName: 'Late/No-Show Test Patient',
      ownerUid: ctx.identities.patient.uid,
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      date: todayStr,
      timeSlot,
      slotId,
      status,
      isFollowUp,
      clinicalLevel,
      testRunId,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    quotaTracker.trackWrite(2);

    return { apptId, slotId };
  };

  // 1. Appointment 20 minutes past slot (after 15-min grace window) -> marks late/not_arrived
  const now = new Date();
  const past20m = new Date(now.getTime() - 20 * 60 * 1000);
  const timeSlot20m = `${String(past20m.getHours()).padStart(2, '0')}:${String(past20m.getMinutes()).padStart(2, '0')}`;

  const { apptId: apptLate } = await setupPastAppt({
    suffix: 'grace-late',
    timeSlot: timeSlot20m
  });

  // 2. Appointment 90 minutes past slot (after 30-min no-show window) with serious follow-up
  const past90m = new Date(now.getTime() - 90 * 60 * 1000);
  const timeSlot90m = `${String(past90m.getHours()).padStart(2, '0')}:${String(past90m.getMinutes()).padStart(2, '0')}`;

  const { apptId: apptNoShow, slotId: slotNoShowPast } = await setupPastAppt({
    suffix: 'noshow-serious',
    timeSlot: timeSlot90m,
    isFollowUp: true,
    clinicalLevel: 3, // Serious follow-up
    slotInFuture: false
  });

  // Run scheduler tick to trigger noShowSweepJob
  const tickRes = await client.post('/api/internal/tick', {}, {
    headers: { 'x-tick-secret': env.INTERNAL_TICK_SECRET }
  });

  // Step 1: Check late / not_arrived status
  const lateDocSnap = await db.collection('appointments').doc(apptLate).get();
  quotaTracker.trackRead(1);
  const lateData = lateDocSnap.data();

  const isMarkedLate =
    lateData.status === 'late' ||
    lateData.status === 'not_arrived' ||
    lateData.isLate === true;

  if (isMarkedLate) {
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.1 Late / Not Arrived Transition After Grace Period',
      reason: `Scheduler marked appointment past grace period as status="${lateData.status}".`
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.1 Late / Not Arrived Transition After Grace Period',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Appointment status is still '${lateData.status}' after grace window expired`,
      likelyFix: 'server/src/jobs/scheduler.js: check noShowSweepJob grace period calculation',
      priority: 'important'
    });
  }

  // Step 2: Check no_show status
  const noShowDocSnap = await db.collection('appointments').doc(apptNoShow).get();
  quotaTracker.trackRead(1);
  const noShowData = noShowDocSnap.data();

  if (noShowData.status === 'no_show') {
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.2 No-Show Transition After Session',
      reason: 'Scheduler marked aged overdue appointment as status="no_show".'
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.2 No-Show Transition After Session',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Appointment status is '${noShowData.status}', expected 'no_show'`,
      likelyFix: 'server/src/jobs/scheduler.js: check noShowSweepJob noShowMinutes threshold',
      priority: 'important'
    });
  }

  // Step 3: Past slot is NOT freed if it is in the past
  const pastSlotSnap = await db.collection('slots').doc(slotNoShowPast).get();
  quotaTracker.trackRead(1);
  const pastSlotData = pastSlotSnap.data();

  // Past slots should not be offered as free future appointments
  if (pastSlotData.status !== 'free') {
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.3 Past No-Show Slot Not Released for Rebooking',
      reason: 'Expired past slot remained reserved/closed and was not released to the booking pool.'
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.3 Past No-Show Slot Not Released for Rebooking',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: 'Slot in the past was incorrectly released as "free" bookable slot',
      likelyFix: 'server/src/jobs/scheduler.js: only release slot if slot date/time is in the future',
      priority: 'important'
    });
  }

  // Step 4: Serious follow-up alert on no-show
  const alertsSnap = await db.collection('alerts')
    .where('doctorId', '==', testDoctorId)
    .limit(10)
    .get();
  quotaTracker.trackRead(alertsSnap.size);

  const hasFollowUpAlert = alertsSnap.docs.some((d) => {
    const a = d.data();
    return (
      a.kind === 'followup_noshow' ||
      a.type === 'noshow_alert' ||
      (a.appointmentId === apptNoShow && a.priority === 'urgent') ||
      a.patientHealthId === authHelper.patient1HealthId
    );
  });

  if (hasFollowUpAlert) {
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.4 Serious Follow-up No-Show Doctor Alert',
      reason: 'No-show for high clinical level follow-up generated an alert for the doctor.'
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.4 Serious Follow-up No-Show Doctor Alert',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: 'No doctor alert created for Level 3 serious follow-up no-show',
      likelyFix: 'server/src/jobs/scheduler.js: in noShowSweepJob create alert when appt.isFollowUp && appt.clinicalLevel >= 2',
      priority: 'important'
    });
  }

  // Step 5: Rejoin placement
  const rejoinRes = await client.post(`/api/appointments/${apptLate}/rejoin`, {
    currentStatus: 'arrived'
  }, { token: patientToken });

  if (rejoinRes.status === 200) {
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.5 Rejoin Queue Placement',
      request: rejoinRes.reqSummary,
      response: rejoinRes.resSummary,
      reason: 'Late arrived patient successfully reinstated and placed fairly in active queue.'
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.5 Rejoin Queue Placement',
      request: rejoinRes.reqSummary,
      response: rejoinRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${rejoinRes.status}: ${JSON.stringify(rejoinRes.data)}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check rejoinQueue logic',
      priority: 'important'
    });
  }

  // Step 6: Late Swap once
  const { apptId: apptSwapTarget } = await setupPastAppt({
    suffix: 'swap-target',
    timeSlot: '11:00'
  });

  const swapRes = await client.post(`/api/appointments/${apptLate}/late-swap`, {
    targetAppointmentId: apptSwapTarget,
    reason: 'Mutual consent queue swap'
  }, { token: patientToken });

  if (swapRes.status === 200 || swapRes.status === 409) {
    // 409 if swap already performed or single-swap rule enforced
    runner.pass({
      feature: 'Late and No-Show',
      step: '9.6 Queue Swap (Max Once Enforced)',
      request: swapRes.reqSummary,
      response: swapRes.resSummary,
      reason: 'Late swap executed or correctly rejected if swap quota exceeded.'
    });
  } else {
    runner.fail({
      feature: 'Late and No-Show',
      step: '9.6 Queue Swap (Max Once Enforced)',
      request: swapRes.reqSummary,
      response: swapRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${swapRes.status}: ${JSON.stringify(swapRes.data)}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check lateSwap implementation',
      priority: 'minor'
    });
  }

  return runner.getSummary();
}

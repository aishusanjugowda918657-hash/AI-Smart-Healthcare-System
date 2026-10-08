/**
 * Stage 8: Cancel
 * Checks:
 * - reason required for cancellation
 * - undo within 10 minutes succeeds
 * - undo after 10 minutes (set undoUntil in past) fails
 * - releaseCancelledSlots via tick frees the slot
 * - reception restore (free slot and taken slot)
 * - reschedule frees old and books new atomically
 */

import { db } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage08(ctx) {
  const runner = new TestRunner(8, 'CANCEL', ctx.logger);
  ctx.logger('\n=== STAGE 8: CANCEL ===');
  quotaTracker.setStage('stage08');

  const { client, authHelper, testRunId } = ctx;
  const patientToken = await authHelper.getIdToken('patient');
  const receptionToken = await authHelper.getIdToken('reception');
  const testDoctorId = ctx.identities.doctor.uid;
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to create test appointment and slot
  const setupApptWithSlot = async (suffix, slotTime = '14:00') => {
    const slotId = `slot-cancel-${suffix}-${testRunId}`;
    const apptId = `appt-cancel-${suffix}-${testRunId}`;

    await db.collection('slots').doc(slotId).set({
      id: slotId,
      slotId,
      doctorId: testDoctorId,
      date: todayStr,
      startAt: slotTime,
      endAt: '14:15',
      status: 'booked',
      isBooked: true,
      testRunId
    }, { merge: true });

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      patientHealthId: authHelper.patient1HealthId,
      ownerUid: ctx.identities.patient.uid,
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      date: todayStr,
      timeSlot: slotTime,
      slotId,
      status: 'booked',
      testRunId,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    quotaTracker.trackWrite(2);

    return { slotId, apptId };
  };

  // Step 1: Cancellation Reason Required
  const { slotId: s1, apptId: a1 } = await setupApptWithSlot('noreason', '14:00');
  const noReasonRes = await client.post(`/api/appointments/${a1}/cancel`, {
    reason: '' // Empty reason
  }, { token: patientToken });

  if (noReasonRes.status === 400 || noReasonRes.status === 422) {
    runner.pass({
      feature: 'Cancel',
      step: '8.1 Cancellation Reason Required',
      request: noReasonRes.reqSummary,
      response: noReasonRes.resSummary,
      reason: 'Cancellation rejected when reason is empty or omitted.'
    });
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.1 Cancellation Reason Required',
      request: noReasonRes.reqSummary,
      response: noReasonRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 400/422 for empty reason, got ${noReasonRes.status}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: require reason field in cancelAppointment',
      priority: 'important'
    });
  }

  // Step 2: Cancel with reason and undo within 10 minutes
  const { slotId: s2, apptId: a2 } = await setupApptWithSlot('undo-ok', '14:15');
  const cancelOkRes = await client.post(`/api/appointments/${a2}/cancel`, {
    reason: 'Personal schedule conflict'
  }, { token: patientToken });

  if (cancelOkRes.status === 200) {
    const undoRes = await client.post(`/api/appointments/${a2}/undo-cancel`, {}, { token: patientToken });
    if (undoRes.status === 200 && (undoRes.data?.data?.status === 'booked' || undoRes.data?.status === 'booked' || undoRes.data?.success)) {
      runner.pass({
        feature: 'Cancel',
        step: '8.2 Undo Cancellation Within 10 Minutes',
        request: undoRes.reqSummary,
        response: undoRes.resSummary,
        reason: 'Successfully reverted cancellation within active 10-minute grace window.'
      });
    } else {
      runner.fail({
        feature: 'Cancel',
        step: '8.2 Undo Cancellation Within 10 Minutes',
        request: undoRes.reqSummary,
        response: undoRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Undo failed. Status ${undoRes.status}: ${JSON.stringify(undoRes.data)}`,
        likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check undoCancelAppointment logic',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.2 Undo Cancellation Within 10 Minutes',
      request: cancelOkRes.reqSummary,
      response: cancelOkRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Cancel failed with status ${cancelOkRes.status}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check cancelAppointment',
      priority: 'blocks the demo'
    });
  }

  // Step 3: Undo after 10 minutes fails (set undoUntil in the past)
  const { slotId: s3, apptId: a3 } = await setupApptWithSlot('undo-exp', '14:30');
  await client.post(`/api/appointments/${a3}/cancel`, { reason: 'Schedule conflict' }, { token: patientToken });

  // Fast-forward undoUntil timestamp to 15 minutes in the past
  const pastTime = new Date(Date.now() - 15 * 60 * 1000);
  await db.collection('appointments').doc(a3).set({
    undoUntil: pastTime,
    updatedAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  const expiredUndoRes = await client.post(`/api/appointments/${a3}/undo-cancel`, {}, { token: patientToken });
  if (expiredUndoRes.status === 400 || expiredUndoRes.status === 409 || expiredUndoRes.data?.error?.code === 'UNDO_WINDOW_EXPIRED') {
    runner.pass({
      feature: 'Cancel',
      step: '8.3 Expired Undo Window Rejection',
      request: expiredUndoRes.reqSummary,
      response: expiredUndoRes.resSummary,
      reason: 'Undo attempt rejected after undoUntil window expired.'
    });
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.3 Expired Undo Window Rejection',
      request: expiredUndoRes.reqSummary,
      response: expiredUndoRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected error for expired undoUntil, got ${expiredUndoRes.status}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: enforce undoUntil expiry check',
      priority: 'important'
    });
  }

  // Step 4: releaseCancelledSlots via tick frees the slot
  // Trigger internal tick job
  const tickRes = await client.post('/api/internal/tick', {}, {
    headers: { 'x-tick-secret': env.INTERNAL_TICK_SECRET }
  });

  const slot3Snap = await db.collection('slots').doc(s3).get();
  quotaTracker.trackRead(1);
  const slot3Data = slot3Snap.data();

  if (slot3Data.status === 'free' || slot3Data.isBooked === false) {
    runner.pass({
      feature: 'Cancel',
      step: '8.4 Release Cancelled Slot via Tick Job',
      reason: 'releaseCancelledSlots job successfully released expired cancelled appointment slot to free status.'
    });
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.4 Release Cancelled Slot via Tick Job',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Slot ${s3} status is still '${slot3Data.status}' after tick job`,
      likelyFix: 'server/src/jobs/scheduler.js: check releaseCancelledSlotsJob criteria for freeing slot',
      priority: 'important'
    });
  }

  // Step 5: Reception Restore (Free slot vs Taken slot)
  const { slotId: s5, apptId: a5 } = await setupApptWithSlot('restore', '15:00');
  await client.post(`/api/appointments/${a5}/cancel`, { reason: 'Patient cancelled' }, { token: patientToken });

  // 5a: Restore when slot is free
  const restoreRes = await client.post(`/api/appointments/${a5}/restore`, {}, { token: receptionToken });
  if (restoreRes.status === 200) {
    runner.pass({
      feature: 'Cancel',
      step: '8.5 Reception Restore on Free Slot',
      request: restoreRes.reqSummary,
      response: restoreRes.resSummary,
      reason: 'Reception desk restored cancelled appointment while slot was available.'
    });
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.5 Reception Restore on Free Slot',
      request: restoreRes.reqSummary,
      response: restoreRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Restore failed: status ${restoreRes.status}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check restoreAppointment',
      priority: 'important'
    });
  }

  // 5b: Restore when slot is taken
  const { slotId: s5b, apptId: a5b } = await setupApptWithSlot('restore-taken', '15:15');
  await client.post(`/api/appointments/${a5b}/cancel`, { reason: 'Cancelled' }, { token: patientToken });
  // Mark slot as booked by someone else
  await db.collection('slots').doc(s5b).set({ status: 'booked', isBooked: true }, { merge: true });
  quotaTracker.trackWrite(1);

  const restoreTakenRes = await client.post(`/api/appointments/${a5b}/restore`, {}, { token: receptionToken });
  if (restoreTakenRes.status === 409 || restoreTakenRes.status === 400 || restoreTakenRes.data?.slotConflict) {
    runner.pass({
      feature: 'Cancel',
      step: '8.6 Reception Restore Slot Conflict Handling',
      request: restoreTakenRes.reqSummary,
      response: restoreTakenRes.resSummary,
      reason: 'Attempting to restore into already-taken slot returned conflict error.'
    });
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.6 Reception Restore Slot Conflict Handling',
      request: restoreTakenRes.reqSummary,
      response: restoreTakenRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 409 slot conflict, got status ${restoreTakenRes.status}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: verify slot is free before restoring',
      priority: 'important'
    });
  }

  // Step 6: Reschedule frees old and books new atomically
  const { slotId: sOld, apptId: aResched } = await setupApptWithSlot('resched-old', '15:30');
  const sNew = `slot-resched-new-${testRunId}`;
  await db.collection('slots').doc(sNew).set({
    id: sNew,
    slotId: sNew,
    doctorId: testDoctorId,
    date: todayStr,
    startAt: '16:00',
    endAt: '16:15',
    status: 'free',
    testRunId
  }, { merge: true });
  quotaTracker.trackWrite(1);

  const reschedRes = await client.post(`/api/appointments/${aResched}/reschedule`, {
    newDate: todayStr,
    newSlotId: sNew,
    newTimeSlot: '16:00',
    reason: 'Doctor suggested later afternoon slot'
  }, { token: patientToken });

  if (reschedRes.status === 200) {
    const [oldSlotSnap, newSlotSnap] = await Promise.all([
      db.collection('slots').doc(sOld).get(),
      db.collection('slots').doc(sNew).get()
    ]);
    quotaTracker.trackRead(2);

    const oldSlotFreed = oldSlotSnap.data()?.status === 'free';
    const newSlotBooked = newSlotSnap.data()?.status === 'booked';

    if (oldSlotFreed && newSlotBooked) {
      runner.pass({
        feature: 'Cancel',
        step: '8.7 Atomic Reschedule Frees Old & Books New Slot',
        reason: 'Atomic reschedule successfully freed previous slot and booked new slot.'
      });
    } else {
      runner.fail({
        feature: 'Cancel',
        step: '8.7 Atomic Reschedule Frees Old & Books New Slot',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `oldSlot status=${oldSlotSnap.data()?.status}, newSlot status=${newSlotSnap.data()?.status}`,
        likelyFix: 'server/src/controllers/appointmentLifecycleController.js: rescheduleAppointment transaction slot swap',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Cancel',
      step: '8.7 Atomic Reschedule Frees Old & Books New Slot',
      request: reschedRes.reqSummary,
      response: reschedRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${reschedRes.status}: ${JSON.stringify(reschedRes.data)}`,
      likelyFix: 'server/src/controllers/appointmentLifecycleController.js: check rescheduleAppointment',
      priority: 'blocks the demo'
    });
  }

  return runner.getSummary();
}

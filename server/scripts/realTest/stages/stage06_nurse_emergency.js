/**
 * Stage 6: Nurse and Emergency
 * Checks:
 * - nurse sees and acknowledges the alert
 * - Confirm Emergency by nurse works
 * - Confirm Emergency by reception returns 403
 * - downgrade works
 * - unacknowledged alert escalates after 2 minutes (make alert timestamp old and run tick)
 */

import { db } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage06(ctx) {
  const runner = new TestRunner(6, 'NURSE AND EMERGENCY', ctx.logger);
  ctx.logger('\n=== STAGE 6: NURSE AND EMERGENCY ===');
  quotaTracker.setStage('stage06');

  const { client, authHelper, testRunId } = ctx;
  const nurseToken = await authHelper.getIdToken('nurse');
  const receptionToken = await authHelper.getIdToken('reception');
  const doctorToken = await authHelper.getIdToken('doctor');
  const testDoctorId = ctx.identities.doctor.uid;

  // Create a test triage alert in Firestore
  const alertId = `alert-triage-${testRunId}`;
  await db.collection('alerts').doc(alertId).set({
    id: alertId,
    alertId,
    kind: 'triage',
    type: 'emergency_triage',
    priority: 'emergency',
    riskLevel: 3,
    status: 'pending',
    acknowledged: false,
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    patientHealthId: authHelper.patient1HealthId,
    patientName: 'Test Emergency Patient',
    symptoms: 'severe chest pain',
    testRunId,
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  // Step 1: Nurse sees and acknowledges the alert
  const listAlertsRes = await client.get('/api/triage/alerts', { token: nurseToken });
  if (listAlertsRes.status === 200) {
    const ackRes = await client.post(`/api/triage/alerts/${alertId}/acknowledge`, {
      notes: 'Nurse Florence acknowledged alert on station'
    }, { token: nurseToken });

    if (ackRes.status === 200) {
      runner.pass({
        feature: 'Nurse and Emergency',
        step: '6.1 Nurse Acknowledges Triage Alert',
        request: ackRes.reqSummary,
        response: ackRes.resSummary,
        reason: 'Nurse successfully retrieved and acknowledged active triage alert.'
      });
    } else {
      runner.fail({
        feature: 'Nurse and Emergency',
        step: '6.1 Nurse Acknowledges Triage Alert',
        request: ackRes.reqSummary,
        response: ackRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${ackRes.status}: ${JSON.stringify(ackRes.data)}`,
        likelyFix: 'server/src/controllers/bookingController.js: check acknowledgeTriageAlert',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Nurse and Emergency',
      step: '6.1 Nurse Acknowledges Triage Alert',
      request: listAlertsRes.reqSummary,
      response: listAlertsRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Nurse unable to list triage alerts, status ${listAlertsRes.status}`,
      likelyFix: 'server/src/controllers/bookingController.js: check getTriageAlerts role permissions',
      priority: 'blocks the demo'
    });
  }

  // Create test appointment for emergency confirmation testing
  const emApptId = `appt-em-${testRunId}`;
  await db.collection('appointments').doc(emApptId).set({
    id: emApptId,
    appointmentId: emApptId,
    patientHealthId: authHelper.patient1HealthId,
    patientName: 'Test Emergency Patient',
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    date: new Date().toISOString().split('T')[0],
    timeSlot: '09:00',
    status: 'booked',
    clinicalLevel: 1,
    testRunId,
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  // Step 2: Confirm Emergency by reception returns 403
  const recConfirmRes = await client.post(`/api/appointments/${emApptId}/level`, {
    clinicalLevel: 3,
    urgencyLevel: 'emergency',
    overrideReason: 'Reception override attempt'
  }, { token: receptionToken });

  if (recConfirmRes.status === 403) {
    runner.pass({
      feature: 'Nurse and Emergency',
      step: '6.2 Reception Emergency Confirmation Refusal (403)',
      request: recConfirmRes.reqSummary,
      response: recConfirmRes.resSummary,
      reason: 'Reception role correctly barred from confirming clinical emergency level (403 Forbidden).'
    });
  } else {
    runner.fail({
      feature: 'Nurse and Emergency',
      step: '6.2 Reception Emergency Confirmation Refusal (403)',
      request: recConfirmRes.reqSummary,
      response: recConfirmRes.resSummary,
      cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
      evidence: `Expected 403 Forbidden for reception role, got ${recConfirmRes.status}`,
      likelyFix: 'server/src/routes/appointment.routes.js: ensure requireRole excludes reception on /:id/level',
      priority: 'blocks the demo'
    });
  }

  // Step 3: Confirm Emergency by nurse works
  const nurseConfirmRes = await client.post(`/api/appointments/${emApptId}/level`, {
    clinicalLevel: 3,
    urgencyLevel: 'emergency',
    overrideReason: 'Nurse verified vital signs are unstable'
  }, { token: nurseToken });

  if (nurseConfirmRes.status === 200) {
    runner.pass({
      feature: 'Nurse and Emergency',
      step: '6.3 Nurse Confirms Emergency (Level 3)',
      request: nurseConfirmRes.reqSummary,
      response: nurseConfirmRes.resSummary,
      reason: 'Nurse successfully escalated patient appointment to clinical emergency (Level 3).'
    });
  } else {
    runner.fail({
      feature: 'Nurse and Emergency',
      step: '6.3 Nurse Confirms Emergency (Level 3)',
      request: nurseConfirmRes.reqSummary,
      response: nurseConfirmRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${nurseConfirmRes.status}: ${JSON.stringify(nurseConfirmRes.data)}`,
      likelyFix: 'server/src/controllers/bookingController.js: check overrideClinicalLevel',
      priority: 'blocks the demo'
    });
  }

  // Step 4: Downgrade works
  const downgradeRes = await client.post(`/api/appointments/${emApptId}/level`, {
    clinicalLevel: 1,
    urgencyLevel: 'routine',
    overrideReason: 'Vitals stabilized after triage assessment'
  }, { token: nurseToken });

  if (downgradeRes.status === 200) {
    runner.pass({
      feature: 'Nurse and Emergency',
      step: '6.4 Downgrade Clinical Level Works',
      request: downgradeRes.reqSummary,
      response: downgradeRes.resSummary,
      reason: 'Staff successfully downgraded emergency level to routine.'
    });
  } else {
    runner.fail({
      feature: 'Nurse and Emergency',
      step: '6.4 Downgrade Clinical Level Works',
      request: downgradeRes.reqSummary,
      response: downgradeRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${downgradeRes.status}: ${JSON.stringify(downgradeRes.data)}`,
      likelyFix: 'server/src/controllers/bookingController.js: check overrideClinicalLevel downgrade support',
      priority: 'important'
    });
  }

  // Step 5: Unacknowledged alert escalates after 2 minutes
  const oldAlertId = `alert-escalate-${testRunId}`;
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
  await db.collection('alerts').doc(oldAlertId).set({
    id: oldAlertId,
    alertId: oldAlertId,
    kind: 'triage',
    priority: 'emergency',
    status: 'pending',
    acknowledged: false,
    escalated: false,
    doctorId: testDoctorId,
    patientName: 'Unack Patient',
    testRunId,
    createdAt: threeMinutesAgo,
    updatedAt: threeMinutesAgo
  }, { merge: true });
  quotaTracker.trackWrite(1);

  // Trigger internal tick job
  const tickRes = await client.post('/api/internal/tick', {}, {
    headers: { 'x-tick-secret': env.INTERNAL_TICK_SECRET }
  });

  const updatedAlertSnap = await db.collection('alerts').doc(oldAlertId).get();
  quotaTracker.trackRead(1);
  const updatedAlert = updatedAlertSnap.data();

  const isEscalated =
    updatedAlert.escalated === true ||
    updatedAlert.status === 'escalated' ||
    tickRes.data?.data?.results?.escalateTriageAlerts?.escalatedCount > 0 ||
    tickRes.data?.results?.escalateTriageAlerts?.escalatedCount > 0;

  if (isEscalated) {
    runner.pass({
      feature: 'Nurse and Emergency',
      step: '6.5 Unacknowledged Alert Escalation (2+ Min Old)',
      request: 'POST /api/internal/tick with aged triage alert',
      response: `Escalated status=${updatedAlert.status}, escalated=${updatedAlert.escalated}`,
      reason: 'Scheduler tick escalated unacknowledged emergency alert older than 2 minutes.'
    });
  } else {
    runner.fail({
      feature: 'Nurse and Emergency',
      step: '6.5 Unacknowledged Alert Escalation (2+ Min Old)',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Alert not escalated. escalated=${updatedAlert.escalated}, status=${updatedAlert.status}`,
      likelyFix: 'server/src/jobs/scheduler.js: check escalateTriageAlertsJob criteria and threshold',
      priority: 'important'
    });
  }

  return runner.getSummary();
}

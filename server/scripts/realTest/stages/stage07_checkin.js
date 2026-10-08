/**
 * Stage 7: Check-in
 * Checks:
 * - QR scan once (200) and twice (409)
 * - wrong date rejected
 * - too early rejected
 * - manual check-in by token label works
 * - manual check-in by Health ID is rejected
 * - roles enforced
 */

import { db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage07(ctx) {
  const runner = new TestRunner(7, 'CHECK-IN', ctx.logger);
  ctx.logger('\n=== STAGE 7: CHECK-IN ===');
  quotaTracker.setStage('stage07');

  const { client, authHelper, testRunId } = ctx;
  const receptionToken = await authHelper.getIdToken('reception');
  const patientToken = await authHelper.getIdToken('patient');
  const testDoctorId = ctx.identities.doctor.uid;
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to create test appointment with QR payload
  const createTestAppt = async ({ id, date, timeSlot = '10:00', tokenLabel = 'G-99' }) => {
    const qrPayload = `HEALTHCARE_CHECKIN:${id}:${todayStr}:${tokenLabel}`;
    await db.collection('appointments').doc(id).set({
      id,
      appointmentId: id,
      patientHealthId: authHelper.patient1HealthId,
      patientName: 'Checkin Patient',
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      date,
      timeSlot,
      status: 'booked',
      tokenLabel,
      tokenNumber: tokenLabel,
      qrPayload,
      checkinToken: qrPayload,
      testRunId,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    quotaTracker.trackWrite(1);
    return { id, qrPayload, tokenLabel };
  };

  // Step 1: QR scan once (200) and twice (409)
  const appt1 = await createTestAppt({
    id: `appt-checkin-1-${testRunId}`,
    date: todayStr,
    tokenLabel: `G-01-${testRunId.slice(-4)}`
  });

  const scan1Res = await client.post('/api/checkin/scan', {
    qrPayload: appt1.qrPayload
  }, { token: receptionToken });

  if (scan1Res.status === 200) {
    runner.pass({
      feature: 'Check-in',
      step: '7.1 QR Scan First Time (200 OK)',
      request: scan1Res.reqSummary,
      response: scan1Res.resSummary,
      reason: 'QR check-in scan succeeded on first attempt.'
    });

    // Scan second time: expect 409 Conflict
    const scan2Res = await client.post('/api/checkin/scan', {
      qrPayload: appt1.qrPayload
    }, { token: receptionToken });

    if (scan2Res.status === 409 || scan2Res.data?.alreadyCheckedIn) {
      runner.pass({
        feature: 'Check-in',
        step: '7.2 Duplicate QR Scan Rejected (409 Conflict)',
        request: scan2Res.reqSummary,
        response: scan2Res.resSummary,
        reason: 'Duplicate QR scan rejected with 409 Conflict.'
      });
    } else {
      runner.fail({
        feature: 'Check-in',
        step: '7.2 Duplicate QR Scan Rejected (409 Conflict)',
        request: scan2Res.reqSummary,
        response: scan2Res.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Expected 409 Conflict on repeat check-in, got ${scan2Res.status}`,
        likelyFix: 'server/src/controllers/checkinController.js: check appointment status and return 409 if already checked_in',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.1 QR Scan First Time (200 OK)',
      request: scan1Res.reqSummary,
      response: scan1Res.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${scan1Res.status}: ${JSON.stringify(scan1Res.data)}`,
      likelyFix: 'server/src/controllers/checkinController.js: check scanCheckIn implementation',
      priority: 'blocks the demo'
    });
    runner.skip({
      feature: 'Check-in',
      step: '7.2 Duplicate QR Scan Rejected',
      reason: 'First scan failed'
    });
  }

  // Step 2: Wrong date rejected
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const apptWrongDate = await createTestAppt({
    id: `appt-checkin-wrongdate-${testRunId}`,
    date: tomorrowStr,
    tokenLabel: `G-02-${testRunId.slice(-4)}`
  });

  const wrongDateRes = await client.post('/api/checkin/scan', {
    qrPayload: apptWrongDate.qrPayload
  }, { token: receptionToken });

  if (wrongDateRes.status === 400 || wrongDateRes.status === 422 || wrongDateRes.status === 409) {
    runner.pass({
      feature: 'Check-in',
      step: '7.3 Wrong Date Check-in Rejected',
      request: wrongDateRes.reqSummary,
      response: wrongDateRes.resSummary,
      reason: 'Check-in for appointment scheduled on another date correctly rejected.'
    });
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.3 Wrong Date Check-in Rejected',
      request: wrongDateRes.reqSummary,
      response: wrongDateRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected error status for appointment on wrong date (${tomorrowStr}), got ${wrongDateRes.status}`,
      likelyFix: 'server/src/controllers/checkinController.js: validate appointment date matches today',
      priority: 'important'
    });
  }

  // Step 3: Too early rejected
  const apptTooEarly = await createTestAppt({
    id: `appt-checkin-tooearly-${testRunId}`,
    date: todayStr,
    timeSlot: '23:45', // Late night slot while checking in now
    tokenLabel: `G-03-${testRunId.slice(-4)}`
  });

  const tooEarlyRes = await client.post('/api/checkin/scan', {
    qrPayload: apptTooEarly.qrPayload
  }, { token: receptionToken });

  // Early check-in window is usually 60-120 minutes before slot
  const isEarlyHandled =
    tooEarlyRes.status === 400 ||
    tooEarlyRes.status === 422 ||
    tooEarlyRes.data?.error?.code === 'TOO_EARLY' ||
    tooEarlyRes.data?.warning?.includes('early');

  if (isEarlyHandled) {
    runner.pass({
      feature: 'Check-in',
      step: '7.4 Too Early Check-in Rejected',
      request: tooEarlyRes.reqSummary,
      response: tooEarlyRes.resSummary,
      reason: 'Check-in earlier than permitted window rejected or returned early warning.'
    });
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.4 Too Early Check-in Rejected',
      request: tooEarlyRes.reqSummary,
      response: tooEarlyRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Check-in permitted for slot far in future (23:45). Status ${tooEarlyRes.status}`,
      likelyFix: 'server/src/controllers/checkinController.js: check check-in time window against slot time',
      priority: 'minor'
    });
  }

  // Step 4: Manual check-in by token label works
  const manualAppt = await createTestAppt({
    id: `appt-checkin-manual-${testRunId}`,
    date: todayStr,
    timeSlot: '10:15',
    tokenLabel: `G-04-${testRunId.slice(-4)}`
  });

  const manualRes = await client.post('/api/checkin/manual', {
    tokenLabel: manualAppt.tokenLabel,
    doctorId: testDoctorId,
    date: todayStr
  }, { token: receptionToken });

  if (manualRes.status === 200) {
    runner.pass({
      feature: 'Check-in',
      step: '7.5 Manual Check-in by Token Label',
      request: manualRes.reqSummary,
      response: manualRes.resSummary,
      reason: 'Manual reception desk check-in using token label succeeded.'
    });
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.5 Manual Check-in by Token Label',
      request: manualRes.reqSummary,
      response: manualRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${manualRes.status}: ${JSON.stringify(manualRes.data)}`,
      likelyFix: 'server/src/controllers/checkinController.js: check manualCheckIn token lookup',
      priority: 'blocks the demo'
    });
  }

  // Step 5: Manual check-in by Health ID is rejected
  const healthIdCheckinRes = await client.post('/api/checkin/manual', {
    healthId: authHelper.patient1HealthId,
    patientHealthId: authHelper.patient1HealthId
    // Omitting required tokenLabel
  }, { token: receptionToken });

  if (healthIdCheckinRes.status === 400 || healthIdCheckinRes.status === 422) {
    runner.pass({
      feature: 'Check-in',
      step: '7.6 Manual Check-in by Health ID Alone Rejected',
      request: healthIdCheckinRes.reqSummary,
      response: healthIdCheckinRes.resSummary,
      reason: 'Check-in requires token label or QR payload, Health ID alone is rejected.'
    });
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.6 Manual Check-in by Health ID Alone Rejected',
      request: healthIdCheckinRes.reqSummary,
      response: healthIdCheckinRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 400 for check-in without tokenLabel, got ${healthIdCheckinRes.status}`,
      likelyFix: 'server/src/controllers/checkinController.js: enforce tokenLabel requirement in manualCheckIn',
      priority: 'minor'
    });
  }

  // Step 6: Roles enforced (Patient cannot execute staff check-in)
  const patientScanRes = await client.post('/api/checkin/scan', {
    qrPayload: appt1.qrPayload
  }, { token: patientToken });

  if (patientScanRes.status === 403) {
    runner.pass({
      feature: 'Check-in',
      step: '7.7 Role Enforcement on Check-in Routes (403 for Patient)',
      request: patientScanRes.reqSummary,
      response: patientScanRes.resSummary,
      reason: 'Patient role forbidden from accessing reception check-in endpoint.'
    });
  } else {
    runner.fail({
      feature: 'Check-in',
      step: '7.7 Role Enforcement on Check-in Routes',
      request: patientScanRes.reqSummary,
      response: patientScanRes.resSummary,
      cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
      evidence: `Expected 403 Forbidden for patient token, got ${patientScanRes.status}`,
      likelyFix: 'server/src/routes/checkin.routes.js: requireRole("reception", "nurse", "admin")',
      priority: 'blocks the demo'
    });
  }

  return runner.getSummary();
}

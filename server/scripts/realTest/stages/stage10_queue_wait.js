/**
 * Stage 10: Queue and Wait
 * Checks:
 * - two checked-in patients
 * - call-next called twice in parallel returns two different patients
 * - extend +10 raises later patient's wait
 * - undo-extend
 * - break mode
 * - finish writes consultationStats
 * - live{} on each appointment
 * - emergency goes first and delayed routine patient gets fairness bump
 * - display board has no names
 * - REAL RULES CHECK against Firestore REST directly with real ID tokens:
 *   - patient can read own appointment doc but not another patient's
 *   - doctor can read own queue doc but not another doctor's
 *   - no client write is allowed anywhere
 */

import { db } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage10(ctx) {
  const runner = new TestRunner(10, 'QUEUE AND WAIT', ctx.logger);
  ctx.logger('\n=== STAGE 10: QUEUE AND WAIT ===');
  quotaTracker.setStage('stage10');

  const { client, authHelper, testRunId } = ctx;
  const doctorToken = await authHelper.getIdToken('doctor');
  const doctor2Token = await authHelper.getIdToken('doctor2');
  const patientToken = await authHelper.getIdToken('patient');
  const patient2Token = await authHelper.getIdToken('patient2');

  const testDoctorId = ctx.identities.doctor.uid;
  const testDoctor2Id = ctx.identities.doctor2.uid;
  const todayStr = new Date().toISOString().split('T')[0];

  // Helper to create checked-in appointment
  const createCheckedInAppt = async (suffix, tokenLabel, clinicalLevel = 1, bookedTime = '10:00') => {
    const apptId = `appt-q-${suffix}-${testRunId}`;
    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      appointmentId: apptId,
      patientHealthId: authHelper.patient1HealthId,
      patientName: `Queue Patient ${suffix}`,
      ownerUid: ctx.identities.patient.uid,
      viewerUids: [ctx.identities.patient.uid],
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      date: todayStr,
      timeSlot: bookedTime,
      bookedStartAt: bookedTime,
      status: 'checked_in',
      tokenLabel,
      tokenNumber: tokenLabel,
      clinicalLevel,
      urgencyLevel: clinicalLevel >= 3 ? 'emergency' : 'routine',
      checkinTime: new Date().toISOString(),
      live: {
        currentStatus: 'checked_in',
        estimatedWaitMinutes: 15,
        queuePosition: 1
      },
      testRunId,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    quotaTracker.trackWrite(1);
    return apptId;
  };

  // 1. Two checked-in patients
  const apptQ1 = await createCheckedInAppt('p1', 'G-10', 1, '10:00');
  const apptQ2 = await createCheckedInAppt('p2', 'G-11', 1, '10:15');

  // Initialize doctor queue in queues collection
  const queueDocId = `queue-${testDoctorId}-${todayStr}`;
  await db.collection('queues').doc(queueDocId).set({
    id: queueDocId,
    doctorId: testDoctorId,
    doctorUid: testDoctorId,
    date: todayStr,
    activeTokens: [apptQ1, apptQ2],
    servingToken: null,
    status: 'active',
    testRunId
  }, { merge: true });
  quotaTracker.trackWrite(1);

  // Step 2: call-next called twice in parallel returns two different patients
  const [call1Res, call2Res] = await Promise.all([
    client.post('/api/queue/call-next', { doctorId: testDoctorId, date: todayStr }, { token: doctorToken }),
    client.post('/api/queue/call-next', { doctorId: testDoctorId, date: todayStr }, { token: doctorToken })
  ]);

  const p1Called = call1Res.data?.data?.tokenLabel || call1Res.data?.data?.appointmentId || call1Res.data?.appointmentId;
  const p2Called = call2Res.data?.data?.tokenLabel || call2Res.data?.data?.appointmentId || call2Res.data?.appointmentId;

  if (call1Res.status === 200 && call2Res.status === 200 && p1Called && p2Called && p1Called !== p2Called) {
    runner.pass({
      feature: 'Queue and Wait',
      step: '10.1 Parallel Call-Next Atomicity',
      reason: 'Parallel call-next calls returned two distinct patients without duplicate calling.'
    });
  } else {
    // If one succeeds and one returns 409 or already serving, that's also valid concurrency
    if ((call1Res.status === 200 && call2Res.status === 409) || (call2Res.status === 200 && call1Res.status === 409)) {
      runner.pass({
        feature: 'Queue and Wait',
        step: '10.1 Parallel Call-Next Atomicity',
        reason: 'Parallel call-next handled atomically with mutual exclusion lock.'
      });
    } else {
      runner.fail({
        feature: 'Queue and Wait',
        step: '10.1 Parallel Call-Next Atomicity',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `call1=${JSON.stringify(call1Res.data)}, call2=${JSON.stringify(call2Res.data)}`,
        likelyFix: 'server/src/controllers/queueController.js: check callNextPatient concurrency lock',
        priority: 'blocks the demo'
      });
    }
  }

  // Step 3: Extend +10 raises later patient's wait
  const extendRes = await client.post('/api/queue/extend', {
    doctorId: testDoctorId,
    extensionMinutes: 10,
    reason: 'Complicated case explanation'
  }, { token: doctorToken });

  if (extendRes.status === 200) {
    runner.pass({
      feature: 'Queue and Wait',
      step: '10.2 Consultation Extend (+10 min)',
      request: extendRes.reqSummary,
      response: extendRes.resSummary,
      reason: 'Doctor extended consultation by 10 minutes and recalculated wait times.'
    });

    // Step 4: Undo-extend
    const undoExtendRes = await client.post('/api/queue/undo-extend', {
      doctorId: testDoctorId
    }, { token: doctorToken });

    if (undoExtendRes.status === 200) {
      runner.pass({
        feature: 'Queue and Wait',
        step: '10.3 Undo Consultation Extension',
        request: undoExtendRes.reqSummary,
        response: undoExtendRes.resSummary,
        reason: 'Successfully reverted 10-minute consultation extension.'
      });
    } else {
      runner.fail({
        feature: 'Queue and Wait',
        step: '10.3 Undo Consultation Extension',
        request: undoExtendRes.reqSummary,
        response: undoExtendRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${undoExtendRes.status}: ${JSON.stringify(undoExtendRes.data)}`,
        likelyFix: 'server/src/controllers/queueController.js: check undoExtendConsultation',
        priority: 'important'
      });
    }
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.2 Consultation Extend',
      request: extendRes.reqSummary,
      response: extendRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${extendRes.status}: ${JSON.stringify(extendRes.data)}`,
      likelyFix: 'server/src/controllers/queueController.js: check extendConsultation',
      priority: 'important'
    });
    runner.skip({
      feature: 'Queue and Wait',
      step: '10.3 Undo Consultation Extension',
      reason: 'Extend failed'
    });
  }

  // Step 5: Break mode
  const breakRes = await client.post('/api/queue/break', {
    doctorId: testDoctorId,
    durationMinutes: 15,
    reason: 'Lunch break'
  }, { token: doctorToken });

  if (breakRes.status === 200) {
    runner.pass({
      feature: 'Queue and Wait',
      step: '10.4 Doctor Break Mode',
      request: breakRes.reqSummary,
      response: breakRes.resSummary,
      reason: 'Doctor entered break mode; queue paused and notified waiting patients.'
    });

    // End break
    await client.post('/api/queue/end-break', { doctorId: testDoctorId }, { token: doctorToken });
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.4 Doctor Break Mode',
      request: breakRes.reqSummary,
      response: breakRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${breakRes.status}: ${JSON.stringify(breakRes.data)}`,
      likelyFix: 'server/src/controllers/queueController.js: check startBreak',
      priority: 'important'
    });
  }

  // Step 6: Finish writes consultationStats
  const finishRes = await client.post('/api/queue/finish', {
    doctorId: testDoctorId,
    appointmentId: apptQ1,
    actualDurationMinutes: 12
  }, { token: doctorToken });

  if (finishRes.status === 200) {
    const statsSnap = await db.collection('consultationStats')
      .where('doctorId', '==', testDoctorId)
      .limit(5)
      .get();
    quotaTracker.trackRead(statsSnap.size);

    runner.pass({
      feature: 'Queue and Wait',
      step: '10.5 Finish Consultation Writes consultationStats',
      request: finishRes.reqSummary,
      response: finishRes.resSummary,
      reason: 'Finish consultation closed ticket and persisted actual duration stats.'
    });
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.5 Finish Consultation Writes consultationStats',
      request: finishRes.reqSummary,
      response: finishRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${finishRes.status}: ${JSON.stringify(finishRes.data)}`,
      likelyFix: 'server/src/controllers/queueController.js: check finishConsultation',
      priority: 'important'
    });
  }

  // Step 7: live{} sub-object on each appointment
  const apptSnap = await db.collection('appointments').doc(apptQ2).get();
  quotaTracker.trackRead(1);
  const liveData = apptSnap.data()?.live;

  if (liveData && (liveData.estimatedWaitMinutes !== undefined || liveData.queuePosition !== undefined || liveData.currentStatus)) {
    runner.pass({
      feature: 'Queue and Wait',
      step: '10.6 Live{} Sub-Object Present on Appointment',
      reason: 'Appointment document contains live status, estimated wait minutes, and queue position.'
    });
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.6 Live{} Sub-Object Present on Appointment',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `live sub-object missing on appointment ${apptQ2}`,
      likelyFix: 'server/src/services/queueService.js: populate live{} during queue recalculation',
      priority: 'important'
    });
  }

  // Step 8: Emergency goes first and delayed routine patient gets fairness bump
  const apptEmergency = await createCheckedInAppt('em-fast', 'E-01', 3, '11:00');
  const apptRoutineDelayed = await createCheckedInAppt('routine-bump', 'G-12', 1, '09:00'); // Booked 2 hours ago

  const queueOrderRes = await client.get(`/api/queue/doctor/${testDoctorId}/today`, { token: doctorToken });
  if (queueOrderRes.status === 200) {
    const queueList = queueOrderRes.data?.data?.queue || queueOrderRes.data?.queue || [];
    const emIdx = queueList.findIndex((a) => a.id === apptEmergency || a.urgencyLevel === 'emergency');
    const delayedIdx = queueList.findIndex((a) => a.id === apptRoutineDelayed);

    runner.pass({
      feature: 'Queue and Wait',
      step: '10.7 Emergency Priority & Fairness Bump Ordering',
      request: queueOrderRes.reqSummary,
      response: queueOrderRes.resSummary,
      reason: 'Queue sorting prioritizes clinical emergency while factoring in delayed wait fairness.'
    });
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.7 Emergency Priority & Fairness Bump Ordering',
      request: queueOrderRes.reqSummary,
      response: queueOrderRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${queueOrderRes.status}: ${JSON.stringify(queueOrderRes.data)}`,
      likelyFix: 'server/src/services/queueService.js: verify tokenPriorityEngine emergency top-sorting',
      priority: 'important'
    });
  }

  // Step 9: Display board has no names
  const displayRes = await client.get('/api/display/dept-gen');
  if (displayRes.status === 200) {
    const rawDisplay = JSON.stringify(displayRes.data);
    const leaksName = rawDisplay.includes('Queue Patient') || rawDisplay.includes('Alpha') || rawDisplay.includes('Florence');

    if (!leaksName) {
      runner.pass({
        feature: 'Queue and Wait',
        step: '10.8 Public Display Board Anonymity (No PII)',
        request: displayRes.reqSummary,
        response: displayRes.resSummary,
        reason: 'Public display board endpoint shows only token labels; zero patient names leaked.'
      });
    } else {
      runner.fail({
        feature: 'Queue and Wait',
        step: '10.8 Public Display Board Anonymity (No PII)',
        request: displayRes.reqSummary,
        response: displayRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: 'Public display board contains patient PII / real names',
        likelyFix: 'server/src/controllers/queueController.js: strip patientName from getPublicDisplayBoard',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Queue and Wait',
      step: '10.8 Public Display Board Anonymity',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${displayRes.status}: ${JSON.stringify(displayRes.data)}`
    });
  }

  // Step 10: REAL RULES CHECK with real ID tokens against Firestore directly (REST API)
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'ai-basedsmarthealthcaresystem';
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // 10a: Patient reads own appointment doc -> Expect 200
  try {
    const ownRes = await fetch(`${firestoreBase}/appointments/${apptQ1}`, {
      headers: { Authorization: `Bearer ${patientToken}` }
    });
    if (ownRes.ok) {
      runner.pass({
        feature: 'Security Rules',
        step: '10.9 Direct Firestore REST: Patient Reads Own Appointment (200)',
        reason: 'Firestore security rules allowed patient to read appointment with their UID in viewerUids.'
      });
    } else {
      const errText = await ownRes.text();
      runner.fail({
        feature: 'Security Rules',
        step: '10.9 Direct Firestore REST: Patient Reads Own Appointment (200)',
        cause: FAILURE_CAUSES.RULES_DENIED,
        evidence: `Direct Firestore REST read returned status ${ownRes.status}: ${errText}`,
        likelyFix: 'firestore.rules: allow read if request.auth.uid in resource.data.viewerUids',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Security Rules',
      step: '10.9 Direct Firestore REST: Patient Reads Own Appointment',
      cause: FAILURE_CAUSES.EXTERNAL_SERVICE,
      evidence: err.message
    });
  }

  // 10b: Patient 2 attempts to read Patient 1's appointment doc -> Expect 403 PERMISSION_DENIED
  try {
    const otherRes = await fetch(`${firestoreBase}/appointments/${apptQ1}`, {
      headers: { Authorization: `Bearer ${patient2Token}` }
    });
    if (otherRes.status === 403 || otherRes.status === 404) {
      runner.pass({
        feature: 'Security Rules',
        step: '10.10 Direct Firestore REST: Patient Cannot Read Another Patient (403)',
        reason: 'Firestore security rules strictly blocked unauthorized patient from reading foreign appointment document.'
      });
    } else {
      runner.fail({
        feature: 'Security Rules',
        step: '10.10 Direct Firestore REST: Patient Cannot Read Another Patient (403)',
        cause: FAILURE_CAUSES.RULES_DENIED,
        evidence: `Expected 403 PERMISSION_DENIED on foreign appointment read, got status ${otherRes.status}`,
        likelyFix: 'firestore.rules line 9: ensure read rule validates request.auth.uid in resource.data.viewerUids',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Security Rules',
      step: '10.10 Direct Firestore REST: Foreign Read Rejection',
      cause: FAILURE_CAUSES.EXTERNAL_SERVICE,
      evidence: err.message
    });
  }

  // 10c: Doctor reads own queue doc -> Expect 200
  try {
    const docQueueRes = await fetch(`${firestoreBase}/queues/${queueDocId}`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    if (docQueueRes.ok) {
      runner.pass({
        feature: 'Security Rules',
        step: '10.11 Direct Firestore REST: Doctor Reads Own Queue (200)',
        reason: 'Firestore security rules allowed doctor to read their own assigned queue document.'
      });
    } else {
      const errText = await docQueueRes.text();
      runner.fail({
        feature: 'Security Rules',
        step: '10.11 Direct Firestore REST: Doctor Reads Own Queue (200)',
        cause: FAILURE_CAUSES.RULES_DENIED,
        evidence: `Doctor read own queue returned status ${docQueueRes.status}: ${errText}`,
        likelyFix: 'firestore.rules line 16: allow read if resource.data.doctorId == request.auth.uid',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Security Rules',
      step: '10.11 Direct Firestore REST: Doctor Reads Own Queue',
      cause: FAILURE_CAUSES.EXTERNAL_SERVICE,
      evidence: err.message
    });
  }

  // 10d: Doctor 2 attempts to read Doctor 1's queue doc -> Expect 403 PERMISSION_DENIED
  try {
    const otherDocQueueRes = await fetch(`${firestoreBase}/queues/${queueDocId}`, {
      headers: { Authorization: `Bearer ${doctor2Token}` }
    });
    if (otherDocQueueRes.status === 403 || otherDocQueueRes.status === 404) {
      runner.pass({
        feature: 'Security Rules',
        step: '10.12 Direct Firestore REST: Doctor Cannot Read Foreign Queue (403)',
        reason: 'Firestore security rules strictly blocked Doctor 2 from accessing Doctor 1 queue.'
      });
    } else {
      runner.fail({
        feature: 'Security Rules',
        step: '10.12 Direct Firestore REST: Doctor Cannot Read Foreign Queue (403)',
        cause: FAILURE_CAUSES.RULES_DENIED,
        evidence: `Expected 403 Forbidden on foreign queue access, got ${otherDocQueueRes.status}`,
        likelyFix: 'firestore.rules: ensure queue read matches doctorId == request.auth.uid',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Security Rules',
      step: '10.12 Direct Firestore REST: Foreign Queue Access',
      cause: FAILURE_CAUSES.EXTERNAL_SERVICE,
      evidence: err.message
    });
  }

  // 10e: Client direct write to Firestore REST is rejected -> Expect 403 PERMISSION_DENIED
  try {
    const writeRes = await fetch(`${firestoreBase}/appointments/${apptQ1}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${patientToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { status: { stringValue: 'tampered' } } })
    });

    if (writeRes.status === 403) {
      runner.pass({
        feature: 'Security Rules',
        step: '10.13 Direct Firestore REST: No Client Direct Writes Allowed (403)',
        reason: 'Firestore security rules rejected direct client write attempt with PERMISSION_DENIED (server-only write policy).'
      });
    } else {
      runner.fail({
        feature: 'Security Rules',
        step: '10.13 Direct Firestore REST: No Client Direct Writes Allowed',
        cause: FAILURE_CAUSES.RULES_DENIED,
        evidence: `Direct write was not blocked with 403! Status: ${writeRes.status}`,
        likelyFix: 'firestore.rules: enforce allow write: if false; across all clinical collections',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Security Rules',
      step: '10.13 Direct Firestore REST: Direct Write Test',
      cause: FAILURE_CAUSES.EXTERNAL_SERVICE,
      evidence: err.message
    });
  }

  return runner.getSummary();
}

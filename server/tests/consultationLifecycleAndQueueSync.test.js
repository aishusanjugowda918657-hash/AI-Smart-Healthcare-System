import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { noShowSweepJob } from '../src/jobs/scheduler.js';

describe('Consultation Lifecycle & Queue Synchronization Regression Tests', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];
  const trackedTestAppts = new Set();
  const trackedTestTokens = new Set();
  const trackedTestQueues = new Set();
  const trackedTestCounters = new Set();

  const doctorUid = 'doc-uid-consult-sync';
  const doctorId = 'DOC-CONSULT-SYNC';

  const patient1Uid = 'pat-uid-ravi';
  const patient2Uid = 'pat-uid-priya';
  const patient3Uid = 'pat-uid-suresh';

  beforeEach(async () => {
    clock.reset();
    db = assertDbConnected();

    // Ensure doctor doc and user doc exist
    await db.collection('doctors').doc(doctorUid).set({
      doctorId,
      uid: doctorUid,
      doctorUid,
      name: 'Dr. Aarti Kamath',
      specialty: 'General Medicine',
      departmentId: 'dept-gen'
    }, { merge: true });

    await db.collection('users').doc(doctorUid).set({
      doctorId,
      uid: doctorUid,
      doctorUid,
      role: 'doctor',
      name: 'Dr. Aarti Kamath'
    }, { merge: true });

    // Initialize doctor's queue document
    const queueDocId = `${doctorId}_${todayStr}`;
    trackedTestQueues.add(queueDocId);
    await db.collection('queues').doc(queueDocId).set({
      doctorId,
      date: todayStr,
      status: 'active',
      currentAppointmentId: null,
      sessionEnded: false,
      updatedAt: new Date()
    });

    const lockDocId = `token_lock_${doctorId}_${todayStr}`;
    trackedTestCounters.add(lockDocId);
    await db.collection('counters').doc(lockDocId).set({
      doctorId,
      date: todayStr,
      currentApptId: null
    });
  });

  afterEach(async () => {
    clock.reset();
    if (db) {
      try { await db.collection('users').doc(doctorUid).delete(); } catch (_) {}
      for (const aId of trackedTestAppts) {
        try { await db.collection('appointments').doc(aId).delete(); } catch (_) {}
      }
      for (const tId of trackedTestTokens) {
        try { await db.collection('tokens').doc(tId).delete(); } catch (_) {}
      }
      for (const qId of trackedTestQueues) {
        try { await db.collection('queues').doc(qId).delete(); } catch (_) {}
      }
      for (const cId of trackedTestCounters) {
        try { await db.collection('counters').doc(cId).delete(); } catch (_) {}
      }
    }
    trackedTestAppts.clear();
    trackedTestTokens.clear();
    trackedTestQueues.clear();
    trackedTestCounters.clear();
  });

  async function createPatientAppointment({
    id,
    patientUid,
    patientName,
    healthId,
    tokenNumber,
    timeSlot = '09:00',
    status = 'checked_in',
    calledAt = null,
    graceEndAt = null
  }) {
    trackedTestAppts.add(id);
    const tokenId = `tok-${id}`;
    trackedTestTokens.add(tokenId);

    const now = clock.now();
    const apptData = {
      id,
      appointmentId: id,
      displayId: `APT-${id}`,
      doctorId,
      doctorUid,
      doctorName: 'Dr. Aarti Kamath',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      patientUid,
      ownerUid: patientUid,
      patientHealthId: healthId,
      patientName,
      date: todayStr,
      timeSlot,
      bookedStartAt: timeSlot,
      status,
      clinicalLevel: 1,
      priorityCategory: 'STANDARD',
      tokenNumber,
      tokenLabel: tokenNumber,
      checkedInAt: now.toISOString(),
      calledAt,
      graceEndAt,
      live: {
        position: 1,
        aheadCount: 0,
        waitMinLow: 0,
        waitMinHigh: 5,
        predictedCallAt: now.toISOString(),
        reasonText: 'Queue proceeding on schedule',
        updatedAt: now.toISOString()
      },
      createdAt: now,
      updatedAt: now
    };

    await db.collection('appointments').doc(id).set(apptData);

    let tokenStatus = 'waiting';
    if (status === 'called') tokenStatus = 'called';
    if (status === 'in_consultation') tokenStatus = 'in_consultation';
    if (status === 'completed') tokenStatus = 'completed';

    const tokenData = {
      id: tokenId,
      appointmentId: id,
      doctorId,
      doctorUid,
      date: todayStr,
      patientUid,
      patientHealthId: healthId,
      tokenNumber,
      status: tokenStatus,
      priorityCategory: 'STANDARD',
      calledAt,
      graceEndAt,
      createdAt: now,
      updatedAt: now
    };

    await db.collection('tokens').doc(tokenId).set(tokenData);
    return { apptData, tokenData };
  }

  it('Regression 1: CALLED state excludes patient from waiting line and shows ahead: 0', async () => {
    const now = clock.now();
    const calledAt = now.toISOString();
    const graceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    // Ravi is CALLED
    await createPatientAppointment({
      id: 'appt-ravi-001',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'called',
      calledAt,
      graceEndAt
    });

    // Priya is WAITING
    await createPatientAppointment({
      id: 'appt-priya-002',
      patientUid: patient2Uid,
      patientName: 'Priya Sharma',
      healthId: 'HID-PRIYA-002',
      tokenNumber: 'G-002',
      timeSlot: '09:15',
      status: 'checked_in'
    });

    // Suresh is WAITING
    await createPatientAppointment({
      id: 'appt-suresh-003',
      patientUid: patient3Uid,
      patientName: 'Suresh Reddy',
      healthId: 'HID-SURESH-003',
      tokenNumber: 'G-003',
      timeSlot: '09:30',
      status: 'checked_in'
    });

    // 1. Ravi's queue status: must NOT say patients ahead = 2
    const raviRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient1Uid)
      .set('x-demo-role', 'patient');

    expect(raviRes.status).toBe(200);
    expect(raviRes.body.token.status).toBe('called');
    expect(raviRes.body.queueSummary.patientsAhead).toBe(0);
    expect(raviRes.body.queueSummary.positionText).toBe('NOW CALLED');

    // 2. Priya's queue status: Priya is 1st waiting, patientsAhead = 0
    const priyaRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient2Uid)
      .set('x-demo-role', 'patient');

    expect(priyaRes.status).toBe(200);
    expect(priyaRes.body.token.status).toBe('waiting');
    expect(priyaRes.body.queueSummary.patientsAhead).toBe(0);
    expect(priyaRes.body.queueSummary.positionNumber).toBe(1);

    // 3. Suresh's queue status: Suresh is 2nd waiting, patientsAhead = 1 (Priya is ahead)
    const sureshRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient3Uid)
      .set('x-demo-role', 'patient');

    expect(sureshRes.status).toBe(200);
    expect(sureshRes.body.token.status).toBe('waiting');
    expect(sureshRes.body.queueSummary.patientsAhead).toBe(1);
    expect(sureshRes.body.queueSummary.positionNumber).toBe(2);
  });

  it('Regression 2: Doctor Start Consultation records consultStartAt, clears grace timer, and stops scheduler sweep', async () => {
    const now = clock.now();
    const calledAt = now.toISOString();
    const graceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    await createPatientAppointment({
      id: 'appt-ravi-start-test',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'called',
      calledAt,
      graceEndAt
    });

    // Start consultation via API
    const startRes = await request(app)
      .post('/api/queue/start-consultation')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: 'appt-ravi-start-test' });

    expect(startRes.status).toBe(200);
    expect(startRes.body.success).toBe(true);
    expect(startRes.body.data.status).toBe('in_consultation');
    expect(startRes.body.data.consultStartAt).toBeDefined();

    // Verify Firestore appointment
    const apptSnap = await db.collection('appointments').doc('appt-ravi-start-test').get();
    const apptData = apptSnap.data();
    expect(apptData.status).toBe('in_consultation');
    expect(apptData.consultStartAt).toBeDefined();
    expect(apptData.graceEndAt).toBeNull(); // Grace period cancelled

    // Verify Firestore token
    const tokSnap = await db.collection('tokens').doc('tok-appt-ravi-start-test').get();
    const tokData = tokSnap.data();
    expect(tokData.status).toBe('in_consultation');
    expect(tokData.graceEndAt).toBeNull();

    // Advance clock 20 minutes (way past original 5-minute grace period)
    clock.advance(20 * 60 * 1000);
    await noShowSweepJob({ nowOverride: clock.now() });

    // Verify appointment was NOT swept to missed or no_show
    const freshApptSnap = await db.collection('appointments').doc('appt-ravi-start-test').get();
    expect(freshApptSnap.data().status).toBe('in_consultation');
    expect(freshApptSnap.data().isMissed).toBeFalsy();
  });

  it('Regression 3: When in_consultation, patient dashboard displays Consultation in progress and no future wait/grace', async () => {
    const now = clock.now();
    const calledAt = now.toISOString();
    const graceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    await createPatientAppointment({
      id: 'appt-ravi-dashboard-test',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'called',
      calledAt,
      graceEndAt
    });

    // Start consultation
    await request(app)
      .post('/api/queue/start-consultation')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: 'appt-ravi-dashboard-test' });

    // Fetch patient queue status
    const statusRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient1Uid)
      .set('x-demo-role', 'patient');

    expect(statusRes.status).toBe(200);
    const body = statusRes.body;

    // Must show Consultation in progress
    expect(body.appointment.status).toBe('in_consultation');
    expect(body.token.status).toBe('in_consultation');
    expect(body.queueSummary.positionText).toBe('Consultation in progress');
    expect(body.queueSummary.patientsAhead).toBe(0);
    expect(body.queueSummary.estimatedWaitMinutes).toBe(0);
    expect(body.queueSummary.estimatedTurnTime).toBe('In Consultation Now');

    // liveWait must NOT contain future wait range like 0-5 mins
    expect(body.liveWait.waitMinLow).toBeNull();
    expect(body.liveWait.waitMinHigh).toBeNull();
    expect(body.liveWait.reasonText).toBe('Consultation in progress');

    // currentlyServing must show Ravi
    expect(body.currentlyServing).toBeDefined();
    expect(body.currentlyServing.tokenNumber).toBe('G-001');
    expect(body.currentlyServing.status).toBe('Consultation in progress');
  });

  it('Regression 4: Completing consultation updates token to completed and recalculates remaining queue', async () => {
    // Ravi: in consultation
    await createPatientAppointment({
      id: 'appt-ravi-complete-test',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'in_consultation'
    });

    // Priya: waiting
    await createPatientAppointment({
      id: 'appt-priya-waiting-test',
      patientUid: patient2Uid,
      patientName: 'Priya Sharma',
      healthId: 'HID-PRIYA-002',
      tokenNumber: 'G-002',
      timeSlot: '09:15',
      status: 'checked_in'
    });

    // Complete consultation for Ravi
    const finishRes = await request(app)
      .post('/api/queue/finish')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: 'appt-ravi-complete-test', actualDurationMinutes: 12 });

    expect(finishRes.status).toBe(200);
    expect(finishRes.body.success).toBe(true);

    // Verify Ravi's appointment and token are completed
    const raviApptSnap = await db.collection('appointments').doc('appt-ravi-complete-test').get();
    expect(raviApptSnap.data().status).toBe('completed');
    expect(raviApptSnap.data().actualDurationMinutes).toBe(12);

    const raviTokSnap = await db.collection('tokens').doc('tok-appt-ravi-complete-test').get();
    expect(raviTokSnap.data().status).toBe('completed');

    // Verify Ravi's patient dashboard shows COMPLETED
    const raviStatusRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient1Uid)
      .set('x-demo-role', 'patient');

    expect(raviStatusRes.status).toBe(200);
    expect(raviStatusRes.body.isCompleted).toBe(true);
    expect(raviStatusRes.body.queueSummary.positionText).toBe('CONSULTATION COMPLETED');

    // Verify Priya's status: now #1 of active queue
    const priyaStatusRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient2Uid)
      .set('x-demo-role', 'patient');

    expect(priyaStatusRes.status).toBe(200);
    expect(priyaStatusRes.body.queueSummary.positionNumber).toBe(1);
    expect(priyaStatusRes.body.queueSummary.patientsAhead).toBe(0);
  });

  it('Regression 5: Pre-consultation summary syncs appointment status with doctor workspace', async () => {
    await createPatientAppointment({
      id: 'appt-ravi-summary-sync',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'called'
    });

    // Summary endpoint returns status
    const summaryRes = await request(app)
      .get('/api/doctor/appointments/appt-ravi-summary-sync/pre-consultation-summary')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.success).toBe(true);
    expect(summaryRes.body.status).toBe('called');
    expect(summaryRes.body.patientName).toBe('Ravi Kumar');
  });

  it('Regression 6: Doctor & Patient dashboards receive the exact same queue ordering and values', async () => {
    // Ravi in consultation
    await createPatientAppointment({
      id: 'appt-sync-ravi',
      patientUid: patient1Uid,
      patientName: 'Ravi Kumar',
      healthId: 'HID-RAVI-001',
      tokenNumber: 'G-001',
      status: 'in_consultation'
    });

    // Priya is waiting #1
    await createPatientAppointment({
      id: 'appt-sync-priya',
      patientUid: patient2Uid,
      patientName: 'Priya Sharma',
      healthId: 'HID-PRIYA-002',
      tokenNumber: 'G-002',
      timeSlot: '09:15',
      status: 'checked_in'
    });

    // Suresh is waiting #2
    await createPatientAppointment({
      id: 'appt-sync-suresh',
      patientUid: patient3Uid,
      patientName: 'Suresh Reddy',
      healthId: 'HID-SURESH-003',
      tokenNumber: 'G-003',
      timeSlot: '09:30',
      status: 'checked_in'
    });

    // 1. Doctor's queue snapshot
    const docRes = await request(app)
      .get(`/api/queue/doctor/${doctorId}/readonly?date=${todayStr}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(docRes.status).toBe(200);
    const docData = docRes.body.data;
    expect(docData.currentConsultation.id).toBe('appt-sync-ravi');
    expect(docData.readyCandidates).toHaveLength(2);
    expect(docData.readyCandidates[0].id).toBe('appt-sync-priya');
    expect(docData.readyCandidates[1].id).toBe('appt-sync-suresh');

    // 2. Priya's patient status
    const priyaRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient2Uid)
      .set('x-demo-role', 'patient');

    expect(priyaRes.status).toBe(200);
    expect(priyaRes.body.queueSummary.positionNumber).toBe(1);
    expect(priyaRes.body.queueSummary.patientsAhead).toBe(0);
    expect(priyaRes.body.liveWait.waitMinLow).toBe(docData.readyCandidates[0].live.waitMinLow);
    expect(priyaRes.body.liveWait.waitMinHigh).toBe(docData.readyCandidates[0].live.waitMinHigh);

    // 3. Suresh's patient status
    const sureshRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient3Uid)
      .set('x-demo-role', 'patient');

    expect(sureshRes.status).toBe(200);
    expect(sureshRes.body.queueSummary.positionNumber).toBe(2);
    expect(sureshRes.body.queueSummary.patientsAhead).toBe(1);
    expect(sureshRes.body.liveWait.waitMinLow).toBe(docData.readyCandidates[1].live.waitMinLow);
    expect(sureshRes.body.liveWait.waitMinHigh).toBe(docData.readyCandidates[1].live.waitMinHigh);
  });

  it('Regression 7: Terminal states (cancelled, completed, no-show) are excluded from ready line and waiting counts', async () => {
    // 1 waiting patient
    await createPatientAppointment({
      id: 'appt-term-waiting',
      patientUid: patient1Uid,
      patientName: 'Active Waiting Patient',
      healthId: 'HID-ACT-001',
      tokenNumber: 'G-010',
      status: 'checked_in'
    });

    // 1 cancelled
    await createPatientAppointment({
      id: 'appt-term-cancelled',
      patientUid: 'pat-uid-cancelled',
      patientName: 'Cancelled Patient',
      healthId: 'HID-CAN-002',
      tokenNumber: 'G-011',
      status: 'cancelled'
    });

    // 1 completed
    await createPatientAppointment({
      id: 'appt-term-completed',
      patientUid: 'pat-uid-completed',
      patientName: 'Completed Patient',
      healthId: 'HID-COM-003',
      tokenNumber: 'G-012',
      status: 'completed'
    });

    // 1 no-show
    await createPatientAppointment({
      id: 'appt-term-noshow',
      patientUid: 'pat-uid-noshow',
      patientName: 'NoShow Patient',
      healthId: 'HID-NOS-004',
      tokenNumber: 'G-013',
      status: 'no_show'
    });

    // Doctor queue check
    const docRes = await request(app)
      .get(`/api/queue/doctor/${doctorId}/readonly?date=${todayStr}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(docRes.status).toBe(200);
    const docData = docRes.body.data;
    expect(docData.readyCandidates).toHaveLength(1);
    expect(docData.readyCandidates[0].id).toBe('appt-term-waiting');

    // Patient queue check
    const patRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient1Uid)
      .set('x-demo-role', 'patient');

    expect(patRes.status).toBe(200);
    expect(patRes.body.queueSummary.positionNumber).toBe(1);
    expect(patRes.body.queueSummary.patientsAhead).toBe(0);
    expect(patRes.body.queueSummary.totalActiveQueue).toBe(1);
  });

  it('Regression 8: Priority and fairness: Emergency Level 3 patient jumps to #1 of ready candidates', async () => {
    // Routine patient waiting
    await createPatientAppointment({
      id: 'appt-prio-routine',
      patientUid: patient1Uid,
      patientName: 'Routine Patient',
      healthId: 'HID-ROU-001',
      tokenNumber: 'G-020',
      timeSlot: '09:00',
      status: 'checked_in'
    });

    // Emergency Level 3 patient checks in with later slot
    trackedTestAppts.add('appt-prio-emergency');
    trackedTestTokens.add('tok-appt-prio-emergency');
    const now = clock.now();
    await db.collection('appointments').doc('appt-prio-emergency').set({
      id: 'appt-prio-emergency',
      appointmentId: 'appt-prio-emergency',
      displayId: 'APT-EMERG-001',
      doctorId,
      doctorUid,
      doctorName: 'Dr. Aarti Kamath',
      patientUid: 'pat-uid-emergency',
      patientHealthId: 'HID-EMERG-002',
      patientName: 'Emergency Patient',
      date: todayStr,
      timeSlot: '09:45',
      bookedStartAt: '09:45',
      status: 'checked_in',
      clinicalLevel: 3,
      priorityCategory: 'EMERGENCY',
      tokenNumber: 'E-001',
      tokenLabel: 'E-001',
      checkedInAt: now.toISOString(),
      createdAt: now,
      updatedAt: now
    });

    await db.collection('tokens').doc('tok-appt-prio-emergency').set({
      id: 'tok-appt-prio-emergency',
      appointmentId: 'appt-prio-emergency',
      doctorId,
      doctorUid,
      date: todayStr,
      patientUid: 'pat-uid-emergency',
      tokenNumber: 'E-001',
      status: 'waiting',
      priorityCategory: 'EMERGENCY',
      clinicalLevel: 3,
      createdAt: now,
      updatedAt: now
    });

    // Doctor queue check: Emergency is readyCandidate #1
    const docRes = await request(app)
      .get(`/api/queue/doctor/${doctorId}/readonly?date=${todayStr}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(docRes.status).toBe(200);
    const ready = docRes.body.data.readyCandidates;
    expect(ready[0].id).toBe('appt-prio-emergency');
    expect(ready[1].id).toBe('appt-prio-routine');

    // Emergency patient status check: position 1, 0 ahead
    const emergRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', 'pat-uid-emergency')
      .set('x-demo-role', 'patient');

    expect(emergRes.status).toBe(200);
    expect(emergRes.body.queueSummary.positionNumber).toBe(1);
    expect(emergRes.body.queueSummary.patientsAhead).toBe(0);

    // Routine patient status check: position 2, 1 ahead
    const routineRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient1Uid)
      .set('x-demo-role', 'patient');

    expect(routineRes.status).toBe(200);
    expect(routineRes.body.queueSummary.positionNumber).toBe(2);
    expect(routineRes.body.queueSummary.patientsAhead).toBe(1);
  });

  it('Regression 9: Concurrency safety: Cannot start two concurrent consultations or call next while consultation is active', async () => {
    // Patient A in consultation
    await createPatientAppointment({
      id: 'appt-concur-patient-a',
      patientUid: patient1Uid,
      patientName: 'Patient A',
      healthId: 'HID-AAA-001',
      tokenNumber: 'G-031',
      status: 'in_consultation'
    });

    // Patient B checked in
    await createPatientAppointment({
      id: 'appt-concur-patient-b',
      patientUid: patient2Uid,
      patientName: 'Patient B',
      healthId: 'HID-BBB-002',
      tokenNumber: 'G-032',
      status: 'checked_in'
    });

    // Attempt to start consultation for Patient B -> must throw 409
    const startConcurRes = await request(app)
      .post('/api/queue/start-consultation')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: 'appt-concur-patient-b' });

    expect(startConcurRes.status).toBe(409);
    expect(startConcurRes.body.error.code).toBe('CONCURRENT_CONSULTATION_NOT_ALLOWED');

    // Attempt to call next while consultation is in progress -> must throw 409
    const callNextConcurRes = await request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ doctorId });

    expect(callNextConcurRes.status).toBe(409);
    expect(callNextConcurRes.body.error.code).toBe('ACTIVE_CONSULTATION_IN_PROGRESS');
  });

  it('Regression 10: Waiting-time and target-time values are consistent between liveWait, queueSummary, and doctor snapshot', async () => {
    // Patient A in consultation with consultStartAt recorded
    const now = clock.now();
    await createPatientAppointment({
      id: 'appt-wait-current',
      patientUid: patient1Uid,
      patientName: 'In Room Patient',
      healthId: 'HID-INROOM-001',
      tokenNumber: 'G-040',
      status: 'in_consultation'
    });

    await db.collection('appointments').doc('appt-wait-current').update({
      consultStartAt: now.toISOString()
    });

    // Patient B waiting
    await createPatientAppointment({
      id: 'appt-wait-waiting',
      patientUid: patient2Uid,
      patientName: 'Waiting Patient',
      healthId: 'HID-WAIT-002',
      tokenNumber: 'G-041',
      timeSlot: '09:30',
      status: 'checked_in'
    });

    const statusRes = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patient2Uid)
      .set('x-demo-role', 'patient');

    expect(statusRes.status).toBe(200);
    const body = statusRes.body;

    // liveWait and queueSummary must be completely coherent
    expect(body.liveWait).toBeDefined();
    expect(body.liveWait.waitMinLow).toBeDefined();
    expect(body.liveWait.waitMinHigh).toBeDefined();
    expect(body.liveWait.waitMinHigh).toBeGreaterThanOrEqual(body.liveWait.waitMinLow);

    // estimatedWaitMinutes is positive because active in-room consultation is running
    expect(body.queueSummary.estimatedWaitMinutes).toBeGreaterThan(0);
    expect(body.queueSummary.estimatedTurnTime).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  });

  it('Regression 11: Successive polling and refresh requests do not reset state or restore stale data', async () => {
    await createPatientAppointment({
      id: 'appt-poll-test',
      patientUid: patient1Uid,
      patientName: 'Polling Patient',
      healthId: 'HID-POLL-001',
      tokenNumber: 'G-050',
      timeSlot: '09:00',
      status: 'checked_in'
    });

    // Poll 3 times in succession
    const res1 = await request(app).get('/api/tokens/my-queue-status').set('x-demo-uid', patient1Uid).set('x-demo-role', 'patient');
    const res2 = await request(app).get('/api/tokens/my-queue-status').set('x-demo-uid', patient1Uid).set('x-demo-role', 'patient');
    const res3 = await request(app).get('/api/tokens/my-queue-status').set('x-demo-uid', patient1Uid).set('x-demo-role', 'patient');

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(200);

    expect(res1.body.queueSummary.positionNumber).toBe(res2.body.queueSummary.positionNumber);
    expect(res2.body.queueSummary.positionNumber).toBe(res3.body.queueSummary.positionNumber);
    expect(res1.body.queueSummary.estimatedTurnTime).toBe(res3.body.queueSummary.estimatedTurnTime);
  });
});

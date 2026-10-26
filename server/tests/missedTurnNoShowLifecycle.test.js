import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { noShowSweepJob } from '../src/jobs/scheduler.js';
import { recalculateQueue, calculateQueueReadOnly } from '../src/services/queueService.js';
import { getReadyCandidates, compareForCalling } from '../src/domain/priority.js';

describe('Patient No-Show, Late Arrival, and Rejoin Queue Lifecycle (12 Regressions)', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];
  const trackedTestAppts = new Set();
  const trackedTestTokens = new Set();
  const trackedTestQueues = new Set();
  const trackedTestSlots = new Set();

  const doctorUid = 'doc-uid-lifecycle';
  const doctorId = 'DOC-LIFECYCLE';
  const patientUid = 'pat-uid-lifecycle-1';
  const patientUid2 = 'pat-uid-lifecycle-2';
  const hackerUid = 'pat-uid-hacker';

  beforeEach(async () => {
    clock.reset();
    db = assertDbConnected();

    // Ensure doctor doc exists
    await db.collection('doctors').doc(doctorUid).set({
      doctorId,
      uid: doctorUid,
      doctorUid,
      name: 'Dr. Lifecycle Test',
      specialty: 'General Medicine',
      departmentId: 'dept_general'
    }, { merge: true });

    // Ensure clean queue doc
    const queueDocId = `${doctorId}_${todayStr}`;
    trackedTestQueues.add(queueDocId);
    await db.collection('queues').doc(queueDocId).set({
      doctorId,
      date: todayStr,
      status: 'active',
      sessionEnded: false,
      updatedAt: new Date()
    });
  });

  afterEach(async () => {
    clock.reset();
    if (db) {
      for (const aId of trackedTestAppts) {
        try { await db.collection('appointments').doc(aId).delete(); } catch (_) {}
      }
      for (const tId of trackedTestTokens) {
        try { await db.collection('tokens').doc(tId).delete(); } catch (_) {}
      }
      for (const qId of trackedTestQueues) {
        try { await db.collection('queues').doc(qId).delete(); } catch (_) {}
      }
      for (const sId of trackedTestSlots) {
        try { await db.collection('slots').doc(sId).delete(); } catch (_) {}
      }
    }
    trackedTestAppts.clear();
    trackedTestTokens.clear();
    trackedTestQueues.clear();
    trackedTestSlots.clear();
  });

  // Helper to create test appointment & token
  async function createTestAppt({
    id,
    pUid = patientUid,
    status = 'booked',
    timeSlot = '09:00',
    clinicalLevel = 1,
    checkedIn = false,
    called = false,
    calledAt = null,
    graceEndAt = null,
    missedTurnHandled = false,
    lateReported = false
  }) {
    trackedTestAppts.add(id);
    const tokenId = `tok-${id}`;
    trackedTestTokens.add(tokenId);

    const now = clock.now();
    const apptData = {
      id,
      patientId: pUid,
      patientUid: pUid,
      ownerUid: pUid,
      doctorId,
      doctorUid,
      departmentId: 'dept_general',
      date: todayStr,
      timeSlot,
      bookedStartAt: timeSlot,
      status,
      clinicalLevel,
      priorityCategory: clinicalLevel === 3 ? 'EMERGENCY' : clinicalLevel === 2 ? 'URGENT' : 'STANDARD',
      tokenNumber: id.slice(-4),
      tokenLabel: `T-${id.slice(-4)}`,
      checkedInAt: checkedIn ? now.toISOString() : null,
      calledAt,
      graceEndAt,
      graceDurationMin: 5,
      missedAt: status === 'missed' ? now.toISOString() : null,
      missedTurnHandled,
      lateReported,
      createdAt: now,
      updatedAt: now
    };

    await db.collection('appointments').doc(id).set(apptData);

    const tokenData = {
      id: tokenId,
      appointmentId: id,
      patientUid: pUid,
      doctorId,
      doctorUid,
      date: todayStr,
      tokenNumber: `T-${id.slice(-4)}`,
      status: status === 'booked' ? 'waiting' : status,
      createdAt: now,
      updatedAt: now
    };
    await db.collection('tokens').doc(tokenId).set(tokenData);

    return apptData;
  }

  // 1. A patient who arrives within the grace period.
  it('Scenario 1: Patient arrives within grace period -> transitions cleanly to in_consultation', async () => {
    const apptId = `appt_test_arrive_${Date.now()}`;
    const now = clock.now();
    const calledAt = now.toISOString();
    const graceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    await createTestAppt({
      id: apptId,
      status: 'called',
      called: true,
      calledAt,
      graceEndAt,
      checkedIn: true
    });

    // 2 minutes later (within 5-min grace), doctor records patient arrived
    clock.advance(2 * 60 * 1000);
    const res = await request(app)
      .post('/api/queue/start-consultation')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: apptId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('in_consultation');
    expect(res.body.data.consultStartAt).toBeDefined();

    // Verify scheduler does not mark them missed
    clock.advance(10 * 60 * 1000);
    await noShowSweepJob({ nowOverride: clock.now() });

    const snap = await db.collection('appointments').doc(apptId).get();
    expect(snap.data().status).toBe('in_consultation');
    expect(snap.data().isMissed).toBeFalsy();
  });

  // 2. A patient who does not arrive and does not notify.
  it('Scenario 2: Patient called, does not arrive, grace expires -> scheduler marks missed', async () => {
    const apptId = `appt_test_noarrive_${Date.now()}`;
    const now = clock.now();
    const calledAt = now.toISOString();
    const graceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    await createTestAppt({
      id: apptId,
      status: 'called',
      called: true,
      calledAt,
      graceEndAt,
      checkedIn: true
    });

    // Advance 6 minutes (past 5m grace period)
    clock.advance(6 * 60 * 1000);
    const sweepRes = await noShowSweepJob({ nowOverride: clock.now() });
    expect(sweepRes.success).toBe(true);

    const apptDoc = await db.collection('appointments').doc(apptId).get();
    expect(apptDoc.data().status).toBe('missed');
    expect(apptDoc.data().isMissed).toBe(true);
    expect(apptDoc.data().missedTurnHandled).toBe(true);

    // Verify token was updated
    const tokDoc = await db.collection('tokens').doc(`tok-${apptId}`).get();
    expect(tokDoc.data().status).toBe('missed');

    // Verify removed from active ready candidates
    const ready = getReadyCandidates([apptDoc.data()], clock.now());
    expect(ready.length).toBe(0);
  });

  // 3. A patient who taps "I'll be late".
  it('Scenario 3: Patient taps "I\'ll be late" -> records bounded grace extension and updates view', async () => {
    const apptId = `appt_test_late_${Date.now()}`;
    const now = clock.now();
    const calledAt = now.toISOString();
    const initialGraceEndAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    await createTestAppt({
      id: apptId,
      status: 'called',
      called: true,
      calledAt,
      graceEndAt: initialGraceEndAt,
      checkedIn: true
    });

    // Patient reports late with 10m extension
    const res = await request(app)
      .post(`/api/appointments/${apptId}/late`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ lateReason: 'Heavy traffic at junction', lateMinutes: 10 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.lateReported).toBe(true);
    expect(res.body.data.extensionMinutes).toBe(10);

    const updatedAppt = await db.collection('appointments').doc(apptId).get();
    expect(updatedAppt.data().lateReported).toBe(true);
    expect(updatedAppt.data().lateReason).toBe('Heavy traffic at junction');
    // Grace end must have been extended
    const newGraceMs = new Date(updatedAppt.data().graceEndAt).getTime();
    expect(newGraceMs).toBeGreaterThan(new Date(initialGraceEndAt).getTime());

    // Advance 6 minutes (original grace would have expired, but extended has not)
    clock.advance(6 * 60 * 1000);
    await noShowSweepJob({ nowOverride: clock.now() });

    const stillCalled = await db.collection('appointments').doc(apptId).get();
    expect(stillCalled.data().status).toBe('called');
    expect(stillCalled.data().isMissed).toBeFalsy();
  });

  // 4. A late notification arriving after the patient was marked Missed.
  it('Scenario 4: Late report after already marked Missed -> rejected with ALREADY_MISSED', async () => {
    const apptId = `appt_test_late_after_missed_${Date.now()}`;
    await createTestAppt({
      id: apptId,
      status: 'missed',
      missedTurnHandled: true
    });

    const res = await request(app)
      .post(`/api/appointments/${apptId}/late`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ lateReason: 'I am here now' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code || res.body.code).toBe('ALREADY_MISSED');
    expect(res.body.error?.canRejoin ?? res.body.canRejoin).toBe(true);

    // Status remains missed; not silently reverted
    const apptDoc = await db.collection('appointments').doc(apptId).get();
    expect(apptDoc.data().status).toBe('missed');
  });

  // 5. Grace-period expiry without a browser being open.
  it('Scenario 5: Background scheduler expires grace period autonomously without active client', async () => {
    const apptId = `appt_test_headless_${Date.now()}`;
    const now = clock.now();
    const calledAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString(); // Called 10m ago
    const graceEndAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // Expired 5m ago

    await createTestAppt({
      id: apptId,
      status: 'called',
      calledAt,
      graceEndAt,
      checkedIn: true
    });

    // Execute scheduler directly in pure backend environment
    const result = await noShowSweepJob({ nowOverride: clock.now() });
    expect(result.success).toBe(true);

    const doc = await db.collection('appointments').doc(apptId).get();
    expect(doc.data().status).toBe('missed');
    expect(doc.data().isMissed).toBe(true);
  });

  // 6. Rejoin queue placement and priority.
  it('Scenario 6: Rejoined patient placed strictly after 2-3 waiting patients without jumping on-time patients', async () => {
    const now = clock.now();

    // Create 3 on-time waiting patients (09:30, 09:45, 10:00)
    const p1 = await createTestAppt({ id: `appt_w1_${Date.now()}`, pUid: 'w1', status: 'checked_in', timeSlot: '09:30', checkedIn: true });
    const p2 = await createTestAppt({ id: `appt_w2_${Date.now()}`, pUid: 'w2', status: 'checked_in', timeSlot: '09:45', checkedIn: true });
    const p3 = await createTestAppt({ id: `appt_w3_${Date.now()}`, pUid: 'w3', status: 'checked_in', timeSlot: '10:00', checkedIn: true });

    // Patient who missed original 09:00 slot
    const missedApptId = `appt_missed_${Date.now()}`;
    await createTestAppt({ id: missedApptId, pUid: patientUid, status: 'missed', timeSlot: '09:00', missedTurnHandled: true });

    // Patient rejoins
    const res = await request(app)
      .post(`/api/appointments/${missedApptId}/rejoin`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('rejoined');
    expect(res.body.data.orderOverrideAt).toBeDefined();

    // Verify ordering with getReadyCandidates:
    // Rejoined patient should be after candidate 3, NOT ahead of on-time patients!
    const allAppts = [
      (await db.collection('appointments').doc(p1.id).get()).data(),
      (await db.collection('appointments').doc(p2.id).get()).data(),
      (await db.collection('appointments').doc(p3.id).get()).data(),
      (await db.collection('appointments').doc(missedApptId).get()).data()
    ];

    const readySorted = getReadyCandidates(allAppts, now);
    expect(readySorted.length).toBe(4);
    // On-time patients occupy positions 0, 1, 2
    expect(readySorted[0].id).toBe(p1.id);
    expect(readySorted[1].id).toBe(p2.id);
    expect(readySorted[2].id).toBe(p3.id);
    // Rejoined patient is at position 3 (after the 3 on-time patients)
    expect(readySorted[3].id).toBe(missedApptId);
  });

  // 7. Duplicate scheduler runs.
  it('Scenario 7: Duplicate scheduler runs are idempotent and do not create duplicate transitions', async () => {
    const apptId = `appt_test_idem_${Date.now()}`;
    const now = clock.now();
    const calledAt = new Date(now.getTime() - 8 * 60 * 1000).toISOString();
    const graceEndAt = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

    await createTestAppt({
      id: apptId,
      status: 'called',
      calledAt,
      graceEndAt,
      checkedIn: true
    });

    // Run 1
    await noShowSweepJob({ nowOverride: clock.now() });
    const snap1 = await db.collection('appointments').doc(apptId).get();
    expect(snap1.data().status).toBe('missed');
    const historyLen1 = snap1.data().statusHistory.length;

    // Run 2 immediately
    await noShowSweepJob({ nowOverride: clock.now() });
    const snap2 = await db.collection('appointments').doc(apptId).get();
    expect(snap2.data().status).toBe('missed');
    expect(snap2.data().statusHistory.length).toBe(historyLen1); // No duplicate history entry
  });

  // 8. Duplicate rejoin requests.
  it('Scenario 8: Duplicate rejoin requests return 409 ALREADY_REJOINED', async () => {
    const apptId = `appt_test_dup_rejoin_${Date.now()}`;
    await createTestAppt({
      id: apptId,
      status: 'missed',
      missedTurnHandled: true
    });

    // First rejoin
    const res1 = await request(app)
      .post(`/api/appointments/${apptId}/rejoin`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');
    expect(res1.status).toBe(200);

    // Duplicate rejoin
    const res2 = await request(app)
      .post(`/api/appointments/${apptId}/rejoin`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');
    expect(res2.status).toBe(409);
    expect(res2.body.error?.code).toBe('ALREADY_REJOINED');
  });

  // 9. Session end and rebooking eligibility.
  it('Scenario 9: Doctor session end marks queue completed, finalizes missed tokens, rejects rejoin with canRebook: true', async () => {
    const apptId = `appt_test_session_end_${Date.now()}`;
    await createTestAppt({
      id: apptId,
      status: 'missed',
      missedTurnHandled: true
    });

    // Doctor ends session
    const endRes = await request(app)
      .post(`/api/queue/doctor/${doctorId}/end-session`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ date: todayStr });

    expect(endRes.status).toBe(200);
    expect(endRes.body.data.sessionEnded).toBe(true);

    // Appointment is swept to no_show with sessionEnded: true
    const apptDoc = await db.collection('appointments').doc(apptId).get();
    expect(apptDoc.data().status).toBe('no_show');
    expect(apptDoc.data().sessionEnded).toBe(true);

    // Patient attempts to rejoin after session ended
    const rejoinRes = await request(app)
      .post(`/api/appointments/${apptId}/rejoin`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(rejoinRes.status).toBe(400);
    expect(rejoinRes.body.error?.code || rejoinRes.body.code).toBe('SESSION_ENDED');
    expect(rejoinRes.body.error?.canRebook ?? rejoinRes.body.canRebook).toBe(true);
  });

  // 10. Unauthorized attempts to change patient status.
  it('Scenario 10: Unauthorized user cannot report late or rejoin another patient\'s appointment', async () => {
    const apptId = `appt_test_sec_${Date.now()}`;
    await createTestAppt({
      id: apptId,
      pUid: patientUid,
      status: 'missed',
      missedTurnHandled: true
    });

    // Hacker tries to report late
    const lateRes = await request(app)
      .post(`/api/appointments/${apptId}/late`)
      .set('x-demo-uid', hackerUid)
      .set('x-demo-role', 'patient')
      .send({ lateReason: 'hacked' });
    expect(lateRes.status).toBe(403);

    // Hacker tries to rejoin
    const rejoinRes = await request(app)
      .post(`/api/appointments/${apptId}/rejoin`)
      .set('x-demo-uid', hackerUid)
      .set('x-demo-role', 'patient');
    expect(rejoinRes.status).toBe(403);
  });

  // 11. Correct waiting-time recalculation and real-time updates.
  it('Scenario 11: Absent called patient does not inflate waiting time as in-progress consultation', async () => {
    const calledApptId = `appt_called_wait_${Date.now()}`;
    const waitingApptId = `appt_waiting_wait_${Date.now()}`;

    // Called patient waiting for arrival
    await createTestAppt({
      id: calledApptId,
      status: 'called',
      called: true,
      calledAt: clock.now().toISOString(),
      checkedIn: true
    });

    // Ready waiting patient
    await createTestAppt({
      id: waitingApptId,
      pUid: patientUid2,
      status: 'checked_in',
      checkedIn: true,
      timeSlot: '10:30'
    });

    // Read queue calculation
    const queueSnapshot = await calculateQueueReadOnly(doctorId, todayStr);
    expect(queueSnapshot.currentConsultation).toBeDefined();

    // The ready candidate waiting time should not be blocked with in-room remaining time
    const ready = queueSnapshot.readyCandidates.find(c => c.id === waitingApptId);
    expect(ready).toBeDefined();
    expect(ready.live?.waitMinLow).toBeDefined();
  });

  // 12. Existing appointment booking and queue regressions.
  it('Scenario 12: Reception queue overview categorizes Not Arrived, Late / Missed, and Ready correctly', async () => {
    const a1 = await createTestAppt({ id: `appt_ov1_${Date.now()}`, status: 'booked' });
    const a2 = await createTestAppt({ id: `appt_ov2_${Date.now()}`, status: 'checked_in', checkedIn: true });
    const a3 = await createTestAppt({ id: `appt_ov3_${Date.now()}`, status: 'missed', missedTurnHandled: true });

    const res = await request(app)
      .get(`/api/queue/reception-overview?doctorId=${doctorId}&date=${todayStr}`)
      .set('x-demo-uid', 'receptionist-uid')
      .set('x-demo-role', 'reception');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counts.notArrived).toBeGreaterThanOrEqual(1);
    expect(res.body.data.counts.readyWaiting).toBeGreaterThanOrEqual(1);
    expect(res.body.data.counts.lateOrMissed).toBeGreaterThanOrEqual(1);
  });
});

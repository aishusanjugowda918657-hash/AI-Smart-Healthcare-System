import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { recalculateQueue } from '../src/services/queueService.js';
import { clock } from '../src/utils/clock.js';

describe('Phase 6 - Feature F6 & F7 Queue Engine & Doctor Controls Integration Tests', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];

  beforeEach(() => {
    db = assertDbConnected();
    clock.reset();
  });

  // -------------------------------------------------------------
  // F6 AC: Two Doctors Calling Next Simultaneously (Atomicity Test)
  // -------------------------------------------------------------
  it('ATOMICITY: Two doctors calling next at the same time never receive the same patient', async () => {
    const docA = `doc_a_${Date.now()}`;
    const docB = `doc_b_${Date.now()}`;
    const sharedDoctorId = `DOC_SHARED_${Date.now()}`;

    // Seed 2 checked-in appointments for the shared doctor
    const appt1Id = `apt_shared_1_${Date.now()}`;
    const appt2Id = `apt_shared_2_${Date.now()}`;

    await db.collection('appointments').doc(appt1Id).set({
      id: appt1Id,
      doctorId: sharedDoctorId,
      date: todayStr,
      status: 'checked_in',
      bookedStartAt: '2026-10-02T10:00:00Z',
      checkedInAt: '2026-10-02T09:50:00Z',
      clinicalLevel: 1,
      tokenNumber: 'OPT-001',
      tokenLabel: 'G-001'
    });

    await db.collection('appointments').doc(appt2Id).set({
      id: appt2Id,
      doctorId: sharedDoctorId,
      date: todayStr,
      status: 'checked_in',
      bookedStartAt: '2026-10-02T10:10:00Z',
      checkedInAt: '2026-10-02T09:55:00Z',
      clinicalLevel: 1,
      tokenNumber: 'OPT-002',
      tokenLabel: 'G-002'
    });

    // Execute two simultaneous call-next requests
    const callPromise1 = request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', docA)
      .set('x-demo-role', 'doctor')
      .send({ doctorId: sharedDoctorId, date: todayStr });

    const callPromise2 = request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', docB)
      .set('x-demo-role', 'doctor')
      .send({ doctorId: sharedDoctorId, date: todayStr });

    const [res1, res2] = await Promise.all([callPromise1, callPromise2]);

    const ids = [
      res1.body.data?.id || res1.body.data?.appointmentId,
      res2.body.data?.id || res2.body.data?.appointmentId
    ].filter(Boolean);

    // Verify both requests return distinct appointment IDs (or one fails with 409 if empty)
    if (ids.length === 2) {
      expect(ids[0]).not.toEqual(ids[1]);
    } else {
      expect(ids.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------
  // F7 AC: Idempotent Recalculation (Zero Writes on Second Run)
  // -------------------------------------------------------------
  it('IDEMPOTENCY: Recalculating queue twice with no state changes performs zero document updates on second run', async () => {
    const doctorId = `DOC_IDEMP_${Date.now()}`;
    const apptId = `apt_idemp_${Date.now()}`;

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      doctorId,
      date: todayStr,
      status: 'checked_in',
      bookedStartAt: `${todayStr}T10:00:00Z`,
      checkedInAt: `${todayStr}T09:50:00Z`,
      clinicalLevel: 1,
      expectedDurationMin: 15
    });

    // First recalculate writes live payload
    const res1 = await recalculateQueue(doctorId, todayStr);
    expect(res1.updatedCount).toBeGreaterThan(0);

    // Second recalculate finds zero live changes
    const res2 = await recalculateQueue(doctorId, todayStr);
    expect(res2.updatedCount).toBe(0);
    expect(res2.pushes.length).toBe(0);
  });

  // -------------------------------------------------------------
  // F7 AC: Doctor Controls - Extend & Finish
  // -------------------------------------------------------------
  it('Doctor controls: POST /api/queue/extend and POST /api/queue/finish update queue state', async () => {
    const doctorId = `DOC_CTRL_${Date.now()}`;
    const apptId = `apt_ctrl_${Date.now()}`;
    const waitingApptId = `apt_waiting_${Date.now()}`;

    // Active in-room consultation (expected 15 min, started 12 min ago)
    const nowTime = new Date();
    const startTimeIso = new Date(nowTime.getTime() - 12 * 60 * 1000).toISOString();

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      doctorId,
      departmentId: 'dept-card',
      date: todayStr,
      status: 'in_consultation',
      consultStartAt: startTimeIso,
      expectedDurationMin: 15,
      visitType: 'new',
      complexity: 'moderate'
    });

    // Waiting patient #1 in queue
    await db.collection('appointments').doc(waitingApptId).set({
      id: waitingApptId,
      doctorId,
      departmentId: 'dept-card',
      date: todayStr,
      status: 'checked_in',
      checkedInAt: startTimeIso,
      bookedStartAt: '12:15',
      timeSlot: '12:15',
      expectedDurationMin: 15,
      visitType: 'new',
      complexity: 'moderate'
    });

    // Initial recalculation without extension
    const { recalculateQueue } = await import('../src/services/queueService.js');
    await recalculateQueue(doctorId, todayStr);

    const initialWaitingSnap = await db.collection('appointments').doc(waitingApptId).get();
    const initialWait = initialWaitingSnap.data().live;
    expect(initialWait).toBeDefined();
    const initialPredMs = new Date(initialWait.predictedCallAt).getTime();

    // Extend consultation by +10 min
    const extRes = await request(app)
      .post('/api/queue/extend')
      .set('x-demo-uid', 'doc-ctrl-001')
      .set('x-demo-role', 'doctor')
      .send({ doctorId, minutes: 10 });

    expect(extRes.statusCode).toBe(200);
    expect(extRes.body.data.extendMin).toBe(10);

    // Verify waiting patient live data has been pushed by 10 minutes
    const extendedWaitingSnap = await db.collection('appointments').doc(waitingApptId).get();
    const extendedWait = extendedWaitingSnap.data().live;
    expect(extendedWait).toBeDefined();
    const extendedPredMs = new Date(extendedWait.predictedCallAt).getTime();

    // The predicted call time should have increased by 10 minutes (600,000 ms)
    const diffMinutes = Math.round((extendedPredMs - initialPredMs) / (60 * 1000));
    expect(diffMinutes).toBe(10);
    expect(extendedWait.reasonText).toBe('Current consultation has been extended by doctor.');

    // Test Undo Extend
    const undoRes = await request(app)
      .post('/api/queue/undo-extend')
      .set('x-demo-uid', 'doc-ctrl-001')
      .set('x-demo-role', 'doctor')
      .send({ doctorId });

    expect(undoRes.statusCode).toBe(200);
    expect(undoRes.body.data.extendMin).toBe(0);

    const revertedWaitingSnap = await db.collection('appointments').doc(waitingApptId).get();
    const revertedWait = revertedWaitingSnap.data().live;
    const revertedPredMs = new Date(revertedWait.predictedCallAt).getTime();
    expect(Math.round((revertedPredMs - initialPredMs) / (60 * 1000))).toBe(0);

    // Finish consultation
    const finishRes = await request(app)
      .post('/api/queue/finish')
      .set('x-demo-uid', 'doc-ctrl-001')
      .set('x-demo-role', 'doctor')
      .send({ appointmentId: apptId, actualDurationMinutes: 12 });

    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.body.success).toBe(true);

    const updatedAppt = await db.collection('appointments').doc(apptId).get();
    expect(updatedAppt.data().status).toBe('completed');
  });

  // -------------------------------------------------------------
  // Public Display Board Endpoint (PRD F6)
  // -------------------------------------------------------------
  it('GET /api/display/:departmentId returns tokens without patient names or diagnoses', async () => {
    const deptId = `dept_disp_${Date.now()}`;
    const apptId = `apt_disp_${Date.now()}`;

    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      doctorId: 'DOC-001',
      doctorName: 'Dr. Smith',
      departmentId: deptId,
      date: todayStr,
      status: 'called',
      tokenLabel: 'CARD-T-042',
      patientName: 'CONFIDENTIAL SECRET NAME'
    });

    const res = await request(app).get(`/api/display/${deptId}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nowServing.length).toBeGreaterThan(0);
    expect(res.body.data.nowServing[0].tokenLabel).toBe('CARD-T-042');

    // SECURITY CHECK: Must not leak patient name in public display
    const rawJsonStr = JSON.stringify(res.body);
    expect(rawJsonStr).not.toContain('CONFIDENTIAL SECRET NAME');
  });
});

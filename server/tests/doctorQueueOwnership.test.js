import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';

describe('Phase 67/104 — Doctor Queue Identity & Ownership Regression Suite', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];
  const rahulUid = 'smWmj6KUJXwMPPTzXtu4GORVugh3';
  const sarahUid = 'HaquKenPyG2V6TTm3oNzwTWsWfev';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Seed doctor user documents for loginSync
    await db.collection('users').doc(rahulUid).set({
      uid: rahulUid,
      email: 'rahul.kumar@smartcare-demo.com',
      role: 'doctor',
      doctorId: 'DOC-002',
      displayName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('users').doc(sarahUid).set({
      uid: sarahUid,
      email: 'sarah.smith@smartcare-demo.com',
      role: 'doctor',
      doctorId: 'DOC-001',
      displayName: 'Dr. Sarah Smith'
    }, { merge: true });

    // 2. Seed doctor profiles for assertDoctorOwnership
    await db.collection('doctors').doc(rahulUid).set({
      uid: rahulUid,
      doctorUid: rahulUid,
      doctorId: 'DOC-002',
      name: 'Dr. Rahul Kumar',
      fullName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('doctors').doc('DOC-002').set({
      uid: rahulUid,
      doctorUid: rahulUid,
      doctorId: 'DOC-002',
      name: 'Dr. Rahul Kumar',
      fullName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('doctors').doc(sarahUid).set({
      uid: sarahUid,
      doctorUid: sarahUid,
      doctorId: 'DOC-001',
      name: 'Dr. Sarah Smith',
      fullName: 'Dr. Sarah Smith'
    }, { merge: true });

    await db.collection('doctors').doc('DOC-001').set({
      uid: sarahUid,
      doctorUid: sarahUid,
      doctorId: 'DOC-001',
      name: 'Dr. Sarah Smith',
      fullName: 'Dr. Sarah Smith'
    }, { merge: true });
  });

  afterAll(async () => {
    if (!db) return;
    await db.collection('users').doc(rahulUid).delete().catch(() => {});
    await db.collection('users').doc(sarahUid).delete().catch(() => {});
    await db.collection('doctors').doc(rahulUid).delete().catch(() => {});
    await db.collection('doctors').doc('DOC-002').delete().catch(() => {});
    await db.collection('doctors').doc(sarahUid).delete().catch(() => {});
    await db.collection('doctors').doc('DOC-001').delete().catch(() => {});
  });

  beforeEach(() => {
    clock.reset();
  });

  it('login-sync returns canonical domain doctorId for registered doctor accounts', async () => {
    const res = await request(app)
      .post('/api/auth/login-sync')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('doctor');
    expect(res.body.data.doctorId).toBe('DOC-002');
  });

  it('login-sync returns DOC-001 for Dr. Sarah Smith account', async () => {
    const res = await request(app)
      .post('/api/auth/login-sync')
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('doctor');
    expect(res.body.data.doctorId).toBe('DOC-001');
  });

  it('CROSS-DOCTOR DENIAL: Dr. Rahul Kumar (DOC-002) is forbidden from reading DOC-001 queue', async () => {
    const res = await request(app)
      .get('/api/queue/doctor/DOC-001/today')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/cannot access or modify another doctor's queue/i);
  });

  it('CROSS-DOCTOR DENIAL: Dr. Sarah Smith (DOC-001) is forbidden from reading DOC-002 queue', async () => {
    const res = await request(app)
      .get('/api/queue/doctor/DOC-002/today')
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/cannot access or modify another doctor's queue/i);
  });

  it('OWN-QUEUE ALLOWED: Dr. Rahul Kumar (DOC-002) successfully accesses DOC-002 queue', async () => {
    const res = await request(app)
      .get('/api/queue/doctor/DOC-002/today?date=2026-10-12')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('readyCandidates');
    expect(res.body.data).toHaveProperty('notCheckedIn');
  });

  it('OWN-QUEUE ALLOWED: Dr. Sarah Smith (DOC-001) successfully accesses DOC-001 queue', async () => {
    const res = await request(app)
      .get('/api/queue/doctor/DOC-001/today')
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('readyCandidates');
  });

  it('CALL-NEXT CROSS-DOCTOR DENIAL: Dr. Rahul (DOC-002) cannot trigger call-next on DOC-001 queue', async () => {
    const res = await request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor')
      .send({ doctorId: 'DOC-001' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/cannot access or modify another doctor's queue/i);
  });

  it('CALL-NEXT CROSS-DOCTOR DENIAL: Dr. Sarah (DOC-001) cannot trigger call-next on DOC-002 queue', async () => {
    const res = await request(app)
      .post('/api/queue/call-next')
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor')
      .send({ doctorId: 'DOC-002', date: '2026-10-12' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/cannot access or modify another doctor's queue/i);
  });

  it('SAFE FAILURE: Unauthenticated access to doctor queue is rejected with 401', async () => {
    const res = await request(app).get('/api/queue/doctor/DOC-002/today');
    expect(res.status).toBe(401);
  });

  it('SAFE FAILURE: Non-doctor role (patient) accessing doctor queue is rejected with 403', async () => {
    const res = await request(app)
      .get('/api/queue/doctor/DOC-002/today')
      .set('x-demo-uid', 'patient_uid_123')
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(403);
    expect(res.body.error?.message).toMatch(/restricted to doctors/i);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { getDb } from '../src/config/firebase.js';

describe('Regression: Doctor Schedule Ownership Authorization', () => {
  const doctorA_uid = 'test-doc-a-uid';
  const doctorB_uid = 'test-doc-b-uid';
  const admin_uid = 'test-admin-uid';
  const patient_uid = 'test-patient-uid';

  beforeAll(async () => {
    const db = getDb();
    if (db) {
      // Seed minimal doctor documents in test database
      await db.collection('doctors').doc(doctorA_uid).set({
        id: doctorA_uid,
        doctorId: doctorA_uid,
        uid: doctorA_uid,
        doctorUid: doctorA_uid,
        name: 'Dr. Test Alpha',
        departmentId: 'dept-gen',
        active: true
      }, { merge: true });

      await db.collection('doctors').doc(doctorB_uid).set({
        id: doctorB_uid,
        doctorId: doctorB_uid,
        uid: doctorB_uid,
        doctorUid: doctorB_uid,
        name: 'Dr. Test Beta',
        departmentId: 'dept-gen',
        active: true
      }, { merge: true });
    }
  });

  it('1. Unauthenticated request to /api/doctors/schedule is rejected with 401', async () => {
    const res = await request(app)
      .put('/api/doctors/schedule')
      .send({ slotMinutes: 15 });

    expect(res.statusCode).toBe(401);
  });

  it('2. Patient role attempting to modify schedule is rejected with 403', async () => {
    const res = await request(app)
      .put('/api/doctors/schedule')
      .set('x-demo-uid', patient_uid)
      .set('x-demo-role', 'patient')
      .send({ slotMinutes: 15 });

    expect(res.statusCode).toBe(403);
  });

  it('3. Doctor A attempting to modify Doctor B schedule is rejected with 403 Forbidden', async () => {
    const res = await request(app)
      .put(`/api/doctors/${doctorB_uid}/schedule`)
      .set('x-demo-uid', doctorA_uid)
      .set('x-demo-role', 'doctor')
      .send({
        slotMinutes: 15,
        workingDays: [1, 2, 3],
        workingHours: { start: '09:00', end: '13:00' }
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/only modify your own schedule/i);
  });

  it('4. Doctor A can modify their own schedule with 200 OK', async () => {
    const res = await request(app)
      .put(`/api/doctors/${doctorA_uid}/schedule`)
      .set('x-demo-uid', doctorA_uid)
      .set('x-demo-role', 'doctor')
      .send({
        slotMinutes: 15,
        workingDays: [1, 2, 3],
        workingHours: { start: '09:00', end: '13:00' }
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.schedule.slotMinutes).toBe(15);
  });

  it('5. Doctor A calling /api/doctors/schedule without param modifies their own schedule with 200 OK', async () => {
    const res = await request(app)
      .put('/api/doctors/schedule')
      .set('x-demo-uid', doctorA_uid)
      .set('x-demo-role', 'doctor')
      .send({
        slotMinutes: 20,
        workingDays: [1, 2],
        workingHours: { start: '10:00', end: '14:00' }
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.schedule.slotMinutes).toBe(20);
  });

  it('6. Admin can modify Doctor B schedule with 200 OK', async () => {
    const res = await request(app)
      .put(`/api/doctors/${doctorB_uid}/schedule`)
      .set('x-demo-uid', admin_uid)
      .set('x-demo-role', 'admin')
      .send({
        slotMinutes: 30,
        workingDays: [1, 2, 3, 4],
        workingHours: { start: '09:00', end: '15:00' }
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.schedule.slotMinutes).toBe(30);
  });
});

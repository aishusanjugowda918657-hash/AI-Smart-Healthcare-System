import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { processNoShowsAndReminders } from '../src/services/schedulerService.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Hospital Real-Time Workflow & No-Show Engine Integration Tests', () => {
  let db;

  beforeAll(async () => {
    db = assertDbConnected();
    await db.collection('doctors').doc('doc-uid-001').set({
      id: 'doc-uid-001',
      doctorId: 'DOC-001',
      doctorUid: 'doc-uid-001',
      fullName: 'Dr. Realtime Workflow',
      departmentId: 'dept-card',
      role: 'doctor'
    }, { merge: true });
    await db.collection('users').doc('doc-uid-001').set({
      role: 'doctor',
      doctorId: 'DOC-001'
    }, { merge: true });
  });

  afterAll(async () => {
    if (db) {
      try {
        await db.collection('doctors').doc('doc-uid-001').delete();
        await db.collection('users').doc('doc-uid-001').delete();
      } catch (err) {}
    }
  });

  it('New patient registration starts with clean state (no fake history/prescriptions)', async () => {
    const res = await request(app)
      .get('/api/prescriptions/my-prescriptions')
      .set('x-demo-uid', 'newly-registered-patient-999')
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('New patient starts with 0 active medicine reminders', async () => {
    const res = await request(app)
      .get('/api/reminders/today')
      .set('x-demo-uid', 'newly-registered-patient-999')
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('5-minute grace period no-show scheduler marks expired booked appointments as NO_SHOW', async () => {
    const todayStr = new Date().toISOString().split('T')[0];

    // Book an appointment for an earlier time slot today (e.g. 07:00 AM)
    const bookRes = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'noshow-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        doctorUid: 'doc-uid-001',
        departmentId: 'dept-card',
        date: todayStr,
        timeSlot: '07:00 AM',
        reason: 'Morning Consultation'
      });

    expect(bookRes.status).toBe(201);

    // Run No-Show Scheduler
    const result = await processNoShowsAndReminders();
    expect(result.success).toBe(true);
    expect(result.processedNoShows).toBeGreaterThanOrEqual(1);

    // Verify appointment status updated to NO_SHOW
    const apptsRes = await request(app)
      .get('/api/appointments/my-appointments')
      .set('x-demo-uid', 'noshow-patient-001')
      .set('x-demo-role', 'patient');

    expect(apptsRes.status).toBe(200);
    const appt = apptsRes.body.data.find(a => a.id === bookRes.body.data.id);
    expect(appt).toBeDefined();
    expect(appt.status).toBe('NO_SHOW');
  });

  it('Doctor completing consultation auto-generates digital prescription and medicine reminders', async () => {
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Book appointment
    const bookRes = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'rx-test-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        doctorUid: 'doc-uid-001',
        departmentId: 'dept-card',
        date: todayStr,
        timeSlot: '11:45 AM',
        reason: 'Regular BP Checkup'
      });

    expect(bookRes.status).toBe(201);
    const healthId = bookRes.body.data.patientHealthId;

    // 2. Doctor creates digital prescription
    const rxRes = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientUid: 'rx-test-patient-001',
        patientHealthId: healthId,
        appointmentId: bookRes.body.data.id,
        medicines: [
          {
            name: 'Aspirin',
            dosage: '75 mg',
            frequency: 'Once Daily',
            reminderTimes: ['08:00 AM'],
            timing: 'after_food',
            durationDays: 7
          }
        ],
        doctorNotes: 'Take daily after breakfast.'
      });

    expect(rxRes.status).toBe(201);
    expect(rxRes.body.success).toBe(true);

    // 3. Patient checks today's reminders
    const remRes = await request(app)
      .get('/api/reminders/today')
      .set('x-demo-uid', 'rx-test-patient-001')
      .set('x-demo-role', 'patient');

    expect(remRes.status).toBe(200);
    expect(remRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(remRes.body.data[0].medicineName).toBe('Aspirin');
  });
});

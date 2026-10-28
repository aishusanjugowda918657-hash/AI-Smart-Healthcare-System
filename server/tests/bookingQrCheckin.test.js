import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';

const makeHash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

async function seedAppointment(db, overrides = {}) {
  const raw = crypto.randomBytes(16).toString('hex');
  const id = 'test_appt_' + Date.now() + '_' + Math.floor(Math.random() * 99999);
  const todayStr = new Date().toISOString().split('T')[0];
  const firestoreDoc = {
    id, patientHealthId: 'PHI-TEST-000001-A', patientName: 'Test Patient',
    ownerUid: 'patient-uid-test', bookedByUid: 'patient-uid-test',
    doctorId: 'dr-test-001', doctorName: 'Dr. Test', departmentId: 'dept-gen',
    date: todayStr, bookedStartAt: '10:00', status: 'booked',
    tokenNumber: 1, tokenLabel: 'G-001',
    checkinCodeHash: makeHash(raw), checkInCodeHash: makeHash(raw),
    qrPayload: 'APPT:' + id + ':' + raw, createdAt: new Date(), ...overrides
  };
  await db.collection('appointments').doc(id).set(firestoreDoc);
  return { ...firestoreDoc, rawCode: raw };
}

describe('Booking QR Checkin Regression', () => {
  let db;
  beforeEach(() => { db = assertDbConnected(); clock.reset(); });
  afterEach(() => { clock.reset(); });

  it('1. qrPayload is APPT format', async () => {
    const { id, rawCode } = await seedAppointment(db);
    const snap = await db.collection('appointments').doc(id).get();
    expect(snap.data().qrPayload).toBe('APPT:' + id + ':' + rawCode);
    expect(snap.data().qrPayload).toMatch(/^APPT:[^:]+:.+/);
  });

  it('2. Both hash fields written', async () => {
    const { id, rawCode } = await seedAppointment(db);
    const snap = await db.collection('appointments').doc(id).get();
    const h = makeHash(rawCode);
    expect(snap.data().checkinCodeHash).toBe(h);
    expect(snap.data().checkInCodeHash).toBe(h);
  });

  it('3. Valid QR sets checked_in', async () => {
    const { id, rawCode } = await seedAppointment(db);
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('checked_in');
    const snap = await db.collection('appointments').doc(id).get();
    expect(snap.data().status).toBe('checked_in');
  });

  it('4. Invalid format returns 400 INVALID_QR_FORMAT', async () => {
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'NOT_VALID' });
    expect(res.status).toBe(400);
    expect(res.body.error && res.body.error.code).toBe('INVALID_QR_FORMAT');
  });

  it('5. Tampered code returns 400 INVALID_CODE', async () => {
    const { id } = await seedAppointment(db);
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':wrongcode' });
    expect(res.status).toBe(400);
    expect(res.body.error && res.body.error.code).toBe('INVALID_CODE');
  });

  it('6. Already checked-in returns 409', async () => {
    const { id, rawCode } = await seedAppointment(db, { status: 'checked_in' });
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    expect(res.status).toBe(409);
    expect(res.body.error && res.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('7. Cancelled appointment returns 4xx', async () => {
    const { id, rawCode } = await seedAppointment(db, { status: 'cancelled' });
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('8. Wrong date returns 400 WRONG_DATE', async () => {
    const { id, rawCode } = await seedAppointment(db, { date: '2020-01-01' });
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    expect(res.status).toBe(400);
    expect(res.body.error && res.body.error.code).toBe('WRONG_DATE');
  });

  it('9. Non-existent appointment returns 404', async () => {
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:does_not_exist_xyz:fakeCode' });
    expect(res.status).toBe(404);
  });

  it('10. Patient role cannot call /api/checkin/scan (403)', async () => {
    const { id, rawCode } = await seedAppointment(db);
    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-patient-uid')
      .set('x-demo-role', 'patient')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    expect(res.status).toBe(403);
  });

  it('11. Status persists in Firestore after check-in', async () => {
    const { id, rawCode } = await seedAppointment(db);
    await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });
    const snap = await db.collection('appointments').doc(id).get();
    expect(snap.data().status).toBe('checked_in');
    expect(snap.data().checkedInAt).toBeDefined();
  });

  it('12. Check-in succeeds for appointment today at 11:15 AM at 11:17 AM without false TOO_EARLY', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const { id, rawCode } = await seedAppointment(db, {
      date: todayStr,
      timeSlot: '11:15',
      bookedStartAt: '11:15'
    });

    const res = await request(app).post('/api/checkin/scan')
      .set('x-demo-uid', 'mock-reception-uid')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: 'APPT:' + id + ':' + rawCode });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('checked_in');
  });

  it('13. Dispatches check-in notification on-demand when patient checks queue status', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    clock.set(`${todayStr}T11:17:00+05:30`);
    const patientUid = 'patient_notify_test_' + Date.now();
    const { id } = await seedAppointment(db, {
      date: todayStr,
      timeSlot: '11:15',
      bookedStartAt: '11:15',
      patientUid,
      ownerUid: patientUid,
      patientName: 'Ravi Kumar Test',
      checkinAtTimeReminderSent: false
    });

    const res = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.queueSummary.checkinRequired).toBe(true);

    // Verify notification was created in notifications collection
    const notifSnap = await db.collection('notifications')
      .where('uid', '==', patientUid)
      .get();

    expect(notifSnap.empty).toBe(false);
    const notifs = notifSnap.docs.map(d => d.data());
    const checkinNotif = notifs.find(n => n.type === 'CHECKIN_REMINDER' || n.type === 'CHECKIN_OVERDUE');
    expect(checkinNotif).toBeDefined();
    expect(checkinNotif.title).toContain('Please check in');
  });
});


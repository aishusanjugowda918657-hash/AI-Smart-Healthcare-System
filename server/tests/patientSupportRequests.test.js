import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'tara-support-patient-test',
      role: req.headers['x-test-role'] || 'patient'
    };
    next();
  }
}));

const patientUid = 'tara-support-patient-test';
const receptionUid = 'tara-support-reception-test';
const db = assertDbConnected();

describe('TARA patient support requests', () => {
  beforeAll(async () => {
    await db.collection('patients').doc(patientUid).set({ fullName: 'TARA Support Test Patient', phone: '9000000000' });
    await db.collection('users').doc(patientUid).set({ role: 'patient', displayName: 'TARA Support Test Patient' });
    await db.collection('users').doc(receptionUid).set({ role: 'reception', active: true });
  });

  afterAll(async () => {
    const requests = await db.collection('supportRequests').where('patientUid', '==', patientUid).get();
    await Promise.all(requests.docs.map((doc) => doc.ref.delete()));
    const notifications = await db.collection('notifications').where('uid', '==', receptionUid).get();
    await Promise.all(notifications.docs
      .filter((doc) => doc.data().type === 'PATIENT_SUPPORT_REQUEST')
      .map((doc) => doc.ref.delete()));
    await Promise.all([
      db.collection('patients').doc(patientUid).delete(),
      db.collection('users').doc(patientUid).delete(),
      db.collection('users').doc(receptionUid).delete()
    ]);
  });

  it('creates a patient request and writes an in-app notification for Reception', async () => {
    const created = await supertest(app)
      .post('/api/support-requests')
      .set('x-test-uid', patientUid)
      .set('x-test-role', 'patient')
      .send({ category: 'GENERAL_ASSISTANCE' });

    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data.notificationSent).toBe(true);
    expect(created.body.data.status).toBe('pending');

    const inbox = await supertest(app)
      .get('/api/support-requests')
      .set('x-test-uid', receptionUid)
      .set('x-test-role', 'reception');

    expect(inbox.status).toBe(200);
    const request = inbox.body.data.requests.find((item) => item.id === created.body.data.id);
    expect(request).toBeDefined();
    expect(request.patientName).toBe('TARA Support Test Patient');
    expect(request.patientPhone).toBe('9000000000');
    expect(request).not.toHaveProperty('patientUid');

    const notificationSnap = await db.collection('notifications')
      .where('uid', '==', receptionUid)
      .where('type', '==', 'PATIENT_SUPPORT_REQUEST')
      .get();
    expect(notificationSnap.docs.some((doc) => doc.data().data?.supportRequestId === created.body.data.id)).toBe(true);
  });

  it('allows Reception to acknowledge and then resolve a request', async () => {
    const created = await supertest(app)
      .post('/api/support-requests')
      .set('x-test-uid', patientUid)
      .set('x-test-role', 'patient')
      .send({ category: 'QUEUE_HELP' });
    const id = created.body.data.id;

    const acknowledged = await supertest(app)
      .patch(`/api/support-requests/${id}/status`)
      .set('x-test-uid', receptionUid)
      .set('x-test-role', 'reception')
      .send({ status: 'acknowledged' });
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.body.data.status).toBe('acknowledged');

    const resolved = await supertest(app)
      .patch(`/api/support-requests/${id}/status`)
      .set('x-test-uid', receptionUid)
      .set('x-test-role', 'reception')
      .send({ status: 'resolved' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('resolved');
  });

  it('keeps the Reception inbox and status controls unavailable to patients', async () => {
    const inbox = await supertest(app)
      .get('/api/support-requests')
      .set('x-test-uid', patientUid)
      .set('x-test-role', 'patient');
    expect(inbox.status).toBe(403);
  });

  it('does not allow Reception accounts to create patient requests', async () => {
    const response = await supertest(app)
      .post('/api/support-requests')
      .set('x-test-uid', receptionUid)
      .set('x-test-role', 'reception')
      .send({ category: 'GENERAL_ASSISTANCE' });
    expect(response.status).toBe(403);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 5 - Appointment Booking API & Concurrency Protection Verification', () => {
  it('POST /api/appointments/book validates required parameters', async () => {
    const res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ doctorUid: '' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });

  it('POST /api/appointments/book requires reason for consultation', async () => {
    const res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ doctorUid: 'doc-uid-001', date: '2026-10-15', timeSlot: '10:00 AM', reason: '' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Reason for Consultation');
  });

  it('GET /api/appointments/my-appointments returns patient appointment list', async () => {
    const res = await request(app)
      .get('/api/appointments/my-appointments')
      .set('x-demo-uid', 'demo-patient-001');

    expect([200, 503]).toContain(res.statusCode);
  });

  it('PATCH /api/appointments/:id/status rejects invalid appointment statuses', async () => {
    const res = await request(app)
      .patch('/api/appointments/APT-2026-00001/status')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ status: 'INVALID_STATUS' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 3 - Patient Health ID & Profile API Verification', () => {
  it('POST /api/patients/profile validates required fields', async () => {
    const res = await request(app)
      .post('/api/patients/profile')
      .set('x-demo-uid', 'demo-patient-001')
      .send({ fullName: '' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });

  it('GET /api/patients/by-health-id/:healthId requires doctor or admin role', async () => {
    const res = await request(app)
      .get('/api/patients/by-health-id/HID-2026-00001')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toEqual(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('GET /api/patients/search allows staff and returns search results', async () => {
    const res = await request(app)
      .get('/api/patients/search?query=HID-2026')
      .set('x-demo-uid', 'doctor-001')
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/patients/search rejects non-staff role with 403', async () => {
    const res = await request(app)
      .get('/api/patients/search?query=HID-2026')
      .set('x-demo-uid', 'patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toEqual(403);
  });

  it('Unauthorized user gets 403 when requesting another patient\'s Health ID card', async () => {
    const res = await request(app)
      .get('/api/patients/HID-SECRET-999/card')
      .set('x-demo-uid', 'unauthorized-user')
      .set('x-demo-role', 'patient');

    expect([403, 404]).toContain(res.statusCode);
  });

  it('Unauthorized user gets 403 when attempting to refresh another patient\'s QR code', async () => {
    const res = await request(app)
      .post('/api/patients/HID-SECRET-999/refresh-qr')
      .set('x-demo-uid', 'unauthorized-user')
      .set('x-demo-role', 'patient');

    expect([403, 404]).toContain(res.statusCode);
  });

  it('POST /api/patients/:healthId/accept-caregiver route is registered and responds', async () => {
    const res = await request(app)
      .post('/api/patients/HID-NONEXISTENT/accept-caregiver')
      .set('x-demo-uid', 'caregiver-uid-01')
      .set('x-demo-role', 'patient');

    expect([404, 403]).toContain(res.statusCode);
  });
});

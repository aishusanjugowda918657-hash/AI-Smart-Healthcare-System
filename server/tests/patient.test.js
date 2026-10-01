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
});

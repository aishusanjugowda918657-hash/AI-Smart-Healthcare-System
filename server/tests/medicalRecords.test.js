import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 8 - Medical Records Security & Access Control Verification', () => {
  it('POST /api/medical-records requires doctor or admin role', async () => {
    const res = await request(app)
      .post('/api/medical-records')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        patientHealthId: 'HID-2026-00001',
        diagnosisNotes: 'Attempting patient write'
      });

    expect(res.statusCode).toEqual(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('POST /api/medical-records validates required diagnosis notes', async () => {
    const res = await request(app)
      .post('/api/medical-records')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: 'HID-2026-00001',
        diagnosisNotes: ''
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });

  it('GET /api/medical-records/patient/:patientHealthId enforces patient-to-patient data isolation', async () => {
    const res = await request(app)
      .get('/api/medical-records/patient/HID-2026-99999')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect([403, 503]).toContain(res.statusCode);
  });
});

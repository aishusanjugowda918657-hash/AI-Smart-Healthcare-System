import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 9 - Digital Prescription Authorization Verification', () => {
  it('POST /api/prescriptions rejects patient attempts to create prescriptions', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        patientHealthId: 'HID-2026-00001',
        medicines: [{ name: 'Paracetamol', dosage: '500mg' }]
      });

    expect(res.statusCode).toEqual(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('POST /api/prescriptions validates required medicines list', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: 'HID-2026-00001',
        medicines: []
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });
});

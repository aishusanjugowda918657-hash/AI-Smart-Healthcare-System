import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

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

  it('GET /api/medical-records/my-history resolves patient profile by ownerUid', async () => {
    const db = assertDbConnected();
    const testUid = `pat-owner-uid-${Date.now()}`;
    const testHealthId = `PHI-TEST-${Date.now()}`;

    await db.collection('patients').doc(testHealthId).set({
      healthId: testHealthId,
      patientHealthId: testHealthId,
      ownerUid: testUid,
      name: 'Owner UID Test',
      relation: 'self'
    });

    try {
      const res = await request(app)
        .get('/api/medical-records/my-history')
        .set('x-demo-uid', testUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.healthId).toBe(testHealthId);
    } finally {
      await db.collection('patients').doc(testHealthId).delete();
    }
  });

  it('GET /api/medical-records/my-history returns 404 when patient profile does not exist (no fallback to hardcoded HID)', async () => {
    const unregUid = `unreg-pat-${Date.now()}`;
    const res = await request(app)
      .get('/api/medical-records/my-history')
      .set('x-demo-uid', unregUid)
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Patient profile or Health ID not found');
  });

  it('GET /api/prescriptions/:id denies cross-patient access when prescription belongs to another patient', async () => {
    const db = assertDbConnected();
    const rxId = `rx-auth-test-${Date.now()}`;
    const targetHealthId = `PHI-VICTIM-${Date.now()}`;

    await db.collection('prescriptions').doc(rxId).set({
      prescriptionId: rxId,
      patientHealthId: targetHealthId,
      medicines: [{ name: 'Amoxicillin' }]
    });

    try {
      const res = await request(app)
        .get(`/api/prescriptions/${rxId}`)
        .set('x-demo-uid', 'attacker-patient-uid')
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    } finally {
      await db.collection('prescriptions').doc(rxId).delete();
    }
  });

  it('POST /api/reminders/sync rejects unauthorized sync of another patient prescription', async () => {
    const db = assertDbConnected();
    const rxId = `rx-sync-test-${Date.now()}`;
    const targetHealthId = `PHI-SYNC-VICTIM-${Date.now()}`;

    await db.collection('prescriptions').doc(rxId).set({
      prescriptionId: rxId,
      patientHealthId: targetHealthId,
      medicines: [{ name: 'Paracetamol' }]
    });

    try {
      const res = await request(app)
        .post('/api/reminders/sync')
        .set('x-demo-uid', 'unauthorized-sync-patient')
        .set('x-demo-role', 'patient')
        .send({ prescriptionId: rxId });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    } finally {
      await db.collection('prescriptions').doc(rxId).delete();
    }
  });

  it('POST /api/internal/tick rejects requests with missing or invalid secret', async () => {
    const noSecretRes = await request(app)
      .post('/api/internal/tick')
      .send({});
    expect(noSecretRes.statusCode).toBe(403);
    expect(noSecretRes.body.success).toBe(false);

    const badSecretRes = await request(app)
      .post('/api/internal/tick')
      .set('x-tick-secret', 'completely-wrong-secret')
      .send({});
    expect(badSecretRes.statusCode).toBe(403);
    expect(badSecretRes.body.success).toBe(false);
  });
});

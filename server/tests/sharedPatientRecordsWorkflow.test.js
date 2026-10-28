import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Shared Patient Records Workflow & Doctor Access Integration', () => {
  const patientHealthId = 'HID-SHARE-TEST-001';
  const patientUid = 'user-share-test-patient';
  const doctorUid = 'cyeu58WkM5ekSgUcU5n95BBKwKJ3';
  const doctorDisplayId = 'DOC-GEN-ASK-001';

  beforeAll(async () => {
    const db = assertDbConnected();

    // Clean up existing test grants
    const prevGrants = await db.collection('accessGrants').where('patientHealthId', '==', patientHealthId).get();
    for (const d of prevGrants.docs) await d.ref.delete();

    // Seed doctor profile
    await db.collection('doctors').doc(doctorUid).set({
      uid: doctorUid,
      doctorUid,
      doctorId: 'DOC-001',
      displayId: doctorDisplayId,
      name: 'Dr. Aarti Sunil Kamath',
      departmentId: 'dept-gen',
      specialization: 'General Medicine',
      status: 'ACTIVE'
    }, { merge: true });

    // Seed patient
    await db.collection('patients').doc(patientHealthId).set({
      healthId: patientHealthId,
      patientHealthId,
      ownerUid: patientUid,
      uid: patientUid,
      name: 'Ravi Kumar',
      fullName: 'Ravi Kumar',
      dob: '1985-05-15',
      age: 39,
      gender: 'male',
      bloodGroup: 'B+',
      contactNumber: '+91 9876543210'
    }, { merge: true });
  });

  it('Patient grants medical history share to doctor using display ID DOC-GEN-ASK-001', async () => {
    const res = await request(app)
      .post(`/api/patients/${patientHealthId}/share`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({
        granteeUid: doctorDisplayId,
        hours: 24
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect([doctorDisplayId, doctorUid]).toContain(res.body.data.granteeUid);
    expect(res.body.data.doctorAliases).toContain(doctorDisplayId);
  });

  it('Doctor fetches shared patients via GET /api/doctor/patients/shared-with-me and receives patient', async () => {
    const res = await request(app)
      .get('/api/doctor/patients/shared-with-me')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const shared = res.body.data.find((p) => p.patientHealthId === patientHealthId);
    expect(shared).toBeDefined();
    expect(shared.fullName).toBe('Ravi Kumar');
    expect(shared.hours).toBe(24);
    expect(shared.gender).toBe('male');
  });

  it('Doctor checks access for the patient via GET /api/doctor/patients/:healthId/access-check', async () => {
    const res = await request(app)
      .get(`/api/doctor/patients/${patientHealthId}/access-check`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hasAccess).toBe(true);
    expect(res.body.data.reason).toBe('active_share_grant');
  });

  it('Doctor can view patient medical history via GET /api/patients/:healthId/history', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientHealthId}/history`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.healthId).toBe(patientHealthId);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('After share is revoked, access check reports false and history returns 403', async () => {
    // Revoke share as patient
    const listRes = await request(app)
      .get(`/api/patients/${patientHealthId}/shares`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(listRes.status).toBe(200);
    const grants = listRes.body.data || [];
    expect(grants.length).toBeGreaterThan(0);
    const grantId = grants[0].id;

    const revokeRes = await request(app)
      .delete(`/api/patients/${patientHealthId}/share/${grantId}`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');
    expect(revokeRes.status).toBe(200);

    // Doctor checks shared list -> should no longer contain patient
    const sharedRes = await request(app)
      .get('/api/doctor/patients/shared-with-me')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');
    expect(sharedRes.status).toBe(200);
    const stillPresent = sharedRes.body.data.some((p) => p.patientHealthId === patientHealthId);
    expect(stillPresent).toBe(false);

    // Doctor checks access
    const checkRes = await request(app)
      .get(`/api/doctor/patients/${patientHealthId}/access-check`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.data.hasAccess).toBe(false);

    // Doctor tries to view history -> 403
    const histRes = await request(app)
      .get(`/api/patients/${patientHealthId}/history`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');
    expect(histRes.status).toBe(403);
  });
});

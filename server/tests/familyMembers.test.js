import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { getDb } from '../src/config/firebase.js';

describe('Phase 16 - Family Members & Dependents API Verification', () => {
  let createdDependentHealthId = null;
  let createdDependentId = null;

  beforeAll(async () => {
    const db = getDb();
    if (db) {
      await db.collection('doctors').doc('doc-uid-001').set({
        id: 'doc-uid-001',
        doctorId: 'DOC-001',
        doctorUid: 'doc-uid-001',
        fullName: 'Dr. Family Pediatrician',
        departmentId: 'dept-ped',
        role: 'doctor'
      }, { merge: true });
      await db.collection('users').doc('doc-uid-001').set({
        role: 'doctor',
        doctorId: 'DOC-001'
      }, { merge: true });

      const snap = await db.collection('patients')
        .where('primaryAccountUid', '==', 'demo-patient-001')
        .get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (d.fullName === 'Uncle Bob' || d.fullName === 'Aarav Doe') {
          await doc.ref.delete();
        }
      }
    }
  });

  afterAll(async () => {
    const db = getDb();
    if (db) {
      try {
        await db.collection('doctors').doc('doc-uid-001').delete();
        await db.collection('users').doc('doc-uid-001').delete();
      } catch (err) {}
    }
  });

  it('GET /api/patients/family rejects unauthenticated requests (missing auth)', async () => {
    const res = await request(app)
      .get('/api/patients/family');

    expect(res.statusCode).toEqual(401);
    expect(res.body.message).toContain('Unauthorized');
  });

  it('POST /api/patients/family rejects unauthenticated requests (missing auth)', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .send({ fullName: 'Unauthenticated Test' });

    expect(res.statusCode).toEqual(401);
    expect(res.body.message).toContain('Unauthorized');
  });

  it('POST /api/patients/family validates required fields', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({ fullName: '' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });

  it('POST /api/patients/family rejects invalid relationship value', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        fullName: 'Test Relative',
        dob: '2010-01-01',
        gender: 'male',
        relationship: 'InvalidRelationType'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Invalid relationship');
  });

  it('POST /api/patients/family requires custom text when relationship is "Other"', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        fullName: 'Test Relative',
        dob: '2010-01-01',
        gender: 'male',
        relationship: 'Other',
        customRelationship: ''
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Please specify the relationship');
  });

  it('POST /api/patients/family creates family member with "Other" relationship and custom text', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        fullName: 'Uncle Bob',
        dob: '1975-03-20',
        gender: 'male',
        relationship: 'Other',
        customRelationship: 'Maternal Uncle'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fullName).toBe('Uncle Bob');
    expect(res.body.data.relationship).toBe('Maternal Uncle');
    expect(res.body.data.relationshipOther).toBe('Maternal Uncle');
  });

  it('POST /api/patients/family creates family member with unique Health ID', async () => {
    const res = await request(app)
      .post('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        fullName: 'Aarav Doe',
        dob: '2018-06-12',
        gender: 'male',
        relationship: 'Son'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fullName).toBe('Aarav Doe');
    expect(res.body.data.relationship).toBe('Son');
    expect(res.body.data.primaryAccountUid).toBe('demo-patient-001');
    expect(res.body.data.isDependent).toBe(true);
    expect(res.body.data.patientHealthId).toMatch(/^(PHI|HID)-\d{4}-[0-9A-Z]{5,6}(-[0-9A-Z])?$/);

    createdDependentHealthId = res.body.data.patientHealthId;
    createdDependentId = res.body.data.patientUid;
  });

  it('GET /api/patients/family returns family members owned by authenticated user', async () => {
    const res = await request(app)
      .get('/api/patients/family')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const match = res.body.data.find((m) => m.fullName === 'Aarav Doe');
    expect(match).toBeDefined();
    expect(match.relationship).toBe('Son');
  });

  it('GET /api/patients/family prevents access to another patient\'s family members', async () => {
    const res = await request(app)
      .get('/api/patients/family')
      .set('x-demo-uid', 'another-patient-999')
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);

    const match = res.body.data.find((m) => m.fullName === 'Aarav Doe');
    expect(match).toBeUndefined();
  });

  it('POST /api/appointments/book creates appointment for dependent using dependent Health ID', async () => {
    if (!createdDependentId) return;

    const testYear = 2030 + Math.floor(Math.random() * 5);
    const testMonth = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
    const testDay = String(Math.floor(10 + Math.random() * 15)).padStart(2, '0');
    const testHour = String(Math.floor(8 + Math.random() * 8)).padStart(2, '0');
    const testMin = String(Math.floor(Math.random() * 4) * 15).padStart(2, '0');
    const testDate = `${testYear}-${testMonth}-${testDay}`;
    const testSlot = `${testHour}:${testMin}`;

    const res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        patientId: createdDependentId,
        doctorUid: 'doc-uid-001',
        departmentId: 'dept-ped',
        date: testDate,
        timeSlot: testSlot,
        reason: 'Pediatric checkup for son'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.patientUid).toBe(createdDependentId);
    expect(res.body.data.patientHealthId).toBe(createdDependentHealthId);
    expect(res.body.data.bookedBy).toBe('demo-patient-001');
  });

  it('POST /api/appointments/book blocks booking for dependent owned by another patient', async () => {
    if (!createdDependentId) return;

    const res = await request(app)
      .post('/api/appointments/book')
      .set('x-demo-uid', 'unauthorized-patient-002')
      .set('x-demo-role', 'patient')
      .send({
        patientId: createdDependentId,
        doctorUid: 'doc-uid-001',
        departmentId: 'dept-ped',
        date: '2026-10-16',
        timeSlot: '11:30',
        reason: 'Unauthorized booking'
      });

    expect(res.statusCode).toEqual(403);
    expect(res.body.message).toContain('Security Error');
  });
});

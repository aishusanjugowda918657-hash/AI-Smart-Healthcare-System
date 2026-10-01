import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 16 - Family Members & Dependents API Verification', () => {
  let createdDependentHealthId = null;
  let createdDependentId = null;

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
    expect(res.body.data.patientHealthId).toMatch(/^HID-\d{4}-\d{5}$/);

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

    const testDate = `2028-06-${Math.floor(10 + Math.random() * 15)}`;
    const testSlot = `${Math.floor(10 + Math.random() * 8)}:00`;

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

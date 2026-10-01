import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Phase 17 - Natural-Language Patient Information Agent API', () => {

  it('POST /api/patient-agent/query returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .send({ question: 'John Doe what disease is he suffering from?' });

    expect(res.status).toBe(401);
  });

  it('POST /api/patient-agent/query returns 403 for non-doctor/non-admin roles', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'patient-user-001')
      .set('x-demo-role', 'patient')
      .send({ question: 'John Doe what disease is he suffering from?' });

    expect(res.status).toBe(403);
  });

  it('POST /api/patient-agent/query answers medical conditions for single matching patient (John Doe)', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'John Doe what disease is he suffering from?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.patient.fullName || res.body.patient.name).toBe('John Doe');
    expect(res.body.intent).toBe('MEDICAL_CONDITIONS');
    expect(res.body.answer).toBeDefined();
    expect(res.body.sources).toContain('patients');
  });

  it('POST /api/patient-agent/query handles duplicate patient names with status duplicate', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'Uncle Bob what disease is he suffering from?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('duplicate');
    expect(res.body.count).toBeGreaterThan(1);
    expect(res.body.matches).toBeDefined();
    expect(res.body.message).toContain('Multiple patients found with this name. Please enter the patient\'s unique ID.');
  });

  it('POST /api/patient-agent/query resolves patient record when uniqueId is provided after duplicate', async () => {
    // First query Uncle Bob to get a valid match ID
    const dupRes = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'Uncle Bob what disease is he suffering from?' });

    const validId = dupRes.body.matches[0].id;

    // Query with uniqueId
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'Uncle Bob what disease is he suffering from?', uniqueId: validId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.patient.id).toBe(validId);
    expect(res.body.answer).toBeDefined();
  });

  it('POST /api/patient-agent/query returns not_found for non-existent patient name', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'NonExistentPatient123 what medicines is he taking?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('not_found');
    expect(res.body.message).toBe('No patient found with this name.');
  });

  it('POST /api/patient-agent/query returns not_found for invalid uniqueId', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'Some question', uniqueId: 'invalid-id-xyz-999' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('not_found');
    expect(res.body.message).toBe('No patient found with this ID.');
  });

  it('POST /api/patient-agent/query explicitly states when data does not exist in records', async () => {
    // Kavita Patel has no recorded prescriptions or followups
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'When is Kavita Patel\'s next follow-up?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.answer).toMatch(/No upcoming follow-up|No information|No record/i);
  });
});

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as geminiService from '../src/services/geminiService.js';
import { assertDbConnected } from '../src/config/firebase.js';

import { fallbackParseQuestion } from '../src/services/patientAgentService.js';

// Seeded patient IDs for cleanup
const SEEDED_IDS = ['test-john-doe-001', 'test-uncle-bob-001', 'test-uncle-bob-002', 'test-kavita-patel-001'];

describe('Phase 17 - Natural-Language Patient Information Agent API', () => {
  beforeAll(async () => {
    const db = assertDbConnected();
    const batch = db.batch();

    // Single patient: Jonathan Doe
    batch.set(db.collection('patients').doc('test-john-doe-001'), {
      id: 'test-john-doe-001',
      fullName: 'Jonathan Doe',
      nameLower: 'jonathan doe',
      age: 35,
      conditions: ['Hypertension', 'Type 2 Diabetes'],
      createdAt: new Date()
    });

    // Duplicate patient: Uncle Bob (×2)
    batch.set(db.collection('patients').doc('test-uncle-bob-001'), {
      id: 'test-uncle-bob-001',
      fullName: 'Uncle Bob',
      nameLower: 'uncle bob',
      age: 55,
      conditions: ['Arthritis'],
      createdAt: new Date()
    });
    batch.set(db.collection('patients').doc('test-uncle-bob-002'), {
      id: 'test-uncle-bob-002',
      fullName: 'Uncle Bob',
      nameLower: 'uncle bob',
      age: 62,
      conditions: ['Hypertension'],
      createdAt: new Date()
    });

    // Patient with no prescriptions/followups: Kavita Unique Patel
    batch.set(db.collection('patients').doc('test-kavita-patel-001'), {
      id: 'test-kavita-patel-001',
      fullName: 'Kavita Unique Patel',
      nameLower: 'kavita unique patel',
      age: 45,
      conditions: [],
      createdAt: new Date()
    });

    await batch.commit();
  });

  afterAll(async () => {
    const db = assertDbConnected();
    const batch = db.batch();
    SEEDED_IDS.forEach((id) => batch.delete(db.collection('patients').doc(id)));
    await batch.commit();
  });

  beforeEach(() => {
    vi.spyOn(geminiService, 'generateText').mockImplementation(async (prompt) => {
      if (prompt.includes('NLP parsing engine')) {
        const match = prompt.match(/DOCTOR QUESTION:\s*"([^"]+)"/i);
        const q = match ? match[1] : prompt;
        const parsed = fallbackParseQuestion(q);
        let name = '';
        if (/John Doe/i.test(q)) name = 'John Doe';
        if (/Uncle Bob/i.test(q)) name = 'Uncle Bob';
        if (/Kavita Patel/i.test(q)) name = 'Kavita Patel';
        return JSON.stringify({ patientName: name, intent: parsed.intent });
      }
      throw new Error('Fallback to deterministic answer formatter in test');
    });
  });

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

  it('POST /api/patient-agent/query answers medical conditions for single matching patient (Jonathan Doe)', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'Jonathan Doe what disease is he suffering from?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.patient.fullName || res.body.patient.name).toBe('Jonathan Doe');
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
    // Kavita Unique Patel has no recorded prescriptions or followups
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'When is Kavita Unique Patel\'s next follow-up?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.answer).toMatch(/No upcoming follow-up|No information|No record/i);
  });

  it('POST /api/patient-agent/query successfully answers generic example question when uniqueId is provided', async () => {
    const res = await request(app)
      .post('/api/patient-agent/query')
      .set('x-demo-uid', 'doc-uid-001')
      .set('x-demo-role', 'doctor')
      .send({ question: 'What medicines is the patient taking?', uniqueId: 'test-kavita-patel-001' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('answered');
    expect(res.body.patient.fullName || res.body.patient.name).toBe('Kavita Unique Patel');
    expect(res.body.intent).toBe('CURRENT_MEDICATIONS');
  });
});

/**
 * doctorConsultationWorkflowImprovements.test.js
 *
 * Comprehensive integration tests for Doctor Consultation Workspace:
 * 1. Role permissions (doctor/admin allowed, unauthorized blocked)
 * 2. Clinical visit creation with SOAP mappings (Chief Complaint, HPI/Exam, Diagnosis, Advice)
 * 3. Vital signs & BMI payload integrity (safe preservation without silent mutations)
 * 4. Digital prescription validation (requires name, dosage, frequency, duration)
 * 5. Follow-up scheduling confirmation
 * 6. Validation errors on missing required fields
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

const TEST_DOCTOR_UID = 'test-doc-consult-001';
const TEST_DOCTOR_ID = 'DOC-CONSULT-001';
const TEST_PATIENT_UID = 'test-patient-consult-001';
const TEST_HEALTH_ID = 'SCAI-TEST-CONSULT-001';
const TEST_APPOINTMENT_ID = 'appt-consult-test-001';

describe('Doctor Consultation Workspace & Clinical Visit Improvements', () => {
  beforeAll(async () => {
    const db = assertDbConnected();

    // 1. Seed test doctor profile
    await db.collection('users').doc(TEST_DOCTOR_UID).set({
      uid: TEST_DOCTOR_UID,
      role: 'doctor',
      doctorId: TEST_DOCTOR_ID,
      fullName: 'Dr. Jane Smith',
      email: 'dr.janesmith@smartcare-demo.com'
    });

    await db.collection('doctors').doc(TEST_DOCTOR_ID).set({
      id: TEST_DOCTOR_ID,
      doctorId: TEST_DOCTOR_ID,
      uid: TEST_DOCTOR_UID,
      fullName: 'Dr. Jane Smith',
      department: 'General Medicine',
      departmentId: 'dept-gen'
    });

    // 2. Seed test patient profile
    await db.collection('patients').doc(TEST_HEALTH_ID).set({
      id: TEST_HEALTH_ID,
      patientHealthId: TEST_HEALTH_ID,
      uid: TEST_PATIENT_UID,
      fullName: 'Michael Green',
      nameLower: 'michael green',
      age: 42,
      gender: 'male',
      allergies: ['Penicillin'],
      conditions: ['Hypertension'],
      weightKg: 78,
      heightCm: 175
    });

    // 3. Seed active appointment
    await db.collection('appointments').doc(TEST_APPOINTMENT_ID).set({
      id: TEST_APPOINTMENT_ID,
      appointmentId: TEST_APPOINTMENT_ID,
      patientHealthId: TEST_HEALTH_ID,
      doctorId: TEST_DOCTOR_UID,
      doctorUid: TEST_DOCTOR_UID,
      status: 'in_consultation',
      tokenLabel: 'A-01',
      date: new Date().toISOString().split('T')[0]
    });
  });

  afterAll(async () => {
    const db = assertDbConnected();
    const batch = db.batch();
    batch.delete(db.collection('users').doc(TEST_DOCTOR_UID));
    batch.delete(db.collection('doctors').doc(TEST_DOCTOR_ID));
    batch.delete(db.collection('patients').doc(TEST_HEALTH_ID));
    batch.delete(db.collection('appointments').doc(TEST_APPOINTMENT_ID));
    await batch.commit();
  });

  // ── 1. Role Permissions ───────────────────────────────────────────────────
  it('POST /api/visits rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/visits')
      .send({ healthId: TEST_HEALTH_ID, diagnosis: 'Hypertension' });

    expect(res.status).toBe(401);
  });

  it('POST /api/visits rejects non-doctor roles with 403', async () => {
    const res = await request(app)
      .post('/api/visits')
      .set('x-demo-uid', 'reception-user-001')
      .set('x-demo-role', 'reception')
      .send({ healthId: TEST_HEALTH_ID, diagnosis: 'Hypertension' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── 2. Validation Errors on Missing Fields ─────────────────────────────────
  it('POST /api/visits fails with 400 when Health ID is missing', async () => {
    const res = await request(app)
      .post('/api/visits')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send({ diagnosis: 'Acute bronchitis' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Health ID is required');
  });

  it('POST /api/visits fails with 400 when both Diagnosis and Reason are missing', async () => {
    const res = await request(app)
      .post('/api/visits')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send({ healthId: TEST_HEALTH_ID });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Diagnosis or Reason is required');
  });

  // ── 3. Successful Clinical Visit Saving with SOAP Fields ──────────────────
  it('POST /api/visits saves clinical record with SOAP structure and clean vitals', async () => {
    const visitPayload = {
      healthId: TEST_HEALTH_ID,
      patientHealthId: TEST_HEALTH_ID,
      appointmentId: TEST_APPOINTMENT_ID,
      reason: 'Recurrent retrosternal chest discomfort',
      findings: 'HPI: 3 days of dull aching pain.\n\nExamination: Heart sounds S1, S2 audible. No murmurs.',
      diagnosis: 'Atypical Angina Pectoris — Rule out ischemic heart disease',
      diagnosisNotes: 'Atypical Angina Pectoris — Rule out ischemic heart disease',
      advice: 'Avoid heavy lifting, rest adequately, maintain low-sodium diet',
      vitals: {
        bp: '135/88',
        pulse: '76',
        spo2: '98',
        temp: '98.4',
        sugar: '105',
        weightKg: '78',
        heightCm: '175'
      }
    };

    const res = await request(app)
      .post('/api/visits')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send(visitPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toMatch(/^vis-/);
    expect(res.body.data.diagnosis).toBe(visitPayload.diagnosis);
    expect(res.body.data.vitals.bp).toBe('135/88');
    expect(res.body.data.vitals.pulse).toBe('76');
  });

  // ── 4. Digital Prescription Validation & Creation ─────────────────────────
  it('POST /api/prescriptions blocks saving when required dose or frequency is missing', async () => {
    const invalidRxPayload = {
      patientHealthId: TEST_HEALTH_ID,
      appointmentId: TEST_APPOINTMENT_ID,
      medicines: [
        {
          name: 'Amoxicillin',
          dosage: '', // missing
          frequency: 'Twice Daily (1-0-1)',
          durationDays: 5
        }
      ],
      verifiedByDoctor: true
    };

    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send(invalidRxPayload);

    expect([400, 422]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/prescriptions succeeds with valid repeatable medicine items and verifiedByDoctor', async () => {
    const validRxPayload = {
      patientHealthId: TEST_HEALTH_ID,
      appointmentId: TEST_APPOINTMENT_ID,
      medicines: [
        {
          name: 'Paracetamol',
          strength: '500 mg',
          dosage: '1 tablet',
          route: 'Oral',
          frequency: 'Twice Daily (1-0-1)',
          durationDays: 5,
          timing: 'after_food',
          notes: 'Take with plenty of water'
        }
      ],
      verifiedByDoctor: true,
      doctorNotes: 'Prescribed for symptom relief'
    };

    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send(validRxPayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(/^rx-/);
    expect(res.body.data.medicines[0].name).toBe('Paracetamol');
    expect(res.body.data.status.toLowerCase()).toBe('active');
  });

  // ── 5. Follow-up Scheduling Confirmation ──────────────────────────────────
  it('POST /api/followups creates scheduled follow-up and returns confirmed followUpId', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const dateStr = futureDate.toISOString().split('T')[0];

    const followupPayload = {
      patientHealthId: TEST_HEALTH_ID,
      scheduledDate: dateStr,
      dueDate: dateStr,
      reason: 'Cardiac review & BP check',
      notes: 'Maintain morning BP log',
      importance: 'routine',
      appointmentId: TEST_APPOINTMENT_ID,
      patientName: 'Michael Green'
    };

    const res = await request(app)
      .post('/api/followups')
      .set('x-demo-uid', TEST_DOCTOR_UID)
      .set('x-demo-role', 'doctor')
      .send(followupPayload);

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.followUpId).toMatch(/^FLW-/);
    expect(res.body.data.scheduledDate).toBe(dateStr);
    expect(res.body.data.status).toBe('scheduled');
  });
});

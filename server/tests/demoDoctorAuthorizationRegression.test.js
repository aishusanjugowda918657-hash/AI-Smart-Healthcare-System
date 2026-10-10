import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { verifyRecordAccess } from '../src/controllers/medicalController.js';

describe('Demo Doctor Authorization Bypass & Clinical Records Regression Suite', () => {
  let db;
  const patientHealthId = 'HID-REGRESS-001';
  const patientUid = 'user-regress-patient-1';
  const otherPatientHealthId = 'HID-REGRESS-002';
  const otherPatientUid = 'user-regress-patient-2';

  const treatingDoctorUid = 'doc-regress-treating-01';
  const unrelatedDoctorUid = 'doc-regress-unrelated-02';
  const demoDoctorUid = 'demo-doctor-exploit-attempt';

  const rxId = 'rx-regress-001';
  const reportId = 'rep-regress-001';
  const reminderId = 'rem-regress-001';
  const followupId = 'fu-regress-001';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Seed Patient 1
    await db.collection('patients').doc(patientUid).set({
      uid: patientUid,
      ownerUid: patientUid,
      patientHealthId,
      name: 'Regression Patient 1',
      dob: '1990-01-01',
      allergies: [],
      conditions: []
    });

    // 2. Seed Patient 2
    await db.collection('patients').doc(otherPatientUid).set({
      uid: otherPatientUid,
      ownerUid: otherPatientUid,
      patientHealthId: otherPatientHealthId,
      name: 'Regression Patient 2',
      dob: '1995-05-05',
      allergies: [],
      conditions: []
    });

    // 3. Seed Treating Appointment: treatingDoctorUid treated patientHealthId within 90 days
    await db.collection('appointments').doc('appt-regress-treating').set({
      id: 'appt-regress-treating',
      doctorId: treatingDoctorUid,
      doctorUid: treatingDoctorUid,
      patientHealthId,
      date: new Date().toISOString().split('T')[0],
      status: 'completed'
    });

    // 4. Seed Clinical Records for Patient 1
    await db.collection('prescriptions').doc(rxId).set({
      id: rxId,
      prescriptionId: rxId,
      patientHealthId,
      healthId: patientHealthId,
      doctorId: treatingDoctorUid,
      status: 'active',
      medicines: [{ name: 'Amlodipine', dosage: '5mg', frequency: 'OD', durationDays: 14 }],
      createdAt: new Date()
    });

    await db.collection('medicineReminders').doc(reminderId).set({
      id: reminderId,
      patientHealthId,
      medicineName: 'Amlodipine',
      active: true,
      time: '08:00',
      createdAt: new Date()
    });

    await db.collection('followups').doc(followupId).set({
      id: followupId,
      followUpId: followupId,
      patientHealthId,
      healthId: patientHealthId,
      doctorId: treatingDoctorUid,
      status: 'pending',
      dueDate: new Date().toISOString().split('T')[0],
      createdAt: new Date()
    });
  });

  // =========================================================================
  // Test 1: Authorized treating doctor can access assigned patient's record
  // =========================================================================
  it('1. Authorized treating doctor can access assigned patient history (HTTP 200)', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientHealthId}/history`)
      .set('x-demo-uid', treatingDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.healthId).toBe(patientHealthId);
  });

  // =========================================================================
  // Test 2: Unrelated doctor is denied access (HTTP 403)
  // =========================================================================
  it('2. Unrelated doctor without active relationship is denied access (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientHealthId}/history`)
      .set('x-demo-uid', unrelatedDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain('Doctor does not have an active treatment relationship');
  });

  // =========================================================================
  // Test 3: Production request with demo-doctor UID CANNOT bypass authorization
  // =========================================================================
  it('3. In production mode, demo-doctor prefix CANNOT bypass treating doctor check (HTTP 403)', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      // Simulate production environment
      process.env.NODE_ENV = 'production';

      const directAccess = await verifyRecordAccess({
        db,
        uid: demoDoctorUid,
        role: 'doctor',
        patientHealthId
      });

      expect(directAccess.authorized).toBe(false);
      expect(directAccess.reason).toContain('Doctor does not have an active treatment relationship');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // =========================================================================
  // Test 4: Patient cannot access another patient's records
  // =========================================================================
  it('4. Cross-patient medical record access is strictly forbidden (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/patients/${otherPatientHealthId}/history`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  // =========================================================================
  // Test 5: Legitimate demo/emulator workflows continue to work in isolated test environment
  // =========================================================================
  it('5. In test environment, legitimate demo doctor bypass works only when NODE_ENV === test', async () => {
    expect(process.env.NODE_ENV).toBe('test');

    const testEnvAccess = await verifyRecordAccess({
      db,
      uid: 'demo-doctor-001',
      role: 'doctor',
      patientHealthId
    });

    expect(testEnvAccess.authorized).toBe(true);
    expect(testEnvAccess.reason).toBe('demo_treating_doctor');
  });

  // =========================================================================
  // Test 6: Prescriptions, Reminders, Follow-ups and PDF endpoints remain protected
  // =========================================================================
  it('6a. Unrelated doctor is denied access to prescriptions (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/prescriptions/patient/${patientHealthId}`)
      .set('x-demo-uid', unrelatedDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
  });

  it('6b. Unrelated doctor is denied access to medicine reminders (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/reminders/${patientHealthId}/adherence`)
      .set('x-demo-uid', unrelatedDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
  });

  it('6c. Unrelated doctor is denied access to prescription PDF export (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/prescriptions/${rxId}/pdf`)
      .set('x-demo-uid', unrelatedDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
  });

  it('6d. Unrelated doctor is denied access to patient history PDF export (HTTP 403)', async () => {
    const res = await request(app)
      .get(`/api/patients/${patientHealthId}/history.pdf`)
      .set('x-demo-uid', unrelatedDoctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(403);
  });

  // =========================================================================
  // Test 7: Verify doctorUid vs doctorId treating check in appointments
  // =========================================================================
  it('7. Treating doctor matching doctorUid (not doctorId) is granted access', async () => {
    const docUidOnly = 'doc-matching-doctorUid-field';
    await db.collection('appointments').doc('appt-doctorUid-test').set({
      id: 'appt-doctorUid-test',
      doctorId: 'DOC-SPECIALIST-99',
      doctorUid: docUidOnly,
      patientHealthId,
      date: new Date().toISOString().split('T')[0],
      status: 'confirmed'
    });

    const access = await verifyRecordAccess({
      db,
      uid: docUidOnly,
      role: 'doctor',
      patientHealthId
    });

    expect(access.authorized).toBe(true);
    expect(access.reason).toBe('treating_doctor_90days');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Security and Data-Integrity Audit Regression Suite', () => {
  let db;
  const testPatientAUid = 'sec-test-patient-a';
  const testPatientAHid = 'PHI-2026-SECA01-1';

  const testPatientBUid = 'sec-test-patient-b';
  const testPatientBHid = 'PHI-2026-SECB02-2';

  const testDoctorUid = 'sec-test-doctor-01';
  const testUnrelatedDoctorUid = 'sec-test-doctor-unrelated';
  const testAdminUid = 'sec-test-admin-01';

  const testCaregiverUid = 'sec-test-caregiver-01';
  const testDependentUid = 'sec-test-dependent-01';
  const testDependentHid = 'PHI-2026-SECDEP-1';

  const testRxId = 'rx-sec-test-001';
  const testDepRxId = 'rx-sec-test-dep-001';
  const testReminderId = 'rem-sec-test-001';
  const testDepRemId = 'rem-sec-test-dep-001';
  const testApptId = 'APT-2026-SEC01';
  const testWaitlistId = 'wl-sec-test-001';
  const testOfferId = 'off-sec-test-001';
  const testFollowupId = 'flw-sec-test-001';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Setup Patient A
    await db.collection('patients').doc(testPatientAUid).set({
      patientUid: testPatientAUid,
      patientHealthId: testPatientAHid,
      healthId: testPatientAHid,
      fullName: 'Security Test Patient A',
      ownerUid: testPatientAUid,
      createdAt: new Date()
    });

    // 2. Setup Patient B
    await db.collection('patients').doc(testPatientBUid).set({
      patientUid: testPatientBUid,
      patientHealthId: testPatientBHid,
      healthId: testPatientBHid,
      fullName: 'Security Test Patient B',
      ownerUid: testPatientBUid,
      createdAt: new Date()
    });

    // 2b. Setup Dependent Patient with Caregiver as primaryAccountUid
    await db.collection('patients').doc(testDependentUid).set({
      patientUid: testDependentUid,
      patientHealthId: testDependentHid,
      healthId: testDependentHid,
      fullName: 'Security Test Dependent',
      primaryAccountUid: testCaregiverUid,
      createdAt: new Date()
    });

    // 3. Setup Prescription for Patient B
    await db.collection('prescriptions').doc(testRxId).set({
      prescriptionId: testRxId,
      id: testRxId,
      patientUid: testPatientBUid,
      patientHealthId: testPatientBHid,
      patientName: 'Security Test Patient B',
      doctorUid: testDoctorUid,
      doctorName: 'Dr. Security Doctor',
      medicines: [{ name: 'Amoxicillin', dosage: '500mg', frequency: 'TDS', durationDays: 5 }],
      date: '2026-10-09',
      createdAt: new Date()
    });

    // 4. Setup Appointment for Patient B
    await db.collection('appointments').doc(testApptId).set({
      appointmentId: testApptId,
      id: testApptId,
      patientUid: testPatientBUid,
      patientHealthId: testPatientBHid,
      doctorUid: testDoctorUid,
      doctorId: 'DOC-SEC-01',
      date: '2026-10-10',
      timeSlot: '10:00',
      status: 'BOOKED',
      createdAt: new Date()
    });

    // 5. Setup Follow-up for Patient B
    await db.collection('followups').doc(testFollowupId).set({
      id: testFollowupId,
      followUpId: testFollowupId,
      patientUid: testPatientBUid,
      patientHealthId: testPatientBHid,
      healthId: testPatientBHid,
      doctorId: testDoctorUid,
      status: 'scheduled',
      scheduledDate: '2026-10-15',
      snoozeCount: 0,
      createdAt: new Date()
    });

    // 6. Setup Waitlist Entry for Patient B
    await db.collection('waitlist').doc(testWaitlistId).set({
      id: testWaitlistId,
      userId: testPatientBUid,
      healthId: testPatientBHid,
      status: 'waiting',
      createdAt: new Date()
    });

    // 7. Setup Slot Offer for Patient B
    await db.collection('offers').doc(testOfferId).set({
      id: testOfferId,
      userId: testPatientBUid,
      patientHealthId: testPatientBHid,
      status: 'open',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      kind: 'leave_reschedule',
      options: [{ type: 'join_waitlist' }],
      createdAt: new Date()
    });

    // 7b. Setup Prescription for Dependent
    await db.collection('prescriptions').doc(testDepRxId).set({
      prescriptionId: testDepRxId,
      id: testDepRxId,
      patientUid: testDependentUid,
      patientHealthId: testDependentHid,
      medicines: [{ name: 'Paracetamol', dosage: '250mg', frequency: 'BD', durationDays: 3 }],
      createdAt: new Date()
    });

    // 7c. Setup Reminder for Dependent
    await db.collection('reminders').doc(testDepRemId).set({
      id: testDepRemId,
      healthId: testDependentHid,
      patientHealthId: testDependentHid,
      medicineName: 'Paracetamol',
      time: '08:00',
      createdAt: new Date()
    });

    // 7d. Setup Reminder for Patient B
    await db.collection('reminders').doc(testReminderId).set({
      id: testReminderId,
      healthId: testPatientBHid,
      patientHealthId: testPatientBHid,
      medicineName: 'Amoxicillin',
      time: '14:00',
      createdAt: new Date()
    });
  });

  afterAll(async () => {
    // Clean up disposable test fixtures
    const batch = db.batch();
    batch.delete(db.collection('patients').doc(testPatientAUid));
    batch.delete(db.collection('patients').doc(testPatientBUid));
    batch.delete(db.collection('patients').doc(testDependentUid));
    batch.delete(db.collection('prescriptions').doc(testRxId));
    batch.delete(db.collection('prescriptions').doc(testDepRxId));
    batch.delete(db.collection('appointments').doc(testApptId));
    batch.delete(db.collection('followups').doc(testFollowupId));
    batch.delete(db.collection('waitlist').doc(testWaitlistId));
    batch.delete(db.collection('offers').doc(testOfferId));
    batch.delete(db.collection('reminders').doc(testReminderId));
    batch.delete(db.collection('reminders').doc(testDepRemId));
    await batch.commit().catch(() => {});
  });

  describe('1. Authentication and Authorization (IDOR & Role RBAC)', () => {
    it('Patient A CANNOT fetch Patient B last prescription (IDOR Blocked -> 403)', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/patient/${testPatientBHid}/last`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT download Patient B prescription PDF (IDOR Blocked -> 403)', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${testRxId}/pdf`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT escalate privilege by setting appointment status to COMPLETED (403)', async () => {
      const res = await request(app)
        .patch(`/api/appointments/${testApptId}/status`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({ status: 'COMPLETED' });

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT cancel another patient appointment via status update (403)', async () => {
      const res = await request(app)
        .patch(`/api/appointments/${testApptId}/status`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({ status: 'CANCELLED' });

      expect(res.statusCode).toBe(403);
    });

    it('Anonymous requests to run-no-show-check are denied (401)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check');

      expect(res.statusCode).toBe(401);
    });

    it('Non-admin requests to run-no-show-check are denied (403)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check')
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT inspect Patient B adherence metrics (403)', async () => {
      const res = await request(app)
        .get(`/api/reminders/${testPatientBHid}/adherence`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT view Patient B today reminders (403)', async () => {
      const res = await request(app)
        .get(`/api/reminders/today?healthId=${testPatientBHid}`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT modify Patient B follow-up action (403)', async () => {
      const res = await request(app)
        .patch(`/api/followups/${testFollowupId}`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'later' });

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT check in for Patient B appointment (403)', async () => {
      const res = await request(app)
        .post('/api/tokens/checkin')
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({ appointmentId: testApptId });

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT delete Patient B waitlist entry (403)', async () => {
      const res = await request(app)
        .delete(`/api/waitlist/${testWaitlistId}`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Patient A CANNOT accept Patient B slot offer (403)', async () => {
      const res = await request(app)
        .post(`/api/offers/${testOfferId}/accept`)
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({ optionIndex: 0 });

      expect(res.statusCode).toBe(403);
    });

    describe('1.1. Prescription and Reminder verifyRecordAccess Role Enforcement (Phase 23)', () => {
      it('Authorized patient can access their own last prescription (200)', async () => {
        const res = await request(app)
          .get(`/api/prescriptions/patient/${testPatientBHid}/last`)
          .set('x-demo-uid', testPatientBUid)
          .set('x-demo-role', 'patient');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Authorized patient can access their own today reminders (200)', async () => {
        const res = await request(app)
          .get(`/api/reminders/today?healthId=${testPatientBHid}`)
          .set('x-demo-uid', testPatientBUid)
          .set('x-demo-role', 'patient');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Authorized caregiver can access permitted dependent last prescription (200)', async () => {
        const res = await request(app)
          .get(`/api/prescriptions/patient/${testDependentHid}/last`)
          .set('x-demo-uid', testCaregiverUid)
          .set('x-demo-role', 'patient');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Authorized caregiver can access permitted dependent today reminders (200)', async () => {
        const res = await request(app)
          .get(`/api/reminders/today?healthId=${testDependentHid}`)
          .set('x-demo-uid', testCaregiverUid)
          .set('x-demo-role', 'patient');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Authorized treating doctor can access permitted patient last prescription (200)', async () => {
        const res = await request(app)
          .get(`/api/prescriptions/patient/${testPatientBHid}/last`)
          .set('x-demo-uid', testDoctorUid)
          .set('x-demo-role', 'doctor');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Authorized treating doctor can access permitted patient today reminders (200)', async () => {
        const res = await request(app)
          .get(`/api/reminders/today?healthId=${testPatientBHid}`)
          .set('x-demo-uid', testDoctorUid)
          .set('x-demo-role', 'doctor');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Non-treating doctor receives 403 for another patient last prescription', async () => {
        const res = await request(app)
          .get(`/api/prescriptions/patient/${testPatientBHid}/last`)
          .set('x-demo-uid', testUnrelatedDoctorUid)
          .set('x-demo-role', 'doctor');

        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('Non-treating doctor receives 403 for another patient today reminders', async () => {
        const res = await request(app)
          .get(`/api/reminders/today?healthId=${testPatientBHid}`)
          .set('x-demo-uid', testUnrelatedDoctorUid)
          .set('x-demo-role', 'doctor');

        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('Admin retains access to last prescription (200)', async () => {
        const res = await request(app)
          .get(`/api/prescriptions/patient/${testPatientBHid}/last`)
          .set('x-demo-uid', testAdminUid)
          .set('x-demo-role', 'admin');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('Admin retains access to patient today reminders (200)', async () => {
        const res = await request(app)
          .get(`/api/reminders/today?healthId=${testPatientBHid}`)
          .set('x-demo-uid', testAdminUid)
          .set('x-demo-role', 'admin');

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });
  });

  describe('2. AI Safety and Emergency Interception', () => {
    it('Emergency symptoms (e.g. severe chest pain) trigger immediate emergency alert without calling external model', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({
          message: 'I am experiencing severe chest pain and dizziness',
          language: 'en'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isEmergency).toBe(true);
      expect(res.body.message || res.body.response).toContain('EMERGENCY ALERT');
      expect(res.body.message || res.body.response).toContain('108');
    });

    it('Hindi emergency symptoms trigger 108 emergency response', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientAUid)
        .set('x-demo-role', 'patient')
        .send({
          message: 'मुझे छाती में दर्द हो रहा है',
          language: 'hi'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.isEmergency).toBe(true);
      expect(res.body.message || res.body.response).toContain('108');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';

describe('Regression Tests: My Patients List & Appointment Reminders Fixes', () => {
  const db = assertDbConnected();
  const testDoctorUid = `doc_reg_${Date.now()}`;
  const testDoctorId = `DOC-REG-${Date.now()}`;
  const otherDoctorUid = `doc_other_${Date.now()}`;

  const patient1HealthId = `PHI-REG-1-${Date.now()}`;
  const patient2HealthId = `PHI-REG-2-${Date.now()}`;
  const patient3HealthId = `PHI-REG-3-${Date.now()}`;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const twoYearsAgoStr = twoYearsAgo.toISOString().split('T')[0];

  const createdDocs = [];

  beforeAll(async () => {
    // 1. Seed doctor profile
    const docRef = db.collection('doctors').doc(testDoctorUid);
    await docRef.set({
      uid: testDoctorUid,
      doctorUid: testDoctorUid,
      doctorId: testDoctorId,
      displayId: testDoctorId,
      fullName: 'Dr. Test Regression Doctor',
      departmentName: 'General Medicine'
    });
    createdDocs.push(docRef);

    // 2. Seed patients
    const p1Ref = db.collection('patients').doc(patient1HealthId);
    await p1Ref.set({
      patientHealthId: patient1HealthId,
      fullName: 'Patient Completed Yesterday',
      dob: '1990-01-01',
      gender: 'Male'
    });
    createdDocs.push(p1Ref);

    const p2Ref = db.collection('patients').doc(patient2HealthId);
    await p2Ref.set({
      patientHealthId: patient2HealthId,
      fullName: 'Patient Also Completed Yesterday',
      dob: '1985-05-15',
      gender: 'Female'
    });
    createdDocs.push(p2Ref);

    const p3Ref = db.collection('patients').doc(patient3HealthId);
    await p3Ref.set({
      patientHealthId: patient3HealthId,
      fullName: 'Patient No Show',
      dob: '2000-10-10',
      gender: 'Other'
    });
    createdDocs.push(p3Ref);

    // 3. Seed appointments
    // Appt 1: Completed yesterday under doctorId
    const appt1Ref = db.collection('appointments').doc(`apt-reg-1-${Date.now()}`);
    await appt1Ref.set({
      id: appt1Ref.id,
      patientHealthId: patient1HealthId,
      doctorId: testDoctorId,
      doctorUid: testDoctorUid,
      date: yesterdayStr,
      status: 'completed',
      patientName: 'Patient Completed Yesterday'
    });
    createdDocs.push(appt1Ref);

    // Appt 2: Completed yesterday under doctorUid (alias resolution check)
    const appt2Ref = db.collection('appointments').doc(`apt-reg-2-${Date.now()}`);
    await appt2Ref.set({
      id: appt2Ref.id,
      patientHealthId: patient2HealthId,
      doctorId: testDoctorUid,
      doctorUid: testDoctorUid,
      date: yesterdayStr,
      status: 'COMPLETED',
      patientName: 'Patient Also Completed Yesterday'
    });
    createdDocs.push(appt2Ref);

    // Appt 3: No-show yesterday (must NOT appear in My Patients)
    const appt3Ref = db.collection('appointments').doc(`apt-reg-3-${Date.now()}`);
    await appt3Ref.set({
      id: appt3Ref.id,
      patientHealthId: patient3HealthId,
      doctorId: testDoctorId,
      date: yesterdayStr,
      status: 'no_show',
      patientName: 'Patient No Show'
    });
    createdDocs.push(appt3Ref);

    // Appt 4: Completed 2 years ago (must NOT appear in 12-month window)
    const oldHealthId = `PHI-REG-OLD-${Date.now()}`;
    const pOldRef = db.collection('patients').doc(oldHealthId);
    await pOldRef.set({ patientHealthId: oldHealthId, fullName: 'Old Patient' });
    createdDocs.push(pOldRef);

    const appt4Ref = db.collection('appointments').doc(`apt-reg-4-${Date.now()}`);
    await appt4Ref.set({
      id: appt4Ref.id,
      patientHealthId: oldHealthId,
      doctorId: testDoctorId,
      date: twoYearsAgoStr,
      status: 'completed',
      patientName: 'Old Patient'
    });
    createdDocs.push(appt4Ref);
  });

  afterAll(async () => {
    for (const ref of createdDocs) {
      await ref.delete().catch(() => {});
    }
  });

  describe('Bug 1 Fix: Doctor My Patients endpoint', () => {
    it('returns completed patients seen in the last 12 months, resolving doctor aliases', async () => {
      const res = await request(app)
        .get('/api/doctor/patients/my-patients')
        .set('x-demo-uid', testDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const healthIds = res.body.data.map((p) => p.patientHealthId);
      // Must include the two completed patients from yesterday
      expect(healthIds).toContain(patient1HealthId);
      expect(healthIds).toContain(patient2HealthId);

      // Must NOT include the no-show patient
      expect(healthIds).not.toContain(patient3HealthId);

      // Must NOT include the 2-year-old appointment
      expect(healthIds.some((id) => id.includes('OLD'))).toBe(false);
    });

    it('returns empty list for a doctor with no completed consultations', async () => {
      const emptyDocUid = `doc-empty-${Date.now()}`;
      await db.collection('doctors').doc(emptyDocUid).set({
        uid: emptyDocUid,
        doctorId: `DOC-EMPTY-${Date.now()}`,
        fullName: 'Dr. Empty Patients'
      });

      const res = await request(app)
        .get('/api/doctor/patients/my-patients')
        .set('x-demo-uid', emptyDocUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);

      await db.collection('doctors').doc(emptyDocUid).delete().catch(() => {});
    });
  });

  describe('Bug 2 Fix: Appointment Reminder Suppression', () => {
    it('cancels reminder and does NOT notify if parent appointment record was deleted', async () => {
      const missingApptId = `appt-missing-${Date.now()}`;
      const remId = `rem-test-missing-${Date.now()}`;
      const patientUid = `pat-rem-missing-${Date.now()}`;

      const remRef = db.collection('reminders').doc(remId);
      await remRef.set({
        id: remId,
        appointmentId: missingApptId,
        type: 'appointment_2h',
        patientName: 'Ravi Test',
        receiverUids: [patientUid],
        title: 'Ravi Test: Appointment in 2 Hours',
        status: 'pending',
        dueAt: new Date(Date.now() - 60_000).toISOString()
      });
      createdDocs.push(remRef);

      const res = await processRemindersJob({ nowOverride: new Date() });
      expect(res.success).toBe(true);

      // Verify reminder was cancelled
      const freshRem = await remRef.get();
      expect(freshRem.data().status).toBe('cancelled');
      expect(freshRem.data().cancellationReason).toContain('Appointment record not found');
    });

    it('cancels reminder and does NOT notify if appointment is rescheduled', async () => {
      const reschedApptId = `appt-resched-${Date.now()}`;
      const remId = `rem-test-resched-${Date.now()}`;
      const patientUid = `pat-rem-resched-${Date.now()}`;

      const apptRef = db.collection('appointments').doc(reschedApptId);
      await apptRef.set({
        id: reschedApptId,
        status: 'rescheduled',
        date: todayStr,
        timeSlot: '16:00'
      });
      createdDocs.push(apptRef);

      const remRef = db.collection('reminders').doc(remId);
      await remRef.set({
        id: remId,
        appointmentId: reschedApptId,
        type: 'appointment_2h',
        patientName: 'Ravi Rescheduled',
        receiverUids: [patientUid],
        title: 'Ravi Rescheduled: Appointment in 2 Hours',
        status: 'pending',
        dueAt: new Date(Date.now() - 60_000).toISOString()
      });
      createdDocs.push(remRef);

      const res = await processRemindersJob({ nowOverride: new Date() });
      expect(res.success).toBe(true);

      const freshRem = await remRef.get();
      expect(freshRem.data().status).toBe('cancelled');
      expect(freshRem.data().cancellationReason).toContain('rescheduled');
    });

    it('cancels reminder and does NOT notify if appointment time has already passed', async () => {
      const pastApptId = `appt-past-${Date.now()}`;
      const remId = `rem-test-past-${Date.now()}`;
      const patientUid = `pat-rem-past-${Date.now()}`;

      const apptRef = db.collection('appointments').doc(pastApptId);
      await apptRef.set({
        id: pastApptId,
        status: 'booked',
        date: yesterdayStr,
        timeSlot: '09:00'
      });
      createdDocs.push(apptRef);

      const remRef = db.collection('reminders').doc(remId);
      await remRef.set({
        id: remId,
        appointmentId: pastApptId,
        type: 'appointment_2h',
        patientName: 'Ravi Past Appt',
        receiverUids: [patientUid],
        title: 'Ravi Past Appt: Appointment in 2 Hours',
        status: 'pending',
        dueAt: new Date(Date.now() - 60_000).toISOString()
      });
      createdDocs.push(remRef);

      const res = await processRemindersJob({ nowOverride: new Date() });
      expect(res.success).toBe(true);

      const freshRem = await remRef.get();
      expect(freshRem.data().status).toBe('cancelled');
      expect(freshRem.data().cancellationReason).toContain('already passed');
    });
  });
});

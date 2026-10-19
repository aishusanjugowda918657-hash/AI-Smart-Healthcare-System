import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { SlotStatus } from '../src/domain/constants.js';

describe('Phase 28 — Appointment and Queue Security Remediation Regression Suite', () => {
  let db;
  const testDate = '2026-11-20';
  const otherDate = '2026-11-21';
  const trackedDocIds = {
    appointments: new Set(),
    tokens: new Set(),
    slots: new Set(),
    doctors: new Set(),
    appointmentLocks: new Set(),
    patients: new Set()
  };

  beforeEach(() => {
    clock.reset();
    db = assertDbConnected();
  });

  afterEach(async () => {
    for (const id of trackedDocIds.appointments) {
      try { await db.collection('appointments').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.appointments.clear();

    for (const id of trackedDocIds.tokens) {
      try { await db.collection('tokens').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.tokens.clear();

    for (const id of trackedDocIds.slots) {
      try { await db.collection('slots').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.slots.clear();

    for (const id of trackedDocIds.doctors) {
      try { await db.collection('doctors').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.doctors.clear();

    for (const id of trackedDocIds.appointmentLocks) {
      try { await db.collection('appointment_locks').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.appointmentLocks.clear();

    for (const id of trackedDocIds.patients) {
      try { await db.collection('patients').doc(id).delete(); } catch (_) {}
    }
    trackedDocIds.patients.clear();
  });

  const helperSeedDoctor = async (doctorId, docUid, departmentId = 'dept-gen') => {
    trackedDocIds.doctors.add(doctorId);
    if (docUid && docUid !== doctorId) trackedDocIds.doctors.add(docUid);
    const docData = {
      id: doctorId,
      doctorId,
      uid: docUid,
      doctorUid: docUid,
      name: `Dr. ${doctorId}`,
      fullName: `Dr. ${doctorId}`,
      departmentId,
      departmentName: departmentId === 'dept-derm' ? 'Dermatology' : 'General Medicine',
      active: true
    };
    await db.collection('doctors').doc(doctorId).set(docData);
    if (docUid && docUid !== doctorId) {
      await db.collection('doctors').doc(docUid).set(docData);
    }
  };

  const helperSeedSlot = async (slotId, doctorId, date, time = '10:00') => {
    trackedDocIds.slots.add(slotId);
    await db.collection('slots').doc(slotId).set({
      id: slotId,
      doctorId,
      date,
      startAt: time,
      endAt: '10:10',
      status: SlotStatus.FREE,
      createdAt: new Date()
    });
  };

  describe('1. SEC-Q1: Staff-verified emergency priority in tokenController', () => {
    it('prevents patient from self-assigning staffVerified: true or EMERGENCY priority', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const patientUid = `patient_sec_q1_${rand}`;
      const apptId = `appt_sec_q1_${rand}`;
      const docUid = `doc_sec_q1_${rand}`;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        appointmentId: apptId,
        patientUid,
        patientHealthId: `HID-Q1-${rand}`,
        doctorUid: docUid,
        doctorId: 'DOC-Q1',
        departmentId: 'dept-gen',
        date: testDate,
        priorityCategory: 'STANDARD',
        status: 'booked'
      });

      // Patient attempts check-in with priorityCategory: 'EMERGENCY' and staffVerified: true
      const res = await request(app)
        .post('/api/tokens/checkin')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          appointmentId: apptId,
          priorityCategory: 'EMERGENCY',
          staffVerified: true
        });

      expect(res.status).toBe(201);
      const token = res.body.data;
      expect(token).toBeDefined();
      // Patient cannot self-declare staffVerified or override priority category
      expect(token.staffVerified).toBe(false);
      expect(token.priorityCategory).toBe('STANDARD');
      expect(token.priorityScore).toBe(100); // STANDARD score, NOT 300
    });

    it('allows authorized staff to verify emergency priority with score 300', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const staffUid = `nurse_sec_q1_${rand}`;
      const patientUid = `patient_q1_staff_${rand}`;
      const apptId = `appt_q1_staff_${rand}`;
      const docUid = `doc_q1_staff_${rand}`;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        appointmentId: apptId,
        patientUid,
        patientHealthId: `HID-Q1-STAFF-${rand}`,
        doctorUid: docUid,
        doctorId: 'DOC-Q1',
        departmentId: 'dept-gen',
        date: testDate,
        priorityCategory: 'EMERGENCY',
        status: 'booked'
      });

      // Authorized nurse performs staff verification
      const res = await request(app)
        .post('/api/tokens/checkin')
        .set('x-demo-uid', staffUid)
        .set('x-demo-role', 'nurse')
        .send({
          appointmentId: apptId,
          priorityCategory: 'EMERGENCY',
          staffVerified: true
        });

      expect(res.status).toBe(201);
      const token = res.body.data;
      expect(token.staffVerified).toBe(true);
      expect(token.priorityCategory).toBe('EMERGENCY');
      expect(token.priorityScore).toBe(300);
    });

    it('preserves ordinary priority behavior for standard and senior patients', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const patientUid = `senior_q1_${rand}`;
      const apptId = `appt_q1_senior_${rand}`;
      const docUid = `doc_q1_senior_${rand}`;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        appointmentId: apptId,
        patientUid,
        patientHealthId: `HID-Q1-SNR-${rand}`,
        doctorUid: docUid,
        doctorId: 'DOC-Q1',
        departmentId: 'dept-gen',
        date: testDate,
        priorityCategory: 'SENIOR',
        status: 'booked'
      });

      const res = await request(app)
        .post('/api/tokens/checkin')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({ appointmentId: apptId });

      expect(res.status).toBe(201);
      const token = res.body.data;
      expect(token.priorityCategory).toBe('SENIOR');
      expect(token.priorityScore).toBe(200);
      expect(token.staffVerified).toBe(false);
    });
  });

  describe('2. SEC-Q2: Client-controlled clinical level in bookingController', () => {
    it('ignores patient-supplied clinicalLevel: 3 when reasonText is routine', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-SEC2-${rand}`;
      const docUid = `doc_sec2_${rand}`;
      const slotId = `slot_sec2_${rand}`;
      const patientUid = `patient_sec2_${rand}`;
      const healthId = `HID-SEC2-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slotId, doctorId, testDate, '10:00');

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotId],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Routine checkup for seasonal allergies',
          clinicalLevel: 3,
          urgencySuggested: 'emergency',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(201);
      const appt = res.body.data;
      trackedDocIds.appointments.add(appt.id);
      trackedDocIds.tokens.add(`tok-${appt.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      // Patient input overridden by server triage: routine text evaluates to level 1 & STANDARD
      expect(appt.clinicalLevel).toBe(1);
      expect(appt.urgencySuggested).toBe('routine');
      expect(appt.priorityCategory).toBe('STANDARD');
    });

    it('escalates to clinicalLevel: 3 and EMERGENCY for genuine rule-triggered symptoms', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-SEC2-EMERG-${rand}`;
      const docUid = `doc_sec2_emerg_${rand}`;
      const slotId = `slot_sec2_emerg_${rand}`;
      const patientUid = `patient_sec2_emerg_${rand}`;
      const healthId = `HID-SEC2-EMERG-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slotId, doctorId, testDate, '10:30');

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotId],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Severe crushing chest pain radiating to left arm and difficulty breathing',
          clinicalLevel: 1, // Patient under-reported level
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(201);
      const appt = res.body.data;
      trackedDocIds.appointments.add(appt.id);
      trackedDocIds.tokens.add(`tok-${appt.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      // Server-side triage engine escalates based on emergency red flags
      expect(appt.clinicalLevel).toBe(3);
      expect(appt.urgencySuggested).toBe('emergency');
      expect(appt.priorityCategory).toBe('EMERGENCY');
    });

    it('permits authorized staff to triage and assign clinicalLevel', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-SEC2-STAFF-${rand}`;
      const docUid = `doc_sec2_staff_${rand}`;
      const slotId = `slot_sec2_staff_${rand}`;
      const staffUid = `nurse_triage_${rand}`;
      const healthId = `HID-SEC2-STAFF-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slotId, doctorId, testDate, '11:00');

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', staffUid)
        .set('x-demo-role', 'nurse')
        .send({
          slotIds: [slotId],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Patient presented with acute laceration requiring stitches',
          clinicalLevel: 2,
          urgencySuggested: 'urgent',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(201);
      const appt = res.body.data;
      trackedDocIds.appointments.add(appt.id);
      trackedDocIds.tokens.add(`tok-${appt.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      expect(appt.clinicalLevel).toBe(2);
      expect(appt.urgencySuggested).toBe('urgent');
      expect(appt.priorityCategory).toBe('HIGH');
    });
  });

  describe('3. BIZ-Q1: Concurrency-safe same-day duplicate booking prevention', () => {
    it('rejects a duplicate same-day booking for the same patient and doctor with 409 DUPLICATE_BOOKING', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-DUP-${rand}`;
      const docUid = `doc_dup_${rand}`;
      const slot1Id = `slot_dup_1_${rand}`;
      const slot2Id = `slot_dup_2_${rand}`;
      const patientUid = `patient_dup_${rand}`;
      const healthId = `HID-DUP-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slot1Id, doctorId, testDate, '09:00');
      await helperSeedSlot(slot2Id, doctorId, testDate, '09:30');

      // First booking succeeds
      const res1 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slot1Id],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'First consultation',
          disclaimerAck: { acknowledged: true }
        });

      expect(res1.status).toBe(201);
      trackedDocIds.appointments.add(res1.body.data.id);
      trackedDocIds.tokens.add(`tok-${res1.body.data.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      // Second booking for same patient, doctor, and date is rejected
      const res2 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slot2Id],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Duplicate consultation attempt',
          disclaimerAck: { acknowledged: true }
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error?.code || res.body?.code).toBe('DUPLICATE_BOOKING');
    });

    it('allows booking with a different doctor on the same date', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const docAId = `DOC-DUPA-${rand}`;
      const docBId = `DOC-DUPB-${rand}`;
      const docAUid = `doc_dupa_${rand}`;
      const docBUid = `doc_dupb_${rand}`;
      const slotAId = `slot_dupa_${rand}`;
      const slotBId = `slot_dupb_${rand}`;
      const patientUid = `patient_diff_doc_${rand}`;
      const healthId = `HID-DIFF-DOC-${rand}`;

      await helperSeedDoctor(docAId, docAUid, 'dept-gen');
      await helperSeedDoctor(docBId, docBUid, 'dept-derm');
      await helperSeedSlot(slotAId, docAId, testDate, '09:00');
      await helperSeedSlot(slotBId, docBId, testDate, '10:00');

      const resA = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotAId],
          patientHealthId: healthId,
          doctorId: docAId,
          date: testDate,
          reasonText: 'Consult Doctor A',
          disclaimerAck: { acknowledged: true }
        });
      expect(resA.status).toBe(201);
      trackedDocIds.appointments.add(resA.body.data.id);
      trackedDocIds.tokens.add(`tok-${resA.body.data.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${docAId}_${testDate}`);

      const resB = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotBId],
          patientHealthId: healthId,
          doctorId: docBId,
          departmentId: 'dept-derm',
          date: testDate,
          reasonText: 'Consult Doctor B',
          disclaimerAck: { acknowledged: true },
          sameDayAck: true
        });
      expect(resB.status).toBe(201);
      trackedDocIds.appointments.add(resB.body.data.id);
      trackedDocIds.tokens.add(`tok-${resB.body.data.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${docBId}_${testDate}`);
    });

    it('allows re-booking with the same doctor after the previous appointment is cancelled', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-CANCEL-${rand}`;
      const docUid = `doc_cancel_${rand}`;
      const slot1Id = `slot_cancel_1_${rand}`;
      const slot2Id = `slot_cancel_2_${rand}`;
      const patientUid = `patient_cancel_${rand}`;
      const healthId = `HID-CANCEL-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slot1Id, doctorId, testDate, '09:00');
      await helperSeedSlot(slot2Id, doctorId, testDate, '11:00');

      const res1 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slot1Id],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Initial booking to be cancelled',
          disclaimerAck: { acknowledged: true }
        });
      expect(res1.status).toBe(201);
      const appt1Id = res1.body.data.id;
      trackedDocIds.appointments.add(appt1Id);
      trackedDocIds.tokens.add(`tok-${appt1Id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      // Cancel the first appointment
      await request(app)
        .post(`/api/appointments/${appt1Id}/cancel`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({ reason: 'Need to reschedule' });

      // Rebooking on slot 2 should now succeed
      const res2 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slot2Id],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Rescheduled booking',
          disclaimerAck: { acknowledged: true }
        });

      expect(res2.status).toBe(201);
      trackedDocIds.appointments.add(res2.body.data.id);
      trackedDocIds.tokens.add(`tok-${res2.body.data.id}`);
    });

    it('safely handles concurrent duplicate requests so exactly one succeeds', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-CONC-${rand}`;
      const docUid = `doc_conc_${rand}`;
      const slot1Id = `slot_conc_1_${rand}`;
      const slot2Id = `slot_conc_2_${rand}`;
      const patientUid = `patient_conc_${rand}`;
      const healthId = `HID-CONC-${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      await helperSeedSlot(slot1Id, doctorId, testDate, '09:00');
      await helperSeedSlot(slot2Id, doctorId, testDate, '10:00');

      // Dispatch both bookings concurrently
      const [req1, req2] = await Promise.all([
        request(app)
          .post('/api/appointments')
          .set('x-demo-uid', patientUid)
          .set('x-demo-role', 'patient')
          .send({
            slotIds: [slot1Id],
            patientHealthId: healthId,
            doctorId,
            date: testDate,
            reasonText: 'Concurrent booking attempt 1',
            disclaimerAck: { acknowledged: true }
          }),
        request(app)
          .post('/api/appointments')
          .set('x-demo-uid', patientUid)
          .set('x-demo-role', 'patient')
          .send({
            slotIds: [slot2Id],
            patientHealthId: healthId,
            doctorId,
            date: testDate,
            reasonText: 'Concurrent booking attempt 2',
            disclaimerAck: { acknowledged: true }
          })
      ]);

      const statuses = [req1.status, req2.status].sort();
      // Exactly one must be 201 Created and the other must be 409 Conflict
      expect(statuses).toEqual([201, 409]);

      const successfulRes = req1.status === 201 ? req1 : req2;
      const failedRes = req1.status === 409 ? req1 : req2;

      expect(failedRes.body.error?.code || failedRes.body?.code).toBe('DUPLICATE_BOOKING');
      trackedDocIds.appointments.add(successfulRes.body.data.id);
      trackedDocIds.tokens.add(`tok-${successfulRes.body.data.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);
    });
  });

  describe('4. CODE-Q1: Hardcoded doctor UID fallback elimination', () => {
    it('fails safely with 400 INVALID_DOCTOR when doctor record is malformed or lacks UID mapping', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const malformedDoctorId = `DOC-MALFORMED-${rand}`;
      const slotId = `slot_mal_${rand}`;
      const patientUid = `patient_mal_${rand}`;
      const healthId = `HID-MAL-${rand}`;

      // Doctor record without uid, doctorUid, or user mapping
      trackedDocIds.doctors.add(malformedDoctorId);
      await db.collection('doctors').doc(malformedDoctorId).set({
        id: malformedDoctorId,
        doctorId: malformedDoctorId,
        name: 'Doctor Missing UID',
        departmentId: 'dept-gen'
        // uid and doctorUid intentionally omitted!
      });

      await helperSeedSlot(slotId, malformedDoctorId, testDate, '14:00');

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotId],
          patientHealthId: healthId,
          doctorId: malformedDoctorId,
          date: testDate,
          reasonText: 'Consultation with malformed doctor',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.code || res.body.code).toBe('INVALID_DOCTOR');
    });

    it('resolves doctorUid accurately from doctor document without hardcoded fallback', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-VALID-${rand}`;
      const realDocUid = `doc_real_uid_${rand}`;
      const slotId = `slot_valid_${rand}`;
      const patientUid = `patient_valid_${rand}`;
      const healthId = `HID-VALID-${rand}`;

      await helperSeedDoctor(doctorId, realDocUid);
      await helperSeedSlot(slotId, doctorId, testDate, '15:00');

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [slotId],
          patientHealthId: healthId,
          doctorId,
          date: testDate,
          reasonText: 'Consultation with valid doctor',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(201);
      const appt = res.body.data;
      trackedDocIds.appointments.add(appt.id);
      trackedDocIds.tokens.add(`tok-${appt.id}`);
      trackedDocIds.appointmentLocks.add(`dup_${healthId}_${doctorId}_${testDate}`);

      // Verify doctorUid matches actual docUid and is NOT the old hardcoded fallback
      expect(appt.doctorUid).toBe(realDocUid);
      expect(appt.doctorUid).not.toBe('tSuSTZkfrEDciNhzz4OZhKmYBFi5');

      // Check corresponding token document
      const tokenSnap = await db.collection('tokens').doc(`tok-${appt.id}`).get();
      expect(tokenSnap.exists).toBe(true);
      expect(tokenSnap.data().doctorUid).toBe(realDocUid);
      expect(tokenSnap.data().doctorUid).not.toBe('tSuSTZkfrEDciNhzz4OZhKmYBFi5');
    });
  });

  describe('5. Legacy Route (/api/appointments/book) Security Remediation', () => {
    it('rejects a second active booking for the same patient, doctor, and date, even at a different time', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-DUP-${rand}`;
      const docUid = `doc_leg_dup_${rand}`;
      const doctorUid = docUid;
      const patientUid = `patient_leg_dup_${rand}`;

      await helperSeedDoctor(doctorId, docUid);

      const res1 = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Initial consultation'
        });

      expect([200, 201]).toContain(res1.status);
      const appt1Id = res1.body.data.id || res1.body.data.appointmentId;
      trackedDocIds.appointments.add(appt1Id);
      trackedDocIds.tokens.add(`tok-${appt1Id}`);
      trackedDocIds.patients.add(patientUid);

      const res2 = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '11:00 AM',
          reason: 'Duplicate consultation attempt'
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error?.code || res2.body.code).toBe('DUPLICATE_BOOKING');
    });

    it('concurrent duplicate requests produce at most one successful booking', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-CONC-${rand}`;
      const docUid = `doc_leg_conc_${rand}`;
      const doctorUid = docUid;
      const patientUid = `patient_leg_conc_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(patientUid);

      const [req1, req2] = await Promise.all([
        request(app)
          .post('/api/appointments/book')
          .set('x-demo-uid', patientUid)
          .set('x-demo-role', 'patient')
          .send({
            doctorUid,
            date: testDate,
            timeSlot: '09:00 AM',
            reason: 'Concurrent booking attempt 1'
          }),
        request(app)
          .post('/api/appointments/book')
          .set('x-demo-uid', patientUid)
          .set('x-demo-role', 'patient')
          .send({
            doctorUid,
            date: testDate,
            timeSlot: '10:00 AM',
            reason: 'Concurrent booking attempt 2'
          })
      ]);

      const statuses = [req1.status, req2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const successfulRes = req1.status === 201 ? req1 : req2;
      const failedRes = req1.status === 409 ? req1 : req2;

      const apptId = successfulRes.body.data.id || successfulRes.body.data.appointmentId;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      expect(failedRes.body.error?.code || failedRes.body.code).toBe('DUPLICATE_BOOKING');
    });

    it('allows rebooking after the previous appointment is cancelled', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-REB-${rand}`;
      const docUid = `doc_leg_reb_${rand}`;
      const doctorUid = docUid;
      const patientUid = `patient_leg_reb_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(patientUid);

      const res1 = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Original appointment'
        });

      expect([200, 201]).toContain(res1.status);
      const appt1Id = res1.body.data.id || res1.body.data.appointmentId;
      trackedDocIds.appointments.add(appt1Id);
      trackedDocIds.tokens.add(`tok-${appt1Id}`);

      const cancelRes = await request(app)
        .patch(`/api/appointments/${appt1Id}/cancel`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(cancelRes.status).toBe(200);

      const res2 = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '10:30 AM',
          reason: 'Rebooking after cancellation'
        });

      expect([200, 201]).toContain(res2.status);
      const appt2Id = res2.body.data.id || res2.body.data.appointmentId;
      trackedDocIds.appointments.add(appt2Id);
      trackedDocIds.tokens.add(`tok-${appt2Id}`);
      expect(appt2Id).not.toBe(appt1Id);
    });

    it('patients cannot self-assign verified emergency priority score 300', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-EMERG-${rand}`;
      const docUid = `doc_leg_emerg_${rand}`;
      const doctorUid = docUid;
      const patientUid = `patient_leg_emerg_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(patientUid);

      const res = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Routine checkup for skin allergy',
          priorityCategory: 'EMERGENCY'
        });

      expect([200, 201]).toContain(res.status);
      const appt = res.body.data;
      const apptId = appt.id || appt.appointmentId;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      expect(appt.priorityCategory).not.toBe('EMERGENCY');
      expect(appt.priorityCategory).toBe('STANDARD');

      const tokenSnap = await db.collection('tokens').doc(`tok-${apptId}`).get();
      expect(tokenSnap.exists).toBe(true);
      const token = tokenSnap.data();
      expect(token.priorityScore).toBe(100);
      expect(token.priorityScore).not.toBe(300);
      expect(token.staffVerified).toBe(false);
      expect(token.priorityCategory).toBe('STANDARD');
    });

    it('preserves emergency priority score 300 when booked by authorized staff', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-STAFF-${rand}`;
      const docUid = `doc_leg_staff_${rand}`;
      const doctorUid = docUid;
      const staffUid = `staff_nurse_${rand}`;
      const patientUid = `patient_staff_triage_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(patientUid);

      // Pre-seed patient profile so staff can book for this patient
      await db.collection('patients').doc(patientUid).set({
        patientUid,
        fullName: 'Emergency Patient',
        patientHealthId: `HID-STAFF-${rand}`
      });

      const res = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', staffUid)
        .set('x-demo-role', 'nurse')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Severe acute cardiac distress verified at desk',
          priorityCategory: 'EMERGENCY',
          patientId: patientUid
        });

      expect([200, 201]).toContain(res.status);
      const appt = res.body.data;
      const apptId = appt.id || appt.appointmentId;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      expect(appt.priorityCategory).toBe('EMERGENCY');

      const tokenSnap = await db.collection('tokens').doc(`tok-${apptId}`).get();
      expect(tokenSnap.exists).toBe(true);
      const token = tokenSnap.data();
      expect(token.priorityScore).toBe(300);
      expect(token.staffVerified).toBe(true);
      expect(token.priorityCategory).toBe('EMERGENCY');
    });

    it('preserves senior priority category and score 200', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-SENIOR-${rand}`;
      const docUid = `doc_leg_senior_${rand}`;
      const doctorUid = docUid;
      const patientUid = `patient_leg_senior_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(patientUid);

      const res = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Routine wellness consultation',
          priorityCategory: 'SENIOR'
        });

      expect([200, 201]).toContain(res.status);
      const appt = res.body.data;
      const apptId = appt.id || appt.appointmentId;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      expect(appt.priorityCategory).toBe('SENIOR');

      const tokenSnap = await db.collection('tokens').doc(`tok-${apptId}`).get();
      expect(tokenSnap.exists).toBe(true);
      const token = tokenSnap.data();
      expect(token.priorityScore).toBe(200);
      expect(token.priorityCategory).toBe('SENIOR');
    });

    it('fails safely with 400 INVALID_DOCTOR when doctor identity resolution fails', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const patientUid = `patient_leg_nodoc_${rand}`;
      trackedDocIds.patients.add(patientUid);

      const res = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid: `non_existent_doc_${rand}`,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Checkup attempt with unmapped doctor'
        });

      expect(res.status).toBe(400);
      expect(res.body.error?.code || res.body.code).toBe('INVALID_DOCTOR');
    });

    it('preserves dependent-patient authorization (denies unauthorized, permits authorized)', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const doctorId = `DOC-LEG-DEP-${rand}`;
      const docUid = `doc_leg_dep_${rand}`;
      const doctorUid = docUid;
      const primaryUserUid = `primary_leg_user_${rand}`;
      const unauthorizedUserUid = `unauth_leg_user_${rand}`;
      const dependentPatientUid = `dep_leg_patient_${rand}`;

      await helperSeedDoctor(doctorId, docUid);
      trackedDocIds.patients.add(primaryUserUid);
      trackedDocIds.patients.add(unauthorizedUserUid);
      trackedDocIds.patients.add(dependentPatientUid);

      // Seed dependent patient record linked to primaryUserUid
      await db.collection('patients').doc(dependentPatientUid).set({
        patientUid: dependentPatientUid,
        primaryAccountUid: primaryUserUid,
        fullName: 'Child Patient',
        patientHealthId: `HID-DEP-${rand}`,
        createdAt: new Date()
      });

      // 1. Unauthorized caller attempts to book for dependent -> 403 Forbidden
      const unauthRes = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', unauthorizedUserUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Pediatric checkup by unauthorized caller',
          patientId: dependentPatientUid
        });

      expect(unauthRes.status).toBe(403);
      expect(unauthRes.body.success).toBe(false);

      // 2. Authorized primary account holder books for dependent -> 201 Created
      const authRes = await request(app)
        .post('/api/appointments/book')
        .set('x-demo-uid', primaryUserUid)
        .set('x-demo-role', 'patient')
        .send({
          doctorUid,
          date: testDate,
          timeSlot: '09:00 AM',
          reason: 'Pediatric checkup by parent',
          patientId: dependentPatientUid
        });

      expect([200, 201]).toContain(authRes.status);
      const appt = authRes.body.data;
      const apptId = appt.id || appt.appointmentId;
      trackedDocIds.appointments.add(apptId);
      trackedDocIds.tokens.add(`tok-${apptId}`);

      expect(appt.patientUid).toBe(dependentPatientUid);
      expect(appt.bookedByUid).toBe(primaryUserUid);
    });
  });
});

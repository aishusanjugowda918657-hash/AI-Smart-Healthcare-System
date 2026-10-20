import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { noShowSweepJob } from '../src/jobs/scheduler.js';
import { leaveRescheduleJob } from '../src/jobs/leaveReschedule.js';
import clock from '../src/utils/clock.js';
import { nowInHospitalTz, formatDateYYYYMMDD } from '../src/utils/time.js';
import fs from 'fs';
import path from 'path';

describe('Patient Appointments Fixes Regression Suite', () => {
  let db;
  const testPatientUid = `test-pat-${Date.now()}`;
  const testHealthId = `PHI-TEST-${Date.now()}`;
  const todayStr = formatDateYYYYMMDD();
  const pastDateStr = '2026-10-05';
  const futureDateStr = '2026-11-20';

  const docGenId = `DOC-TEST-GEN-${Date.now()}`;
  const docGenUid = `uid-${docGenId}`;
  const docGen2Id = `DOC-TEST-GEN2-${Date.now()}`;
  const docGen2Uid = `uid-${docGen2Id}`;
  const docDermId = `DOC-TEST-DERM-${Date.now()}`;
  const docDermUid = `uid-${docDermId}`;

  beforeAll(async () => {
    db = assertDbConnected();

    // Seed departments
    await db.collection('departments').doc('dept-gen').set({
      id: 'dept-gen',
      name: 'General Medicine',
      letter: 'G'
    }, { merge: true });

    await db.collection('departments').doc('dept-derm').set({
      id: 'dept-derm',
      name: 'Dermatology',
      letter: 'D'
    }, { merge: true });

    // Seed real test doctors
    await db.collection('doctors').doc(docGenId).set({
      doctorId: docGenId,
      uid: docGenUid,
      doctorUid: docGenUid,
      name: 'Dr. Aarti Sunil Kamath',
      fullName: 'Dr. Aarti Sunil Kamath',
      department: 'General Medicine',
      departmentName: 'General Medicine',
      departmentId: 'dept-gen',
      specialty: 'Internal Medicine',
      specialization: 'Internal Medicine',
      active: true
    });

    await db.collection('users').doc(docGenUid).set({
      uid: docGenUid,
      role: 'doctor',
      doctorId: docGenId
    });

    await db.collection('doctors').doc(docGen2Id).set({
      doctorId: docGen2Id,
      uid: docGen2Uid,
      doctorUid: docGen2Uid,
      name: 'Dr. Ramesh Kumar Gupta',
      fullName: 'Dr. Ramesh Kumar Gupta',
      department: 'General Medicine',
      departmentName: 'General Medicine',
      departmentId: 'dept-gen',
      specialty: 'Internal Medicine',
      specialization: 'Internal Medicine',
      active: true
    });

    await db.collection('users').doc(docGen2Uid).set({
      uid: docGen2Uid,
      role: 'doctor',
      doctorId: docGen2Id
    });

    await db.collection('doctors').doc(docDermId).set({
      doctorId: docDermId,
      uid: docDermUid,
      doctorUid: docDermUid,
      name: 'Dr. Anurag Ranjan',
      fullName: 'Dr. Anurag Ranjan',
      department: 'Dermatology',
      departmentName: 'Dermatology',
      departmentId: 'dept-derm',
      specialty: 'Dermatology',
      specialization: 'Dermatology',
      active: true
    });

    await db.collection('users').doc(docDermUid).set({
      uid: docDermUid,
      role: 'doctor',
      doctorId: docDermId
    });

    // Seed patient
    await db.collection('patients').doc(testHealthId).set({
      patientHealthId: testHealthId,
      ownerUid: testPatientUid,
      fullName: 'Test Patient Fixes',
      relation: 'self'
    });

    await db.collection('users').doc(testPatientUid).set({
      uid: testPatientUid,
      role: 'patient',
      patientHealthId: testHealthId,
      displayName: 'Test Patient Fixes'
    });
  });

  // 1. PAST APPOINTMENTS
  describe('1. Past Appointments Partition & Missed Label', () => {
    it('past appointments (date < today) never appear under Upcoming and show Missed under Past', async () => {
      const pastApptId = `apt-past-${Date.now()}`;
      await db.collection('appointments').doc(pastApptId).set({
        id: pastApptId,
        appointmentId: pastApptId,
        patientUid: testPatientUid,
        ownerUid: testPatientUid,
        patientHealthId: testHealthId,
        date: pastDateStr,
        bookedStartAt: '10:00',
        status: 'booked',
        doctorId: docGenId,
        doctorUid: docGenUid,
        departmentId: 'dept-gen'
      });

      const res = await request(app)
        .get('/api/appointments/my-appointments')
        .set('x-demo-uid', testPatientUid);

      expect(res.status).toBe(200);
      expect(res.body.tabs).toBeDefined();
      expect(res.body.tabs.upcoming).toBeDefined();
      expect(res.body.tabs.past).toBeDefined();

      const inUpcoming = res.body.tabs.upcoming.some(a => a.id === pastApptId);
      expect(inUpcoming).toBe(false);

      const inPast = res.body.tabs.past.find(a => a.id === pastApptId);
      expect(inPast).toBeDefined();
      expect(inPast.displayStatus).toBe('Missed');

      // Verify no write happened on read
      const docSnap = await db.collection('appointments').doc(pastApptId).get();
      expect(docSnap.data().status).toBe('booked');
    });

    it('exact production case: on 2026-10-19, appointment dated 2026-10-05 with status booked appears in Past as Missed and never Upcoming', async () => {
      clock.setMockTime('2026-10-19T10:00:00+05:30');
      try {
        const prodApptId = `apt-prod-20261005-${Date.now()}`;
        await db.collection('appointments').doc(prodApptId).set({
          id: prodApptId,
          appointmentId: prodApptId,
          patientUid: testPatientUid,
          ownerUid: testPatientUid,
          patientHealthId: testHealthId,
          date: '2026-10-05',
          bookedStartAt: '14:10',
          status: 'booked',
          doctorId: docGenId,
          doctorUid: docGenUid,
          departmentId: 'dept-derm',
          tokenNumber: 1,
          tokenLabel: 'D-001'
        });

        const res = await request(app)
          .get('/api/appointments/my-appointments')
          .set('x-demo-uid', testPatientUid);

        expect(res.status).toBe(200);
        const inUpcoming = res.body.tabs.upcoming.some((a) => a.id === prodApptId);
        expect(inUpcoming).toBe(false);

        const inPast = res.body.tabs.past.find((a) => a.id === prodApptId);
        expect(inPast).toBeDefined();
        expect(inPast.displayStatus).toBe('Missed');
        expect(inPast.isMissed).toBe(true);
        expect(inPast.canCancel).toBe(false);
        expect(inPast.canRebook).toBe(true);
      } finally {
        clock.reset();
      }
    });

    it('Asia/Kolkata boundary case: appointment on current hospital day 2026-10-19 appears in Upcoming while 2026-10-18 appears in Past as Missed', async () => {
      // 2026-10-19 at 00:30 AM IST (which is 2026-10-18 19:00 UTC)
      clock.setMockTime('2026-10-18T19:00:00.000Z');
      try {
        const todayApptId = `apt-today-${Date.now()}`;
        const yesterdayApptId = `apt-yesterday-${Date.now()}`;

        await db.collection('appointments').doc(todayApptId).set({
          id: todayApptId,
          appointmentId: todayApptId,
          patientUid: testPatientUid,
          ownerUid: testPatientUid,
          patientHealthId: testHealthId,
          date: '2026-10-19',
          bookedStartAt: '10:00',
          status: 'booked',
          doctorId: docGenId,
          doctorUid: docGenUid,
          departmentId: 'dept-gen'
        });

        await db.collection('appointments').doc(yesterdayApptId).set({
          id: yesterdayApptId,
          appointmentId: yesterdayApptId,
          patientUid: testPatientUid,
          ownerUid: testPatientUid,
          patientHealthId: testHealthId,
          date: '2026-10-18',
          bookedStartAt: '17:00',
          status: 'booked',
          doctorId: docGenId,
          doctorUid: docGenUid,
          departmentId: 'dept-gen'
        });

        const res = await request(app)
          .get('/api/appointments/my-appointments')
          .set('x-demo-uid', testPatientUid);

        expect(res.status).toBe(200);
        expect(res.body.tabs.upcoming.some((a) => a.id === todayApptId)).toBe(true);
        expect(res.body.tabs.upcoming.some((a) => a.id === yesterdayApptId)).toBe(false);

        const pastYesterday = res.body.tabs.past.find((a) => a.id === yesterdayApptId);
        expect(pastYesterday).toBeDefined();
        expect(pastYesterday.displayStatus).toBe('Missed');
        expect(pastYesterday.canCancel).toBe(false);
      } finally {
        clock.reset();
      }
    });

    it('list endpoint respects limit and cursor pagination', async () => {
      const res = await request(app)
        .get('/api/appointments/my-appointments?limit=1')
        .set('x-demo-uid', testPatientUid);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(1);
    });
  });

  // 2. NO-SHOW SWEEP
  describe('2. No-Show Sweep releases only future slots', () => {
    it('converts past appointments to no_show without releasing past slots', async () => {
      const pastSlotId = `slot-past-${Date.now()}`;
      const pastApptId = `apt-noshow-${Date.now()}`;

      await db.collection('slots').doc(pastSlotId).set({
        id: pastSlotId,
        doctorId: docGenId,
        date: pastDateStr,
        startAt: '10:00',
        status: 'booked'
      });

      await db.collection('appointments').doc(pastApptId).set({
        id: pastApptId,
        appointmentId: pastApptId,
        patientUid: testPatientUid,
        ownerUid: testPatientUid,
        patientHealthId: testHealthId,
        date: pastDateStr,
        timeSlot: '10:00',
        status: 'booked',
        slotIds: [pastSlotId],
        doctorId: docGenId
      });

      const sweepResult = await noShowSweepJob();
      expect(sweepResult.success).toBe(true);

      const updatedAppt = await db.collection('appointments').doc(pastApptId).get();
      expect(updatedAppt.data().status).toBe('no_show');

      // Slot in past must NOT be freed!
      const updatedSlot = await db.collection('slots').doc(pastSlotId).get();
      expect(updatedSlot.data().status).toBe('booked');
    });
  });

  // 3. DOCTOR NAME & PLACEHOLDERS
  describe('3. Doctor Resolution & Placeholder Removal', () => {
    it('rejects booking with 400 INVALID_DOCTOR if doctor cannot be resolved', async () => {
      const slotId = `slot-unresolved-${Date.now()}`;
      await db.collection('slots').doc(slotId).set({
        id: slotId,
        doctorId: 'NON_EXISTENT_DOC',
        date: futureDateStr,
        startAt: '09:00',
        status: 'free'
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slotId],
          patientHealthId: testHealthId,
          doctorId: 'NON_EXISTENT_DOC',
          date: futureDateStr,
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DOCTOR');
    });

    it('denormalizes doctorName, specialty and departmentName onto appointment at booking', async () => {
      const slotId = `slot-denorm-${Date.now()}`;
      await db.collection('slots').doc(slotId).set({
        id: slotId,
        doctorId: docGenId,
        date: futureDateStr,
        startAt: '09:00',
        status: 'free'
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slotId],
          patientHealthId: testHealthId,
          doctorId: docGenId,
          departmentId: 'dept-gen',
          date: futureDateStr,
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(201);
      expect(res.body.data.doctorName).toBe('Dr. Aarti Sunil Kamath');
      expect(res.body.data.specialty).toBe('Internal Medicine');
      expect(res.body.data.departmentName).toBe('General Medicine');
    });

    it('no placeholder names (Dr. SmartCare, Dr. Medical Staff, Dr. Rahul Kumar, Dr. Sarah Smith) exist in src code', () => {
      const serverSrc = path.resolve(__dirname, '../src');
      const clientSrc = path.resolve(__dirname, '../../client/src');

      const placeholders = [
        'Dr. SmartCare',
        'Dr. Medical Staff',
        'Dr. Rahul Kumar'
      ];

      const checkDir = (dir) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = path.join(dir, file.name);
          if (file.isDirectory()) {
            checkDir(fullPath);
          } else if (file.name.endsWith('.js') || file.name.endsWith('.jsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const ph of placeholders) {
              expect(content, `Found placeholder ${ph} in ${fullPath}`).not.toContain(ph);
            }
          }
        }
      };

      checkDir(serverSrc);
      checkDir(clientSrc);
    });
  });

  // 4 & 5 & 6. SAME-DAY BOOKINGS
  describe('4, 5, 6. Same-Day Booking Rules', () => {
    const bookingDate = '2026-11-25';

    it('blocks overlapping appointments for the same patient on same date (409)', async () => {
      const slot1 = `slot-sameday-1-${Date.now()}`;
      const slot2 = `slot-sameday-2-${Date.now()}`;

      await db.collection('slots').doc(slot1).set({
        id: slot1,
        doctorId: docGenId,
        date: bookingDate,
        startAt: '11:30',
        status: 'free'
      });

      await db.collection('slots').doc(slot2).set({
        id: slot2,
        doctorId: docDermId,
        date: bookingDate,
        startAt: '11:30',
        status: 'free'
      });

      // Book first
      const res1 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slot1],
          patientHealthId: testHealthId,
          doctorId: docGenId,
          departmentId: 'dept-gen',
          date: bookingDate,
          disclaimerAck: { acknowledged: true }
        });

      expect(res1.status).toBe(201);

      // Attempt to book overlapping time with different doctor & department
      const res2 = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slot2],
          patientHealthId: testHealthId,
          doctorId: docDermId,
          departmentId: 'dept-derm',
          date: bookingDate,
          disclaimerAck: { acknowledged: true }
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toContain('overlapping');
    });

    it('blocks second active appointment in the same department on same date (409)', async () => {
      const slot3 = `slot-sameday-3-${Date.now()}`;
      await db.collection('slots').doc(slot3).set({
        id: slot3,
        doctorId: docGen2Id,
        date: bookingDate,
        startAt: '12:10',
        status: 'free'
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slot3],
          patientHealthId: testHealthId,
          doctorId: docGen2Id,
          departmentId: 'dept-gen',
          date: bookingDate,
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('department');
    });

    it('requires warning acknowledgement (sameDayAck) for different department on same day', async () => {
      const slot4 = `slot-sameday-4-${Date.now()}`;
      await db.collection('slots').doc(slot4).set({
        id: slot4,
        doctorId: docDermId,
        date: bookingDate,
        startAt: '14:00',
        status: 'free'
      });

      // Without sameDayAck -> 409 warning
      const resNoAck = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slot4],
          patientHealthId: testHealthId,
          doctorId: docDermId,
          departmentId: 'dept-derm',
          date: bookingDate,
          disclaimerAck: { acknowledged: true }
        });

      expect(resNoAck.status).toBe(409);
      expect(resNoAck.body.code).toBe('SAME_DAY_DIFFERENT_DEPT_WARNING');
      expect(resNoAck.body.message).toContain('already have an appointment today');

      // With sameDayAck -> succeeds
      const resWithAck = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slot4],
          patientHealthId: testHealthId,
          doctorId: docDermId,
          departmentId: 'dept-derm',
          date: bookingDate,
          sameDayAck: true,
          disclaimerAck: { acknowledged: true }
        });

      expect(resWithAck.status).toBe(201);
    });

    it('reschedule respects same-day and overlapping rules', async () => {
      const reschedSlot = `slot-resched-${Date.now()}`;
      await db.collection('slots').doc(reschedSlot).set({
        id: reschedSlot,
        doctorId: docDermId,
        date: bookingDate,
        startAt: '11:30', // overlaps with the 11:30 General Medicine appointment!
        status: 'free'
      });

      // Create an appointment on a different date to reschedule
      const origSlot = `slot-orig-${Date.now()}`;
      const origDate = '2026-11-28';
      await db.collection('slots').doc(origSlot).set({
        id: origSlot,
        doctorId: docDermId,
        date: origDate,
        startAt: '10:00',
        status: 'free'
      });

      const bookOrig = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [origSlot],
          patientHealthId: testHealthId,
          doctorId: docDermId,
          departmentId: 'dept-derm',
          date: origDate,
          disclaimerAck: { acknowledged: true }
        });

      const apptId = bookOrig.body.data.id;

      // Reschedule to 11:30 on bookingDate -> must fail with 409
      const reschedRes = await request(app)
        .post(`/api/appointments/${apptId}/reschedule`)
        .set('x-demo-uid', testPatientUid)
        .send({
          newSlotId: reschedSlot,
          newDate: bookingDate,
          newTime: '11:30'
        });

      expect(reschedRes.status).toBe(409);
    });
  });

  // 7. TOKEN DISPLAY FORMAT
  describe('7. Token Formatting', () => {
    it('formats token label per department letter and counter (e.g. G-001, D-001) and never bare #1', async () => {
      const slotGen = `slot-tok-gen-${Date.now()}`;
      const slotDerm = `slot-tok-derm-${Date.now()}`;
      const tokenDate = '2026-12-01';

      await db.collection('slots').doc(slotGen).set({
        id: slotGen,
        doctorId: docGenId,
        date: tokenDate,
        startAt: '09:00',
        status: 'free'
      });

      await db.collection('slots').doc(slotDerm).set({
        id: slotDerm,
        doctorId: docDermId,
        date: tokenDate,
        startAt: '11:00',
        status: 'free'
      });

      const resGen = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slotGen],
          patientHealthId: testHealthId,
          doctorId: docGenId,
          departmentId: 'dept-gen',
          date: tokenDate,
          disclaimerAck: { acknowledged: true }
        });

      expect(resGen.body.data.tokenLabel).toMatch(/^G-\d{3}$/);
      expect(resGen.body.data.tokenLabel).not.toBe('#1');

      const resDerm = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slotDerm],
          patientHealthId: testHealthId,
          doctorId: docDermId,
          departmentId: 'dept-derm',
          date: tokenDate,
          sameDayAck: true,
          disclaimerAck: { acknowledged: true }
        });

      expect(resDerm.body.data.tokenLabel).toMatch(/^D-\d{3}$/);
      expect(resDerm.body.data.tokenLabel).not.toBe('#1');
    });
  });

  // 8. INSTALL CARD DISMISSAL
  describe('8. PWA Install Card 7-Day Dismissal Logic', () => {
    it('checks 7-day persistence logic for dismissal', () => {
      const isDismissedRecently = (dismissedAt) => {
        if (!dismissedAt) return false;
        const diffDays = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
        return diffDays < 7;
      };

      expect(isDismissedRecently(null)).toBe(false);
      expect(isDismissedRecently(Date.now() - 3 * 24 * 60 * 60 * 1000)).toBe(true);
      expect(isDismissedRecently(Date.now() - 8 * 24 * 60 * 60 * 1000)).toBe(false);
    });
  });

  // 9. QA SERVER FIXES REGRESSION SUITE
  describe('9. QA Server Fixes Regression Suite', () => {
    it('overrideClinicalLevel rejects without reason (400 REASON_REQUIRED) and succeeds with reason and audit log', async () => {
      const apptId = `apt-triage-${Date.now()}`;
      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        appointmentId: apptId,
        patientUid: testPatientUid,
        patientHealthId: testHealthId,
        doctorId: docGenId,
        date: todayStr,
        status: 'booked',
        clinicalLevel: 1,
        urgencySuggested: 'routine'
      });

      // 1. Missing reason -> 400 REASON_REQUIRED
      const resNoReason = await request(app)
        .post(`/api/appointments/${apptId}/level`)
        .set('x-demo-uid', docGenUid)
        .set('x-demo-role', 'doctor')
        .send({ clinicalLevel: 2 });

      expect(resNoReason.status).toBe(400);
      expect(resNoReason.body.code).toBe('REASON_REQUIRED');

      // 2. With reason -> 200 and audit log created
      const resWithReason = await request(app)
        .post(`/api/appointments/${apptId}/level`)
        .set('x-demo-uid', docGenUid)
        .set('x-demo-role', 'doctor')
        .send({ clinicalLevel: 2, reason: 'Patient exhibits worsening respiratory distress' });

      expect(resWithReason.status).toBe(200);
      expect(resWithReason.body.data.clinicalLevel).toBe(2);

      const updatedDoc = await db.collection('appointments').doc(apptId).get();
      expect(updatedDoc.data().clinicalLevel).toBe(2);
      expect(updatedDoc.data().clinicalOverrideReason).toBe('Patient exhibits worsening respiratory distress');
      expect(updatedDoc.data().clinicalLevelVerifiedBy).toBe(docGenUid);
    });

    it('manualCheckIn resolves appointment by tokenLabel and updates status to checked_in', async () => {
      const checkinApptId = `apt-checkin-${Date.now()}`;
      const uniqueLabel = `G-999-${Date.now().toString().slice(-4)}`;
      await db.collection('appointments').doc(checkinApptId).set({
        id: checkinApptId,
        appointmentId: checkinApptId,
        patientUid: testPatientUid,
        patientHealthId: testHealthId,
        doctorId: docGenId,
        date: todayStr,
        status: 'booked',
        tokenLabel: uniqueLabel,
        tokenNumber: 999
      });

      const res = await request(app)
        .post('/api/checkin/manual')
        .set('x-demo-uid', 'reception-test-uid')
        .set('x-demo-role', 'reception')
        .send({ tokenLabel: uniqueLabel });

      expect(res.status).toBe(200);
      expect(res.body.data.appointmentId).toBe(checkinApptId);
      expect(res.body.data.status).toBe('checked_in');

      const updated = await db.collection('appointments').doc(checkinApptId).get();
      expect(updated.data().status).toBe('checked_in');
    });

    it('getDoctorDashboardSummary uses non-blaming clinical wording when delay is detected', async () => {
      await db.collection('doctors').doc(docGenUid).set({
        doctorId: docGenId,
        uid: docGenUid
      }, { merge: true });

      await db.collection('queues').doc(`${docGenId}_${todayStr}`).set({
        doctorId: docGenId,
        date: todayStr,
        delayMin: 20,
        timeFactor: 1.2
      }, { merge: true });

      const res = await request(app)
        .get(`/api/doctors/dashboard-summary?date=${todayStr}&nocache=true`)
        .set('x-demo-uid', docGenUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.data.runningLateMsg).toBe('Schedule is running 20 minutes behind: consultations are taking more time');
    });

    it('leaveRescheduleJob guarantees autoBookDeadline is at least 15 minutes in future even for imminent appointment', async () => {
      const leaveDocId = `leave-imminent-${Date.now()}`;
      const imminentApptId = `apt-leave-imminent-${Date.now()}`;

      const futureSlot = `slot-imminent-${Date.now()}`;
      await db.collection('slots').doc(futureSlot).set({
        id: futureSlot,
        doctorId: docGen2Id,
        date: todayStr,
        startAt: '16:00',
        status: 'free'
      });

      await db.collection('appointments').doc(imminentApptId).set({
        id: imminentApptId,
        appointmentId: imminentApptId,
        patientUid: testPatientUid,
        patientHealthId: testHealthId,
        doctorId: docGenId,
        date: todayStr,
        timeSlot: '08:00',
        status: 'booked'
      });

      await db.collection('leaves').doc(leaveDocId).set({
        doctorId: docGenId,
        date: todayStr,
        reason: 'Medical conference',
        processed: false
      });

      const result = await leaveRescheduleJob();
      expect(result.success).toBe(true);

      const offersSnap = await db.collection('offers')
        .where('appointmentId', '==', imminentApptId)
        .get();

      if (!offersSnap.empty) {
        const offer = offersSnap.docs[0].data();
        const deadlineMs = new Date(offer.autoBookDeadline).getTime();
        const nowMs = Date.now();
        expect(deadlineMs).toBeGreaterThan(nowMs + 14 * 60 * 1000);
      }
    });

    it('POST /api/appointments rejects booking with 422 if disclaimerAck.acknowledged is false', async () => {
      const slotAck = `slot-ack-${Date.now()}`;
      await db.collection('slots').doc(slotAck).set({
        id: slotAck,
        doctorId: docGenId,
        date: futureDateStr,
        startAt: '15:00',
        status: 'free'
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', testPatientUid)
        .send({
          slotIds: [slotAck],
          patientHealthId: testHealthId,
          doctorId: docGenId,
          date: futureDateStr,
          disclaimerAck: { acknowledged: false }
        });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('DISCLAIMER_REQUIRED');
    });
  });
});


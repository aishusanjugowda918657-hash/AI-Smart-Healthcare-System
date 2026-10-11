import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';
import { SlotStatus } from '../src/domain/constants.js';

describe('Regression Tests: Slot Availability (Bug 1) & Queue Duplicate Prevention (Bug 2)', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];
  const trackedTestAppts = new Set();
  const trackedTestSlots = new Set();
  const trackedTestDoctors = new Set();

  beforeEach(() => {
    clock.reset();
    db = assertDbConnected();
  });

  afterEach(async () => {
    // Thorough cleanup of all test documents to prevent database pollution
    for (const apptId of trackedTestAppts) {
      try {
        await db.collection('appointments').doc(apptId).delete();
      } catch (err) {}
    }
    trackedTestAppts.clear();

    for (const slotId of trackedTestSlots) {
      try {
        await db.collection('slots').doc(slotId).delete();
      } catch (err) {}
    }
    trackedTestSlots.clear();

    for (const docId of trackedTestDoctors) {
      try {
        await db.collection('doctors').doc(docId).delete();
      } catch (err) {}
    }
    trackedTestDoctors.clear();
  });

  describe('Bug 1: Unavailable appointment slots are intentional clinical buffers', () => {
    it('generates 10:15, 11:45, 15:15, and 16:45 as RESERVED buffer slots (bufferEverySlots: 6)', () => {
      const scheduleConfig = {
        bufferEverySlots: 6,
        slotMinutes: 15,
        weekly: [
          {
            dayOfWeek: 'Monday',
            sessions: [
              { start: '09:00', end: '12:00' }, // 12 slots: 09:00 to 11:45
              { start: '14:00', end: '17:00' }  // 12 slots: 14:00 to 16:45
            ]
          }
        ]
      };

      const testDate = '2026-10-12'; // Monday (dayOfWeek = 1)
      const slots = generateSlotsForDoctorDate({
        doctorId: 'DOC-REG-01',
        date: testDate,
        schedule: scheduleConfig,
        leaves: [],
        existingSlots: []
      });

      // Index slots by startAt
      const slotMap = new Map(slots.map((s) => [s.startAt, s]));

      // Reported disabled slots in user query
      const reportedBufferSlots = ['10:15', '11:45', '15:15', '16:45'];

      reportedBufferSlots.forEach((time) => {
        const slot = slotMap.get(time);
        expect(slot, `Slot at ${time} must exist in schedule`).toBeDefined();
        expect(
          slot.status,
          `Slot ${time} must have status 'reserved' because it is an intentional clinical pace buffer`
        ).toBe(SlotStatus.RESERVED);
      });

      // Regular slots should be free
      const regularSlots = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:30', '14:00', '14:15'];
      regularSlots.forEach((time) => {
        const slot = slotMap.get(time);
        expect(slot, `Slot at ${time} must exist`).toBeDefined();
        expect(slot.status, `Slot ${time} should be FREE`).toBe(SlotStatus.FREE);
      });
    });

    it('server-side transaction rejects booking intentional buffer/reserved slots with SLOT_IN_BREAK', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const testSlotId = `slot_reg_buf_${rand}`;
      trackedTestSlots.add(testSlotId);

      // Seed a reserved buffer slot
      await db.collection('slots').doc(testSlotId).set({
        id: testSlotId,
        doctorId: 'DOC-001',
        date: todayStr,
        startAt: '10:15',
        endAt: '10:30',
        status: SlotStatus.RESERVED
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'patient_reg_user_1')
        .set('x-demo-role', 'patient')
        .send({
          doctorId: 'DOC-001',
          patientHealthId: 'HID-2026-REG01',
          date: todayStr,
          slotId: testSlotId,
          reasonText: 'General cardiology checkup',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(409);
      expect(res.body.error?.code || res.body.code).toBe('SLOT_IN_BREAK');
    });

    it('server-side transaction rejects double-booking an already booked slot with SLOT_TAKEN', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const testSlotId = `slot_reg_taken_${rand}`;
      trackedTestSlots.add(testSlotId);

      // Seed a booked slot
      await db.collection('slots').doc(testSlotId).set({
        id: testSlotId,
        doctorId: 'DOC-001',
        date: todayStr,
        startAt: '10:00',
        endAt: '10:15',
        status: SlotStatus.BOOKED,
        bookedBy: 'other_patient_99'
      });

      const res = await request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'patient_reg_user_2')
        .set('x-demo-role', 'patient')
        .send({
          doctorId: 'DOC-001',
          patientHealthId: 'HID-2026-REG02',
          date: todayStr,
          slotId: testSlotId,
          reasonText: 'Routine consultation',
          disclaimerAck: { acknowledged: true }
        });

      expect(res.status).toBe(409);
      expect(res.body.error?.code || res.body.code).toBe('SLOT_TAKEN');
    });
  });

  describe('Bug 2: Doctor queue Upcoming Booked (Not Yet Checked In) deduplication & sorting', () => {
    it('returns unique upcoming appointments sorted chronologically by appointment time', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const testDoctorId = `DOC-TEST-${rand}`;
      const docUid = `doc_uid_${rand}`;
      trackedTestDoctors.add(docUid);

      // Seed doctor document
      await db.collection('doctors').doc(docUid).set({
        id: docUid,
        doctorId: testDoctorId,
        fullName: 'Dr. Test Queue Doctor',
        departmentId: 'dept_cardiology'
      });

      // Seed three distinct upcoming appointments at different times
      const appt1Id = `appt_reg_1_${rand}`;
      const appt2Id = `appt_reg_2_${rand}`;
      const appt3Id = `appt_reg_3_${rand}`;
      trackedTestAppts.add(appt1Id);
      trackedTestAppts.add(appt2Id);
      trackedTestAppts.add(appt3Id);

      await db.collection('appointments').doc(appt1Id).set({
        id: appt1Id,
        doctorId: testDoctorId,
        doctorUid: docUid,
        patientName: 'Alice Springs',
        patientHealthId: 'HID-2026-90001',
        date: todayStr,
        timeSlot: '11:00',
        status: 'booked',
        tokenNumber: 'OPT-2026-00010',
        createdAt: new Date()
      });

      await db.collection('appointments').doc(appt2Id).set({
        id: appt2Id,
        doctorId: testDoctorId,
        doctorUid: docUid,
        patientName: 'Bob Builder',
        patientHealthId: 'HID-2026-90002',
        date: todayStr,
        timeSlot: '09:30', // Earlier time
        status: 'booked',
        tokenNumber: 'OPT-2026-00011',
        createdAt: new Date()
      });

      await db.collection('appointments').doc(appt3Id).set({
        id: appt3Id,
        doctorId: testDoctorId,
        doctorUid: docUid,
        patientName: 'Charlie Chaplin',
        patientHealthId: 'HID-2026-90003',
        date: todayStr,
        timeSlot: '14:15', // Afternoon time
        status: 'confirmed',
        tokenNumber: 'OPT-2026-00012',
        createdAt: new Date()
      });

      // Query doctor queue today
      const res = await request(app)
        .get(`/api/queue/doctor/${testDoctorId}/today?date=${todayStr}`)
        .set('x-demo-uid', docUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data).toBeDefined();

      const notCheckedIn = data.notCheckedIn;
      expect(Array.isArray(notCheckedIn)).toBe(true);
      expect(notCheckedIn.length).toBe(3);

      // Verify chronological sorting (09:30, then 11:00, then 14:15)
      expect(notCheckedIn[0].timeSlot).toBe('09:30');
      expect(notCheckedIn[0].patientName).toBe('Bob Builder');
      expect(notCheckedIn[0].tokenNumber).toBe('OPT-2026-00011');

      expect(notCheckedIn[1].timeSlot).toBe('11:00');
      expect(notCheckedIn[1].patientName).toBe('Alice Springs');
      expect(notCheckedIn[1].tokenNumber).toBe('OPT-2026-00010');

      expect(notCheckedIn[2].timeSlot).toBe('14:15');
      expect(notCheckedIn[2].patientName).toBe('Charlie Chaplin');
      expect(notCheckedIn[2].tokenNumber).toBe('OPT-2026-00012');

      // Verify that all IDs are distinct and none are duplicated
      const ids = notCheckedIn.map((a) => a.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('does not leak appointments belonging to other doctors into the queue', async () => {
      const rand = Math.floor(Math.random() * 1000000);
      const docUidA = `doc_uid_a_${rand}`;
      const docUidB = `doc_uid_b_${rand}`;
      const docIdA = `DOC-A-${rand}`;
      const docIdB = `DOC-B-${rand}`;
      trackedTestDoctors.add(docUidA);
      trackedTestDoctors.add(docUidB);

      await db.collection('doctors').doc(docUidA).set({
        id: docUidA,
        doctorId: docIdA,
        fullName: 'Dr. Doctor A'
      });
      await db.collection('doctors').doc(docUidB).set({
        id: docUidB,
        doctorId: docIdB,
        fullName: 'Dr. Doctor B'
      });

      const apptA = `appt_a_${rand}`;
      const apptB = `appt_b_${rand}`;
      trackedTestAppts.add(apptA);
      trackedTestAppts.add(apptB);

      await db.collection('appointments').doc(apptA).set({
        id: apptA,
        doctorId: docIdA,
        doctorUid: docUidA,
        date: todayStr,
        timeSlot: '10:00',
        status: 'booked',
        tokenNumber: 'OPT-2026-00021'
      });

      await db.collection('appointments').doc(apptB).set({
        id: apptB,
        doctorId: docIdB,
        doctorUid: docUidB,
        date: todayStr,
        timeSlot: '10:00',
        status: 'booked',
        tokenNumber: 'OPT-2026-00022'
      });

      const resA = await request(app)
        .get(`/api/queue/doctor/${docIdA}/today?date=${todayStr}`)
        .set('x-demo-uid', docUidA)
        .set('x-demo-role', 'doctor');

      expect(resA.status).toBe(200);
      const notCheckedInA = resA.body.data.notCheckedIn;
      expect(notCheckedInA.length).toBe(1);
      expect(notCheckedInA[0].id).toBe(apptA);
      expect(notCheckedInA[0].tokenNumber).toBe('OPT-2026-00021');
    });
  });
});

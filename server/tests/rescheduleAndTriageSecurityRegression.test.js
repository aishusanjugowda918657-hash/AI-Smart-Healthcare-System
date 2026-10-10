import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { escalateTriageAlertsJob } from '../src/jobs/scheduler.js';

describe('Phase 35 — Rescheduling Security & Triage Escalation Regression Suite', () => {
  let db;
  const testDoctorId = 'DOC-RESCHED-01';
  const testDoctorUid = 'uid-doc-resched-01';
  const testPatientUid = 'patient-uid-resched-01';
  const testHealthId = 'HID-RESCHED-001';

  beforeEach(async () => {
    db = assertDbConnected();

    // 1. Seed doctor
    await db.collection('doctors').doc(testDoctorId).set({
      id: testDoctorId,
      doctorId: testDoctorId,
      uid: testDoctorUid,
      name: 'Dr. Reschedule Security',
      departmentId: 'dept-gen',
      active: true
    }, { merge: true });

    // 2. Seed patient profile
    await db.collection('patients').doc(testPatientUid).set({
      uid: testPatientUid,
      patientHealthId: testHealthId,
      name: 'Reschedule Patient',
      email: 'resched@test.com'
    }, { merge: true });

    // Clean up locks & appointments for test patients
    const patientUids = [testPatientUid, 'patient-uid-resched-02'];
    for (const pUid of patientUids) {
      const apptsSnap = await db.collection('appointments').where('patientUid', '==', pUid).get();
      for (const doc of apptsSnap.docs) {
        await doc.ref.delete();
      }
      const locksSnap = await db.collection('appointment_locks').where('patientUid', '==', pUid).get();
      for (const doc of locksSnap.docs) {
        await doc.ref.delete();
      }
    }

    const testHealthIds = [testHealthId, 'HID-RESCHED-002'];
    for (const hId of testHealthIds) {
      const hLocksSnap = await db.collection('appointment_locks').where('patientHealthId', '==', hId).get();
      for (const doc of hLocksSnap.docs) {
        await doc.ref.delete();
      }
    }
  });

  const createTestSlot = async (slotId, doctorId, date, time = '09:00', status = 'free') => {
    await db.collection('slots').doc(slotId).set({
      id: slotId,
      doctorId,
      date,
      startAt: time,
      endAt: '09:30',
      status
    });
  };

  const bookTestAppt = async (slotId, date, time = '09:00') => {
    await createTestSlot(slotId, testDoctorId, date, time, 'free');
    const res = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${testPatientUid}`)
      .send({
        doctorId: testDoctorId,
        departmentId: 'dept-gen',
        date,
        timeSlot: time,
        slotId,
        patientName: 'Reschedule Patient',
        patientHealthId: testHealthId,
        disclaimerAck: { acknowledged: true }
      });
    return res;
  };

  describe('1. Task 1: Rescheduling Duplicate Prevention & Lock Migration', () => {
    it('rejects rescheduling to a destination date where patient already has an active appointment with the same doctor', async () => {
      const date1 = '2026-11-01';
      const date2 = '2026-11-02';

      // Book Appt 1 on date1
      const appt1Res = await bookTestAppt('slot_r1', date1, '09:00');
      expect(appt1Res.statusCode).toBe(201);
      const appt1Id = appt1Res.body.data.id;

      // Book Appt 2 on date2
      const appt2Res = await bookTestAppt('slot_r2', date2, '10:00');
      expect(appt2Res.statusCode).toBe(201);

      // Create free slot on date2 for rescheduling attempt
      const targetSlotId = 'slot_r_dest';
      await createTestSlot(targetSlotId, testDoctorId, date2, '11:00', 'free');

      // Attempt to reschedule Appt 1 to date2 (destination date conflict)
      const reschedRes = await request(app)
        .post(`/api/appointments/${appt1Id}/reschedule`)
        .set('Authorization', `Bearer ${testPatientUid}`)
        .send({
          newSlotId: targetSlotId,
          newDate: date2,
          newTime: '11:00'
        });

      expect(reschedRes.statusCode).toBe(409);
      expect(reschedRes.body.error?.code || reschedRes.body.code).toBe('DUPLICATE_BOOKING');

      // Verify original appointment remains intact on date1
      const appt1Doc = await db.collection('appointments').doc(appt1Id).get();
      expect(appt1Doc.data().date).toBe(date1);
      expect(appt1Doc.data().slotId || appt1Doc.data().slotIds?.[0]).toBe('slot_r1');

      // Target slot should still be free
      const targetSlotDoc = await db.collection('slots').doc(targetSlotId).get();
      expect(targetSlotDoc.data().status).toBe('free');
    });

    it('successfully reschedules to an open date, migrates locks, and frees original date for new booking', async () => {
      const date1 = '2026-11-05';
      const date2 = '2026-11-06';

      const apptRes = await bookTestAppt('slot_orig', date1, '09:00');
      expect(apptRes.statusCode).toBe(201);
      const apptId = apptRes.body.data.id;

      const newSlotId = 'slot_dest';
      await createTestSlot(newSlotId, testDoctorId, date2, '10:00', 'free');

      const reschedRes = await request(app)
        .post(`/api/appointments/${apptId}/reschedule`)
        .set('Authorization', `Bearer ${testPatientUid}`)
        .send({
          newSlotId,
          newDate: date2,
          newTime: '10:00'
        });

      expect(reschedRes.statusCode).toBe(200);
      expect(reschedRes.body.data.date).toBe(date2);

      // Old slot is freed
      const oldSlotDoc = await db.collection('slots').doc('slot_orig').get();
      expect(oldSlotDoc.data().status).toBe('free');

      // New slot is booked
      const newSlotDoc = await db.collection('slots').doc(newSlotId).get();
      expect(newSlotDoc.data().status).toBe('booked');

      // Original date lock was released: patient can book on date1 again!
      const rebookRes = await bookTestAppt('slot_orig_rebook', date1, '11:00');
      expect(rebookRes.statusCode).toBe(201);
    });

    it('rejects rescheduling an appointment with non-reschedulable status (cancelled or completed)', async () => {
      const date1 = '2026-11-10';
      const date2 = '2026-11-11';

      const apptRes = await bookTestAppt('slot_cancel_test', date1, '09:00');
      const apptId = apptRes.body.data.id;

      // Update to cancelled
      await db.collection('appointments').doc(apptId).update({ status: 'cancelled' });

      await createTestSlot('slot_dest_c', testDoctorId, date2, '10:00', 'free');

      const res = await request(app)
        .post(`/api/appointments/${apptId}/reschedule`)
        .set('Authorization', `Bearer ${testPatientUid}`)
        .send({
          newSlotId: 'slot_dest_c',
          newDate: date2
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error?.code || res.body.code).toBe('INVALID_STATUS');
    });

    it('safely handles concurrent reschedules to the same destination slot', async () => {
      const date1 = '2026-11-15';
      const date2 = '2026-11-16';

      const appt1Res = await bookTestAppt('slot_c1', date1, '09:00');
      const appt1Id = appt1Res.body.data.id;

      // Second patient
      const patient2Uid = 'patient-uid-resched-02';
      await db.collection('patients').doc(patient2Uid).set({
        uid: patient2Uid,
        patientHealthId: 'HID-RESCHED-002',
        name: 'Patient Two'
      });
      await createTestSlot('slot_c2', testDoctorId, date1, '10:00', 'free');
      const appt2Res = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${patient2Uid}`)
        .send({
          doctorId: testDoctorId,
          departmentId: 'dept-gen',
          date: date1,
          timeSlot: '10:00',
          slotId: 'slot_c2',
          patientName: 'Patient Two',
          patientHealthId: 'HID-RESCHED-002',
          disclaimerAck: { acknowledged: true }
        });
      const appt2Id = appt2Res.body.data.id;

      // Single destination slot on date2
      const targetSlot = 'slot_dest_shared';
      await createTestSlot(targetSlot, testDoctorId, date2, '09:00', 'free');

      // Execute simultaneous reschedules of both appointments to the same slot
      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/appointments/${appt1Id}/reschedule`)
          .set('Authorization', `Bearer ${testPatientUid}`)
          .send({ newSlotId: targetSlot, newDate: date2, newTime: '09:00' }),
        request(app)
          .post(`/api/appointments/${appt2Id}/reschedule`)
          .set('Authorization', `Bearer ${patient2Uid}`)
          .send({ newSlotId: targetSlot, newDate: date2, newTime: '09:00' })
      ]);

      const successCount = [r1, r2].filter(r => r.statusCode === 200).length;
      const failureCount = [r1, r2].filter(r => r.statusCode === 409).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
    });
  });

  describe('2. Task 2: Triage Escalation Job Reliability with and without Health ID', () => {
    it('escalates triage alert with valid health ID and records patientHealthId', async () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 3 * 60 * 1000); // 3 mins ago
      const alertId = `alert_test_hid_${Date.now()}`;

      await db.collection('alerts').doc(alertId).set({
        kind: 'triage',
        status: 'open',
        healthId: 'HID-TRIAGE-VALID',
        patientName: 'Triage Patient 1',
        createdAt: pastTime
      });

      const res = await escalateTriageAlertsJob({ nowOverride: now });
      expect(res.success).toBe(true);

      const escDoc = await db.collection('alerts').doc(`esc_${alertId}`).get();
      expect(escDoc.exists).toBe(true);
      expect(escDoc.data().patientHealthId).toBe('HID-TRIAGE-VALID');
      expect(escDoc.data().kind).toBe('triage_escalation');
    });

    it('escalates triage alert missing health ID safely with patientHealthId: null without Firestore error', async () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 3 * 60 * 1000);
      const alertId = `alert_test_nohid_${Date.now()}`;

      await db.collection('alerts').doc(alertId).set({
        kind: 'triage',
        status: 'open',
        // Deliberately no healthId or patientHealthId
        patientName: 'Anonymous Emergency',
        createdAt: pastTime
      });

      const res = await escalateTriageAlertsJob({ nowOverride: now });
      expect(res.success).toBe(true);

      const escDoc = await db.collection('alerts').doc(`esc_${alertId}`).get();
      expect(escDoc.exists).toBe(true);
      expect(escDoc.data().patientHealthId).toBeNull();
      expect(escDoc.data().patientName).toBe('Anonymous Emergency');
    });
  });
});

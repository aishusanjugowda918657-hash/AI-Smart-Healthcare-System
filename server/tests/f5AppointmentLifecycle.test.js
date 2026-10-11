import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { noShowSweepJob, releaseCancelledSlotsJob, appointmentRemindersJob } from '../src/jobs/scheduler.js';

describe('PRD F5: Feature Acceptance Criteria - Appointment Lifecycle, QR Check-in & Sweeps', () => {
  let db;
  let testApptId;
  let testSlotId;
  let rawCode;
  let codeHash;
  const todayStr = new Date().toISOString().split('T')[0];
  const trackedTestAppts = new Set();
  const trackedTestSlots = new Set();

  beforeEach(async () => {
    clock.reset();
    db = assertDbConnected();
    const rand = Math.floor(Math.random() * 10000000);
    testApptId = `appt_f5_${rand}`;
    testSlotId = `slot_f5_${rand}`;
    trackedTestAppts.add(testApptId);
    trackedTestSlots.add(testSlotId);

    rawCode = 'A1B2C3D4E5F67890';
    codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');

    // Seed test slot
    await db.collection('slots').doc(testSlotId).set({
      id: testSlotId,
      doctorId: 'DOC-001',
      date: todayStr,
      startAt: '10:00',
      status: 'booked',
      bookedBy: 'patient-uid-f5'
    });

    // Seed test appointment
    await db.collection('appointments').doc(testApptId).set({
      id: testApptId,
      patientId: 'patient-uid-f5',
      patientUid: 'patient-uid-f5',
      doctorUid: 'doc-uid-001',
      doctorId: 'DOC-001',
      departmentId: 'dept_cardiology',
      date: todayStr,
      timeSlot: '10:00',
      slotId: testSlotId,
      slotIds: [testSlotId],
      status: 'booked',
      tokenNumber: 'OPT-2026-00099',
      checkInCodeHash: codeHash,
      createdAt: new Date()
    });
  });

  afterEach(async () => {
    clock.reset();
    if (db) {
      for (const aId of trackedTestAppts) {
        try { await db.collection('appointments').doc(aId).delete(); } catch (_) {}
      }
      for (const sId of trackedTestSlots) {
        try { await db.collection('slots').doc(sId).delete(); } catch (_) {}
      }
    }
    trackedTestAppts.clear();
    trackedTestSlots.clear();
  });

  // 1. Confirm Appointment
  it('POST /api/appointments/:id/confirm changes status from booked to confirmed', async () => {
    const res = await request(app)
      .post(`/api/appointments/${testApptId}/confirm`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('confirmed');

    const updatedDoc = await db.collection('appointments').doc(testApptId).get();
    expect(updatedDoc.data().status).toBe('confirmed');
  });

  it('rejects unauthorized patient attempting to confirm or cancel another patient appointment with 403', async () => {
    const unauthRes = await request(app)
      .post(`/api/appointments/${testApptId}/confirm`)
      .set('x-demo-uid', 'other-patient-999')
      .set('x-demo-role', 'patient');

    expect(unauthRes.status).toBe(403);
    expect(unauthRes.body.error.code).toBe('FORBIDDEN');

    const unauthCancel = await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'other-patient-999')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Malicious cancel' });

    expect(unauthCancel.status).toBe(403);
    expect(unauthCancel.body.error.code).toBe('FORBIDDEN');
  });

  // 2. Cancel Appointment
  it('POST /api/appointments/:id/cancel requires reason and sets 10-minute undo window', async () => {
    // Missing reason returns 400 REASON_REQUIRED
    const badRes = await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({});
    expect(badRes.status).toBe(400);

    // Valid cancel
    const res = await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Personal conflict' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.data.undoUntil).toBeDefined();

    const updatedDoc = await db.collection('appointments').doc(testApptId).get();
    expect(updatedDoc.data().status).toBe('cancelled');
    expect(updatedDoc.data().cancel.reason).toBe('Personal conflict');

    // Verify slot freed after undo window expires
    clock.setMockTime(Date.now() + 11 * 60 * 1000);
    await releaseCancelledSlotsJob();
    const slotDoc = await db.collection('slots').doc(testSlotId).get();
    expect(slotDoc.data().status).toBe('free');
  });

  // 3. Undo Cancel within 10 minutes vs past 10 minutes
  it('POST /api/appointments/:id/undo-cancel restores within window and fails after 10 min', async () => {
    const startTime = Date.now();
    clock.setMockTime(startTime);

    // Cancel appointment
    await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Mistake' });

    // Advance 5 minutes (within 10 min window)
    clock.setMockTime(startTime + 5 * 60 * 1000);

    const undoRes = await request(app)
      .post(`/api/appointments/${testApptId}/undo-cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient');

    expect(undoRes.status).toBe(200);
    expect(undoRes.body.data.status).toBe('booked');

    // Cancel again
    await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Second cancel' });

    // Advance 15 minutes (past 10 min window)
    clock.setMockTime(startTime + 20 * 60 * 1000);

    const expiredRes = await request(app)
      .post(`/api/appointments/${testApptId}/undo-cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient');

    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.error.code).toBe('UNDO_EXPIRED');
  });

  // 4. Staff Restore
  it('POST /api/appointments/:id/restore allows staff to restore cancelled appointment', async () => {
    // Cancel appointment
    await request(app)
      .post(`/api/appointments/${testApptId}/cancel`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Patient changed mind' });

    // Staff restores
    const restoreRes = await request(app)
      .post(`/api/appointments/${testApptId}/restore`)
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ targetStatus: 'confirmed' });

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.status).toBe('confirmed');
  });

  // 5. Reschedule Appointment
  it('POST /api/appointments/:id/reschedule releases old slot and books new slot atomically', async () => {
    const newSlotId = `slot_new_${Date.now()}`;
    trackedTestSlots.add(newSlotId);
    await db.collection('slots').doc(newSlotId).set({
      id: newSlotId,
      doctorId: 'DOC-001',
      date: '2026-10-15',
      startAt: '14:00',
      status: 'free'
    });

    const res = await request(app)
      .post(`/api/appointments/${testApptId}/reschedule`)
      .set('x-demo-uid', 'patient-uid-f5')
      .set('x-demo-role', 'patient')
      .send({ newSlotId, newDate: '2026-10-15', newTime: '14:00' });

    expect(res.status).toBe(200);
    expect(res.body.data.slotId).toBe(newSlotId);

    // Verify old slot freed
    const oldSlot = await db.collection('slots').doc(testSlotId).get();
    expect(oldSlot.data().status).toBe('free');

    // Verify new slot booked
    const newSlot = await db.collection('slots').doc(newSlotId).get();
    expect(newSlot.data().status).toBe('booked');
  });

  // 6. QR Check-In Scanner (POST /api/checkin/scan)
  it('POST /api/checkin/scan handles APPT payload, hash match, date check, single use', async () => {
    // Mock current time to 09:30 AM (within 2h window of 10:00 AM slot)
    clock.setMockTime(new Date(`${todayStr}T09:30:00.000Z`));
    // Valid check-in
    const res = await request(app)
      .post('/api/checkin/scan')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: `APPT:${testApptId}:${rawCode}` });

    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('CHECKIN_SUCCESS');
    expect(res.body.data.status).toBe('checked_in');
    expect(res.body.data.predictedWaitAtCheckin).toBeDefined();

    // Re-check-in returns ALREADY_CHECKED_IN
    const dupRes = await request(app)
      .post('/api/checkin/scan')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: `APPT:${testApptId}:${rawCode}` });

    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('POST /api/checkin/scan rejects invalid hash and wrong date', async () => {
    // Wrong code hash
    const badHashRes = await request(app)
      .post('/api/checkin/scan')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: `APPT:${testApptId}:WRONGCODE12345` });

    expect(badHashRes.status).toBe(400);
    expect(badHashRes.body.error.code).toBe('INVALID_CODE');

    // Seed future date appointment
    const futureApptId = `appt_future_${Date.now()}`;
    await db.collection('appointments').doc(futureApptId).set({
      id: futureApptId,
      date: '2026-12-31',
      timeSlot: '10:00',
      status: 'booked',
      checkInCodeHash: codeHash
    });

    const wrongDateRes = await request(app)
      .post('/api/checkin/scan')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ qrPayload: `APPT:${futureApptId}:${rawCode}` });

    expect(wrongDateRes.status).toBe(400);
    expect(wrongDateRes.body.error.code).toBe('WRONG_DATE');
  });

  // 7. Manual Check-In & Health ID Rejection (POST /api/checkin/manual)
  it('POST /api/checkin/manual explicitly rejects Health ID search with 400 HEALTH_ID_REJECTED', async () => {
    const healthIdRes = await request(app)
      .post('/api/checkin/manual')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ healthId: 'PHI-2026-123456-C' });

    expect(healthIdRes.status).toBe(400);
    expect(healthIdRes.body.error.code).toBe('HEALTH_ID_REJECTED');

    const queryHealthIdRes = await request(app)
      .post('/api/checkin/manual')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ query: 'PHI-2026-123456-C' });

    expect(queryHealthIdRes.status).toBe(400);
    expect(queryHealthIdRes.body.error.code).toBe('HEALTH_ID_REJECTED');
  });

  it('POST /api/checkin/manual succeeds with token number', async () => {
    const manualApptId = `appt_manual_${Math.floor(Math.random() * 1000000)}`;
    const uniqueTokenLabel = `OPT-2026-${Math.floor(10000 + Math.random() * 90000)}`;

    await db.collection('appointments').doc(manualApptId).set({
      id: manualApptId,
      date: todayStr,
      timeSlot: '11:00',
      status: 'booked',
      tokenNumber: uniqueTokenLabel
    });

    const manualRes = await request(app)
      .post('/api/checkin/manual')
      .set('x-demo-uid', 'staff-reception-001')
      .set('x-demo-role', 'reception')
      .send({ tokenLabel: uniqueTokenLabel, appointmentDate: todayStr });

    expect(manualRes.status).toBe(200);
    expect(manualRes.body.data.code).toBe('CHECKIN_SUCCESS');
    expect(manualRes.body.data.status).toBe('checked_in');
  });

  // 8. Background Jobs: noShowSweepJob, releaseCancelledSlotsJob, appointmentRemindersJob
  it('noShowSweepJob marks unhandled past appointments as no_show', async () => {
    const pastApptId = `appt_past_${Date.now()}`;
    trackedTestAppts.add(pastApptId);
    await db.collection('appointments').doc(pastApptId).set({
      id: pastApptId,
      date: todayStr,
      timeSlot: '08:00',
      status: 'not_arrived',
      clinicalLevel: 3,
      patientHealthId: 'PHI-2026-000001-A'
    });

    const nowTime = new Date(`${todayStr}T11:00:00.000Z`);

    const result = await noShowSweepJob({ nowOverride: nowTime, gracePeriodMinutes: 5 });
    expect(result.success).toBe(true);

    const updated = await db.collection('appointments').doc(pastApptId).get();
    expect(updated.data().status).toBe('no_show');
  });

  it('releaseCancelledSlotsJob frees slots for cancelled appointments', async () => {
    const cancSlotId = `slot_canc_${Date.now()}`;
    const cancApptId = `appt_canc_${Date.now()}`;
    trackedTestSlots.add(cancSlotId);
    trackedTestAppts.add(cancApptId);

    await db.collection('slots').doc(cancSlotId).set({
      id: cancSlotId,
      status: 'booked'
    });

    await db.collection('appointments').doc(cancApptId).set({
      id: cancApptId,
      slotId: cancSlotId,
      status: 'cancelled'
    });

    const result = await releaseCancelledSlotsJob();
    expect(result.success).toBe(true);

    const slot = await db.collection('slots').doc(cancSlotId).get();
    expect(slot.data().status).toBe('free');
  });
});

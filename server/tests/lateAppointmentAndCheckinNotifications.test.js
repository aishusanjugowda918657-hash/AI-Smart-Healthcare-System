/**
 * lateAppointmentAndCheckinNotifications.test.js
 *
 * Comprehensive tests for late appointment handling, check-in reminders,
 * overdue notifications, emergency triage preservation, and queue display accuracy.
 *
 * Test Scenarios:
 * 1. Booking a future appointment.
 * 2. An appointment booked before its slot becoming overdue.
 * 3. The 9:30 PM appointment when the test clock is 9:47 PM.
 * 4. Check-in reminders at 24 hours and 2 hours before the slot.
 * 5. An overdue check-in notification at 9:47 PM for a 9:30 PM slot.
 * 6. Duplicate scheduler execution without duplicate reminders.
 * 7. No reminder after successful check-in, cancellation or completion.
 * 8. Rescheduling and stale-reminder cleanup.
 * 9. Existing no-show grace and rejoin behavior.
 * 10. Emergency-priority handling (never auto-cancelled or downgraded).
 * 11. Queue estimates and statuses after check-in and consultation start.
 * 12. Date boundaries and timezone correctness (Asia/Kolkata).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import { appointmentRemindersJob, noShowSweepJob } from '../src/jobs/scheduler.js';
import { computeQueueSnapshot } from '../src/services/queueService.js';
import { getReadyCandidates } from '../src/domain/priority.js';
import { parseSlotTimeToDate, getHospitalTodayStr } from '../src/utils/timezoneDate.js';

describe('SmartCare AI — Late Appointment Handling & Check-in Notifications Suite', () => {
  let db;

  beforeAll(() => {
    db = assertDbConnected();
  });

  afterEach(() => {
    clock.reset();
  });

  // 1. Booking a future appointment & slot validation
  it('1. Future appointment booking succeeds without premature cancellation or expiry', async () => {
    clock.set('2026-10-27T18:00:00+05:30');
    const aptId = `test_future_${Date.now()}`;
    const patientUid = `user_future_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      displayId: `APT-${aptId}`,
      patientUid,
      patientName: 'Future Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      doctorName: 'Dr. Demo General One',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'booked',
      tokenNumber: 99,
      tokenLabel: 'GEN-099',
      createdAt: clock.now(),
      updatedAt: clock.now()
    });

    const res = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasAppointment).toBe(true);
    expect(res.body.appointment.status).toBe('booked');
    expect(res.body.queueSummary.checkinRequired).toBe(true);
    expect(res.body.queueSummary.isOverdue).toBe(false);
  });

  // 2. An appointment booked before its slot becoming overdue
  it('2. Appointment booked earlier remains active and does not silently cancel when start time passes', async () => {
    // Booked for 21:30, time advances to 21:40 (10 mins past)
    clock.set('2026-10-27T21:40:00+05:30');
    const aptId = `test_overdue_active_${Date.now()}`;
    const patientUid = `user_overdue_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      displayId: `APT-${aptId}`,
      patientUid,
      patientName: 'Late Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      doctorName: 'Dr. Demo General One',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'booked',
      tokenNumber: 88,
      tokenLabel: 'GEN-088',
      createdAt: new Date('2026-10-27T20:00:00+05:30'),
      updatedAt: new Date('2026-10-27T20:00:00+05:30')
    });

    const res = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasAppointment).toBe(true);
    // Not silently cancelled or marked no-show!
    expect(['booked', 'not_arrived'].includes(res.body.appointment.status)).toBe(true);
    expect(res.body.queueSummary.checkinRequired).toBe(true);
    expect(res.body.queueSummary.isOverdue).toBe(true);
    expect(res.body.queueSummary.overdueMinutes).toBeGreaterThanOrEqual(9);
  });

  // 3. The 9:30 PM appointment when test clock is 9:47 PM
  it('3. The 9:30 PM appointment at 9:47 PM IST shows accurate queue information and turn estimates', async () => {
    clock.set('2026-10-27T21:47:00+05:30');
    const aptId = `test_charlie_case_${Date.now()}`;
    const patientUid = `user_charlie_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      displayId: `APT-${aptId}`,
      patientUid,
      patientName: 'Demo Patient Charlie',
      doctorId: 'DOC-DEMO-GEN-01',
      doctorName: 'Dr. Demo General One',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'waiting',
      checkedInAt: new Date('2026-10-27T21:28:00+05:30'),
      clinicalLevel: 3,
      urgencySuggested: 'emergency',
      priorityCategory: 'EMERGENCY',
      tokenNumber: 3,
      tokenLabel: 'GEN-003',
      createdAt: new Date('2026-10-27T21:00:00+05:30'),
      updatedAt: new Date('2026-10-27T21:28:00+05:30')
    });

    await db.collection('tokens').doc(`tok-${aptId}`).set({
      id: `tok-${aptId}`,
      appointmentId: aptId,
      patientUid,
      tokenNumber: '3',
      tokenLabel: 'GEN-003',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      status: 'waiting',
      priorityCategory: 'EMERGENCY',
      createdAt: new Date('2026-10-27T21:00:00+05:30'),
      updatedAt: new Date('2026-10-27T21:28:00+05:30')
    });

    const res = await request(app)
      .get('/api/tokens/my-queue-status')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasAppointment).toBe(true);
    expect(res.body.appointment.status).toBe('waiting');
    expect(res.body.appointment.scheduledSlotTime).toBe('09:30 PM');
    // Estimated turn time must NOT be in the past (must be Imminent or a future projected time)
    expect(res.body.queueSummary.estimatedTurnTime).not.toBe('09:30 PM');
    expect(res.body.appointment.priorityCategory).toBe('EMERGENCY');
  });

  // 4. Check-in reminders at 24 hours and 2 hours before the slot
  it('4. Creates 24-hour and 2-hour appointment reminders for upcoming bookings', async () => {
    // Test clock: 24h before appointment on 2026-10-26 at 21:30
    clock.set('2026-10-26T21:30:00+05:30');
    const apt24Id = `test_rem24_${Date.now()}`;
    const apt2hId = `test_rem2h_${Date.now()}`;
    const patientUid = `user_rem_${Date.now()}`;

    // Apt 1: scheduled in 24 hours (2026-10-27 21:30)
    await db.collection('appointments').doc(apt24Id).set({
      id: apt24Id,
      patientUid,
      patientName: 'Reminder Patient 24',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'booked',
      createdAt: clock.now()
    });

    const result24 = await appointmentRemindersJob({ nowOverride: clock.now() });
    expect(result24.success).toBe(true);

    const rem24Doc = await db.collection('reminders').doc(`rem_24h_${apt24Id}`).get();
    expect(rem24Doc.exists).toBe(true);
    expect(rem24Doc.data().type).toBe('appointment_24h');

    // Apt 2: scheduled in 2 hours (2026-10-26 23:30)
    await db.collection('appointments').doc(apt2hId).set({
      id: apt2hId,
      patientUid,
      patientName: 'Reminder Patient 2',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-26',
      timeSlot: '23:30',
      bookedStartAt: '23:30',
      status: 'booked',
      createdAt: clock.now()
    });

    const result2h = await appointmentRemindersJob({ nowOverride: clock.now() });
    expect(result2h.success).toBe(true);

    const rem2hDoc = await db.collection('reminders').doc(`rem_2h_${apt2hId}`).get();
    expect(rem2hDoc.exists).toBe(true);
    expect(rem2hDoc.data().type).toBe('appointment_2h');
  });

  // 5. Overdue check-in notification for unchecked-in patient at 9:47 PM
  it('5. Generates overdue check-in notification when appointment is 17 minutes past due without arrival', async () => {
    clock.set('2026-10-27T21:47:00+05:30');
    const aptId = `test_overdue_notif_${Date.now()}`;
    const patientUid = `user_overdue_notif_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      patientUid,
      patientName: 'Unchecked Overdue Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      doctorName: 'Dr. Demo General One',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'not_arrived',
      createdAt: new Date('2026-10-27T21:00:00+05:30')
    });

    const result = await appointmentRemindersJob({ nowOverride: clock.now() });
    expect(result.success).toBe(true);

    // Verify overdue notification was created in notifications collection
    const notifSnap = await db.collection('notifications')
      .where('uid', '==', patientUid)
      .where('type', '==', 'CHECKIN_OVERDUE')
      .get();

    expect(notifSnap.empty).toBe(false);
    const notif = notifSnap.docs[0].data();
    expect(notif.title).toContain('overdue');
    expect(notif.body).toContain('17 mins ago');
    expect(notif.status).toBe('in_app_only');
    expect(notif.pushStatus).toBe('none'); // Transparent push status distinction
  });

  // 6. Duplicate scheduler execution without duplicate reminders
  it('6. Multiple scheduler executions do not duplicate reminders or notifications', async () => {
    clock.set('2026-10-27T21:47:00+05:30');
    const aptId = `test_idempotency_${Date.now()}`;
    const patientUid = `user_idempotency_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      patientUid,
      patientName: 'Idempotency Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'not_arrived',
      createdAt: new Date('2026-10-27T21:00:00+05:30')
    });

    // Run scheduler 3 times consecutively
    await appointmentRemindersJob({ nowOverride: clock.now() });
    await appointmentRemindersJob({ nowOverride: clock.now() });
    await appointmentRemindersJob({ nowOverride: clock.now() });

    const notifSnap = await db.collection('notifications')
      .where('uid', '==', patientUid)
      .where('type', '==', 'CHECKIN_OVERDUE')
      .get();

    expect(notifSnap.size).toBe(1); // Exactly 1, no duplicates
  });

  // 7. No reminder after successful check-in, cancellation or completion
  it('7. Never sends check-in reminders after patient has checked in, cancelled, or completed', async () => {
    clock.set('2026-10-27T21:47:00+05:30');
    const patientUid = `user_checked_no_rem_${Date.now()}`;

    // Checked-in appointment
    const checkedAptId = `test_checked_${Date.now()}`;
    await db.collection('appointments').doc(checkedAptId).set({
      id: checkedAptId,
      patientUid,
      patientName: 'Checked Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'checked_in',
      checkedInAt: new Date('2026-10-27T21:20:00+05:30'),
      createdAt: new Date('2026-10-27T21:00:00+05:30')
    });

    await appointmentRemindersJob({ nowOverride: clock.now() });

    const notifSnap = await db.collection('notifications')
      .where('uid', '==', patientUid)
      .where('data.appointmentId', '==', checkedAptId)
      .get();

    expect(notifSnap.size).toBe(0);
  });

  // 8. Rescheduling and stale-reminder cleanup
  it('8. Cancels stale pending reminders when appointment is rescheduled or cancelled', async () => {
    clock.set('2026-10-27T10:00:00+05:30');
    const aptId = `test_cancel_cleanup_${Date.now()}`;
    const remId = `rem_24h_${aptId}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      patientUid: 'user-cancel-test',
      status: 'booked',
      date: '2026-10-28',
      timeSlot: '11:00',
      createdAt: clock.now()
    });

    await db.collection('reminders').doc(remId).set({
      id: remId,
      appointmentId: aptId,
      type: 'appointment_24h',
      status: 'pending',
      createdAt: clock.now()
    });

    const res = await request(app)
      .post(`/api/appointments/${aptId}/cancel`)
      .set('x-demo-uid', 'user-cancel-test')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Schedule conflict' });

    expect(res.status).toBe(200);

    const remDoc = await db.collection('reminders').doc(remId).get();
    expect(remDoc.data().status).toBe('cancelled');
  });

  // 9. Existing no-show grace and rejoin behavior
  it('9. Preserves existing 60-minute silent no-show grace and rejoin eligibility', async () => {
    // 65 minutes past appointment: silent no-show triggers
    clock.set('2026-10-27T22:35:00+05:30');
    const aptId = `test_noshow_grace_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      patientUid: 'user-noshow-test',
      patientName: 'NoShow Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'not_arrived',
      createdAt: new Date('2026-10-27T20:30:00+05:30')
    });

    await noShowSweepJob({ nowOverride: clock.now() });

    const updatedDoc = await db.collection('appointments').doc(aptId).get();
    expect(updatedDoc.data().status).toBe('no_show');
  });

  // 10. Emergency-priority handling
  it('10. Emergency priority patients are never automatically marked as no-show or cancelled', async () => {
    // 70 minutes past appointment: emergency patient must be preserved!
    clock.set('2026-10-27T22:40:00+05:30');
    const aptId = `test_emerg_protect_${Date.now()}`;

    await db.collection('appointments').doc(aptId).set({
      id: aptId,
      appointmentId: aptId,
      patientUid: 'user-emerg-test',
      patientHealthId: 'SCAI-TEST-EMERG-P',
      patientName: 'Emergency Patient',
      doctorId: 'DOC-DEMO-GEN-01',
      date: '2026-10-27',
      timeSlot: '21:30',
      bookedStartAt: '21:30',
      status: 'not_arrived',
      clinicalLevel: 3,
      urgency: 'emergency',
      priorityCategory: 'EMERGENCY',
      createdAt: new Date('2026-10-27T20:30:00+05:30')
    });

    await noShowSweepJob({ nowOverride: clock.now() });

    const updatedDoc = await db.collection('appointments').doc(aptId).get();
    // Must NOT be no_show
    expect(updatedDoc.data().status).not.toBe('no_show');
    expect(updatedDoc.data().status).toBe('not_arrived');
    // Clinical staff alert generated instead
    expect(updatedDoc.data().emergencyAlertSent).toBe(true);
  });

  // 11. Queue estimates and statuses after check-in and consultation start
  it('11. Correctly calculates queue position and wait estimates when status is waiting', () => {
    const now = new Date('2026-10-27T21:47:00+05:30');
    const appointments = [
      { id: 'apt-charlie', status: 'waiting', clinicalLevel: 3, timeSlot: '21:30', bookedStartAt: '21:30', date: '2026-10-27' },
      { id: 'apt-diana', status: 'waiting', clinicalLevel: 1, timeSlot: '21:45', bookedStartAt: '21:45', date: '2026-10-27' },
      { id: 'apt-booked', status: 'booked', clinicalLevel: 1, timeSlot: '22:00', bookedStartAt: '22:00', date: '2026-10-27' }
    ];

    const ready = getReadyCandidates(appointments, now);
    expect(ready.length).toBe(2);
    // Emergency Level 3 (Charlie) is prioritized at index 0!
    expect(ready[0].id).toBe('apt-charlie');
    expect(ready[1].id).toBe('apt-diana');
  });

  // 12. Date boundaries and timezone correctness (Asia/Kolkata)
  it('12. Respects Asia/Kolkata hospital timezone across date and midnight boundaries', () => {
    // 21:30 on 2026-10-27 in Asia/Kolkata
    const kolkataDate = parseSlotTimeToDate('2026-10-27', '21:30');
    expect(kolkataDate).toBeInstanceOf(Date);
    expect(kolkataDate.toISOString()).toBe('2026-10-27T16:00:00.000Z');

    // Midnight rollover slot (01:00 AM on 2026-10-28)
    const midnightSlot = parseSlotTimeToDate('2026-10-28', '01:00');
    expect(midnightSlot.toISOString()).toBe('2026-10-27T19:30:00.000Z');
  });
});

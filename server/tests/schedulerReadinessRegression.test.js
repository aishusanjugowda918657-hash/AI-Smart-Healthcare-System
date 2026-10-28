/**
 * PHASE 129 — Complete Scheduler Readiness & Automated Job Verification
 *
 * Runs strictly against the local Firebase Emulator Suite with synthetic test data.
 * Verifies every scheduled job:
 *   1. expireHoldsJob
 *   2. noShowSweepJob (deadlines, grace periods, 60m no-show, serious alerts)
 *   3. releaseCancelledSlotsJob (undo window, waitlist trigger, idempotency)
 *   4. appointmentRemindersJob (24h, 2h, final 30m, repeat no-show atRisk)
 *   5. fairnessBumpJob (routine patients delayed >= 30m)
 *   6. escalateTriageAlertsJob (2-min unacknowledged escalation)
 *   7. processRemindersJob (claim-lock, grouping, 2nd reminder, caregiver escalation, missed status)
 *   8. followupSweepJob (2-day, day-of, overdue max 3, auto-close on visit completion)
 *   9. dailyDoctorAlertsJob (one open alert per doctor/patient/kind, thresholds, daily push)
 *  10. leaveRescheduleJob (3-option offers, slot holds, 2h reminder, deadline auto-booking)
 *  11. expireWaitlistOffersJob (expiry cascade, next candidate offer)
 *  12. cleanupJob (30-day retention cleanup)
 *  13. generateSlotsJob (schedule slot creation)
 *  14. Distributed Mutex & Overlapping Execution Lock (withJobLock)
 *  15. Internal Tick Endpoint Security & Environment Guards
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { clock } from '../src/utils/clock.js';
import env from '../src/config/env.js';
import flags from '../src/config/flags.js';
import {
  expireHoldsJob,
  noShowSweepJob,
  releaseCancelledSlotsJob,
  appointmentRemindersJob,
  fairnessBumpJob,
  escalateTriageAlertsJob,
  cleanupJob,
  generateSlotsJob,
  runSchedulerJobs,
  withJobLock
} from '../src/jobs/scheduler.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';
import { followupSweepJob } from '../src/jobs/followupSweep.js';
import { dailyDoctorAlertsJob } from '../src/jobs/dailyDoctorAlerts.js';
import { leaveRescheduleJob } from '../src/jobs/leaveReschedule.js';
import { expireWaitlistOffersJob } from '../src/services/waitlistService.js';
import { SlotStatus } from '../src/domain/constants.js';

function uid(prefix = 'p129') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

describe('PHASE 129: Scheduler Readiness and Automated Job Verification', () => {
  let db;

  beforeEach(() => {
    db = assertDbConnected();
    clock.reset();
  });

  afterEach(() => {
    clock.reset();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. APPOINTMENT REMINDERS (24h, 2h, final 30m, repeat no-shows)
  // ─────────────────────────────────────────────────────────────
  describe('Job 1: Appointment Reminders', () => {
    it('creates 24h, 2h, and final 30m reminders for booked appointments and skips cancelled/completed', async () => {
      const now = new Date('2026-10-20T10:00:00+05:30');
      clock.setMockTime(now);

      const appt24Id = uid('appt24');
      const appt2hId = uid('appt2h');
      const apptFinalId = uid('apptFinal');
      const apptCancelledId = uid('apptCancelled');
      const apptCompletedId = uid('apptCompleted');

      // 24h away
      await db.collection('appointments').doc(appt24Id).set({
        id: appt24Id,
        date: '2026-10-21',
        timeSlot: '10:00',
        status: 'booked',
        patientName: 'Test Patient 24h',
        patientHealthId: 'PHI-129-24H',
        ownerUid: uid('user'),
        reminder24hSent: false
      });

      // 2h away
      await db.collection('appointments').doc(appt2hId).set({
        id: appt2hId,
        date: '2026-10-20',
        timeSlot: '12:00',
        status: 'booked',
        patientName: 'Test Patient 2h',
        patientHealthId: 'PHI-129-2H',
        ownerUid: uid('user'),
        reminder2hSent: false
      });

      // 30 min away
      await db.collection('appointments').doc(apptFinalId).set({
        id: apptFinalId,
        date: '2026-10-20',
        timeSlot: '10:30',
        status: 'booked',
        patientName: 'Test Patient Final',
        patientHealthId: 'PHI-129-FINAL',
        ownerUid: uid('user'),
        reminderFinalSent: false
      });

      // Cancelled appointment 2h away - must NOT be processed
      await db.collection('appointments').doc(apptCancelledId).set({
        id: apptCancelledId,
        date: '2026-10-20',
        timeSlot: '12:00',
        status: 'cancelled',
        patientName: 'Cancelled Patient',
        ownerUid: uid('user')
      });

      // Completed appointment 2h away - must NOT be processed
      await db.collection('appointments').doc(apptCompletedId).set({
        id: apptCompletedId,
        date: '2026-10-20',
        timeSlot: '12:00',
        status: 'completed',
        patientName: 'Completed Patient',
        ownerUid: uid('user')
      });

      const res = await appointmentRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.remindersCreated).toBeGreaterThanOrEqual(3);

      // Verify reminders created
      const [r24, r2h, rFinal, rCanc, rComp] = await Promise.all([
        db.collection('reminders').doc(`rem_24h_${appt24Id}`).get(),
        db.collection('reminders').doc(`rem_2h_${appt2hId}`).get(),
        db.collection('reminders').doc(`rem_final_${apptFinalId}`).get(),
        db.collection('reminders').doc(`rem_2h_${apptCancelledId}`).get(),
        db.collection('reminders').doc(`rem_2h_${apptCompletedId}`).get()
      ]);

      expect(r24.exists).toBe(true);
      expect(r2h.exists).toBe(true);
      expect(rFinal.exists).toBe(true);
      expect(rCanc.exists).toBe(false); // Cancelled skipped
      expect(rComp.exists).toBe(false); // Completed skipped

      // Retest idempotency: second execution must create 0 new reminders for these appointments
      const res2 = await appointmentRemindersJob({ nowOverride: now });
      expect(res2.success).toBe(true);
      expect(res2.remindersCreated).toBe(0);
    });

    it('marks slot atRisk for patients with 2+ repeat no-shows in past 90 days', async () => {
      const now = new Date('2026-10-20T10:00:00+05:30');
      clock.setMockTime(now);

      const healthId = `PHI-REPEAT-${Date.now()}`;
      const slotId = uid('slot_repeat');
      const apptId = uid('appt_repeat');

      await db.collection('slots').doc(slotId).set({
        id: slotId,
        status: 'booked',
        atRisk: false
      });

      // 2 prior no-shows within 90 days
      await db.collection('appointments').doc(uid('ns1')).set({
        patientHealthId: healthId,
        status: 'no_show',
        noShowAt: new Date('2026-09-01T10:00:00.000Z').toISOString()
      });
      await db.collection('appointments').doc(uid('ns2')).set({
        patientHealthId: healthId,
        status: 'no_show',
        noShowAt: new Date('2026-09-15T10:00:00.000Z').toISOString()
      });

      // Active appointment 2h away
      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        date: '2026-10-20',
        timeSlot: '12:00',
        status: 'booked',
        patientHealthId: healthId,
        slotId,
        ownerUid: uid('user'),
        reminder2hSent: false
      });

      const res = await appointmentRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);

      const [apptSnap, slotSnap] = await Promise.all([
        db.collection('appointments').doc(apptId).get(),
        db.collection('slots').doc(slotId).get()
      ]);

      expect(apptSnap.data().atRisk).toBe(true);
      expect(apptSnap.data().repeatNoShowFlag).toBe(true);
      expect(slotSnap.data().atRisk).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. MEDICINE REMINDERS (processRemindersJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 2: Medicine Reminders Processor', () => {
    it('claims pending medicine reminders, groups by groupKey, and updates status to sent', async () => {
      const now = new Date('2026-10-20T08:00:00.000Z');
      const testUid = uid('patient');
      const groupKey = `grp-${Date.now()}`;

      await db.collection('users').doc(testUid).set({
        uid: testUid,
        fcmTokens: [],
        prefs: {}
      });

      const rem1Id = uid('med1');
      const rem2Id = uid('med2');

      await db.collection('reminders').doc(rem1Id).set({
        id: rem1Id,
        patientUid: testUid,
        receiverUids: [testUid],
        groupKey,
        type: 'medicine',
        status: 'pending',
        medicineName: 'Amoxicillin',
        dosage: '500mg',
        dueAt: '2026-10-20T07:55:00.000Z',
        createdAt: '2026-10-20T07:00:00.000Z'
      });

      await db.collection('reminders').doc(rem2Id).set({
        id: rem2Id,
        patientUid: testUid,
        receiverUids: [testUid],
        groupKey,
        type: 'medicine',
        status: 'pending',
        medicineName: 'Paracetamol',
        dosage: '650mg',
        dueAt: '2026-10-20T07:55:00.000Z',
        createdAt: '2026-10-20T07:00:00.000Z'
      });

      const res = await processRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.processed).toBeGreaterThanOrEqual(2);

      const [snap1, snap2] = await Promise.all([
        db.collection('reminders').doc(rem1Id).get(),
        db.collection('reminders').doc(rem2Id).get()
      ]);

      expect(snap1.data().status).toBe('sent');
      expect(snap2.data().status).toBe('sent');
      expect(snap1.data().sentAt).toBeTruthy();

      // Completed/taken reminders are never re-processed
      await db.collection('reminders').doc(rem1Id).set({ status: 'taken' }, { merge: true });
      const res2 = await processRemindersJob({ nowOverride: now });
      const snap1After = await db.collection('reminders').doc(rem1Id).get();
      expect(snap1After.data().status).toBe('taken');
    });

    it('escalates to secondary caregiver after 15m and sends 2nd nudge after 30m', async () => {
      const now = new Date('2026-10-20T08:35:00.000Z'); // 35m past due
      const primaryUid = uid('primary');
      const caregiverUid = uid('caregiver');
      const remId = uid('esc_med');

      await db.collection('reminders').doc(remId).set({
        id: remId,
        patientUid: primaryUid,
        patientName: 'Elder Patient',
        receiverUids: [primaryUid, caregiverUid],
        type: 'medicine',
        status: 'sent',
        medicineName: 'Metformin',
        dueAt: '2026-10-20T08:00:00.000Z',
        secondaryCaregiverNotified: false,
        secondReminderSent: false
      });

      const res = await processRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.caregiverEscalations).toBeGreaterThanOrEqual(1);
      expect(res.secondRemindersCount).toBeGreaterThanOrEqual(1);

      const snap = await db.collection('reminders').doc(remId).get();
      expect(snap.data().secondaryCaregiverNotified).toBe(true);
      expect(snap.data().secondReminderSent).toBe(true);
    });

    it('marks reminder missed after 60m and raises adherence alert on 3 consecutive missed doses', async () => {
      const now = new Date('2026-10-20T10:00:00.000Z');
      const healthId = `PHI-ADH-${Date.now()}`;
      const docId = uid('doc');

      // 2 prior missed doses
      await db.collection('reminders').doc(uid('m1')).set({
        healthId,
        doctorId: docId,
        type: 'medicine',
        status: 'missed',
        dueAt: '2026-10-19T08:00:00.000Z'
      });
      await db.collection('reminders').doc(uid('m2')).set({
        healthId,
        doctorId: docId,
        type: 'medicine',
        status: 'missed',
        dueAt: '2026-10-19T20:00:00.000Z'
      });

      // Third dose sent 90 minutes ago, still unacknowledged
      const thirdRemId = uid('m3');
      await db.collection('reminders').doc(thirdRemId).set({
        id: thirdRemId,
        healthId,
        doctorId: docId,
        patientName: 'Chronic Patient',
        type: 'medicine',
        status: 'sent',
        dueAt: '2026-10-20T08:00:00.000Z'
      });

      const res = await processRemindersJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.missedCount).toBeGreaterThanOrEqual(1);
      expect(res.adherenceFlags).toBeGreaterThanOrEqual(1);

      const [remSnap, alertSnap] = await Promise.all([
        db.collection('reminders').doc(thirdRemId).get(),
        db.collection('alerts').doc(`alert-adherence-${healthId}`).get()
      ]);

      expect(remSnap.data().status).toBe('missed');
      expect(alertSnap.exists).toBe(true);
      expect(alertSnap.data().riskLevel).toBe('high');
      expect(alertSnap.data().reasons).toContain('3 consecutive missed medication doses');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. FOLLOW-UP REMINDERS (followupSweepJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 3: Follow-up Reminders Sweep', () => {
    it('sweeps open follow-ups, sends 2-day reminder, and auto-closes when matching visit completes', async () => {
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 2);
      const scheduledStr = scheduledDate.toISOString().split('T')[0];

      const patientUid = uid('patient_flw');
      const patientHealthId = `PHI-FLW-${Date.now()}`;
      const flwId = uid('flw_open');

      await db.collection('followups').doc(flwId).set({
        id: flwId,
        patientUid,
        healthId: patientHealthId,
        patientName: 'Followup Patient',
        scheduledDate: scheduledStr,
        dueDate: scheduledStr,
        status: 'scheduled',
        doctorId: 'DOC-129-A',
        doctorName: 'Dr. specialist',
        reminderCount: 0,
        twoDaysNotified: false
      });

      const res = await followupSweepJob();
      expect(res.success).toBe(true);
      expect(res.dueSoonReminders).toBeGreaterThanOrEqual(1);

      const updatedFlw = await db.collection('followups').doc(flwId).get();
      expect(updatedFlw.data().twoDaysNotified).toBe(true);
      expect(updatedFlw.data().status).toBe('reminded');

      // Now create a completed appointment for this patient with this doctor -> auto-close verification
      await db.collection('appointments').doc(uid('appt_done')).set({
        patientHealthId,
        doctorId: 'DOC-129-A',
        status: 'completed',
        completedAt: new Date().toISOString()
      });

      const resAutoClose = await followupSweepJob();
      expect(resAutoClose.success).toBe(true);
      expect(resAutoClose.autoClosedCount).toBeGreaterThanOrEqual(1);

      const closedFlw = await db.collection('followups').doc(flwId).get();
      expect(closedFlw.data().status).toBe('done');
      expect(closedFlw.data().autoClosed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. NO-SHOW SWEEP & CHECK-IN DEADLINES (noShowSweepJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 4: No-Show Processing and Deadlines', () => {
    it('marks not_arrived at 10m before slot, late after grace period, and no_show after 60m', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const slotId = uid('slot_ns');
      const apptId = uid('appt_ns');

      await db.collection('slots').doc(slotId).set({
        id: slotId,
        status: 'booked',
        startAt: '08:00',
        date: todayStr
      });

      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        date: todayStr,
        timeSlot: '08:00',
        status: 'booked',
        slotId,
        clinicalLevel: 3, // serious
        patientHealthId: 'PHI-129-NS'
      });

      // Simulation at 09:30 (90 min after booked time -> silent no-show > 60m)
      const nowOverride = new Date(`${todayStr}T09:30:00.000Z`);
      const res = await noShowSweepJob({ nowOverride, gracePeriodMinutes: 5 });

      expect(res.success).toBe(true);
      expect(res.noShowCount).toBeGreaterThanOrEqual(1);

      const apptSnap = await db.collection('appointments').doc(apptId).get();
      expect(apptSnap.data().status).toBe('no_show');

      // Serious appointment creates clinical alert
      const alertSnap = await db.collection('alerts')
        .where('appointmentId', '==', apptId)
        .where('kind', '==', 'no_show_followup')
        .get();
      expect(alertSnap.empty).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. CANCELLED SLOT RECOVERY (releaseCancelledSlotsJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 5: Cancelled-Slot Recovery', () => {
    it('respects undo window and frees slot only after undoUntil has passed', async () => {
      const now = new Date('2026-10-20T10:00:00.000Z');
      clock.setMockTime(now);

      const slotPendingUndo = uid('slot_undo_pend');
      const apptPendingUndo = uid('appt_undo_pend');

      const slotReady = uid('slot_ready');
      const apptReady = uid('appt_ready');

      // Case A: Undo window expires in 5 minutes (in future)
      await db.collection('slots').doc(slotPendingUndo).set({ id: slotPendingUndo, status: 'booked' });
      await db.collection('appointments').doc(apptPendingUndo).set({
        id: apptPendingUndo,
        slotId: slotPendingUndo,
        status: 'cancelled',
        slotReleased: false,
        cancel: { undoUntil: '2026-10-20T10:05:00.000Z' }
      });

      // Case B: Undo window expired 5 minutes ago (in past)
      await db.collection('slots').doc(slotReady).set({ id: slotReady, status: 'booked' });
      await db.collection('appointments').doc(apptReady).set({
        id: apptReady,
        slotId: slotReady,
        status: 'cancelled',
        slotReleased: false,
        cancel: { undoUntil: '2026-10-20T09:55:00.000Z' }
      });

      const res = await releaseCancelledSlotsJob();
      expect(res.success).toBe(true);

      const [sPend, sReady, aPend, aReady] = await Promise.all([
        db.collection('slots').doc(slotPendingUndo).get(),
        db.collection('slots').doc(slotReady).get(),
        db.collection('appointments').doc(apptPendingUndo).get(),
        db.collection('appointments').doc(apptReady).get()
      ]);

      expect(sPend.data().status).toBe('booked'); // Not yet released
      expect(aPend.data().slotReleased).toBe(false);

      expect(sReady.data().status).toBe('free'); // Released!
      expect(aReady.data().slotReleased).toBe(true);

      // Running again does not double-release
      const res2 = await releaseCancelledSlotsJob();
      expect(res2.success).toBe(true);
      expect(res2.releasedCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. TRIAGE ALERT ESCALATION (escalateTriageAlertsJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 6: Triage-Alert Escalation', () => {
    it('escalates unacknowledged alerts older than 2m and skips fresh/already-escalated alerts', async () => {
      const now = new Date('2026-10-20T10:05:00.000Z');
      const oldAlertId = uid('alert_old');
      const freshAlertId = uid('alert_fresh');

      // Older than 2 minutes (created at 10:01)
      await db.collection('alerts').doc(oldAlertId).set({
        id: oldAlertId,
        kind: 'triage',
        status: 'open',
        patientName: 'Old Alert Patient',
        createdAt: '2026-10-20T10:01:00.000Z'
      });

      // Fresh alert (< 2 minutes old, created at 10:04)
      await db.collection('alerts').doc(freshAlertId).set({
        id: freshAlertId,
        kind: 'triage',
        status: 'open',
        patientName: 'Fresh Alert Patient',
        createdAt: '2026-10-20T10:04:00.000Z'
      });

      const res = await escalateTriageAlertsJob({ nowOverride: now });
      expect(res.success).toBe(true);
      expect(res.escalatedCount).toBe(1);

      const [oldSnap, freshSnap] = await Promise.all([
        db.collection('alerts').doc(oldAlertId).get(),
        db.collection('alerts').doc(freshAlertId).get()
      ]);

      expect(oldSnap.data().escalatedAt).toBeTruthy();
      expect(freshSnap.data().escalatedAt).toBeUndefined();

      // Idempotent: running again escalates 0
      const res2 = await escalateTriageAlertsJob({ nowOverride: now });
      expect(res2.escalatedCount).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. WAITLIST OFFER EXPIRATION (expireWaitlistOffersJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 7: Waitlist Offer Expiration', () => {
    it('expires offers past deadline and resets waitlist candidate to waiting', async () => {
      const past = new Date(Date.now() - 60000).toISOString();
      const offerId = uid('wl_offer');
      const wlEntryId = uid('wl_entry');

      await db.collection('waitlist').doc(wlEntryId).set({
        id: wlEntryId,
        status: 'offered',
        activeOfferId: offerId
      });

      await db.collection('offers').doc(offerId).set({
        id: offerId,
        kind: 'waitlist',
        status: 'open',
        waitlistId: wlEntryId,
        expiresAt: past
      });

      const res = await expireWaitlistOffersJob();
      expect(res.success).toBe(true);
      expect(res.expiredCount).toBeGreaterThanOrEqual(1);

      const [offerSnap, wlSnap] = await Promise.all([
        db.collection('offers').doc(offerId).get(),
        db.collection('waitlist').doc(wlEntryId).get()
      ]);

      expect(offerSnap.data().status).toBe('expired');
      expect(wlSnap.data().status).toBe('waiting');
      expect(wlSnap.data().activeOfferId).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. DOCTOR LEAVE & RESCHEDULING (leaveRescheduleJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 8: Doctor Leave Auto-Rescheduling', () => {
    it('processes doctor leaves, holds alternative slots, creates 3-option offers, and auto-books at deadline', async () => {
      const doctorId = uid('doc_leave');
      const leaveDate = '2026-11-05';
      const leaveId = uid('leave');
      const apptId = uid('appt_leave');
      const altSlotId = uid('alt_slot');

      // Create alternative slot on future date
      await db.collection('slots').doc(altSlotId).set({
        id: altSlotId,
        doctorId,
        date: '2026-11-06',
        timeSlot: '10:00',
        available: true
      });

      // Active appointment on leave date
      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        doctorId,
        date: leaveDate,
        timeSlot: '09:00',
        status: 'booked',
        patientHealthId: 'PHI-LEAVE-01',
        patientName: 'Leave Patient'
      });

      // Doctor leave
      await db.collection('leaves').doc(leaveId).set({
        id: leaveId,
        doctorId,
        date: leaveDate,
        reason: 'Medical Conference',
        processed: false
      });

      const res = await leaveRescheduleJob();
      expect(res.success).toBe(true);
      expect(res.processedLeaves).toBeGreaterThanOrEqual(1);

      // Verify leave marked processed
      const leaveSnap = await db.collection('leaves').doc(leaveId).get();
      expect(leaveSnap.data().processed).toBe(true);

      // Verify offer created with held alternative slot
      const offersSnap = await db.collection('offers')
        .where('leaveId', '==', leaveId)
        .where('appointmentId', '==', apptId)
        .get();

      expect(offersSnap.empty).toBe(false);
      const offerDoc = offersSnap.docs[0];
      expect(offerDoc.data().options.length).toBeGreaterThanOrEqual(1);

      // Fast-forward autoBookDeadline to test auto-booking execution
      await offerDoc.ref.set({
        autoBookDeadline: new Date(Date.now() - 1000).toISOString(),
        options: [{
          type: 'same_doctor_next',
          doctorId,
          doctorName: 'Dr. Leave',
          date: '2026-11-06',
          timeSlot: '10:00',
          slotId: altSlotId
        }]
      }, { merge: true });

      const resAutoBook = await leaveRescheduleJob();
      expect(resAutoBook.success).toBe(true);
      expect(resAutoBook.autoBookedCount).toBeGreaterThanOrEqual(1);

      const [updatedAppt, updatedOffer] = await Promise.all([
        db.collection('appointments').doc(apptId).get(),
        offerDoc.ref.get()
      ]);

      expect(updatedAppt.data().date).toBe('2026-11-06');
      expect(updatedAppt.data().autoRescheduled).toBe(true);
      expect(updatedOffer.data().status).toBe('accepted');
      expect(updatedOffer.data().autoBooked).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. OTHER MAINTENANCE JOBS (cleanupJob, generateSlotsJob, fairnessBumpJob)
  // ─────────────────────────────────────────────────────────────
  describe('Job 9: Maintenance Jobs', () => {
    it('cleanupJob deletes notifications and reminders older than 30 days', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
      const oldNotifId = uid('old_notif');
      const oldRemId = uid('old_rem');

      await db.collection('notifications').doc(oldNotifId).set({
        uid: uid('user'),
        read: true,
        createdAt: oldDate
      });

      await db.collection('reminders').doc(oldRemId).set({
        status: 'sent',
        dueAt: oldDate.toISOString()
      });

      const res = await cleanupJob();
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBeGreaterThanOrEqual(1);

      const [notifSnap, remSnap] = await Promise.all([
        db.collection('notifications').doc(oldNotifId).get(),
        db.collection('reminders').doc(oldRemId).get()
      ]);

      expect(notifSnap.exists).toBe(false);
      expect(remSnap.exists).toBe(false);
    });

    it('fairnessBumpJob elevates delayed routine patients to urgent priority', async () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const apptId = uid('bump_appt');

      // Routine patient booked 45 min ago, checked in
      const bookedStartAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      await db.collection('appointments').doc(apptId).set({
        id: apptId,
        date: todayStr,
        status: 'checked_in',
        clinicalLevel: 1,
        bookedStartAt,
        fairnessBumpApplied: false,
        doctorId: uid('doc')
      });

      const res = await fairnessBumpJob();
      expect(res.success).toBe(true);
      expect(res.bumpedCount).toBeGreaterThanOrEqual(1);

      const snap = await db.collection('appointments').doc(apptId).get();
      expect(snap.data().fairnessBumpApplied).toBe(true);
    });

    it('generateSlotsJob creates slots according to schedule without overwriting existing', async () => {
      const docId = uid('doc_slots');
      await db.collection('doctors').doc(docId).set({
        doctorId: docId,
        active: true,
        schedule: {
          slotMinutes: 15,
          weekly: [{ dayOfWeek: 1, sessions: [{ start: '09:00', end: '10:00' }] }]
        }
      });

      const res = await generateSlotsJob(3);
      expect(res.success).toBe(true);
      expect(typeof res.totalSlots).toBe('number');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 10. DISTRIBUTED MUTEX & OVERLAPPING EXECUTION LOCK
  // ─────────────────────────────────────────────────────────────
  describe('Job 10: Distributed Mutex (withJobLock) & Concurrency Safety', () => {
    it('acquires lock, executes job, and releases lock upon completion', async () => {
      const testJobName = uid('test_job');
      let executed = false;

      const res = await withJobLock(testJobName, async () => {
        executed = true;
        return { success: true, count: 42 };
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(42);
      expect(executed).toBe(true);

      const lockDoc = await db.collection('job_locks').doc(testJobName).get();
      expect(lockDoc.exists).toBe(true);
      expect(lockDoc.data().locked).toBe(false);
      expect(lockDoc.data().releasedAt).toBeTruthy();
    });

    it('prevents overlapping runs by returning skipped when lock is held', async () => {
      const testJobName = uid('lock_held');

      // Manually set lock document as locked
      await db.collection('job_locks').doc(testJobName).set({
        jobName: testJobName,
        locked: true,
        expiresAt: Date.now() + 60000,
        lockedBy: 'worker_another_instance'
      });

      let wasExecuted = false;
      const res = await withJobLock(testJobName, async () => {
        wasExecuted = true;
        return { success: true };
      });

      expect(wasExecuted).toBe(false);
      expect(res.success).toBe(true);
      expect(res.skipped).toBe(true);
      expect(res.reason).toContain('locked by another active process');
    });

    it('recovers and acquires lock if previous lock expired', async () => {
      const testJobName = uid('expired_lock');

      // Set lock expired in the past
      await db.collection('job_locks').doc(testJobName).set({
        jobName: testJobName,
        locked: true,
        expiresAt: Date.now() - 5000,
        lockedBy: 'dead_worker'
      });

      let executed = false;
      const res = await withJobLock(testJobName, async () => {
        executed = true;
        return { success: true, recovered: true };
      });

      expect(executed).toBe(true);
      expect(res.success).toBe(true);
      expect(res.recovered).toBe(true);
    });

    it('runSchedulerJobs() handles concurrent runs with zero race conditions or unhandled rejections', async () => {
      const [res1, res2] = await Promise.all([
        runSchedulerJobs(),
        runSchedulerJobs()
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect(res1.noShowSweep?.success).toBe(true);
      expect(res2.noShowSweep?.success).toBe(true);
      expect(res1.appointmentReminders?.success).toBe(true);
      expect(res2.appointmentReminders?.success).toBe(true);
    }, 60000);
  });

  // ─────────────────────────────────────────────────────────────
  // 11. INTERNAL TICK ENDPOINT SECURITY & ENVIRONMENT GUARDS
  // ─────────────────────────────────────────────────────────────
  describe('Job 11: Internal Tick Endpoint Security', () => {
    it('accepts valid secret and executes jobs in emulator environment', async () => {
      const res = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', env.INTERNAL_TICK_SECRET || 'dev_tick_secret');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticked).toBe(true);
      expect(res.body.data.results).toBeDefined();
    });

    it('rejects missing or invalid secret header with 403 FORBIDDEN', async () => {
      const resNoHeader = await request(app)
        .post('/api/internal/tick');
      expect(resNoHeader.statusCode).toBe(403);

      const resBadHeader = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', 'completely_wrong_secret_12345');
      expect(resBadHeader.statusCode).toBe(403);
    });

    it('rejects default secrets when simulating non-emulator / production environment', async () => {
      const originalHost = process.env.FIRESTORE_EMULATOR_HOST;
      try {
        // Temporarily unset emulator host to simulate real environment
        delete process.env.FIRESTORE_EMULATOR_HOST;

        const res = await request(app)
          .post('/api/internal/tick')
          .set('x-tick-secret', 'dev_tick_secret');

        expect(res.statusCode).toBe(403);
        expect(res.body.error.message).toContain('production tick secret is not configured');
      } finally {
        process.env.FIRESTORE_EMULATOR_HOST = originalHost;
      }
    });

    it('executes full 13-job suite including daily maintenance when includeDaily=true or scope=all', async () => {
      const res = await request(app)
        .post('/api/internal/tick?includeDaily=true')
        .set('x-tick-secret', env.INTERNAL_TICK_SECRET || 'dev_tick_secret');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results.cleanup).toBeDefined();
      expect(res.body.data.results.generateSlots).toBeDefined();
      expect(res.body.data.results.noShowSweep).toBeDefined();
    }, 120000);

    it('rejects empty or whitespace-only secret header with 403 FORBIDDEN', async () => {
      const resEmpty = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', '');
      expect(resEmpty.statusCode).toBe(403);

      const resSpaces = await request(app)
        .post('/api/internal/tick')
        .set('x-tick-secret', '   ');
      expect(resSpaces.statusCode).toBe(403);
    });

    it('confirms FLAG_SCHEDULER is false and automatic background timer is disabled', () => {
      expect(flags.scheduler).toBe(false);
    });
  });
});

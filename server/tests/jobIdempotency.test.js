import { describe, it, expect } from 'vitest';
import {
  generateSlotsJob,
  noShowSweepJob,
  fairnessBumpJob,
  releaseCancelledSlotsJob,
  escalateTriageAlertsJob,
  appointmentRemindersJob,
  cleanupJob
} from '../src/jobs/scheduler.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';
import { followupSweepJob } from '../src/jobs/followupSweep.js';
import { dailyDoctorAlertsJob } from '../src/jobs/dailyDoctorAlerts.js';
import { leaveRescheduleJob } from '../src/jobs/leaveReschedule.js';
import { expireWaitlistOffersJob } from '../src/services/waitlistService.js';

describe('Phase 12 Hardening - Job Idempotency Verification', () => {
  it('generateSlotsJob is idempotent when run twice', async () => {
    const res1 = await generateSlotsJob(1);
    const res2 = await generateSlotsJob(1);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('processRemindersJob is idempotent when run twice', async () => {
    const res1 = await processRemindersJob();
    const res2 = await processRemindersJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('noShowSweepJob is idempotent when run twice', async () => {
    const res1 = await noShowSweepJob();
    const res2 = await noShowSweepJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('fairnessBumpJob is idempotent when run twice', async () => {
    const res1 = await fairnessBumpJob();
    const res2 = await fairnessBumpJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('releaseCancelledSlotsJob is idempotent when run twice', async () => {
    const res1 = await releaseCancelledSlotsJob();
    const res2 = await releaseCancelledSlotsJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('expireWaitlistOffersJob is idempotent when run twice', async () => {
    const res1 = await expireWaitlistOffersJob();
    const res2 = await expireWaitlistOffersJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('escalateTriageAlertsJob is idempotent when run twice', async () => {
    const res1 = await escalateTriageAlertsJob();
    const res2 = await escalateTriageAlertsJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('appointmentRemindersJob is idempotent when run twice', async () => {
    const res1 = await appointmentRemindersJob();
    const res2 = await appointmentRemindersJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('followupSweepJob is idempotent when run twice', async () => {
    const res1 = await followupSweepJob();
    const res2 = await followupSweepJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('dailyDoctorAlertsJob is idempotent when run twice', async () => {
    const res1 = await dailyDoctorAlertsJob();
    const res2 = await dailyDoctorAlertsJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('leaveRescheduleJob is idempotent when run twice', async () => {
    const res1 = await leaveRescheduleJob();
    const res2 = await leaveRescheduleJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('cleanupJob is idempotent when run twice', async () => {
    const res1 = await cleanupJob();
    const res2 = await cleanupJob();

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
  });

  it('processRemindersJob concurrent run: only one of two parallel runs sends a reminder', async () => {
    // Seed a pending reminder that is already due
    const { assertDbConnected } = await import('../src/config/firebase.js');
    const db = assertDbConnected();
    const remId = `rem_concurrency_${Date.now()}`;
    const pastDue = new Date(Date.now() - 60_000); // 1 min ago

    await db.collection('reminders').doc(remId).set({
      id: remId,
      status: 'pending',
      dueAt: pastDue.toISOString(),
      receiverUids: ['patient-uid-concurrent'],
      title: 'Concurrent Test Reminder',
      body: 'Test body',
      type: 'test_reminder'
    });

    // Run two job instances simultaneously
    const [r1, r2] = await Promise.all([
      processRemindersJob(),
      processRemindersJob()
    ]);

    // Exactly one of the two should have sent it
    const totalSent = (r1.sent || 0) + (r2.sent || 0);
    expect(totalSent).toBe(1);

    // Both must succeed (the loser simply finds nothing to claim)
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // The reminder must be 'sent' in the database (not 'pending' or 'sending')
    const final = await db.collection('reminders').doc(remId).get();
    expect(final.data().status).toBe('sent');
  });
});

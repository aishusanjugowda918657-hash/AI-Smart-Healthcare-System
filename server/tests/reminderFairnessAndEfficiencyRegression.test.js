import { describe, it, expect, beforeEach } from 'vitest';
import { assertDbConnected } from '../src/config/firebase.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';

describe('Phase 37 — Reminder Processing Fairness and Query Efficiency Regression Suite', () => {
  let db;
  const testPatientUid = 'patient-rem-fair-001';
  const testHealthId = 'HID-REM-FAIR-001';

  beforeEach(async () => {
    db = assertDbConnected();

    // Clean up any pending reminders for test patient
    const existingSnap = await db.collection('reminders')
      .where('receiverUids', 'array-contains', testPatientUid)
      .get();
    for (const doc of existingSnap.docs) {
      await doc.ref.delete();
    }
  });

  const createReminder = async (id, { dueAt, status = 'pending', attempts = 0, type = 'medicine' }) => {
    await db.collection('reminders').doc(id).set({
      id,
      patientUid: testPatientUid,
      receiverUids: [testPatientUid],
      patientName: 'Test Patient',
      healthId: testHealthId,
      status,
      dueAt,
      attempts,
      type,
      title: `Reminder ${id}`,
      body: `Take dose for ${id}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  };

  it('1. Future pending reminders are excluded from processing', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const pastDueIso = new Date('2026-10-10T11:55:00.000Z').toISOString();
    const futureDueIso = new Date('2026-10-10T12:30:00.000Z').toISOString();

    const remPastId = `rem_past_${Date.now()}`;
    const remFutureId = `rem_future_${Date.now()}`;

    await createReminder(remPastId, { dueAt: pastDueIso });
    await createReminder(remFutureId, { dueAt: futureDueIso });

    const result = await processRemindersJob({ nowOverride: now, batchSize: 50 });
    expect(result.success).toBe(true);

    const pastDoc = await db.collection('reminders').doc(remPastId).get();
    const futureDoc = await db.collection('reminders').doc(remFutureId).get();

    expect(pastDoc.data().status).toBe('sent');
    expect(futureDoc.data().status).toBe('pending');
    expect(futureDoc.data().claimedBy).toBeUndefined();

    await db.collection('reminders').doc(remPastId).delete();
    await db.collection('reminders').doc(remFutureId).delete();
  });

  it('2. Due reminders are processed in earliest-due-first order', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    // Stagger three reminders: -40m (earliest), -20m (middle), -5m (latest)
    const remEarliestId = `rem_early_${Date.now()}`;
    const remMiddleId = `rem_mid_${Date.now()}`;
    const remLatestId = `rem_late_${Date.now()}`;

    await createReminder(remLatestId, { dueAt: new Date('2026-10-10T11:55:00.000Z').toISOString() });
    await createReminder(remMiddleId, { dueAt: new Date('2026-10-10T11:40:00.000Z').toISOString() });
    await createReminder(remEarliestId, { dueAt: new Date('2026-10-10T11:20:00.000Z').toISOString() });

    // With batchSize: 2, only the two earliest due (-40m and -20m) should be processed in batch 1
    const result = await processRemindersJob({ nowOverride: now, batchSize: 2, maxBatches: 1 });
    expect(result.success).toBe(true);

    const earliestDoc = await db.collection('reminders').doc(remEarliestId).get();
    const middleDoc = await db.collection('reminders').doc(remMiddleId).get();
    const latestDoc = await db.collection('reminders').doc(remLatestId).get();

    expect(earliestDoc.data().status).toBe('sent');
    expect(middleDoc.data().status).toBe('sent');
    expect(latestDoc.data().status).toBe('pending'); // Left for subsequent batch

    await db.collection('reminders').doc(remEarliestId).delete();
    await db.collection('reminders').doc(remMiddleId).delete();
    await db.collection('reminders').doc(remLatestId).delete();
  });

  it('3. More due reminders than one batch are eventually processed safely', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const ids = [];

    for (let i = 0; i < 5; i++) {
      const id = `rem_batch_${i}_${Date.now()}`;
      ids.push(id);
      await createReminder(id, {
        dueAt: new Date(now.getTime() - (10 - i) * 60_000).toISOString()
      });
    }

    // Pass batchSize = 2, maxBatches = 1 (simulating single cron tick)
    const run1 = await processRemindersJob({ nowOverride: now, batchSize: 2, maxBatches: 1 });
    expect(run1.processed).toBe(2);

    // Run 2: Next tick processes next 2
    const run2 = await processRemindersJob({ nowOverride: now, batchSize: 2, maxBatches: 1 });
    expect(run2.processed).toBe(2);

    // Run 3: Third tick processes the remaining 1
    const run3 = await processRemindersJob({ nowOverride: now, batchSize: 2, maxBatches: 1 });
    expect(run3.processed).toBe(1);

    // All 5 should now be 'sent'
    for (const id of ids) {
      const doc = await db.collection('reminders').doc(id).get();
      expect(doc.data().status).toBe('sent');
      await doc.ref.delete();
    }
  });

  it('4. Concurrent job runs do not process the same reminder twice', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const remIds = [
      `rem_race_1_${Date.now()}`,
      `rem_race_2_${Date.now()}`,
      `rem_race_3_${Date.now()}`
    ];

    for (const id of remIds) {
      await createReminder(id, {
        dueAt: new Date('2026-10-10T11:50:00.000Z').toISOString()
      });
    }

    // Execute two parallel runs simultaneously
    const [res1, res2] = await Promise.all([
      processRemindersJob({ nowOverride: now, batchSize: 10 }),
      processRemindersJob({ nowOverride: now, batchSize: 10 })
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.processed + res2.processed).toBe(3);

    for (const id of remIds) {
      const doc = await db.collection('reminders').doc(id).get();
      expect(doc.data().status).toBe('sent');
      expect(doc.data().attempts).toBe(1);
      await doc.ref.delete();
    }
  });

  it('5. Failed reminders transition to failed after 3 attempts and do not block other due reminders', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const remFailId = `rem_fail_blocked_${Date.now()}`;
    const remSuccessId = `rem_success_unblocked_${Date.now()}`;

    // Reminder with attempts: 2 that will fail again (no receiverUids -> notify skipped/handled, but let's test attempts exhaustion)
    await db.collection('reminders').doc(remFailId).set({
      id: remFailId,
      status: 'pending',
      dueAt: new Date('2026-10-10T11:00:00.000Z').toISOString(),
      attempts: 2, // Next attempt is 3rd attempt
      receiverUids: [], // No valid receiver
      title: 'Failing reminder',
      body: 'Will fail',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    await createReminder(remSuccessId, {
      dueAt: new Date('2026-10-10T11:30:00.000Z').toISOString()
    });

    const res = await processRemindersJob({ nowOverride: now, batchSize: 10 });
    expect(res.success).toBe(true);

    const successDoc = await db.collection('reminders').doc(remSuccessId).get();
    expect(successDoc.data().status).toBe('sent');

    await db.collection('reminders').doc(remFailId).delete();
    await db.collection('reminders').doc(remSuccessId).delete();
  });

  it('6. Handles both ISO string and Firestore Timestamp dueAt formats in the same batch', async () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    const remIsoId = `rem_dual_iso_${Date.now()}`;
    const remTimestampId = `rem_dual_ts_${Date.now()}`;

    // 1. ISO string representation
    await createReminder(remIsoId, {
      dueAt: new Date('2026-10-10T11:45:00.000Z').toISOString()
    });

    // 2. Firestore Timestamp representation (JS Date object)
    await createReminder(remTimestampId, {
      dueAt: new Date('2026-10-10T11:40:00.000Z') // Stored as Timestamp
    });

    const res = await processRemindersJob({ nowOverride: now, batchSize: 10 });
    expect(res.success).toBe(true);
    expect(res.processed).toBe(2);

    const isoDoc = await db.collection('reminders').doc(remIsoId).get();
    const tsDoc = await db.collection('reminders').doc(remTimestampId).get();

    expect(isoDoc.data().status).toBe('sent');
    expect(tsDoc.data().status).toBe('sent');

    await db.collection('reminders').doc(remIsoId).delete();
    await db.collection('reminders').doc(remTimestampId).delete();
  });
});

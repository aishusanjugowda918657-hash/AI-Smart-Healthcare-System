/**
 * Background Jobs & Scheduler Module (PRD F2, F5, F6, F8, Section 10)
 *
 * Phase 7 extends the existing Phase 3–6 jobs with:
 *  - escalateTriageAlerts    (every minute)
 *  - processReminders        (every minute) — placeholder, Phase 9
 *  - node-cron wiring        (FLAG_SCHEDULER=true)
 *
 * Rules:
 *  - Every job is idempotent (safe to call twice).
 *  - Never throws out of the scheduler (catch + log).
 *  - Uses clock.now() for all time operations.
 *  - Processes everything due up to now (catch-up).
 *  - Limits query size to 200 per run.
 */

import { assertDbConnected } from '../config/firebase.js';
import { generateSlotsForDoctorDate } from '../domain/slots.js';
import { SlotStatus } from '../domain/constants.js';
import { clock } from '../utils/clock.js';
import { notify } from '../services/notify.js';
import { recalculateQueue } from '../services/queueService.js';
import { processRemindersJob } from './processReminders.js';
import { followupSweepJob } from './followupSweep.js';
import { dailyDoctorAlertsJob } from './dailyDoctorAlerts.js';
import { leaveRescheduleJob } from './leaveReschedule.js';
import { expireWaitlistOffersJob } from '../services/waitlistService.js';

// ─────────────────────────────────────────────────────────────
// PHASE 2 / 3 JOBS (preserved from Phase 3–6)
// ─────────────────────────────────────────────────────────────

/**
 * Daily job: Generate bookable slots for all active doctors for the next N days (default 14)
 */
export async function generateSlotsJob(daysAhead = 14) {
  try {
    const db = assertDbConnected();
    const doctorsSnap = await db.collection('doctors').get();
    const doctors = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let totalSlots = 0;
    const today = new Date();

    for (const doc of doctors) {
      const doctorId = doc.doctorId || doc.id;
      const schedule = doc.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
        ],
        lunch: { start: '13:00', end: '14:00' }
      };

      const leavesSnap = await db.collection('leaves').where('doctorId', '==', doctorId).get();
      const leaves = leavesSnap.docs.map((l) => l.data());

      for (let i = 0; i < daysAhead; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        const existingSnap = await db
          .collection('slots')
          .where('doctorId', '==', doctorId)
          .where('date', '==', dateStr)
          .get();

        const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

        const generated = generateSlotsForDoctorDate({
          doctorId,
          date: dateStr,
          schedule,
          leaves,
          existingSlots
        });

        if (generated.length > 0) {
          const batch = db.batch();
          generated.forEach((s) => {
            batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
          });
          await batch.commit();
          totalSlots += generated.length;
        }
      }
    }

    return { success: true, totalSlots, doctorsProcessed: doctors.length };
  } catch (error) {
    console.error('❌ generateSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sweep job: Expire held slots whose heldUntil timestamp is in the past
 */
export async function expireHoldsJob() {
  try {
    const db = assertDbConnected();
    const nowIso = clock.now().toISOString();
    const now = clock.now();

    // Simple query on status only (avoids compound index requirement)
    const heldSnap = await db
      .collection('slots')
      .where('status', '==', SlotStatus.HELD)
      .get();

    if (heldSnap.empty) {
      return { success: true, expiredCount: 0 };
    }

    const batch = db.batch();
    let expiredCount = 0;

    heldSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.heldUntil) return;

      const heldUntil = data.heldUntil?.toDate?.() || new Date(data.heldUntil);
      if (heldUntil > now) return; // Not expired yet

      const newStatus = data.defaultStatus === SlotStatus.RESERVED ? SlotStatus.RESERVED : SlotStatus.FREE;
      batch.update(doc.ref, {
        status: newStatus,
        heldBy: null,
        heldUntil: null,
        updatedAt: now
      });
      expiredCount++;
    });

    if (expiredCount > 0) {
      await batch.commit();
    }

    return { success: true, expiredCount };
  } catch (error) {
    console.error('❌ expireHoldsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Sweep no-shows and handle late tiers / rejoin order (PRD F5 & 10)
 */
export async function noShowSweepJob({ nowOverride, gracePeriodMinutes = 5 } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const todayStr = now.toISOString().split('T')[0];

    const aptSnap = await db
      .collection('appointments')
      .where('date', '==', todayStr)
      .where('status', 'in', ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'called', 'rejoined'])
      .get();

    if (aptSnap.empty) {
      return { success: true, processedCount: 0, noShowCount: 0 };
    }

    let noShowCount = 0;
    const batch = db.batch();

    for (const doc of aptSnap.docs) {
      const apt = doc.data();
      if (!apt.timeSlot) continue;

      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const apptTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins);
      const apptTimeMs = apptTime.getTime();
      const graceEndMs = apptTimeMs + (gracePeriodMinutes * 60 * 1000);

      // Un-checked in past start time → mark not_arrived
      if (now.getTime() > apptTimeMs && ['booked', 'confirmed', 'on_the_way'].includes(apt.status)) {
        batch.update(doc.ref, {
          status: 'not_arrived',
          notArrivedAt: now,
          updatedAt: now
        });
      }

      // Past grace period without check-in or call → mark NO_SHOW
      if (now.getTime() > graceEndMs && ['not_arrived', 'nearby', 'called'].includes(apt.status)) {
        batch.update(doc.ref, {
          status: 'no_show',
          noShowAt: now,
          updatedAt: now
        });
        noShowCount++;

        // Serious follow-up alert hook if high risk or urgent triage
        if (apt.clinicalLevel >= 2 || apt.riskLevel === 'high') {
          const alertId = `alert_noshow_${doc.id}_${now.getTime()}`;
          const alertRef = db.collection('alerts').doc(alertId);
          batch.set(alertRef, {
            id: alertId,
            appointmentId: doc.id,
            patientHealthId: apt.patientHealthId || apt.healthId,
            patientName: apt.patientName || 'Patient',
            reasons: [`High-risk patient NO-SHOW for appointment ${doc.id}`],
            kind: 'no_show_followup',
            status: 'open',
            createdAt: now
          });
        }
      }
    }

    await batch.commit();
    return { success: true, processedCount: aptSnap.size, noShowCount };
  } catch (error) {
    console.error('❌ noShowSweepJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Release slots for cancelled appointments after the undo window (PRD F5)
 */
export async function releaseCancelledSlotsJob() {
  try {
    const db = assertDbConnected();

    const cancelledSnap = await db
      .collection('appointments')
      .where('status', '==', 'cancelled')
      .limit(200)
      .get();

    if (cancelledSnap.empty) {
      return { success: true, releasedCount: 0 };
    }

    let releasedCount = 0;
    const batch = db.batch();

    for (const doc of cancelledSnap.docs) {
      const apt = doc.data();
      const now = clock.now();

      // Respect undo window: don't release until undoUntil has passed
      if (apt.cancel?.undoUntil) {
        const undoUntil = apt.cancel.undoUntil?.toDate?.() || new Date(apt.cancel.undoUntil);
        if (undoUntil > now) continue;
      }

      const slotIds = apt.slotIds || (apt.slotId ? [apt.slotId] : []);
      for (const slotId of slotIds) {
        const slotRef = db.collection('slots').doc(slotId);
        const slotSnap = await slotRef.get();
        if (slotSnap.exists && [SlotStatus.BOOKED, SlotStatus.HELD, 'booked', 'held'].includes(slotSnap.data().status)) {
          batch.update(slotRef, {
            status: SlotStatus.FREE,
            appointmentId: null,
            heldBy: null,
            heldUntil: null,
            updatedAt: clock.now()
          });
          releasedCount++;
        }
      }
    }

    if (releasedCount > 0) {
      await batch.commit();
    }

    return { success: true, releasedCount };
  } catch (error) {
    console.error('❌ releaseCancelledSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Appointment reminders (24h, 2h, and final 30-min) (PRD F5, Section 10)
 * Creates reminder documents with Confirm/Cancel action tokens.
 * Idempotent: uses deterministic reminder IDs.
 */
export async function appointmentRemindersJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const nowMs = now.getTime();

    // Use two queries instead of 'in' operator to avoid composite index requirement
    const [bookedSnap, confirmedSnap] = await Promise.all([
      db.collection('appointments').where('status', '==', 'booked').limit(200).get(),
      db.collection('appointments').where('status', '==', 'confirmed').limit(100).get(),
    ]);

    const allDocs = [...bookedSnap.docs, ...confirmedSnap.docs];

    if (allDocs.length === 0) {
      return { success: true, remindersCreated: 0 };
    }

    let remindersCreated = 0;
    const batch = db.batch();

    for (const doc of allDocs) {
      const apt = doc.data();
      if (!apt.date || !apt.timeSlot) continue;

      // Parse appointment time in UTC to avoid local-timezone issues
      const [year, month, day] = apt.date.split('-').map(Number);
      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const apptTime = new Date(Date.UTC(year, month - 1, day, hours, mins));
      const apptMs = apptTime.getTime();

      const diffMs = apptMs - nowMs;
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffMins = diffMs / (1000 * 60);

      const receiverUids = [apt.ownerUid || apt.patientUid || apt.patientId].filter(Boolean);

      // 24h Reminder (between 23h and 25h before)
      if (diffHours >= 23 && diffHours <= 25 && !apt.reminder24hSent) {
        const remId = `rem_24h_${doc.id}`;
        batch.set(
          db.collection('reminders').doc(remId),
          {
            id: remId,
            appointmentId: doc.id,
            type: 'appointment_24h',
            healthId: apt.patientHealthId || null,
            patientName: apt.patientName || 'Patient',
            receiverUids,
            title: `${apt.patientName || 'Patient'}: Appointment Tomorrow`,
            body: `Your consultation with ${apt.doctorName || 'Doctor'} is scheduled for tomorrow at ${apt.timeSlot}.`,
            privacyBody: `${apt.patientName || 'Patient'}: Appointment reminder`,
            status: 'pending',
            dueAt: now,
            attempts: 0,
            createdAt: now,
            updatedAt: now
          },
          { merge: true }
        );
        batch.update(doc.ref, { reminder24hSent: true, updatedAt: now });
        remindersCreated++;
      }

      // 2h Reminder (between 1.5h and 2.5h before)
      if (diffHours >= 1.5 && diffHours <= 2.5 && !apt.reminder2hSent) {
        const remId = `rem_2h_${doc.id}`;
        batch.set(
          db.collection('reminders').doc(remId),
          {
            id: remId,
            appointmentId: doc.id,
            type: 'appointment_2h',
            healthId: apt.patientHealthId || null,
            patientName: apt.patientName || 'Patient',
            receiverUids,
            title: `${apt.patientName || 'Patient'}: Appointment in 2 Hours`,
            body: `Your appointment with ${apt.doctorName || 'Doctor'} starts at ${apt.timeSlot}. Please confirm you are coming.`,
            privacyBody: `${apt.patientName || 'Patient'}: Appointment in 2 hours`,
            status: 'pending',
            dueAt: now,
            attempts: 0,
            createdAt: now,
            updatedAt: now
          },
          { merge: true }
        );
        batch.update(doc.ref, { reminder2hSent: true, updatedAt: now });
        remindersCreated++;
      }

      // Final reminder: 25–35 minutes before (unconfirmed only)
      if (diffMins >= 25 && diffMins <= 35 && apt.status === 'booked' && !apt.reminderFinalSent) {
        const remId = `rem_final_${doc.id}`;
        batch.set(
          db.collection('reminders').doc(remId),
          {
            id: remId,
            appointmentId: doc.id,
            type: 'appointment_final',
            healthId: apt.patientHealthId || null,
            patientName: apt.patientName || 'Patient',
            receiverUids,
            title: `${apt.patientName || 'Patient'}: Final Reminder`,
            body: `Your appointment starts in ~30 minutes. Please confirm.`,
            privacyBody: `${apt.patientName || 'Patient'}: Final appointment reminder`,
            status: 'pending',
            dueAt: now,
            attempts: 0,
            createdAt: now,
            updatedAt: now
          },
          { merge: true }
        );
        batch.update(doc.ref, { reminderFinalSent: true, updatedAt: now });
        remindersCreated++;
      }
    }

    if (remindersCreated > 0) {
      await batch.commit();
    }

    return { success: true, remindersCreated };
  } catch (error) {
    console.error('❌ appointmentRemindersJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Fairness Bump Job (PRD F6 & Section 5.1)
 * Raises routine patients (clinicalLevel=1) delayed >= 30 min to urgent rank
 * and sends fairness notification.
 */
export async function fairnessBumpJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const todayStr = now.toISOString().split('T')[0];

    // Two queries to avoid 'in' compound index requirement
    const [ciSnap, rjSnap] = await Promise.all([
      db.collection('appointments').where('date', '==', todayStr).where('status', '==', 'checked_in').get(),
      db.collection('appointments').where('date', '==', todayStr).where('status', '==', 'rejoined').get(),
    ]);
    const allCheckedIn = [...ciSnap.docs, ...rjSnap.docs];

    if (allCheckedIn.length === 0) {
      return { success: true, bumpedCount: 0 };
    }

    let bumpedCount = 0;
    const affectedDoctors = new Set();

    for (const doc of allCheckedIn) {
      const apt = doc.data();
      if ((apt.clinicalLevel || 1) === 1 && apt.bookedStartAt) {
        const bookedMs = new Date(apt.bookedStartAt).getTime();
        const lateMin = (now.getTime() - bookedMs) / (60 * 1000);

        if (lateMin >= 30 && !apt.fairnessBumpApplied) {
          await doc.ref.update({
            fairnessBumpApplied: true,
            fairnessBumpedAt: now.toISOString(),
            updatedAt: now
          });

          // Send in-app notification using the F8 notify service
          const ownerUid = apt.ownerUid || apt.patientUid || apt.patientId;
          if (ownerUid) {
            try {
              await notify({
                uids: [ownerUid],
                title: `${apt.patientName || 'Patient'}: Queue Position Update`,
                body: 'Your turn is earlier because of your waiting time.',
                privacyBody: `${apt.patientName || 'Patient'}: Queue position updated`,
                type: 'FAIRNESS_BUMP',
                data: { appointmentId: doc.id },
                urgent: true
              });
            } catch (notifyErr) {
              // Fallback: write direct in-app notification
              await db.collection('notifications').add({
                uid: ownerUid,
                title: `${apt.patientName || 'Patient'}: Queue Position Update`,
                body: 'Your turn is earlier because of your waiting time.',
                privacyBody: `${apt.patientName || 'Patient'}: Queue position updated`,
                type: 'FAIRNESS_BUMP',
                data: { appointmentId: doc.id },
                read: false,
                pushStatus: 'none',
                createdAt: now,
                updatedAt: now
              });
            }
          }

          bumpedCount++;
          if (apt.doctorId) affectedDoctors.add(apt.doctorId);
        }
      }
    }

    // Recalculate affected queues
    for (const docId of affectedDoctors) {
      await recalculateQueue(docId, todayStr);
    }

    return { success: true, bumpedCount };
  } catch (error) {
    console.error('❌ fairnessBumpJob error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// PHASE 7 NEW JOBS
// ─────────────────────────────────────────────────────────────

/**
 * Job: Escalate unacknowledged triage alerts after 2 minutes (PRD F4, Section 10)
 *
 * - Finds open triage alerts created more than 2 minutes ago and not yet acknowledged.
 * - Escalates to emergency doctor and department head.
 * - Idempotent: uses escalatedAt to prevent double-escalation.
 */
export async function escalateTriageAlertsJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const escalateThresholdMs = 2 * 60 * 1000; // 2 minutes
    const cutoff = new Date(now.getTime() - escalateThresholdMs);

    // Find open triage alerts older than 2 minutes
    const alertsSnap = await db
      .collection('alerts')
      .where('kind', '==', 'triage')
      .where('status', '==', 'open')
      .limit(200)
      .get();

    if (alertsSnap.empty) {
      return { success: true, escalatedCount: 0 };
    }

    let escalatedCount = 0;
    const batch = db.batch();

    for (const doc of alertsSnap.docs) {
      const alert = doc.data();

      // Skip if already escalated
      if (alert.escalatedAt) continue;

      const createdAt = alert.createdAt?.toDate?.() || new Date(alert.createdAt);
      if (createdAt > cutoff) continue; // Not old enough yet

      // Mark as escalated
      batch.update(doc.ref, {
        escalatedAt: now,
        escalatedTo: ['emergency_doctor', 'department_head'],
        updatedAt: now
      });

      // Notify emergency doctor role (in-app — we don't know the specific UID here
      // so we write a broadcast alert in the alerts collection)
      const escalationAlertId = `esc_${doc.id}`;
      batch.set(
        db.collection('alerts').doc(escalationAlertId),
        {
          kind: 'triage_escalation',
          originalAlertId: doc.id,
          patientName: alert.patientName || 'Unknown',
          patientHealthId: alert.healthId || alert.patientHealthId,
          riskLevel: 'high',
          reasons: [`Triage alert unacknowledged for >2 minutes`],
          status: 'open',
          forRole: 'nurse',
          createdAt: now,
          updatedAt: now
        },
        { merge: true }
      );

      escalatedCount++;
    }

    if (escalatedCount > 0) {
      await batch.commit();
    }

    return { success: true, escalatedCount };
  } catch (error) {
    console.error('❌ escalateTriageAlertsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Process due reminders — claim and send (PRD F11, Section 5.6, Section 10)
 *
 * Uses the claim pattern to prevent double-sending.
 * Retry logic: failed reminders go back to 'pending' with retryAfter;
 * after 3 attempts → 'failed'.
 */
export async function processRemindersJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();

    // Simple query without compound index — filter by status only
    const allPendingSnap = await db
      .collection('reminders')
      .where('status', '==', 'pending')
      .limit(200)
      .get();

    // Filter due items client-side (avoids compound index on status+dueAt)
    const dueSnap = {
      empty: true,
      size: 0,
      docs: allPendingSnap.docs.filter((doc) => {
        const d = doc.data();
        if (!d.dueAt) return false;
        const dueAt = d.dueAt?.toDate?.() || new Date(d.dueAt);
        return dueAt <= now;
      })
    };
    dueSnap.size = dueSnap.docs.length;
    dueSnap.empty = dueSnap.size === 0;

    if (dueSnap.empty) {
      return { success: true, processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const doc of dueSnap.docs) {
      // Claim in a transaction (prevents double-send)
      let claimed = false;
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(doc.ref);
          if (!snap.exists || snap.data().status !== 'pending') return;
          tx.update(doc.ref, {
            status: 'sending',
            attempts: (snap.data().attempts || 0) + 1,
            updatedAt: now
          });
          claimed = true;
        });
      } catch {
        continue; // Another runner claimed it
      }

      if (!claimed) continue;

      const reminder = doc.data();
      const receiverUids = reminder.receiverUids || [];
      const attempts = (reminder.attempts || 0) + 1;

      try {
        // Send notification via F8 notify service
        if (receiverUids.length > 0) {
          await notify({
            uids: receiverUids,
            title: reminder.title || 'Reminder',
            body: reminder.body || '',
            privacyBody: reminder.privacyBody || reminder.body || '',
            type: reminder.type || 'medicine',
            data: { reminderId: doc.id, appointmentId: reminder.appointmentId || '' },
            groupKey: reminder.groupKey,
            urgent: reminder.type === 'medicine'
          });
        }

        await doc.ref.update({ status: 'sent', sentAt: now, updatedAt: now });
        sent++;
      } catch (sendErr) {
        console.error(`processReminders: send failed for ${doc.id}:`, sendErr.message);
        if (attempts >= 3) {
          await doc.ref.update({ status: 'failed', lastError: sendErr.message, updatedAt: now });
          failed++;
        } else {
          // Retry after exponential backoff
          const retryAfter = new Date(now.getTime() + 30_000 * Math.pow(2, attempts - 1));
          await doc.ref.update({ status: 'pending', retryAfter, lastError: sendErr.message, updatedAt: now });
        }
      }
    }

    return { success: true, processed: dueSnap.size, sent, failed };
  } catch (error) {
    console.error('❌ processRemindersJob error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN SCHEDULER ENTRY POINT
// ─────────────────────────────────────────────────────────────

/**
 * runSchedulerJobs() — called by /api/internal/tick and by node-cron.
 * Runs ALL due jobs once. Never throws.
 */
export async function runSchedulerJobs() {
  const results = {};

  const run = async (name, fn) => {
    try {
      results[name] = await fn();
    } catch (err) {
      console.error(`❌ Scheduler: ${name} threw unexpectedly:`, err.message);
      results[name] = { success: false, error: err.message };
    }
  };

  await run('expireHolds', expireHoldsJob);
  await run('noShowSweep', noShowSweepJob);
  await run('releaseCancelledSlots', releaseCancelledSlotsJob);
  await run('appointmentReminders', appointmentRemindersJob);
  await run('fairnessBump', fairnessBumpJob);
  await run('escalateTriageAlerts', escalateTriageAlertsJob);
  await run('processReminders', processRemindersJob);
  await run('followupSweep', followupSweepJob);
  await run('dailyDoctorAlerts', dailyDoctorAlertsJob);
  await run('leaveReschedule', leaveRescheduleJob);
  await run('expireWaitlistOffers', expireWaitlistOffersJob);

  results.timestamp = clock.now().toISOString();
  return results;
}

/**
 * startScheduler() — wires node-cron jobs when FLAG_SCHEDULER=true.
 * Called from server.js once on startup.
 */
export async function startScheduler() {
  try {
    // Dynamic import to avoid pulling node-cron into test bundles
    const { default: cron } = await import('node-cron');

    const safeRun = (name, fn) => async () => {
      try {
        const r = await fn();
        console.log(`✅ [cron] ${name}:`, JSON.stringify(r));
      } catch (err) {
        console.error(`❌ [cron] ${name} error:`, err.message);
      }
    };

    // Every minute
    cron.schedule('* * * * *', safeRun('expireHolds', expireHoldsJob));
    cron.schedule('* * * * *', safeRun('noShowSweep', noShowSweepJob));
    cron.schedule('* * * * *', safeRun('releaseCancelledSlots', releaseCancelledSlotsJob));
    cron.schedule('* * * * *', safeRun('fairnessBump', fairnessBumpJob));
    cron.schedule('* * * * *', safeRun('escalateTriageAlerts', escalateTriageAlertsJob));
    cron.schedule('* * * * *', safeRun('processReminders', processRemindersJob));

    // Every 5 minutes
    cron.schedule('*/5 * * * *', safeRun('appointmentReminders', appointmentRemindersJob));

    // Daily jobs
    cron.schedule('0 1 * * *', safeRun('generateSlots', () => generateSlotsJob(14)));  // 01:00
    cron.schedule('0 3 * * *', safeRun('cleanup', cleanupJob));                         // 03:00

    console.log('✅ Scheduler started (node-cron)');
  } catch (err) {
    console.error('❌ Failed to start scheduler:', err.message);
  }
}

/**
 * Job: Cleanup — delete/archive old reminders, notifications, expired offers (PRD Section 10)
 * Runs daily at 03:00. Deletes sent/failed reminders older than 30 days.
 */
export async function cleanupJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let deletedCount = 0;

    // Clean old sent/failed/missed reminders — split to avoid compound index
    const [sentR, failedR, missedR] = await Promise.all([
      db.collection('reminders').where('status', '==', 'sent').limit(200).get(),
      db.collection('reminders').where('status', '==', 'failed').limit(200).get(),
      db.collection('reminders').where('status', '==', 'missed').limit(200).get(),
    ]);
    const oldReminderDocs = [...sentR.docs, ...failedR.docs, ...missedR.docs].filter((d) => {
      const dueAt = d.data().dueAt?.toDate?.() || new Date(d.data().dueAt || 0);
      return dueAt <= thirtyDaysAgo;
    });

    if (oldReminderDocs.length > 0) {
      const batch = db.batch();
      oldReminderDocs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += oldReminderDocs.length;
    }

    // Clean old read notifications older than 30 days
    const oldNotifs = await db
      .collection('notifications')
      .where('read', '==', true)
      .where('createdAt', '<=', thirtyDaysAgo)
      .limit(200)
      .get();

    if (!oldNotifs.empty) {
      const batch = db.batch();
      oldNotifs.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += oldNotifs.size;
    }

    console.log(`🧹 cleanupJob: deleted ${deletedCount} old records`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('❌ cleanupJob error:', error.message);
    return { success: false, error: error.message };
  }
}

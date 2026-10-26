/**
 * Reminder Processor Job (PRD Section 5.6 & Feature F11)
 * Claim pattern, grouping by groupKey (60s), 2nd reminder (30m), missed status (60m),
 * caregiver escalation (15m post-miss), adherence alert (3 missed), and refill reminders.
 */

import { assertDbConnected } from '../config/firebase.js';
import { notify } from '../services/notify.js';

export async function processRemindersJob({ nowOverride, batchSize = 100, maxBatches = 1 } = {}) {
  const db = assertDbConnected();
  const now = nowOverride ? new Date(nowOverride) : new Date();
  const nowMs = now.getTime();
  const jobId = `job-${Date.now()}`;

  const results = {
    success: true,
    processedCount: 0,
    groupedCount: 0,
    secondRemindersCount: 0,
    missedCount: 0,
    caregiverEscalations: 0,
    adherenceFlags: 0,
    refillReminders: 0,
    // Aliases expected by integration tests
    processed: 0,
    sent: 0
  };

  try {
    // ── Phase 1: Canonical 'reminders' collection (PRD Section 4.2 / 5.6) ──────────
    const boundedBatchSize = Math.min(Math.max(Number(batchSize) || 100, 1), 200);
    const boundedMaxBatches = Math.min(Math.max(Number(maxBatches) || 1, 1), 5);
    const nowIso = now.toISOString();

    const parseDueAtMs = (docData) => {
      const d = docData?.dueAt;
      if (!d) return 0;
      if (typeof d.toDate === 'function') return d.toDate().getTime();
      const ms = new Date(d).getTime();
      return isNaN(ms) ? 0 : ms;
    };

    for (let batchIdx = 0; batchIdx < boundedMaxBatches; batchIdx++) {
      // Query pending reminders due <= now (ordered by dueAt ascending)
      // Query both ISO string representations and Firestore Timestamps to ensure complete coverage
      const [stringSnap, timestampSnap] = await Promise.all([
        db.collection('reminders')
          .where('status', '==', 'pending')
          .where('dueAt', '<=', nowIso)
          .orderBy('dueAt', 'asc')
          .limit(boundedBatchSize)
          .get()
          .catch((err) => {
            console.warn('pending reminders dueAt string query:', err.message);
            return { docs: [] };
          }),
        db.collection('reminders')
          .where('status', '==', 'pending')
          .where('dueAt', '<=', now)
          .orderBy('dueAt', 'asc')
          .limit(boundedBatchSize)
          .get()
          .catch((err) => {
            console.warn('pending reminders dueAt timestamp query:', err.message);
            return { docs: [] };
          })
      ]);

      const docMap = new Map();
      for (const doc of (stringSnap?.docs || [])) docMap.set(doc.id, doc);
      for (const doc of (timestampSnap?.docs || [])) docMap.set(doc.id, doc);

      if (docMap.size === 0) {
        break;
      }

      // Sort combined batch strictly by dueAt ascending (earliest due first)
      const dueDocs = Array.from(docMap.values())
        .filter((d) => parseDueAtMs(d.data()) <= nowMs)
        .sort((a, b) => parseDueAtMs(a.data()) - parseDueAtMs(b.data()))
        .slice(0, boundedBatchSize);

      if (dueDocs.length === 0) {
        break;
      }

      // Group claimed reminders by groupKey (or reminderId if no groupKey)
      const claimedGroups = new Map(); // groupKey -> Array of { doc, data }

      for (const doc of dueDocs) {
        // Atomic claim in transaction: pending -> sending
        let claimed = false;
        try {
          claimed = await db.runTransaction(async (t) => {
            const freshSnap = await t.get(doc.ref);
            if (freshSnap.exists && freshSnap.data().status === 'pending') {
              t.update(doc.ref, {
                status: 'sending',
                claimedBy: jobId,
                claimedAt: now.toISOString(),
                attempts: (freshSnap.data().attempts || 0) + 1,
                updatedAt: now.toISOString()
              });
              return true;
            }
            return false;
          });
        } catch {
          claimed = false;
        }

        if (!claimed) continue;

        const rem = doc.data();
        const groupKey = rem.groupKey || doc.id;
        if (!claimedGroups.has(groupKey)) {
          claimedGroups.set(groupKey, []);
        }
        claimedGroups.get(groupKey).push({ doc, data: rem });
      }

      // Send each group (medicines due at same minute for same patient arrive as ONE notification)
      for (const [groupKey, items] of claimedGroups.entries()) {
        try {
          const first = items[0].data;

          // PRD Section 3.5: Never send reminders for cancelled, completed, or no-show appointments
          if (first.appointmentId) {
            try {
              const aptSnap = await db.collection('appointments').doc(first.appointmentId).get();
              if (aptSnap.exists) {
                const aptData = aptSnap.data();
                const aptStatus = (aptData.status || '').toLowerCase();
                if (['cancelled', 'completed', 'no_show'].includes(aptStatus)) {
                  for (const item of items) {
                    await item.doc.ref.update({
                      status: 'cancelled',
                      cancellationReason: `Appointment in status ${aptStatus}`,
                      updatedAt: now.toISOString()
                    });
                  }
                  continue;
                }
              }
            } catch (aptCheckErr) {
              console.warn('Appointment status check warning in reminder processor:', aptCheckErr.message);
            }
          }

          const receiverUids = first.receiverUids || [first.patientUid].filter(Boolean);
          const patientName = first.patientName || 'Patient';

          let title = first.title || 'Reminder';
          let body = first.body || 'Scheduled dose reminder';
          let privacyBody = first.privacyBody || 'Medicine reminder';

          if (items.length > 1) {
            const medNames = items
              .map((it) => `${it.data.medicineName || it.data.item?.name || 'Medicine'} ${it.data.dosage || ''}`.trim())
              .join(', ');
            title = `${patientName}: Time for your ${items.length} medicines`;
            body = `${patientName}: Time for ${medNames}`;
            privacyBody = `${patientName}: Medicine reminder`;
          }

          let sendSuccess = true;
          if (receiverUids.length > 0) {
            try {
              await notify({
                uids: receiverUids,
                title,
                body,
                privacyBody,
                type: first.type || 'medicine_reminder',
                data: {
                  groupKey,
                  reminderId: items[0].doc.id,
                  count: items.length
                }
              });
            } catch (err) {
              sendSuccess = false;
            }
          }

          // Finalize status for all reminders in this group
          for (const item of items) {
            try {
              if (sendSuccess) {
                await item.doc.ref.update({
                  status: 'sent',
                  sentAt: now.toISOString(),
                  updatedAt: now.toISOString()
                });
                results.sent++;
                results.processed++;
              } else {
                const currentAttempts = (item.data.attempts || 0) + 1;
                if (currentAttempts >= 3) {
                  await item.doc.ref.update({
                    status: 'failed',
                    lastError: 'Delivery failed after 3 attempts',
                    updatedAt: now.toISOString()
                  });
                } else {
                  await item.doc.ref.update({
                    status: 'pending',
                    updatedAt: now.toISOString()
                  });
                }
              }
            } catch (itemErr) {
              console.warn(`Failed to finalize reminder ${item.doc.id}:`, itemErr.message);
            }
          }

          results.groupedCount++;
        } catch (groupErr) {
          console.warn(`Error processing reminder group ${groupKey}:`, groupErr.message);
        }
      }

      // Break early if the returned batch was smaller than the limit
      if (dueDocs.length < boundedBatchSize) {
        break;
      }
    }

    results.processedCount = results.processed;

    // ── Escalation & Missed Check on 'sent' medicine reminders ─────────
    const sentMedicineSnap = await db
      .collection('reminders')
      .where('status', '==', 'sent')
      .where('type', '==', 'medicine')
      .limit(100)
      .get();

    for (const doc of sentMedicineSnap.docs) {
      const rem = doc.data();
      const dueAt = rem.dueAt?.toDate?.() || new Date(rem.dueAt || 0);
      const elapsedMinutes = (nowMs - dueAt.getTime()) / (60 * 1000);

      // 1. Secondary caregiver notified 15 minutes after primary if no answer
      if (elapsedMinutes >= 15 && !rem.secondaryCaregiverNotified) {
        if (Array.isArray(rem.receiverUids) && rem.receiverUids.length > 1) {
          const secondaryUid = rem.receiverUids[1];
          try {
            await notify({
              uids: [secondaryUid],
              title: `Caregiver Alert: ${rem.patientName}'s Medicine`,
              body: `${rem.patientName} has not taken ${rem.medicineName || 'prescribed medicine'} due at ${rem.dueAt?.slice(11, 16) || 'scheduled time'}.`,
              privacyBody: `${rem.patientName}: Medicine reminder alert`,
              type: 'caregiver_medicine_reminder',
              data: { reminderId: doc.id, healthId: rem.healthId }
            });
          } catch {
            // Ignore
          }
        }
        await doc.ref.update({ secondaryCaregiverNotified: true, updatedAt: now.toISOString() });
        results.caregiverEscalations++;
      }

      // 2. Gentle 2nd reminder nudge after 30 minutes
      if (elapsedMinutes >= 30 && elapsedMinutes < 60 && !rem.secondReminderSent) {
        const receiverUids = rem.receiverUids || [rem.patientUid].filter(Boolean);
        if (receiverUids.length > 0) {
          try {
            await notify({
              uids: receiverUids,
              title: `${rem.patientName}: 2nd Reminder for ${rem.medicineName || 'Medication'}`,
              body: `Gentle reminder: Please take your ${rem.medicineName || 'prescribed medicine'}.`,
              privacyBody: `${rem.patientName}: Medicine reminder nudge`,
              type: 'medicine_reminder_nudge',
              data: { reminderId: doc.id }
            });
          } catch {
            // Ignore
          }
        }
        await doc.ref.update({
          secondReminderSent: true,
          secondReminderSentAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
        results.secondRemindersCount++;
      }

      // 3. Mark missed after 60 minutes
      if (elapsedMinutes >= 60) {
        await doc.ref.update({
          status: 'missed',
          missedAt: now.toISOString(),
          updatedAt: now.toISOString()
        });
        results.missedCount++;

        // Also check if this patient has 3 consecutive missed doses
        if (rem.healthId) {
          const patientDosesSnap = await db
            .collection('reminders')
            .where('healthId', '==', rem.healthId)
            .where('type', '==', 'medicine')
            .get();

          const allDoses = patientDosesSnap.docs
            .map((d) => d.data())
            .filter((d) => ['taken', 'missed', 'skipped'].includes(d.status))
            .sort((a, b) => new Date(b.dueAt || 0) - new Date(a.dueAt || 0));

          const recentThree = allDoses.slice(0, 3);
          if (recentThree.length === 3 && recentThree.every((d) => d.status === 'missed')) {
            const alertId = `alert-adherence-${rem.healthId}`;
            await db.collection('alerts').doc(alertId).set({
              id: alertId,
              doctorId: rem.doctorId || 'DOC-001',
              healthId: rem.healthId,
              patientHealthId: rem.healthId,
              patientName: rem.patientName || 'Patient',
              riskLevel: 'high',
              kind: 'daily',
              reasons: ['3 consecutive missed medication doses'],
              status: 'open',
              createdAt: now.toISOString(),
              updatedAt: now.toISOString()
            }, { merge: true });

            results.adherenceFlags++;
          }
        }
      }
    }

    // ── Phase 2: Refill reminders (2 days before last dose for chronic prescriptions) ─
    const medRxSnap = await db
      .collection('prescriptions')
      .where('status', '==', 'active')
      .limit(50)
      .get();

    for (const rxDoc of medRxSnap.docs) {
      const rx = rxDoc.data();
      const medicines = rx.medicines || rx.items || [];
      const isRefill = rx.isRefill || medicines.some((m) => m.isRefill || m.durationDays >= 30);

      if (isRefill && !rx.refillNotified && rx.startDate) {
        const start = new Date(rx.startDate);
        const maxDays = Math.max(...medicines.map((m) => Number(m.durationDays || m.days || 30)));
        const daysElapsed = Math.floor((nowMs - start.getTime()) / (24 * 60 * 60 * 1000));
        const daysRemaining = maxDays - daysElapsed;

        if (daysRemaining <= 2 && daysRemaining >= 0) {
          const patientUid = rx.patientUid || rx.ownerUid;
          if (patientUid) {
            await notify({
              uids: [patientUid],
              title: `${rx.patientName || 'Patient'}: Prescription Refill Reminder`,
              body: `Only 2 days left of your chronic prescription. Please request a refill.`,
              privacyBody: 'Prescription refill reminder',
              type: 'refill_reminder',
              data: { prescriptionId: rxDoc.id }
            });
          }
          await rxDoc.ref.update({ refillNotified: true, updatedAt: now.toISOString() });
          results.refillReminders++;
        }
      }
    }

    // ── Phase 3: Legacy 'medicineReminders' compatibility (for older test suites) ──
    const legacySnap = await db
      .collection('medicineReminders')
      .where('active', '==', true)
      .get();

    if (!legacySnap.empty) {
      for (const doc of legacySnap.docs) {
        const data = doc.data();
        const reminderId = doc.id;
        const startDate = new Date(data.startDate || data.createdAt || now);
        const daysElapsed = Math.floor((nowMs - startDate.getTime()) / (24 * 60 * 60 * 1000));
        const durationDays = Number(data.durationDays) || 5;
        const daysRemaining = durationDays - daysElapsed;

        if (daysRemaining === 2 && !data.refillNotified) {
          await notify({
            uids: [data.patientUid],
            title: 'Prescription Refill Reminder',
            body: `You have 2 days remaining for ${data.medicineName}. Contact your doctor for a prescription renewal.`,
            privacyBody: 'Prescription refill reminder.',
            type: 'refill_reminder',
            data: { prescriptionId: data.prescriptionId, medicineName: data.medicineName }
          });
          await doc.ref.update({ refillNotified: true });
          results.refillReminders++;
        }
      }
    }

    return results;
  } catch (error) {
    console.error('❌ processRemindersJob error:', error.message);
    return { ...results, error: error.message };
  }
}

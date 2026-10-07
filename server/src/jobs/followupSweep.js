/**
 * Follow-up Sweep Job (PRD Feature F12)
 * Sweeps open follow-ups, sends 2-day-before, day-of, and overdue reminders (max 3),
 * and auto-closes follow-ups when matching visit is completed.
 */

import { assertDbConnected } from '../config/firebase.js';
import { notify } from '../services/notify.js';

export async function followupSweepJob() {
  const db = assertDbConnected();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const results = {
    success: true,
    processedCount: 0,
    dueSoonReminders: 0,
    dueTodayReminders: 0,
    overdueReminders: 0,
    autoClosedCount: 0
  };

  try {
    // 1. Query open follow-ups in canonical 'followups' collection
    const snap = await db
      .collection('followups')
      .where('status', 'in', ['scheduled', 'reminded'])
      .get();

    // Also support legacy 'followUps' if canonical is empty
    let docs = snap.docs;
    if (docs.length === 0) {
      const legacySnap = await db
        .collection('followUps')
        .where('status', 'in', ['scheduled', 'reminded'])
        .get();
      docs = legacySnap.docs;
    }

    for (const doc of docs) {
      const data = doc.data();
      const followUpId = doc.id;
      const scheduledDate = new Date(data.dueDate || data.scheduledDate);
      const scheduledStr = scheduledDate.toISOString().split('T')[0];
      const patientHealthId = data.healthId || data.patientHealthId;
      const patientName = data.patientName || 'Patient';
      const doctorName = data.doctorName || 'your doctor';

      // Auto-close check: Check if patient completed a visit with doctor or department after creation date
      const apptSnap = await db
        .collection('appointments')
        .where('patientHealthId', '==', patientHealthId)
        .where('status', '==', 'completed')
        .get();

      const createdAt = new Date(data.createdAt || 0);
      const hasCompletedVisit = apptSnap.docs.some((d) => {
        const apptData = d.data();
        const apptTime = new Date(apptData.completedAt || apptData.date || 0);
        return (
          apptTime >= createdAt &&
          (apptData.doctorId === (data.doctorId || data.doctorUid) ||
            apptData.departmentId === data.departmentId)
        );
      });

      if (hasCompletedVisit) {
        await doc.ref.update({
          status: 'done',
          completedAt: now.toISOString(),
          autoClosed: true,
          updatedAt: now.toISOString()
        });
        results.autoClosedCount++;
        continue;
      }

      // Calculate days difference
      const diffTime = scheduledDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const reminderCount = Number(data.reminderCount) || 0;

      // 1. 2 Days Before Reminder
      if (diffDays === 2 && !data.twoDaysNotified && reminderCount < 3) {
        const remId = `rem-flw-${followUpId}-2d`;
        await db.collection('reminders').doc(remId).set({
          id: remId,
          healthId: patientHealthId,
          patientName,
          receiverUids: data.patientUid ? [data.patientUid] : [],
          type: 'followup',
          followupId: followUpId,
          dueAt: now.toISOString(),
          status: 'pending',
          title: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName}`,
          body: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName}`,
          privacyBody: `${patientName}: Follow-up checkup reminder`,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });

        await notify({
          uids: data.patientUid ? [data.patientUid] : [],
          title: 'Follow-up Checkup Due Soon',
          body: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName}`,
          privacyBody: 'Follow-up checkup due soon.',
          type: 'followup_due_soon',
          data: { followUpId }
        });

        await doc.ref.update({
          twoDaysNotified: true,
          status: 'reminded',
          reminderCount: reminderCount + 1,
          updatedAt: now.toISOString()
        });
        results.dueSoonReminders++;
      }

      // 2. Day of Due Date Reminder
      if (diffDays === 0 && !data.dayOfNotified && reminderCount < 3) {
        const remId = `rem-flw-${followUpId}-today`;
        await db.collection('reminders').doc(remId).set({
          id: remId,
          healthId: patientHealthId,
          patientName,
          receiverUids: data.patientUid ? [data.patientUid] : [],
          type: 'followup',
          followupId: followUpId,
          dueAt: now.toISOString(),
          status: 'pending',
          title: `${patientName}: Follow-up due today with ${doctorName}`,
          body: `${patientName}: Follow-up due today with ${doctorName}`,
          privacyBody: `${patientName}: Follow-up checkup reminder`,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        });

        await notify({
          uids: data.patientUid ? [data.patientUid] : [],
          title: 'Follow-up Checkup Due Today',
          body: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName}`,
          privacyBody: 'Follow-up checkup due today.',
          type: 'followup_due_today',
          data: { followUpId }
        });

        await doc.ref.update({
          dayOfNotified: true,
          status: 'reminded',
          reminderCount: reminderCount + 1,
          updatedAt: now.toISOString()
        });
        results.dueTodayReminders++;
      }

      // 3. Overdue Reminder the next day (maximum 3 total reminders)
      if (diffDays < 0) {
        if (reminderCount < 3 && !data.overdueNotified) {
          const remId = `rem-flw-${followUpId}-overdue`;
          await db.collection('reminders').doc(remId).set({
            id: remId,
            healthId: patientHealthId,
            patientName,
            receiverUids: data.patientUid ? [data.patientUid] : [],
            type: 'followup',
            followupId: followUpId,
            dueAt: now.toISOString(),
            status: 'pending',
            title: `${patientName}: Overdue follow-up with ${doctorName}`,
            body: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName} is overdue.`,
            privacyBody: `${patientName}: Follow-up checkup overdue`,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          });

          await notify({
            uids: data.patientUid ? [data.patientUid] : [],
            title: 'Overdue Follow-up Checkup Notice',
            body: `${patientName}: Follow-up due on ${scheduledStr} with ${doctorName} is overdue.`,
            privacyBody: 'Follow-up checkup overdue.',
            type: 'followup_overdue',
            data: { followUpId }
          });

          await doc.ref.update({
            status: 'overdue',
            overdueNotified: true,
            reminderCount: reminderCount + 1,
            lastOverdueNotifiedAt: now.toISOString(),
            updatedAt: now.toISOString()
          });
          results.overdueReminders++;
        } else {
          // Mark overdue status even if max reminders reached
          await doc.ref.update({ status: 'overdue', updatedAt: now.toISOString() });
        }
      }

      results.processedCount++;
    }

    return results;
  } catch (error) {
    console.error('❌ followupSweepJob error:', error.message);
    return { ...results, error: error.message };
  }
}

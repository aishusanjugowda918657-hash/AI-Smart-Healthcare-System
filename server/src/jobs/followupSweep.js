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
    const snap = await db
      .collection('followUps')
      .where('status', '==', 'scheduled')
      .get();

    if (snap.empty) return results;

    for (const doc of snap.docs) {
      const data = doc.data();
      const followUpId = doc.id;
      const scheduledDate = new Date(data.dueDate || data.scheduledDate);
      const scheduledStr = scheduledDate.toISOString().split('T')[0];

      // Calculate days difference
      const diffTime = scheduledDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Auto-close check: Check if patient completed a visit with doctor after creation date
      const apptSnap = await db
        .collection('appointments')
        .where('patientHealthId', '==', data.patientHealthId)
        .where('status', '==', 'completed')
        .get();

      const createdAt = new Date(data.createdAt || 0);
      const hasCompletedVisit = apptSnap.docs.some((d) => {
        const apptData = d.data();
        const apptTime = new Date(apptData.completedAt || apptData.date || 0);
        return apptTime >= createdAt && (apptData.doctorId === data.doctorUid || apptData.departmentId === data.departmentId);
      });

      if (hasCompletedVisit) {
        await db.collection('followUps').doc(followUpId).update({
          status: 'COMPLETED',
          completedAt: now.toISOString(),
          autoClosed: true,
          updatedAt: now
        });
        results.autoClosedCount++;
        continue;
      }

      // 2 Days Before Reminder
      if (diffDays === 2 && !data.dueSoonNotified) {
        await notify({
          uids: [data.patientUid],
          title: 'Follow-up Checkup Due Soon',
          body: `Reminder: You have a recommended follow-up checkup scheduled for ${scheduledStr}. Click to book your slot.`,
          privacyBody: 'Follow-up checkup due soon.',
          type: 'followup_due_soon',
          data: { followUpId: data.followUpId || followUpId }
        });
        await db.collection('followUps').doc(followUpId).update({ dueSoonNotified: true });
        results.dueSoonReminders++;
      }

      // Day of Due Date Reminder
      if (diffDays === 0 && !data.dueTodayNotified) {
        await notify({
          uids: [data.patientUid],
          title: 'Follow-up Checkup Due Today',
          body: `Today is your scheduled follow-up checkup date. Book your appointment now.`,
          privacyBody: 'Follow-up checkup due today.',
          type: 'followup_due_today',
          data: { followUpId: data.followUpId || followUpId }
        });
        await db.collection('followUps').doc(followUpId).update({ dueTodayNotified: true });
        results.dueTodayReminders++;
      }

      // Overdue Reminders (max 3 overdue reminders)
      if (diffDays < 0) {
        const overdueCount = Number(data.overdueNoticeCount) || 0;
        if (overdueCount < 3) {
          await notify({
            uids: [data.patientUid],
            title: 'Overdue Follow-up Checkup Notice',
            body: `Your follow-up checkup scheduled for ${scheduledStr} is overdue. Please schedule your appointment.`,
            privacyBody: 'Follow-up checkup overdue.',
            type: 'followup_overdue',
            data: { followUpId: data.followUpId || followUpId }
          });

          await db.collection('followUps').doc(followUpId).update({
            overdueNoticeCount: overdueCount + 1,
            lastOverdueNotifiedAt: now.toISOString()
          });
          results.overdueReminders++;
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

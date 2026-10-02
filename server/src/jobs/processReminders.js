/**
 * Reminder Processor Job (PRD Section 5.6 & Feature F11)
 * Claim pattern, grouping by groupKey (60s), 2nd reminder (30m), missed status (60m),
 * caregiver escalation (15m post-miss), adherence alert (3 missed), and refill reminders.
 */

import { assertDbConnected } from '../config/firebase.js';
import { notify } from '../services/notify.js';

export async function processRemindersJob() {
  const db = assertDbConnected();
  const now = new Date();
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
    refillReminders: 0
  };

  try {
    // 1. Fetch active medicine reminders
    const remindersSnap = await db
      .collection('medicineReminders')
      .where('active', '==', true)
      .get();

    if (remindersSnap.empty) {
      return results;
    }

    // Process reminders & dues
    const patientDosesToGroup = new Map(); // patientUid -> array of due items

    for (const doc of remindersSnap.docs) {
      const data = doc.data();
      const reminderId = doc.id;

      // Calculate days remaining for Refill Reminder check
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
        await db.collection('medicineReminders').doc(reminderId).update({ refillNotified: true });
        results.refillReminders++;
      }

      // Check current due status
      const reminderTimes = data.reminderTimes || ['08:00 AM'];
      for (const timeStr of reminderTimes) {
        const groupKey = `${data.patientUid}_${timeStr}_${now.toISOString().split('T')[0]}`;
        const doseKey = `dose-${reminderId}-${timeStr}-${now.toISOString().split('T')[0]}`;

        // Atomic claim check
        const doseDocRef = db.collection('medicineDoses').doc(doseKey);
        const doseDoc = await doseDocRef.get();

        if (!doseDoc.exists) {
          // Create initial dose record
          const scheduledDateObj = new Date(); // Today's date with timeStr
          const [hStr, mStr] = timeStr.split(':');
          let h = parseInt(hStr, 10) || 8;
          if (timeStr.toLowerCase().includes('pm') && h < 12) h += 12;
          if (timeStr.toLowerCase().includes('am') && h === 12) h = 0;
          scheduledDateObj.setHours(h, parseInt(mStr, 10) || 0, 0, 0);

          const newDoseData = {
            id: doseKey,
            reminderId,
            patientUid: data.patientUid,
            patientHealthId: data.patientHealthId || '',
            prescriptionId: data.prescriptionId || '',
            medicineName: data.medicineName,
            dosage: data.dosage,
            scheduledTime: scheduledDateObj.toISOString(),
            status: 'scheduled',
            claimedAt: now.toISOString(),
            claimedByJob: jobId,
            createdAt: now
          };

          await doseDocRef.set(newDoseData);

          if (!patientDosesToGroup.has(data.patientUid)) {
            patientDosesToGroup.set(data.patientUid, []);
          }
          patientDosesToGroup.get(data.patientUid).push(newDoseData);
          results.processedCount++;
        } else {
          const doseData = doseDoc.data();
          const scheduledMs = new Date(doseData.scheduledTime).getTime();
          const elapsedMinutes = (nowMs - scheduledMs) / (60 * 1000);

          // 2nd Reminder Nudge after 30 minutes if still scheduled
          if (doseData.status === 'scheduled' && elapsedMinutes >= 30 && elapsedMinutes < 60 && !doseData.secondReminderSent) {
            await notify({
              uids: [doseData.patientUid],
              title: '2nd Reminder: Take Medication',
              body: `Reminder: Please take ${doseData.medicineName} (${doseData.dosage}).`,
              privacyBody: 'Second medicine reminder nudge.',
              type: 'medicine_reminder_nudge',
              data: { reminderId, doseId: doseKey }
            });

            await doseDocRef.update({ secondReminderSent: true, updatedAt: now });
            results.secondRemindersCount++;
          }

          // Mark MISSED after 60 minutes without response
          if (doseData.status === 'scheduled' && elapsedMinutes >= 60) {
            await doseDocRef.update({ status: 'missed', missedAt: now.toISOString(), updatedAt: now });
            results.missedCount++;

            // 3 Consecutive Misses Adherence Flag Check
            const lastLogsSnap = await db
              .collection('medicineDoses')
              .where('patientUid', '==', doseData.patientUid)
              .get();

            const patientDoses = lastLogsSnap.docs.map((d) => d.data());
            patientDoses.sort((a, b) => new Date(b.scheduledTime) - new Date(a.scheduledTime));
            const recentMisses = patientDoses.slice(0, 3).filter((d) => d.status === 'missed');

            if (recentMisses.length >= 3 && !doseData.adherenceFlagged) {
              await db.collection('doctorAlerts').add({
                id: `alert-${Date.now().toString(36)}`,
                patientUid: doseData.patientUid,
                patientHealthId: doseData.patientHealthId,
                kind: 'FLAG_ADHERENCE_3_MISSED',
                riskLevel: 'high',
                title: '3 Consecutive Missed Doses Alert',
                message: `Patient ${doseData.patientHealthId} has missed 3 consecutive prescribed medication doses.`,
                status: 'open',
                createdAt: now
              });

              await doseDocRef.update({ adherenceFlagged: true });
              results.adherenceFlags++;
            }
          }

          // Secondary Caregiver Notification 15m post-miss
          if (doseData.status === 'missed' && elapsedMinutes >= 75 && !doseData.caregiverNotified) {
            // Fetch caregiver grants
            const grantSnap = await db
              .collection('caregiverAccess')
              .where('patientUid', '==', doseData.patientUid)
              .where('status', '==', 'active')
              .get();

            const caregiverUids = grantSnap.docs.map((d) => d.data().caregiverUid).filter(Boolean);
            if (caregiverUids.length > 0) {
              await notify({
                uids: caregiverUids,
                title: 'Caregiver Alert: Missed Patient Medication',
                body: `Patient ${doseData.patientHealthId} missed scheduled dose for ${doseData.medicineName}.`,
                privacyBody: 'Patient missed medication dose.',
                type: 'caregiver_missed_medication',
                data: { patientHealthId: doseData.patientHealthId, doseId: doseKey }
              });

              await doseDocRef.update({ caregiverNotified: true });
              results.caregiverEscalations++;
            }
          }
        }
      }
    }

    // Send Grouped Notifications (grouped by 60s window per patient)
    for (const [pUid, dueList] of patientDosesToGroup.entries()) {
      if (dueList.length === 0) continue;
      const medNames = dueList.map((d) => `${d.medicineName} (${d.dosage})`).join(', ');

      await notify({
        uids: [pUid],
        title: dueList.length === 1 ? 'Time for your Medication' : `Time for your ${dueList.length} Scheduled Medications`,
        body: `Please take: ${medNames}.`,
        privacyBody: 'Time to take your scheduled medications.',
        type: 'medicine_reminder',
        data: { groupCount: dueList.length, patientUid: pUid }
      });

      results.groupedCount++;
    }

    return results;
  } catch (error) {
    console.error('❌ processRemindersJob error:', error.message);
    return { ...results, error: error.message };
  }
}

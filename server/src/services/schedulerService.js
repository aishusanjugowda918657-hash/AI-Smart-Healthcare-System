import { assertDbConnected } from '../config/firebase.js';
import { createNotification, runNotificationScheduler } from './notificationService.js';
import { noShowSweepJob } from '../jobs/scheduler.js';

/**
 * Helper to parse timeSlot strings like "09:00 AM", "09:15 AM", "14:30" into Date object on dateStr
 */
export const parseSlotToDate = (dateStr, timeSlotStr) => {
  if (!dateStr || !timeSlotStr) return null;

  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return null;

    let hours = 0;
    let minutes = 0;

    const trimmed = timeSlotStr.trim();
    const isPM = /pm/i.test(trimmed);
    const isAM = /am/i.test(trimmed);

    const cleanStr = trimmed.replace(/(am|pm)/i, '').trim();
    const parts = cleanStr.split(':').map(Number);

    if (parts.length >= 1 && !isNaN(parts[0])) {
      hours = parts[0];
    }
    if (parts.length >= 2 && !isNaN(parts[1])) {
      minutes = parts[1];
    }

    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  } catch (err) {
    return null;
  }
};

import { clock } from '../utils/clock.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';

/**
 * Automated No-Show & Grace Period Processor:
 * 1. Checks appointments scheduled for today where patient has not checked in
 *    within 5 minutes past slot start time -> marks status = NO_SHOW.
 * 2. Runs authoritative noShowSweepJob (turn-called grace expiry, silent no-shows,
 *    wait-time recalculations).
 * 3. Triggers follow-up/medicine notification scheduler.
 *
 * Idempotent: safe to run repeatedly.
 */
export const processNoShowsAndReminders = async () => {
  const db = assertDbConnected();
  const now = clock.now();
  const todayStr = getHospitalTodayStr(now);

  let noShowCount = 0;

  try {
    const snapshot = await db
      .collection('appointments')
      .where('date', '==', todayStr)
      .where('status', 'in', ['BOOKED', 'CONFIRMED', 'booked', 'confirmed', 'not_arrived'])
      .get();

    for (const doc of snapshot.docs) {
      const appt = doc.data();
      const slotDate = parseSlotToDate(appt.date, appt.timeSlot || appt.bookedStartAt);

      if (!slotDate) continue;

      const graceThresholdMs = slotDate.getTime() + 5 * 60 * 1000;

      if (now.getTime() >= graceThresholdMs && !appt.checkedInAt) {
        await doc.ref.update({
          status: 'NO_SHOW',
          noShowAt: now,
          updatedAt: now
        });

        const targetApptId = appt.appointmentId || appt.id || doc.id;
        try {
          const tokenRef = db.collection('tokens').doc(`tok-${targetApptId}`);
          await tokenRef.set({ status: 'no_show', noShowAt: now, updatedAt: now }, { merge: true });
        } catch (_) {}

        if (appt.patientUid) {
          try {
            await createNotification({
              userId: appt.patientUid,
              title: 'Appointment Marked as No-Show',
              message: `Your appointment scheduled for ${appt.timeSlot || appt.bookedStartAt} on ${appt.date} was marked as No-Show because you did not arrive within the 5-minute grace period.`,
              type: 'appointment',
              patientHealthId: appt.patientHealthId || ''
            });
          } catch (_) {}
        }

        noShowCount++;
      }
    }

    const sweepResult = await noShowSweepJob();
    const notifResult = await runNotificationScheduler();

    return {
      success: true,
      processedNoShows: noShowCount + (sweepResult.noShowCount || 0),
      sweep: sweepResult,
      ...notifResult
    };
  } catch (error) {
    console.error('⚠️ Error in processNoShowsAndReminders:', error.message);
    throw error;
  }
};

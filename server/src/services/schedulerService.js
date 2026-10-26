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

/**
 * Automated No-Show & Grace Period Processor:
 * Delegates to authoritative noShowSweepJob (turn-called grace expiry, silent no-shows,
 * wait-time recalculations) and triggers follow-up/medicine notification scheduler.
 *
 * Idempotent: safe to run repeatedly.
 */
export const processNoShowsAndReminders = async () => {
  try {
    const sweepResult = await noShowSweepJob();
    const notifResult = await runNotificationScheduler();

    return {
      success: true,
      processedNoShows: sweepResult.noShowCount || 0,
      sweep: sweepResult,
      ...notifResult
    };
  } catch (error) {
    console.error('⚠️ Error in processNoShowsAndReminders:', error.message);
    throw error;
  }
};

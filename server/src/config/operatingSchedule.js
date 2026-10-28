/**
 * Hospital Operating Schedule Configuration
 *
 * Implements strict environment segregation:
 * - Production: 9:00 AM – 5:00 PM Asia/Kolkata (UNTOUCHED AND IMMUTABLE)
 * - Local Emulator: 9:00 PM – 5:00 AM Asia/Kolkata (Overnight testing shift)
 *
 * SAFETY GUARD:
 * Fails safely to Production (9:00 AM – 5:00 PM) if the environment is in any way ambiguous.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import clock from '../utils/clock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const HOSPITAL_TIMEZONE = 'Asia/Kolkata';

export const PRODUCTION_SCHEDULE = {
  mode: 'production',
  timezone: HOSPITAL_TIMEZONE,
  startHourStr: '09:00',
  endHourStr: '17:00',
  displayHours: '9:00 AM – 5:00 PM',
  isOvernight: false,
  workingDays: [1, 2, 3, 4, 5],
  slotMinutes: 15,
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

export const EMULATOR_OVERNIGHT_SCHEDULE = {
  mode: 'emulator_overnight',
  timezone: HOSPITAL_TIMEZONE,
  startHourStr: '21:00',
  endHourStr: '05:00',
  displayHours: '9:00 PM – 5:00 AM',
  isOvernight: true,
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  slotMinutes: 15,
  bufferEverySlots: 6,
  weekly: [
    { dayOfWeek: 0, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 1, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 2, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 3, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 4, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 5, sessions: [{ start: '21:00', end: '05:00' }] },
    { dayOfWeek: 6, sessions: [{ start: '21:00', end: '05:00' }] }
  ],
  lunch: null
};

/**
 * Checks if a given time is within a schedule's operating hours.
 */
export function isScheduleOpenAt(schedule, timeStr) {
  if (!timeStr) return false;
  const clean = timeStr.trim().slice(0, 5);
  if (schedule.isOvernight) {
    return clean >= schedule.startHourStr || clean < schedule.endHourStr;
  }
  return clean >= schedule.startHourStr && clean < schedule.endHourStr;
}

/**
 * Strips any non-serializable fields before Firestore persistence.
 */
export function toFirestoreSchedule(schedule) {
  if (!schedule) return null;
  const { mode, timezone, startHourStr, endHourStr, displayHours, isOvernight, workingDays, slotMinutes, bufferEverySlots, weekly, lunch } = schedule;
  return { mode, timezone, startHourStr, endHourStr, displayHours, isOvernight, workingDays, slotMinutes, bufferEverySlots, weekly, lunch: lunch || null };
}

/**
 * Positive verification of local emulator mode.
 * Must have FIRESTORE_EMULATOR_HOST AND must be demo-project or LOCAL_DEMO/DEMO_MODE=true.
 * If ambiguous or undefined, ALWAYS return false (production safe fallback).
 */
export function isVerifiedEmulatorMode() {
  try {
    const hasEmulatorHost = !!process.env.FIRESTORE_EMULATOR_HOST;
    const isExplicitDemo =
      process.env.LOCAL_DEMO === 'true' ||
      process.env.DEMO_MODE === 'true' ||
      process.env.GCLOUD_PROJECT === 'demo-project' ||
      process.env.VITE_FIREBASE_PROJECT_ID === 'demo-project';

    // Guard 1: Must satisfy both conditions
    if (!hasEmulatorHost || !isExplicitDemo) {
      return false;
    }

    // Guard 2: Explicitly block any production project identifiers
    if (
      process.env.GCLOUD_PROJECT === 'ai-basedsmarthealthcaresystem' ||
      process.env.VITE_FIREBASE_PROJECT_ID === 'ai-basedsmarthealthcaresystem'
    ) {
      return false;
    }

    return true;
  } catch (_) {
    return false; // Fail safely
  }
}

/**
 * Returns the active schedule configuration based on verified environment.
 */
export function getOperatingSchedule() {
  if (isVerifiedEmulatorMode()) {
    return EMULATOR_OVERNIGHT_SCHEDULE;
  }
  return PRODUCTION_SCHEDULE;
}

/**
 * Determines whether the hospital is currently open at a given time or timestamp.
 * Defaults to current time in Asia/Kolkata via clock.now().
 *
 * @param {Date|string|number} [timeOrDate] - Optional Date, epoch ms, or "HH:mm" string
 * @param {boolean} [forceEmulator] - Optional override for unit testing
 * @returns {boolean}
 */
export function isHospitalOpen(timeOrDate, forceEmulator = null) {
  const isEmu = forceEmulator !== null ? forceEmulator : isVerifiedEmulatorMode();
  const schedule = isEmu ? EMULATOR_OVERNIGHT_SCHEDULE : PRODUCTION_SCHEDULE;

  let timeHHmm;
  if (typeof timeOrDate === 'string' && /^\d{1,2}:\d{2}/.test(timeOrDate)) {
    timeHHmm = timeOrDate.trim().slice(0, 5);
    if (timeHHmm.length === 4) timeHHmm = '0' + timeHHmm;
  } else {
    const dateObj = timeOrDate ? (timeOrDate instanceof Date ? timeOrDate : new Date(timeOrDate)) : clock.now();
    timeHHmm = dayjs(dateObj).tz(HOSPITAL_TIMEZONE).format('HH:mm');
  }

  return isScheduleOpenAt(schedule, timeHHmm);
}

/**
 * Returns public metadata for client synchronization
 */
export function getScheduleMetadata() {
  const isEmu = isVerifiedEmulatorMode();
  const schedule = isEmu ? EMULATOR_OVERNIGHT_SCHEDULE : PRODUCTION_SCHEDULE;
  return {
    mode: schedule.mode,
    isEmulator: isEmu,
    timezone: HOSPITAL_TIMEZONE,
    startHourStr: schedule.startHourStr,
    endHourStr: schedule.endHourStr,
    displayHours: schedule.displayHours,
    isOvernight: schedule.isOvernight,
    workingDays: schedule.workingDays,
    slotMinutes: schedule.slotMinutes
  };
}

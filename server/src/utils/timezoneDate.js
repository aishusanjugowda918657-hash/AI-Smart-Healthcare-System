import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import clock from './clock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const HOSPITAL_TZ = 'Asia/Kolkata';

/**
 * Returns YYYY-MM-DD for the hospital timezone (Asia/Kolkata)
 */
export function getHospitalTodayStr(dateObj = clock.now()) {
  return dayjs(dateObj).tz(HOSPITAL_TZ).format('YYYY-MM-DD');
}

/**
 * Returns HH:mm for the hospital timezone (Asia/Kolkata)
 */
export function getHospitalTimeStr(dateObj = clock.now()) {
  return dayjs(dateObj).tz(HOSPITAL_TZ).format('HH:mm');
}

/**
 * Parse date string (YYYY-MM-DD) and time string ("09:00", "09:00 AM", "14:30")
 * into a Date object anchored in Asia/Kolkata.
 */
export function parseSlotTimeToDate(dateStr, timeSlotStr) {
  if (!dateStr || !timeSlotStr) return null;

  try {
    const trimmed = String(timeSlotStr).trim();
    const isPM = /pm/i.test(trimmed);
    const isAM = /am/i.test(trimmed);
    const cleanStr = trimmed.replace(/(am|pm)/i, '').trim();
    const parts = cleanStr.split(':').map(Number);

    let hours = parts[0];
    let minutes = parts[1] !== undefined ? parts[1] : 0;

    if (isNaN(hours)) return null;
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const parsed = dayjs.tz(`${dateStr} ${formattedTime}`, HOSPITAL_TZ);
    return parsed.isValid() ? parsed.toDate() : null;
  } catch {
    return null;
  }
}

/**
 * Checks if a slot start time has already passed in Asia/Kolkata.
 */
export function isSlotInPast(dateStr, timeSlotStr, dateObj = clock.now()) {
  const todayIST = getHospitalTodayStr(dateObj);
  if (!dateStr || dateStr < todayIST) return true;
  if (dateStr > todayIST) return false;

  const apptDate = parseSlotTimeToDate(dateStr, timeSlotStr);
  if (!apptDate) return false;
  return apptDate.getTime() <= dateObj.getTime();
}

/**
 * Checks whether an appointment's grace period has expired in Asia/Kolkata.
 */
export function isGracePeriodExpired(dateStr, timeSlotStr, graceMinutes = 5, dateObj = clock.now()) {
  const todayIST = getHospitalTodayStr(dateObj);
  if (!dateStr || dateStr < todayIST) return true;
  if (dateStr > todayIST) return false;

  const apptDate = parseSlotTimeToDate(dateStr, timeSlotStr);
  if (!apptDate) return false;
  const graceEndMs = apptDate.getTime() + (graceMinutes * 60 * 1000);
  return dateObj.getTime() >= graceEndMs;
}

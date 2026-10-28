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
 * Returns formatted 12-hour time ("hh:mm A") in Asia/Kolkata timezone
 */
export function formatHospitalTime(dateObj = clock.now()) {
  if (!dateObj) return null;
  return dayjs(dateObj).tz(HOSPITAL_TZ).format('hh:mm A');
}

/**
 * Normalizes raw slot time string ("09:00", "09:00:00", "09:00 am") into "09:00 AM"
 */
export function formatSlotTimeDisplay(rawSlot) {
  if (!rawSlot) return '';
  const trimmed = String(rawSlot).trim();
  const clean = trimmed.replace(/(am|pm)/i, '').trim();
  const [hStr, mStr] = clean.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return trimmed;
  const isPM = /pm/i.test(trimmed) || (!/am/i.test(trimmed) && h >= 12);
  const displayH = h % 12 || 12;
  const ampm = isPM ? 'PM' : 'AM';
  return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
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

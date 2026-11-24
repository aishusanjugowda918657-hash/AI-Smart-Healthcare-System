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
    let normalizedDate = String(dateStr).trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(normalizedDate)) {
      const [d, m, y] = normalizedDate.split('-');
      normalizedDate = `${y}-${m}-${d}`;
    }

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
    const parsed = dayjs.tz(`${normalizedDate} ${formattedTime}`, HOSPITAL_TZ);
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
 * Parse any natural language time string into a canonical 24-hour HH:mm string.
 * Accurately distinguishes AM and PM, preventing 10:30 PM from turning into 10:30.
 * Examples:
 *   "10:30 PM" -> { time24: '22:30', isPM: true, isExplicitAmpm: true }
 *   "10:30 AM" -> { time24: '10:30', isPM: false, isExplicitAmpm: true }
 *   "10:30"    -> { time24: '10:30', isPM: false, isExplicitAmpm: false }
 */
export function normalizeTo24HourTime(timeInput) {
  if (!timeInput || typeof timeInput !== 'string') return null;
  const raw = timeInput.trim().toLowerCase();
  const isNight = raw.includes('night') || raw.includes('evening') || raw.includes('pm') || raw.includes('p.m') || raw.includes('afternoon');
  const isMorning = raw.includes('morning') || raw.includes('am') || raw.includes('a.m');
  const clean = raw.replace(/(night|evening|afternoon|morning|o'clock|clock|am|pm|a\.m\.|p\.m\.|at|in\s+the)/g, '').trim();

  let hours = 0;
  let minutes = 0;
  if (clean.includes(':') || clean.includes('.')) {
    const parts = clean.split(/[:.]/).map(p => parseInt(p, 10));
    hours = parts[0] || 0;
    minutes = parts[1] || 0;
  } else {
    hours = parseInt(clean, 10) || 0;
    minutes = 0;
  }

  if (isNaN(hours) || hours < 0 || hours > 24 || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
  if (isNight && hours < 12) {
    hours += 12;
  } else if (isMorning && hours === 12) {
    hours = 0;
  }

  const time24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const display12 = formatSlotTimeDisplay(time24);
  return { time24, display12, hours, minutes, isPM: hours >= 12, isExplicitAmpm: isNight || isMorning };
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

/**
 * Time and Date Formatting Utilities
 * Uses dayjs configured for the hospital timezone (HOSPITAL_TZ)
 * Defined as per PRD Section 3.3
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import clock from './clock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = process.env.HOSPITAL_TZ || 'Asia/Kolkata';

export const getHospitalTz = () => process.env.HOSPITAL_TZ || DEFAULT_TZ;

export const nowInHospitalTz = () => {
  return dayjs(clock.now()).tz(getHospitalTz());
};

export const formatDateYYYYMMDD = (dateInput = clock.now()) => {
  return dayjs(dateInput).tz(getHospitalTz()).format('YYYY-MM-DD');
};

export const minutesBetween = (startInput, endInput = clock.now()) => {
  const start = dayjs(startInput);
  const end = dayjs(endInput);
  return Math.max(0, Math.floor(end.diff(start, 'minute', true)));
};

export const parseTimeToMinutes = (tStr) => {
  if (!tStr) return 0;
  const clean = String(tStr).trim();
  const isPM = /pm/i.test(clean);
  const isAM = /am/i.test(clean);
  const parts = clean.replace(/am|pm/i, '').trim().split(':');
  let h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + m;
};

export const isTimeOverlapping = (t1, t2, dur1 = 15, dur2 = 15) => {
  if (!t1 || !t2) return false;
  const start1 = parseTimeToMinutes(t1);
  const end1 = start1 + (Number(dur1) || 15);
  const start2 = parseTimeToMinutes(t2);
  const end2 = start2 + (Number(dur2) || 15);
  return Math.max(start1, start2) < Math.min(end1, end2);
};

export { dayjs };

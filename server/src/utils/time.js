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

export { dayjs };

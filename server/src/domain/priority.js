import { ClinicalLevel } from './constants.js';
import { parseSlotTimeToDate } from '../utils/timezoneDate.js';

export function parseTimeToMs(raw, dateStr) {
  if (!raw) return 0;
  if (typeof raw === 'object' && raw.toMillis) return raw.toMillis();
  if (typeof raw === 'object' && raw instanceof Date) return raw.getTime();
  const s = String(raw).trim();
  if (s.includes('T') || (s.includes('-') && s.length >= 10)) {
    const ms = new Date(s).getTime();
    if (!isNaN(ms)) return ms;
  }
  const match = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    if (dateStr) {
      const d = parseSlotTimeToDate(dateStr, s);
      if (d) return d.getTime();
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }
  const ms = new Date(s).getTime();
  return isNaN(ms) ? 0 : ms;
}

/**
 * Calculates minutes between a ISO timestamp/date and now
 */
function minutesBetween(bookedStartAt, now, dateStr) {
  const bookedTime = parseTimeToMs(bookedStartAt, dateStr);
  const nowTime = parseTimeToMs(now);

  if (!bookedTime || !nowTime || isNaN(bookedTime) || isNaN(nowTime)) return 0;
  return Math.floor((nowTime - bookedTime) / (60 * 1000));
}

/**
 * Checks whether two appointments are in the same slot window (e.g. same booked start time)
 */
function sameSlotWindow(a, b) {
  const timeA = parseTimeToMs(a.bookedStartAt || a.timeSlot, a.date);
  const timeB = parseTimeToMs(b.bookedStartAt || b.timeSlot, b.date);

  return timeA === timeB;
}

/**
 * Computes effective clinical level considering fairness bump
 * PRD Section 5.1: If level === 1 (routine) and delayed by >= fairnessBumpMin (30 min), bump to level 2
 */
export function effectiveLevel(appointment, now, cfg = { fairnessBumpMin: 30 }) {
  let level = appointment.clinicalLevel || ClinicalLevel.ROUTINE;
  if (level === 1) {
    const refTime = appointment.orderOverrideAt || appointment.rejoinedAt || appointment.bookedStartAt;
    const lateMin = minutesBetween(refTime, now, appointment.date);
    if (lateMin >= (cfg.fairnessBumpMin || 30)) {
      level = ClinicalLevel.URGENT; // 2
    }
  }
  return level;
}

/**
 * Comparator for calling order as defined in PRD Section 5.1
 * Returns negative if a should be called before b, positive if b before a
 */
export function compareForCalling(a, b, now, cfg = { fairnessBumpMin: 30 }) {
  const la = effectiveLevel(a, now, cfg);
  const lb = effectiveLevel(b, now, cfg);

  // 1. Higher effective level first (Emergency Level 3 always first)
  if (la !== lb) {
    return lb - la;
  }

  // 2. Vulnerability tag tie-breaker ONLY inside same slot window and same effective level
  const va = (a.tags && a.tags.length > 0) ? 1 : 0;
  const vb = (b.tags && b.tags.length > 0) ? 1 : 0;
  if (sameSlotWindow(a, b) && va !== vb) {
    return vb - va;
  }

  // 3. Effective Queue Time ASC (respects orderOverrideAt for rejoined/rescheduled patients)
  const getQueueTime = (apt) => {
    if (apt.orderOverrideAt) {
      return parseTimeToMs(apt.orderOverrideAt, apt.date);
    }
    return parseTimeToMs(apt.bookedStartAt || apt.timeSlot, apt.date);
  };

  const timeA = getQueueTime(a);
  const timeB = getQueueTime(b);

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // 4. Checked-in time ASC
  const checkA = parseTimeToMs(a.checkedInAt, a.date);
  const checkB = parseTimeToMs(b.checkedInAt, b.date);

  return checkA - checkB;
}

/**
 * Filters and sorts ready candidates for calling (checked_in, waiting, and rejoined)
 */
export function getReadyCandidates(appointments, now, cfg = { fairnessBumpMin: 30 }) {
  const readyStatuses = ['checked_in', 'waiting', 'rejoined'];
  const candidates = appointments.filter((apt) => readyStatuses.includes((apt.status || '').toLowerCase()));
  return candidates.sort((a, b) => compareForCalling(a, b, now, cfg));
}

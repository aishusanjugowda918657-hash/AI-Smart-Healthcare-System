import { ClinicalLevel } from './constants.js';

/**
 * Calculates minutes between a ISO timestamp/date and now
 */
function minutesBetween(bookedStartAt, now) {
  const bookedTime = typeof bookedStartAt === 'string'
    ? new Date(bookedStartAt).getTime()
    : (bookedStartAt?.toMillis ? bookedStartAt.toMillis() : new Date(bookedStartAt).getTime());
  const nowTime = typeof now === 'string'
    ? new Date(now).getTime()
    : (now?.toMillis ? now.toMillis() : new Date(now).getTime());

  if (isNaN(bookedTime) || isNaN(nowTime)) return 0;
  return Math.floor((nowTime - bookedTime) / (60 * 1000));
}

/**
 * Checks whether two appointments are in the same slot window (e.g. same booked start time)
 */
function sameSlotWindow(a, b) {
  const timeA = typeof a.bookedStartAt === 'string'
    ? new Date(a.bookedStartAt).getTime()
    : (a.bookedStartAt?.toMillis ? a.bookedStartAt.toMillis() : new Date(a.bookedStartAt || 0).getTime());
  const timeB = typeof b.bookedStartAt === 'string'
    ? new Date(b.bookedStartAt).getTime()
    : (b.bookedStartAt?.toMillis ? b.bookedStartAt.toMillis() : new Date(b.bookedStartAt || 0).getTime());

  return timeA === timeB;
}

/**
 * Computes effective clinical level considering fairness bump
 * PRD Section 5.1: If level === 1 (routine) and delayed by >= fairnessBumpMin (30 min), bump to level 2
 */
export function effectiveLevel(appointment, now, cfg = { fairnessBumpMin: 30 }) {
  let level = appointment.clinicalLevel || ClinicalLevel.ROUTINE;
  if (level === 1) {
    const lateMin = minutesBetween(appointment.bookedStartAt, now);
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

  // 1. Higher effective level first
  if (la !== lb) {
    return lb - la;
  }

  // 2. Vulnerability tag tie-breaker ONLY inside same slot window and same effective level
  const va = (a.tags && a.tags.length > 0) ? 1 : 0;
  const vb = (b.tags && b.tags.length > 0) ? 1 : 0;
  if (sameSlotWindow(a, b) && va !== vb) {
    return vb - va;
  }

  // 3. Booked start time ASC
  const timeA = typeof a.bookedStartAt === 'string'
    ? new Date(a.bookedStartAt).getTime()
    : (a.bookedStartAt?.toMillis ? a.bookedStartAt.toMillis() : new Date(a.bookedStartAt || 0).getTime());
  const timeB = typeof b.bookedStartAt === 'string'
    ? new Date(b.bookedStartAt).getTime()
    : (b.bookedStartAt?.toMillis ? b.bookedStartAt.toMillis() : new Date(b.bookedStartAt || 0).getTime());

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // 4. Checked-in time ASC
  const checkA = typeof a.checkedInAt === 'string'
    ? new Date(a.checkedInAt).getTime()
    : (a.checkedInAt?.toMillis ? a.checkedInAt.toMillis() : new Date(a.checkedInAt || 0).getTime());
  const checkB = typeof b.checkedInAt === 'string'
    ? new Date(b.checkedInAt).getTime()
    : (b.checkedInAt?.toMillis ? b.checkedInAt.toMillis() : new Date(b.checkedInAt || 0).getTime());

  return checkA - checkB;
}

/**
 * Filters and sorts ready candidates for calling (checked_in and rejoined ONLY)
 */
export function getReadyCandidates(appointments, now, cfg = { fairnessBumpMin: 30 }) {
  const readyStatuses = ['checked_in', 'rejoined'];
  const candidates = appointments.filter((apt) => readyStatuses.includes(apt.status));
  return candidates.sort((a, b) => compareForCalling(a, b, now, cfg));
}

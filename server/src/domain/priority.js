import { ClinicalLevel } from './constants.js';
import { parseSlotTimeToDate } from '../utils/timezoneDate.js';

/**
 * Parses diverse time representations (ISO, HH:mm, Firestore Timestamp, Date)
 * into millisecond epoch for deterministic chronological calculations.
 */
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
 * Helper to extract numeric sequence from token or appointment ID
 */
function extractSequenceNum(val) {
  if (typeof val === 'number') return val;
  const match = String(val || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 999999;
}

/**
 * Checks whether two appointments are in the same slot window (e.g. same booked start time)
 */
function sameSlotWindow(a, b) {
  const timeA = parseTimeToMs(a.bookedStartAt || a.timeSlot, a.date);
  const timeB = parseTimeToMs(b.bookedStartAt || b.timeSlot, b.date);
  return timeA !== 0 && timeA === timeB;
}

/**
 * Determines whether an appointment is a verified Emergency (Level 3).
 * Must be verified by clinician/staff or have Level 3 / EMERGENCY assigned.
 */
export function isEmergencyPatient(apt) {
  if (!apt) return false;
  if (apt.clinicalLevel === 3 || apt.clinicalLevel === ClinicalLevel.EMERGENCY) return true;
  if (apt.isEmergency === true) return true;
  const cat = String(apt.priorityCategory || apt.priority || '').trim().toUpperCase();
  return cat === 'EMERGENCY' || cat === '3';
}

/**
 * Determines whether an appointment is a Priority patient (Level 2).
 */
export function isPriorityPatient(apt) {
  if (!apt) return false;
  if (isEmergencyPatient(apt)) return false;
  if (apt.clinicalLevel === 2 || apt.clinicalLevel === ClinicalLevel.URGENT) return true;
  const cat = String(apt.priorityCategory || apt.priority || apt.urgencySuggested || '').trim().toUpperCase();
  return cat === 'HIGH' || cat === 'URGENT' || cat === 'SENIOR' || cat === '2';
}

/**
 * Determines whether an appointment is a Normal patient (Level 1).
 */
export function isNormalPatient(apt) {
  return !isEmergencyPatient(apt) && !isPriorityPatient(apt);
}

/**
 * Calculates minutes delay of a patient beyond their booked slot or check-in time.
 */
export function getPatientDelayMinutes(apt, now) {
  if (!apt) return 0;
  const nowMs = parseTimeToMs(now);
  if (!nowMs) return 0;

  let refTime;
  if (apt.status === 'rejoined' || apt.rejoinedAt) {
    refTime = apt.rejoinedAt || apt.orderOverrideAt;
  } else {
    refTime = apt.orderOverrideAt || apt.bookedStartAt || apt.timeSlot || apt.checkedInAt;
  }

  const bookedTimeMs = parseTimeToMs(refTime, apt.date);
  if (!bookedTimeMs || isNaN(bookedTimeMs)) return 0;

  return Math.max(0, Math.floor((nowMs - bookedTimeMs) / (60 * 1000)));
}

/**
 * Rule 3: Normal Patient Fairness Protection
 * A Normal patient delayed >= 30 minutes beyond booked appointment time
 * receives fairness protection:
 * - Keeps existing queue position.
 * - Cannot be pushed backwards by subsequent Priority arrivals.
 * - Does not jump patients already positioned before them.
 */
export function isFairnessProtected(apt, now, cfg = { fairnessThresholdMin: 30 }) {
  if (!apt) return false;
  if (isEmergencyPatient(apt) || isPriorityPatient(apt)) {
    return false; // Emergencies and Priority have higher clinical pathways
  }

  if (apt.fairnessProtected === true || apt.fairnessBumpApplied === true) {
    return true;
  }

  const threshold = cfg.fairnessThresholdMin || cfg.fairnessBumpMin || 30;
  const delayMin = getPatientDelayMinutes(apt, now);
  return delayMin >= threshold;
}

/**
 * Generates an explainable AI fairness diagnostic for a patient.
 */
export function explainPatientFairness(apt, now, cfg = { fairnessThresholdMin: 30 }) {
  const threshold = cfg.fairnessThresholdMin || cfg.fairnessBumpMin || 30;
  const delayMin = getPatientDelayMinutes(apt, now);
  const protectedStatus = isFairnessProtected(apt, now, cfg);

  if (isEmergencyPatient(apt)) {
    return {
      category: 'EMERGENCY',
      level: 3,
      isFairnessProtected: false,
      delayMinutes: delayMin,
      explanation: 'Verified emergency status prioritized at queue head by clinical protocol.'
    };
  }

  if (isPriorityPatient(apt)) {
    return {
      category: 'PRIORITY',
      level: 2,
      isFairnessProtected: false,
      delayMinutes: delayMin,
      explanation: 'Clinical priority (Level 2 / Urgent). Positioned ahead of un-protected Normal patients.'
    };
  }

  if (protectedStatus) {
    return {
      category: 'NORMAL_PROTECTED',
      level: 1,
      isFairnessProtected: true,
      delayMinutes: delayMin,
      thresholdMinutes: threshold,
      explanation: `Patient delayed ${delayMin} min (≥ ${threshold} min threshold). Fairness protection active: queue position is locked against later priority arrivals to prevent starvation.`
    };
  }

  const remainingToThreshold = Math.max(0, threshold - delayMin);
  return {
    category: 'NORMAL',
    level: 1,
    isFairnessProtected: false,
    delayMinutes: delayMin,
    thresholdMinutes: threshold,
    explanation: `Normal routine turn. ${remainingToThreshold} minutes remaining until fairness protection threshold.`
  };
}

/**
 * Gets effective queue entry timestamp for preserving FIFO among peers.
 */
export function getQueueEntryTimeMs(apt) {
  if (!apt) return 0;
  if (apt.orderOverrideAt) {
    return parseTimeToMs(apt.orderOverrideAt, apt.date);
  }
  if (apt.checkedInAt) {
    return parseTimeToMs(apt.checkedInAt, apt.date);
  }
  if (apt.bookedStartAt || apt.timeSlot) {
    return parseTimeToMs(apt.bookedStartAt || apt.timeSlot, apt.date);
  }
  return 0;
}

/**
 * Secondary tie-breaker for identical arrival times.
 */
function tieBreaker(a, b) {
  // Vulnerability tag tie-breaker ONLY inside same slot window
  const va = (a.tags && a.tags.length > 0) ? 1 : 0;
  const vb = (b.tags && b.tags.length > 0) ? 1 : 0;
  if (sameSlotWindow(a, b) && va !== vb) {
    return vb - va;
  }

  // Token sequence number ASC
  const seqA = a.sequenceNumber !== undefined ? a.sequenceNumber : extractSequenceNum(a.tokenNumber || a.tokenLabel || a.id);
  const seqB = b.sequenceNumber !== undefined ? b.sequenceNumber : extractSequenceNum(b.tokenNumber || b.tokenLabel || b.id);
  if (seqA !== seqB) {
    return seqA - seqB;
  }

  // Deterministic ID string comparison
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * Effective clinical level (backward-compatible).
 */
export function effectiveLevel(appointment, now, cfg = { fairnessBumpMin: 30 }) {
  if (isEmergencyPatient(appointment)) return ClinicalLevel.EMERGENCY; // 3
  if (isPriorityPatient(appointment)) return ClinicalLevel.URGENT; // 2
  return ClinicalLevel.ROUTINE; // 1
}

/**
 * Pure rules engine comparator for ready candidates calling order:
 *
 * Rule 1: Emergency always comes first
 * - Verified Emergency (Level 3) placed at queue front.
 * - Multiple emergencies preserve relative arrival order.
 *
 * Rule 2: Preserve existing queue order
 * - Priority patients (P) preserve relative order.
 * - Normal patients (N) preserve relative order.
 *
 * Rule 3: Normal patient fairness
 * - When Normal patient reaches 30+ minutes overdue, they are fairness-protected.
 * - A later Priority arrival cannot bypass an already fairness-protected Normal patient.
 * - A fairness-protected Normal patient does not jump ahead of patients already positioned before them.
 *
 * Rule 4: Deterministic and testable rules engine (never an LLM random sort).
 */
export function compareForCalling(a, b, now, cfg = { fairnessThresholdMin: 30 }) {
  // 1. Emergency always comes first (Rule 1)
  const ea = isEmergencyPatient(a);
  const eb = isEmergencyPatient(b);

  if (ea && !eb) return -1;
  if (!ea && eb) return 1;
  if (ea && eb) {
    // Multiple emergencies preserve relative arrival / check-in order
    const diff = getQueueEntryTimeMs(a) - getQueueEntryTimeMs(b);
    if (diff !== 0) return diff;
    return tieBreaker(a, b);
  }

  // 2. Non-emergency candidates
  const pa = isPriorityPatient(a);
  const pb = isPriorityPatient(b);

  // Both are Priority -> preserve relative FIFO order (Rule 2)
  if (pa && pb) {
    const diff = getQueueEntryTimeMs(a) - getQueueEntryTimeMs(b);
    if (diff !== 0) return diff;
    return tieBreaker(a, b);
  }

  // Both are Normal -> preserve relative FIFO order (Rule 2)
  if (!pa && !pb) {
    const diff = getQueueEntryTimeMs(a) - getQueueEntryTimeMs(b);
    if (diff !== 0) return diff;
    return tieBreaker(a, b);
  }

  // 3. One is Priority (P) and one is Normal (N)
  const p = pa ? a : b;
  const n = pa ? b : a;

  const nProtected = isFairnessProtected(n, now, cfg);

  if (nProtected) {
    // Normal patient is fairness-protected (Rule 3):
    // - Protect from being pushed backwards by later Priority arrivals.
    // - Do not allow a newly arriving Priority patient to jump ahead of protected Normal.
    // - Do not move protected Normal ahead of patients already positioned before them.
    // Relative entry/queue order is preserved!
    const diff = getQueueEntryTimeMs(a) - getQueueEntryTimeMs(b);
    if (diff !== 0) return diff;
    return tieBreaker(a, b);
  } else {
    // Unprotected Normal (< 30 min):
    // Priority patient jumps ahead of unprotected Normal patient
    return pa ? -1 : 1;
  }
}

/**
 * Rule 4: Filters and sorts ready candidates for calling (checked_in, waiting, and rejoined).
 * Excludes cancelled, completed, no-show, not_arrived, and currently held appointments.
 */
export function getReadyCandidates(appointments, now, cfg = { fairnessThresholdMin: 30 }) {
  if (!Array.isArray(appointments)) return [];

  const readyStatuses = ['checked_in', 'waiting', 'rejoined'];
  const candidates = appointments.filter((apt) => {
    if (!apt) return false;
    const status = String(apt.status || '').toLowerCase();
    return readyStatuses.includes(status) && !apt.isHeldByDoctor;
  });

  // Deterministically sort using rules engine
  candidates.sort((a, b) => compareForCalling(a, b, now, cfg));

  // Enrich with fairness metadata
  return candidates.map((cand, idx) => {
    const fairness = explainPatientFairness(cand, now, cfg);
    return {
      ...cand,
      queuePosition: idx + 1,
      fairnessProtected: fairness.isFairnessProtected,
      fairnessDelayMin: fairness.delayMinutes,
      fairnessReason: fairness.explanation
    };
  });
}

/**
 * domain/status.js
 * Domain model and state transition rules for Appointment & Queue Lifecycle (PRD F5)
 */

export const AppointmentStatuses = Object.freeze({
  BOOKED: 'booked',
  CONFIRMED: 'confirmed',
  ON_THE_WAY: 'on_the_way',
  NEARBY: 'nearby',
  CHECKED_IN: 'checked_in',
  WAITING: 'waiting',
  CALLED: 'called',
  IN_ROOM: 'in_room',
  IN_CONSULTATION: 'in_consultation', // Alias for in_room
  COMPLETED: 'completed',
  NOT_ARRIVED: 'not_arrived',
  LATE: 'late',
  REJOINED: 'rejoined',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
  RESCHEDULED: 'rescheduled'
});

export const ALL_STATUSES = Object.values(AppointmentStatuses);

/**
 * Normalizes status string to lowercase
 * @param {string} status 
 * @returns {string}
 */
export function normalizeStatus(status) {
  if (!status || typeof status !== 'string') return '';
  const s = status.trim().toLowerCase();
  if (s === 'in_consultation') return 'in_room';
  return s;
}

/**
 * Allowed transitions map: [fromStatus] -> Array of allowed target statuses
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  booked: [
    'confirmed',
    'on_the_way',
    'nearby',
    'checked_in',
    'waiting',
    'cancelled',
    'rescheduled',
    'not_arrived',
    'no_show'
  ],
  confirmed: [
    'on_the_way',
    'nearby',
    'checked_in',
    'waiting',
    'cancelled',
    'rescheduled',
    'not_arrived',
    'no_show'
  ],
  on_the_way: [
    'nearby',
    'checked_in',
    'waiting',
    'cancelled',
    'not_arrived',
    'no_show'
  ],
  nearby: [
    'checked_in',
    'waiting',
    'cancelled',
    'not_arrived',
    'no_show'
  ],
  checked_in: [
    'waiting',
    'called',
    'cancelled',
    'late'
  ],
  waiting: [
    'called',
    'cancelled',
    'late'
  ],
  called: [
    'in_room',
    'in_consultation',
    'not_arrived',
    'late',
    'waiting',
    'no_show'
  ],
  in_room: [
    'completed'
  ],
  not_arrived: [
    'checked_in',
    'waiting',
    'late',
    'rejoined',
    'no_show',
    'cancelled'
  ],
  late: [
    'rejoined',
    'checked_in',
    'waiting',
    'no_show',
    'cancelled'
  ],
  rejoined: [
    'waiting',
    'called',
    'checked_in',
    'cancelled'
  ],
  cancelled: [
    'booked',
    'confirmed'
  ],
  no_show: [
    'booked',
    'confirmed',
    'rejoined',
    'waiting'
  ],
  rescheduled: [],
  completed: []
});

/**
 * Checks if a transition from `from` to `to` status is allowed
 * @param {string} from 
 * @param {string} to 
 * @returns {boolean}
 */
export function canTransition(from, to) {
  const normFrom = normalizeStatus(from);
  const normTo = normalizeStatus(to);

  if (!normFrom || !normTo) return false;
  if (normFrom === normTo) return true; // Idempotent transition to same status

  const allowed = ALLOWED_TRANSITIONS[normFrom] || [];
  return allowed.includes(normTo);
}

/**
 * Asserts that a status transition is valid, throwing an Error if invalid
 * @param {string} from 
 * @param {string} to 
 * @throws {Error} If transition is not allowed
 * @returns {boolean} True if valid
 */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const error = new Error(`Invalid status transition from '${from}' to '${to}'`);
    error.statusCode = 422;
    error.code = 'INVALID_TRANSITION';
    throw error;
  }
  return true;
}

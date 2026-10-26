import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { assertDbConnected } from '../config/firebase.js';
import clock from '../utils/clock.js';
import { HOSPITAL_TZ } from '../utils/timezoneDate.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Returns compact YYYYMMDD string for an appointment date in hospital timezone (Asia/Kolkata).
 * @param {string|Date} dateVal - "YYYY-MM-DD" or Date object
 * @returns {string} e.g. "20261026"
 */
export const getAppointmentDateCompact = (dateVal) => {
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal.trim())) {
    return dateVal.trim().replace(/-/g, '');
  }
  if (typeof dateVal === 'string' && /^\d{8}$/.test(dateVal.trim())) {
    return dateVal.trim();
  }
  const dateObj = dateVal instanceof Date ? dateVal : clock.now();
  return dayjs(dateObj).tz(HOSPITAL_TZ).format('YYYYMMDD');
};

/**
 * Formats human-readable Appointment Display ID: APT-YYYYMMDD-NNNNNN
 * Example: APT-20261026-000001
 * @param {string} dateCompact - 8-digit date string "YYYYMMDD"
 * @param {number} seq - Sequence number
 * @returns {string} e.g. "APT-20261026-000001"
 */
export const formatAppointmentDisplayId = (dateCompact, seq) => {
  const paddedSeq = String(seq).padStart(6, '0');
  return `APT-${dateCompact}-${paddedSeq}`;
};

/**
 * Validates appointment display ID format: APT-YYYYMMDD-NNNNNN
 * @param {string} id
 * @returns {boolean}
 */
export const isValidAppointmentDisplayId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^APT-\d{8}-\d{6}$/i.test(id.trim());
};

/**
 * Atomically generates a unique human-readable Appointment Display ID
 * Format: APT-YYYYMMDD-NNNNNN (e.g. APT-20261026-000001)
 * Uses Firestore transaction counter keyed per appointment date in hospital timezone.
 *
 * @param {string} dateVal - Appointment date string (YYYY-MM-DD or YYYYMMDD)
 * @param {FirebaseFirestore.Firestore} [customDb] - Optional Firestore instance
 * @returns {Promise<string>}
 */
export const generateAtomicAppointmentDisplayId = async (dateVal, customDb = null) => {
  const db = customDb || assertDbConnected();
  const dateCompact = getAppointmentDateCompact(dateVal);
  const counterRef = db.collection('counters').doc(`apptDisplay_${dateCompact}`);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    let nextVal = 1;
    if (snap.exists) {
      const data = snap.data();
      nextVal = (data.value || data.currentValue || 0) + 1;
    }

    tx.set(counterRef, {
      value: nextVal,
      currentValue: nextVal,
      dateCompact,
      updatedAt: new Date()
    }, { merge: true });

    return formatAppointmentDisplayId(dateCompact, nextVal);
  });
};

/**
 * Medicine Dose Schedule Generator (PRD F11 & Section 9)
 * Calculates exact scheduled reminder timestamps based on drug frequency,
 * meal time offsets (before/after food), course duration, and first-dose constraints.
 */

import crypto from 'crypto';
import env from '../config/env.js';

const DEFAULT_MEAL_TIMES = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '20:00'
};

const ACTION_SECRET = env.ACTION_TOKEN_SECRET || 'smartcare-action-secret-key-2026';

/**
 * Add/subtract minutes from HH:MM string
 */
function offsetTimeStr(timeStr, offsetMinutes) {
  if (!timeStr || typeof timeStr !== 'string') return '08:00';
  let [h, m] = timeStr.split(':').map((n) => parseInt(n, 10) || 0);

  // Handle 12-hour AM/PM format if present
  if (timeStr.toLowerCase().includes('pm') && h < 12) h += 12;
  if (timeStr.toLowerCase().includes('am') && h === 12) h = 0;

  const totalMin = h * 60 + m + offsetMinutes;
  const newH = Math.floor((totalMin + 1440) % 1440 / 60);
  const newM = (totalMin + 1440) % 60;

  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * Parse standard daily frequency string to doses-per-day count and default slot labels
 */
export function parseFrequencySlots(frequencyStr) {
  if (!frequencyStr || typeof frequencyStr !== 'string') {
    return { countPerDay: 2, slots: ['breakfast', 'dinner'] };
  }
  const str = frequencyStr.trim().toLowerCase();

  if (str.includes('1-0-1') || str.includes('twice')) {
    return { countPerDay: 2, slots: ['breakfast', 'dinner'] };
  }
  if (str.includes('1-1-1') || str.includes('three') || str.includes('thrice') || str.includes('tds')) {
    return { countPerDay: 3, slots: ['breakfast', 'lunch', 'dinner'] };
  }
  if (str.includes('0-0-1') || str.includes('night') || str.includes('bedtime')) {
    return { countPerDay: 1, slots: ['dinner'] };
  }
  if (str.includes('1-0-0') || str.includes('once') || str.includes('morning')) {
    return { countPerDay: 1, slots: ['breakfast'] };
  }

  // Count hyphens if custom pattern like 1-1-0-1
  if (/^\d(-\d)+$/.test(str)) {
    const parts = str.split('-').map((n) => parseInt(n, 10) || 0);
    const count = parts.reduce((a, b) => a + b, 0);
    const slots = [];
    if (parts[0] > 0) slots.push('breakfast');
    if (parts[1] > 0) slots.push('lunch');
    if (parts[2] > 0) slots.push('dinner');
    if (slots.length === 0) slots.push('breakfast');
    return { countPerDay: count || 1, slots };
  }

  return { countPerDay: 2, slots: ['breakfast', 'dinner'] };
}

/**
 * Generate full dose schedule array across prescription course duration
 * @param {Object} params
 * @param {string} params.medicineName
 * @param {string} params.dosage
 * @param {string} [params.frequency='1-0-1']
 * @param {Array} [params.reminderTimes=[]] - Optional explicit HH:MM strings
 * @param {string} [params.startDate] - YYYY-MM-DD
 * @param {number} [params.durationDays=5]
 * @param {string} [params.timing='after_food'] - 'after_food' (+30m), 'before_food' (-30m), 'with_food' (0m)
 * @param {Object} [params.mealTimes] - User defined { breakfast, lunch, dinner }
 * @param {Date} [params.referenceNow] - Mock date for unit tests
 * @returns {Array} List of scheduled dose reminder objects
 */
export function generateDoseSchedule({
  medicineName,
  dosage = '500 mg',
  frequency = '1-0-1',
  reminderTimes = [],
  startDate,
  durationDays = 5,
  timing = 'after_food',
  mealTimes = DEFAULT_MEAL_TIMES,
  referenceNow = new Date()
}) {
  const days = Math.max(1, Number(durationDays) || 5);
  const activeMealTimes = { ...DEFAULT_MEAL_TIMES, ...mealTimes };

  let offsetMinutes = 0;
  if (timing === 'after_food') offsetMinutes = 30;
  else if (timing === 'before_food') offsetMinutes = -30;

  // Determine daily time strings
  let dailyTimes = [];
  if (Array.isArray(reminderTimes) && reminderTimes.length > 0 && reminderTimes[0]) {
    dailyTimes = reminderTimes.map((t) => offsetTimeStr(t, 0));
  } else {
    const { slots } = parseFrequencySlots(frequency);
    dailyTimes = slots.map((s) => offsetTimeStr(activeMealTimes[s] || '08:00', offsetMinutes));
  }

  const start = startDate ? new Date(startDate) : new Date(referenceNow);
  const nowMs = referenceNow.getTime();
  const minFutureMs = nowMs + 5 * 60 * 1000; // First dose at least 5 minutes ahead if today

  const schedule = [];

  for (let dayIdx = 0; dayIdx < days; dayIdx++) {
    const currentDate = new Date(start);
    currentDate.setDate(currentDate.getDate() + dayIdx);
    const dateStr = currentDate.toISOString().split('T')[0];

    for (let timeIdx = 0; timeIdx < dailyTimes.length; timeIdx++) {
      const timeStr = dailyTimes[timeIdx];
      const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10) || 0);

      const scheduledDateObj = new Date(currentDate);
      scheduledDateObj.setHours(h, m, 0, 0);

      // Check first dose constraint for day 0
      let finalScheduledDate = scheduledDateObj;
      if (dayIdx === 0 && scheduledDateObj.getTime() < minFutureMs) {
        // If scheduled time has passed today, move first dose 5 minutes in future
        finalScheduledDate = new Date(minFutureMs);
      }

      const doseId = `dose-${Date.now().toString(36)}-${dayIdx + 1}-${timeIdx + 1}-${Math.floor(Math.random() * 1000)}`;

      schedule.push({
        doseId,
        medicineName,
        dosage,
        dateStr,
        timeStr: `${String(finalScheduledDate.getHours()).padStart(2, '0')}:${String(finalScheduledDate.getMinutes()).padStart(2, '0')}`,
        scheduledTime: finalScheduledDate.toISOString(),
        status: 'scheduled',
        dayNumber: dayIdx + 1,
        doseNumber: dayIdx * dailyTimes.length + timeIdx + 1
      });
    }
  }

  return schedule;
}

/**
 * Generate HMAC Action Token for quick action buttons (Taken / Snooze / Skip)
 */
export function generateActionToken(payload, secret = ACTION_SECRET) {
  const jsonStr = JSON.stringify(payload);
  const base64Str = Buffer.from(jsonStr).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(base64Str).digest('hex');
  return `${base64Str}.${hmac}`;
}

/**
 * Verify HMAC Action Token
 */
export function verifyActionToken(tokenStr, secret = ACTION_SECRET) {
  if (!tokenStr || typeof tokenStr !== 'string') return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;

  const [base64Str, signature] = parts;
  const expectedHmac = crypto.createHmac('sha256', secret).update(base64Str).digest('hex');

  if (signature !== expectedHmac) {
    return null; // Invalid signature
  }

  try {
    const jsonStr = Buffer.from(base64Str, 'base64url').toString('utf8');
    const payload = JSON.parse(jsonStr);

    // Check expiry
    if (payload.exp && Date.now() > payload.exp) {
      return { expired: true, payload };
    }

    return { valid: true, payload };
  } catch (err) {
    return null;
  }
}

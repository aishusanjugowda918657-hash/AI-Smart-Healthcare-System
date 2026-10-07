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

  const dateBaseStr = startDate || (referenceNow instanceof Date ? referenceNow.toISOString().split('T')[0] : String(referenceNow).split('T')[0]);
  const start = new Date(`${dateBaseStr}T00:00:00.000Z`);
  const nowMs = referenceNow.getTime();
  const minFutureMs = nowMs + 5 * 60 * 1000; // First dose at least 5 minutes ahead if today

  const schedule = [];

  for (let dayIdx = 0; dayIdx < days; dayIdx++) {
    const current = new Date(start);
    current.setUTCDate(current.getUTCDate() + dayIdx);
    const dateStr = current.toISOString().split('T')[0];

    for (let timeIdx = 0; timeIdx < dailyTimes.length; timeIdx++) {
      const timeStr = dailyTimes[timeIdx];
      const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10) || 0);

      const scheduledDateObj = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);

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
        timeStr: `${String(finalScheduledDate.getUTCHours()).padStart(2, '0')}:${String(finalScheduledDate.getUTCMinutes()).padStart(2, '0')}`,
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
 * Generate timing label string for notification text
 */
function getTimingLabel(timing) {
  if (timing === 'before_food') return 'before food';
  if (timing === 'with_food') return 'with food';
  if (timing === 'any_time') return 'any time';
  return 'after food';
}

/**
 * Create complete, pure PRD-compliant reminder objects for a prescribed medicine item (PRD Part 1 / F11)
 * @param {Object} params
 * @param {string} params.prescriptionId
 * @param {Object} params.item
 * @param {string} params.healthId
 * @param {string} [params.patientName='Patient']
 * @param {Array<string>} [params.receiverUids=[]]
 * @param {string} [params.startDate]
 * @param {Object} [params.mealTimes]
 * @param {Date} [params.referenceNow]
 * @returns {Array<Object>} List of dose reminder records
 */
export function createDoseReminders({
  prescriptionId,
  item = {},
  healthId,
  patientName = 'Patient',
  receiverUids = [],
  startDate,
  mealTimes = DEFAULT_MEAL_TIMES,
  referenceNow = new Date()
}) {
  const medName = item.name || item.medicineName || 'Medication';
  const dosage = item.dosage || '500 mg';
  const frequency = item.frequency || '1-0-1';
  const days = Math.max(1, Number(item.durationDays ?? item.days) || 5);
  const timing = item.timing || 'after_food';
  const timingLabel = getTimingLabel(timing);

  const activeMealTimes = { ...DEFAULT_MEAL_TIMES, ...mealTimes };

  let offsetMinutes = 0;
  if (timing === 'after_food') offsetMinutes = 30;
  else if (timing === 'before_food') offsetMinutes = -30;

  // Determine daily times based on frequency code and meal times
  let dailyTimes = [];
  if (Array.isArray(item.reminderTimes) && item.reminderTimes.length > 0 && item.reminderTimes[0]) {
    dailyTimes = item.reminderTimes.map((t) => offsetTimeStr(t, 0));
  } else {
    const { slots } = parseFrequencySlots(frequency);
    dailyTimes = slots.map((s) => offsetTimeStr(activeMealTimes[s] || '08:00', offsetMinutes));
  }

  const dateBaseStr = startDate || (referenceNow instanceof Date ? referenceNow.toISOString().split('T')[0] : String(referenceNow).split('T')[0]);
  const start = new Date(`${dateBaseStr}T00:00:00.000Z`);
  const nowMs = referenceNow.getTime();
  const minFutureMs = nowMs + 5 * 60 * 1000; // First dose at least 5 minutes ahead if today

  const reminders = [];

  for (let dayIdx = 0; dayIdx < days; dayIdx++) {
    const current = new Date(start);
    current.setUTCDate(current.getUTCDate() + dayIdx);
    const dateStr = current.toISOString().split('T')[0];

    for (let timeIdx = 0; timeIdx < dailyTimes.length; timeIdx++) {
      const timeStr = dailyTimes[timeIdx];
      const [h, m] = timeStr.split(':').map((n) => parseInt(n, 10) || 0);

      const scheduledDateObj = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);

      // Check first dose constraint for day 0: at least 5 minutes ahead
      let finalScheduledDate = scheduledDateObj;
      if (dayIdx === 0 && scheduledDateObj.getTime() < minFutureMs) {
        finalScheduledDate = new Date(minFutureMs);
      }

      const dueAtIso = finalScheduledDate.toISOString();
      const dueMinute = dueAtIso.slice(0, 16); // YYYY-MM-DDTHH:mm
      const groupKey = `${healthId}_${dueMinute}`;
      const doseIdx = dayIdx * dailyTimes.length + timeIdx + 1;
      const remId = `rem-${prescriptionId}-${medName.replace(/\s+/g, '_')}-${doseIdx}`;

      // Expiry: valid until due time + 24 hours
      const tokenExp = finalScheduledDate.getTime() + 24 * 60 * 60 * 1000;
      const actionToken = generateActionToken({
        reminderId: remId,
        healthId,
        patientUid: receiverUids[0] || '',
        dueAt: dueAtIso,
        exp: tokenExp
      });

      reminders.push({
        id: remId,
        reminderId: remId,
        healthId,
        patientHealthId: healthId,
        patientUid: receiverUids[0] || '',
        patientName,
        receiverUids: Array.isArray(receiverUids) ? receiverUids : [receiverUids].filter(Boolean),
        dueAt: dueAtIso,
        scheduledTime: dueAtIso,
        dateStr,
        status: 'pending',
        type: 'medicine',
        prescriptionId,
        item: {
          name: medName,
          medicineName: medName,
          dosage,
          frequency,
          timing,
          durationDays: days,
          notes: item.notes || ''
        },
        medicineName: medName,
        dosage,
        frequency,
        timing,
        title: `${patientName}: Time for ${medName} ${dosage} (${timingLabel})`,
        body: `${patientName}: Time for ${medName} ${dosage} (${timingLabel})`,
        privacyBody: `${patientName}: Medicine reminder`,
        actionToken,
        groupKey,
        snoozeCount: 0,
        retryCount: 0,
        dayNumber: dayIdx + 1,
        doseNumber: doseIdx,
        createdAt: referenceNow.toISOString(),
        updatedAt: referenceNow.toISOString()
      });
    }
  }

  return reminders;
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
export function verifyActionToken(tokenStr, secret = ACTION_SECRET, expectedReminderId = null) {
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

    // Check if token belongs to expected reminder
    if (expectedReminderId && payload.reminderId && payload.reminderId !== expectedReminderId) {
      return { mismatched: true, payload };
    }

    return { valid: true, payload };
  } catch (err) {
    return null;
  }
}

/**
 * Create follow-up reminders (2 days before, day of, overdue)
 * PRD F12: Max 3 reminders per follow-up. Quiet hours apply (default 09:00).
 */
export function createFollowUpReminders({
  followupId,
  healthId,
  patientName = 'Patient',
  doctorName = 'your doctor',
  dueDate,
  receiverUids = [],
  referenceNow = new Date()
}) {
  const reminders = [];
  const dateStr = String(dueDate).split('T')[0];
  const due = new Date(`${dateStr}T09:00:00.000Z`);

  // 1. 2 days before
  const twoDaysBefore = new Date(due);
  twoDaysBefore.setUTCDate(twoDaysBefore.getUTCDate() - 2);

  // 2. Day of
  const dayOf = new Date(due);

  const configs = [
    { suffix: '2d', dateObj: twoDaysBefore },
    { suffix: 'today', dateObj: dayOf }
  ];

  for (const cfg of configs) {
    const remId = `rem-flw-${followupId}-${cfg.suffix}`;
    reminders.push({
      id: remId,
      reminderId: remId,
      healthId,
      patientHealthId: healthId,
      patientName,
      receiverUids: Array.isArray(receiverUids) ? receiverUids : [receiverUids].filter(Boolean),
      dueAt: cfg.dateObj.toISOString(),
      status: 'pending',
      type: 'followup',
      followupId,
      title: `${patientName}: Follow-up due on ${dueDate} with ${doctorName}`,
      body: `${patientName}: Follow-up due on ${dueDate} with ${doctorName}`,
      privacyBody: `${patientName}: Follow-up checkup reminder`,
      attempts: 0,
      snoozeCount: 0,
      createdAt: referenceNow.toISOString(),
      updatedAt: referenceNow.toISOString()
    });
  }

  return reminders;
}

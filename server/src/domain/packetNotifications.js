/**
 * Packet-Based Patient Medicine Notification Generator
 * Path: server/src/domain/packetNotifications.js
 *
 * Requirements:
 * 1. Address the patient using their registered name.
 * 2. Display the correct packet letter (A, B, C, D, etc.).
 * 3. Display the number of tablets in that packet.
 * 4. Display the exact doctor-prescribed food instruction (never invent instructions).
 * 5. Display the correct scheduled time / context.
 * 6. Generate friendly contextual greetings (Morning: Good morning! / Afternoon: Hello! / Evening: Good evening!).
 * 7. Support English and natural, simple Kannada based on patient's language preference.
 * 8. Keep notifications short and readable on Android.
 * 9. Never reveal medicine names in patient notifications when packet mode is used.
 * 10. Do not assume the patient has eaten.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import env from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOSPITAL_TZ = env.HOSPITAL_TZ || 'Asia/Kolkata';

/**
 * Extract tablet / pill count from prescription item or dosage string.
 * Never invents dosage; extracts from doctor's entry or defaults to 1 per dose.
 *
 * @param {object} item
 * @returns {number}
 */
export function parseTabletCount(item) {
  if (!item) return 1;

  if (typeof item.tablets === 'number' && item.tablets > 0) return item.tablets;
  if (typeof item.tabletCount === 'number' && item.tabletCount > 0) return item.tabletCount;
  if (typeof item.tabletsCount === 'number' && item.tabletsCount > 0) return item.tabletsCount;

  const dosageStr = String(item.dosage || item.dose || '').toLowerCase();
  const match = dosageStr.match(/(\d+(?:\.\d+)?)\s*(?:tab|tablet|pill|capsule)s?/i);
  if (match) {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  return 1;
}

/**
 * Assign packet letters A, B, C, D to prescription medicines based on timing & daily slot
 * if not already explicitly assigned by the doctor.
 *
 * Standard Clinical Packet Mapping:
 * - Morning Before Food (Breakfast before_food)  -> Packet A
 * - Morning After / With Food (Breakfast after_food) -> Packet B
 * - Afternoon / Lunch (before or after)         -> Packet C
 * - Night / Dinner (before or after)            -> Packet D
 *
 * @param {Array<object>} medicines
 * @returns {Array<object>} medicines with packet assigned
 */
export function assignPrescriptionPacketGroups(medicines = []) {
  if (!Array.isArray(medicines)) return [];

  return medicines.map((m) => {
    // If doctor explicitly assigned a packet (A, B, C, D, etc.), strictly preserve it!
    const manualPacket = (m.packet && m.packet !== 'auto') ? m.packet : (m.packetLetter && m.packetLetter !== 'auto') ? m.packetLetter : (m.packetGroup && m.packetGroup !== 'auto') ? m.packetGroup : null;
    if (manualPacket && typeof manualPacket === 'string' && manualPacket.trim().length > 0) {
      return { ...m, packet: manualPacket.trim().toUpperCase() };
    }

    const timing = m.timing || 'after_food';
    const freq = String(m.frequency || '').toLowerCase();
    const times = Array.isArray(m.reminderTimes) ? m.reminderTimes : [];

    let packet = 'B'; // default morning after food

    if (timing === 'before_food') {
      if (freq.includes('0-0-1') || freq.includes('night') || (times[0] && times[0].includes('PM'))) {
        packet = 'D';
      } else if (freq.includes('afternoon') || freq.includes('lunch')) {
        packet = 'C';
      } else {
        packet = 'A'; // Morning before breakfast
      }
    } else {
      if (freq.includes('0-0-1') || freq.includes('night') || freq.includes('dinner')) {
        packet = 'D'; // Night after dinner
      } else if (freq.includes('1-1-1') || freq.includes('lunch')) {
        packet = 'C'; // Afternoon
      } else {
        packet = 'B'; // Morning after breakfast
      }
    }

    return { ...m, packet };
  });
}

/**
 * Get friendly contextual greeting based on local scheduled time.
 * Morning (04:00 - 11:59): "Good morning" / "ಶುಭೋದಯ"
 * Afternoon (12:00 - 16:59): "Hello" / "ನಮಸ್ಕಾರ"
 * Evening (17:00 - 03:59): "Good evening" / "ಶುಭ ಸಂಜೆ"
 *
 * @param {Date|string} scheduledTime
 * @param {'en'|'kn'} language
 * @returns {string}
 */
export function getContextualGreeting(scheduledTime, language = 'en') {
  const isKn = language === 'kn' || String(language).toLowerCase().startsWith('kn');
  let hour = 8; // Default morning

  if (scheduledTime) {
    try {
      const dt = dayjs(scheduledTime).tz(HOSPITAL_TZ);
      if (dt.isValid()) {
        hour = dt.hour();
      }
    } catch {
      // Fallback to 8
    }
  }

  if (hour >= 4 && hour < 12) {
    return isKn ? 'ಶುಭೋದಯ' : 'Good morning';
  } else if (hour >= 12 && hour < 17) {
    return isKn ? 'ನಮಸ್ಕಾರ' : 'Hello';
  } else {
    return isKn ? 'ಶುಭ ಸಂಜೆ' : 'Good evening';
  }
}

/**
 * Detect primary meal from scheduled time and timing instruction.
 * @param {string} timing
 * @param {Date|string} scheduledTime
 * @returns {'breakfast'|'lunch'|'dinner'}
 */
export function detectMealFromSchedule(timing = '', scheduledTime = null) {
  let hour = 8;
  if (scheduledTime) {
    try {
      const dt = dayjs(scheduledTime).tz(HOSPITAL_TZ);
      if (dt.isValid()) hour = dt.hour();
    } catch {}
  }

  if (hour >= 4 && hour < 12) return 'breakfast';
  if (hour >= 12 && hour < 17) return 'lunch';
  return 'dinner';
}

/**
 * Builds a personalized, patient-friendly medicine reminder notification.
 * Never reveals actual medicine names. Addresses patient by registered name.
 *
 * @param {object} params
 * @param {string} params.patientName - Patient registered name (e.g. 'Archana')
 * @param {string} [params.packetLetter='A'] - Packet letter (e.g. 'A', 'B', 'C', 'D')
 * @param {number} [params.tabletCount=1] - Number of tablets in this packet
 * @param {string} [params.timing='after_food'] - 'before_food', 'after_food', 'with_food', 'any_time'
 * @param {Date|string} [params.scheduledTime] - Scheduled instant
 * @param {string} [params.language='en'] - 'en' or 'kn'
 * @param {string} [params.customFoodInstruction] - Optional override food instruction from doctor notes
 * @returns {{ title: string, body: string, privacyBody: string, fullText: string, packet: string, tabletCount: number, language: string }}
 */
export function buildPatientMedicineNotification({
  patientName = 'Patient',
  packetLetter = 'A',
  tabletCount = 1,
  timing = 'after_food',
  scheduledTime = new Date(),
  language = 'en',
  customFoodInstruction = null
}) {
  const isKn = language === 'kn' || String(language).toLowerCase().startsWith('kn');
  const letter = String(packetLetter || 'A').toUpperCase();
  const count = Math.max(1, Number(tabletCount) || 1);
  const registeredName = String(patientName || 'Patient').trim();

  const greeting = getContextualGreeting(scheduledTime, language);
  const meal = detectMealFromSchedule(timing, scheduledTime);

  let body = '';
  let privacyBody = isKn ? `ಪ್ಯಾಕೆಟ್ ${letter} ಔಷಧ ಜ್ಞಾಪನೆ` : `Packet ${letter} medicine reminder`;

  if (isKn) {
    // ──────────────────────────────────────────────
    // KANNADA TRANSLATION
    // ──────────────────────────────────────────────
    const packetLabel = `ಪ್ಯಾಕೆಟ್ ${letter}`;
    const tabletLabel = count > 1 ? `${count} ಮಾತ್ರೆಗಳಿರುವ ` : '';

    if (timing === 'before_food') {
      const mealKn = meal === 'breakfast' ? 'ಉಪಾಹಾರಕ್ಕೆ' : meal === 'lunch' ? 'ಮಧ್ಯಾಹ್ನದ ಊಟಕ್ಕೆ' : 'ರಾತ್ರಿಯ ಊಟಕ್ಕೆ';
      body = `${mealKn} 30 ನಿಮಿಷಗಳ ಮೊದಲು ${tabletLabel}${packetLabel} ತೆಗೆದುಕೊಳ್ಳಿ.`;
    } else if (timing === 'after_food') {
      if (meal === 'dinner') {
        body = `ರಾತ್ರಿಯ ಊಟದ ನಂತರ ${tabletLabel}${packetLabel} ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ.`;
      } else {
        const mealKn = meal === 'breakfast' ? 'ಉಪಾಹಾರ' : 'ಮಧ್ಯಾಹ್ನದ ಊಟ';
        if (count > 1) {
          body = `${mealKn} ಮುಗಿದ ನಂತರ, ಸೂಚಿಸಿದಂತೆ ${tabletLabel}${packetLabel} ತೆಗೆದುಕೊಳ್ಳಿ.`;
        } else {
          body = `ನೀವು ${mealKn} ಮುಗಿಸಿದ್ದರೆ, ಸೂಚಿಸಿದಂತೆ ${packetLabel} ತೆಗೆದುಕೊಳ್ಳಿ.`;
        }
      }
    } else if (timing === 'with_food') {
      const mealKn = meal === 'breakfast' ? 'ಉಪಾಹಾರದೊಂದಿಗೆ' : meal === 'lunch' ? 'ಮಧ್ಯಾಹ್ನದ ಊಟದೊಂದಿಗೆ' : 'ರಾತ್ರಿಯ ಊಟದೊಂದಿಗೆ';
      body = `${mealKn} ${tabletLabel}${packetLabel} ತೆಗೆದುಕೊಳ್ಳಿ.`;
    } else {
      body = `ವೈದ್ಯರು ಸೂಚಿಸಿದಂತೆ ${tabletLabel}${packetLabel} ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ.`;
    }
  } else {
    // ──────────────────────────────────────────────
    // ENGLISH
    // ──────────────────────────────────────────────
    const packetLabel = `Packet ${letter}`;
    const tabletLabel = count > 1 ? ` containing ${count} tablets` : '';

    if (timing === 'before_food') {
      body = `Please take ${packetLabel}${tabletLabel}, 30 minutes before ${meal}.`;
    } else if (timing === 'after_food') {
      if (meal === 'dinner') {
        body = `It is time for ${packetLabel}${tabletLabel} after dinner.`;
      } else {
        if (count > 1) {
          body = `Please take ${packetLabel}${tabletLabel} after ${meal}, as prescribed.`;
        } else {
          body = `If you have finished ${meal}, please take ${packetLabel} as prescribed.`;
        }
      }
    } else if (timing === 'with_food') {
      body = `Please take ${packetLabel}${tabletLabel} with ${meal}, as prescribed.`;
    } else {
      body = `It is time to take ${packetLabel}${tabletLabel} as prescribed.`;
    }
  }

  const title = `${greeting}, ${registeredName}!`;
  const fullText = `${title} ${body}`;

  return {
    title,
    body,
    privacyBody,
    fullText,
    packet: letter,
    tabletCount: count,
    foodInstruction: customFoodInstruction || timing,
    language: isKn ? 'kn' : 'en'
  };
}

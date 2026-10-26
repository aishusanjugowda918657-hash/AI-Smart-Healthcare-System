/**
 * Pure Domain Module: Doctor Slot Generation & Schedule Logic
 * Implements PRD Section 4.2, 5.5 & F2
 */

import { SlotStatus } from './constants.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import clock from '../utils/clock.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Format time integer minutes from midnight to "HH:mm" string
 * e.g., 540 -> "09:00", 810 -> "13:30"
 */
export function minutesToHHmm(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Convert "HH:mm" string to total minutes from midnight
 * e.g., "09:00" -> 540, "13:30" -> 810
 */
export function HHmmToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Format "HH:mm" string or total minutes to 4-digit HHmm format for IDs
 * e.g., "09:00" -> "0900", "13:30" -> "1330"
 */
export function formatHHmmId(timeStr) {
  if (typeof timeStr === 'number') {
    timeStr = minutesToHHmm(timeStr);
  }
  return timeStr.replace(':', '');
}

/**
 * Helper to get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 */
export function getDayOfWeekNumber(dateStr) {
  // Parse date string YYYY-MM-DD safely in UTC to avoid timezone shift
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDay();
}

/**
 * Pure function to generate slot set for a single doctor on a single date.
 *
 * @param {Object} params
 * @param {string} params.doctorId - Doctor UID
 * @param {string} params.date - Date in YYYY-MM-DD format
 * @param {Object} params.schedule - Doctor schedule config
 * @param {Array} [params.leaves=[]] - Active leaves overlapping this date
 * @param {Array} [params.existingSlots=[]] - Existing slot documents from DB
 * @param {Date|number} [params.now=Date.now()] - Current timestamp for hold verification
 * @returns {Array<Object>} List of slot objects
 */
export function generateSlotsForDoctorDate({
  doctorId,
  date,
  schedule,
  leaves = [],
  existingSlots = [],
  now = Date.now()
}) {
  if (!doctorId || !date || !schedule) return [];

  const slotMinutes = schedule.slotMinutes || 10;
  const bufferEverySlots = schedule.bufferEverySlots || 6;
  const dayOfWeek = getDayOfWeekNumber(date);

  // Find day schedule config from weekly array
  const weeklyConfig = (schedule.weekly || []).find((w) => {
    if (typeof w.dayOfWeek === 'number') {
      return w.dayOfWeek === dayOfWeek;
    }
    if (typeof w.dayOfWeek === 'string') {
      const daysMap = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
      };
      return daysMap[w.dayOfWeek.toLowerCase()] === dayOfWeek;
    }
    return false;
  });

  // Map existing slots by deterministic ID for fast lookup
  const existingMap = new Map();
  (existingSlots || []).forEach((slot) => {
    if (slot && slot.id) {
      existingMap.set(slot.id, slot);
    }
  });

  // Prepare leave interval ranges in epoch ms for this date
  const leaveRanges = (leaves || []).map((leave) => {
    const fromMs = new Date(leave.fromAt).getTime();
    const toMs = new Date(leave.toAt).getTime();
    return { fromMs, toMs };
  });

  // Lunch break window in minutes from midnight if configured
  let lunchStartMin = null;
  let lunchEndMin = null;
  if (schedule.lunch && schedule.lunch.start && schedule.lunch.end) {
    lunchStartMin = HHmmToMinutes(schedule.lunch.start);
    lunchEndMin = HHmmToMinutes(schedule.lunch.end);
  }

  const generatedSlots = [];

  if (!weeklyConfig || !Array.isArray(weeklyConfig.sessions)) {
    return Array.from(existingMap.values());
  }

  const nowMs = typeof now === 'number' ? now : new Date(now).getTime();

  // Process each working session for the day
  for (const session of weeklyConfig.sessions) {
    if (!session.start || !session.end) continue;

    const sessionStartMin = HHmmToMinutes(session.start);
    const sessionEndMin = HHmmToMinutes(session.end);

    let slotCounterInSession = 0;

    for (let currentMin = sessionStartMin; currentMin + slotMinutes <= sessionEndMin; currentMin += slotMinutes) {
      // Check if slot falls inside lunch break
      if (lunchStartMin !== null && lunchEndMin !== null) {
        if (currentMin >= lunchStartMin && currentMin < lunchEndMin) {
          continue; // Skip slot generation during lunch
        }
      }

      slotCounterInSession++;
      const timeHHmm = minutesToHHmm(currentMin);
      const timeIdStr = formatHHmmId(timeHHmm);
      const slotId = `${doctorId}_${date}_${timeIdStr}`;

      // Slot start and end timestamps
      const [year, month, day] = date.split('-').map(Number);
      const slotStartMs = Date.UTC(year, month - 1, day, Math.floor(currentMin / 60), currentMin % 60);
      const slotEndMs = slotStartMs + slotMinutes * 60 * 1000;

      // Determine default status: buffer slot vs free slot
      let defaultStatus = (slotCounterInSession % bufferEverySlots === 0)
        ? SlotStatus.RESERVED
        : SlotStatus.FREE;

      // Check if slot overlaps with any active leave
      const isBlockedByLeave = leaveRanges.some(
        (lr) => slotStartMs < lr.toMs && slotEndMs > lr.fromMs
      );

      if (isBlockedByLeave) {
        defaultStatus = SlotStatus.BLOCKED;
      }

      // Check if an existing slot document already exists
      const existing = existingMap.get(slotId);

      if (existing) {
        // Rule: NEVER overwrite booked or active held slots
        if (existing.status === SlotStatus.BOOKED) {
          generatedSlots.push({ ...existing });
          existingMap.delete(slotId);
          continue;
        }

        const heldUntilMs = existing.heldUntil ? new Date(existing.heldUntil).getTime() : 0;
        if (existing.status === SlotStatus.HELD && heldUntilMs > nowMs) {
          generatedSlots.push({ ...existing });
          existingMap.delete(slotId);
          continue;
        }
      }

      // Create or update slot object
      generatedSlots.push({
        id: slotId,
        doctorId,
        date,
        startAt: timeHHmm,
        endAt: existing?.endAt || minutesToHHmm(currentMin + slotMinutes),
        status: defaultStatus,
        heldUntil: null,
        heldBy: null,
        appointmentId: existing?.appointmentId || null
      });

      existingMap.delete(slotId);
    }
  }

  // Include any extra existing booked/held slots outside regular sessions (e.g. override appointments)
  for (const remainingSlot of existingMap.values()) {
    if (remainingSlot.status === SlotStatus.BOOKED) {
      generatedSlots.push(remainingSlot);
    }
  }

  return generatedSlots;
}

/**
 * Verify if a slot hold is currently active
 */
export function isSlotHeld(slot, now = Date.now()) {
  if (!slot || slot.status !== SlotStatus.HELD) return false;
  if (!slot.heldUntil) return false;
  const heldUntilMs = typeof slot.heldUntil === 'number'
    ? slot.heldUntil
    : new Date(slot.heldUntil).getTime();
  return heldUntilMs > (typeof now === 'number' ? now : new Date(now).getTime());
}

/**
 * Check if a slot is available for booking or holding by a given user
 */
export function isSlotAvailable(slot, userId = null, now = Date.now()) {
  if (!slot) return false;
  if (slot.status === SlotStatus.FREE) return true;
  if (slot.status === SlotStatus.HELD) {
    const heldUntilMs = slot.heldUntil ? new Date(slot.heldUntil).getTime() : 0;
    const nowMs = typeof now === 'number' ? now : new Date(now).getTime();
    if (heldUntilMs <= nowMs) return true; // Expired hold
    if (userId && slot.heldBy === userId) return true; // Held by this user
  }
  return false;
}

/**
 * Calculate fill level and metrics for Day Heat Strip component
 */
export function calculateDayFillLevel(slots = []) {
  const total = slots.length;
  if (total === 0) {
    return {
      totalCount: 0,
      freeCount: 0,
      reservedCount: 0,
      bookedCount: 0,
      blockedCount: 0,
      heldCount: 0,
      fillRatio: 0,
      color: 'green', // Default empty state
      label: '0 / 0 Booked'
    };
  }

  let freeCount = 0;
  let reservedCount = 0;
  let bookedCount = 0;
  let blockedCount = 0;
  let heldCount = 0;

  for (const s of slots) {
    switch (s.status) {
      case SlotStatus.FREE:
        freeCount++;
        break;
      case SlotStatus.RESERVED:
        reservedCount++;
        break;
      case SlotStatus.BOOKED:
        bookedCount++;
        break;
      case SlotStatus.BLOCKED:
        blockedCount++;
        break;
      case SlotStatus.HELD:
        if (isSlotHeld(s)) {
          heldCount++;
        } else {
          freeCount++; // Count expired hold as free
        }
        break;
      default:
        break;
    }
  }

  const activeCapacity = total - blockedCount;
  const takenCount = bookedCount + heldCount;
  const fillRatio = activeCapacity > 0 ? takenCount / activeCapacity : 1.0;

  let color = 'green';
  if (fillRatio >= 0.85 || activeCapacity === 0) {
    color = 'red';
  } else if (fillRatio >= 0.6) {
    color = 'amber';
  }

  return {
    totalCount: total,
    freeCount,
    reservedCount,
    bookedCount,
    blockedCount,
    heldCount,
    fillRatio: Number(fillRatio.toFixed(2)),
    color,
    label: `${bookedCount} / ${activeCapacity} Booked`
  };
}

/**
 * Smart Slot Suggestion Engine (PRD Section 5.3)
 * Calculates multi-factor scores (earliness, quietness, travelFit, continuity)
 * and returns up to 3 recommendation cards.
 */
export function getSmartSlotSuggestions({
  slots = [],
  dateStr = dayjs(clock.now ? clock.now() : Date.now()).tz('Asia/Kolkata').format('YYYY-MM-DD'),
  travelMinutes = null,
  previousDoctorId = null,
  currentDoctorId = null,
  nowMs = clock.now ? clock.now().getTime() : Date.now()
}) {
  const nowIST = dayjs(nowMs).tz('Asia/Kolkata');
  const today = nowIST.format('YYYY-MM-DD');
  const isPastDate = dateStr < today;
  const isToday = dateStr === today;
  const nowMinutes = HHmmToMinutes(nowIST.format('HH:mm'));

  const availableSlots = slots.filter((s) => {
    if (s.status !== SlotStatus.FREE && s.status !== SlotStatus.RESERVED) return false;
    if (isPastDate) return false;
    if (isToday) {
      const slotStartMinutes = HHmmToMinutes(s.startAt);
      // Require at least 5 minutes before slot start
      if (slotStartMinutes <= nowMinutes + 5) return false;
    }
    return true;
  });

  const cards = [];

  if (availableSlots.length > 0) {
    const scoredSlots = availableSlots.map((slot, index) => {
      // 1. Earliness: earlier slots in the day score higher (norm 0..1)
      const earliness = 1 - (index / Math.max(availableSlots.length - 1, 1));

      // 2. Quietness: slots surrounding fewer booked slots score higher
      const slotMin = HHmmToMinutes(slot.startAt);
      const nearbyBooked = slots.filter((s) => {
        if (s.status !== SlotStatus.BOOKED) return false;
        const m = HHmmToMinutes(s.startAt);
        return Math.abs(m - slotMin) <= 30;
      }).length;
      const quietness = 1 - Math.min(nearbyBooked / 6, 1);

      // 3. Travel Fit: check if travel time allows reaching on time
      let travelFit = 0.5;
      if (typeof travelMinutes === 'number' && travelMinutes > 0) {
        const checkinBuffer = 10;
        const leaveAtMin = slotMin - checkinBuffer - travelMinutes - 5;
        const currentMin = nowMinutes;
        if (leaveAtMin >= currentMin + 5 && leaveAtMin >= 360 && leaveAtMin <= 1260) {
          travelFit = 1.0;
        } else {
          travelFit = 0.1;
        }
      }

      // 4. Continuity bonus if doctor matches previous doctor
      const continuity = (previousDoctorId && currentDoctorId && previousDoctorId === currentDoctorId) ? 1.0 : 0.0;

      const score = Number((0.35 * earliness + 0.35 * quietness + 0.20 * travelFit + 0.10 * continuity).toFixed(3));

      return {
        slot,
        score,
        earliness,
        quietness,
        travelFit,
        continuity
      };
    });

    // Sort by score descending
    scoredSlots.sort((a, b) => b.score - a.score);

    const earliestCandidate = availableSlots[0];
    const quietestCandidate = [...scoredSlots].sort((a, b) => b.quietness - a.quietness)[0]?.slot || availableSlots[0];

    if (earliestCandidate) {
      cards.push({
        type: 'earliest',
        label: 'Earliest Available',
        slotId: earliestCandidate.id,
        startAt: earliestCandidate.startAt,
        timeStr: earliestCandidate.startAt,
        reason: 'Gets you seen as soon as possible today.'
      });
    }

    if (quietestCandidate && quietestCandidate.id !== earliestCandidate?.id) {
      cards.push({
        type: 'quietest',
        label: 'Shortest Expected Wait',
        slotId: quietestCandidate.id,
        startAt: quietestCandidate.startAt,
        timeStr: quietestCandidate.startAt,
        reason: 'Lowest expected clinic workload window.'
      });
    }

    if (travelMinutes && travelMinutes > 0) {
      const travelFitCandidate = [...scoredSlots].sort((a, b) => b.travelFit - a.travelFit)[0]?.slot;
      if (travelFitCandidate && !cards.some((c) => c.slotId === travelFitCandidate.id)) {
        cards.push({
          type: 'travelFit',
          label: 'Best for Your Travel',
          slotId: travelFitCandidate.id,
          startAt: travelFitCandidate.startAt,
          reason: `Ideal time for your ${travelMinutes}-minute commute.`
        });
      }
    }
  }

  return {
    cards: cards.slice(0, 3),
    fullList: slots.map((s) => {
      const sDate = s.date || dateStr;
      const isSlotPastDate = sDate < today;
      const isSlotPastTimeToday = sDate === today && HHmmToMinutes(s.startAt) <= nowMinutes;
      const isExpired = isSlotPastDate || isSlotPastTimeToday;
      return {
        ...s,
        isExpired
      };
    })
  };
}

/**
 * Pure Domain Module: Doctor Slot Generation & Schedule Logic
 * Implements PRD Section 4.2, 5.5 & F2
 */

import { SlotStatus } from './constants.js';

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

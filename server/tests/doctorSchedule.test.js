import { describe, it, expect } from 'vitest';
import { generateAvailableSlots } from '../src/services/slotGenerator.js';

describe('Phase 4 - Deterministic Slot Generator Unit Tests', () => {
  const schedule = {
    workingDays: [1, 2, 3, 4, 5], // Mon-Fri
    workingHours: { start: '09:00', end: '11:00' }, // 2 hours
    slotDurationMinutes: 30, // 4 total 30-min slots: 09:00, 09:30, 10:00, 10:30
    breakTimes: [{ start: '10:00', end: '10:30' }], // Breaks 10:00-10:30
    leaves: ['2026-10-01']
  };

  it('returns empty array if date falls on a doctor leave', () => {
    const slots = generateAvailableSlots({
      schedule,
      existingAppointments: [],
      targetDateStr: '2026-10-01'
    });

    expect(slots).toEqual([]);
  });

  it('filters out break times from available slots', () => {
    // 2026-09-21 is a Monday (working day)
    const slots = generateAvailableSlots({
      schedule,
      existingAppointments: [],
      targetDateStr: '2026-09-21'
    });

    // Total 3 non-break slots expected: 09:00, 09:30, 10:30
    const timeSlotStrings = slots.map((s) => s.timeSlot);
    expect(timeSlotStrings).toContain('09:00');
    expect(timeSlotStrings).toContain('09:30');
    expect(timeSlotStrings).not.toContain('10:00'); // Filtered by break
    expect(timeSlotStrings).toContain('10:30');
  });

  it('marks slots as unavailable if existing active appointment exists', () => {
    const existingAppointments = [
      { timeSlot: '09:30', status: 'BOOKED' }
    ];

    const slots = generateAvailableSlots({
      schedule,
      existingAppointments,
      targetDateStr: '2026-09-21'
    });

    const slot0930 = slots.find((s) => s.timeSlot === '09:30');
    const slot0900 = slots.find((s) => s.timeSlot === '09:00');

    expect(slot0930.available).toBe(false);
    expect(slot0900.available).toBe(true);
  });
});

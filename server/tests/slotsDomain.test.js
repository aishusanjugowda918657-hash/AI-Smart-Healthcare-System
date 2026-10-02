import { describe, it, expect } from 'vitest';
import {
  generateSlotsForDoctorDate,
  minutesToHHmm,
  HHmmToMinutes,
  formatHHmmId,
  isSlotHeld,
  isSlotAvailable,
  calculateDayFillLevel
} from '../src/domain/slots.js';
import { SlotStatus } from '../src/domain/constants.js';

describe('Domain Module: Doctor Slot Generation (PRD F2)', () => {
  const sampleSchedule = {
    slotMinutes: 10,
    bufferEverySlots: 6,
    weekly: [
      {
        dayOfWeek: 1, // Monday
        sessions: [
          { start: '09:00', end: '11:00' }, // 12 slots (2 hours * 6)
          { start: '14:00', end: '16:00' }  // 12 slots (2 hours * 6)
        ]
      }
    ],
    lunch: { start: '13:00', end: '14:00' }
  };

  it('converts between HH:mm and total minutes accurately', () => {
    expect(HHmmToMinutes('09:00')).toBe(540);
    expect(HHmmToMinutes('13:30')).toBe(810);
    expect(minutesToHHmm(540)).toBe('09:00');
    expect(minutesToHHmm(810)).toBe('13:30');
    expect(formatHHmmId('09:30')).toBe('0930');
  });

  it('generates correct slot grid for a working day', () => {
    // 2026-10-12 is a Monday (day 1)
    const slots = generateSlotsForDoctorDate({
      doctorId: 'doc-001',
      date: '2026-10-12',
      schedule: sampleSchedule
    });

    expect(slots.length).toBe(24);
    expect(slots[0].id).toBe('doc-001_2026-10-12_0900');
    expect(slots[0].startAt).toBe('09:00');
    expect(slots[0].status).toBe(SlotStatus.FREE);

    // 6th slot (09:50) should be reserved (buffer slot)
    expect(slots[5].startAt).toBe('09:50');
    expect(slots[5].status).toBe(SlotStatus.RESERVED);

    // 12th slot (10:50) should be reserved (buffer slot)
    expect(slots[11].startAt).toBe('10:50');
    expect(slots[11].status).toBe(SlotStatus.RESERVED);
  });

  it('slot generation is idempotent', () => {
    const run1 = generateSlotsForDoctorDate({
      doctorId: 'doc-001',
      date: '2026-10-12',
      schedule: sampleSchedule
    });

    const run2 = generateSlotsForDoctorDate({
      doctorId: 'doc-001',
      date: '2026-10-12',
      schedule: sampleSchedule,
      existingSlots: run1
    });

    expect(run1).toEqual(run2);
  });

  it('lunch and leave produce no free slots', () => {
    // Leave covering afternoon session 14:00 to 16:00
    const leaves = [
      {
        fromAt: '2026-10-12T14:00:00Z',
        toAt: '2026-10-12T16:00:00Z',
        status: 'planned'
      }
    ];

    const slots = generateSlotsForDoctorDate({
      doctorId: 'doc-001',
      date: '2026-10-12',
      schedule: sampleSchedule,
      leaves
    });

    const afternoonSlots = slots.filter((s) => HHmmToMinutes(s.startAt) >= 840);
    expect(afternoonSlots.length).toBe(12);
    afternoonSlots.forEach((s) => {
      expect(s.status).toBe(SlotStatus.BLOCKED);
    });
  });

  it('NEVER overwrites booked or active held slots', () => {
    const existingBooked = [
      {
        id: 'doc-001_2026-10-12_0910',
        doctorId: 'doc-001',
        date: '2026-10-12',
        startAt: '09:10',
        status: SlotStatus.BOOKED,
        appointmentId: 'appt-999'
      },
      {
        id: 'doc-001_2026-10-12_0920',
        doctorId: 'doc-001',
        date: '2026-10-12',
        startAt: '09:20',
        status: SlotStatus.HELD,
        heldBy: 'user-777',
        heldUntil: new Date(Date.now() + 180000).toISOString()
      }
    ];

    // Apply leave over morning session
    const leaves = [
      {
        fromAt: '2026-10-12T09:00:00Z',
        toAt: '2026-10-12T11:00:00Z',
        status: 'same_day'
      }
    ];

    const slots = generateSlotsForDoctorDate({
      doctorId: 'doc-001',
      date: '2026-10-12',
      schedule: sampleSchedule,
      leaves,
      existingSlots: existingBooked
    });

    const bookedSlot = slots.find((s) => s.id === 'doc-001_2026-10-12_0910');
    const heldSlot = slots.find((s) => s.id === 'doc-001_2026-10-12_0920');

    expect(bookedSlot.status).toBe(SlotStatus.BOOKED);
    expect(bookedSlot.appointmentId).toBe('appt-999');

    expect(heldSlot.status).toBe(SlotStatus.HELD);
    expect(heldSlot.heldBy).toBe('user-777');
  });

  it('calculates day fill level metrics for heat strip', () => {
    const slots = [
      { status: SlotStatus.BOOKED },
      { status: SlotStatus.BOOKED },
      { status: SlotStatus.FREE },
      { status: SlotStatus.FREE },
      { status: SlotStatus.RESERVED }
    ];

    const fill = calculateDayFillLevel(slots);
    expect(fill.totalCount).toBe(5);
    expect(fill.bookedCount).toBe(2);
    expect(fill.freeCount).toBe(2);
    expect(fill.fillRatio).toBe(0.4);
    expect(fill.color).toBe('green');
  });
});

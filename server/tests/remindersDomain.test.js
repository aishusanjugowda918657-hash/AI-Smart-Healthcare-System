import { describe, it, expect } from 'vitest';
import {
  generateDoseSchedule,
  createDoseReminders,
  parseFrequencySlots,
  generateActionToken,
  verifyActionToken
} from '../src/domain/reminders.js';

describe('PRD F11: Reminder Schedule Engine & HMAC Action Token Unit Tests', () => {
  it('generateDoseSchedule with 1-0-1 frequency for 5 days generates exactly 10 dose reminders', () => {
    // Early mockNow (01:00 AM local) so 08:30 is in future
    const mockNow = new Date(2026, 9, 2, 1, 0, 0);
    const schedule = generateDoseSchedule({
      medicineName: 'Amoxicillin',
      dosage: '500 mg',
      frequency: '1-0-1',
      startDate: '2026-10-02',
      durationDays: 5,
      timing: 'after_food',
      referenceNow: mockNow
    });

    expect(schedule).toHaveLength(10);
    expect(schedule[0].medicineName).toBe('Amoxicillin');
    expect(schedule[9].doseNumber).toBe(10);
  });

  it('generateDoseSchedule applies +30 minutes offset for after_food and -30 minutes for before_food', () => {
    const mockNow = new Date(2026, 9, 2, 1, 0, 0); // 01:00 AM local time
    // Breakfast default is 08:00
    const scheduleAfter = generateDoseSchedule({
      medicineName: 'Paracetamol',
      dosage: '500 mg',
      frequency: '1-0-0',
      startDate: '2026-10-02',
      durationDays: 1,
      timing: 'after_food',
      referenceNow: mockNow
    });

    expect(scheduleAfter[0].timeStr).toBe('08:30');

    const scheduleBefore = generateDoseSchedule({
      medicineName: 'Pantoprazole',
      dosage: '40 mg',
      frequency: '1-0-0',
      startDate: '2026-10-02',
      durationDays: 1,
      timing: 'before_food',
      referenceNow: mockNow
    });

    expect(scheduleBefore[0].timeStr).toBe('07:30');
  });

  it('generateDoseSchedule omits past doses on day 0 and keeps future doses at prescribed local times', () => {
    // Reference now: 09:00 AM IST on 2026-10-02 (03:30:00.000Z). Breakfast dose was 08:30 AM (past).
    const mockNow = new Date('2026-10-02T03:30:00.000Z');
    // Case A: 1-0-0 (only morning dose at 08:30) on day 0 -> past dose is omitted
    const schedulePast = generateDoseSchedule({
      medicineName: 'Cetirizine',
      dosage: '10 mg',
      frequency: '1-0-0',
      startDate: '2026-10-02',
      durationDays: 1,
      timing: 'after_food',
      referenceNow: mockNow
    });
    expect(schedulePast).toHaveLength(0);

    // Case B: 1-0-1 (morning 08:30, evening 20:30) on day 0 -> morning omitted, evening preserved at 20:30 IST
    const scheduleFuture = generateDoseSchedule({
      medicineName: 'Cetirizine',
      dosage: '10 mg',
      frequency: '1-0-1',
      startDate: '2026-10-02',
      durationDays: 1,
      timing: 'after_food',
      referenceNow: mockNow
    });
    expect(scheduleFuture).toHaveLength(1);
    expect(scheduleFuture[0].timeStr).toBe('20:30');
    expect(scheduleFuture[0].scheduledTime).toBe('2026-10-02T15:00:00.000Z'); // 20:30 IST = 15:00 UTC
  });

  it('generateDoseSchedule and createDoseReminders convert 08:00 Asia/Kolkata to 02:30:00.000Z UTC', () => {
    // 08:00 AM with_food (0m offset) on 2026-10-30 in Asia/Kolkata
    const refNow = new Date('2026-10-29T12:00:00.000Z'); // Day before
    const schedule = generateDoseSchedule({
      medicineName: 'Thyroxine',
      dosage: '50 mcg',
      frequency: '1-0-0',
      startDate: '2026-10-30',
      durationDays: 1,
      timing: 'with_food',
      mealTimes: { breakfast: '08:00' },
      referenceNow: refNow
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].timeStr).toBe('08:00');
    expect(schedule[0].scheduledTime).toBe('2026-10-30T02:30:00.000Z');

    const reminders = createDoseReminders({
      prescriptionId: 'RX-TEST-TZ',
      item: {
        name: 'Thyroxine',
        dosage: '50 mcg',
        frequency: '1-0-0',
        timing: 'with_food',
        durationDays: 1
      },
      healthId: 'PHI-TEST-TZ',
      startDate: '2026-10-30',
      mealTimes: { breakfast: '08:00' },
      referenceNow: refNow
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0].dueAt).toBe('2026-10-30T02:30:00.000Z');
  });

  it('generateActionToken creates valid HMAC token and verifyActionToken verifies signature and expiry', () => {
    const payload = { reminderId: 'rem-123', action: 'taken', exp: Date.now() + 60000 };
    const token = generateActionToken(payload);

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');

    const verified = verifyActionToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.payload.reminderId).toBe('rem-123');

    // Tampered token (change signature)
    const tampered = token.slice(0, -4) + 'abcd';
    expect(verifyActionToken(tampered)).toBeNull();

    // Expired token
    const expiredPayload = { reminderId: 'rem-123', exp: Date.now() - 5000 };
    const expiredToken = generateActionToken(expiredPayload);
    const expiredRes = verifyActionToken(expiredToken);
    expect(expiredRes.expired).toBe(true);
  });
});

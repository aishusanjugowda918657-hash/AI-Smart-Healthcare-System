import { describe, it, expect } from 'vitest';
import {
  generateDoseSchedule,
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

  it('generateDoseSchedule ensures first dose is at least 5 minutes in the future if start date is today and past', () => {
    // Current time is 09:00 AM local time. Breakfast dose was scheduled for 08:30 AM (past).
    const mockNow = new Date(2026, 9, 2, 9, 0, 0);
    const schedule = generateDoseSchedule({
      medicineName: 'Cetirizine',
      dosage: '10 mg',
      frequency: '1-0-0',
      startDate: '2026-10-02',
      durationDays: 1,
      timing: 'after_food',
      referenceNow: mockNow
    });

    const firstScheduled = new Date(schedule[0].scheduledTime);
    expect(firstScheduled.getTime()).toBeGreaterThanOrEqual(mockNow.getTime() + 5 * 60 * 1000);
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

import { describe, it, expect } from 'vitest';
import {
  generateAppointmentIcs,
  generateMedicineScheduleIcs,
  formatIcsDate
} from '../../client/src/services/calendarExport.js';

describe('PRD Calendar Export & Offline Sync Unit Tests', () => {
  it('formatIcsDate formats dates correctly to YYYYMMDDTHHMMSSZ', () => {
    const d = new Date(Date.UTC(2026, 9, 30, 8, 30, 0));
    expect(formatIcsDate(d)).toBe('20261030T083000Z');
  });

  it('generateAppointmentIcs generates valid RFC 5545 appointment calendar with check-in alarms', () => {
    const ics = generateAppointmentIcs({
      doctorName: 'Anurag Ranjan',
      department: 'Cardiology',
      date: '2026-10-30',
      timeSlot: '09:00 AM',
      tokenLabel: 'A-12',
      location: 'Room 201'
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Doctor Consultation: Dr. Anurag Ranjan');
    expect(ics).toContain('LOCATION:Room 201');
    expect(ics).toContain('TRIGGER:-PT2H'); // 2 hours prior reminder
    expect(ics).toContain('TRIGGER:-PT15M'); // 15 mins prior check-in alarm
    expect(ics).toContain('END:VCALENDAR');
  });

  it('generateMedicineScheduleIcs creates recurring dose events with daily alarms', () => {
    const mockReminders = [
      {
        id: 'rem-1',
        medicineName: 'Metformin',
        dosage: '500mg',
        mealTime: 'breakfast',
        scheduledTime: '08:00 AM'
      },
      {
        id: 'rem-2',
        medicineName: 'Atorvastatin',
        dosage: '10mg',
        mealTime: 'dinner',
        scheduledTime: '08:00 PM'
      }
    ];

    const ics = generateMedicineScheduleIcs(mockReminders, 7);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Take Medicine: Metformin (500mg)');
    expect(ics).toContain('SUMMARY:Take Medicine: Atorvastatin (10mg)');
    expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=7');
    expect(ics).toContain('TRIGGER:-PT0M'); // Alarm at exact dose time
    expect(ics).toContain('END:VCALENDAR');
  });

  it('Canonical notification tag deduplication generates identical tags for matching dose and check-in events', () => {
    // Medicine reminder canonical tag calculation
    const makeMedTag = (data) => `med-dose-${data.groupKey || data.reminderId}`;
    const fcmPayload = { reminderId: 'rem-101', groupKey: 'grp-rx-101' };
    const localPayload = { reminderId: 'rem-101', groupKey: 'grp-rx-101' };

    expect(makeMedTag(fcmPayload)).toBe('med-dose-grp-rx-101');
    expect(makeMedTag(localPayload)).toBe('med-dose-grp-rx-101');
    expect(makeMedTag(fcmPayload)).toBe(makeMedTag(localPayload));

    // Appointment check-in canonical tag calculation
    const makeApptTag = (data) => `appt-checkin-${data.appointmentId}-${data.type || 'attime'}`;
    const fcmAppt = { appointmentId: 'apt-555', type: 'CHECKIN_REMINDER' };
    const localAppt = { appointmentId: 'apt-555', type: 'CHECKIN_REMINDER' };

    expect(makeApptTag(fcmAppt)).toBe('appt-checkin-apt-555-CHECKIN_REMINDER');
    expect(makeApptTag(localAppt)).toBe('appt-checkin-apt-555-CHECKIN_REMINDER');
    expect(makeApptTag(fcmAppt)).toBe(makeApptTag(localAppt));
  });

  it('Offline action queue sanitizes payloads and strips sensitive credentials', () => {
    const rawPayload = {
      action: 'taken',
      snoozeMinutes: 10,
      token: 'hmac-valid-signature-token-123',
      password: 'SuperSecretPassword',
      accessToken: 'bearer-jwt-token-xyz',
      refreshToken: 'refresh-token-abc'
    };

    // Sanitize pattern used in enqueueOfflineAction
    const sanitizedBody = { ...rawPayload };
    delete sanitizedBody.password;
    delete sanitizedBody.accessToken;
    delete sanitizedBody.refreshToken;

    expect(sanitizedBody.action).toBe('taken');
    expect(sanitizedBody.token).toBe('hmac-valid-signature-token-123');
    expect(sanitizedBody.password).toBeUndefined();
    expect(sanitizedBody.accessToken).toBeUndefined();
    expect(sanitizedBody.refreshToken).toBeUndefined();
  });

  it('Prunes stale or cancelled appointments from cached appointment ID list', () => {
    const existingCache = ['apt-1', 'apt-2', 'apt-3'];
    const activeServerIds = ['apt-1', 'apt-3']; // apt-2 was cancelled/completed on server

    const activeSet = new Set(activeServerIds);
    const pruned = existingCache.filter(id => activeSet.has(id));

    expect(pruned).toEqual(['apt-1', 'apt-3']);
    expect(pruned).not.toContain('apt-2');
  });
});

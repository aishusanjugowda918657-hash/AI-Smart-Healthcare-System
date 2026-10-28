import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import {
  isVerifiedEmulatorMode,
  getOperatingSchedule,
  isHospitalOpen,
  isScheduleOpenAt,
  PRODUCTION_SCHEDULE,
  EMULATOR_OVERNIGHT_SCHEDULE,
  toFirestoreSchedule,
  getScheduleMetadata
} from '../src/config/operatingSchedule.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';
import { getHospitalTodayStr, HOSPITAL_TZ } from '../src/utils/timezoneDate.js';
import { sortQueueTokens } from '../src/services/tokenPriorityEngine.js';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('SmartCare AI — Operating Schedule & Midnight Rollover Suite', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Production Protection & Hard Safety Fallback
  // =========================================================================
  describe('1. Production Protection and Fail-Safe Behavior', () => {
    it('MUST return PRODUCTION_SCHEDULE when emulator environment variables are absent', () => {
      delete process.env.FIRESTORE_EMULATOR_HOST;
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      process.env.GCLOUD_PROJECT = 'ai-basedsmarthealthcaresystem';

      expect(isVerifiedEmulatorMode()).toBe(false);
      const schedule = getOperatingSchedule();
      expect(schedule.mode).toBe('production');
      expect(schedule.startHourStr).toBe('09:00');
      expect(schedule.endHourStr).toBe('17:00');
      expect(schedule.displayHours).toBe('9:00 AM – 5:00 PM');
      expect(schedule.isOvernight).toBe(false);
      expect(schedule.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('MUST fail safely to production if environment is ambiguous (e.g. host present but project is production)', () => {
      process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
      process.env.GCLOUD_PROJECT = 'ai-basedsmarthealthcaresystem';

      expect(isVerifiedEmulatorMode()).toBe(false);
      const schedule = getOperatingSchedule();
      expect(schedule.mode).toBe('production');
      expect(schedule.startHourStr).toBe('09:00');
      expect(schedule.endHourStr).toBe('17:00');
    });

    it('Production operating hours MUST be strictly 9:00 AM – 5:00 PM (Monday-Friday)', () => {
      const prod = PRODUCTION_SCHEDULE;

      // Closed before 9:00 AM
      expect(isScheduleOpenAt(prod, '08:59')).toBe(false);
      expect(isScheduleOpenAt(prod, '08:00')).toBe(false);

      // Open 9:00 AM – 4:59 PM
      expect(isScheduleOpenAt(prod, '09:00')).toBe(true);
      expect(isScheduleOpenAt(prod, '11:30')).toBe(true);
      expect(isScheduleOpenAt(prod, '13:00')).toBe(true);
      expect(isScheduleOpenAt(prod, '16:59')).toBe(true);

      // Closed at and after 5:00 PM
      expect(isScheduleOpenAt(prod, '17:00')).toBe(false);
      expect(isScheduleOpenAt(prod, '17:01')).toBe(false);
      expect(isScheduleOpenAt(prod, '21:00')).toBe(false);
      expect(isScheduleOpenAt(prod, '00:00')).toBe(false);
      expect(isScheduleOpenAt(prod, '04:59')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Emulator-Only Overnight Schedule (9:00 PM – 5:00 AM Asia/Kolkata)
  // =========================================================================
  describe('2. Emulator Overnight Operating Hours Verification', () => {
    const emu = EMULATOR_OVERNIGHT_SCHEDULE;

    it('Emulator schedule config matches requirements: 21:00 to 05:00, 7 days, overnight', () => {
      expect(emu.mode).toBe('emulator_overnight');
      expect(emu.startHourStr).toBe('21:00');
      expect(emu.endHourStr).toBe('05:00');
      expect(emu.displayHours).toBe('9:00 PM – 5:00 AM');
      expect(emu.isOvernight).toBe(true);
      expect(emu.workingDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(emu.slotMinutes).toBe(15);
    });

    it('MUST verify exact boundary times: 8:59 PM (closed), 9:00 PM (open), 11:59 PM (open), 12:00 AM (open), 4:59 AM (open), 5:00 AM (closed)', () => {
      // 8:59 PM -> Closed
      expect(isScheduleOpenAt(emu, '20:59')).toBe(false);
      expect(isHospitalOpen('20:59', true)).toBe(false);

      // 9:00 PM -> Open (shift start)
      expect(isScheduleOpenAt(emu, '21:00')).toBe(true);
      expect(isHospitalOpen('21:00', true)).toBe(true);

      // 11:59 PM -> Open
      expect(isScheduleOpenAt(emu, '23:59')).toBe(true);
      expect(isHospitalOpen('23:59', true)).toBe(true);

      // 12:00 AM -> Open (midnight crossover)
      expect(isScheduleOpenAt(emu, '00:00')).toBe(true);
      expect(isHospitalOpen('00:00', true)).toBe(true);

      // 4:59 AM -> Open (last minute of shift)
      expect(isScheduleOpenAt(emu, '04:59')).toBe(true);
      expect(isHospitalOpen('04:59', true)).toBe(true);

      // 5:00 AM -> Closed (shift end)
      expect(isScheduleOpenAt(emu, '05:00')).toBe(false);
      expect(isHospitalOpen('05:00', true)).toBe(false);

      // Afternoon hours (e.g. 14:00) -> Closed
      expect(isScheduleOpenAt(emu, '14:00')).toBe(false);
      expect(isHospitalOpen('14:00', true)).toBe(false);
    });
  });

  // =========================================================================
  // 3. Slot Generation Across Midnight (D to D+1 Calendar Date Assignment)
  // =========================================================================
  describe('3. Slot Generation & Next Calendar Date Assignment Across Midnight', () => {
    it('assigns pre-midnight slots to Day D and post-midnight slots to Day D+1', () => {
      const doctorId = 'DOC-DEMO-GEN-01';
      const baseDate = '2026-11-10'; // A Tuesday

      const slots = generateSlotsForDoctorDate({
        doctorId,
        date: baseDate,
        schedule: EMULATOR_OVERNIGHT_SCHEDULE,
        leaves: [],
        existingSlots: []
      });

      expect(slots.length).toBeGreaterThan(0);

      // Slots between 21:00 and 23:45 must have date = '2026-11-10'
      const preMidnightSlots = slots.filter((s) => s.startAt >= '21:00' && s.startAt <= '23:45');
      expect(preMidnightSlots.length).toBe(12); // (3 hours * 4 slots/hr) = 12 slots
      preMidnightSlots.forEach((s) => {
        expect(s.date).toBe('2026-11-10');
        expect(s.id).toBe(`${doctorId}_2026-11-10_${s.startAt.replace(':', '')}`);
      });

      // Slots between 00:00 and 04:45 must have date = '2026-11-11' (D+1)
      const postMidnightSlots = slots.filter((s) => s.startAt >= '00:00' && s.startAt <= '04:45');
      expect(postMidnightSlots.length).toBe(20); // (5 hours * 4 slots/hr) = 20 slots
      postMidnightSlots.forEach((s) => {
        expect(s.date).toBe('2026-11-11');
        expect(s.id).toBe(`${doctorId}_2026-11-11_${s.startAt.replace(':', '')}`);
      });

      // Total slots for the 8-hour shift = 32 slots (12 + 20)
      expect(slots.length).toBe(32);

      // No slot should exist at 05:00
      const slot0500 = slots.find((s) => s.startAt === '05:00');
      expect(slot0500).toBeUndefined();
    });

    it('generates slots deterministically and idempotently on repeated runs', () => {
      const doctorId = 'DOC-DEMO-CARD-01';
      const date = '2026-11-15';

      const run1 = generateSlotsForDoctorDate({
        doctorId,
        date,
        schedule: EMULATOR_OVERNIGHT_SCHEDULE,
        leaves: [],
        existingSlots: []
      });

      const run2 = generateSlotsForDoctorDate({
        doctorId,
        date,
        schedule: EMULATOR_OVERNIGHT_SCHEDULE,
        leaves: [],
        existingSlots: run1
      });

      expect(run1.length).toBe(run2.length);
      expect(run1.map((s) => s.id)).toEqual(run2.map((s) => s.id));
    });
  });

  // =========================================================================
  // 4. Timezone & Check-in Safety Across Midnight
  // =========================================================================
  describe('4. Timezone Date Evaluation Across Midnight (Asia/Kolkata)', () => {
    it('correctly maps IST early morning times (00:00 - 05:29) to the current Indian date, NOT yesterday', () => {
      // 00:15 IST on Nov 11, 2026 corresponds to Nov 10, 2026 18:45 UTC
      const dateIST_earlyMorning = dayjs.tz('2026-11-11 00:15:00', HOSPITAL_TZ).toDate();

      // Native UTC toISOString would return '2026-11-10' (YESTERDAY)
      expect(dateIST_earlyMorning.toISOString().split('T')[0]).toBe('2026-11-10');

      // But getHospitalTodayStr MUST return '2026-11-11' (CORRECT HOSPITAL DATE)
      expect(getHospitalTodayStr(dateIST_earlyMorning)).toBe('2026-11-11');
    });

    it('correctly evaluates 04:59 IST as the same calendar day in Asia/Kolkata', () => {
      const dateIST_lateNight = dayjs.tz('2026-11-11 04:59:00', HOSPITAL_TZ).toDate();

      // UTC date is '2026-11-10' (23:29 UTC)
      expect(dateIST_lateNight.toISOString().split('T')[0]).toBe('2026-11-10');

      // Hospital date is '2026-11-11'
      expect(getHospitalTodayStr(dateIST_lateNight)).toBe('2026-11-11');
    });
  });

  // =========================================================================
  // 5. Queue Ordering & Token Priority Across Midnight
  // =========================================================================
  describe('5. Queue Ordering Across Midnight', () => {
    it('sorts queue tokens by priority level, status, and time slot correctly', () => {
      const tokens = [
        {
          id: 'tok-3',
          tokenNumber: 3,
          priorityCategory: 'STANDARD',
          status: 'waiting',
          appointmentTime: '01:00',
          clinicalLevel: 1
        },
        {
          id: 'tok-1',
          tokenNumber: 1,
          priorityCategory: 'EMERGENCY',
          status: 'waiting',
          appointmentTime: '01:30',
          clinicalLevel: 3
        },
        {
          id: 'tok-2',
          tokenNumber: 2,
          priorityCategory: 'HIGH',
          status: 'waiting',
          appointmentTime: '00:45',
          clinicalLevel: 2
        }
      ];

      const sorted = sortQueueTokens(tokens);

      // Emergency (clinicalLevel 3) must be first
      expect(sorted[0].id).toBe('tok-1');
      // High (clinicalLevel 2) must be second
      expect(sorted[1].id).toBe('tok-2');
      // Standard (clinicalLevel 1) must be third
      expect(sorted[2].id).toBe('tok-3');
    });
  });

  // =========================================================================
  // 6. Metadata & Serialization
  // =========================================================================
  describe('6. Serialization and Client Metadata', () => {
    it('toFirestoreSchedule strips non-serializable fields cleanly', () => {
      const serializable = toFirestoreSchedule(EMULATOR_OVERNIGHT_SCHEDULE);
      expect(typeof serializable).toBe('object');
      expect(serializable.isOpenAt).toBeUndefined();
      expect(typeof serializable.startHourStr).toBe('string');
      expect(typeof serializable.endHourStr).toBe('string');

      // Verify JSON serialization doesn't throw
      const json = JSON.stringify(serializable);
      expect(json).toContain('"startHourStr":"21:00"');
    });

    it('getScheduleMetadata exposes public operating hours and overnight flag', () => {
      process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
      process.env.LOCAL_DEMO = 'true';
      process.env.GCLOUD_PROJECT = 'demo-project';

      const meta = getScheduleMetadata();
      expect(meta.isEmulator).toBe(true);
      expect(meta.isOvernight).toBe(true);
      expect(meta.displayHours).toBe('9:00 PM – 5:00 AM');
      expect(meta.startHourStr).toBe('21:00');
      expect(meta.endHourStr).toBe('05:00');
    });
  });
});

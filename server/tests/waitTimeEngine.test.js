import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  getExpectedDuration,
  calculateTimeFactor,
  calculateRemainingCurrentTime,
  calculateWaitForPatient,
  calculateLeaveAt,
  selectReasonText,
  roundTo5
} from '../src/domain/waitTime.js';

/**
 * Comprehensive Wait-Time Prediction Engine Tests
 * Covers all PRD requirements for the multi-variable waiting-time engine:
 *
 * 1. Different visit types yield different expected durations
 * 2. Pace factor (timeFactor) clamped to [0.7, 1.6]
 * 3. Wait range is a RANGE (low-high), not a single number
 * 4. Emergency insertion raises waits for patients behind
 * 5. No-show/cancellation reduces waits for patients behind
 * 6. Doctor break adds break minutes to all waiting patients
 * 7. Doctor late start adds delay to all waiting patients
 * 8. Consultation extension raises waits by extension amount
 * 9. Leave Home Now moves when wait changes
 * 10. Reason text reflects actual queue events
 * 11. Range rounds to multiples of 5
 * 12. Per-visitType stats affect range width (CoV)
 * 13. Auto-extension when consultation overruns
 */

describe('Wait-Time Prediction Engine — Full Coverage', () => {
  const nowStr = '2026-10-06T10:00:00Z';

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Visit type duration differentiation
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Visit type expected durations (fallback chain)', () => {
    it('new patient: 15 min default', () => {
      expect(getExpectedDuration({ visitType: 'new' })).toBe(15);
    });

    it('followup: 10 min default', () => {
      expect(getExpectedDuration({ visitType: 'followup' })).toBe(10);
    });

    it('report_review: 5 min default', () => {
      expect(getExpectedDuration({ visitType: 'report_review' })).toBe(5);
    });

    it('emergency: 20 min default', () => {
      expect(getExpectedDuration({ visitType: 'emergency' })).toBe(20);
    });

    it('prefers stats.avgMin when count >= 3', () => {
      const stats = { count: 5, avgMin: 22 };
      expect(getExpectedDuration({ consultationStats: stats, visitType: 'new' })).toBe(22);
    });

    it('falls back to defaults when stats count < 3', () => {
      const stats = { count: 2, avgMin: 22 };
      expect(getExpectedDuration({ consultationStats: stats, visitType: 'followup' })).toBe(10);
    });

    it('department config overrides system defaults when no stats', () => {
      const dept = { defaultDurationsMin: { new: { simple: 10, moderate: 18, complex: 25 } } };
      expect(getExpectedDuration({ department: dept, visitType: 'new', complexity: 'complex' })).toBe(25);
    });

    it('adds extraProcedureMin to base duration', () => {
      const result = getExpectedDuration({ visitType: 'new', extraProcedureMin: 10 });
      expect(result).toBe(25); // 15 + 10
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Pace factor (timeFactor) computation
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Pace factor (timeFactor)', () => {
    it('returns 1.0 with fewer than 3 completed consultations', () => {
      expect(calculateTimeFactor([])).toBe(1.0);
      expect(calculateTimeFactor([{ actualDurationMinutes: 20, expectedDurationMin: 10 }])).toBe(1.0);
    });

    it('computes correct ratio with 3+ consultations', () => {
      // 3 × 20 actual / 3 × 10 expected = 2.0, clamped to 1.6
      const samples = Array(3).fill({ actualDurationMinutes: 20, expectedDurationMin: 10 });
      expect(calculateTimeFactor(samples)).toBe(1.6);
    });

    it('clamps to lower bound 0.7', () => {
      const fast = [
        { actualDurationMinutes: 3, expectedDurationMin: 10 },
        { actualDurationMinutes: 3, expectedDurationMin: 10 },
        { actualDurationMinutes: 4, expectedDurationMin: 10 }
      ];
      expect(calculateTimeFactor(fast)).toBe(0.7);
    });

    it('clamps to upper bound 1.6', () => {
      const slow = Array(5).fill({ actualDurationMinutes: 30, expectedDurationMin: 10 });
      expect(calculateTimeFactor(slow)).toBe(1.6);
    });

    it('pace factor 1.0 means no distortion', () => {
      const normal = [
        { actualDurationMinutes: 15, expectedDurationMin: 15 },
        { actualDurationMinutes: 15, expectedDurationMin: 15 },
        { actualDurationMinutes: 15, expectedDurationMin: 15 }
      ];
      expect(calculateTimeFactor(normal)).toBe(1.0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Wait range is a RANGE, not a single number
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Wait range (low-high)', () => {
    it('returns waitMinLow and waitMinHigh', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        now: nowStr
      });
      expect(result.waitMinLow).toBeDefined();
      expect(result.waitMinHigh).toBeDefined();
      expect(typeof result.waitMinLow).toBe('number');
      expect(typeof result.waitMinHigh).toBe('number');
    });

    it('low < high always', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 17 }],
        remainingCurrentMin: 8,
        now: nowStr
      });
      expect(result.waitMinLow).toBeLessThan(result.waitMinHigh);
    });

    it('both are multiples of 5', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 13 }],
        remainingCurrentMin: 7,
        now: nowStr
      });
      expect(result.waitMinLow % 5).toBe(0);
      expect(result.waitMinHigh % 5).toBe(0);
    });

    it('no patients ahead → wait is approximately remainingCurrentMin only', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [],
        remainingCurrentMin: 8,
        now: nowStr
      });
      // Should be ~5-15 range (rounded to 5s)
      expect(result.waitMinLow).toBeLessThanOrEqual(10);
      expect(result.waitMinHigh).toBeGreaterThanOrEqual(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Emergency insertion raises waits
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Emergency insertion impact', () => {
    it('inserting an emergency patient raises waits by emergency duration', () => {
      const normalAhead = [{ expectedDurationMin: 15 }];
      const emergencyAhead = [{ expectedDurationMin: 20 }, { expectedDurationMin: 15 }];

      const before = calculateWaitForPatient({ aheadCandidates: normalAhead, remainingCurrentMin: 10, now: nowStr });
      const after = calculateWaitForPatient({ aheadCandidates: emergencyAhead, remainingCurrentMin: 10, now: nowStr });

      expect(after.waitMinutes - before.waitMinutes).toBe(20);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. No-show / cancellation reduces waits
  // ═══════════════════════════════════════════════════════════════════════════
  describe('No-show / cancellation reduces waits', () => {
    it('removing a patient from the ahead list lowers wait', () => {
      const two = [{ expectedDurationMin: 15 }, { expectedDurationMin: 15 }];
      const one = [{ expectedDurationMin: 15 }];

      const waitBefore = calculateWaitForPatient({ aheadCandidates: two, remainingCurrentMin: 10, now: nowStr });
      const waitAfter = calculateWaitForPatient({ aheadCandidates: one, remainingCurrentMin: 10, now: nowStr });

      expect(waitBefore.waitMinutes - waitAfter.waitMinutes).toBe(15);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Doctor break adds break minutes
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Doctor break impact', () => {
    it('break adds breakRemainingMin to all waiting patients', () => {
      const noBreak = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        breakRemainingMin: 0,
        now: nowStr
      });
      const withBreak = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        breakRemainingMin: 15,
        now: nowStr
      });

      expect(withBreak.waitMinutes - noBreak.waitMinutes).toBe(15);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Doctor late start adds delay
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Late start impact', () => {
    it('lateStartDelayMin adds to waiting time', () => {
      const noDelay = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        lateStartDelayMin: 0,
        now: nowStr
      });
      const withDelay = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        lateStartDelayMin: 20,
        now: nowStr
      });

      expect(withDelay.waitMinutes - noDelay.waitMinutes).toBe(20);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Consultation extension
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Consultation extension impact', () => {
    it('extending current consultation by 10 min raises later waits by 10', () => {
      const res1 = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        now: nowStr
      });
      const res2 = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 20, // Extended by +10 min
        now: nowStr
      });

      expect(res2.waitMinutes - res1.waitMinutes).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Leave Home Now moves with wait changes
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Leave Home Now calculation', () => {
    it('leaveAt moves later when predictedCallAt moves later', () => {
      const earlyCall = '2026-10-06T10:30:00Z';
      const lateCall = '2026-10-06T10:50:00Z';

      const leaveEarly = calculateLeaveAt({ predictedCallAt: earlyCall, travelMinutes: 15 });
      const leaveLate = calculateLeaveAt({ predictedCallAt: lateCall, travelMinutes: 15 });

      const diffMs = new Date(leaveLate).getTime() - new Date(leaveEarly).getTime();
      expect(diffMs).toBe(20 * 60 * 1000);
    });

    it('leaveAt accounts for travel time + 10 min buffer', () => {
      const callAt = '2026-10-06T11:00:00Z';
      const leaveAt = calculateLeaveAt({ predictedCallAt: callAt, travelMinutes: 20 });

      // PRD: leaveAt = predictedCallAt - 10 min checkinBuffer - 20 travelMinutes - 5 safetyBuffer = 35 min
      const leaveDate = new Date(leaveAt);
      const callDate = new Date(callAt);
      const diffMin = (callDate.getTime() - leaveDate.getTime()) / (60 * 1000);
      expect(diffMin).toBe(35); // 20 travel + 10 buffer + 5 safety buffer
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Reason text reflects queue events
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Reason text selection', () => {
    it('emergency flag returns emergency reason', () => {
      const text = selectReasonText({ hasEmergencyAdded: true });
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toContain('emergency');
    });

    it('doctor break returns break reason', () => {
      const text = selectReasonText({ hasDoctorBreak: true });
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toContain('break');
    });

    it('late start returns delay reason', () => {
      const text = selectReasonText({ hasLateStart: true });
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toContain('late');
    });

    it('fast consultations return ahead-of-schedule reason', () => {
      const text = selectReasonText({ consultationsRunningShort: true });
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/fast|ahead|early|quick/);
    });

    it('slow consultations return running-long reason', () => {
      const text = selectReasonText({ consultationsRunningLong: true });
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).toMatch(/long|slow|behind|delay/);
    });

    it('no flags returns null or empty or on-schedule message', () => {
      const text = selectReasonText({});
      // null, undefined, empty string, or "Queue is proceeding on schedule." are valid
      expect(!text || text === '' || text.toLowerCase().includes('schedule')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. roundTo5 utility
  // ═══════════════════════════════════════════════════════════════════════════
  describe('roundTo5 utility', () => {
    it('rounds down small numbers to nearest 5', () => {
      expect(roundTo5(7)).toBe(5);
      expect(roundTo5(12)).toBe(10);
    });

    it('rounds up when closer', () => {
      expect(roundTo5(13)).toBe(15);
      expect(roundTo5(18)).toBe(20);
    });

    it('exact multiples stay unchanged', () => {
      expect(roundTo5(15)).toBe(15);
      expect(roundTo5(0)).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. Per-visitType stats affect range width
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Stats-based range width (CoV)', () => {
    it('high variability stats produce wider ranges', () => {
      const narrowStats = { count: 10, avgMin: 15, stdMin: 2 };
      const wideStats = { count: 10, avgMin: 15, stdMin: 8 };

      const narrow = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        stats: narrowStats,
        now: nowStr
      });
      const wide = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        stats: wideStats,
        now: nowStr
      });

      const narrowWidth = narrow.waitMinHigh - narrow.waitMinLow;
      const wideWidth = wide.waitMinHigh - wide.waitMinLow;

      // Wide stats should produce equal or wider range
      expect(wideWidth).toBeGreaterThanOrEqual(narrowWidth);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Auto-extension when consultation overruns expected time
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Auto-extension on overrun', () => {
    it('remaining time stays positive when elapsed > expected', () => {
      const consult = {
        consultStartAt: '2026-10-06T09:40:00Z', // 20 min ago
        expectedDurationMin: 15 // Expected 15 min, but 20 have passed
      };
      const rem = calculateRemainingCurrentTime(consult, nowStr);
      expect(rem).toBeGreaterThan(0);
    });

    it('auto-extends in 5-minute steps', () => {
      const consult = {
        consultStartAt: '2026-10-06T09:30:00Z', // 30 min ago
        expectedDurationMin: 15 // Expected 15 min, but 30 have passed
      };
      const rem = calculateRemainingCurrentTime(consult, nowStr);
      // Should have auto-extended to 35 min (ceiling to next 5-min step)
      // Remaining = 35 - 30 = 5
      expect(rem).toBeGreaterThan(0);
      expect(rem).toBeLessThanOrEqual(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. predictedCallAt is an ISO string in the future
  // ═══════════════════════════════════════════════════════════════════════════
  describe('predictedCallAt correctness', () => {
    it('returns an ISO string', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        now: nowStr
      });
      expect(result.predictedCallAt).toBeTruthy();
      const parsed = new Date(result.predictedCallAt);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    it('predictedCallAt is after now', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 15 }],
        remainingCurrentMin: 10,
        now: nowStr
      });
      const callAt = new Date(result.predictedCallAt).getTime();
      const nowMs = new Date(nowStr).getTime();
      expect(callAt).toBeGreaterThan(nowMs);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. Compound scenario: break + emergency + late start
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Compound scenario', () => {
    it('break + late start + 2 patients ahead gives correct total', () => {
      const result = calculateWaitForPatient({
        aheadCandidates: [
          { expectedDurationMin: 15 },
          { expectedDurationMin: 10 }
        ],
        remainingCurrentMin: 5,
        breakRemainingMin: 10,
        lateStartDelayMin: 5,
        now: nowStr
      });

      // Total = 5 (current) + 15 + 10 (ahead) + 10 (break) + 5 (late) = 45 min
      expect(result.waitMinutes).toBe(45);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. timeFactor multiplier applies to ahead durations
  // ═══════════════════════════════════════════════════════════════════════════
  describe('timeFactor multiplier', () => {
    it('timeFactor > 1 increases total wait proportionally', () => {
      const base = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 20 }],
        remainingCurrentMin: 0,
        timeFactor: 1.0,
        now: nowStr
      });
      const slow = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 20 }],
        remainingCurrentMin: 0,
        timeFactor: 1.5,
        now: nowStr
      });

      expect(slow.waitMinutes).toBeGreaterThan(base.waitMinutes);
    });

    it('timeFactor < 1 decreases total wait proportionally', () => {
      const base = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 20 }],
        remainingCurrentMin: 0,
        timeFactor: 1.0,
        now: nowStr
      });
      const fast = calculateWaitForPatient({
        aheadCandidates: [{ expectedDurationMin: 20 }],
        remainingCurrentMin: 0,
        timeFactor: 0.8,
        now: nowStr
      });

      expect(fast.waitMinutes).toBeLessThan(base.waitMinutes);
    });
  });
});

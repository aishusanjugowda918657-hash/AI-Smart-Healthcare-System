import { describe, it, expect } from 'vitest';
import {
  getExpectedDuration,
  calculateTimeFactor,
  calculateRemainingCurrentTime,
  calculateWaitForPatient,
  calculateLeaveAt,
  roundTo5
} from '../src/domain/waitTime.js';

describe('PRD F7: Real-Time Waiting-Time Engine Domain Tests (domain/waitTime.js)', () => {
  const nowStr = '2026-10-02T10:00:00Z';

  it('timeFactor is 1.0 with fewer than 3 samples and clamped to 0.7 to 1.6', () => {
    // 2 samples -> returns 1.0
    expect(calculateTimeFactor([{ actualDurationMinutes: 20, expectedDurationMin: 10 }])).toBe(1.0);

    // 3 samples: 60 actual / 30 expected = 2.0 -> clamped to 1.6
    const fastDocs = [
      { actualDurationMinutes: 20, expectedDurationMin: 10 },
      { actualDurationMinutes: 20, expectedDurationMin: 10 },
      { actualDurationMinutes: 20, expectedDurationMin: 10 }
    ];
    expect(calculateTimeFactor(fastDocs)).toBe(1.6);

    // 3 samples: 10 actual / 30 expected = 0.33 -> clamped to 0.7
    const slowDocs = [
      { actualDurationMinutes: 3, expectedDurationMin: 10 },
      { actualDurationMinutes: 3, expectedDurationMin: 10 },
      { actualDurationMinutes: 4, expectedDurationMin: 10 }
    ];
    expect(calculateTimeFactor(slowDocs)).toBe(0.7);
  });

  it('Expected duration fallback chain operates from stats -> department -> defaults', () => {
    const stats = { count: 5, avgMin: 22 };
    const dept = {
      defaultDurationsMin: {
        new: { simple: 10, moderate: 18, complex: 25 }
      }
    };

    // 1. Stats match
    expect(getExpectedDuration({ consultationStats: stats, department: dept, visitType: 'new', complexity: 'simple' })).toBe(22);

    // 2. Department fallback when stats count < 3
    expect(getExpectedDuration({ consultationStats: { count: 2, avgMin: 22 }, department: dept, visitType: 'new', complexity: 'complex' })).toBe(25);

    // 3. System defaults when dept is null
    expect(getExpectedDuration({ visitType: 'followup' })).toBe(10);
    expect(getExpectedDuration({ visitType: 'report_review' })).toBe(5);
  });

  it('Extending current consultation by 10 minutes raises later patient wait by about 10 minutes', () => {
    const ahead = [{ expectedDurationMin: 15 }];
    const current1 = 10;
    const current2 = 20; // Extended by +10 min

    const res1 = calculateWaitForPatient({ aheadCandidates: ahead, remainingCurrentMin: current1, now: nowStr });
    const res2 = calculateWaitForPatient({ aheadCandidates: ahead, remainingCurrentMin: current2, now: nowStr });

    expect(res2.waitMinutes - res1.waitMinutes).toBe(10);
  });

  it('Emergency insertion raises later waits by the emergency expected duration', () => {
    const normalAhead = [{ expectedDurationMin: 15 }];
    const emergencyAhead = [{ expectedDurationMin: 20 }, { expectedDurationMin: 15 }];

    const beforeEmerg = calculateWaitForPatient({ aheadCandidates: normalAhead, remainingCurrentMin: 10, now: nowStr });
    const afterEmerg = calculateWaitForPatient({ aheadCandidates: emergencyAhead, remainingCurrentMin: 10, now: nowStr });

    expect(afterEmerg.waitMinutes - beforeEmerg.waitMinutes).toBe(20);
  });

  it('A no-show or cancellation lowers later waits', () => {
    const initialAhead = [{ expectedDurationMin: 15 }, { expectedDurationMin: 15 }];
    const reducedAhead = [{ expectedDurationMin: 15 }];

    const waitBefore = calculateWaitForPatient({ aheadCandidates: initialAhead, remainingCurrentMin: 10, now: nowStr });
    const waitAfter = calculateWaitForPatient({ aheadCandidates: reducedAhead, remainingCurrentMin: 10, now: nowStr });

    expect(waitBefore.waitMinutes - waitAfter.waitMinutes).toBe(15);
  });

  it('The wait range is rounded to multiples of 5 and low < high', () => {
    const res = calculateWaitForPatient({ aheadCandidates: [{ expectedDurationMin: 17 }], remainingCurrentMin: 8, now: nowStr });

    expect(res.waitMinLow % 5).toBe(0);
    expect(res.waitMinHigh % 5).toBe(0);
    expect(res.waitMinLow).toBeLessThan(res.waitMinHigh);
  });

  it('leaveAt moves later when delays grow and earlier when queue speeds up', () => {
    const callEarly = '2026-10-02T10:30:00Z';
    const callLate = '2026-10-02T10:50:00Z';

    const leaveEarly = calculateLeaveAt({ predictedCallAt: callEarly, travelMinutes: 15 });
    const leaveLate = calculateLeaveAt({ predictedCallAt: callLate, travelMinutes: 15 });

    const diffMs = new Date(leaveLate).getTime() - new Date(leaveEarly).getTime();
    expect(diffMs).toBe(20 * 60 * 1000); // 20 minutes shift
  });

  it('calculateRemainingCurrentTime auto-extends in 5 min steps when elapsed exceeds expected', () => {
    const consult = {
      consultStartAt: '2026-10-02T09:40:00Z', // Started 20 min ago
      expectedDurationMin: 15
    };
    // 20 min elapsed > 15 expected -> over by 5 min -> target is 20 min -> remaining is 5 min step
    const rem = calculateRemainingCurrentTime(consult, nowStr);
    expect(rem).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import { calculateWaitingTime } from '../src/services/waitingTimeCalculator.js';

describe('Phase 7 - Enhanced Multi-Variable Waiting-Time Calculator Unit Tests', () => {
  it('calculates waiting time accurately with current patient remaining + ahead patients', () => {
    const calledAt = new Date(Date.now() - 5 * 60000);
    const currentServingToken = { calledAt };

    const patientsAheadTokens = [
      { id: 't1' },
      { id: 't2' }
    ];

    const result = calculateWaitingTime({
      currentServingToken,
      patientsAheadTokens,
      avgConsultationTimeMinutes: 15,
      breakTimes: [],
      nowDate: new Date()
    });

    expect(result.patientsAhead).toEqual(2);
    expect(result.estimatedWaitMinutes).toEqual(40);
  });

  it('adds break duration if wait window spans doctor break time', () => {
    // Current time: 12:30 PM local time
    const nowDate = new Date(2026, 8, 21, 12, 30, 0);
    
    // 2 patients ahead = 30 mins -> turn reaches 13:00 PM
    const patientsAheadTokens = [{ id: 't1' }, { id: 't2' }];

    // Doctor break 13:00 to 14:00 (60 mins)
    const breakTimes = [{ start: '13:00', end: '14:00' }];

    const result = calculateWaitingTime({
      currentServingToken: null,
      patientsAheadTokens,
      avgConsultationTimeMinutes: 15,
      breakTimes,
      nowDate
    });

    // 30 mins patients + 60 mins break = 90 mins total
    expect(result.estimatedWaitMinutes).toEqual(90);
    expect(result.breakTimeAddedMinutes).toEqual(60);
  });
});

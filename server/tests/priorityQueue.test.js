import { describe, it, expect } from 'vitest';
import { calculatePriorityScore, sortQueueTokens } from '../src/services/tokenPriorityEngine.js';

describe('Phase 6 - Rule-Based Priority Token Engine Unit Tests', () => {
  it('grants EMERGENCY score 300 only when staff verified', () => {
    const unverifiedScore = calculatePriorityScore('EMERGENCY', false);
    const verifiedScore = calculatePriorityScore('EMERGENCY', true);

    expect(unverifiedScore).toEqual(100); // Fallback to standard
    expect(verifiedScore).toEqual(300); // Granted emergency score
  });

  it('grants SENIOR score 200 without requiring staff verification', () => {
    const score = calculatePriorityScore('SENIOR', false);
    expect(score).toEqual(200);
  });

  it('sorts queue primary by priority score and secondary by sequence number', () => {
    const rawTokens = [
      { id: 't1', tokenNumber: 'T-001', priorityScore: 100, sequenceNumber: 1 }, // Standard 1st
      { id: 't2', tokenNumber: 'T-002', priorityScore: 200, sequenceNumber: 2 }, // Senior 2nd
      { id: 't3', tokenNumber: 'T-003', priorityScore: 300, sequenceNumber: 3 }, // Emergency 3rd
      { id: 't4', tokenNumber: 'T-004', priorityScore: 100, sequenceNumber: 4 }  // Standard 4th
    ];

    const sorted = sortQueueTokens(rawTokens);

    expect(sorted[0].id).toEqual('t3'); // Emergency first
    expect(sorted[1].id).toEqual('t2'); // Senior second
    expect(sorted[2].id).toEqual('t1'); // Standard (seq 1) third
    expect(sorted[3].id).toEqual('t4'); // Standard (seq 4) fourth
  });
});

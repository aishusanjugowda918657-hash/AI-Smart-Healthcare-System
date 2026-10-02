import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, ALL_STATUSES, ALLOWED_TRANSITIONS, normalizeStatus } from '../src/domain/status.js';

describe('PRD F5: domain/status.js - State Transition Matrix', () => {
  it('normalizes uppercase and status aliases correctly', () => {
    expect(normalizeStatus('BOOKED')).toBe('booked');
    expect(normalizeStatus('IN_CONSULTATION')).toBe('in_room');
    expect(normalizeStatus('in_room')).toBe('in_room');
  });

  it('allows idempotent transition to the same status', () => {
    ALL_STATUSES.forEach(status => {
      expect(canTransition(status, status)).toBe(true);
      expect(() => assertTransition(status, status)).not.toThrow();
    });
  });

  // Table-driven test of ALL status pairs
  describe('Table-driven transition verification across all pairs', () => {
    const distinctStatuses = Array.from(new Set(ALL_STATUSES.map(normalizeStatus)));

    distinctStatuses.forEach(from => {
      distinctStatuses.forEach(to => {
        const isAllowedInMap = (ALLOWED_TRANSITIONS[from] || []).includes(to);
        const expectedResult = (from === to) || isAllowedInMap;

        it(`Transition '${from}' -> '${to}' should return ${expectedResult}`, () => {
          expect(canTransition(from, to)).toBe(expectedResult);

          if (expectedResult) {
            expect(() => assertTransition(from, to)).not.toThrow();
          } else {
            expect(() => assertTransition(from, to)).toThrow(/Invalid status transition/);
          }
        });
      });
    });
  });

  it('handles case-insensitivity in canTransition and assertTransition', () => {
    expect(canTransition('BOOKED', 'CONFIRMED')).toBe(true);
    expect(canTransition('booked', 'confirmed')).toBe(true);
    expect(canTransition('COMPLETED', 'BOOKED')).toBe(false);

    expect(() => assertTransition('BOOKED', 'CONFIRMED')).not.toThrow();
    expect(() => assertTransition('COMPLETED', 'BOOKED')).toThrow();
  });
});

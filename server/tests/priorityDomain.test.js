import { describe, it, expect } from 'vitest';
import { compareForCalling, effectiveLevel, getReadyCandidates } from '../src/domain/priority.js';
import { ClinicalLevel } from '../src/domain/constants.js';

describe('PRD F6: Calling Order & Priority Domain Tests (domain/priority.js)', () => {
  const now = new Date('2026-10-02T10:00:00Z');

  it('Emergency verified (level 3) is called before everything', () => {
    const routine = { id: '1', clinicalLevel: ClinicalLevel.ROUTINE, bookedStartAt: '2026-10-02T09:45:00Z', checkedInAt: '2026-10-02T09:40:00Z', tags: ['senior'], status: 'checked_in' };
    const urgent = { id: '2', clinicalLevel: ClinicalLevel.URGENT, bookedStartAt: '2026-10-02T09:10:00Z', checkedInAt: '2026-10-02T09:00:00Z', tags: [], status: 'checked_in' };
    const emergency = { id: '3', clinicalLevel: ClinicalLevel.EMERGENCY, bookedStartAt: '2026-10-02T09:50:00Z', checkedInAt: '2026-10-02T09:55:00Z', tags: [], status: 'checked_in' };

    const candidates = [routine, urgent, emergency];
    const sorted = getReadyCandidates(candidates, now);

    expect(sorted[0].id).toBe('3');
    expect(sorted[1].id).toBe('2');
    expect(sorted[2].id).toBe('1');
  });

  it('Three routine patients are called in booked-time order even if one has a vulnerability tag', () => {
    const p1 = { id: 'r1', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:40:00Z', checkedInAt: '2026-10-02T09:35:00Z', tags: [], status: 'checked_in' };
    const p2 = { id: 'r2', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:50:00Z', checkedInAt: '2026-10-02T09:45:00Z', tags: ['senior'], status: 'checked_in' };
    const p3 = { id: 'r3', clinicalLevel: 1, bookedStartAt: '2026-10-02T10:00:00Z', checkedInAt: '2026-10-02T09:55:00Z', tags: [], status: 'checked_in' };

    const sorted = getReadyCandidates([p3, p2, p1], now);

    expect(sorted.map(p => p.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('A senior and a non-senior booked in the same slot window: senior first', () => {
    const nonSenior = { id: 'p-reg', clinicalLevel: 1, bookedStartAt: '2026-10-02T10:00:00Z', checkedInAt: '2026-10-02T09:50:00Z', tags: [], status: 'checked_in' };
    const senior = { id: 'p-snr', clinicalLevel: 1, bookedStartAt: '2026-10-02T10:00:00Z', checkedInAt: '2026-10-02T09:52:00Z', tags: ['senior'], status: 'checked_in' };

    const sorted = getReadyCandidates([nonSenior, senior], now);

    expect(sorted[0].id).toBe('p-snr');
    expect(sorted[1].id).toBe('p-reg');
  });

  it('A routine patient delayed 30 minutes ranks as urgent (fairness bump)', () => {
    // Booked at 09:20, now is 10:00 -> 40 minutes late -> bumped to urgent (level 2)
    const delayedRoutine = { id: 'delayed', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:20:00Z', checkedInAt: '2026-10-02T09:15:00Z', tags: [], status: 'checked_in' };
    // Normal routine booked at 10:00
    const normalRoutine = { id: 'normal', clinicalLevel: 1, bookedStartAt: '2026-10-02T10:00:00Z', checkedInAt: '2026-10-02T09:55:00Z', tags: [], status: 'checked_in' };

    expect(effectiveLevel(delayedRoutine, now)).toBe(ClinicalLevel.URGENT); // 2
    expect(effectiveLevel(normalRoutine, now)).toBe(ClinicalLevel.ROUTINE); // 1

    const sorted = getReadyCandidates([normalRoutine, delayedRoutine], now);
    expect(sorted[0].id).toBe('delayed');
  });

  it('An urgent patient does not skip a routine patient delayed 30 minutes (booked time decides)', () => {
    // Routine patient booked at 09:15 (45 min late -> effective level 2)
    const delayedRoutine = { id: 'del-routine', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:15:00Z', checkedInAt: '2026-10-02T09:10:00Z', tags: [], status: 'checked_in' };
    // Urgent patient booked at 09:40 (20 min late -> level 2)
    const urgentPatient = { id: 'urgent-p', clinicalLevel: 2, bookedStartAt: '2026-10-02T09:40:00Z', checkedInAt: '2026-10-02T09:35:00Z', tags: [], status: 'checked_in' };

    // Both have effective level 2, so earlier booked time (09:15) wins
    const sorted = getReadyCandidates([urgentPatient, delayedRoutine], now);
    expect(sorted[0].id).toBe('del-routine');
    expect(sorted[1].id).toBe('urgent-p');
  });

  it('Patients who are not checked in are excluded from ready candidates', () => {
    const bookedOnly = { id: 'b1', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:00:00Z', status: 'booked' };
    const confirmedOnly = { id: 'c1', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:10:00Z', status: 'confirmed' };
    const checkedIn = { id: 'chk1', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:20:00Z', checkedInAt: '2026-10-02T09:15:00Z', status: 'checked_in' };
    const rejoined = { id: 'rej1', clinicalLevel: 1, bookedStartAt: '2026-10-02T09:30:00Z', checkedInAt: '2026-10-02T09:25:00Z', status: 'rejoined' };

    const candidates = [bookedOnly, confirmedOnly, checkedIn, rejoined];
    const ready = getReadyCandidates(candidates, now);

    expect(ready.length).toBe(2);
    expect(ready.map(p => p.id)).toEqual(['chk1', 'rej1']);
  });
});

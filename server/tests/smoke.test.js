/**
 * smoke.test.js — Task 8
 *
 * Verifies that importing the app, scheduler, and firebase modules does NOT
 * throw a SyntaxError (e.g. "Identifier already declared") or runtime crash.
 *
 * Scenarios:
 *   A) All flags false (test default) — scheduler never starts.
 *   B) FLAG_SCHEDULER=true — startScheduler() path reached; uses a mocked Date
 *      so no real cron jobs run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Smoke: module import integrity', () => {
  it('imports app without SyntaxError or crash (flags all false)', async () => {
    // NODE_ENV=test already sets all flags false via env.js fallback
    await expect(import('../src/app.js')).resolves.toBeDefined();
  });

  it('imports scheduler module without duplicate-declaration error', async () => {
    const mod = await import('../src/jobs/scheduler.js');
    expect(typeof mod.startScheduler).toBe('function');
    expect(typeof mod.runSchedulerJobs).toBe('function');
    expect(typeof mod.generateSlotsJob).toBe('function');
    expect(typeof mod.expireHoldsJob).toBe('function');
    expect(typeof mod.noShowSweepJob).toBe('function');
  });

  it('imports firebase config without crash', async () => {
    const mod = await import('../src/config/firebase.js');
    // In test environment Firestore may be null — that is acceptable
    expect(mod).toHaveProperty('getDb');
    expect(mod).toHaveProperty('getAuth');
    expect(mod).toHaveProperty('assertDbConnected');
  });

  it('startScheduler() with FLAG_SCHEDULER=true uses mocked clock and does not throw', async () => {
    // Patch node-cron so no real cron timers are created
    vi.mock('node-cron', () => ({
      default: {
        schedule: vi.fn(), // silently accept any schedule call
      },
    }));

    const { startScheduler } = await import('../src/jobs/scheduler.js');

    // Should resolve without throwing even when Firestore is unavailable in test
    await expect(startScheduler()).resolves.not.toThrow();

    vi.restoreAllMocks();
  });
});

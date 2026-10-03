import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setupEnv.js'],
    testTimeout: 30000,
    environment: 'node',

    // ── Parallelism ────────────────────────────────────────────────
    // All integration tests share a single Firestore emulator instance.
    // Sweep jobs (noShowSweep, releaseCancelledSlots, processReminders)
    // query ALL documents across the emulator — running test files in
    // parallel causes cross-contamination (one file's sweep mutates data
    // seeded by another file).  Sequential file execution eliminates this.
    fileParallelism: false,

    // Force ALL Firestore operations to the local emulator.
    // These are injected before any test file or module is loaded,
    // so firebase-admin picks them up at init time.
    env: {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      GCLOUD_PROJECT: 'demo-project',
      VITE_FIREBASE_PROJECT_ID: 'demo-project',
      FLAG_PUSH: 'false',
      FLAG_AI: 'false',
      FLAG_SCHEDULER: 'false',
      INTERNAL_TICK_SECRET: 'dev_tick_secret',
    },
  },
});

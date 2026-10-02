import { defineConfig } from 'vitest/config';

// Enforce Firebase Emulator host ports for all test execution runs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setupEnv.js'],
    testTimeout: 15000,
    environment: 'node',
  },
});

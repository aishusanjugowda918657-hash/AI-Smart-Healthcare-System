import { defineConfig } from 'vitest/config';

// Ensure Firebase test project ID is set for isolated offline test runs
process.env.VITE_FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'demo-project';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setupEnv.js'],
    testTimeout: 15000,
    environment: 'node',
  },
});

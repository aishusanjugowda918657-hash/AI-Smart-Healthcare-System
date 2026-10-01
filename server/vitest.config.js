import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Raise global timeout to 15s to accommodate real Firebase/Gemini network calls
    testTimeout: 15000,
    environment: 'node',
  },
});

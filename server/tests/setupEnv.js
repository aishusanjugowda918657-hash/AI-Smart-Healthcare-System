import { beforeAll } from 'vitest';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      'FATAL: Firebase Emulator environment variables (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST) are missing! Tests must only execute against local Firebase Emulators, never against real production Firebase projects.'
    );
  }
});

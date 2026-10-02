import { beforeAll } from 'vitest';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.VITE_FIREBASE_PROJECT_ID) {
    throw new Error(
      'FATAL: Firebase test environment configuration is missing! Tests must execute against demo-project or Firebase Emulators.'
    );
  }
});

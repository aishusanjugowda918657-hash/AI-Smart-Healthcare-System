import { beforeAll } from 'vitest';

beforeAll(() => {
  // CRITICAL: Tests MUST run against the Firebase emulator, never the real project.
  // vitest.config.js injects FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 via env{}.
  // If that variable is missing here, something in the toolchain overrode it.
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      '\n\n' +
      '╔══════════════════════════════════════════════════════════════╗\n' +
      '║  FATAL: FIRESTORE_EMULATOR_HOST is not set.                 ║\n' +
      '║  Tests must run against the Firebase local emulator,        ║\n' +
      '║  not the real project — this prevents quota exhaustion.     ║\n' +
      '║                                                             ║\n' +
      '║  Start the emulator first:                                  ║\n' +
      '║    firebase emulators:start --only firestore,auth           ║\n' +
      '║  Then run tests:                                            ║\n' +
      '║    npm test --prefix server                                 ║\n' +
      '╚══════════════════════════════════════════════════════════════╝\n'
    );
  }

  // Confirm which project/host is in use so failures are easy to diagnose.
  console.log(
    `[setupEnv] ✅ Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}` +
    ` | project: ${process.env.VITE_FIREBASE_PROJECT_ID || 'demo-project'}`
  );
});

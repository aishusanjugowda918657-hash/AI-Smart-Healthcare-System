import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateStagingPreflight } from '../src/config/stagingPreflight.js';

describe('Staging Preflight Verification Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails preflight when running against local emulators', () => {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_STAGING_PROJECT_ID = 'my-staging-project';

    const result = validateStagingPreflight({ exitOnError: false });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes('FIRESTORE_EMULATOR_HOST'))).toBe(true);
  });

  it('fails preflight when project ID is demo-project or missing', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_STAGING_PROJECT_ID = 'demo-project';

    const result = validateStagingPreflight({ exitOnError: false });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes('demo-project'))).toBe(true);
  });

  it('fails preflight when insecure default secrets are used', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_STAGING_PROJECT_ID = 'smartcare-staging-2026';
    process.env.INTERNAL_TICK_SECRET = 'dev_tick_secret';
    process.env.ACTION_TOKEN_SECRET = 'dev_action_secret';

    const result = validateStagingPreflight({ exitOnError: false });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes('INTERNAL_TICK_SECRET'))).toBe(true);
    expect(result.issues.some((i) => i.includes('ACTION_TOKEN_SECRET'))).toBe(true);
  });

  it('passes preflight when all staging requirements are securely configured', () => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    process.env.FIREBASE_STAGING_PROJECT_ID = 'smartcare-staging-2026';
    process.env.EXPECTED_STAGING_PROJECT_ID = 'smartcare-staging-2026';
    process.env.FIREBASE_CLIENT_EMAIL = 'staging-admin@smartcare-staging-2026.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD...\n-----END PRIVATE KEY-----';
    process.env.FIREBASE_STORAGE_BUCKET = 'smartcare-staging-2026.appspot.com';
    process.env.INTERNAL_TICK_SECRET = 'stg_tick_sec_78fa892b491c3d987e';
    process.env.ACTION_TOKEN_SECRET = 'stg_act_sec_890cbf3214da9832e1';
    process.env.GEMINI_API_KEY = 'AIzaSyStagingRealKeyWithSufficientLength12345';
    process.env.CLIENT_ORIGIN = 'https://staging.smartcare.example.com';
    process.env.FLAG_AI = 'true';

    const result = validateStagingPreflight({ exitOnError: false });
    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);
  });
});

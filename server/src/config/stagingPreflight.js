import fs from 'fs';
import path from 'path';

/**
 * Staging Preflight Verification Module
 *
 * Validates that staging environment has all required credentials,
 * enforces isolation from emulator and production projects,
 * and ensures no insecure defaults are used.
 *
 * NEVER prints secret values, API keys, or private key contents.
 */
export function validateStagingPreflight(options = { exitOnError: true }) {
  const issues = [];
  const checks = [];

  const addCheck = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    if (!passed) {
      issues.push(`[FAILED] ${name}: ${detail}`);
    }
  };

  // 1. Emulator Isolation Check
  const hasEmulatorHost = !!process.env.FIRESTORE_EMULATOR_HOST || !!process.env.FIREBASE_AUTH_EMULATOR_HOST;
  addCheck(
    'Emulator Host Isolation',
    !hasEmulatorHost,
    hasEmulatorHost
      ? 'FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST is set. Staging mode must not point to local emulators.'
      : 'No emulator hosts detected in environment.'
  );

  // 2. Project ID Identification & Protection
  const projectId =
    process.env.FIREBASE_STAGING_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT;

  const isDemoProject = !projectId || projectId === 'demo-project';
  addCheck(
    'Project ID Validation',
    !isDemoProject,
    isDemoProject
      ? 'Target project ID is unset or set to "demo-project". A dedicated staging Firebase project ID is required.'
      : `Target project identified (${projectId.length} chars).`
  );

  const expectedStagingId = process.env.EXPECTED_STAGING_PROJECT_ID;
  if (expectedStagingId) {
    const matchesExpected = projectId === expectedStagingId;
    addCheck(
      'Target Project Verification',
      matchesExpected,
      matchesExpected
        ? 'Project ID strictly matches EXPECTED_STAGING_PROJECT_ID.'
        : `Project ID does not match expected staging project ID (${expectedStagingId}).`
    );
  }

  // 3. Service Account Credentials Check
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const hasIndividualCreds = !!process.env.FIREBASE_CLIENT_EMAIL && !!process.env.FIREBASE_PRIVATE_KEY;

  let credentialsValid = false;
  let credentialDetail = '';

  if (serviceAccountPath) {
    const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
    if (!fs.existsSync(resolvedPath)) {
      credentialDetail = `Service account file not found at path: ${serviceAccountPath}`;
    } else {
      try {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.type === 'service_account' && parsed.project_id && parsed.private_key) {
          credentialsValid = true;
          credentialDetail = `Valid service account file found (${parsed.project_id}).`;
        } else {
          credentialDetail = 'Service account file is missing required fields (type, project_id, or private_key).';
        }
      } catch (err) {
        credentialDetail = `Service account file is not valid JSON: ${err.message}`;
      }
    }
  } else if (hasIndividualCreds) {
    const hasPrivateKeyHeader = process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') ||
      process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY');
    if (hasPrivateKeyHeader) {
      credentialsValid = true;
      credentialDetail = 'Service account provided via FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.';
    } else {
      credentialDetail = 'FIREBASE_PRIVATE_KEY does not contain valid PEM key headers.';
    }
  } else {
    credentialDetail = 'Neither FIREBASE_SERVICE_ACCOUNT_PATH nor (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) is provided.';
  }

  addCheck('Firebase Admin Credentials', credentialsValid, credentialDetail);

  // 4. Cloud Storage Bucket Check
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET;
  const bucketValid = !!storageBucket && !storageBucket.includes('demo') && (storageBucket.includes('.appspot.com') || storageBucket.includes('.firebasestorage.app'));
  addCheck(
    'Cloud Storage Bucket',
    bucketValid,
    bucketValid
      ? `Configured (${storageBucket.split('.')[0]}.***).`
      : 'FIREBASE_STORAGE_BUCKET is missing, uses demo values, or is not an official Firebase bucket domain (*.appspot.com or *.firebasestorage.app).'
  );

  // 5. Shared Secrets & Token Insecurity Check
  const tickSecret = process.env.INTERNAL_TICK_SECRET;
  const isDefaultTickSecret = !tickSecret || ['dev_tick_secret', 'change_me_in_production', 'default'].includes(tickSecret);
  addCheck(
    'Internal Tick Secret',
    !isDefaultTickSecret,
    isDefaultTickSecret
      ? 'INTERNAL_TICK_SECRET is missing or using default development placeholder. Generate a strong unique secret.'
      : 'Secure internal tick secret configured.'
  );

  const actionSecret = process.env.ACTION_TOKEN_SECRET;
  const isDefaultActionSecret = !actionSecret || ['dev_action_secret', 'change_me_in_production', 'default'].includes(actionSecret);
  addCheck(
    'Action Token Secret (HMAC)',
    !isDefaultActionSecret,
    isDefaultActionSecret
      ? 'ACTION_TOKEN_SECRET is missing or using default development placeholder. Generate a strong unique secret.'
      : 'Secure action token secret configured.'
  );

  // 6. AI Engine Configuration Check
  const flagAi = process.env.FLAG_AI !== 'false';
  if (flagAi) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const isGeminiKeyValid = !!geminiKey && !geminiKey.includes('demo') && !geminiKey.includes('placeholder') && geminiKey.length > 20;
    addCheck(
      'Gemini AI API Key',
      isGeminiKeyValid,
      isGeminiKeyValid
        ? 'Gemini API key configured with valid length.'
        : 'FLAG_AI is enabled but GEMINI_API_KEY is missing, placeholder, or invalid.'
    );
  }

  // 7. CORS Security Check
  const clientOrigin = process.env.CLIENT_ORIGIN;
  const isOriginSafe = !!clientOrigin && !clientOrigin.includes('*');
  addCheck(
    'CORS Client Origin',
    isOriginSafe,
    isOriginSafe
      ? 'CLIENT_ORIGIN whitelist configured without wildcards.'
      : 'CLIENT_ORIGIN is missing or contains dangerous wildcard (*).'
  );

  const passed = issues.length === 0;

  console.log('\n========================================================');
  console.log('       STAGING ENVIRONMENT PREFLIGHT VERIFICATION       ');
  console.log('========================================================');
  checks.forEach((c) => {
    const symbol = c.passed ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`${symbol} ${c.name}: ${c.detail}`);
  });
  console.log('--------------------------------------------------------');

  if (passed) {
    console.log('✨ PREFLIGHT RESULT: STAGING CHECKS PASSED');
    console.log('========================================================\n');
  } else {
    console.error(`🚨 PREFLIGHT RESULT: ${issues.length} ISSUE(S) DETECTED`);
    issues.forEach((iss) => console.error(`   ${iss}`));
    console.error('========================================================\n');

    if (options.exitOnError) {
      console.error('⛔ Refusing to start in staging mode due to preflight errors.\n');
      process.exit(1);
    }
  }

  return { passed, checks, issues };
}

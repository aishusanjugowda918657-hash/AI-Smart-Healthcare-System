/**
 * Stage 0: Preflight
 * Checks:
 * - client and server project ids match
 * - Firestore read works
 * - env variables present (names only)
 * - no emulator variables
 * - flags
 * - GEMINI_MODEL set
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { db, isEmulator } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import flags from '../../../src/config/flags.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../../');

export async function runStage00(ctx) {
  const runner = new TestRunner(0, 'PREFLIGHT', ctx.logger);
  ctx.logger('\n=== STAGE 0: PREFLIGHT ===');
  quotaTracker.setStage('stage00');

  // Step 1: No emulator variables
  const emulatorVars = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'FIREBASE_DATABASE_EMULATOR_HOST'
  ];
  const detectedEmu = emulatorVars.filter((v) => !!process.env[v]);
  if (detectedEmu.length > 0 || isEmulator) {
    runner.fail({
      feature: 'Preflight',
      step: '0.1 Check No Emulator Variables',
      cause: FAILURE_CAUSES.EMULATOR_ONLY_ASSUMPTION,
      evidence: `Emulator environment variables detected: ${detectedEmu.join(', ')}`,
      likelyFix: 'server/src/config/firebase.js: Unset emulator variables before real test run',
      priority: 'blocks the demo',
      reason: 'Emulator variables detected; task requires real Firebase project only.'
    });
  } else {
    runner.pass({
      feature: 'Preflight',
      step: '0.1 Check No Emulator Variables',
      reason: 'No emulator environment variables detected. Running against real Firebase project.'
    });
  }

  // Step 2: Client and Server project IDs match
  try {
    const clientEnvFile = path.resolve(rootDir, 'client/.env');
    const serverEnvFile = path.resolve(rootDir, 'server/.env');

    const clientParsed = fs.existsSync(clientEnvFile) ? dotenv.parse(fs.readFileSync(clientEnvFile, 'utf8')) : {};
    const serverParsed = fs.existsSync(serverEnvFile) ? dotenv.parse(fs.readFileSync(serverEnvFile, 'utf8')) : {};

    const clientProjectId = clientParsed.VITE_FIREBASE_PROJECT_ID;
    const serverProjectId = serverParsed.VITE_FIREBASE_PROJECT_ID;

    if (!clientProjectId || !serverProjectId) {
      runner.fail({
        feature: 'Preflight',
        step: '0.2 Project ID Match',
        cause: FAILURE_CAUSES.CONFIG_OR_ENV,
        evidence: `Missing project ID in client (${clientProjectId || 'none'}) or server (${serverProjectId || 'none'})`,
        likelyFix: 'client/.env and server/.env: set VITE_FIREBASE_PROJECT_ID=ai-basedsmarthealthcaresystem',
        priority: 'blocks the demo'
      });
    } else if (clientProjectId !== serverProjectId) {
      runner.fail({
        feature: 'Preflight',
        step: '0.2 Project ID Match',
        cause: FAILURE_CAUSES.CONFIG_OR_ENV,
        evidence: `Project ID mismatch: client='${clientProjectId}' vs server='${serverProjectId}'`,
        likelyFix: 'client/.env: align VITE_FIREBASE_PROJECT_ID with server/.env',
        priority: 'blocks the demo'
      });
    } else {
      runner.pass({
        feature: 'Preflight',
        step: '0.2 Project ID Match',
        reason: `Client and server project IDs match: '${clientProjectId}'`
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Preflight',
      step: '0.2 Project ID Match',
      cause: FAILURE_CAUSES.CONFIG_OR_ENV,
      evidence: err.message,
      likelyFix: 'Check .env files in client/ and server/'
    });
  }

  // Step 3: Required env variables present (names only)
  const requiredServerVars = [
    'PORT',
    'INTERNAL_TICK_SECRET',
    'ACTION_TOKEN_SECRET',
    'FIREBASE_SERVICE_ACCOUNT_PATH'
  ];
  const missingServerVars = requiredServerVars.filter((k) => !process.env[k]);

  if (missingServerVars.length > 0) {
    runner.fail({
      feature: 'Preflight',
      step: '0.3 Environment Variables Present',
      cause: FAILURE_CAUSES.CONFIG_OR_ENV,
      evidence: `Missing server env variables: ${missingServerVars.join(', ')}`,
      likelyFix: 'server/.env: define required environment variables',
      priority: 'important'
    });
  } else {
    runner.pass({
      feature: 'Preflight',
      step: '0.3 Environment Variables Present',
      reason: `Required server env variables are defined: ${requiredServerVars.join(', ')}`
    });
  }

  // Step 4: Flags check
  if (flags.scheduler === true) {
    runner.fail({
      feature: 'Preflight',
      step: '0.4 Feature Flags',
      cause: FAILURE_CAUSES.CONFIG_OR_ENV,
      evidence: 'FLAG_SCHEDULER is set to true on real project, violating free quota protection rule',
      likelyFix: 'server/.env: set FLAG_SCHEDULER=false',
      priority: 'important'
    });
  } else {
    runner.pass({
      feature: 'Preflight',
      step: '0.4 Feature Flags',
      reason: `Flags verified: FLAG_SCHEDULER=${flags.scheduler} (disabled as required), FLAG_AI=${flags.ai}, FLAG_PUSH=${flags.push}`
    });
  }

  // Step 5: GEMINI_MODEL set
  if (!env.GEMINI_MODEL || !env.GEMINI_MODEL.trim()) {
    runner.fail({
      feature: 'Preflight',
      step: '0.5 Gemini Model Config',
      cause: FAILURE_CAUSES.CONFIG_OR_ENV,
      evidence: 'GEMINI_MODEL environment variable is empty or unset',
      likelyFix: 'server/.env: set GEMINI_MODEL=gemini-3.8-flash',
      priority: 'important'
    });
  } else {
    runner.pass({
      feature: 'Preflight',
      step: '0.5 Gemini Model Config',
      reason: `GEMINI_MODEL is set: '${env.GEMINI_MODEL}'`
    });
  }

  // Step 6: Real Firestore Read
  try {
    const docRef = db.collection('settings').doc('global');
    const docSnap = await docRef.get();
    quotaTracker.trackRead(1);

    runner.pass({
      feature: 'Preflight',
      step: '0.6 Firestore Read Connection',
      request: 'Firestore GET settings/global',
      response: `Doc exists=${docSnap.exists}`,
      reason: 'Firestore read successfully executed against real project.'
    });
  } catch (err) {
    runner.fail({
      feature: 'Preflight',
      step: '0.6 Firestore Read Connection',
      request: 'Firestore GET settings/global',
      response: err.message,
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: `Firestore read failed: ${err.message}`,
      likelyFix: 'server/config/serviceAccountKey.json: verify permissions for Firestore Admin SDK',
      priority: 'blocks the demo'
    });
  }

  return runner.getSummary();
}

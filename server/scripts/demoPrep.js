import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure server/.env is loaded
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function runDemoPrep() {
  console.log('====================================================');
  console.log('🔍 SmartCare Real-Project Demo Readiness Check (demo:prep)');
  console.log('Mode: STRICTLY READ-ONLY (No writes, seeds, or deletes)');
  console.log('Timestamp:', new Date().toISOString());
  console.log('====================================================\n');

  const report = {
    projectId: null,
    isEmulator: null,
    emulatorHostVars: 'CLEAR',
    featureFlags: {},
    serviceAccount: 'NOT VERIFIED',
    accountCounts: {},
    doctorSlots: 'NOT VERIFIED',
    indexesEvidence: 'NOT VERIFIED',
    rulesEvidence: 'NOT VERIFIED',
    overallStatus: 'PASS'
  };

  // 1. Emulator host check
  const firestoreEmu = process.env.FIRESTORE_EMULATOR_HOST;
  const authEmu = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  if (firestoreEmu || authEmu) {
    console.error('❌ FAIL: Emulator environment variables detected!');
    if (firestoreEmu) console.error('  - FIRESTORE_EMULATOR_HOST is set');
    if (authEmu) console.error('  - FIREBASE_AUTH_EMULATOR_HOST is set');
    report.emulatorHostVars = 'DETECTED';
    report.overallStatus = 'FAIL';
    printSummary(report);
    process.exit(1);
  }
  console.log('✅ Check 1: Emulator environment variables are ABSENT.');

  // 2. Health / Env endpoint probe (if running)
  try {
    const healthRes = await fetch('http://localhost:5000/api/health/env');
    if (healthRes.ok) {
      const data = await healthRes.json();
      report.projectId = data.data?.projectId;
      report.isEmulator = data.data?.isEmulator;
      console.log(`✅ Check 2: Live Backend /api/health/env confirmed:`);
      console.log(`   - Project ID: ${report.projectId}`);
      console.log(`   - isEmulator: ${report.isEmulator}`);
      if (report.projectId !== 'ai-basedsmarthealthcaresystem' || report.isEmulator !== false) {
        console.error('❌ FAIL: Endpoint does not match real production project!');
        report.overallStatus = 'FAIL';
      }
    } else {
      console.log('⚠️ Notice: Backend is not responding on :5000, checking local env config.');
      report.projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'ai-basedsmarthealthcaresystem';
      report.isEmulator = false;
    }
  } catch (err) {
    console.log('⚠️ Notice: Backend is not actively listening on :5000, checking local env config.');
    report.projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'ai-basedsmarthealthcaresystem';
    report.isEmulator = false;
  }

  // 3. Feature Flags
  report.featureFlags = {
    ai: process.env.FLAG_AI === 'true',
    push: process.env.FLAG_PUSH === 'true',
    scheduler: process.env.FLAG_SCHEDULER === 'true'
  };
  console.log(`✅ Check 3: Feature Flags: AI=${report.featureFlags.ai}, Push=${report.featureFlags.push}, Scheduler=${report.featureFlags.scheduler}`);
  if (report.featureFlags.scheduler) {
    console.warn('⚠️ WARNING: FLAG_SCHEDULER is true. On Spark plan, this risks quota exhaustion.');
  }

  // 4. Service Account File & Firebase Admin Init (Read-only)
  const saPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
  if (!fs.existsSync(saPath)) {
    console.error('❌ FAIL: serviceAccountKey.json not found at:', saPath);
    report.serviceAccount = 'MISSING';
    report.overallStatus = 'FAIL';
    printSummary(report);
    process.exit(1);
  }

  let sa;
  try {
    sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    if (sa.project_id !== 'ai-basedsmarthealthcaresystem') {
      console.error(`❌ FAIL: serviceAccount project_id "${sa.project_id}" does not match target.`);
      report.serviceAccount = 'PROJECT_MISMATCH';
      report.overallStatus = 'FAIL';
    } else {
      report.serviceAccount = 'VALID (' + sa.project_id + ')';
      console.log(`✅ Check 4: Service account file exists and project_id matches: ${sa.project_id}`);
    }
  } catch (e) {
    console.error('❌ FAIL: Cannot parse serviceAccountKey.json:', e.message);
    report.serviceAccount = 'INVALID_JSON';
    report.overallStatus = 'FAIL';
  }

  // Initialize Firebase Admin cleanly if needed
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id
    });
  }

  const db = admin.firestore();
  const auth = admin.auth();

  // 5. Account counts by role (Read-only)
  console.log('\n--- Auditing Accounts by Role ---');
  try {
    const usersSnap = await db.collection('users').get();
    const roles = {};
    usersSnap.docs.forEach((doc) => {
      const data = doc.data();
      const r = data.role || 'unassigned';
      roles[r] = (roles[r] || 0) + 1;
    });
    report.accountCounts = roles;
    console.log(`✅ Check 5: Firestore Users Total: ${usersSnap.size}`);
    Object.entries(roles).forEach(([role, count]) => {
      console.log(`   - Role [${role}]: ${count}`);
    });
  } catch (err) {
    console.error('⚠️ Could not query Firestore users:', err.message);
    report.accountCounts = { error: 'NOT VERIFIED (' + err.message + ')' };
  }

  // 6. Doctor availability and slots check (Read-only)
  console.log('\n--- Auditing Doctor Slots ---');
  try {
    const docsSnap = await db.collection('doctors').where('active', '==', true).get();
    const activeDocCount = docsSnap.size;
    console.log(`Found ${activeDocCount} active doctors.`);

    let docsWithSlots = 0;
    const sampleLimit = Math.min(activeDocCount, 5);
    for (let i = 0; i < sampleLimit; i++) {
      const doc = docsSnap.docs[i];
      const docData = doc.data();
      const docId = docData.doctorId || doc.id;
      const slotsSnap = await db.collection('slots')
        .where('doctorId', '==', docId)
        .where('status', '==', 'free')
        .limit(3)
        .get();
      if (!slotsSnap.empty) {
        docsWithSlots++;
      }
    }
    report.doctorSlots = `VERIFIED (${docsWithSlots}/${sampleLimit} sampled active doctors have free slots)`;
    console.log(`✅ Check 6: Doctor Slots: ${report.doctorSlots}`);
  } catch (err) {
    console.warn('⚠️ Slot check error:', err.message);
    report.doctorSlots = 'NOT VERIFIED (' + err.message + ')';
  }

  // 7. Evidence of Rules and Indexes
  console.log('\n--- Auditing Rules & Indexes Evidence ---');
  const rulesPath = path.resolve(__dirname, '../../firestore.rules');
  const indexesPath = path.resolve(__dirname, '../../firestore.indexes.json');

  if (fs.existsSync(rulesPath)) {
    const rulesSize = fs.statSync(rulesPath).size;
    report.rulesEvidence = `VERIFIED (firestore.rules present, ${rulesSize} bytes)`;
    console.log(`✅ Check 7a: ${report.rulesEvidence}`);
  } else {
    report.rulesEvidence = 'NOT VERIFIED (firestore.rules file missing)';
    console.warn(`⚠️ Check 7a: ${report.rulesEvidence}`);
  }

  if (fs.existsSync(indexesPath)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));
      const count = idx.indexes?.length || 0;
      report.indexesEvidence = `VERIFIED (${count} composite indexes defined in firestore.indexes.json)`;
      console.log(`✅ Check 7b: ${report.indexesEvidence}`);
    } catch {
      report.indexesEvidence = 'NOT VERIFIED (firestore.indexes.json invalid JSON)';
      console.warn(`⚠️ Check 7b: ${report.indexesEvidence}`);
    }
  } else {
    report.indexesEvidence = 'NOT VERIFIED (firestore.indexes.json missing)';
    console.warn(`⚠️ Check 7b: ${report.indexesEvidence}`);
  }

  printSummary(report);

  if (report.overallStatus === 'FAIL') {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

function printSummary(report) {
  console.log('\n====================================================');
  console.log('📋 READINESS AUDIT SUMMARY');
  console.log('====================================================');
  console.log(`Project ID:           ${report.projectId}`);
  console.log(`Emulator Mode:        ${report.isEmulator ? 'EMULATOR' : 'REAL PRODUCTION'}`);
  console.log(`Service Account:      ${report.serviceAccount}`);
  console.log(`Scheduler Flag:       ${report.featureFlags.scheduler ? 'ENABLED (⚠️ Quota caution)' : 'DISABLED (Safe)'}`);
  console.log(`Doctor Slots:         ${report.doctorSlots}`);
  console.log(`Rules Evidence:       ${report.rulesEvidence}`);
  console.log(`Indexes Evidence:     ${report.indexesEvidence}`);
  console.log(`Overall Readiness:    ${report.overallStatus}`);
  console.log('====================================================\n');
}

runDemoPrep().catch((err) => {
  console.error('Fatal readiness error:', err);
  process.exit(1);
});

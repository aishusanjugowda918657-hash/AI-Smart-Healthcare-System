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

  const isFullProfile = process.argv.includes('--full') || process.argv.includes('--strict');
  const demoProfile = isFullProfile
    ? 'Full Multi-Staff Hospital Walkthrough'
    : 'Core Patient-Doctor-Admin Walkthrough (Default)';

  const report = {
    projectId: null,
    isEmulator: null,
    emulatorHostVars: 'CLEAR',
    featureFlags: {},
    serviceAccount: 'NOT VERIFIED',
    demoProfile,
    accountCounts: {},
    roleStatus: {},
    availableRoles: [],
    missingMandatoryRoles: [],
    missingOptionalRoles: [],
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
  } catch {
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

  // 5. Account readiness & role coverage check (Read-only)
  console.log('\n--- Auditing Accounts by Role ---');
  console.log(`Demonstration Profile: ${demoProfile}`);

  // Define role requirement matrix for the demonstration
  const ROLE_DEFINITIONS = {
    patient: {
      name: 'Patient',
      mandatory: true,
      workflows: 'Registration, clinical self-triage, slot booking, medical history, reminders'
    },
    doctor: {
      name: 'Doctor',
      mandatory: true,
      workflows: 'Queue management, consultations, digital prescription, allergy warnings'
    },
    admin: {
      name: 'Admin',
      mandatory: true,
      workflows: 'Governance, settings, department management, audit trail, role assignment'
    },
    reception: {
      name: 'Reception',
      mandatory: isFullProfile,
      workflows: 'Front desk patient search, QR & manual check-in, duplicate check-in rejection'
    },
    nurse: {
      name: 'Nurse',
      mandatory: isFullProfile,
      workflows: 'Emergency red-flag triage intake, vital signs recording'
    },
    pharmacy: {
      name: 'Pharmacy',
      mandatory: isFullProfile,
      workflows: 'Prescription dispensing queue, barcode/code verification'
    }
  };

  try {
    const usersSnap = await db.collection('users').get();
    const rolesDiscovered = {};
    usersSnap.docs.forEach((doc) => {
      const data = doc.data();
      const r = data.role || 'unassigned';
      rolesDiscovered[r] = (rolesDiscovered[r] || 0) + 1;
    });
    report.accountCounts = rolesDiscovered;
    console.log(`Total Firestore User Profiles: ${usersSnap.size}`);

    for (const [roleKey, roleDef] of Object.entries(ROLE_DEFINITIONS)) {
      const count = rolesDiscovered[roleKey] || 0;
      if (count > 0) {
        report.availableRoles.push(roleKey);
        report.roleStatus[roleKey] = {
          status: 'AVAILABLE',
          count,
          mandatory: roleDef.mandatory
        };
        console.log(`   ✅ Role [${roleKey}]: ${count} account(s) available [${roleDef.mandatory ? 'MANDATORY: PASS' : 'OPTIONAL: READY'}]`);
      } else {
        if (roleDef.mandatory) {
          report.missingMandatoryRoles.push(roleKey);
          report.roleStatus[roleKey] = {
            status: 'MISSING',
            count: 0,
            mandatory: true
          };
          console.error(`   ❌ Role [${roleKey}]: MISSING (0 accounts) [MANDATORY: FAIL] — Required for ${roleDef.workflows}`);
          report.overallStatus = 'FAIL';
        } else {
          report.missingOptionalRoles.push(roleKey);
          report.roleStatus[roleKey] = {
            status: 'BLOCKED',
            count: 0,
            mandatory: false
          };
          console.log(`   ⚠️ Role [${roleKey}]: MISSING (0 accounts) [OPTIONAL: BLOCKED] — Workflows for ${roleDef.name} (${roleDef.workflows}) are BLOCKED until provisioned.`);
        }
      }
    }
  } catch (err) {
    console.error('⚠️ Could not query Firestore users:', err.message);
    report.accountCounts = { error: 'NOT VERIFIED (' + err.message + ')' };
    report.overallStatus = 'FAIL';
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
  console.log(`Demonstration Profile:${report.demoProfile}`);
  console.log(`Available Roles:      ${report.availableRoles.join(', ')}`);
  console.log(`Missing Mandatory:    ${report.missingMandatoryRoles.length > 0 ? report.missingMandatoryRoles.join(', ') + ' ❌ (FAIL)' : 'None (All mandatory roles present) ✅'}`);
  console.log(`Missing Optional:     ${report.missingOptionalRoles.length > 0 ? report.missingOptionalRoles.join(', ') + ' ⚠️ (Workflows blocked until provisioned)' : 'None'}`);
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

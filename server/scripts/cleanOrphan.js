/**
 * Safe Orphan Cleanup Script
 * Targets a SPECIFIC email address and only deletes the Firebase Auth account
 * IF and ONLY IF:
 *  1. The Firestore `users/{uid}` document does NOT exist
 *  2. The Firestore `patients` collection has NO self-profile for this uid
 *  3. The account's custom claims role is NOT doctor, nurse, admin, reception, pharmacy
 *
 * Safe to run against the real Firebase project.
 * Usage: node scripts/cleanOrphan.js beera123@gmail.com
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIVILEGED_ROLES = ['doctor', 'nurse', 'admin', 'reception', 'pharmacy'];

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error('Usage: node scripts/cleanOrphan.js <email>');
  process.exit(1);
}

const serviceAccountPath = resolve(__dirname, '../config/serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();

async function safeCleanOrphan(email) {
  console.log(`\n🔍 Looking up account for: ${email}`);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log('✅ No Firebase Auth account found for this email. Nothing to clean.');
      return;
    }
    throw err;
  }

  const { uid } = userRecord;
  const role = userRecord.customClaims?.role || null;
  console.log(`   Found UID: ${uid}`);
  console.log(`   Custom role claim: ${role || '(none)'}`);

  // Safety check 1: Never delete privileged accounts
  if (role && PRIVILEGED_ROLES.includes(role)) {
    console.error(`🛑 BLOCKED: Account has privileged role "${role}". This script will NOT touch it.`);
    process.exit(1);
  }

  // Safety check 2: Check if Firestore users/{uid} exists
  const userDocSnap = await db.collection('users').doc(uid).get();
  if (userDocSnap.exists) {
    const userData = userDocSnap.data();
    const firestoreRole = userData?.role;
    if (firestoreRole && PRIVILEGED_ROLES.includes(firestoreRole)) {
      console.error(`🛑 BLOCKED: Firestore users doc has privileged role "${firestoreRole}". This script will NOT touch it.`);
      process.exit(1);
    }
    console.error(`🛑 BLOCKED: Firestore users/${uid} document EXISTS. This is NOT an orphan account.`);
    console.log(`   Firestore role: ${firestoreRole}`);
    process.exit(1);
  }

  // Safety check 3: Check if patients collection has a self-profile for this uid
  const patientSnap = await db.collection('patients')
    .where('ownerUid', '==', uid)
    .where('relation', '==', 'self')
    .limit(1)
    .get();

  if (!patientSnap.empty) {
    console.error(`🛑 BLOCKED: A patient self-profile already exists for UID ${uid}. This is NOT a clean orphan.`);
    process.exit(1);
  }

  // All checks passed — this is a confirmed orphan patient account
  console.log('\n✅ Confirmed ORPHAN: Auth account exists but has NO Firestore users or patients documents.');
  console.log(`   UID: ${uid}`);
  console.log(`   Email: ${email}`);
  console.log('\n🗑️  Deleting orphaned Firebase Auth account...');

  await auth.deleteUser(uid);
  console.log(`✅ Successfully deleted orphaned Auth account for ${email}.`);
  console.log('   The user can now register fresh with this email address.\n');
}

safeCleanOrphan(targetEmail).catch((err) => {
  console.error('\n❌ Script failed:', err.message);
  process.exit(1);
});

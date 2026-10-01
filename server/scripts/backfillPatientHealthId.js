/**
 * Idempotent Patient Health ID Backfill Script
 *
 * Purpose: Adds patientHealthId to existing Firestore documents that are missing it.
 * Safe to run multiple times — skips documents that already have the field.
 *
 * Collections processed:
 *   1. medicineLogs    — resolves patientHealthId from patients/{patientUid}
 *   2. medicineReminders — resolves patientHealthId from patients/{patientUid} where missing
 *   3. notifications   — resolves patientHealthId from patients/{userId} where applicable
 *
 * Usage:
 *   node server/scripts/backfillPatientHealthId.js
 *
 * Requires Firebase Admin credentials in .env (same as server).
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

// --- Firebase Admin Initialization ---
let db;

try {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (saPath && fs.existsSync(saPath)) {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
  } else {
    console.error('❌ Firebase Admin credentials not found. Check .env file.');
    process.exit(1);
  }

  db = admin.firestore();
  console.log('✅ Firebase Admin initialized for backfill script.');
} catch (err) {
  console.error('❌ Firebase initialization failed:', err.message);
  process.exit(1);
}

// --- Utilities ---

/**
 * Cache of patientUid → patientHealthId to avoid redundant Firestore reads.
 */
const healthIdCache = new Map();

async function resolveHealthId(patientUid) {
  if (!patientUid) return null;
  if (healthIdCache.has(patientUid)) return healthIdCache.get(patientUid);

  const patientDoc = await db.collection('patients').doc(patientUid).get();
  const healthId = patientDoc.exists ? patientDoc.data().patientHealthId : null;
  healthIdCache.set(patientUid, healthId);
  return healthId;
}

/**
 * Writes a batch of updates safely (max 500 per Firestore batch).
 */
async function flushBatch(batch, count) {
  if (count > 0) {
    await batch.commit();
    console.log(`  ✔ Flushed batch of ${count} updates.`);
  }
  return db.batch(); // Return a fresh batch
}

// --- Backfill Functions ---

async function backfillMedicineLogs() {
  console.log('\n📋 Processing medicineLogs...');
  const snapshot = await db.collection('medicineLogs').get();

  let updated = 0, skipped = 0, unresolved = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // IDEMPOTENT: skip if patientHealthId already present and non-empty
    if (data.patientHealthId) {
      skipped++;
      continue;
    }

    const healthId = await resolveHealthId(data.patientUid);

    if (!healthId) {
      console.warn(`  ⚠️  medicineLogs/${doc.id}: patientUid '${data.patientUid}' not found in patients collection.`);
      unresolved++;
      continue;
    }

    batch.update(doc.ref, { patientHealthId: healthId });
    batchCount++;
    updated++;

    if (batchCount >= 499) {
      batch = await flushBatch(batch, batchCount);
      batchCount = 0;
    }
  }

  await flushBatch(batch, batchCount);
  console.log(`  medicineLogs → updated: ${updated}, skipped: ${skipped}, unresolved: ${unresolved}`);
  return { updated, skipped, unresolved };
}

async function backfillMedicineReminders() {
  console.log('\n💊 Processing medicineReminders...');
  const snapshot = await db.collection('medicineReminders').get();

  let updated = 0, skipped = 0, unresolved = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.patientHealthId) {
      skipped++;
      continue;
    }

    const healthId = await resolveHealthId(data.patientUid);

    if (!healthId) {
      console.warn(`  ⚠️  medicineReminders/${doc.id}: patientUid '${data.patientUid}' not found.`);
      unresolved++;
      continue;
    }

    batch.update(doc.ref, { patientHealthId: healthId });
    batchCount++;
    updated++;

    if (batchCount >= 499) {
      batch = await flushBatch(batch, batchCount);
      batchCount = 0;
    }
  }

  await flushBatch(batch, batchCount);
  console.log(`  medicineReminders → updated: ${updated}, skipped: ${skipped}, unresolved: ${unresolved}`);
  return { updated, skipped, unresolved };
}

async function backfillNotifications() {
  console.log('\n🔔 Processing notifications...');
  const snapshot = await db.collection('notifications').get();

  let updated = 0, skipped = 0, unresolved = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Skip if patientHealthId already set
    if (data.patientHealthId) {
      skipped++;
      continue;
    }

    // Only attempt resolution if the notification looks patient-specific
    if (!data.userId) {
      skipped++;
      continue;
    }

    const healthId = await resolveHealthId(data.userId);

    if (!healthId) {
      // This notification may belong to a doctor or admin — that's fine, don't warn
      skipped++;
      continue;
    }

    batch.update(doc.ref, { patientHealthId: healthId });
    batchCount++;
    updated++;

    if (batchCount >= 499) {
      batch = await flushBatch(batch, batchCount);
      batchCount = 0;
    }
  }

  await flushBatch(batch, batchCount);
  console.log(`  notifications → updated: ${updated}, skipped: ${skipped}, unresolved: ${unresolved}`);
  return { updated, skipped, unresolved };
}

// --- Main ---

async function main() {
  console.log('🚀 Starting Patient Health ID Backfill Script...');
  console.log('   Mode: IDEMPOTENT — documents with patientHealthId already set will be skipped.\n');

  const results = {};

  results.medicineLogs = await backfillMedicineLogs();
  results.medicineReminders = await backfillMedicineReminders();
  results.notifications = await backfillNotifications();

  console.log('\n✅ Backfill complete. Summary:');
  for (const [collection, stats] of Object.entries(results)) {
    console.log(`   ${collection}: updated=${stats.updated}, skipped=${stats.skipped}, unresolved=${stats.unresolved}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Backfill script failed:', err);
  process.exit(1);
});

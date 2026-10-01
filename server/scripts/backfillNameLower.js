/**
 * backfillNameLower.js
 *
 * One-time (idempotent) script to add a `nameLower` field to every existing
 * patient document in Firestore. Safe to run multiple times — docs that
 * already have `nameLower` are skipped.
 *
 * The `nameLower` field enables case-insensitive exact name matching via:
 *   db.collection('patients').where('nameLower', '==', name.trim().toLowerCase())
 *
 * Usage:
 *   node server/scripts/backfillNameLower.js
 *
 * Requires Firebase Admin credentials in the root .env (same as the server).
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (two levels up from server/scripts/)
dotenv.config({ path: resolve(__dirname, '../../.env') });

// --- Firebase Admin Initialization ---
// Mirrors the existing logic in server/src/config/firebase.js so credentials
// work without any extra setup.
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
  } else if (process.env.VITE_FIREBASE_PROJECT_ID) {
    admin.initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID });
  } else {
    console.error('❌ Firebase Admin credentials not found. Check .env file.');
    process.exit(1);
  }

  db = admin.firestore();
  console.log('✅ Firebase Admin initialized for nameLower backfill script.\n');
} catch (err) {
  console.error('❌ Firebase initialization failed:', err.message);
  process.exit(1);
}

// --- Backfill ---

async function backfillNameLower() {
  console.log('📋 Reading patients collection...');
  const snapshot = await db.collection('patients').get();
  console.log(`   Found ${snapshot.size} patient documents.\n`);

  let updated = 0;
  let skipped = 0;
  let noName = 0;

  const BATCH_SIZE = 400; // comfortably under Firestore's 500 writes/batch limit
  let batch = db.batch();
  let opsInBatch = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // IDEMPOTENT: skip if nameLower already set
    if (data.nameLower) {
      skipped++;
      continue;
    }

    // Use fullName (the field used in patientController.js) with fallback to name
    const rawName = data.fullName || data.name || '';
    if (!rawName.trim()) {
      console.warn(`  ⚠️  patients/${doc.id}: no name field found — skipping.`);
      noName++;
      continue;
    }

    batch.update(doc.ref, { nameLower: rawName.trim().toLowerCase() });
    opsInBatch++;
    updated++;

    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      console.log(`  ✔ Flushed batch of ${opsInBatch} updates.`);
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  // Flush remaining writes
  if (opsInBatch > 0) {
    await batch.commit();
    console.log(`  ✔ Flushed final batch of ${opsInBatch} updates.`);
  }

  console.log('\n✅ Backfill complete.');
  console.log(`   Updated : ${updated}`);
  console.log(`   Skipped : ${skipped} (nameLower already present)`);
  console.log(`   No name : ${noName} (no fullName or name field)`);
}

backfillNameLower()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  });

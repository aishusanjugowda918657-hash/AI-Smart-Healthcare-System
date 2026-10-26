/**
 * backfillDoctorDisplayId.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspects existing doctor records in Firestore, checks for duplicate IDs,
 * and assigns unique, stable display IDs (DOC-DEPT-INITIALS-NNN) without
 * modifying existing UIDs, doc IDs, or unrelated data.
 *
 * Usage:
 *   node scripts/backfillDoctorDisplayId.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertDbConnected } from '../src/config/firebase.js';
import { syncDoctorDisplayIdsInDb, isValidDoctorDisplayId } from '../src/services/doctorDisplayIdService.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function runBackfill() {
  console.log('🩺 Starting Doctor Display ID Backfill & Audit...\n');

  const db = assertDbConnected();
  const snapshot = await db.collection('doctors').get();

  if (snapshot.empty) {
    console.log('ℹ️  No doctor records found in Firestore.');
    return;
  }

  console.log(`📋 Found ${snapshot.size} doctor records. Inspecting...`);

  let alreadyValid = 0;
  let needsUpdate = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const currentDisplayId = data.displayId || data.doctorDisplayId;
    if (isValidDoctorDisplayId(currentDisplayId)) {
      console.log(`   ✓ Doc ID: ${doc.id} | Display ID: ${currentDisplayId} (Valid, will preserve)`);
      alreadyValid++;
    } else {
      console.log(`   ⚠️ Doc ID: ${doc.id} | Name: ${data.fullName || data.name} | Current ID: ${data.doctorId || 'none'} (Needs Display ID)`);
      needsUpdate++;
    }
  }

  console.log(`\nAudited: ${alreadyValid} valid, ${needsUpdate} needing update.`);

  if (needsUpdate > 0) {
    console.log('\n🔄 Synchronizing unique, stable display IDs...');
    const result = await syncDoctorDisplayIdsInDb(db);
    console.log(`✅ Synchronization complete: ${result.updatedCount} records updated in database.`);
  } else {
    console.log('\n✅ All doctor records already have valid display IDs.');
  }
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error during backfill:', err);
    process.exit(1);
  });

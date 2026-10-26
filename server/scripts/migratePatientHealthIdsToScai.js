/**
 * migratePatientHealthIdsToScai.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Migrates existing patients with legacy PHI- IDs to SCAI-YYYY-NNNNNN-P format.
 * Preserves all patient data, updates user sessions, and leaves alias pointers
 * so all existing links/references resolve seamlessly.
 *
 * Usage:
 *   node server/scripts/migratePatientHealthIdsToScai.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertDbConnected } from '../src/config/firebase.js';
import { generateAtomicPatientHealthId } from '../src/services/healthIdGenerator.js';

async function migratePatients() {
  console.log('🩺 Starting Patient Health ID Migration to SCAI-YYYY-NNNNNN-P...\n');

  const db = assertDbConnected();
  const patientsSnap = await db.collection('patients').get();

  console.log(`📋 Found ${patientsSnap.size} patient documents.`);

  let migratedCount = 0;
  let alreadyScai = 0;

  for (const doc of patientsSnap.docs) {
    const data = doc.data();
    const currentHealthId = data.healthId || data.patientHealthId || doc.id;

    // Check if already in SCAI format
    if (/^SCAI-\d{4}-\d{6}-P$/.test(currentHealthId)) {
      console.log(`   ✓ Already SCAI format: [${currentHealthId}] (${data.name || data.fullName})`);
      alreadyScai++;
      continue;
    }

    // Skip alias pointer documents that were already migrated
    if (data.migratedTo) {
      console.log(`   ℹ️ Alias pointer doc [${doc.id}] -> [${data.migratedTo}]`);
      continue;
    }

    const regYear = data.createdAt ? new Date(data.createdAt).getFullYear() : 2026;
    const newScaiId = await generateAtomicPatientHealthId(isNaN(regYear) ? 2026 : regYear);

    console.log(`   🔄 Migrating [${currentHealthId}] -> [${newScaiId}] for [${data.name || data.fullName}]`);

    // 1. Create new patient document with SCAI ID
    const updatedPatientData = {
      ...data,
      healthId: newScaiId,
      patientHealthId: newScaiId,
      legacyHealthId: currentHealthId,
      updatedAt: new Date()
    };
    await db.collection('patients').doc(newScaiId).set(updatedPatientData);

    // 2. Update legacy document as alias pointer
    await db.collection('patients').doc(doc.id).set({
      ...data,
      healthId: newScaiId,
      patientHealthId: newScaiId,
      migratedTo: newScaiId,
      updatedAt: new Date()
    }, { merge: true });

    // 3. Update owner's users document
    if (data.ownerUid) {
      await db.collection('users').doc(data.ownerUid).set({
        healthId: newScaiId,
        patientHealthId: newScaiId,
        updatedAt: new Date()
      }, { merge: true });
    }

    // 4. Update any associated appointments
    const apptsSnap = await db.collection('appointments')
      .where('patientHealthId', '==', currentHealthId)
      .get();
    for (const apptDoc of apptsSnap.docs) {
      await apptDoc.ref.update({
        patientHealthId: newScaiId,
        updatedAt: new Date()
      });
    }

    migratedCount++;
  }

  console.log(`\n✅ Migration Complete!`);
  console.log(`   - Migrated to SCAI: ${migratedCount}`);
  console.log(`   - Already SCAI format: ${alreadyScai}`);
}

migratePatients()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });

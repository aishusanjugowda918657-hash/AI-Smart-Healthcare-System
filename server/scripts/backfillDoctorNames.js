/**
 * backfillDoctorNames.js
 *
 * Backfill missing or placeholder doctorName on appointments from the authentic doctors document.
 * - Dry run by default.
 * - Requires --execute and --confirm=<project id> to apply writes.
 * - Only fills doctorName, specialty, departmentName from the doctor document.
 * - Never deletes any documents or fields.
 * - Stops cleanly on RESOURCE_EXHAUSTED without unhandled exceptions.
 * - Reports doctor records named SmartCare or generic names without deleting them.
 *
 * Usage:
 *   node scripts/backfillDoctorNames.js
 *   node scripts/backfillDoctorNames.js --execute --confirm=<project-id>
 */

import { assertDbConnected, getActiveProjectId } from '../src/config/firebase.js';

async function runBackfill() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const confirmArg = args.find((a) => a.startsWith('--confirm='));
  const confirmedProjectId = confirmArg ? confirmArg.split('=')[1]?.trim() : null;

  const activeProjectId = getActiveProjectId();

  console.log(`\n======================================================`);
  console.log(` Doctor Name Backfill Tool`);
  console.log(` Active Project: ${activeProjectId}`);
  console.log(` Mode: ${isExecute ? '⚡ EXECUTE (Writes Enabled)' : '🔍 DRY RUN (Read-Only)'}`);
  console.log(`======================================================\n`);

  if (isExecute) {
    if (!confirmedProjectId || confirmedProjectId !== activeProjectId) {
      console.error(
        `❌ Refusing to execute: --execute requires --confirm=<project id> matching the active project id.\n` +
        `   Expected: --confirm=${activeProjectId}\n` +
        `   Received: ${confirmedProjectId ? `--confirm=${confirmedProjectId}` : '(none)'}\n`
      );
      process.exit(1);
    }
  }

  const db = assertDbConnected();

  // 1. Fetch all doctors and check for generic names
  console.log('Fetching doctors collection...');
  let doctorsSnap;
  try {
    doctorsSnap = await db.collection('doctors').get();
  } catch (err) {
    if (err.code === 8 || String(err.message).includes('RESOURCE_EXHAUSTED')) {
      console.warn('⚠️ Firestore RESOURCE_EXHAUSTED while reading doctors. Stopping cleanly.');
      process.exit(0);
    }
    throw err;
  }

  const doctorsMap = new Map();
  const genericDoctorsFound = [];

  const genericNamePatterns = [/smartcare/i, /^doctor$/i, /^dr\.?\s*smartcare/i, /^medical\s*staff/i, /^placeholder/i];

  doctorsSnap.forEach((doc) => {
    const data = doc.data() || {};
    const doctorId = data.doctorId || doc.id;
    const name = data.name || data.fullName || '';

    // Check for generic or SmartCare names
    const isGeneric = genericNamePatterns.some((pattern) => pattern.test(name));
    if (isGeneric) {
      genericDoctorsFound.push({
        id: doc.id,
        doctorId: doctorId,
        name: name,
        department: data.department || data.departmentName || data.departmentId || 'unknown'
      });
    }

    // Map doctor by all possible identifiers
    doctorsMap.set(doc.id, data);
    if (data.doctorId) doctorsMap.set(data.doctorId, data);
    if (data.uid) doctorsMap.set(data.uid, data);
    if (data.doctorUid) doctorsMap.set(data.doctorUid, data);
  });

  console.log(`Loaded ${doctorsSnap.size} doctor records.`);

  if (genericDoctorsFound.length > 0) {
    console.warn(`\n⚠️ [AUDIT REPORT] Found ${genericDoctorsFound.length} doctor document(s) with generic or SmartCare names (retained, NOT deleted):`);
    genericDoctorsFound.forEach((d) => {
      console.warn(`   - ID: ${d.id} | DoctorID: ${d.doctorId} | Name: "${d.name}" | Dept: ${d.department}`);
    });
    console.log('');
  } else {
    console.log('✅ No doctor documents with generic or SmartCare names found.\n');
  }

  // 2. Scan appointments collection
  console.log('Scanning appointments collection for missing or placeholder doctor names...');
  let appointmentsSnap;
  try {
    appointmentsSnap = await db.collection('appointments').get();
  } catch (err) {
    if (err.code === 8 || String(err.message).includes('RESOURCE_EXHAUSTED')) {
      console.warn('⚠️ Firestore RESOURCE_EXHAUSTED while reading appointments. Stopping cleanly.');
      process.exit(0);
    }
    throw err;
  }

  console.log(`Total appointments examined: ${appointmentsSnap.size}`);

  const candidatesToUpdate = [];

  appointmentsSnap.forEach((doc) => {
    const appt = doc.data() || {};
    const existingName = appt.doctorName;
    const doctorId = appt.doctorId;

    // Check if missing or placeholder
    const isMissing = !existingName || typeof existingName !== 'string' || !existingName.trim();
    const isPlaceholder = existingName && genericNamePatterns.some((pat) => pat.test(existingName));

    if (isMissing || isPlaceholder) {
      if (doctorId && doctorsMap.has(doctorId)) {
        const docRecord = doctorsMap.get(doctorId);
        const realName = docRecord.name || docRecord.fullName;
        if (realName && !genericNamePatterns.some((pat) => pat.test(realName))) {
          const updates = { doctorName: realName };
          if (!appt.specialty && (docRecord.specialty || docRecord.specialization)) {
            updates.specialty = docRecord.specialty || docRecord.specialization;
          }
          if (!appt.departmentName && (docRecord.departmentName || docRecord.department)) {
            updates.departmentName = docRecord.departmentName || docRecord.department;
          }
          candidatesToUpdate.push({
            id: doc.id,
            oldName: existingName || '(none)',
            newName: realName,
            doctorId: doctorId,
            updates
          });
        }
      }
    }
  });

  console.log(`Appointments requiring doctorName backfill: ${candidatesToUpdate.length}`);

  if (candidatesToUpdate.length === 0) {
    console.log('✅ All appointments already have valid doctor names. No backfill needed.\n');
    return;
  }

  // Preview first 5 updates
  console.log('\nSample candidates for backfill:');
  candidatesToUpdate.slice(0, 5).forEach((c, idx) => {
    console.log(`  ${idx + 1}. Appt [${c.id}]: "${c.oldName}" ➔ "${c.newName}" (Doctor ID: ${c.doctorId})`);
  });
  if (candidatesToUpdate.length > 5) {
    console.log(`  ... and ${candidatesToUpdate.length - 5} more.`);
  }

  if (!isExecute) {
    console.log(`\n======================================================`);
    console.log(` 🔍 DRY RUN COMPLETED.`);
    console.log(` ${candidatesToUpdate.length} appointments would be updated.`);
    console.log(` Run with:`);
    console.log(`   npm run appointments:backfill-names -- --execute --confirm=${activeProjectId}`);
    console.log(` to apply changes.`);
    console.log(`======================================================\n`);
    return;
  }

  // Execute writes in batches of 50
  console.log(`\nCommitting updates in batches...`);
  const BATCH_SIZE = 50;
  let updatedCount = 0;

  for (let i = 0; i < candidatesToUpdate.length; i += BATCH_SIZE) {
    const chunk = candidatesToUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      const ref = db.collection('appointments').doc(item.id);
      batch.update(ref, item.updates);
    }

    try {
      await batch.commit();
      updatedCount += chunk.length;
      console.log(`  Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${updatedCount}/${candidatesToUpdate.length})...`);
    } catch (err) {
      if (err.code === 8 || String(err.message).includes('RESOURCE_EXHAUSTED')) {
        console.warn(`\n⚠️ Firestore RESOURCE_EXHAUSTED at ${updatedCount}/${candidatesToUpdate.length}. Stopping cleanly without crash.`);
        return;
      }
      console.error(`❌ Batch update failed:`, err.message);
      throw err;
    }
  }

  console.log(`\n======================================================`);
  console.log(` ✅ BACKFILL COMPLETED SUCCESSFULLY`);
  console.log(` Successfully updated ${updatedCount} appointments with real doctor names.`);
  console.log(`======================================================\n`);
}

runBackfill().catch((err) => {
  if (err.code === 8 || String(err.message).includes('RESOURCE_EXHAUSTED')) {
    console.warn('⚠️ RESOURCE_EXHAUSTED stopped cleanly.');
    process.exit(0);
  }
  console.error('Fatal error during doctor names backfill:', err);
  process.exit(1);
});

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import admin from 'firebase-admin';
import { db as defaultDb, auth as defaultAuth } from '../src/config/firebase.js';

export const KNOWN_COLLECTIONS = [
  'users',
  'patients',
  'departments',
  'doctors',
  'leaves',
  'slots',
  'appointments',
  'queues',
  'counters',
  'consultationStats',
  'visits',
  'reports',
  'prescriptions',
  'reminders',
  'followups',
  'alerts',
  'notifications',
  'waitlist',
  'offers',
  'auditLogs',
  'settings',
  'medicineReminders',
  'tokens',
  'medicalRecords',
  'medicineLogs'
];

/**
 * Executes or dry-runs full deletion of all top-level collections, Auth users, and Storage files.
 *
 * Safety requirements for REAL deletion:
 *  - wipeAll: true
 *  - execute: true
 *  - confirmProjectId === activeProjectId
 *  - understandDataLoss: true
 */
export async function runResetEverything(options = {}) {
  const {
    wipeAll = false,
    execute = false,
    confirmProjectId = '',
    understandDataLoss = false,
    db = defaultDb,
    auth = defaultAuth,
    storageBucket = null,
    projectIdOverride = null,
    logger = console.log,
    errLogger = console.error
  } = options;

  const projectId =
    projectIdOverride ||
    (admin.apps.length > 0 ? admin.app().options?.projectId : null) ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    'demo-project';

  logger('\n=======================================================');
  logger('🧹 FULL RESET TOOL FOR FIREBASE PROJECT');
  logger(`Target Project ID: ${projectId}`);
  logger(`Mode: ${wipeAll ? '--wipe-all' : 'patient-reset-only'}`);
  logger('=======================================================\n');

  // Verify execution confirmation flags for --wipe-all mode
  const flagsValid = wipeAll && execute && confirmProjectId === projectId && understandDataLoss;
  const isRealExecution = flagsValid;

  if (wipeAll && !isRealExecution) {
    logger('⚠️  [DRY RUN MODE] Real deletion was NOT requested or required flags were incomplete/invalid.');
    logger('   Required flags for real deletion:');
    logger('     1. --wipe-all');
    logger('     2. --execute');
    logger(`     3. --confirm=${projectId}`);
    logger('     4. --i-understand-all-data-will-be-lost');
    if (confirmProjectId && confirmProjectId !== projectId) {
      logger(`   ❌ Provided --confirm="${confirmProjectId}" does NOT match target project "${projectId}".`);
    }
    logger('');
  }

  // Build collection list (known collections + listCollections if available)
  const collectionsToScan = [...new Set(KNOWN_COLLECTIONS)];
  if (db && typeof db.listCollections === 'function') {
    try {
      const liveCols = await db.listCollections();
      liveCols.forEach((col) => {
        if (!collectionsToScan.includes(col.id)) {
          collectionsToScan.push(col.id);
        }
      });
    } catch (e) {
      // Ignore if listCollections fails in emulator or test environment
    }
  }

  // 1. Scan / Count Firestore Collections
  logger('📊 Step 1: Scanning Firestore collections and document counts...');
  const collectionStats = [];
  let totalDocsCount = 0;

  if (db && typeof db.collection === 'function') {
    for (const colName of collectionsToScan) {
      try {
        const snap = await db.collection(colName).get();
        const count = snap ? (typeof snap.size === 'number' ? snap.size : (snap.docs ? snap.docs.length : 0)) : 0;
        const docs = snap ? snap.docs || [] : [];
        collectionStats.push({ colName, count, docs });
        totalDocsCount += count;
        logger(`   • Collection "${colName}": ${count} document(s)`);
      } catch (err) {
        if (err.code === 8 || (err.message && err.message.includes('RESOURCE_EXHAUSTED'))) {
          logger(`\n⚠️ RESOURCE_EXHAUSTED encountered while scanning "${colName}". Execution stopped cleanly.`);
          printPostWipeChecklist(logger);
          return { success: false, stoppedEarly: true, reason: 'RESOURCE_EXHAUSTED' };
        }
        logger(`   ⚠️ Could not read collection "${colName}": ${err.message}`);
      }
    }
  } else {
    logger('   ⚠️ Firestore DB instance not available.');
  }

  // 2. Scan / Count Auth Users
  logger('\n👥 Step 2: Scanning Firebase Auth users...');
  let authUsers = [];
  if (auth && typeof auth.listUsers === 'function') {
    try {
      const listRes = await auth.listUsers(1000);
      authUsers = listRes ? listRes.users || [] : [];
      logger(`   • Firebase Auth total users: ${authUsers.length}`);
    } catch (err) {
      logger(`   ⚠️ Auth scanning failed: ${err.message}`);
    }
  } else {
    logger('   ⚠️ Firebase Auth instance not available.');
  }

  // 3. Scan / Count Storage Files under reports/
  logger('\n📁 Step 3: Scanning Firebase Storage files under "reports/"...');
  let storageFiles = [];
  try {
    const bucket = storageBucket || (admin.apps.length > 0 && typeof admin.storage === 'function' ? admin.storage().bucket() : null);
    if (bucket && typeof bucket.getFiles === 'function') {
      const [files] = await bucket.getFiles({ prefix: 'reports/' });
      storageFiles = files || [];
      logger(`   • Storage files under "reports/": ${storageFiles.length}`);
    } else {
      logger('   ℹ️ Storage bucket not configured or available.');
    }
  } catch (err) {
    logger(`   ℹ️ Storage check notice: ${err.message}`);
  }

  logger('\n=======================================================');
  logger('📋 SUMMARY OF DATA TO BE DELETED:');
  logger(`   - Total Firestore documents: ${totalDocsCount} doc(s) across ${collectionStats.length} collections`);
  logger(`   - Total Firebase Auth users: ${authUsers.length} user(s)`);
  logger(`   - Total Storage report files: ${storageFiles.length} file(s)`);
  logger('=======================================================\n');

  if (!isRealExecution) {
    logger('✅ [DRY RUN COMPLETE] No actual data was deleted.');
    printPostWipeChecklist(logger);
    return {
      success: true,
      dryRun: true,
      totalDocsCount,
      authUsersCount: authUsers.length,
      storageFilesCount: storageFiles.length
    };
  }

  // Real Deletion Mode
  logger('🔥 EXECUTION MODE: DELETING ALL DATA IN CHUNKS...\n');

  // Delete Firestore docs
  let deletedDocs = 0;
  for (const { colName, docs } of collectionStats) {
    if (!docs || docs.length === 0) continue;
    logger(`🗑️ Deleting collection "${colName}" (${docs.length} docs)...`);

    const chunkSize = 200;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      try {
        const batch = db.batch();
        for (const doc of chunk) {
          if (typeof doc.ref?.listCollections === 'function') {
            try {
              const subcols = await doc.ref.listCollections();
              for (const subcol of subcols) {
                const subSnap = await subcol.get();
                subSnap.docs.forEach((sDoc) => batch.delete(sDoc.ref));
              }
            } catch (e) {
              // Ignore subcollection deletion errors
            }
          }
          batch.delete(doc.ref);
        }
        await batch.commit();
        deletedDocs += chunk.length;
        logger(`   ✓ Deleted ${deletedDocs}/${totalDocsCount} documents...`);
      } catch (err) {
        if (err.code === 8 || (err.message && err.message.includes('RESOURCE_EXHAUSTED'))) {
          logger(`\n⚠️ RESOURCE_EXHAUSTED encountered (Quota limit reached). Execution stopped cleanly.`);
          logger(`   Deleted ${deletedDocs}/${totalDocsCount} docs so far. Re-run this script tomorrow to continue.`);
          printPostWipeChecklist(logger);
          return { success: false, stoppedEarly: true, reason: 'RESOURCE_EXHAUSTED', deletedDocs };
        }
        errLogger(`   ❌ Error deleting chunk in "${colName}": ${err.message}`);
      }
    }
  }

  // Delete Auth users
  let deletedAuthUsers = 0;
  if (auth && authUsers.length > 0) {
    logger(`\n🗑️ Deleting ${authUsers.length} Auth users...`);
    const chunkSize = 100;
    for (let i = 0; i < authUsers.length; i += chunkSize) {
      const chunk = authUsers.slice(i, i + chunkSize);
      const uids = chunk.map((u) => u.uid);
      try {
        if (typeof auth.deleteUsers === 'function') {
          const deleteResult = await auth.deleteUsers(uids);
          deletedAuthUsers += deleteResult.successCount;
        } else {
          for (const uid of uids) {
            await auth.deleteUser(uid);
            deletedAuthUsers++;
          }
        }
        logger(`   ✓ Deleted ${deletedAuthUsers}/${authUsers.length} Auth users...`);
      } catch (err) {
        if (err.code === 8 || (err.message && err.message.includes('RESOURCE_EXHAUSTED'))) {
          logger(`\n⚠️ RESOURCE_EXHAUSTED encountered during Auth deletion. Execution stopped cleanly.`);
          printPostWipeChecklist(logger);
          return { success: false, stoppedEarly: true, reason: 'RESOURCE_EXHAUSTED', deletedAuthUsers };
        }
        errLogger(`   ❌ Error deleting Auth users chunk: ${err.message}`);
      }
    }
  }

  // Delete Storage files
  let deletedStorageFiles = 0;
  if (storageFiles.length > 0) {
    logger(`\n🗑️ Deleting ${storageFiles.length} storage files under "reports/"...`);
    for (const file of storageFiles) {
      try {
        await file.delete();
        deletedStorageFiles++;
      } catch (err) {
        errLogger(`   ⚠️ Failed to delete storage file ${file.name}: ${err.message}`);
      }
    }
    logger(`   ✓ Deleted ${deletedStorageFiles}/${storageFiles.length} storage files.`);
  }

  logger('\n✅ REAL DELETION COMPLETE! All target data was wiped successfully.\n');
  printPostWipeChecklist(logger);

  return {
    success: true,
    dryRun: false,
    deletedDocs,
    deletedAuthUsers,
    deletedStorageFiles
  };
}

export function printPostWipeChecklist(logger = console.log) {
  logger('==================================================');
  logger('📋 POST-WIPE RECREATION CHECKLIST');
  logger('==================================================');
  logger('1. Run bootstrap script to initialize core settings & departments:');
  logger('   npm run bootstrap (or node server/scripts/bootstrap.js)');
  logger('2. Create initial Admin account:');
  logger('   npm run bootstrap -- --admin-email=<email> --admin-name=<name>');
  logger('3. Create initial Doctor account(s) and slots:');
  logger('   npm run bootstrap -- --doctor --doctor-email=<email> --doctor-name=<name> --department-id=<deptId>');
  logger('4. Verify global settings (disclaimers & thresholds) in settings/global.');
  logger('5. Verify departments in departments collection.');
  logger('==================================================\n');
}

// CLI runner
if (process.argv[1] && (process.argv[1].endsWith('resetEverything.js') || process.argv[1].endsWith('resetPatientData.js'))) {
  const args = process.argv.slice(2);
  const wipeAll = args.includes('--wipe-all');
  const execute = args.includes('--execute');
  const confirmArg = args.find((a) => a.startsWith('--confirm='));
  const confirmProjectId = confirmArg ? confirmArg.split('=')[1] : '';
  const understandDataLoss = args.includes('--i-understand-all-data-will-be-lost');

  runResetEverything({
    wipeAll,
    execute,
    confirmProjectId,
    understandDataLoss
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal reset error:', err);
      process.exit(1);
    });
}

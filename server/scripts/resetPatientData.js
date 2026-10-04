import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { runResetEverything } from './resetEverything.js';
import { db as defaultDb, auth as defaultAuth, assertDbConnected } from '../src/config/firebase.js';

export async function resetPatientData(options = {}) {
  const args = options.args || process.argv.slice(2);
  const wipeAll = options.wipeAll !== undefined ? options.wipeAll : args.includes('--wipe-all');

  if (wipeAll) {
    const execute = options.execute !== undefined ? options.execute : args.includes('--execute');
    const confirmArg = args.find((a) => a.startsWith('--confirm='));
    const confirmProjectId = options.confirmProjectId !== undefined ? options.confirmProjectId : (confirmArg ? confirmArg.split('=')[1] : '');
    const understandDataLoss = options.understandDataLoss !== undefined ? options.understandDataLoss : args.includes('--i-understand-all-data-will-be-lost');

    return runResetEverything({
      wipeAll: true,
      execute,
      confirmProjectId,
      understandDataLoss,
      db: options.db || defaultDb,
      auth: options.auth || defaultAuth,
      projectIdOverride: options.projectIdOverride
    });
  }

  // Fallback / standard patient test data reset
  try {
    const db = options.db || assertDbConnected();
    const auth = options.auth || defaultAuth;
    console.log('🧹 STARTING SAFE PATIENT TEST DATA RESET...');

    const collectionsToDelete = [
      'appointments',
      'tokens',
      'medicalRecords',
      'prescriptions',
      'medicineReminders',
      'medicineLogs',
      'followUps',
      'notifications'
    ];

    for (const colName of collectionsToDelete) {
      const snap = await db.collection(colName).get();
      if (snap && snap.docs && snap.docs.length > 0) {
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`  ✓ Cleared ${colName} (${snap.size} docs)`);
      } else {
        console.log(`  ✓ ${colName} is already empty`);
      }
    }

    const patientsSnap = await db.collection('patients').get();
    if (patientsSnap && patientsSnap.docs && patientsSnap.docs.length > 0) {
      const batch = db.batch();
      patientsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`  ✓ Cleared patients collection (${patientsSnap.size} profiles)`);
    }

    const usersSnap = await db.collection('users').where('role', '==', 'patient').get();
    if (usersSnap && usersSnap.docs && usersSnap.docs.length > 0) {
      const batch = db.batch();
      usersSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`  ✓ Cleared patient users in 'users' collection (${usersSnap.size} docs)`);
    }

    if (auth && typeof auth.listUsers === 'function') {
      try {
        const listUsersResult = await auth.listUsers(1000);
        const testPatientAccounts = (listUsersResult.users || []).filter((u) => {
          const email = (u.email || '').toLowerCase();
          return !email.includes('doctor') && !email.includes('admin');
        });

        for (const u of testPatientAccounts) {
          try {
            await auth.deleteUser(u.uid);
            console.log(`  ✓ Deleted Auth user: ${u.email || u.uid}`);
          } catch (delErr) {
            console.warn(`  ⚠️ Failed to delete Auth user ${u.uid}:`, delErr.message);
          }
        }
      } catch (authErr) {
        console.warn('  ⚠️ Auth cleanup warning:', authErr.message);
      }
    }

    console.log('✅ SAFE PATIENT TEST DATA RESET COMPLETE!');
    return { success: true, dryRun: false };
  } catch (err) {
    console.error('❌ Error during patient reset:', err);
    throw err;
  }
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('resetPatientData.js')) {
  resetPatientData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

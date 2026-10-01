import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db, auth, assertDbConnected } from '../src/config/firebase.js';

async function resetPatientTestData() {
  try {
    const firestore = assertDbConnected();
    console.log('🧹 STARTING SAFE PATIENT TEST DATA RESET...');

    // 1. Delete patient-related collections
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
      const snap = await firestore.collection(colName).get();
      if (!snap.empty) {
        const batch = firestore.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        console.log(`  ✓ Cleared ${colName} (${snap.size} docs)`);
      } else {
        console.log(`  ✓ ${colName} is already empty`);
      }
    }

    // 2. Clear patient profiles in 'patients' collection
    const patientsSnap = await firestore.collection('patients').get();
    if (!patientsSnap.empty) {
      const batch = firestore.batch();
      patientsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`  ✓ Cleared patients collection (${patientsSnap.size} profiles)`);
    }

    // 3. Clear patient users from 'users' collection (where role === 'patient')
    const usersSnap = await firestore.collection('users').where('role', '==', 'patient').get();
    if (!usersSnap.empty) {
      const batch = firestore.batch();
      usersSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`  ✓ Cleared patient users in 'users' collection (${usersSnap.size} docs)`);
    }

    // 4. Delete demo/test Firebase Auth patient accounts
    if (auth) {
      try {
        const listUsersResult = await auth.listUsers(1000);
        const testPatientAccounts = listUsersResult.users.filter((u) => {
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
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during safe reset:', err);
    process.exit(1);
  }
}

resetPatientTestData();

/**
 * Real Test Cleanup Utility
 * Deletes ONLY documents and Auth users tagged with testRunId or prefixed with zz-test-.
 * Never touches real data, real doctors, or real admin accounts.
 */

import { auth, db } from '../../../src/config/firebase.js';
import { quotaTracker } from './quotaTracker.js';

export const TRACKED_COLLECTIONS = [
  'users',
  'patients',
  'doctors',
  'appointments',
  'slots',
  'alerts',
  'queues',
  'reminders',
  'medicineReminders',
  'prescriptions',
  'notifications',
  'auditLogs',
  'waitlist',
  'offers',
  'leaves',
  'consultationStats',
  'medicalRecords',
  'visits'
];

export async function cleanupTestRun(testRunId, logger = console.log) {
  logger(`\n🧹 Starting cleanup for testRunId: ${testRunId || 'all zz-test-*'}...`);
  let deletedDocsCount = 0;
  let deletedAuthUsersCount = 0;

  // 1. Delete tagged Firestore documents
  for (const colName of TRACKED_COLLECTIONS) {
    try {
      let query = db.collection(colName);
      if (testRunId) {
        query = query.where('testRunId', '==', testRunId);
      }
      const snapshot = await query.limit(500).get();
      quotaTracker.trackRead(snapshot.size);

      if (!snapshot.empty) {
        // Double check safety: do NOT delete if document does not belong to test
        const docsToDelete = snapshot.docs.filter((d) => {
          const data = d.data();
          if (testRunId) return data.testRunId === testRunId;
          // Global cleanup fallback: only delete if ID starts with zz-test- or testRunId exists
          return (
            data.testRunId ||
            d.id.startsWith('zz-test-') ||
            (data.email && data.email.includes('healthcare-test.internal'))
          );
        });

        if (docsToDelete.length > 0) {
          const batch = db.batch();
          docsToDelete.forEach((d) => batch.delete(d.ref));
          await batch.commit();
          quotaTracker.trackWrite(docsToDelete.length);
          deletedDocsCount += docsToDelete.length;
          logger(`  ✓ Deleted ${docsToDelete.length} documents from ${colName}`);
        }
      }
    } catch (err) {
      logger(`  ⚠️ Error cleaning ${colName}: ${err.message}`);
    }
  }

  // 2. Delete test Auth users (prefix zz-test- only)
  try {
    let pageToken = undefined;
    do {
      const listResult = await auth.listUsers(100, pageToken);
      const testUsers = listResult.users.filter((u) => {
        if (!u.uid.startsWith('zz-test-')) return false;
        if (testRunId) {
          return u.uid.includes(testRunId) || u.customClaims?.testRunId === testRunId;
        }
        return true;
      });

      for (const u of testUsers) {
        try {
          await auth.deleteUser(u.uid);
          deletedAuthUsersCount++;
        } catch (e) {
          logger(`  ⚠️ Error deleting test user ${u.uid}: ${e.message}`);
        }
      }

      pageToken = listResult.pageToken;
    } while (pageToken);

    logger(`  ✓ Deleted ${deletedAuthUsersCount} temporary Auth users (zz-test-*)`);
  } catch (err) {
    logger(`  ⚠️ Error listing/deleting test Auth users: ${err.message}`);
  }

  // 3. Verification check
  const verification = await verifyCleanup(testRunId);
  logger(`  ✓ Cleanup verification: ${verification.leftoverDocs} leftover docs, ${verification.leftoverAuth} leftover auth users`);

  return {
    deletedDocsCount,
    deletedAuthUsersCount,
    leftoverDocs: verification.leftoverDocs,
    leftoverAuth: verification.leftoverAuth
  };
}

export async function verifyCleanup(testRunId) {
  let leftoverDocs = 0;
  let leftoverAuth = 0;

  for (const colName of TRACKED_COLLECTIONS) {
    try {
      let query = db.collection(colName);
      if (testRunId) {
        query = query.where('testRunId', '==', testRunId);
      } else {
        query = query.where('testRunId', '!=', null);
      }
      const snap = await query.limit(50).get();
      leftoverDocs += snap.size;
    } catch {
      // ignore
    }
  }

  try {
    const listResult = await auth.listUsers(100);
    const leftover = listResult.users.filter((u) => {
      if (!u.uid.startsWith('zz-test-')) return false;
      if (testRunId) return u.uid.includes(testRunId);
      return true;
    });
    leftoverAuth = leftover.length;
  } catch {
    // ignore
  }

  return { leftoverDocs, leftoverAuth };
}

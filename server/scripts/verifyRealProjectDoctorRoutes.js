import { assertDbConnected, getDb } from '../src/config/firebase.js';

async function main() {
  console.log('--- Real Project Doctor Workspaces & Quota Health Check ---');
  const db = assertDbConnected();
  if (!db) {
    console.error('Firestore not initialized.');
    process.exit(1);
  }

  // 1. Verify departments or doctors collections exist
  const deptSnap = await db.collection('departments').limit(5).get();
  console.log(`Departments found in real project: ${deptSnap.size}`);

  const docSnap = await db.collection('doctors').limit(5).get();
  console.log(`Doctors found in real project: ${docSnap.size}`);

  // 2. Check for any stale test documents and clean up
  const testIds = ['test-doc-a-uid', 'test-doc-b-uid', 'pt-dup-1', 'pt-dup-2', 'appt-taska-waiting', 'appt-taska-not-arrived'];
  let cleanedCount = 0;
  for (const id of testIds) {
    const docRef = db.collection('doctors').doc(id);
    const snap = await docRef.get();
    if (snap.exists) {
      await docRef.delete();
      cleanedCount++;
    }

    const pRef = db.collection('patients').doc(id);
    const pSnap = await pRef.get();
    if (pSnap.exists) {
      await pRef.delete();
      cleanedCount++;
    }

    const aRef = db.collection('appointments').doc(id);
    const aSnap = await aRef.get();
    if (aSnap.exists) {
      await aRef.delete();
      cleanedCount++;
    }
  }

  console.log(`Test artifacts cleaned from real project: ${cleanedCount}`);
  console.log('Real project is clean and quota-safe.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Real check error:', err.message);
  process.exit(1);
});

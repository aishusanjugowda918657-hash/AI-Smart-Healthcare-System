import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function cleanupOrphanedTestData() {
  console.log('=== INVESTIGATING BUG 2 ORPHANED TEST APPOINTMENTS ===\n');

  const apptSnap = await db.collection('appointments').get();
  const testAppts = [];
  const validAppts = [];

  apptSnap.docs.forEach((doc) => {
    const d = doc.data();
    if (doc.id.startsWith('appt_f5_') || doc.id.startsWith('test_appt_') || doc.id.startsWith('appt_past_') || doc.id.startsWith('appt_canc_')) {
      testAppts.push({ id: doc.id, ...d });
    } else {
      validAppts.push({ id: doc.id, ...d });
    }
  });

  console.log(`Found ${testAppts.length} orphaned test appointments:`);
  testAppts.forEach((t) => {
    console.log(` - ID: ${t.id} | Token: ${t.tokenNumber || t.tokenLabel} | Doctor: ${t.doctorId} | Time: ${t.timeSlot} | Status: ${t.status}`);
  });

  console.log(`\nFound ${validAppts.length} valid appointments to PRESERVE:`);
  validAppts.forEach((v) => {
    console.log(` - ID: ${v.id} | Token: ${v.tokenNumber || v.tokenLabel} | Doctor: ${v.doctorId} | Time: ${v.timeSlot || v.bookedStartAt} | Status: ${v.status} | Patient: ${v.patientName}`);
  });

  // Clean up ONLY the orphaned test appointments and associated test slots
  const batch = db.batch();
  for (const t of testAppts) {
    batch.delete(db.collection('appointments').doc(t.id));
    if (t.slotId) {
      batch.delete(db.collection('slots').doc(t.slotId));
    }
    if (Array.isArray(t.slotIds)) {
      t.slotIds.forEach((sId) => batch.delete(db.collection('slots').doc(sId)));
    }
  }
  await batch.commit();
  console.log(`\n✅ Safely deleted ${testAppts.length} orphaned test appointments and slots.`);
}

cleanupOrphanedTestData().catch(console.error);

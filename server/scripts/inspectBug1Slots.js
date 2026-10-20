import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function inspectSlots() {
  const slotIds = [
    'DOC-001_2026-10-08_1015',
    'DOC-001_2026-10-08_1145',
    'DOC-001_2026-10-08_1515',
    'DOC-001_2026-10-08_1645'
  ];

  for (const sId of slotIds) {
    const sDoc = await db.collection('slots').doc(sId).get();
    if (sDoc.exists) {
      console.log(`Slot: ${sId} -> Status: "${sDoc.data().status}", startAt: ${sDoc.data().startAt}`);
    } else {
      console.log(`Slot: ${sId} -> NOT FOUND`);
    }
  }

  // Also check sample other slots: 09:00, 10:00, 10:15, 10:30
  const sampleIds = [
    'DOC-001_2026-10-08_0900',
    'DOC-001_2026-10-08_0915',
    'DOC-001_2026-10-08_0930',
    'DOC-001_2026-10-08_0945',
    'DOC-001_2026-10-08_1000',
    'DOC-001_2026-10-08_1015',
    'DOC-001_2026-10-08_1030'
  ];
  console.log('\nSample Morning Sequence:');
  for (const sId of sampleIds) {
    const sDoc = await db.collection('slots').doc(sId).get();
    if (sDoc.exists) {
      console.log(`  ${sDoc.data().startAt}: status = "${sDoc.data().status}"`);
    }
  }
}

inspectSlots().catch(console.error);

import fetch from 'node-fetch';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

const DOCTOR_ID = 'DOC-001';
const DOCTOR_UID = 'tSuSTZkfrEDciNhzz4OZhKmYBFi5';
const TODAY_STR = new Date().toISOString().split('T')[0];

async function cleanup() {
  console.log('>>> [CLEANUP] Cleaning up test appointments for today...');

  const apptsSnap = await db.collection('appointments')
    .where('doctorId', '==', DOCTOR_ID)
    .where('date', '==', TODAY_STR)
    .get();

  for (const doc of apptsSnap.docs) {
    const data = doc.data();
    if (['John Doe', 'Anita Roy', 'Rajesh Verma'].includes(data.patientName)) {
      console.log(`Deleting appointment ${doc.id} for ${data.patientName}...`);
      await doc.ref.delete();
      if (data.slotId) {
        await db.collection('slots').doc(data.slotId).update({
          status: 'free',
          appointmentId: null,
          heldUntil: null,
          heldBy: null,
          updatedAt: new Date()
        });
        console.log(`Reverted slot ${data.slotId} to free.`);
      }
    }
  }

  // Recalculate queue
  await fetch(`http://localhost:5000/api/queue/doctor/${DOCTOR_ID}/today?date=${TODAY_STR}`, {
    headers: { 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' }
  });

  console.log('>>> Cleanup completed.');
}

cleanup().catch(console.error);

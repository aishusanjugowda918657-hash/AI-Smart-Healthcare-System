import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();

async function run() {
  const slotsSnap = await db.collection('slots').get();
  console.log('Total slots in emulator:', slotsSnap.size);

  const doctorsSnap = await db.collection('doctors').get();
  console.log('Total doctors in emulator:', doctorsSnap.size);
  doctorsSnap.forEach(d => {
    const data = d.data();
    console.log(`Doctor: ${data.name} (${data.doctorId}) - has schedule: ${!!data.schedule}`);
  });

  const schedulesSnap = await db.collection('doctorSchedules').get();
  console.log('Total doctorSchedules in emulator:', schedulesSnap.size);
}

run().catch(console.error);

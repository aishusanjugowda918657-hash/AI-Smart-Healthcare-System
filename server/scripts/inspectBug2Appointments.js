import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function inspectAppointments() {
  const snap = await db.collection('appointments').get();
  console.log(`Total appointments in Firestore: ${snap.size}`);

  const rows = [];
  snap.docs.forEach((doc) => {
    const d = doc.data();
    rows.push({
      id: doc.id,
      doctorId: d.doctorId,
      date: d.date,
      timeSlot: d.timeSlot || d.bookedStartAt,
      status: d.status,
      tokenNumber: d.tokenNumber,
      tokenLabel: d.tokenLabel,
      patientName: d.patientName,
      patientHealthId: d.patientHealthId,
      patientUid: d.patientUid || d.ownerUid
    });
  });

  console.table(rows);
}

inspectAppointments().catch(console.error);

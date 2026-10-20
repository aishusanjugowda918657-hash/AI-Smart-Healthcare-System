import admin from 'firebase-admin';
import crypto from 'crypto';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function seedBackup() {
  const todayStr = new Date().toISOString().split('T')[0];
  const curHours = String(new Date().getHours()).padStart(2, '0');
  const slotTime = `${curHours}:30`;
  const rawCode = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
  const apptId = 'appt_demo_backup_anita';

  const doc = {
    id: apptId,
    patientHealthId: 'HID-2026-00002',
    patientName: 'Anita Roy',
    ownerUid: 'ajisYN7j6gRRmqWnFuzloQywox8K',
    patientUid: 'ajisYN7j6gRRmqWnFuzloQywox8K',
    bookedByUid: 'ajisYN7j6gRRmqWnFuzloQywox8K',
    doctorId: 'DOC-002',
    doctorName: 'Dr. Rahul Kumar',
    departmentId: 'dept-gen',
    departmentLetter: 'G',
    slotIds: [`DOC-002_${todayStr}_1000`],
    date: todayStr,
    timeSlot: slotTime,
    bookedStartAt: slotTime,
    durationMin: 15,
    visitType: 'new',
    reasonText: 'Seasonal cough and routine consultation',
    complexity: 'simple',
    clinicalLevel: 1,
    urgencySuggested: 'routine',
    status: 'booked',
    tokenNumber: 2,
    tokenLabel: 'G-002',
    checkinCodeHash: codeHash,
    checkInCodeHash: codeHash,
    qrPayload: `APPT:${apptId}:${rawCode}`,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection('appointments').doc(apptId).set(doc, { merge: true });
  console.log(`✅ Seeded backup demo appointment for Anita Roy (ID: ${apptId}, Token: G-002, Doctor: Dr. Rahul Kumar)`);
}

seedBackup().catch(console.error);

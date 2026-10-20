process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.GCLOUD_PROJECT = 'demo-project';
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-project';

async function verifyPreserved() {
  console.log('--- Preserved State Verification ---');
  
  const { db } = await import('../src/config/firebase.js');

  // 1. Appointment HHXQh5IhvyjZRJAancvU
  const apptSnap = await db.collection('appointments').doc('HHXQh5IhvyjZRJAancvU').get();
  console.log('Appointment HHXQh5IhvyjZRJAancvU exists:', apptSnap.exists);
  if (apptSnap.exists) {
    const data = apptSnap.data();
    console.log('Appointment Details:', {
      id: apptSnap.id,
      status: data.status,
      tokenNumber: data.tokenNumber,
      doctorId: data.doctorId,
      patientId: data.patientId
    });
  }

  // 2. Prescription RX-2026-00072
  const rxSnap = await db.collection('prescriptions').where('prescriptionId', '==', 'RX-2026-00072').get();
  console.log('Prescription RX-2026-00072 exists:', !rxSnap.empty);
  if (!rxSnap.empty) {
    console.log('Prescription Details:', {
      docId: rxSnap.docs[0].id,
      prescriptionId: rxSnap.docs[0].data().prescriptionId,
      status: rxSnap.docs[0].data().status
    });
  }

  // 3. Phase 70 Leave for DOC-003
  const leaveSnap = await db.collection('leaves').where('doctorId', '==', 'DOC-003').get();
  console.log('Doctor Leave records for DOC-003:', leaveSnap.size);
  leaveSnap.forEach((d) => console.log('Leave Doc:', d.id, d.data().leaveDate, d.data().status));

  // 4. Waitlist records
  const waitlistSnap = await db.collection('waitlist').get();
  console.log('Waitlist count:', waitlistSnap.size);
  waitlistSnap.forEach((d) => console.log('Waitlist Doc:', d.id, d.data().patientId, d.data().status));

  // 5. Environmental health
  const envRes = await fetch('http://localhost:5000/api/health/env');
  const envData = await envRes.json();
  console.log('Health Env Data:', envData.data);
}

verifyPreserved().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();
const auth = admin.auth();

async function testDuplicate() {
  console.log('Testing duplicate booking prevention on slot DOC-002_2026-10-09_0900...');
  
  // 1. Check current slot state
  const slotDoc = (await db.collection('slots').doc('DOC-002_2026-10-09_0900').get()).data();
  console.log(`Slot status in Firestore: ${slotDoc.status}`);
  console.log(`Slot appointmentId: ${slotDoc.appointmentId}`);

  // 2. Mint emulator custom token & exchange for ID token, or test booking controller logic
  const user = await auth.getUserByEmail('john.doe@smartcare-demo.com');
  const customToken = await auth.createCustomToken(user.uid);
  
  // Exchange custom token for ID token via Auth Emulator
  const tokenRes = await fetch(`http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const tokenData = await tokenRes.json();
  const idToken = tokenData.idToken;
  console.log(`Obtained ID token for John Doe (${user.uid}) from Auth Emulator.`);

  // 3. Attempt to book the same slot again
  const bookRes = await fetch('http://localhost:5000/api/appointments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({
      slotIds: ['DOC-002_2026-10-09_0900'],
      patientHealthId: 'HID-2026-00001',
      patientName: 'John Doe',
      doctorId: 'DOC-002',
      doctorName: 'Dr. Rahul Kumar',
      departmentId: 'dept-gen',
      date: '2026-10-09',
      reasonText: 'Attempting duplicate booking of same slot',
      disclaimerAck: { acknowledged: true }
    })
  });

  const bookBody = await bookRes.json();
  console.log(`Duplicate booking response HTTP Status: ${bookRes.status}`);
  console.log(`Duplicate booking response body:`, bookBody);

  const passed = bookRes.status === 409 && (bookBody.error?.code === 'SLOT_TAKEN' || bookBody.message?.includes('already booked'));
  console.log(`\nDuplicate booking protection PASS/FAIL: ${passed ? 'PASS' : 'FAIL'}`);
}

testDuplicate().catch(console.error);

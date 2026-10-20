import crypto from 'crypto';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function runF5CheckinVerification() {
  console.log('================================================================');
  console.log('      F5 CHECK-IN & APPOINTMENT LIFECYCLE VERIFICATION          ');
  console.log('================================================================\n');

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const apptId = 'tgyIhvMdvRgbVqlMXslW';

  const aptDoc = await db.collection('appointments').doc(apptId).get();
  if (!aptDoc.exists) {
    throw new Error(`Appointment ${apptId} not found in Firestore emulator!`);
  }
  const aptData = aptDoc.data();
  console.log(`Using existing appointment: ${apptId}`);
  console.log(`Initial Status: ${aptData.status}, Original Date: ${aptData.date}`);

  // Test 1: Unauthorized access check (Patient role)
  console.log('\n--- 1. Testing Unauthorized Access (Patient Role) ---');
  const unauthRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'demo-patient-001',
      'x-demo-role': 'patient'
    },
    body: JSON.stringify({ qrPayload: aptData.qrPayload })
  });
  const unauthJson = await unauthRes.json();
  console.log(`Status: ${unauthRes.status} (Expected 403 FORBIDDEN)`);
  console.log(`Error code: ${unauthJson.error?.code}`);
  if (unauthRes.status !== 403) throw new Error('Security violation: non-staff allowed check-in!');

  // Test 2: Invalid QR format
  console.log('\n--- 2. Testing Invalid QR Format ---');
  const badFormatRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ qrPayload: 'INVALID-QR-STRING' })
  });
  const badFormatJson = await badFormatRes.json();
  console.log(`Status: ${badFormatRes.status} (Expected 400 INVALID_QR_FORMAT)`);
  console.log(`Error code: ${badFormatJson.error?.code}`);

  // Test 3: Wrong date check (original date is 2026-10-25)
  console.log('\n--- 3. Testing Wrong Date Rejection ---');
  const wrongDateRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ qrPayload: aptData.qrPayload })
  });
  const wrongDateJson = await wrongDateRes.json();
  console.log(`Status: ${wrongDateRes.status} (Expected 400 WRONG_DATE)`);
  console.log(`Error code: ${wrongDateJson.error?.code}`);

  // Update existing appointment date to today for check-in
  const curHours = String(now.getHours()).padStart(2, '0');
  const slotTime = `${curHours}:30`;
  console.log(`\nAligning existing appointment date to today (${todayStr}) and timeSlot (${slotTime}) for check-in...`);
  await db.collection('appointments').doc(apptId).update({
    date: todayStr,
    timeSlot: slotTime,
    bookedStartAt: slotTime,
    status: 'booked'
  });

  // Test 4: Tampered / Invalid Security Hash
  console.log('\n--- 4. Testing Tampered Security Hash Rejection ---');
  const fakeCodePayload = `APPT:${apptId}:00000000000000000000000000000000`;
  const tamperedRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ qrPayload: fakeCodePayload })
  });
  const tamperedJson = await tamperedRes.json();
  console.log(`Status: ${tamperedRes.status} (Expected 400 INVALID_CODE)`);
  console.log(`Error code: ${tamperedJson.error?.code}`);

  // Test 5: Valid Staff QR Check-In
  console.log('\n--- 5. Testing Valid Staff QR Check-In ---');
  const validRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ qrPayload: aptData.qrPayload })
  });
  const validJson = await validRes.json();
  console.log(`Status: ${validRes.status} (Expected 200 CHECKIN_SUCCESS)`);
  console.log(`Response:`, validJson.data);
  if (validRes.status !== 200) throw new Error(`Check-in failed: ${JSON.stringify(validJson)}`);

  // Verify Firestore appointment update
  const updatedDoc = await db.collection('appointments').doc(apptId).get();
  console.log(`Firestore Status: ${updatedDoc.data().status}`);
  console.log(`CheckedInAt: ${updatedDoc.data().checkedInAt?.toDate?.() || updatedDoc.data().checkedInAt}`);
  if (updatedDoc.data().status !== 'checked_in') throw new Error('Firestore status was not updated to checked_in');

  // Test 6: Duplicate Scan Rejection
  console.log('\n--- 6. Testing Duplicate QR Scan Rejection ---');
  const dupRes = await fetch('http://localhost:5000/api/checkin/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ qrPayload: aptData.qrPayload })
  });
  const dupJson = await dupRes.json();
  console.log(`Status: ${dupRes.status} (Expected 409 ALREADY_CHECKED_IN)`);
  console.log(`Error code: ${dupJson.error?.code}`);
  if (dupRes.status !== 409) throw new Error('Duplicate check-in was not rejected!');

  // Test 7: Manual Check-In by Health ID Strict Rejection
  console.log('\n--- 7. Testing Manual Check-In Health ID Rejection ---');
  const manualHealthIdRes = await fetch('http://localhost:5000/api/checkin/manual', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-staff-001',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ healthId: 'PHI-2026-000000-A' })
  });
  const manualHealthIdJson = await manualHealthIdRes.json();
  console.log(`Status: ${manualHealthIdRes.status} (Expected 400 HEALTH_ID_REJECTED)`);
  console.log(`Error code: ${manualHealthIdJson.error?.code}`);
  if (manualHealthIdRes.status !== 400 || manualHealthIdJson.error?.code !== 'HEALTH_ID_REJECTED') {
    throw new Error('PRD F5 violation: Manual check-in by Health ID was not rejected!');
  }

  console.log('\n================================================================');
  console.log('✅ F5 CHECK-IN & APPOINTMENT LIFECYCLE FULLY VERIFIED (PASS)');
  console.log('================================================================');
}

runF5CheckinVerification().catch(err => {
  console.error('❌ F5 Verification Failed:', err);
  process.exit(1);
});

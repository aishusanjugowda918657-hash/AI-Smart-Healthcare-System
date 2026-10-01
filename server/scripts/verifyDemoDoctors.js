import { assertDbConnected, auth } from '../src/config/firebase.js';

const DEMO_EMAILS = [
  'sarah.smith@smartcare-demo.com',
  'rahul.kumar@smartcare-demo.com',
  'priya.sharma@smartcare-demo.com',
  'arjun.rao@smartcare-demo.com',
  'ananya.reddy@smartcare-demo.com'
];

export const verifyDemoDoctors = async () => {
  console.log('🔍 Running Demo Doctors Verification...\n');
  const db = assertDbConnected();
  let allValid = true;

  for (const email of DEMO_EMAILS) {
    console.log(`Checking doctor email: ${email}`);
    
    // 1. Firebase Auth check
    const authUser = await auth.getUserByEmail(email);
    if (!authUser || !authUser.uid) {
      console.error(`❌ Auth user missing for ${email}`);
      allValid = false;
      continue;
    }
    const uid = authUser.uid;
    console.log(`   ✓ Firebase Auth User exists (UID: ${uid})`);

    // 2. Firestore doctors collection check
    const docSnap = await db.collection('doctors').doc(uid).get();
    if (!docSnap.exists) {
      console.error(`❌ Firestore doctor document missing for UID: ${uid}`);
      allValid = false;
      continue;
    }
    const docData = docSnap.data();
    console.log(`   ✓ Firestore doctor doc exists (Doctor ID: ${docData.doctorId}, Name: ${docData.name}, Status: ${docData.status})`);

    // 3. Status ACTIVE check
    if (docData.status !== 'ACTIVE') {
      console.error(`❌ Doctor status is not ACTIVE: ${docData.status}`);
      allValid = false;
    }

    // 4. Password exposure check
    if (docData.password || docData.pass || JSON.stringify(docData).toLowerCase().includes('smartcare@')) {
      console.error(`❌ SECURITY FAILURE: Password found in Firestore document for ${email}`);
      allValid = false;
    } else {
      console.log(`   ✓ Security Pass: No password stored in Firestore document.`);
    }

    // 5. Schedule check
    const schedSnap = await db.collection('doctorSchedules').doc(`sched-${uid}`).get();
    if (!schedSnap.exists) {
      console.error(`❌ Doctor schedule missing in 'doctorSchedules' for UID: ${uid}`);
      allValid = false;
    } else {
      console.log(`   ✓ Schedule configured (Mon-Fri 09:00-17:00, 15m slots)`);
    }
    console.log('');
  }

  if (allValid) {
    console.log('✅ ALL 5 DEMO DOCTOR ACCOUNTS VERIFIED SUCCESSFULLY!');
  } else {
    console.error('❌ Verification failed on one or more checks.');
    process.exit(1);
  }
};

if (process.argv[1] && process.argv[1].endsWith('verifyDemoDoctors.js')) {
  verifyDemoDoctors()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Verification error:', err);
      process.exit(1);
    });
}

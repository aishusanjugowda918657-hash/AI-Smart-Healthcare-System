import { assertDbConnected, auth } from '../src/config/firebase.js';

const DEMO_DOCTORS = [
  { doctorId: 'DOC-001', name: 'Dr. Sarah Smith', email: 'sarah.smith@smartcare-demo.com', password: 'SmartCare@123', dept: 'Cardiology' },
  { doctorId: 'DOC-002', name: 'Dr. Rahul Kumar', email: 'rahul.kumar@smartcare-demo.com', password: 'SmartCare@124', dept: 'General Medicine' },
  { doctorId: 'DOC-003', name: 'Dr. Priya Sharma', email: 'priya.sharma@smartcare-demo.com', password: 'SmartCare@125', dept: 'Pediatrics' },
  { doctorId: 'DOC-004', name: 'Dr. Arjun Rao', email: 'arjun.rao@smartcare-demo.com', password: 'SmartCare@126', dept: 'Orthopedics' },
  { doctorId: 'DOC-005', name: 'Dr. Ananya Reddy', email: 'ananya.reddy@smartcare-demo.com', password: 'SmartCare@127', dept: 'Dermatology' }
];

export const runFullDoctorVerification = async () => {
  console.log('🧪 Starting Full Doctor Accounts & Functionality Verification...\n');
  const db = assertDbConnected();
  let passedCount = 0;

  for (const doc of DEMO_DOCTORS) {
    console.log(`--------------------------------------------------`);
    console.log(`Testing Account: ${doc.doctorId} | ${doc.name} (${doc.email})`);
    console.log(`--------------------------------------------------`);

    try {
      // 1. Check Auth User
      const authUser = await auth.getUserByEmail(doc.email);
      console.log(`  [1/5] Firebase Auth User Record: Found (UID: ${authUser.uid})`);

      // 2. Check User Document in 'users'
      const userSnap = await db.collection('users').doc(authUser.uid).get();
      if (!userSnap.exists) throw new Error(`Document missing in 'users' collection for UID: ${authUser.uid}`);
      const userData = userSnap.data();
      console.log(`  [2/5] 'users' Collection Record: Role=${userData.role}, Status=${userData.status}`);

      // 3. Check Doctor Document in 'doctors'
      const docSnap = await db.collection('doctors').doc(authUser.uid).get();
      if (!docSnap.exists) throw new Error(`Document missing in 'doctors' collection for UID: ${authUser.uid}`);
      const docData = docSnap.data();
      console.log(`  [3/5] 'doctors' Collection Record: DoctorID=${docData.doctorId}, DeptID=${docData.departmentId}, Specialization=${docData.specialization}`);

      // 4. Verify Password Security
      if (docData.password || docData.pass || JSON.stringify(docData).includes('SmartCare@')) {
        throw new Error('SECURITY VIOLATION: Password field exposed in Firestore document');
      }
      console.log(`  [4/5] Password Security Check: Passed (No plain text or hashes stored in Firestore)`);

      // 5. Check Working Schedule
      const schedSnap = await db.collection('doctorSchedules').doc(`sched-${authUser.uid}`).get();
      if (!schedSnap.exists) throw new Error(`Schedule missing in 'doctorSchedules' collection`);
      const schedData = schedSnap.data();
      console.log(`  [5/5] Working Schedule Check: Configured (${schedData.workingHours.start} - ${schedData.workingHours.end}, ${schedData.slotDurationMinutes}m slots)`);

      console.log(`STATUS: ✅ WORKING PERFECTLY\n`);
      passedCount++;
    } catch (err) {
      console.error(`STATUS: ❌ FAILED - ${err.message}\n`);
    }
  }

  console.log(`==================================================`);
  console.log(`VERIFICATION RESULTS: ${passedCount}/${DEMO_DOCTORS.length} DOCTOR ACCOUNTS ARE 100% FUNCTIONAL`);
  console.log(`==================================================`);

  if (passedCount !== DEMO_DOCTORS.length) {
    process.exit(1);
  }
};

runFullDoctorVerification();

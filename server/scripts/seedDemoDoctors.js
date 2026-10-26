import { assertDbConnected, auth } from '../src/config/firebase.js';
import { generateSlotsJob } from '../src/jobs/scheduler.js';
import { assignBatchDoctorDisplayIds } from '../src/services/doctorDisplayIdService.js';

const DEMO_DOCTORS = [
  {
    doctorId: 'DOC-001',
    name: 'Dr. Sarah Smith',
    email: 'sarah.smith@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9000000101',
    departmentName: 'Cardiology',
    deptId: 'dept-card',
    deptCode: 'CARD',
    specialization: 'Cardiology',
    qualification: 'MBBS, MD',
    experience: '8 years'
  },
  {
    doctorId: 'DOC-002',
    name: 'Dr. Rahul Kumar',
    email: 'rahul.kumar@smartcare-demo.com',
    password: 'SmartCare@124',
    phone: '9000000102',
    departmentName: 'General Medicine',
    deptId: 'dept-gen',
    deptCode: 'GEN',
    specialization: 'General Medicine',
    qualification: 'MBBS, MD',
    experience: '7 years'
  },
  {
    doctorId: 'DOC-006',
    name: 'Dr. Vikram Patel',
    email: 'vikram.patel@smartcare-demo.com',
    password: 'SmartCare@128',
    phone: '9000000106',
    departmentName: 'General Medicine',
    deptId: 'dept-gen',
    deptCode: 'GEN',
    specialization: 'General Medicine',
    qualification: 'MBBS, MD (Gen Med)',
    experience: '10 years'
  },
  {
    doctorId: 'DOC-003',
    name: 'Dr. Priya Sharma',
    email: 'priya.sharma@smartcare-demo.com',
    password: 'SmartCare@125',
    phone: '9000000103',
    departmentName: 'Pediatrics',
    deptId: 'dept-ped',
    deptCode: 'PED',
    specialization: 'Pediatrics',
    qualification: 'MBBS, MD Pediatrics',
    experience: '6 years'
  },
  {
    doctorId: 'DOC-004',
    name: 'Dr. Arjun Rao',
    email: 'arjun.rao@smartcare-demo.com',
    password: 'SmartCare@126',
    phone: '9000000104',
    departmentName: 'Orthopedics',
    deptId: 'dept-ortho',
    deptCode: 'ORTHO',
    specialization: 'Orthopedics',
    qualification: 'MBBS, MS Orthopedics',
    experience: '10 years'
  },
  {
    doctorId: 'DOC-005',
    name: 'Dr. Ananya Reddy',
    email: 'ananya.reddy@smartcare-demo.com',
    password: 'SmartCare@127',
    phone: '9000000105',
    departmentName: 'Dermatology',
    deptId: 'dept-derm',
    deptCode: 'DERM',
    specialization: 'Dermatology',
    qualification: 'MBBS, MD Dermatology',
    experience: '5 years'
  }
];

const DEPARTMENTS = [
  { id: 'dept-card', name: 'Cardiology', code: 'CARD', description: 'Heart care, ECG, and cardiovascular consultations.' },
  { id: 'dept-gen', name: 'General Medicine', code: 'GEN', description: 'Primary health consultations and routine care.' },
  { id: 'dept-ped', name: 'Pediatrics', code: 'PED', description: 'Child healthcare and vaccinations.' },
  { id: 'dept-derm', name: 'Dermatology', code: 'DERM', description: 'Skin, hair, and cosmetic medical consultations.' },
  { id: 'dept-ortho', name: 'Orthopedics', code: 'ORTHO', description: 'Bone, joint, and musculoskeletal care.' }
];

export const seedDemoDoctors = async ({ skipSlots = false, days = 14 } = {}) => {
  console.log('🩺 Starting Demo Doctors Setup Script...\n');

  const db = assertDbConnected();
  const summary = [];

  // 1. Check and create required departments
  console.log('🏢 Step 1: Checking & Provisioning Medical Departments...');
  for (const dept of DEPARTMENTS) {
    const deptRef = db.collection('departments').doc(dept.id);
    const deptDoc = await deptRef.get();
    if (!deptDoc.exists) {
      await deptRef.set({
        id: dept.id,
        name: dept.name,
        code: dept.code,
        description: dept.description,
        active: true,
        createdAt: new Date()
      });
      console.log(`   + Created Department: ${dept.name} (${dept.id})`);
    } else {
      console.log(`   ✓ Reusing Existing Department: ${dept.name} (${dept.id})`);
    }
  }

  console.log('\n👨‍⚕️ Step 2: Provisioning 5 Demo Doctor Accounts...');

  const doctorsWithDisplayId = assignBatchDoctorDisplayIds(DEMO_DOCTORS);
  for (const doc of doctorsWithDisplayId) {
    let uid;
    let accountStatus = 'CREATED';

    // Step A: Firebase Auth user management
    if (auth) {
      try {
        const existingAuthUser = await auth.getUserByEmail(doc.email);
        uid = existingAuthUser.uid;
        accountStatus = 'ALREADY EXISTS';
        // Ensure password & display name are updated cleanly for demo testing
        await auth.updateUser(uid, {
          password: doc.password,
          displayName: doc.name
        });
        accountStatus = 'UPDATED';
      } catch (authErr) {
        if (authErr.code === 'auth/user-not-found') {
          const newAuthUser = await auth.createUser({
            email: doc.email,
            password: doc.password,
            displayName: doc.name
          });
          uid = newAuthUser.uid;
          accountStatus = 'CREATED';
        } else {
          console.error(`❌ Firebase Auth error for ${doc.email}:`, authErr.message);
          throw authErr;
        }
      }
    } else {
      uid = `doc-uid-${doc.doctorId.toLowerCase()}`;
    }

    // Step B: Set/Merge record in 'users' collection
    const userRef = db.collection('users').doc(uid);
    const existingUserDoc = await userRef.get();
    
    await userRef.set({
      uid,
      email: doc.email,
      role: 'doctor',
      fullName: doc.name,
      status: 'ACTIVE',
      mustChangePassword: false,
      createdAt: existingUserDoc.exists ? (existingUserDoc.data().createdAt || new Date()) : new Date(),
      updatedAt: new Date()
    }, { merge: true });

    // Step C: Set/Merge record in 'doctors' collection
    const doctorRef = db.collection('doctors').doc(uid);
    const existingDoctorDoc = await doctorRef.get();

    // Field structure satisfying both prompt requirements & existing project schema
    const doctorProfile = {
      doctorId: doc.doctorId,
      displayId: doc.displayId,
      doctorDisplayId: doc.displayId,
      uid: uid,
      doctorUid: uid,
      name: doc.name,
      fullName: doc.name,
      email: doc.email,
      phone: doc.phone,
      departmentId: doc.deptId,
      specialization: doc.specialization,
      qualification: doc.qualification,
      experience: doc.experience,
      experienceYears: parseInt(doc.experience) || 5,
      status: 'ACTIVE',
      firstLogin: false,
      mustChangePassword: false,
      createdAt: existingDoctorDoc.exists ? (existingDoctorDoc.data().createdAt || new Date()) : new Date(),
      updatedAt: new Date()
    };

    await doctorRef.set(doctorProfile, { merge: true });

    // Step D: Ensure Doctor Schedule exists in 'doctorSchedules'
    const schedRef = db.collection('doctorSchedules').doc(`sched-${uid}`);
    const schedDoc = await schedRef.get();
    if (!schedDoc.exists) {
      await schedRef.set({
        id: `sched-${uid}`,
        doctorUid: uid,
        doctorId: doc.doctorId,
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: '09:00', end: '17:00' },
        slotDurationMinutes: 15,
        breakTimes: [{ start: '13:00', end: '14:00' }],
        leaves: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    summary.push({
      id: doc.doctorId,
      name: doc.name,
      email: doc.email,
      status: 'ACTIVE',
      actionStatus: accountStatus
    });
  }

  // Step E: Trigger automatic slot generation for all doctors
  if (!skipSlots) {
    console.log(`\n📅 Step 3: Generating Bookable Slots for Next ${days} Days...`);
    try {
      const slotGenResult = await generateSlotsJob(days);
      console.log(`   + Slot generation complete: ${slotGenResult.totalSlots || 0} slots created/verified.`);
    } catch (slotErr) {
      console.warn('   ⚠️ Slot generation warning:', slotErr.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('           DEMO DOCTOR SETUP COMPLETE           ');
  console.log('='.repeat(60) + '\n');

  for (const s of summary) {
    console.log(`${s.id} | ${s.name.padEnd(16)} | ${s.email.padEnd(31)} | ${s.status} | ${s.actionStatus}`);
  }

  console.log('\n' + '='.repeat(60) + '\n');
  return summary;
};

// Execute if run directly from node CLI
if (process.argv[1] && process.argv[1].endsWith('seedDemoDoctors.js')) {
  seedDemoDoctors()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error executing seedDemoDoctors:', err);
      process.exit(1);
    });
}

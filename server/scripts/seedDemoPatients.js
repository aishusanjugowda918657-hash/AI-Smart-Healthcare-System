import { assertDbConnected, auth } from '../src/config/firebase.js';

const DEMO_PATIENTS = [
  {
    healthId: 'HID-2026-00001',
    fullName: 'John Doe',
    email: 'john.doe@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9876543210',
    dob: '1990-05-15',
    gender: 'male',
    bloodGroup: 'O+',
    emergencyContact: { name: 'Jane Doe', phone: '9876543211', relationship: 'Spouse' },
    allergies: ['Penicillin', 'Dust Mites'],
    existingConditions: ['Hypertension', 'Mild Asthma'],
    address: '123 Main Street, North Wing, City'
  },
  {
    healthId: 'HID-2026-00002',
    fullName: 'Anita Roy',
    email: 'anita.roy@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9876543220',
    dob: '1985-08-22',
    gender: 'female',
    bloodGroup: 'A+',
    emergencyContact: { name: 'Rohan Roy', phone: '9876543221', relationship: 'Brother' },
    allergies: ['Sulfa Drugs', 'Peanuts'],
    existingConditions: ['Type 2 Diabetes', 'Thyroid'],
    address: '45 Park Avenue, East Wing, City'
  },
  {
    healthId: 'HID-2026-00003',
    fullName: 'Rajesh Verma',
    email: 'rajesh.verma@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9876543230',
    dob: '1978-11-04',
    gender: 'male',
    bloodGroup: 'B+',
    emergencyContact: { name: 'Sunita Verma', phone: '9876543231', relationship: 'Wife' },
    allergies: ['Aspirin'],
    existingConditions: ['Coronary Artery Disease', 'High Cholesterol'],
    address: '78 Green Avenue, South Wing, City'
  },
  {
    healthId: 'HID-2026-00004',
    fullName: 'Kavita Patel',
    email: 'kavita.patel@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9876543240',
    dob: '1995-03-12',
    gender: 'female',
    bloodGroup: 'AB+',
    emergencyContact: { name: 'Sanjay Patel', phone: '9876543241', relationship: 'Father' },
    allergies: ['None'],
    existingConditions: ['Eczema'],
    address: '12 Lakeview Road, West Wing, City'
  },
  {
    healthId: 'HID-2026-00005',
    fullName: 'Aarav Mehta',
    email: 'aarav.mehta@smartcare-demo.com',
    password: 'SmartCare@123',
    phone: '9876543250',
    dob: '2018-06-30',
    gender: 'male',
    bloodGroup: 'O-',
    emergencyContact: { name: 'Meera Mehta', phone: '9876543251', relationship: 'Mother' },
    allergies: ['Lactose'],
    existingConditions: ['Seasonal Allergies'],
    address: '90 Hillside Enclave, Central Wing, City'
  }
];

export const seedDemoPatients = async () => {
  console.log('🩺 Starting Seed Demo Patients Script...\n');
  const db = assertDbConnected();
  const summary = [];

  for (let i = 0; i < DEMO_PATIENTS.length; i++) {
    const p = DEMO_PATIENTS[i];
    let uid;
    let statusAction = 'CREATED';

    // 1. Firebase Auth user check/create
    if (auth) {
      try {
        const existingAuth = await auth.getUserByEmail(p.email);
        uid = existingAuth.uid;
        statusAction = 'ALREADY EXISTS';
        await auth.updateUser(uid, {
          password: p.password,
          displayName: p.fullName
        });
        statusAction = 'UPDATED';
      } catch (authErr) {
        if (authErr.code === 'auth/user-not-found') {
          const newAuth = await auth.createUser({
            email: p.email,
            password: p.password,
            displayName: p.fullName
          });
          uid = newAuth.uid;
          statusAction = 'CREATED';
        } else {
          throw authErr;
        }
      }
    } else {
      uid = `demo-patient-00${i + 1}`;
    }

    // 2. Set user doc in 'users' collection
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    await userRef.set({
      uid,
      email: p.email,
      role: 'patient',
      fullName: p.fullName,
      displayName: p.fullName,
      patientHealthId: p.healthId,
      status: 'ACTIVE',
      createdAt: userSnap.exists ? (userSnap.data().createdAt || new Date()) : new Date(),
      updatedAt: new Date()
    }, { merge: true });

    // 3. Set patient doc in 'patients' collection
    const patientRef = db.collection('patients').doc(uid);
    const patientSnap = await patientRef.get();

    const patientRecord = {
      patientUid: uid,
      ownerUid: uid,
      relation: 'self',
      patientHealthId: p.healthId,
      healthId: p.healthId,
      fullName: p.fullName,
      name: p.fullName,
      nameLower: p.fullName.toLowerCase(),
      searchName: p.fullName.toLowerCase(),
      email: p.email,
      phone: p.phone,
      dob: p.dob,
      gender: p.gender,
      bloodGroup: p.bloodGroup,
      emergencyContact: p.emergencyContact,
      allergies: p.allergies,
      existingConditions: p.existingConditions,
      address: p.address,
      profileCompleted: true,
      consentStatus: true,
      createdAt: patientSnap.exists ? (patientSnap.data().createdAt || new Date()) : new Date(),
      updatedAt: new Date()
    };

    await patientRef.set(patientRecord, { merge: true });

    summary.push({
      healthId: p.healthId,
      name: p.fullName,
      email: p.email,
      phone: p.phone,
      status: statusAction
    });

    console.log(`   ✓ Provisioned Patient [${p.healthId}]: ${p.fullName} (${p.email}) - ${statusAction}`);
  }

  // Update Health ID Counter
  await db.collection('counters').doc('patientHealthId').set({ currentValue: 5 }, { merge: true });

  console.log('\n' + '='.repeat(65));
  console.log('           DEMO PATIENT PROFILES SETUP COMPLETE           ');
  console.log('='.repeat(65) + '\n');

  for (const s of summary) {
    console.log(`${s.healthId} | ${s.name.padEnd(14)} | ${s.email.padEnd(28)} | ${s.phone} | ${s.status}`);
  }

  console.log('\n' + '='.repeat(65) + '\n');
  return summary;
};

if (process.argv[1] && process.argv[1].endsWith('seedDemoPatients.js')) {
  seedDemoPatients()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error executing seedDemoPatients:', err);
      process.exit(1);
    });
}

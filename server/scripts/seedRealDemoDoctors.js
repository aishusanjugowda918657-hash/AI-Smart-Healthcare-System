import admin from 'firebase-admin';
import { generateSlotsJob } from '../src/jobs/scheduler.js';
import { assignBatchDoctorDisplayIds } from '../src/services/doctorDisplayIdService.js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables manually if needed
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GCLOUD_PROJECT || 'ai-basedsmarthealthcaresystem' // Explicitly set REAL project ID just in case
  });
}

const db = admin.firestore();
const auth = admin.auth();

const DEPARTMENTS = [
  { id: 'dept-gen', name: 'General Medicine', code: 'GEN', description: 'Primary health consultations and routine care.' },
  { id: 'dept-card', name: 'Cardiology', code: 'CARD', description: 'Heart care, ECG, and cardiovascular consultations.' },
  { id: 'dept-ortho', name: 'Orthopaedics', code: 'ORTHO', description: 'Bone, joint, and musculoskeletal care.' },
  { id: 'dept-gastro', name: 'Gastroenterology', code: 'GASTRO', description: 'Digestive system, stomach, and liver disorders.' },
  { id: 'dept-nephro', name: 'Nephrology', code: 'NEPHRO', description: 'Kidney care, dialysis, and transplant.' },
  { id: 'dept-neuro', name: 'Neurology & Neurosurgery', code: 'NEURO', description: 'Brain, spine, and nervous system care.' },
  { id: 'dept-onco', name: 'Oncology', code: 'ONCO', description: 'Cancer care, chemotherapy, and radiation therapy.' },
  { id: 'dept-obgyn', name: 'Obstetrics & Gynaecology', code: 'OBGYN', description: 'Women\'s health, pregnancy, and childbirth care.' }
];

const DOCTORS = [
  {
    doctorId: 'DOC-REAL-001', name: 'Dr. Aarti Sunil Kamath', email: 'generalmedicine01@smarthealthcare.demo',
    departmentName: 'General Medicine', deptId: 'dept-gen',
    expertise: ['General Medicine', 'Diabetes', 'Hypertension', 'Infectious Diseases', 'Chronic Disease Management'],
    qualification: 'MD General Medicine', experience: '12 years'
  },
  {
    doctorId: 'DOC-REAL-002', name: 'Dr. Anurag Ranjan', email: 'generalmedicine02@smarthealthcare.demo',
    departmentName: 'General Medicine', deptId: 'dept-gen',
    expertise: ['General Medicine', 'Fever', 'Infections', 'Diabetes', 'Hypertension', 'Preventive Care'],
    qualification: 'MD General Medicine', experience: '10 years'
  },
  {
    doctorId: 'DOC-REAL-003', name: 'Dr. Anusha Sharma P S', email: 'generalmedicine03@smarthealthcare.demo',
    departmentName: 'General Medicine', deptId: 'dept-gen',
    expertise: ['General Medicine', 'Adult Critical Care', 'Diabetology', 'Infectious Diseases', 'Metabolic Disorders'],
    qualification: 'MD General Medicine', experience: '14 years'
  },
  {
    doctorId: 'DOC-REAL-004', name: 'Dr. Aditi Singhvi', email: 'cardiology01@smarthealthcare.demo',
    departmentName: 'Cardiology', deptId: 'dept-card',
    expertise: ['Cardiology', 'Heart Failure', 'Cardiac Care', 'Hypertension', 'Heart Disease'],
    qualification: 'DM Cardiology', experience: '15 years'
  },
  {
    doctorId: 'DOC-REAL-005', name: 'Dr. Arun B S', email: 'cardiology02@smarthealthcare.demo',
    departmentName: 'Cardiology', deptId: 'dept-card',
    expertise: ['Adult Cardiology', 'Interventional Cardiology', 'Coronary Artery Disease', 'Angioplasty', 'Hypertension'],
    qualification: 'DM Cardiology', experience: '18 years'
  },
  {
    doctorId: 'DOC-REAL-006', name: 'Dr. Arunkumar Ullegaddi', email: 'cardiology03@smarthealthcare.demo',
    departmentName: 'Cardiology', deptId: 'dept-card',
    expertise: ['Adult Cardiology', 'Interventional Cardiology', 'Coronary Artery Disease', 'Arrhythmia', 'Cardiac Procedures'],
    qualification: 'DM Cardiology', experience: '16 years'
  },
  {
    doctorId: 'DOC-REAL-007', name: 'Dr. Abhinandan S Punit', email: 'orthopaedics01@smarthealthcare.demo',
    departmentName: 'Orthopaedics', deptId: 'dept-ortho',
    expertise: ['Orthopaedic Surgery', 'Joint Replacement', 'Robotic Orthopaedic Surgery', 'Knee Problems', 'Hip Problems'],
    qualification: 'MS Orthopaedics', experience: '20 years'
  },
  {
    doctorId: 'DOC-REAL-008', name: 'Dr. K S Kushalappa', email: 'orthopaedics02@smarthealthcare.demo',
    departmentName: 'Orthopaedics', deptId: 'dept-ortho',
    expertise: ['Orthopaedic Surgery', 'Shoulder Surgery', 'Joint Pain', 'Arthritis', 'Sports Injuries'],
    qualification: 'MS Orthopaedics', experience: '22 years'
  },
  {
    doctorId: 'DOC-REAL-009', name: 'Dr. Naveen V', email: 'orthopaedics03@smarthealthcare.demo',
    departmentName: 'Orthopaedics', deptId: 'dept-ortho',
    expertise: ['Orthopaedic Surgery', 'Spine Surgery', 'Back Pain', 'Joint Problems', 'Fracture Management'],
    qualification: 'MS Orthopaedics', experience: '19 years'
  },
  {
    doctorId: 'DOC-REAL-010', name: 'Dr. Aditi Rao', email: 'gastro01@smarthealthcare.demo',
    departmentName: 'Gastroenterology', deptId: 'dept-gastro',
    expertise: ['Medical Gastroenterology', 'Gastritis', 'GERD', 'Digestive Disorders', 'Liver Disorders'],
    qualification: 'DM Gastroenterology', experience: '15 years'
  },
  {
    doctorId: 'DOC-REAL-011', name: 'Dr. Balaji Laxminarayanshetty', email: 'gastro02@smarthealthcare.demo',
    departmentName: 'Gastroenterology', deptId: 'dept-gastro',
    expertise: ['Medical Gastroenterology', 'Endoscopy', 'Liver Disease', 'GERD', 'Gastrointestinal Disorders'],
    qualification: 'DM Gastroenterology', experience: '17 years'
  },
  {
    doctorId: 'DOC-REAL-012', name: 'Dr. Kiran B', email: 'gastro03@smarthealthcare.demo',
    departmentName: 'Gastroenterology', deptId: 'dept-gastro',
    expertise: ['Gastroenterology', 'Gastritis', 'Ulcers', 'Liver Disease', 'Digestive Disorders'],
    qualification: 'DM Gastroenterology', experience: '14 years'
  },
  {
    doctorId: 'DOC-REAL-013', name: 'Dr. Ganesh Srinivasa Prasad P', email: 'nephrology01@smarthealthcare.demo',
    departmentName: 'Nephrology', deptId: 'dept-nephro',
    expertise: ['Nephrology', 'Chronic Kidney Disease', 'Kidney Disorders', 'Dialysis', 'Transplant Nephrology'],
    qualification: 'DM Nephrology', experience: '20 years'
  },
  {
    doctorId: 'DOC-REAL-014', name: 'Dr. Limesh M', email: 'nephrology02@smarthealthcare.demo',
    departmentName: 'Nephrology', deptId: 'dept-nephro',
    expertise: ['Nephrology', 'Transplant Nephrology', 'Chronic Kidney Disease', 'Renal Failure', 'Dialysis Care'],
    qualification: 'DM Nephrology', experience: '18 years'
  },
  {
    doctorId: 'DOC-REAL-015', name: 'Dr. Nithin J', email: 'nephrology03@smarthealthcare.demo',
    departmentName: 'Nephrology', deptId: 'dept-nephro',
    expertise: ['Nephrology', 'Transplant Nephrology', 'Kidney Disease', 'Renal Failure', 'Dialysis'],
    qualification: 'DM Nephrology', experience: '16 years'
  },
  {
    doctorId: 'DOC-REAL-016', name: 'Dr. Akash J', email: 'neurology01@smarthealthcare.demo',
    departmentName: 'Neurology & Neurosurgery', deptId: 'dept-neuro',
    specialization: 'Neurology',
    expertise: ['Interventional Neurology', 'Stroke', 'Neurological Disorders', 'Headache', 'Vascular Neurology'],
    qualification: 'DM Neurology', experience: '14 years'
  },
  {
    doctorId: 'DOC-REAL-017', name: 'Dr. Usha Humbi', email: 'neurology02@smarthealthcare.demo',
    departmentName: 'Neurology & Neurosurgery', deptId: 'dept-neuro',
    specialization: 'Neurology',
    expertise: ['Neurology', 'Epilepsy', 'Seizure Disorders', 'Neurological Disorders', 'Movement Disorders'],
    qualification: 'DM Neurology', experience: '15 years'
  },
  {
    doctorId: 'DOC-REAL-018', name: 'Dr. Akshay Vijay Kulkarni', email: 'neurology03@smarthealthcare.demo',
    departmentName: 'Neurology & Neurosurgery', deptId: 'dept-neuro',
    specialization: 'Neurosurgery',
    expertise: ['Neurosurgery', 'Neuro-Oncology', 'Brain Disorders', 'Spine Disorders', 'Neurosurgical Procedures'],
    qualification: 'MCh Neurosurgery', experience: '18 years'
  },
  {
    doctorId: 'DOC-REAL-019', name: 'Dr. Akshita Singh', email: 'oncology01@smarthealthcare.demo',
    departmentName: 'Oncology', deptId: 'dept-onco',
    expertise: ['Breast Oncology', 'Oncological Surgery', 'Breast Cancer', 'Cancer Care', 'Surgical Oncology'],
    qualification: 'MCh Oncology', experience: '16 years'
  },
  {
    doctorId: 'DOC-REAL-020', name: 'Dr. Hashmath Khanum B N', email: 'oncology02@smarthealthcare.demo',
    departmentName: 'Oncology', deptId: 'dept-onco',
    expertise: ['Radiation Oncology', 'Cancer Treatment', 'Radiation Therapy', 'Cancer Care'],
    qualification: 'MD Radiation Oncology', experience: '19 years'
  },
  {
    doctorId: 'DOC-REAL-021', name: 'Dr. Nidhi Tandon', email: 'oncology03@smarthealthcare.demo',
    departmentName: 'Oncology', deptId: 'dept-onco',
    expertise: ['Medical Oncology', 'Chemotherapy', 'Cancer Care', 'Systemic Cancer Treatment'],
    qualification: 'DM Medical Oncology', experience: '17 years'
  },
  {
    doctorId: 'DOC-REAL-022', name: 'Dr. Anuradha B S', email: 'gynaecology01@smarthealthcare.demo',
    departmentName: 'Obstetrics & Gynaecology', deptId: 'dept-obgyn',
    expertise: ['Gynaecology', 'High-Risk Obstetrics', 'Minimal Access Surgery', 'Women\'s Health', 'Pregnancy Care'],
    qualification: 'MD OBG', experience: '22 years'
  },
  {
    doctorId: 'DOC-REAL-023', name: 'Dr. Kiranmayi S', email: 'gynaecology02@smarthealthcare.demo',
    departmentName: 'Obstetrics & Gynaecology', deptId: 'dept-obgyn',
    expertise: ['Gynaecology', 'High-Risk Obstetrics', 'Minimal Access Surgery', 'Pregnancy Care', 'Women\'s Health'],
    qualification: 'MD OBG', experience: '20 years'
  },
  {
    doctorId: 'DOC-REAL-024', name: 'Dr. Rakshita Bhutale', email: 'gynaecology03@smarthealthcare.demo',
    departmentName: 'Obstetrics & Gynaecology', deptId: 'dept-obgyn',
    expertise: ['Obstetrics & Gynaecology', 'Pregnancy Care', 'Women\'s Health', 'Gynaecological Disorders'],
    qualification: 'MS OBG', experience: '18 years'
  }
];

const PASSWORD = 'SmartHealth@123';

const STANDARD_SCHEDULE = {
  slotMinutes: 15,
  bufferEverySlots: 6,
  weekly: [
    { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
    { dayOfWeek: 6, sessions: [{ start: '09:00', end: '13:00' }] }
  ],
  lunch: { start: '13:00', end: '14:00' }
};

export const seedRealDemoDoctors = async () => {
  console.log('🩺 Starting REAL Firebase Demo Doctors Setup Script...\n');

  // Verify this is the real project
  const projectId = admin.app().options.projectId;
  console.log(`📡 Current Project ID: ${projectId}`);
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('❌ ERROR: Emulator detected! Do NOT run this script against the emulator.');
    process.exit(1);
  }

  let stats = {
    departmentsCreated: 0,
    doctorsCreated: 0,
    authAccountsCreated: 0,
    schedulesCreated: 0,
    slotsCreated: 0,
    duplicatesSkipped: 0
  };

  // 1. Departments
  console.log('\n🏢 Step 1: Checking & Provisioning Medical Departments...');
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
      console.log(`   + Created Department: ${dept.name}`);
      stats.departmentsCreated++;
    } else {
      console.log(`   ✓ Reusing Existing Department: ${dept.name}`);
    }
  }

  // 2. Doctors
  console.log('\n👨‍⚕️ Step 2: Provisioning 24 Demo Doctor Accounts...');
  const doctorsWithDisplayId = assignBatchDoctorDisplayIds(DOCTORS);
  for (const doc of doctorsWithDisplayId) {
    let uid;
    let authCreated = false;

    try {
      const existingAuthUser = await auth.getUserByEmail(doc.email);
      uid = existingAuthUser.uid;
      await auth.updateUser(uid, { password: PASSWORD, displayName: doc.name });
      stats.duplicatesSkipped++;
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        const newAuthUser = await auth.createUser({
          email: doc.email,
          password: PASSWORD,
          displayName: doc.name
        });
        uid = newAuthUser.uid;
        authCreated = true;
        stats.authAccountsCreated++;
      } else {
        throw err;
      }
    }
    
    // Custom claims
    await auth.setCustomUserClaims(uid, { role: 'doctor' });

    // Users Collection
    const userRef = db.collection('users').doc(uid);
    await userRef.set({
      uid,
      email: doc.email,
      role: 'doctor',
      fullName: doc.name,
      displayId: doc.displayId,
      doctorDisplayId: doc.displayId,
      status: 'ACTIVE',
      isDemo: true, // Mark as demo/academic data
      notes: 'DEMO / ACADEMIC DATA',
      updatedAt: new Date()
    }, { merge: true });

    // Doctors Collection
    const doctorRef = db.collection('doctors').doc(uid);
    const doctorDoc = await doctorRef.get();
    
    const doctorProfile = {
      doctorId: doc.doctorId,
      displayId: doc.displayId,
      doctorDisplayId: doc.displayId,
      uid: uid,
      doctorUid: uid,
      name: doc.name,
      fullName: doc.name,
      email: doc.email,
      departmentId: doc.deptId,
      departmentName: doc.departmentName,
      expertise: doc.expertise || [],
      specialization: doc.specialization || doc.departmentName,
      qualification: doc.qualification,
      experienceYears: parseInt(doc.experience) || 10,
      active: true,
      status: 'ACTIVE',
      isDemo: true, // Mark as demo/academic data
      notes: 'DEMO / ACADEMIC DATA',
      schedule: STANDARD_SCHEDULE,
      updatedAt: new Date()
    };
    
    if (!doctorDoc.exists) {
      doctorProfile.createdAt = new Date();
      stats.doctorsCreated++;
      stats.schedulesCreated++;
    }

    await doctorRef.set(doctorProfile, { merge: true });
    console.log(`   ${authCreated ? '+' : '✓'} Doctor: ${doc.name} (${doc.departmentName})`);
  }

  // 3. Generate Slots
  console.log('\n📅 Step 3: Generating Bookable Slots for Next 14 Days...');
  try {
    const slotGenResult = await generateSlotsJob(14);
    stats.slotsCreated = slotGenResult.totalSlots || 0;
    console.log(`   + Slot generation complete: ${stats.slotsCreated} slots created/verified.`);
  } catch (slotErr) {
    console.warn('   ⚠️ Slot generation warning:', slotErr.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('       DEMO DOCTOR SETUP COMPLETE (REAL FIREBASE)       ');
  console.log('='.repeat(60));
  console.log(`- Number of departments created: ${stats.departmentsCreated}`);
  console.log(`- Number of doctors created: ${stats.doctorsCreated}`);
  console.log(`- Number of authentication accounts created: ${stats.authAccountsCreated}`);
  console.log(`- Number of schedules created: ${stats.schedulesCreated}`);
  console.log(`- Number of slots created: ${stats.slotsCreated}`);
  console.log(`- Any duplicates skipped: ${stats.duplicatesSkipped}`);
  console.log('============================================================\n');
};

if (process.argv[1] && process.argv[1].endsWith('seedRealDemoDoctors.js')) {
  seedRealDemoDoctors()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error executing seedRealDemoDoctors:', err);
      process.exit(1);
    });
}

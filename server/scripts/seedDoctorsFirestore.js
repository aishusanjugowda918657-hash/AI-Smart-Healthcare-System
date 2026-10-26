/**
 * seedDoctorsFirestore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds demo doctor profiles + departments into the REAL Firebase Firestore
 * (project: ai-basedsmarthealthcaresystem).
 *
 * This script does NOT call Firebase Auth — it only writes to Firestore.
 * All departmentId values are lowercase (e.g. "dept-gen") matching the
 * canonical format used by the booking routes.
 *
 * Usage (from the server/ directory):
 *   node scripts/seedDoctorsFirestore.js
 *
 * Pre-conditions:
 *   - FIREBASE_SERVICE_ACCOUNT_PATH is set in server/.env
 *   - The service account has Firestore write permissions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { assertDbConnected } from '../src/config/firebase.js';
import { assignBatchDoctorDisplayIds } from '../src/services/doctorDisplayIdService.js';

const DEPARTMENTS = [
  { id: 'dept-card',  name: 'Cardiology',      code: 'CARD',  letter: 'C', description: 'Heart care, ECG, and cardiovascular consultations.' },
  { id: 'dept-gen',   name: 'General Medicine', code: 'GEN',   letter: 'G', description: 'Primary health consultations and routine care.' },
  { id: 'dept-ped',   name: 'Pediatrics',       code: 'PED',   letter: 'P', description: 'Child healthcare and vaccinations.' },
  { id: 'dept-derm',  name: 'Dermatology',      code: 'DERM',  letter: 'D', description: 'Skin, hair, and cosmetic medical consultations.' },
  { id: 'dept-ortho', name: 'Orthopedics',      code: 'ORTHO', letter: 'O', description: 'Bone, joint, and musculoskeletal care.' }
];

const DEMO_DOCTORS = [
  { doctorId: 'DOC-001', name: 'Dr. Sarah Smith',  email: 'sarah.smith@smartcare-demo.com',  phone: '9000000101', departmentId: 'dept-card',  specialization: 'Cardiology',      qualification: 'MBBS, MD',                experience: '8 years',  experienceYears: 8,  status: 'ACTIVE' },
  { doctorId: 'DOC-002', name: 'Dr. Rahul Kumar',  email: 'rahul.kumar@smartcare-demo.com',  phone: '9000000102', departmentId: 'dept-gen',   specialization: 'General Medicine', qualification: 'MBBS, MD',                experience: '7 years',  experienceYears: 7,  status: 'ACTIVE' },
  { doctorId: 'DOC-006', name: 'Dr. Vikram Patel', email: 'vikram.patel@smartcare-demo.com', phone: '9000000106', departmentId: 'dept-gen',   specialization: 'General Medicine', qualification: 'MBBS, MD (Gen Med)',      experience: '10 years', experienceYears: 10, status: 'ACTIVE' },
  { doctorId: 'DOC-003', name: 'Dr. Priya Sharma', email: 'priya.sharma@smartcare-demo.com', phone: '9000000103', departmentId: 'dept-ped',   specialization: 'Pediatrics',       qualification: 'MBBS, MD Pediatrics',    experience: '6 years',  experienceYears: 6,  status: 'ACTIVE' },
  { doctorId: 'DOC-004', name: 'Dr. Arjun Rao',    email: 'arjun.rao@smartcare-demo.com',    phone: '9000000104', departmentId: 'dept-ortho', specialization: 'Orthopedics',      qualification: 'MBBS, MS Orthopedics',   experience: '10 years', experienceYears: 10, status: 'ACTIVE' },
  { doctorId: 'DOC-005', name: 'Dr. Ananya Reddy', email: 'ananya.reddy@smartcare-demo.com', phone: '9000000105', departmentId: 'dept-derm',  specialization: 'Dermatology',      qualification: 'MBBS, MD Dermatology',   experience: '5 years',  experienceYears: 5,  status: 'ACTIVE' }
];

async function seed() {
  console.log('\n🌱  seedDoctorsFirestore — target: real Firebase project\n');
  const db = assertDbConnected();

  console.log('🏢  Step 1: departments collection');
  for (const dept of DEPARTMENTS) {
    const ref = db.collection('departments').doc(dept.id);
    await ref.set(
      { ...dept, active: true, createdAt: new Date(), updatedAt: new Date() },
      { merge: true }
    );
    console.log(`   ✓ ${dept.id}  (${dept.name})`);
  }

  console.log('\n👨‍⚕️  Step 2: doctors collection  (doc id = doctorId)');
  const doctorsWithDisplayId = assignBatchDoctorDisplayIds(DEMO_DOCTORS);
  for (const doc of doctorsWithDisplayId) {
    const ref = db.collection('doctors').doc(doc.doctorId);
    await ref.set(
      {
        ...doc,
        uid:             doc.doctorId,
        doctorUid:       doc.doctorId,
        displayId:       doc.displayId,
        doctorDisplayId: doc.displayId,
        fullName:        doc.name,
        createdAt:       new Date(),
        updatedAt:       new Date()
      },
      { merge: true }
    );
    console.log(`   ✓ ${doc.doctorId} -> ${doc.displayId}  ${doc.name.padEnd(22)} dept=${doc.departmentId}`);
  }

  console.log('\n✅  Seed complete — 5 departments, 6 doctors written.\n');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌  Seed failed:', err.message);
    process.exit(1);
  });

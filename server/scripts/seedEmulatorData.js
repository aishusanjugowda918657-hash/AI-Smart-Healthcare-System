/**
 * seedEmulatorData.js
 *
 * Emulator-only seed: creates Firebase Auth users for each demo doctor,
 * then writes doctor documents using the Auth UID as the document ID.
 * Also seeds departments and 14-day bookable slots.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
 *   GCLOUD_PROJECT=demo-project \
 *   node scripts/seedEmulatorData.js
 *
 * The dev:emulator npm script sets all these vars automatically.
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

import admin from 'firebase-admin';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';

// ── Init ────────────────────────────────────────────────────────────────────
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();
const auth = admin.auth();

// ── Demo data ───────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  { id: 'dept-card',  name: 'Cardiology',       code: 'CARD', avgConsultMin: 20 },
  { id: 'dept-gen',   name: 'General Medicine',  code: 'GEN',  avgConsultMin: 15 },
  { id: 'dept-ped',   name: 'Pediatrics',        code: 'PED',  avgConsultMin: 15 },
  { id: 'dept-ortho', name: 'Orthopedics',       code: 'ORTH', avgConsultMin: 25 },
  { id: 'dept-derm',  name: 'Dermatology',       code: 'DERM', avgConsultMin: 12 },
];

// password is the same for all demo doctors in the emulator
const DEMO_PASSWORD = 'SmartCare@123';

const DEMO_DOCTORS = [
  { doctorId: 'DOC-001', name: 'Dr. Sarah Smith',   email: 'sarah.smith@smartcare-demo.com',   departmentId: 'dept-card',  qualification: 'MBBS, MD',            experience: '8 years',  phone: '9000000101' },
  { doctorId: 'DOC-002', name: 'Dr. Rahul Kumar',   email: 'rahul.kumar@smartcare-demo.com',   departmentId: 'dept-gen',   qualification: 'MBBS, MD',            experience: '7 years',  phone: '9000000102' },
  { doctorId: 'DOC-003', name: 'Dr. Priya Sharma',  email: 'priya.sharma@smartcare-demo.com',  departmentId: 'dept-ped',   qualification: 'MBBS, MD Pediatrics', experience: '6 years',  phone: '9000000103' },
  { doctorId: 'DOC-004', name: 'Dr. Arjun Rao',     email: 'arjun.rao@smartcare-demo.com',     departmentId: 'dept-ortho', qualification: 'MBBS, MS Ortho',      experience: '10 years', phone: '9000000104' },
  { doctorId: 'DOC-005', name: 'Dr. Kavita Nair',   email: 'kavita.nair@smartcare-demo.com',   departmentId: 'dept-derm',  qualification: 'MBBS, MD Dermatology',experience: '5 years',  phone: '9000000105' },
  { doctorId: 'DOC-006', name: 'Dr. Vikram Patel',  email: 'vikram.patel@smartcare-demo.com',  departmentId: 'dept-gen',   qualification: 'MBBS, MD (Gen Med)',  experience: '10 years', phone: '9000000106' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getOrCreateAuthUser(doctor) {
  try {
    const existing = await auth.getUserByEmail(doctor.email);
    return existing.uid;
  } catch {
    // Not found — create
    const user = await auth.createUser({
      email: doctor.email,
      password: DEMO_PASSWORD,
      displayName: doctor.name,
      phoneNumber: '+91' + doctor.phone,
    });
    // Set custom claim so the app knows this user is a doctor
    await auth.setCustomUserClaims(user.uid, { role: 'doctor', doctorId: doctor.doctorId });
    return user.uid;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('[seed] Targeting emulator:', process.env.FIRESTORE_EMULATOR_HOST);

  // 1. Departments
  const deptBatch = db.batch();
  for (const dept of DEPARTMENTS) {
    deptBatch.set(db.collection('departments').doc(dept.id), dept, { merge: true });
  }
  await deptBatch.commit();
  console.log(`[seed] Seeded ${DEPARTMENTS.length} departments`);

  // 2. Doctors (Auth user + Firestore doc, using Auth UID as document ID)
  const DEMO_SCHEDULE = {
    slotMinutes: 15,
    bufferEverySlots: 6,
    weekly: [
      { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
      { dayOfWeek: 6, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
    ],
    lunch: { start: '13:00', end: '14:00' }
  };

  const uidMap = {};
  for (const doctor of DEMO_DOCTORS) {
    const uid = await getOrCreateAuthUser(doctor);
    uidMap[doctor.doctorId] = uid;

    const doctorProfile = {
      uid,
      doctorUid: uid,
      doctorId: doctor.doctorId,   // stable alias used by older queries
      name: doctor.name,
      fullName: doctor.name,
      email: doctor.email,
      phone: doctor.phone,
      departmentId: doctor.departmentId,
      qualification: doctor.qualification,
      experience: doctor.experience,
      experienceYears: parseInt(doctor.experience, 10) || 5,
      role: 'doctor',
      status: 'ACTIVE',
      isActive: true,
      active: true,
      schedule: DEMO_SCHEDULE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('doctors').doc(uid).set(doctorProfile, { merge: true });

    // Ensure user doc exists in users collection for authentication & session sync
    const userDocData = {
      uid,
      email: doctor.email,
      displayName: doctor.name,
      role: 'doctor',
      doctorId: doctor.doctorId,
      phone: doctor.phone,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('users').doc(uid).set(userDocData, { merge: true });

    // Ensure schedule exists in doctorSchedules collection
    const schedData = {
      id: `sched-${uid}`,
      doctorUid: uid,
      doctorId: doctor.doctorId,
      workingDays: [1, 2, 3, 4, 5, 6],
      workingHours: { start: '09:00', end: '17:00' },
      slotDurationMinutes: 15,
      breakTimes: [{ start: '13:00', end: '14:00' }],
      schedule: DEMO_SCHEDULE,
      leaves: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('doctorSchedules').doc(`sched-${uid}`).set(schedData, { merge: true });
    await db.collection('doctorSchedules').doc(`sched-${doctor.doctorId}`).set(schedData, { merge: true });

    console.log(`[seed] Doctor ${doctor.name} -> uid=${uid} (doctorId=${doctor.doctorId})`);
  }

  // 3. Slots — generate 14 days of bookable slots for each doctor using existing domain logic
  const today = new Date();
  let totalSlots = 0;
  for (const [doctorId, uid] of Object.entries(uidMap)) {
    const doctorData = DEMO_DOCTORS.find((doc) => doc.doctorId === doctorId);

    // Fetch existing slots to avoid duplicates and preserve any already-booked slots
    const existingSnap = await db.collection('slots').where('doctorId', '==', doctorId).get();
    const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

    for (let d = 0; d < 14; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() + d);
      const dateStr = date.toISOString().split('T')[0];

      const slots = generateSlotsForDoctorDate({
        doctorId,
        date: dateStr,
        schedule: DEMO_SCHEDULE,
        leaves: [],
        existingSlots: existingSlots.filter((s) => s.date === dateStr)
      });

      if (slots.length > 0) {
        const batch = db.batch();
        for (const slot of slots) {
          batch.set(db.collection('slots').doc(slot.id), {
            ...slot,
            doctorId,
            doctorUid: uid,
            doctorDocId: doctorId,
            doctorName: doctorData.name,
            departmentId: doctorData.departmentId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }, { merge: true });
          totalSlots++;
        }
        await batch.commit();
      }
    }
  }
  console.log(`[seed] Seeded ${totalSlots} slots across ${Object.keys(uidMap).length} doctors x 14 days`);
  console.log('[seed] Done. Emulator seed complete.');
}

seed().catch((err) => {
  console.error('[seed] FATAL:', err.message);
  process.exit(1);
});

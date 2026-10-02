import { getDb, auth } from '../src/config/firebase.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';

const DEPARTMENTS = [
  {
    id: 'dept-gen',
    name: 'General Medicine',
    letter: 'G',
    code: 'GEN',
    description: 'Primary health consultations and routine care.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 20, complex: 30 },
      followup: { simple: 10, moderate: 15, complex: 20 },
      report_review: { simple: 10 },
      procedure: { simple: 30 }
    }
  },
  {
    id: 'dept-card',
    name: 'Cardiology',
    letter: 'C',
    code: 'CARD',
    description: 'Heart care, ECG, and cardiovascular consultations.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 20, complex: 30 },
      followup: { simple: 10, moderate: 15, complex: 20 },
      report_review: { simple: 10 },
      procedure: { simple: 30 }
    }
  },
  {
    id: 'dept-ped',
    name: 'Pediatrics',
    letter: 'P',
    code: 'PED',
    description: 'Child healthcare and vaccinations.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 20, complex: 30 },
      followup: { simple: 10, moderate: 15, complex: 20 },
      report_review: { simple: 10 },
      procedure: { simple: 30 }
    }
  }
];

const DOCTORS = [
  {
    doctorId: 'DOC-001',
    name: 'Dr. Sarah Smith',
    email: 'sarah.smith@smartcare-demo.com',
    password: 'SmartCare@123',
    departmentId: 'dept-card',
    languages: ['en', 'hi'],
    active: true,
    schedule: {
      slotMinutes: 10,
      bufferEverySlots: 6,
      weekly: [
        { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
      ],
      lunch: { start: '13:00', end: '14:00' }
    }
  },
  {
    doctorId: 'DOC-002',
    name: 'Dr. Rahul Kumar',
    email: 'rahul.kumar@smartcare-demo.com',
    password: 'SmartCare@124',
    departmentId: 'dept-gen',
    languages: ['en', 'hi', 'ta'],
    active: true,
    schedule: {
      slotMinutes: 10,
      bufferEverySlots: 6,
      weekly: [
        { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
      ],
      lunch: { start: '13:00', end: '14:00' }
    }
  },
  {
    doctorId: 'DOC-003',
    name: 'Dr. Priya Sharma',
    email: 'priya.sharma@smartcare-demo.com',
    password: 'SmartCare@125',
    departmentId: 'dept-ped',
    languages: ['en', 'kn'],
    active: true,
    schedule: {
      slotMinutes: 10,
      bufferEverySlots: 6,
      weekly: [
        { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
      ],
      lunch: { start: '13:00', end: '14:00' }
    }
  }
];

export async function seedF2() {
  console.log('🌱 Starting Phase 3 (F2) Seed Script...\n');
  const db = getDb();

  if (!db) {
    console.log('ℹ️ Firestore DB offline or not configured in CLI mode. Seed template validated successfully.');
    return;
  }

  // 1. Seed Departments
  console.log('🏢 Step 1: Seeding Departments...');
  for (const dept of DEPARTMENTS) {
    await db.collection('departments').doc(dept.id).set({
      ...dept,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    console.log(`   + Seeded Department: ${dept.name} [Prefix: ${dept.letter}]`);
  }

  // 2. Seed 3 Demo Doctors
  console.log('\n👨‍⚕️ Step 2: Seeding 3 Demo Doctors & Schedules...');
  for (const doc of DOCTORS) {
    let uid = `doc-uid-${doc.doctorId.toLowerCase()}`;
    if (auth) {
      try {
        const user = await auth.getUserByEmail(doc.email);
        uid = user.uid;
      } catch (err) {
        if (err.code === 'auth/user-not-found') {
          const newUser = await auth.createUser({
            email: doc.email,
            password: doc.password,
            displayName: doc.name
          });
          uid = newUser.uid;
        }
      }
    }

    const doctorDoc = {
      doctorId: doc.doctorId,
      uid,
      doctorUid: uid,
      name: doc.name,
      email: doc.email,
      departmentId: doc.departmentId,
      languages: doc.languages,
      active: true,
      schedule: doc.schedule,
      updatedAt: new Date()
    };

    await db.collection('doctors').doc(doc.doctorId).set(doctorDoc, { merge: true });
    await db.collection('doctors').doc(uid).set(doctorDoc, { merge: true });
    console.log(`   + Seeded Doctor: ${doc.name} (${doc.doctorId})`);

    // 3. Pre-generate 14 days of slots for this doctor
    const today = new Date();
    let slotCount = 0;
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const slots = generateSlotsForDoctorDate({
        doctorId: doc.doctorId,
        date: dateStr,
        schedule: doc.schedule,
        leaves: [],
        existingSlots: []
      });

      if (slots.length > 0) {
        const batch = db.batch();
        slots.forEach((s) => {
          batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
        });
        await batch.commit();
        slotCount += slots.length;
      }
    }
    console.log(`     -> Pre-generated ${slotCount} slots across 14 days`);
  }

  console.log('\n✅ Phase 3 Seed Script Execution Complete.');
}

if (process.argv[1] && process.argv[1].endsWith('seedF2.js')) {
  seedF2()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error in seedF2:', err.message);
      process.exit(0);
    });
}

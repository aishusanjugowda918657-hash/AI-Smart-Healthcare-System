/**
 * seedLocalDemo16.js
 *
 * Isolated 16-User Local Testing Environment Seeder for SmartCare AI
 *
 * Target: Firebase Auth (9099) & Firestore (8080) Emulators ONLY.
 * Project: demo-project
 *
 * SAFETY GUARD: Explicitly terminates and refuses to execute if
 * emulator environment variables are missing or if connected to production.
 */

import admin from 'firebase-admin';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';
import { getOperatingSchedule, isVerifiedEmulatorMode, toFirestoreSchedule } from '../src/config/operatingSchedule.js';
import { getHospitalTodayStr, HOSPITAL_TZ } from '../src/utils/timezoneDate.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 1. HARD SAFETY GUARD: NEVER RUN AGAINST PRODUCTION ────────────────────────
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const gcloudProject = process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID;

if (!firestoreHost || !authHost || gcloudProject === 'ai-basedsmarthealthcaresystem') {
  console.error('\n⛔ [CRITICAL SAFETY VIOLATION] Refusing to run demo seed!');
  console.error('This script must ONLY be executed against the local Firebase Emulators.');
  console.error(`- FIRESTORE_EMULATOR_HOST: ${firestoreHost || 'MISSING'}`);
  console.error(`- FIREBASE_AUTH_EMULATOR_HOST: ${authHost || 'MISSING'}`);
  console.error(`- PROJECT_ID: ${gcloudProject || 'MISSING'}`);
  process.exit(1);
}

// ── 2. Initialize Firebase Admin against Emulator ─────────────────────────────
const projectId = gcloudProject || 'demo-project';
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId });
}
const db = admin.firestore();
const auth = admin.auth();

console.log('=================================================================');
console.log('  SMARTCARE AI — ISOLATED 16-USER LOCAL DEMO SEEDER');
console.log(`  Target Project:     ${projectId}`);
console.log(`  Auth Emulator:      http://${authHost}`);
console.log(`  Firestore Emulator: http://${firestoreHost}`);
console.log('  Status:             SAFETY VERIFIED (Emulator Only)');
console.log('=================================================================\n');

// ── 3. Password Strategy & Local Credentials Storage ──────────────────────────
const LOCAL_DIR = path.resolve(__dirname, '../.local');
if (!fs.existsSync(LOCAL_DIR)) {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
}
const CREDENTIALS_FILE = path.join(LOCAL_DIR, 'demo_credentials.json');

// Base password from environment or fallback default for demo testing
const BASE_PASSWORD = process.env.DEMO_USER_PASSWORD || process.env.DEMO_PASSWORD || 'Demo@2026!Local';

// ── 4. The 16 Demo Identities Definition ──────────────────────────────────────
const DEMO_IDENTITIES = [
  // 1 Admin
  {
    category: 'admin',
    email: 'demo.admin@smartcare.local',
    role: 'admin',
    displayName: 'System Admin (Demo)',
    phone: '9000000001'
  },

  // 2 General Medicine Doctors
  {
    category: 'doctor',
    email: 'demo.general1@smartcare.local',
    role: 'doctor',
    doctorId: 'DOC-DEMO-GEN-01',
    displayName: 'Dr. Demo General One',
    departmentId: 'dept-gen',
    departmentName: 'General Medicine',
    qualification: 'MBBS, MD (Gen Med)',
    experience: '12 years',
    phone: '9000000101',
    room: 'Room 101'
  },
  {
    category: 'doctor',
    email: 'demo.general2@smartcare.local',
    role: 'doctor',
    doctorId: 'DOC-DEMO-GEN-02',
    displayName: 'Dr. Demo General Two',
    departmentId: 'dept-gen',
    departmentName: 'General Medicine',
    qualification: 'MBBS, DNB',
    experience: '8 years',
    phone: '9000000102',
    room: 'Room 102'
  },

  // 1 Cardiology Doctor
  {
    category: 'doctor',
    email: 'demo.cardiology1@smartcare.local',
    role: 'doctor',
    doctorId: 'DOC-DEMO-CARD-01',
    displayName: 'Dr. Demo Cardiology One',
    departmentId: 'dept-card',
    departmentName: 'Cardiology',
    qualification: 'MBBS, DM Cardiology',
    experience: '15 years',
    phone: '9000000103',
    room: 'Room 201'
  },

  // Staff Members
  {
    category: 'staff',
    email: 'demo.reception@smartcare.local',
    role: 'reception',
    displayName: 'Reception Desk (Demo)',
    phone: '9000000201'
  },
  {
    category: 'staff',
    email: 'demo.nurse@smartcare.local',
    role: 'nurse',
    displayName: 'Triage Nurse (Demo)',
    phone: '9000000202'
  },
  {
    category: 'staff',
    email: 'demo.pharmacy@smartcare.local',
    role: 'pharmacy',
    displayName: 'Main Pharmacy (Demo)',
    phone: '9000000203'
  },

  // 10 Patients
  {
    category: 'patient',
    email: 'demo.patient01@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000001-P',
    displayName: 'Demo Patient Alex',
    phone: '9000000301',
    dob: '1988-03-15',
    gender: 'male',
    bloodGroup: 'O+',
    allergies: ['Penicillin'],
    conditions: ['Hypertension']
  },
  {
    category: 'patient',
    email: 'demo.patient02@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000002-P',
    displayName: 'Demo Patient Brenda',
    phone: '9000000302',
    dob: '1992-07-22',
    gender: 'female',
    bloodGroup: 'A+',
    allergies: ['None'],
    conditions: ['Asthma']
  },
  {
    category: 'patient',
    email: 'demo.patient03@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000003-P',
    displayName: 'Demo Patient Charlie',
    phone: '9000000303',
    dob: '1975-11-09',
    gender: 'male',
    bloodGroup: 'B+',
    allergies: ['Aspirin'],
    conditions: ['Type 2 Diabetes', 'Coronary Artery Disease']
  },
  {
    category: 'patient',
    email: 'demo.patient04@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000004-P',
    displayName: 'Demo Patient Diana',
    phone: '9000000304',
    dob: '1995-01-30',
    gender: 'female',
    bloodGroup: 'AB+',
    allergies: ['Sulfa'],
    conditions: ['None']
  },
  {
    category: 'patient',
    email: 'demo.patient05@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000005-P',
    displayName: 'Demo Patient Ethan',
    phone: '9000000305',
    dob: '1984-09-18',
    gender: 'male',
    bloodGroup: 'O-',
    allergies: ['None'],
    conditions: ['Mild Hypertension']
  },
  {
    category: 'patient',
    email: 'demo.patient06@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000006-P',
    displayName: 'Demo Patient Fiona',
    phone: '9000000306',
    dob: '1990-12-05',
    gender: 'female',
    bloodGroup: 'A-',
    allergies: ['Lactose'],
    conditions: ['Migraine']
  },
  {
    category: 'patient',
    email: 'demo.patient07@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000007-P',
    displayName: 'Demo Patient George',
    phone: '9000000307',
    dob: '1968-04-14',
    gender: 'male',
    bloodGroup: 'B-',
    allergies: ['Iodine'],
    conditions: ['Arrhythmia', 'Hyperlipidemia']
  },
  {
    category: 'patient',
    email: 'demo.patient08@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000008-P',
    displayName: 'Demo Patient Hannah',
    phone: '9000000308',
    dob: '2001-08-25',
    gender: 'female',
    bloodGroup: 'O+',
    allergies: ['Dust'],
    conditions: ['Seasonal Rhinitis']
  },
  {
    category: 'patient',
    email: 'demo.patient09@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000009-P',
    displayName: 'Demo Patient Ian',
    phone: '9000000309',
    dob: '1982-06-11',
    gender: 'male',
    bloodGroup: 'AB-',
    allergies: ['Penicillin'],
    conditions: ['GERD']
  },
  {
    category: 'patient',
    email: 'demo.patient10@smartcare.local',
    role: 'patient',
    healthId: 'SCAI-DEMO-000010-P',
    displayName: 'Demo Patient Julia',
    phone: '9000000310',
    dob: '1998-10-03',
    gender: 'female',
    bloodGroup: 'A+',
    allergies: ['None'],
    conditions: ['None']
  }
];

const DEPARTMENTS = [
  { id: 'dept-gen',  name: 'General Medicine', code: 'GEN',  avgConsultMin: 15, active: true },
  { id: 'dept-card', name: 'Cardiology',       code: 'CARD', avgConsultMin: 20, active: true }
];

const DEMO_SCHEDULE = getOperatingSchedule();

// ── 5. Main Seeder Execution ──────────────────────────────────────────────────
export async function seedLocalDemo16() {
  const credentialsRecord = {
    generatedAt: new Date().toISOString(),
    environment: 'LOCAL_EMULATOR_ONLY',
    projectId,
    totalIdentities: DEMO_IDENTITIES.length,
    users: []
  };

  const provisionedUsers = {};

  // 5.1 Seed Departments
  console.log('1. Seeding Clinical Departments...');
  for (const dept of DEPARTMENTS) {
    await db.collection('departments').doc(dept.id).set(dept, { merge: true });
  }
  console.log(`   ✓ ${DEPARTMENTS.length} departments active (dept-gen, dept-card)\n`);

  // 5.2 Provision 16 Auth & Firestore Identities
  console.log('2. Provisioning 16 Dedicated Demo Identities (Idempotent)...');
  for (const identity of DEMO_IDENTITIES) {
    let uid;
    let isNew = false;
    const userPassword = BASE_PASSWORD;

    try {
      const existing = await auth.getUserByEmail(identity.email);
      uid = existing.uid;
      // Sync password & display name idempotently
      await auth.updateUser(uid, {
        password: userPassword,
        displayName: identity.displayName
      });
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.message?.includes('no user record')) {
        const user = await auth.createUser({
          email: identity.email,
          password: userPassword,
          displayName: identity.displayName
        });
        uid = user.uid;
        isNew = true;
      } else {
        throw err;
      }
    }

    identity.uid = uid;
    provisionedUsers[identity.email] = { ...identity, uid };

    // Set custom claims
    const claims = { role: identity.role };
    if (identity.doctorId) claims.doctorId = identity.doctorId;
    if (identity.healthId) claims.healthId = identity.healthId;
    await auth.setCustomUserClaims(uid, claims);

    // Common user profile in users collection
    const userDocRef = db.collection('users').doc(uid);
    const commonUserDoc = {
      uid,
      email: identity.email,
      role: identity.role,
      displayName: identity.displayName,
      phone: identity.phone || '',
      status: 'ACTIVE',
      isDemo: true,
      demoNote: 'ISOLATED LOCAL TESTING IDENTITY',
      updatedAt: new Date()
    };
    if (identity.healthId) {
      commonUserDoc.healthId = identity.healthId;
      commonUserDoc.patientHealthId = identity.healthId;
    }
    if (identity.doctorId) {
      commonUserDoc.doctorId = identity.doctorId;
      commonUserDoc.doctorDisplayId = identity.doctorId;
    }

    const uSnap = await userDocRef.get();
    if (!uSnap.exists) commonUserDoc.createdAt = new Date();
    await userDocRef.set(commonUserDoc, { merge: true });

    // Role-specific collections
    if (identity.role === 'doctor') {
      const doctorDoc = {
        uid,
        doctorUid: uid,
        doctorId: identity.doctorId,
        name: identity.displayName,
        fullName: identity.displayName,
        email: identity.email,
        phone: identity.phone,
        departmentId: identity.departmentId,
        departmentName: identity.departmentName,
        qualification: identity.qualification,
        experience: identity.experience,
        experienceYears: parseInt(identity.experience, 10) || 10,
        room: identity.room,
        role: 'doctor',
        status: 'ACTIVE',
        isActive: true,
        active: true,
        isDemo: true,
        schedule: toFirestoreSchedule(DEMO_SCHEDULE),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await db.collection('doctors').doc(uid).set(doctorDoc, { merge: true });
      if (identity.doctorId && identity.doctorId !== uid) {
        await db.collection('doctors').doc(identity.doctorId).delete().catch(() => {});
      }

      // Doctor schedule
      const schedData = {
        id: `sched-${uid}`,
        doctorUid: uid,
        doctorId: identity.doctorId,
        workingDays: DEMO_SCHEDULE.workingDays,
        workingHours: { start: DEMO_SCHEDULE.startHourStr, end: DEMO_SCHEDULE.endHourStr },
        slotDurationMinutes: DEMO_SCHEDULE.slotMinutes,
        breakTimes: DEMO_SCHEDULE.lunch ? [DEMO_SCHEDULE.lunch] : [],
        schedule: toFirestoreSchedule(DEMO_SCHEDULE),
        leaves: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await db.collection('doctorSchedules').doc(`sched-${uid}`).set(schedData, { merge: true });
      if (identity.doctorId && identity.doctorId !== uid) {
        await db.collection('doctorSchedules').doc(`sched-${identity.doctorId}`).delete().catch(() => {});
      }
    } else if (identity.role === 'patient') {
      const patientDoc = {
        uid,
        patientUid: uid,
        ownerUid: uid,
        primaryAccountUid: uid,
        relation: 'self',
        healthId: identity.healthId,
        patientHealthId: identity.healthId,
        fullName: identity.displayName,
        name: identity.displayName,
        nameLower: identity.displayName.toLowerCase(),
        searchName: identity.displayName.toLowerCase(),
        email: identity.email,
        phone: identity.phone,
        dob: identity.dob,
        gender: identity.gender,
        bloodGroup: identity.bloodGroup,
        allergies: identity.allergies,
        existingConditions: identity.conditions,
        address: 'Demo Community Hospital Campus, Ward 4',
        emergencyContact: { name: 'Demo Contact', phone: '9000000999', relationship: 'Next of Kin' },
        profileCompleted: true,
        consentStatus: true,
        isDemo: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await db.collection('patients').doc(uid).set(patientDoc, { merge: true });
      await db.collection('patients').doc(identity.healthId).set(patientDoc, { merge: true });
    }

    credentialsRecord.users.push({
      email: identity.email,
      role: identity.role,
      uid,
      displayName: identity.displayName,
      identifier: identity.doctorId || identity.healthId || 'N/A',
      password: userPassword
    });

    console.log(`   ✓ [${identity.role.toUpperCase()}] ${identity.email} -> UID: ${uid} (${isNew ? 'Created' : 'Updated'})`);
  }

  // 5.3 Write Credentials File to server/.local/demo_credentials.json (Gitignored)
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentialsRecord, null, 2), { mode: 0o600 });
  console.log(`\n📁 Demo credentials safely saved to: ${CREDENTIALS_FILE} (GITIGNORED)\n`);

  // 5.4 Seed Doctor Slots for 14 Days
  console.log('3. Seeding Bookable Slots for 3 Doctors (Overnight Shift & Rollover)...');
  const activeSched = getOperatingSchedule();
  const doctorsList = DEMO_IDENTITIES.filter((d) => d.role === 'doctor');
  let slotCount = 0;

  for (const doc of doctorsList) {
    for (let d = -1; d < 14; d++) {
      const date = dayjs().tz('Asia/Kolkata').add(d, 'day');
      const dateStr = date.format('YYYY-MM-DD');

      const slots = generateSlotsForDoctorDate({
        doctorId: doc.doctorId,
        date: dateStr,
        schedule: activeSched,
        leaves: [],
        existingSlots: []
      });

      if (slots.length > 0) {
        const batch = db.batch();
        for (const s of slots) {
          batch.set(db.collection('slots').doc(s.id), {
            ...s,
            doctorId: doc.doctorId,
            doctorUid: doc.uid,
            doctorName: doc.displayName,
            departmentId: doc.departmentId,
            isDemo: true,
            createdAt: new Date(),
            updatedAt: new Date()
          }, { merge: true });
          slotCount++;
        }
        await batch.commit();
      }
    }
  }
  console.log(`   ✓ Seeded ${slotCount} bookable slots across 3 doctors.\n`);

  // 5.5 Seed Useful Test Scenarios (Appointments, Queue, Tokens, Prescriptions)
  console.log('4. Seeding Test Scenarios across 10 Patients & 3 Doctors...');
  const todayStr = getHospitalTodayStr();
  const isOvernight = activeSched.isOvernight;
  const timeSlots = isOvernight
    ? ['21:00', '21:15', '21:30', '21:45', '22:00', '22:15', '22:30', '22:45', '23:00']
    : ['09:00', '09:15', '09:30', '09:45', '11:00', '11:15', '10:00', '08:30', '10:30'];

  const p1 = provisionedUsers['demo.patient01@smartcare.local'];
  const p2 = provisionedUsers['demo.patient02@smartcare.local'];
  const p3 = provisionedUsers['demo.patient03@smartcare.local'];
  const p4 = provisionedUsers['demo.patient04@smartcare.local'];
  const p5 = provisionedUsers['demo.patient05@smartcare.local'];
  const p6 = provisionedUsers['demo.patient06@smartcare.local'];
  const p7 = provisionedUsers['demo.patient07@smartcare.local'];
  const p8 = provisionedUsers['demo.patient08@smartcare.local'];
  const p9 = provisionedUsers['demo.patient09@smartcare.local'];
  const p10 = provisionedUsers['demo.patient10@smartcare.local'];

  const docGen1 = provisionedUsers['demo.general1@smartcare.local'];
  const docGen2 = provisionedUsers['demo.general2@smartcare.local'];
  const docCard = provisionedUsers['demo.cardiology1@smartcare.local'];

  // Helper to create appointment + token
  async function createScenarioAppointment(params) {
    const {
      apptId,
      displayId,
      patient,
      doctor,
      timeSlot,
      status,
      tokenNumber,
      tokenLabel,
      clinicalLevel = 1,
      urgency = 'routine',
      notes = 'Demo appointment scenario',
      prescription = null
    } = params;

    const aptRef = db.collection('appointments').doc(apptId);
    const tokRef = db.collection('tokens').doc(`tok-${apptId}`);

    const apptData = {
      id: apptId,
      appointmentId: apptId,
      displayId,
      patientUid: patient.uid,
      patientHealthId: patient.healthId,
      patientName: patient.displayName,
      doctorUid: doctor.uid,
      doctorId: doctor.doctorId,
      doctorName: doctor.displayName,
      departmentId: doctor.departmentId,
      departmentName: doctor.departmentName,
      date: todayStr,
      timeSlot,
      bookedStartAt: timeSlot,
      durationMin: 15,
      status,
      tokenNumber,
      tokenLabel,
      tokenId: `tok-${apptId}`,
      clinicalLevel,
      urgencySuggested: urgency,
      reasonText: notes,
      isDemo: true,
      qrPayload: `SCAI-DEMO-APPT:${displayId}:${patient.healthId}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (['checked_in', 'waiting', 'called', 'in_consultation', 'completed'].includes(status)) {
      apptData.checkedInAt = new Date();
    }
    if (['called', 'in_consultation', 'completed'].includes(status)) {
      apptData.calledAt = new Date();
      apptData.consultationRoom = doctor.room || 'Room 101';
    }
    if (status === 'cancelled') {
      apptData.cancelledAt = new Date();
      apptData.cancellationReason = 'Patient requested cancellation';
    }
    if (status === 'completed') {
      apptData.completedAt = new Date();
    }

    await aptRef.set(apptData, { merge: true });

    // Token
    if (status !== 'cancelled') {
      await tokRef.set({
        id: `tok-${apptId}`,
        tokenNumber: String(tokenNumber),
        tokenLabel,
        appointmentId: apptId,
        displayId,
        patientUid: patient.uid,
        patientHealthId: patient.healthId,
        doctorUid: doctor.uid,
        doctorId: doctor.doctorId,
        departmentId: doctor.departmentId,
        date: todayStr,
        priorityCategory: clinicalLevel === 3 ? 'EMERGENCY' : clinicalLevel === 2 ? 'HIGH' : 'STANDARD',
        status: status === 'in_consultation' ? 'in_consultation' : status === 'called' ? 'called' : 'waiting',
        generatedAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
    }

    // Prescription if provided
    if (prescription) {
      await db.collection('prescriptions').doc(prescription.id).set({
        id: prescription.id,
        prescriptionId: prescription.id,
        verificationCode: prescription.verificationCode,
        verifyCode: prescription.verificationCode,
        patientUid: patient.uid,
        patientHealthId: patient.healthId,
        patientName: patient.displayName,
        doctorUid: doctor.uid,
        doctorId: doctor.doctorId,
        doctorName: doctor.displayName,
        appointmentId: apptId,
        date: todayStr,
        medicines: prescription.medicines,
        doctorNotes: prescription.notes || 'Take as directed with full glass of water.',
        status: 'active',
        dispenseStatus: prescription.dispenseStatus || 'PENDING',
        dispensedAt: prescription.dispensedAt || null,
        isDemo: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
    }
  }

  // Scenario 1: Patient 01 (In Consultation with Dr. General One)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-001',
    displayId: 'APT-DEMO-001',
    patient: p1,
    doctor: docGen1,
    timeSlot: timeSlots[0],
    status: 'in_consultation',
    tokenNumber: 1,
    tokenLabel: 'GEN-001',
    clinicalLevel: 1,
    notes: 'Followup for controlled hypertension'
  });
  console.log('   ✓ Scenario 1: Patient 01 In Consultation (Dr. General One, Token GEN-001)');

  // Scenario 2: Patient 02 (Called into Consultation Room)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-002',
    displayId: 'APT-DEMO-002',
    patient: p2,
    doctor: docGen1,
    timeSlot: timeSlots[1],
    status: 'called',
    tokenNumber: 2,
    tokenLabel: 'GEN-002',
    clinicalLevel: 1,
    notes: 'Asthma review and inhaler prescription'
  });
  console.log('   ✓ Scenario 2: Patient 02 Called to Room 101 (Token GEN-002)');

  // Scenario 3: Patient 03 (Waiting with EMERGENCY Priority — Nurse Triaged)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-003',
    displayId: 'APT-DEMO-003',
    patient: p3,
    doctor: docGen1,
    timeSlot: timeSlots[2],
    status: 'waiting',
    tokenNumber: 3,
    tokenLabel: 'GEN-003',
    clinicalLevel: 3,
    urgency: 'emergency',
    notes: 'Acute chest tightness & shortness of breath'
  });
  console.log('   ✓ Scenario 3: Patient 03 Waiting with Emergency Priority Level 3 (Token GEN-003)');

  // Scenario 4: Patient 04 (Waiting in Queue — Standard Priority)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-004',
    displayId: 'APT-DEMO-004',
    patient: p4,
    doctor: docGen1,
    timeSlot: timeSlots[3],
    status: 'waiting',
    tokenNumber: 4,
    tokenLabel: 'GEN-004',
    clinicalLevel: 1,
    notes: 'Annual health checkup'
  });
  console.log('   ✓ Scenario 4: Patient 04 Waiting in Queue (Token GEN-004)');

  // Scenario 5: Patient 05 (Booked for today — Ready for Reception Check-in Test)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-005',
    displayId: 'APT-DEMO-005',
    patient: p5,
    doctor: docGen2,
    timeSlot: timeSlots[4],
    status: 'booked',
    tokenNumber: 5,
    tokenLabel: 'GEN-005',
    clinicalLevel: 1,
    notes: 'Routine primary care checkup'
  });
  console.log('   ✓ Scenario 5: Patient 05 Booked (Ready for Reception QR/Manual Check-in)');

  // Scenario 6: Patient 06 (Checked in — Ready for Nurse Triage)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-006',
    displayId: 'APT-DEMO-006',
    patient: p6,
    doctor: docGen2,
    timeSlot: timeSlots[5],
    status: 'checked_in',
    tokenNumber: 6,
    tokenLabel: 'GEN-006',
    clinicalLevel: 1,
    notes: 'Migraine episodes'
  });
  console.log('   ✓ Scenario 6: Patient 06 Checked In (Ready for Nurse Vitals & Triage)');

  // Scenario 7: Patient 07 (Completed with Dr. Cardiology — Pending Pharmacy Dispense)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-007',
    displayId: 'APT-DEMO-007',
    patient: p7,
    doctor: docCard,
    timeSlot: timeSlots[6],
    status: 'completed',
    tokenNumber: 7,
    tokenLabel: 'CARD-001',
    clinicalLevel: 2,
    notes: 'Cardiology evaluation and ECG review',
    prescription: {
      id: 'RX-DEMO-CARD-777',
      verificationCode: 'RX-DEMO-CARD-777',
      dispenseStatus: 'PENDING',
      notes: 'Take Atorvastatin at bedtime. Monitor heart rate.',
      medicines: [
        { name: 'Atorvastatin', dosage: '20 mg', frequency: 'Once Daily (0-0-1)', timing: 'after_food', durationDays: 30 },
        { name: 'Aspirin', dosage: '75 mg', frequency: 'Once Daily (1-0-0)', timing: 'after_food', durationDays: 30 }
      ]
    }
  });
  console.log('   ✓ Scenario 7: Patient 07 Prescription PENDING (Code: RX-DEMO-CARD-777 for Pharmacy Test)');

  // Scenario 8: Patient 08 (Completed with Dr. General One — Already Dispensed)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-008',
    displayId: 'APT-DEMO-008',
    patient: p8,
    doctor: docGen1,
    timeSlot: timeSlots[7],
    status: 'completed',
    tokenNumber: 8,
    tokenLabel: 'GEN-000',
    clinicalLevel: 1,
    notes: 'Seasonal allergy consult',
    prescription: {
      id: 'RX-DEMO-GEN-888',
      verificationCode: 'RX-DEMO-GEN-888',
      dispenseStatus: 'DISPENSED',
      dispensedAt: new Date(Date.now() - 3600000).toISOString(),
      notes: 'Completed dispensing.',
      medicines: [
        { name: 'Cetirizine', dosage: '10 mg', frequency: 'Once Daily (0-0-1)', timing: 'after_food', durationDays: 7 }
      ]
    }
  });
  console.log('   ✓ Scenario 8: Patient 08 Prescription DISPENSED (Code: RX-DEMO-GEN-888 for Double-Dispense Block Test)');

  // Scenario 9: Patient 09 (Cancelled Appointment — For Reception Restore Test)
  await createScenarioAppointment({
    apptId: 'DEMO-APPT-009',
    displayId: 'APT-DEMO-009',
    patient: p9,
    doctor: docGen1,
    timeSlot: timeSlots[8],
    status: 'cancelled',
    tokenNumber: 9,
    tokenLabel: 'GEN-009',
    clinicalLevel: 1,
    notes: 'Cancelled within 2 hours — test restoration'
  });
  console.log('   ✓ Scenario 9: Patient 09 Cancelled (For Reception Restore Appointment Test)');

  // Scenario 10: Patient 10 (Clean Patient Profile with No Active Appointments)
  console.log('   ✓ Scenario 10: Patient 10 Clean Profile (Ready for Patient Portal New Booking Test)\n');

  // 5.6 Initialize Doctor Queues
  console.log('5. Initializing Live Queue Documents...');
  for (const doc of doctorsList) {
    await db.collection('queues').doc(`queue-${doc.doctorId}-${todayStr}`).set({
      doctorId: doc.doctorId,
      doctorUid: doc.uid,
      departmentId: doc.departmentId,
      date: todayStr,
      currentToken: doc.doctorId === 'DOC-DEMO-GEN-01' ? 1 : null,
      status: 'active',
      isDemo: true,
      updatedAt: new Date()
    }, { merge: true });
  }
  console.log('   ✓ Doctor live queues initialized successfully.\n');

  console.log('=================================================================');
  console.log('  ✅ ISOLATED 16-USER LOCAL DEMO SEEDING COMPLETED SUCCESSFULLY!');
  console.log(`  Identities Provisioned: 16 (1 Admin, 3 Doctors, 3 Staff, 10 Patients)`);
  console.log(`  Credentials Location:   ${CREDENTIALS_FILE}`);
  console.log('=================================================================\n');

  return credentialsRecord;
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedLocalDemo16().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('❌ SEEDING FAILED:', err);
    process.exit(1);
  });
}

import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import admin from 'firebase-admin';
import { db as defaultDb, auth as defaultAuth, isEmulator as defaultIsEmulator } from '../src/config/firebase.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';

export const CANONICAL_DEPARTMENTS = [
  {
    id: 'dept-gen',
    name: 'General Medicine',
    letter: 'G',
    code: 'GEN',
    description: 'Primary health consultations and routine care.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 15, complex: 20 },
      followup: { simple: 10, moderate: 10, complex: 15 },
      report_review: { simple: 5 },
      procedure: { simple: 20 }
    }
  },
  {
    id: 'dept-card',
    name: 'Cardiology',
    letter: 'C',
    code: 'CARD',
    description: 'Heart care, ECG, and cardiovascular consultations.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 15, complex: 20 },
      followup: { simple: 10, moderate: 10, complex: 15 },
      report_review: { simple: 5 },
      procedure: { simple: 20 }
    }
  },
  {
    id: 'dept-ped',
    name: 'Pediatrics',
    letter: 'P',
    code: 'PED',
    description: 'Child healthcare and vaccinations.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 15, complex: 20 },
      followup: { simple: 10, moderate: 10, complex: 15 },
      report_review: { simple: 5 },
      procedure: { simple: 20 }
    }
  },
  {
    id: 'dept-ortho',
    name: 'Orthopedics',
    letter: 'O',
    code: 'ORTHO',
    description: 'Bone, joint, and musculoskeletal care.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 15, complex: 20 },
      followup: { simple: 10, moderate: 10, complex: 15 },
      report_review: { simple: 5 },
      procedure: { simple: 20 }
    }
  },
  {
    id: 'dept-derm',
    name: 'Dermatology',
    letter: 'D',
    code: 'DERM',
    description: 'Skin, hair, and cosmetic medical consultations.',
    defaultDurationsMin: {
      new: { simple: 10, moderate: 15, complex: 20 },
      followup: { simple: 10, moderate: 10, complex: 15 },
      report_review: { simple: 5 },
      procedure: { simple: 20 }
    }
  }
];

export async function runBootstrap(options = {}) {
  const {
    db = defaultDb,
    auth = defaultAuth,
    isEmulator = defaultIsEmulator,
    projectIdOverride = null,
    yes = false,
    adminEmail = null,
    adminName = null,
    adminPassword = null,
    isDoctor = false,
    doctorEmail = null,
    doctorName = null,
    doctorPassword = null,
    departmentId = 'dept-gen',
    logger = console.log,
    errLogger = console.error
  } = options;

  const projectId =
    projectIdOverride ||
    (admin.apps.length > 0 ? admin.app().options?.projectId : null) ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    'demo-project';

  logger('\n==================================================');
  logger('🚀 FIREBASE PROJECT BOOTSTRAP TOOL');
  logger(`Target Project ID: ${projectId}`);
  logger(`Environment: ${isEmulator ? 'EMULATOR (Safe for testing)' : 'REAL FIREBASE PROJECT'}`);
  logger('==================================================\n');

  if (!db || typeof db.collection !== 'function') {
    throw new Error('Database Error: Firestore instance is not initialized or unavailable.');
  }

  // 1. Confirmation check for interactive CLI execution
  if (!yes && options.isInteractive) {
    const confirmed = await promptConfirmation(`Proceed with bootstrap on project "${projectId}" (${isEmulator ? 'EMULATOR' : 'REAL'})? (y/N): `);
    if (!confirmed) {
      logger('❌ Bootstrap cancelled by user.');
      return { success: false, cancelled: true };
    }
  }

  // 2. Step 1: Global Settings (settings/global)
  logger('⚙️  Step 1: Initializing settings/global (PRD F3 disclaimers & section 4.2 thresholds)...');
  const settingsRef = db.collection('settings').doc('global');
  const globalSettingsData = {
    disclaimer: {
      version: '1.0',
      textFull: 'Your appointment time is an estimate. Emergency and critical cases are always seen first, so your waiting time may vary. We will keep you updated in real time and offer options if your wait becomes longer.',
      textShort: 'Emergency cases are seen first, so your waiting time may vary.'
    },
    thresholds: {
      fairnessBumpMin: 30,
      maxDelayProtectMin: 30,
      graceMin: 5,
      lateTiers: [10, 30, 60],
      adherenceLowPct: 60,
      missedFollowupsHigh: 2,
      checkinOpensMinBefore: 30,
      checkinDeadlineMinBefore: 10,
      undoCancelMin: 10,
      offerExpiryMin: 10
    },
    version: '1.0',
    updatedAt: new Date()
  };
  await settingsRef.set(globalSettingsData, { merge: true });
  logger('  ✓ Created / updated settings/global');

  // 3. Step 2: Canonical Departments
  logger('\n🏢 Step 2: Initializing departments (canonical ID format: dept-<shortcode>)...');
  for (const dept of CANONICAL_DEPARTMENTS) {
    await db.collection('departments').doc(dept.id).set(
      {
        ...dept,
        active: true,
        updatedAt: new Date()
      },
      { merge: true }
    );
    logger(`  ✓ Department: ${dept.id} (${dept.name})`);
  }

  // 4. Step 3: Admin Account Creation
  logger('\n🔑 Step 3: Creating / updating Admin account...');
  const targetAdminEmail = adminEmail || 'admin@smartcare.com';
  const targetAdminName = adminName || 'System Admin';
  const targetAdminPass = adminPassword || 'SmartCareAdmin@123';

  let adminUid = null;
  if (auth && typeof auth.getUserByEmail === 'function') {
    try {
      const existing = await auth.getUserByEmail(targetAdminEmail);
      adminUid = existing.uid;
      if (adminPassword) {
        await auth.updateUser(adminUid, { password: targetAdminPass, displayName: targetAdminName });
      }
    } catch (e) {
      const created = await auth.createUser({
        email: targetAdminEmail,
        password: targetAdminPass,
        displayName: targetAdminName
      });
      adminUid = created.uid;
    }

    if (typeof auth.setCustomUserClaims === 'function') {
      await auth.setCustomUserClaims(adminUid, { role: 'admin' });
    }
  } else {
    adminUid = 'admin-mock-uid';
  }

  await db.collection('users').doc(adminUid).set(
    {
      uid: adminUid,
      email: targetAdminEmail,
      displayName: targetAdminName,
      role: 'admin',
      updatedAt: new Date()
    },
    { merge: true }
  );
  logger(`  ✓ Admin user created/updated: ${targetAdminEmail} (UID: ${adminUid})`);

  // 5. Step 4: Optional --doctor mode
  let doctorResult = null;
  if (isDoctor) {
    logger('\n👨‍⚕️ Step 4 (--doctor mode): Creating Doctor account & 14 days of slots...');
    const targetDocEmail = doctorEmail || 'doctor@smartcare.com';
    const targetDocName = doctorName || 'Dr. SmartCare';
    const targetDocPass = doctorPassword || 'SmartCareDoctor@123';
    const targetDeptId = CANONICAL_DEPARTMENTS.some((d) => d.id === departmentId) ? departmentId : 'dept-gen';

    let docUid = null;
    if (auth && typeof auth.getUserByEmail === 'function') {
      try {
        const existing = await auth.getUserByEmail(targetDocEmail);
        docUid = existing.uid;
        if (doctorPassword) {
          await auth.updateUser(docUid, { password: targetDocPass, displayName: targetDocName });
        }
      } catch (e) {
        const created = await auth.createUser({
          email: targetDocEmail,
          password: targetDocPass,
          displayName: targetDocName
        });
        docUid = created.uid;
      }

      if (typeof auth.setCustomUserClaims === 'function') {
        await auth.setCustomUserClaims(docUid, { role: 'doctor' });
      }
    } else {
      docUid = 'doc-mock-uid';
    }

    // Write to users collection
    await db.collection('users').doc(docUid).set(
      {
        uid: docUid,
        email: targetDocEmail,
        displayName: targetDocName,
        role: 'doctor',
        mustChangePassword: true,
        updatedAt: new Date()
      },
      { merge: true }
    );

    const doctorSchedule = {
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
    };

    // Write to doctors collection with ID equal to Auth UID
    await db.collection('doctors').doc(docUid).set(
      {
        doctorId: docUid,
        doctorUid: docUid,
        uid: docUid,
        name: targetDocName,
        email: targetDocEmail,
        departmentId: targetDeptId,
        languages: options.languages || ['en'],
        active: true,
        mustChangePassword: true,
        schedule: doctorSchedule,
        specialties: options.specialties || [],
        qualification: options.qualification || 'MBBS',
        experienceYears: options.experienceYears || 5,
        ageGroups: options.ageGroups || ['adult', 'senior', 'child'],
        bio: options.bio || 'General doctor bio',
        updatedAt: new Date()
      },
      { merge: true }
    );
    logger(`  ✓ Doctor user created/updated: ${targetDocEmail} (UID: ${docUid}) in department "${targetDeptId}"`);

    // Generate 14 days of slots
    logger('  ⏳ Generating 14 days of slots...');
    let totalGeneratedSlots = 0;
    const today = new Date();

    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const slots = generateSlotsForDoctorDate({
        doctorId: docUid,
        date: dateStr,
        schedule: doctorSchedule,
        now: Date.now()
      });

      if (slots && slots.length > 0) {
        const batch = db.batch();
        slots.forEach((s) => {
          const ref = db.collection('slots').doc(s.id);
          batch.set(ref, { ...s, updatedAt: new Date() }, { merge: true });
        });
        await batch.commit();
        totalGeneratedSlots += slots.length;
      }
    }
    logger(`  ✓ Generated ${totalGeneratedSlots} slots for ${targetDocName} across 14 days.`);
    doctorResult = { docUid, email: targetDocEmail, departmentId: targetDeptId, totalSlots: totalGeneratedSlots };
  }

  logger('\n==================================================');
  logger('✅ BOOTSTRAP COMPLETE');
  logger('==================================================\n');

  return {
    success: true,
    projectId,
    adminUid,
    adminEmail: targetAdminEmail,
    doctor: doctorResult
  };
}

function promptConfirmation(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      const trimmed = (ans || '').trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('bootstrap.js')) {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes') || args.includes('-y');
  const isDoctor = args.includes('--doctor');

  const getArgVal = (name) => {
    const match = args.find((a) => a.startsWith(`--${name}=`));
    if (match) return match.split('=')[1];
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return null;
  };

  const adminEmail = getArgVal('admin-email');
  const adminName = getArgVal('admin-name') || getArgVal('admin-display-name');
  const adminPassword = getArgVal('admin-password');

  const doctorEmail = getArgVal('doctor-email');
  const doctorName = getArgVal('doctor-name');
  const doctorPassword = getArgVal('doctor-password');
  const departmentId = getArgVal('department-id') || 'dept-gen';

  const isInteractive = process.stdin.isTTY && !yes;

  const specialtiesArg = getArgVal('specialties');
  const qualification = getArgVal('qualification');
  const experienceYears = getArgVal('experience') ? parseInt(getArgVal('experience'), 10) : undefined;
  const languagesArg = getArgVal('languages');
  const ageGroupsArg = getArgVal('age-groups');
  const bio = getArgVal('bio');

  runBootstrap({
    yes,
    isDoctor,
    adminEmail,
    adminName,
    adminPassword,
    doctorEmail,
    doctorName,
    doctorPassword,
    departmentId,
    isInteractive,
    specialties: specialtiesArg ? specialtiesArg.split(',') : undefined,
    qualification,
    experienceYears,
    languages: languagesArg ? languagesArg.split(',') : undefined,
    ageGroups: ageGroupsArg ? ageGroupsArg.split(',') : undefined,
    bio
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal bootstrap error:', err);
      process.exit(1);
    });
}

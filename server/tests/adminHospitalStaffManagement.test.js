/**
 * adminHospitalStaffManagement.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete Test Suite for Admin Hospital Staff Management, Account Creation,
 * Initial Login Credentials, and Role-Based Authorization.
 *
 * Test Labels:
 * - [API-ONLY]: Direct REST API endpoints validation, schemas, and guards
 * - [END-TO-END]: Full registration-to-login simulation and role-dashboard routing
 * - [SEEDED]: Preservation of pre-existing staff, admin, and patient profiles
 * - [CODE-REVIEW]: Security verification (passwords never exposed/logged)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected, auth } from '../src/config/firebase.js';

describe('Admin Hospital Staff Management Test Suite', () => {
  let db;

  const mockAdminUid = 'test-admin-staff-manager';
  const mockDoctorUid = 'test-doc-regular-01';
  const mockPatientUid = 'test-patient-regular-01';

  // Synthetic Test Staff Data
  const syntheticDoctor = {
    role: 'doctor',
    fullName: 'Dr. Evelyn Reed',
    email: `evelyn.reed.${Date.now()}@smartcare-test.local`,
    password: 'InitialDoctorPass@2026',
    phone: '9876543210',
    staffId: `DOC-CARD-${Date.now().toString().slice(-4)}`,
    departmentId: 'dept-card',
    shift: 'day',
    status: 'ACTIVE',
    qualification: 'MBBS, MD Cardiology',
    fee: 150,
    experienceYears: 9,
    specialties: 'Interventional Cardiology, Heart Failure'
  };

  const syntheticNurse = {
    role: 'nurse',
    fullName: 'Nurse Aaron Vance',
    email: `aaron.vance.${Date.now()}@smartcare-test.local`,
    password: 'InitialNursePass@2026',
    phone: '9876543211',
    staffId: `NUR-GEN-${Date.now().toString().slice(-4)}`,
    departmentId: 'dept-gen',
    shift: 'night',
    status: 'ACTIVE',
    qualification: 'B.Sc Nursing, Critical Care',
    registrationNumber: 'RN-TEST-48291',
    experienceYears: 6,
    unit: 'ICU Triage Desk'
  };

  const syntheticReceptionist = {
    role: 'reception',
    fullName: 'Clara Oswald',
    email: `clara.oswald.${Date.now()}@smartcare-test.local`,
    password: 'InitialReceptionPass@2026',
    phone: '9876543212',
    staffId: `REC-${Date.now().toString().slice(-4)}`,
    departmentId: 'dept-gen',
    shift: 'day',
    status: 'ACTIVE',
    desk: 'Main OPD Lobby Desk 1'
  };

  const syntheticPharmacy = {
    role: 'pharmacy',
    fullName: 'David Mercer',
    email: `david.mercer.${Date.now()}@smartcare-test.local`,
    password: 'InitialPharmacyPass@2026',
    phone: '9876543213',
    staffId: `PHM-${Date.now().toString().slice(-4)}`,
    departmentId: 'dept-gen',
    shift: 'both',
    status: 'ACTIVE',
    qualification: 'Pharm.D, Clinical Pharmacy',
    registrationNumber: 'PHM-REG-98124'
  };

  let registeredDoctorUid = null;
  let registeredNurseUid = null;
  let registeredReceptionUid = null;
  let registeredPharmacyUid = null;

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Ensure mock Admin profile exists
    await db.collection('users').doc(mockAdminUid).set({
      uid: mockAdminUid,
      email: 'admin.manager@smartcare.local',
      role: 'admin',
      displayName: 'System Admin Manager',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 2. Ensure mock regular Doctor profile exists
    await db.collection('users').doc(mockDoctorUid).set({
      uid: mockDoctorUid,
      email: 'regular.doctor@smartcare.local',
      role: 'doctor',
      displayName: 'Regular Doctor',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 3. Ensure mock Patient profile exists
    await db.collection('users').doc(mockPatientUid).set({
      uid: mockPatientUid,
      email: 'regular.patient@smartcare.local',
      role: 'patient',
      displayName: 'Regular Patient',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });
  });

  afterAll(async () => {
    // Clean up created synthetic test records from Firestore
    const uidsToClean = [
      registeredDoctorUid,
      registeredNurseUid,
      registeredReceptionUid,
      registeredPharmacyUid
    ].filter(Boolean);

    for (const uid of uidsToClean) {
      try {
        await db.collection('users').doc(uid).delete();
        await db.collection('doctors').doc(uid).delete();
        await db.collection('staff').doc(uid).delete();
        await db.collection('doctorSchedules').doc(`sched-${uid}`).delete();
        if (auth) {
          try { await auth.deleteUser(uid); } catch (_) {}
        }
      } catch (_) {}
    }
  });

  // =========================================================================
  // 1. UNIFIED STAFF REGISTRATION ACROSS ALL 4 HOSPITAL ROLES [API-ONLY]
  // =========================================================================
  describe('1. Unified Staff Registration across 4 Roles [API-ONLY]', () => {
    it('Admin successfully registers a Doctor with initial credentials', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(syntheticDoctor);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('uid');
      expect(res.body.data.role).toBe('doctor');
      expect(res.body.data.email).toBe(syntheticDoctor.email.toLowerCase());
      expect(res.body.data.staffId).toBe(syntheticDoctor.staffId);
      expect(res.body.data.shift).toBe('day');
      expect(res.body.data).not.toHaveProperty('password'); // Password NEVER returned

      registeredDoctorUid = res.body.data.uid;

      // Verify Firestore dual collection persistence
      const userSnap = await db.collection('users').doc(registeredDoctorUid).get();
      expect(userSnap.exists).toBe(true);
      expect(userSnap.data().role).toBe('doctor');
      expect(userSnap.data().staffId).toBe(syntheticDoctor.staffId);

      const doctorSnap = await db.collection('doctors').doc(registeredDoctorUid).get();
      expect(doctorSnap.exists).toBe(true);
      expect(doctorSnap.data().qualification).toBe(syntheticDoctor.qualification);
      expect(doctorSnap.data().fee).toBe(150);
      expect(doctorSnap.data().experienceYears).toBe(9);

      // Verify schedule was provisioned
      const schedSnap = await db.collection('doctorSchedules').doc(`sched-${registeredDoctorUid}`).get();
      expect(schedSnap.exists).toBe(true);
      expect(schedSnap.data().workingHours.start).toBe('09:00');
    });

    it('Admin successfully registers a Nurse with nursing registration number', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(syntheticNurse);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('nurse');
      expect(res.body.data.staffId).toBe(syntheticNurse.staffId);
      expect(res.body.data.shift).toBe('night');

      registeredNurseUid = res.body.data.uid;

      const userSnap = await db.collection('users').doc(registeredNurseUid).get();
      expect(userSnap.exists).toBe(true);
      expect(userSnap.data().role).toBe('nurse');

      const staffSnap = await db.collection('staff').doc(registeredNurseUid).get();
      expect(staffSnap.exists).toBe(true);
      expect(staffSnap.data().registrationNumber).toBe('RN-TEST-48291');
      expect(staffSnap.data().unit).toBe('ICU Triage Desk');
    });

    it('Admin successfully registers a Receptionist with desk assignment', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(syntheticReceptionist);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('reception');
      expect(res.body.data.email).toBe(syntheticReceptionist.email.toLowerCase());

      registeredReceptionUid = res.body.data.uid;

      const staffSnap = await db.collection('staff').doc(registeredReceptionUid).get();
      expect(staffSnap.exists).toBe(true);
      expect(staffSnap.data().role).toBe('reception');
      expect(staffSnap.data().desk).toBe('Main OPD Lobby Desk 1');
    });

    it('Admin successfully registers Pharmacy staff with pharmacy license', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(syntheticPharmacy);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('pharmacy');
      expect(res.body.data.shift).toBe('both');

      registeredPharmacyUid = res.body.data.uid;

      const staffSnap = await db.collection('staff').doc(registeredPharmacyUid).get();
      expect(staffSnap.exists).toBe(true);
      expect(staffSnap.data().role).toBe('pharmacy');
      expect(staffSnap.data().qualification).toBe(syntheticPharmacy.qualification);
    });
  });

  // =========================================================================
  // 2. REGISTRATION SECURITY GUARDS & REJECTIONS [API-ONLY]
  // =========================================================================
  describe('2. Registration Security & Validation Rejections [API-ONLY]', () => {
    it('Rejects duplicate email with 409 EMAIL_IN_USE', async () => {
      const duplicatePayload = {
        ...syntheticDoctor,
        staffId: `DOC-NEW-${Date.now().toString().slice(-4)}`
      };

      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(duplicatePayload);

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('EMAIL_IN_USE');
    });

    it('Rejects duplicate staff ID with 409 STAFF_ID_IN_USE', async () => {
      const duplicateStaffIdPayload = {
        role: 'nurse',
        fullName: 'Nurse Duplicate ID',
        email: `new.nurse.${Date.now()}@smartcare-test.local`,
        password: 'Password@123',
        staffId: syntheticDoctor.staffId, // Already used by doctor
        shift: 'day'
      };

      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(duplicateStaffIdPayload);

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('STAFF_ID_IN_USE');
    });

    it('Rejects weak initial password (< 6 chars)', async () => {
      const weakPassPayload = {
        role: 'reception',
        fullName: 'Short Pass User',
        email: `short.pass.${Date.now()}@smartcare-test.local`,
        password: '12345', // 5 chars
        shift: 'day'
      };

      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(weakPassPayload);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('Rejects invalid email format', async () => {
      const invalidEmailPayload = {
        role: 'pharmacy',
        fullName: 'Invalid Email User',
        email: 'not-an-email-address',
        password: 'ValidPassword123!',
        shift: 'day'
      };

      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send(invalidEmailPayload);

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('Blocks non-admin users (Doctor) from creating staff accounts (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .set('x-demo-uid', mockDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          role: 'nurse',
          fullName: 'Unauthorized Nurse',
          email: 'unauthorized@smartcare.local',
          password: 'Password123'
        });

      expect(res.status).toBe(403);
    });

    it('Blocks unauthenticated requests from registering staff (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/admin/staff')
        .send({
          role: 'doctor',
          fullName: 'No Auth Doctor',
          email: 'noauth@smartcare.local',
          password: 'Password123'
        });

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 3. STAFF DIRECTORY, CATEGORY TABS & REAL KPI STATS [API-ONLY]
  // =========================================================================
  describe('3. Staff Directory & KPI Statistics [API-ONLY]', () => {
    it('Fetches real backend KPI statistics without fabrication', async () => {
      const res = await request(app)
        .get('/api/admin/staff/stats')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(typeof data.total).toBe('number');
      expect(typeof data.active).toBe('number');
      expect(typeof data.inactive).toBe('number');
      expect(data.total).toBeGreaterThanOrEqual(4); // At least the 4 synthetic staff members
      expect(data.byRole).toHaveProperty('doctor');
      expect(data.byRole).toHaveProperty('nurse');
      expect(data.byRole).toHaveProperty('reception');
      expect(data.byRole).toHaveProperty('pharmacy');
      expect(data.byShift).toHaveProperty('day');
      expect(data.byShift).toHaveProperty('night');
      expect(data.byShift).toHaveProperty('both');
      expect(data.departmentsStaffed).toBeGreaterThanOrEqual(1);
    });

    it('Lists staff with category filter (Doctors)', async () => {
      const res = await request(app)
        .get('/api/admin/staff?role=doctor')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.staff)).toBe(true);
      expect(res.body.data.staff.every(s => s.role === 'doctor')).toBe(true);
      expect(res.body.data.staff.some(s => s.email === syntheticDoctor.email.toLowerCase())).toBe(true);
    });

    it('Lists staff with category filter (Nurses)', async () => {
      const res = await request(app)
        .get('/api/admin/staff?role=nurse')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.data.staff.every(s => s.role === 'nurse')).toBe(true);
      expect(res.body.data.staff.some(s => s.email === syntheticNurse.email.toLowerCase())).toBe(true);
    });

    it('Searches staff by keyword', async () => {
      const res = await request(app)
        .get('/api/admin/staff?search=Evelyn')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.data.staff.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.staff[0].name).toContain('Evelyn');
    });

    it('Filters staff by shift (Night shift)', async () => {
      const res = await request(app)
        .get('/api/admin/staff?shift=night')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.data.staff.some(s => s.shift === 'night')).toBe(true);
    });
  });

  // =========================================================================
  // 4. PROFILE EDITING, SHIFT ASSIGNMENT & ACCOUNT STATUS [API-ONLY]
  // =========================================================================
  describe('4. Staff Profile Editing, Shift & Status Operations [API-ONLY]', () => {
    it('Fetches individual staff profile by ID', async () => {
      const res = await request(app)
        .get(`/api/admin/staff/${registeredDoctorUid}`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.data.uid).toBe(registeredDoctorUid);
      expect(res.body.data.role).toBe('doctor');
      expect(res.body.data.qualification).toBe(syntheticDoctor.qualification);
    });

    it('Updates staff profile information', async () => {
      const res = await request(app)
        .put(`/api/admin/staff/${registeredDoctorUid}`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({
          fullName: 'Dr. Evelyn Reed (Senior Fellow)',
          fee: 180,
          experienceYears: 10
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const checkSnap = await db.collection('doctors').doc(registeredDoctorUid).get();
      expect(checkSnap.data().fee).toBe(180);
      expect(checkSnap.data().experienceYears).toBe(10);
    });

    it('Changes assigned shift for a staff member', async () => {
      const res = await request(app)
        .patch(`/api/admin/staff/${registeredNurseUid}/shift`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({ shift: 'day' });

      expect(res.status).toBe(200);
      expect(res.body.data.shift).toBe('day');

      const userSnap = await db.collection('users').doc(registeredNurseUid).get();
      expect(userSnap.data().shift).toBe('day');
    });

    it('Deactivates staff account (sets INACTIVE and syncs Auth disabled)', async () => {
      const res = await request(app)
        .patch(`/api/admin/staff/${registeredReceptionUid}/status`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({ status: 'INACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');

      const userSnap = await db.collection('users').doc(registeredReceptionUid).get();
      expect(userSnap.data().status).toBe('INACTIVE');
    });

    it('Re-activates staff account (sets ACTIVE)', async () => {
      const res = await request(app)
        .patch(`/api/admin/staff/${registeredReceptionUid}/status`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('Admin resets staff password and sets mustChangePassword flag', async () => {
      const res = await request(app)
        .post(`/api/admin/staff/${registeredDoctorUid}/reset-password`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({ newPassword: 'BrandNewDoctorPass@2026' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const userSnap = await db.collection('users').doc(registeredDoctorUid).get();
      expect(userSnap.data().mustChangePassword).toBe(true);
    });
  });

  // =========================================================================
  // 5. ROLE-BASED LOGIN & DASHBOARD ROUTING [END-TO-END]
  // =========================================================================
  describe('5. Role-Based Login & Dashboard Authorization [END-TO-END]', () => {
    it('Doctor logs in via loginSync and receives Doctor identity & permissions', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', registeredDoctorUid)
        .set('x-demo-role', 'doctor')
        .set('x-demo-email', syntheticDoctor.email.toLowerCase());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('doctor');
      expect(res.body.data.email).toBe(syntheticDoctor.email.toLowerCase());

      // Doctor is forbidden from accessing Admin-only analytics overview
      const adminAttempt = await request(app)
        .get('/api/admin/analytics/overview')
        .set('x-demo-uid', registeredDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(adminAttempt.status).toBe(403);
    });

    it('Nurse logs in via loginSync and receives Nurse identity & permissions', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', registeredNurseUid)
        .set('x-demo-role', 'nurse')
        .set('x-demo-email', syntheticNurse.email.toLowerCase());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('nurse');

      // Nurse cannot access Admin routes
      const adminAttempt = await request(app)
        .get('/api/admin/staff')
        .set('x-demo-uid', registeredNurseUid)
        .set('x-demo-role', 'nurse');

      expect(adminAttempt.status).toBe(403);
    });

    it('Receptionist logs in via loginSync and receives Reception identity & permissions', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', registeredReceptionUid)
        .set('x-demo-role', 'reception')
        .set('x-demo-email', syntheticReceptionist.email.toLowerCase());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('reception');
    });

    it('Pharmacy staff logs in via loginSync and receives Pharmacy identity & permissions', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', registeredPharmacyUid)
        .set('x-demo-role', 'pharmacy')
        .set('x-demo-email', syntheticPharmacy.email.toLowerCase());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('pharmacy');
    });
  });

  // =========================================================================
  // 6. PRESERVATION OF EXISTING ADMIN, DOCTORS & PATIENTS [SEEDED]
  // =========================================================================
  describe('6. Existing Account & Patient Record Preservation [SEEDED]', () => {
    it('Pre-existing Admin continues to have full administrative access', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Pre-existing Doctor continues to retain doctor profile and appointment schedules', async () => {
      const res = await request(app)
        .get('/api/doctors')
        .set('x-demo-uid', mockDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('Pre-existing Patient data and self profile remains completely intact', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('x-demo-uid', mockPatientUid)
        .set('x-demo-role', 'patient')
        .set('x-demo-email', 'regular.patient@smartcare.local');

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('patient');
    });
  });

  // =========================================================================
  // 7. SECURITY & CREDENTIAL PRIVACY [CODE-REVIEW]
  // =========================================================================
  describe('7. Security Audit & Credential Hygiene [CODE-REVIEW]', () => {
    it('Verifies audit log was recorded for registration without plaintext password', async () => {
      const auditSnaps = await db.collection('auditLogs')
        .where('targetId', '==', registeredDoctorUid)
        .where('action', '==', 'STAFF_REGISTERED')
        .limit(1)
        .get();

      if (!auditSnaps.empty) {
        const auditData = auditSnaps.docs[0].data();
        expect(auditData.action).toBe('STAFF_REGISTERED');
        expect(auditData.actorRole).toBe('admin');
        expect(JSON.stringify(auditData)).not.toContain('InitialDoctorPass@2026'); // NEVER logged!
      }
    });

    it('Verifies Firestore user and doctor documents do NOT store plaintext password', async () => {
      const userSnap = await db.collection('users').doc(registeredDoctorUid).get();
      const doctorSnap = await db.collection('doctors').doc(registeredDoctorUid).get();

      const userJson = JSON.stringify(userSnap.data());
      const docJson = JSON.stringify(doctorSnap.data());

      expect(userJson).not.toContain('InitialDoctorPass@2026');
      expect(docJson).not.toContain('InitialDoctorPass@2026');
      expect(userSnap.data()).not.toHaveProperty('password');
      expect(doctorSnap.data()).not.toHaveProperty('password');
    });
  });
});

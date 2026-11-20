/**
 * adminHospitalStaffShiftManagement.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive Test Suite for Centralized Hospital Staff Shift Management:
 * 1. 4 Staff Categories: Doctors, Nurses, Reception, Pharmacy.
 * 2. Category Cards with Total, Morning, Night, and Unassigned Counts.
 * 3. Strictly TWO shifts: Morning (09:00 - 17:00) and Night (17:00 - 09:00).
 * 4. Default "Not Assigned" for unassigned staff.
 * 5. Automatic Staff Notifications (FCM Push & In-App):
 *    - "New Duty Shift Assigned" for initial assignment.
 *    - "Duty Shift Updated" for shift updates.
 * 6. Audit & Delivery Status in `shiftHistory` collection.
 * 7. Staff Self-Service endpoint (`GET /api/staff/my-shift`) with strict role guards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected, auth } from '../src/config/firebase.js';

describe('Centralized Hospital Staff Shift Management Test Suite', () => {
  let db;

  const mockAdminUid = 'test-admin-shift-lead';
  const mockDoctorUid = 'test-shift-doc-01';
  const mockNurseUid = 'test-shift-nurse-01';
  const mockReceptionUid = 'test-shift-rec-01';
  const mockPharmacyUid = 'test-shift-phm-01';
  const mockPatientUid = 'test-shift-patient-01';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Setup Admin
    await db.collection('users').doc(mockAdminUid).set({
      uid: mockAdminUid,
      email: 'admin.shiftlead@smartcare.local',
      role: 'admin',
      displayName: 'Shift Admin Lead',
      fullName: 'Shift Admin Lead',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 2. Setup Doctor (initially unassigned shift)
    await db.collection('users').doc(mockDoctorUid).set({
      uid: mockDoctorUid,
      email: 'dr.ananya.deshmukh@smartcare.local',
      role: 'doctor',
      staffId: 'DOC-NEURO-991',
      doctorId: 'DOC-NEURO-991',
      displayName: 'Dr. Ananya Deshmukh',
      fullName: 'Dr. Ananya Deshmukh',
      departmentId: 'dept-neuro',
      departmentName: 'Neurology',
      shift: 'none',
      status: 'ACTIVE',
      fcmTokens: [{ token: 'test-fcm-doctor-token-12345', device: 'Chrome', lastSeen: new Date() }],
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('doctors').doc(mockDoctorUid).set({
      uid: mockDoctorUid,
      doctorId: 'DOC-NEURO-991',
      name: 'Dr. Ananya Deshmukh',
      departmentId: 'dept-neuro',
      departmentName: 'Neurology',
      shift: 'none',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 3. Setup Nurse (initially morning shift)
    await db.collection('users').doc(mockNurseUid).set({
      uid: mockNurseUid,
      email: 'nurse.sarah.connor@smartcare.local',
      role: 'nurse',
      staffId: 'NUR-ICU-882',
      displayName: 'Nurse Sarah Connor',
      fullName: 'Nurse Sarah Connor',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      unit: 'ICU Ward',
      shift: 'morning',
      shiftTiming: '09:00 AM – 05:00 PM',
      shiftEffectiveDate: '2026-11-01',
      status: 'ACTIVE',
      fcmTokens: [], // No FCM token to test 'push_unavailable'
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('staff').doc(mockNurseUid).set({
      uid: mockNurseUid,
      staffId: 'NUR-ICU-882',
      name: 'Nurse Sarah Connor',
      role: 'nurse',
      shift: 'morning',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 4. Setup Receptionist (initially night shift)
    await db.collection('users').doc(mockReceptionUid).set({
      uid: mockReceptionUid,
      email: 'rec.rohit.kumar@smartcare.local',
      role: 'reception',
      staffId: 'REC-OPD-773',
      displayName: 'Rohit Kumar',
      fullName: 'Rohit Kumar',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      desk: 'Main Lobby Desk',
      shift: 'night',
      shiftTiming: '05:00 PM – 09:00 AM',
      shiftEffectiveDate: '2026-11-01',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('staff').doc(mockReceptionUid).set({
      uid: mockReceptionUid,
      staffId: 'REC-OPD-773',
      name: 'Rohit Kumar',
      role: 'reception',
      shift: 'night',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 5. Setup Pharmacy (unassigned)
    await db.collection('users').doc(mockPharmacyUid).set({
      uid: mockPharmacyUid,
      email: 'phm.priya.sharma@smartcare.local',
      role: 'pharmacy',
      staffId: 'PHM-MAIN-664',
      displayName: 'Priya Sharma',
      fullName: 'Priya Sharma',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      shift: 'none',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('staff').doc(mockPharmacyUid).set({
      uid: mockPharmacyUid,
      staffId: 'PHM-MAIN-664',
      name: 'Priya Sharma',
      role: 'pharmacy',
      shift: 'none',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    // 6. Setup Patient
    await db.collection('users').doc(mockPatientUid).set({
      uid: mockPatientUid,
      email: 'patient.user@smartcare.local',
      role: 'patient',
      displayName: 'Test Patient',
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });
  });

  afterAll(async () => {
    const uids = [
      mockAdminUid,
      mockDoctorUid,
      mockNurseUid,
      mockReceptionUid,
      mockPharmacyUid,
      mockPatientUid
    ];
    for (const uid of uids) {
      try {
        await db.collection('users').doc(uid).delete();
        await db.collection('doctors').doc(uid).delete();
        await db.collection('staff').doc(uid).delete();
        await db.collection('doctorSchedules').doc(`sched-${uid}`).delete();
      } catch (_) {}
    }
  });

  // =========================================================================
  // 1. CATEGORIZED SHIFT OVERVIEW [API-ONLY]
  // =========================================================================
  describe('1. Categorized Shift Overview [API-ONLY]', () => {
    it('Admin fetches overview with all 4 staff categories and breakdown', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/overview')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.categories).toBeDefined();

      // Check all 4 categories exist
      expect(data.categories.doctor).toBeDefined();
      expect(data.categories.nurse).toBeDefined();
      expect(data.categories.reception).toBeDefined();
      expect(data.categories.pharmacy).toBeDefined();

      // Verify category fields: total, morningCount, nightCount, unassignedCount
      expect(typeof data.categories.doctor.total).toBe('number');
      expect(typeof data.categories.doctor.morningCount).toBe('number');
      expect(typeof data.categories.doctor.nightCount).toBe('number');
      expect(typeof data.categories.doctor.unassignedCount).toBe('number');

      // Verify available shifts return strictly Morning and Night
      expect(data.shiftsAvailable).toHaveLength(2);
      expect(data.shiftsAvailable[0].name).toBe('Morning Shift');
      expect(data.shiftsAvailable[0].timing).toBe('09:00 AM – 05:00 PM');
      expect(data.shiftsAvailable[1].name).toBe('Night Shift');
      expect(data.shiftsAvailable[1].timing).toBe('05:00 PM – 09:00 AM');
    });

    it('Non-admin is forbidden from fetching shift overview', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/overview')
        .set('x-demo-uid', mockDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 2. CATEGORY-FILTERED STAFF LIST [API-ONLY]
  // =========================================================================
  describe('2. Category Filter & Unassigned Staff Display [API-ONLY]', () => {
    it('Doctor category returns only doctors and shows unassigned correctly', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/staff?role=doctor')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const staff = res.body.data.staff;
      expect(staff.length).toBeGreaterThan(0);
      expect(staff.every((s) => s.role === 'doctor')).toBe(true);

      const testDoc = staff.find((s) => s.uid === mockDoctorUid);
      expect(testDoc).toBeDefined();
      expect(testDoc.currentShift).toBe('none');
      expect(testDoc.shiftDisplay).toBe('Not Assigned');
    });

    it('Nurse category returns only nurses', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/staff?role=nurse')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      const staff = res.body.data.staff;
      expect(staff.every((s) => s.role === 'nurse')).toBe(true);

      const testNurse = staff.find((s) => s.uid === mockNurseUid);
      expect(testNurse).toBeDefined();
      expect(testNurse.currentShift).toBe('morning');
      expect(testNurse.shiftDisplay).toBe('Morning Shift');
    });

    it('Reception category returns only reception staff', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/staff?role=reception')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      const staff = res.body.data.staff;
      expect(staff.every((s) => s.role === 'reception')).toBe(true);

      const testRec = staff.find((s) => s.uid === mockReceptionUid);
      expect(testRec).toBeDefined();
      expect(testRec.currentShift).toBe('night');
      expect(testRec.shiftDisplay).toBe('Night Shift');
    });

    it('Pharmacy category returns only pharmacy staff', async () => {
      const res = await request(app)
        .get('/api/admin/shifts/staff?role=pharmacy')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      const staff = res.body.data.staff;
      expect(staff.every((s) => s.role === 'pharmacy')).toBe(true);
    });
  });

  // =========================================================================
  // 3. SHIFT ASSIGNMENT & STRICT 2-SHIFT VALIDATION [API-ONLY]
  // =========================================================================
  describe('3. Shift Assignment & Strict Validation [API-ONLY]', () => {
    it('Rejects invalid shift ("both", "rotational") with 400 Validation Error', async () => {
      const res = await request(app)
        .post('/api/admin/shifts/assign')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({
          staffUid: mockDoctorUid,
          newShift: 'rotational'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/morning.*night/i);
    });

    it('Assigns Morning Shift (09:00 - 17:00) to previously unassigned doctor', async () => {
      const res = await request(app)
        .post('/api/admin/shifts/assign')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({
          staffUid: mockDoctorUid,
          newShift: 'morning',
          effectiveDate: '2026-11-20'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.newShift).toBe('morning');
      expect(res.body.data.shiftDisplay).toBe('Morning Shift');
      expect(res.body.data.shiftTiming).toBe('09:00 AM – 05:00 PM');
      expect(res.body.data.effectiveDate).toBe('2026-11-20');
      expect(res.body.data.historyId).toBeDefined();

      // Verify Firestore users collection updated
      const userDoc = await db.collection('users').doc(mockDoctorUid).get();
      expect(userDoc.data().shift).toBe('morning');
      expect(userDoc.data().shiftTiming).toBe('09:00 AM – 05:00 PM');
      expect(userDoc.data().shiftEffectiveDate).toBe('2026-11-20');

      // Verify doctor schedule collection updated with 09:00 - 17:00
      const schedDoc = await db.collection('doctorSchedules').doc(`sched-${mockDoctorUid}`).get();
      expect(schedDoc.exists).toBe(true);
      expect(schedDoc.data().workingHours).toEqual({ start: '09:00', end: '17:00' });
    });

    it('Dispatches "New Duty Shift Assigned" notification for initial assignment', async () => {
      // Check notification created in Firestore notifications collection
      const notifSnap = await db.collection('notifications')
        .where('uid', '==', mockDoctorUid)
        .where('type', '==', 'shift_assignment')
        .get();

      expect(notifSnap.empty).toBe(false);
      const notifs = notifSnap.docs.map((d) => d.data());
      const initialNotif = notifs.find((n) => n.title === 'New Duty Shift Assigned');
      expect(initialNotif).toBeDefined();
      expect(initialNotif.body).toContain('Your duty shift has been assigned');
      expect(initialNotif.body).toContain('Shift: Morning Shift');
      expect(initialNotif.body).toContain('Timing: 09:00 AM – 05:00 PM');
    });

    it('Updates Doctor to Night Shift (17:00 - 09:00) and sends "Duty Shift Updated" notification', async () => {
      const res = await request(app)
        .post('/api/admin/shifts/assign')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({
          staffUid: mockDoctorUid,
          newShift: 'night',
          effectiveDate: '2026-11-21'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.previousShift).toBe('morning');
      expect(res.body.data.newShift).toBe('night');
      expect(res.body.data.shiftDisplay).toBe('Night Shift');
      expect(res.body.data.shiftTiming).toBe('05:00 PM – 09:00 AM');

      // Check updated notification created
      const notifSnap = await db.collection('notifications')
        .where('uid', '==', mockDoctorUid)
        .where('type', '==', 'shift_assignment')
        .get();

      const notifs = notifSnap.docs.map((d) => d.data());
      const updatedNotif = notifs.find((n) => n.title === 'Duty Shift Updated');
      expect(updatedNotif).toBeDefined();
      expect(updatedNotif.body).toContain('Your duty shift has been changed');
      expect(updatedNotif.body).toContain('Previous Shift: Morning Shift');
      expect(updatedNotif.body).toContain('New Shift: Night Shift');
      expect(updatedNotif.body).toContain('Timing: 05:00 PM – 09:00 AM');

      // Verify doctor schedule collection updated to overnight 17:00 - 09:00
      const schedDoc = await db.collection('doctorSchedules').doc(`sched-${mockDoctorUid}`).get();
      expect(schedDoc.data().workingHours).toEqual({ start: '17:00', end: '09:00' });
    });
  });

  // =========================================================================
  // 4. SHIFT HISTORY & AUDIT TRAIL [API-ONLY]
  // =========================================================================
  describe('4. Shift History & Audit Trail [API-ONLY]', () => {
    it('Admin retrieves chronological shift history with delivery status', async () => {
      const res = await request(app)
        .get(`/api/admin/shifts/history/${mockDoctorUid}`)
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const history = res.body.data.history;
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Verify first record is the latest night shift assignment
      expect(history[0].newShift).toBe('night');
      expect(history[0].previousShift).toBe('morning');
      expect(history[0].timing).toBe('05:00 PM – 09:00 AM');
      expect(history[0].notificationStatus).toBeDefined();

      // Verify second record is the initial morning shift assignment
      expect(history[1].newShift).toBe('morning');
      expect(history[1].previousShift).toBe('none');
    });

    it('FCM token absence records push_unavailable without failing assignment', async () => {
      // Assign shift to Nurse who has no FCM tokens
      const res = await request(app)
        .post('/api/admin/shifts/assign')
        .set('x-demo-uid', mockAdminUid)
        .set('x-demo-role', 'admin')
        .send({
          staffUid: mockNurseUid,
          newShift: 'night',
          effectiveDate: '2026-11-22'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // In-app was created, push was unavailable
      expect(['push_unavailable', 'in_app_only']).toContain(res.body.data.notificationStatus);
    });
  });

  // =========================================================================
  // 5. STAFF SELF-SERVICE DASHBOARD INTEGRATION [END-TO-END]
  // =========================================================================
  describe('5. Staff Self-Service Endpoint (/api/staff/my-shift) [END-TO-END]', () => {
    it('Doctor can fetch their own duty shift information and latest notification', async () => {
      const res = await request(app)
        .get('/api/staff/my-shift')
        .set('x-demo-uid', mockDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.uid).toBe(mockDoctorUid);
      expect(data.name).toBe('Dr. Ananya Deshmukh');
      expect(data.role).toBe('doctor');
      expect(data.currentShift).toBe('Night Shift');
      expect(data.timing).toBe('05:00 PM – 09:00 AM');
      expect(data.effectiveDate).toBe('2026-11-21');
      expect(data.latestNotification).toBeDefined();
      expect(data.latestNotification.title).toBe('Duty Shift Updated');
    });

    it('Nurse can fetch their own duty shift information', async () => {
      const res = await request(app)
        .get('/api/staff/my-shift')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse');

      expect(res.status).toBe(200);
      expect(res.body.data.currentShift).toBe('Night Shift');
    });

    it('Unassigned Pharmacy staff sees "Not Assigned" in self-service', async () => {
      const res = await request(app)
        .get('/api/staff/my-shift')
        .set('x-demo-uid', mockPharmacyUid)
        .set('x-demo-role', 'pharmacy');

      expect(res.status).toBe(200);
      expect(res.body.data.currentShift).toBe('Not Assigned');
      expect(dataNotAssigned(res.body.data)).toBe(true);
    });

    it('Regular patient is denied access (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/staff/my-shift')
        .set('x-demo-uid', mockPatientUid)
        .set('x-demo-role', 'patient');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('Unauthenticated request is rejected (401 Unauthorized)', async () => {
      const res = await request(app)
        .get('/api/staff/my-shift');

      expect(res.status).toBe(401);
    });
  });
});

function dataNotAssigned(data) {
  return data.currentShift === 'Not Assigned' || data.rawShift === 'none';
}

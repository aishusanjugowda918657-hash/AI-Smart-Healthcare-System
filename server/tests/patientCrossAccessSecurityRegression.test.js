import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Phase 41 — Patient Cross-Access & Authorization Boundaries Regression Suite', () => {
  let db;

  // Patient A (Attacker / Unrelated Patient)
  const patientAUid = 'p41-patient-a-uid';
  const patientAHid = 'PHI-2026-P41A01';

  // Patient B (Victim Patient)
  const patientBUid = 'p41-patient-b-uid';
  const patientBHid = 'PHI-2026-P41B02';

  // Caregiver / Guardian and Dependent
  const caregiverUid = 'p41-caregiver-uid';
  const caregiverHid = 'PHI-2026-P41CG1';
  const dependentUid = 'p41-dependent-uid';
  const dependentHid = 'PHI-2026-P41DEP';

  // Staff / Doctor / Admin
  const doctorUid = 'p41-doctor-uid';
  const doctorId = 'DOC-P41-01';
  const adminUid = 'p41-admin-uid';

  // Test Entities
  const apptBId = 'APT-P41-B-001';
  const apptDepId = 'APT-P41-DEP-001';

  const waitlistBId = 'WL-P41-B-001';
  const waitlistDepId = 'WL-P41-DEP-001';
  const waitlistStaffId = 'WL-P41-STAFF-001';

  const offerBId = 'OFF-P41-B-001';
  const offerDepId = 'OFF-P41-DEP-001';

  const followupBId = 'FLW-P41-B-001';
  const followupDepId = 'FLW-P41-DEP-001';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Setup Patient A
    await db.collection('patients').doc(patientAUid).set({
      uid: patientAUid,
      patientUid: patientAUid,
      patientHealthId: patientAHid,
      healthId: patientAHid,
      fullName: 'Patient A',
      ownerUid: patientAUid,
      createdAt: new Date()
    });

    // 2. Setup Patient B
    await db.collection('patients').doc(patientBUid).set({
      uid: patientBUid,
      patientUid: patientBUid,
      patientHealthId: patientBHid,
      healthId: patientBHid,
      fullName: 'Patient B',
      ownerUid: patientBUid,
      createdAt: new Date()
    });
    // Also index under patientBHid for dual lookup support
    await db.collection('patients').doc(patientBHid).set({
      uid: patientBUid,
      patientUid: patientBUid,
      patientHealthId: patientBHid,
      healthId: patientBHid,
      fullName: 'Patient B',
      ownerUid: patientBUid,
      createdAt: new Date()
    });

    // 3. Setup Caregiver and Dependent
    await db.collection('patients').doc(caregiverUid).set({
      uid: caregiverUid,
      patientUid: caregiverUid,
      patientHealthId: caregiverHid,
      healthId: caregiverHid,
      fullName: 'Caregiver Guardian',
      ownerUid: caregiverUid,
      createdAt: new Date()
    });
    await db.collection('patients').doc(dependentUid).set({
      uid: dependentUid,
      patientUid: dependentUid,
      patientHealthId: dependentHid,
      healthId: dependentHid,
      fullName: 'Dependent Child',
      ownerUid: caregiverUid,
      primaryAccountUid: caregiverUid,
      createdAt: new Date()
    });
    await db.collection('patients').doc(dependentHid).set({
      uid: dependentUid,
      patientUid: dependentUid,
      patientHealthId: dependentHid,
      healthId: dependentHid,
      fullName: 'Dependent Child',
      ownerUid: caregiverUid,
      primaryAccountUid: caregiverUid,
      createdAt: new Date()
    });

    // 4. Setup Doctor
    await db.collection('doctors').doc(doctorUid).set({
      uid: doctorUid,
      doctorId,
      name: 'Dr. Phase 41 Doctor',
      specialty: 'General Medicine'
    });

    // 5. Setup Appointments
    await db.collection('appointments').doc(apptBId).set({
      id: apptBId,
      appointmentId: apptBId,
      patientUid: patientBUid,
      patientHealthId: patientBHid,
      doctorUid,
      doctorId,
      date: '2026-10-15',
      timeSlot: '10:00',
      status: 'booked',
      leaveHome: { travelMinutes: 15 },
      earlyOptIn: false,
      createdAt: new Date()
    });
    await db.collection('appointments').doc(apptDepId).set({
      id: apptDepId,
      appointmentId: apptDepId,
      patientUid: dependentUid,
      patientHealthId: dependentHid,
      ownerUid: caregiverUid,
      doctorUid,
      doctorId,
      date: '2026-10-15',
      timeSlot: '11:00',
      status: 'booked',
      leaveHome: { travelMinutes: 10 },
      earlyOptIn: false,
      createdAt: new Date()
    });

    // 6. Setup Waitlist Entries
    await db.collection('waitlist').doc(waitlistBId).set({
      id: waitlistBId,
      userId: patientBUid,
      healthId: patientBHid,
      status: 'waiting',
      createdAt: new Date().toISOString()
    });
    await db.collection('waitlist').doc(waitlistDepId).set({
      id: waitlistDepId,
      userId: dependentUid,
      healthId: dependentHid,
      status: 'waiting',
      createdAt: new Date().toISOString()
    });
    await db.collection('waitlist').doc(waitlistStaffId).set({
      id: waitlistStaffId,
      userId: patientBUid,
      healthId: patientBHid,
      status: 'waiting',
      createdAt: new Date().toISOString()
    });

    // 7. Setup Slot Offers
    await db.collection('offers').doc(offerBId).set({
      id: offerBId,
      userId: patientBUid,
      patientHealthId: patientBHid,
      status: 'open',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      kind: 'p41_cross_offer',
      options: [{ type: 'join_waitlist' }],
      createdAt: new Date().toISOString()
    });
    await db.collection('offers').doc(offerDepId).set({
      id: offerDepId,
      userId: dependentUid,
      patientHealthId: dependentHid,
      status: 'open',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      kind: 'p41_cross_offer',
      options: [{ type: 'join_waitlist' }],
      createdAt: new Date().toISOString()
    });

    // 8. Setup Follow-ups
    await db.collection('followups').doc(followupBId).set({
      id: followupBId,
      followUpId: followupBId,
      patientUid: patientBUid,
      patientHealthId: patientBHid,
      healthId: patientBHid,
      doctorId,
      status: 'scheduled',
      scheduledDate: '2026-10-20',
      snoozeCount: 0,
      createdAt: new Date().toISOString()
    });
    await db.collection('followups').doc(followupDepId).set({
      id: followupDepId,
      followUpId: followupDepId,
      patientUid: dependentUid,
      patientHealthId: dependentHid,
      healthId: dependentHid,
      doctorId,
      status: 'scheduled',
      scheduledDate: '2026-10-22',
      snoozeCount: 0,
      createdAt: new Date().toISOString()
    });
  });

  afterAll(async () => {
    // Clean up all fixtures
    const batch = db.batch();
    batch.delete(db.collection('patients').doc(patientAUid));
    batch.delete(db.collection('patients').doc(patientBUid));
    batch.delete(db.collection('patients').doc(patientBHid));
    batch.delete(db.collection('patients').doc(caregiverUid));
    batch.delete(db.collection('patients').doc(dependentUid));
    batch.delete(db.collection('patients').doc(dependentHid));
    batch.delete(db.collection('doctors').doc(doctorUid));

    batch.delete(db.collection('appointments').doc(apptBId));
    batch.delete(db.collection('appointments').doc(apptDepId));

    batch.delete(db.collection('waitlist').doc(waitlistBId));
    batch.delete(db.collection('waitlist').doc(waitlistDepId));
    batch.delete(db.collection('waitlist').doc(waitlistStaffId));

    batch.delete(db.collection('offers').doc(offerBId));
    batch.delete(db.collection('offers').doc(offerDepId));

    batch.delete(db.collection('followups').doc(followupBId));
    batch.delete(db.collection('followups').doc(followupDepId));
    await batch.commit().catch(() => {});
  });

  // =========================================================================
  // 1. Slot Offers Authorization
  // =========================================================================
  describe('1. Slot Offers Authorization Boundaries', () => {
    it('Patient A CANNOT view Patient B offer (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/offers/${offerBId}`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('Patient A CANNOT decline Patient B offer (403 FORBIDDEN & No Mutation)', async () => {
      const res = await request(app)
        .post(`/api/offers/${offerBId}/decline`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);

      // Verify Firestore document was NOT mutated
      const doc = await db.collection('offers').doc(offerBId).get();
      expect(doc.data().status).toBe('open');
      expect(doc.data().declinedAt).toBeUndefined();
    });

    it('Patient A CANNOT accept Patient B offer (403 FORBIDDEN & No Mutation)', async () => {
      const res = await request(app)
        .post(`/api/offers/${offerBId}/accept`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ optionIndex: 0 });

      expect(res.statusCode).toBe(403);

      // Verify Firestore document remains open
      const doc = await db.collection('offers').doc(offerBId).get();
      expect(doc.data().status).toBe('open');
    });

    it('Patient B CAN view their own offer (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/offers/${offerBId}`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.offer.id).toBe(offerBId);
    });

    it('Authorized Caregiver CAN view and decline dependent offer (200 OK)', async () => {
      const viewRes = await request(app)
        .get(`/api/offers/${offerDepId}`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient');

      expect(viewRes.statusCode).toBe(200);
      expect(viewRes.body.success).toBe(true);

      const declineRes = await request(app)
        .post(`/api/offers/${offerDepId}/decline`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient');

      expect(declineRes.statusCode).toBe(200);
      expect(declineRes.body.success).toBe(true);

      const doc = await db.collection('offers').doc(offerDepId).get();
      expect(doc.data().status).toBe('declined');
    });
  });

  // =========================================================================
  // 2. Waitlist Authorization
  // =========================================================================
  describe('2. Waitlist Authorization Boundaries', () => {
    it('Patient A CANNOT delete/leave Patient B waitlist entry (403 FORBIDDEN & No Mutation)', async () => {
      const res = await request(app)
        .delete(`/api/waitlist/${waitlistBId}`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);

      // Verify waitlist status remains 'waiting'
      const doc = await db.collection('waitlist').doc(waitlistBId).get();
      expect(doc.data().status).toBe('waiting');
    });

    it('Patient B CAN leave their own waitlist entry (200 OK)', async () => {
      const res = await request(app)
        .delete(`/api/waitlist/${waitlistBId}`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const doc = await db.collection('waitlist').doc(waitlistBId).get();
      expect(doc.data().status).toBe('cancelled');
    });

    it('Authorized Caregiver CAN leave dependent waitlist entry (200 OK)', async () => {
      const res = await request(app)
        .delete(`/api/waitlist/${waitlistDepId}`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const doc = await db.collection('waitlist').doc(waitlistDepId).get();
      expect(doc.data().status).toBe('cancelled');
    });

    it('Admin/Staff CAN manage and leave waitlist entry (200 OK)', async () => {
      const res = await request(app)
        .delete(`/api/waitlist/${waitlistStaffId}`)
        .set('x-demo-uid', adminUid)
        .set('x-demo-role', 'admin');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const doc = await db.collection('waitlist').doc(waitlistStaffId).get();
      expect(doc.data().status).toBe('cancelled');
    });
  });

  // =========================================================================
  // 3. Follow-ups Authorization
  // =========================================================================
  describe('3. Follow-ups Authorization Boundaries', () => {
    it('Patient A CANNOT list Patient B follow-ups by healthId (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/followups?healthId=${patientBHid}`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('Patient A CANNOT act on Patient B follow-up (403 FORBIDDEN & No Mutation)', async () => {
      const res = await request(app)
        .patch(`/api/followups/${followupBId}`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'later', days: 5 });

      expect(res.statusCode).toBe(403);

      const doc = await db.collection('followups').doc(followupBId).get();
      expect(doc.data().status).toBe('scheduled');
      expect(doc.data().snoozeCount).toBe(0);
    });

    it('Patient B CAN view and act on their own follow-up (200 OK)', async () => {
      const listRes = await request(app)
        .get(`/api/followups?healthId=${patientBHid}`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient');

      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.success).toBe(true);

      const actionRes = await request(app)
        .patch(`/api/followups/${followupBId}`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'later', days: 7 });

      expect(actionRes.statusCode).toBe(200);
      expect(actionRes.body.success).toBe(true);

      const doc = await db.collection('followups').doc(followupBId).get();
      expect(doc.data().snoozeCount).toBe(1);
    });

    it('Authorized Caregiver CAN view and act on dependent follow-up (200 OK)', async () => {
      const listRes = await request(app)
        .get(`/api/followups?healthId=${dependentHid}`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient');

      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.success).toBe(true);

      const actionRes = await request(app)
        .patch(`/api/followups/${followupDepId}`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient')
        .send({ action: 'later', days: 3 });

      expect(actionRes.statusCode).toBe(200);
      expect(actionRes.body.success).toBe(true);

      const doc = await db.collection('followups').doc(followupDepId).get();
      expect(doc.data().snoozeCount).toBe(1);
    });

    it('Doctor CAN view upcoming follow-ups workflow (200 OK)', async () => {
      const res = await request(app)
        .get('/api/followups/doctor-upcoming')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 4. Queue Early Opt-in Settings Authorization & Leave-Home Removal
  // =========================================================================
  describe('4. Queue Settings Authorization Boundaries', () => {
    it('Leave-home endpoint is removed (404 NOT FOUND)', async () => {
      const res = await request(app)
        .post(`/api/queue/appointments/${apptBId}/leave-home`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient')
        .send({ travelMinutes: 60 });

      expect(res.statusCode).toBe(404);
    });

    it('Patient A CANNOT modify Patient B early-optin (403 FORBIDDEN & No Mutation)', async () => {
      const res = await request(app)
        .post(`/api/queue/appointments/${apptBId}/early-optin`)
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient')
        .send({ earlyOptIn: true });

      expect(res.statusCode).toBe(403);

      const doc = await db.collection('appointments').doc(apptBId).get();
      expect(doc.data().earlyOptIn).toBe(false);
    });

    it('Patient B CAN update their own early-optin (200 OK)', async () => {
      const optinRes = await request(app)
        .post(`/api/queue/appointments/${apptBId}/early-optin`)
        .set('x-demo-uid', patientBUid)
        .set('x-demo-role', 'patient')
        .send({ earlyOptIn: true });

      expect(optinRes.statusCode).toBe(200);
      expect(optinRes.body.success).toBe(true);

      const doc = await db.collection('appointments').doc(apptBId).get();
      expect(doc.data().earlyOptIn).toBe(true);
    });

    it('Authorized Caregiver CAN update dependent appointment early-optin (200 OK)', async () => {
      const optinRes = await request(app)
        .post(`/api/queue/appointments/${apptDepId}/early-optin`)
        .set('x-demo-uid', caregiverUid)
        .set('x-demo-role', 'patient')
        .send({ earlyOptIn: true });

      expect(optinRes.statusCode).toBe(200);
      expect(optinRes.body.success).toBe(true);

      const doc = await db.collection('appointments').doc(apptDepId).get();
      expect(doc.data().earlyOptIn).toBe(true);
    });
  });

  // =========================================================================
  // 5. No-Show Scheduler Trigger Authorization
  // =========================================================================
  describe('5. No-Show Scheduler Trigger Authorization', () => {
    it('Anonymous trigger request is denied (401 UNAUTHORIZED)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check');

      expect(res.statusCode).toBe(401);
    });

    it('Patient role trigger request is denied (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check')
        .set('x-demo-uid', patientAUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('Doctor role trigger request is denied (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
    });

    it('Admin role trigger request is authorized (200 OK)', async () => {
      const res = await request(app)
        .post('/api/appointments/run-no-show-check')
        .set('x-demo-uid', adminUid)
        .set('x-demo-role', 'admin');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

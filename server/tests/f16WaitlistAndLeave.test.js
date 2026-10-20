/**
 * Vitest Acceptance Tests for Phase 11 (PRD F16)
 * Doctor Leave Auto-Rescheduling, Waiting-List Auto-Fill & Same-Doctor Continuity
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { leaveRescheduleJob } from '../src/jobs/leaveReschedule.js';
import { joinWaitlist, offerFreedSlot, expireWaitlistOffersJob } from '../src/services/waitlistService.js';
import { acceptOffer } from '../src/controllers/offerController.js';

// Mock auth middleware
vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'user-patient-f16',
      id: req.headers['x-test-uid'] || 'user-patient-f16',
      role: req.headers['x-test-role'] || 'patient',
      patientHealthId: req.headers['x-test-hid'] || 'HID-F16-P1'
    };
    next();
  }
}));

describe('Phase 11: F16 Doctor Leave & Waitlist Auto-Fill Tests', () => {
  let db;

  beforeEach(async () => {
    db = assertDbConnected();

    // Seed test doctor & slots
    const oldOffers = await db.collection('offers').where('appointmentId', '==', 'appt-f16-affected').get();
    if (!oldOffers.empty) {
      const b = db.batch();
      oldOffers.docs.forEach(d => b.delete(d.ref));
      await b.commit();
    }

    await db.collection('doctors').doc('doc-f16-101').set({
      id: 'doc-f16-101',
      doctorId: 'doc-f16-101',
      fullName: 'Dr. Leave Doctor',
      departmentId: 'dept-ortho'
    });

    await db.collection('slots').doc('slot-f16-old').set({
      id: 'slot-f16-old',
      doctorId: 'doc-f16-101',
      date: '2026-10-20',
      timeSlot: '10:00',
      available: false,
      status: 'booked'
    });

    await db.collection('slots').doc('slot-f16-new').set({
      id: 'slot-f16-new',
      doctorId: 'doc-f16-101',
      date: '2026-10-22',
      timeSlot: '11:00',
      available: true,
      status: 'free'
    });

    await db.collection('appointments').doc('appt-f16-affected').set({
      id: 'appt-f16-affected',
      patientHealthId: 'HID-F16-P1',
      patientName: 'Patient One',
      userId: 'user-patient-f16',
      doctorId: 'doc-f16-101',
      doctorName: 'Dr. Leave Doctor',
      date: '2026-10-20',
      timeSlot: '10:00',
      slotId: 'slot-f16-old',
      status: 'booked',
      clinicalLevel: 2
    });
  });

  it('Adding a leave never deletes appointments; affected appointment receives offer', async () => {
    // 1. Create doctor leave via API
    const leaveRes = await supertest(app)
      .post('/api/admin/leaves')
      .set('x-test-uid', 'admin-user')
      .set('x-test-role', 'admin')
      .send({
        doctorId: 'doc-f16-101',
        date: '2026-10-20',
        reason: 'Medical Conference'
      });

    expect(leaveRes.status).toBe(201);
    const leaveId = leaveRes.body.data.leave.id;

    // 2. Run leaveRescheduleJob
    const jobRes = await leaveRescheduleJob();
    expect(jobRes.success).toBe(true);
    expect(jobRes.affectedAppointmentsCount).toBeGreaterThanOrEqual(1);

    // 3. Verify appointment still exists and offer document created
    const apptDoc = await db.collection('appointments').doc('appt-f16-affected').get();
    expect(apptDoc.exists).toBe(true);

    const offersSnap = await db.collection('offers')
      .where('appointmentId', '==', 'appt-f16-affected')
      .get();

    expect(offersSnap.empty).toBe(false);
    const offer = offersSnap.docs[0].data();
    expect(offer.kind).toBe('leave_reschedule');
    expect(offer.status).toBe('open');

    // Verify progress API endpoint
    const progRes = await supertest(app)
      .get(`/api/admin/leaves/${leaveId}/progress`)
      .set('x-test-uid', 'admin-user')
      .set('x-test-role', 'admin');

    expect(progRes.status).toBe(200);
    expect(progRes.body.progress.affected).toBeGreaterThanOrEqual(1);
  });

  it('Accepting an offer releases old slot and books new slot atomically', async () => {
    // Seed an open leave_reschedule offer
    const offerId = 'offer-atomic-test';
    await db.collection('offers').doc(offerId).set({
      id: offerId,
      kind: 'leave_reschedule',
      appointmentId: 'appt-f16-affected',
      patientHealthId: 'HID-F16-P1',
      userId: 'user-patient-f16',
      options: [
        {
          type: 'same_doctor_next',
          doctorId: 'doc-f16-101',
          doctorName: 'Dr. Leave Doctor',
          date: '2026-10-22',
          timeSlot: '11:00',
          slotId: 'slot-f16-new'
        }
      ],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: 'open'
    });

    const acceptRes = await supertest(app)
      .post(`/api/offers/${offerId}/accept`)
      .set('x-test-uid', 'user-patient-f16')
      .set('x-test-role', 'patient')
      .send({ optionIndex: 0 });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.success).toBe(true);

    // Verify target slot is booked
    const newSlotDoc = await db.collection('slots').doc('slot-f16-new').get();
    expect(newSlotDoc.data().available).toBe(false);

    // Verify old slot is released
    const oldSlotDoc = await db.collection('slots').doc('slot-f16-old').get();
    expect(oldSlotDoc.data().available).toBe(true);

    // Verify offer status updated
    const offerDoc = await db.collection('offers').doc(offerId).get();
    expect(offerDoc.data().status).toBe('accepted');
  });

  it('Two waiting patients cannot both accept the same slot (transactional lock)', async () => {
    const offer1 = 'offer-concurrent-1';
    const offer2 = 'offer-concurrent-2';

    await db.collection('slots').doc('slot-race').set({
      id: 'slot-race',
      doctorId: 'doc-f16-101',
      date: '2026-10-25',
      timeSlot: '09:00',
      available: true
    });

    await db.collection('offers').doc(offer1).set({
      id: offer1,
      kind: 'waitlist',
      patientHealthId: 'HID-P1',
      userId: 'user-p1',
      slotDetails: { slotId: 'slot-race', doctorId: 'doc-f16-101', date: '2026-10-25', timeSlot: '09:00' },
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      status: 'open'
    });

    await db.collection('offers').doc(offer2).set({
      id: offer2,
      kind: 'waitlist',
      patientHealthId: 'HID-P2',
      userId: 'user-p2',
      slotDetails: { slotId: 'slot-race', doctorId: 'doc-f16-101', date: '2026-10-25', timeSlot: '09:00' },
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      status: 'open'
    });

    // Accept offer 1
    const res1 = await supertest(app)
      .post(`/api/offers/${offer1}/accept`)
      .set('x-test-uid', 'user-p1')
      .set('x-test-role', 'patient')
      .send({ optionIndex: 0 });

    expect(res1.status).toBe(200);

    // Attempt accept offer 2 for same slot
    const res2 = await supertest(app)
      .post(`/api/offers/${offer2}/accept`)
      .set('x-test-uid', 'user-p2')
      .set('x-test-role', 'patient')
      .send({ optionIndex: 0 });

    expect(res2.status).toBe(409);
    expect(res2.body.message).toContain('already accepted');
  });

  it('Expired waitlist offer moves to next candidate within one job run', async () => {
    // Register candidate 1 & 2 on waitlist
    const c1 = await joinWaitlist({
      healthId: 'HID-CAND-1',
      patientName: 'Cand One',
      userId: 'user-cand-1',
      departmentId: 'dept-ortho',
      dateFrom: '2026-10-28',
      dateTo: '2026-10-30',
      clinicalLevel: 1
    });

    const c2 = await joinWaitlist({
      healthId: 'HID-CAND-2',
      patientName: 'Cand Two',
      userId: 'user-cand-2',
      departmentId: 'dept-ortho',
      dateFrom: '2026-10-28',
      dateTo: '2026-10-30',
      clinicalLevel: 2
    });

    // Create expired offer for Candidate 1
    const expiredOfferId = 'offer-expired-waitlist';
    await db.collection('offers').doc(expiredOfferId).set({
      id: expiredOfferId,
      kind: 'waitlist',
      waitlistId: c1.id,
      patientHealthId: 'HID-CAND-1',
      userId: 'user-cand-1',
      slotDetails: {
        slotId: 'slot-waitlist-target',
        doctorId: 'doc-f16-101',
        doctorName: 'Dr. Leave Doctor',
        date: '2026-10-29',
        timeSlot: '15:00'
      },
      expiresAt: new Date(Date.now() - 1000).toISOString(), // Past expiry
      status: 'open'
    });

    await db.collection('slots').doc('slot-waitlist-target').set({
      id: 'slot-waitlist-target',
      doctorId: 'doc-f16-101',
      date: '2026-10-29',
      timeSlot: '15:00',
      departmentId: 'dept-ortho',
      available: true
    });

    // Run expireWaitlistOffersJob
    const sweepRes = await expireWaitlistOffersJob();
    expect(sweepRes.success).toBe(true);
    expect(sweepRes.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify old offer is marked expired
    const oldOfferDoc = await db.collection('offers').doc(expiredOfferId).get();
    expect(oldOfferDoc.data().status).toBe('expired');

    // Verify new offer was generated for Candidate 2 (higher clinical level)
    const newOfferSnap = await db.collection('offers')
      .where('patientHealthId', '==', 'HID-CAND-2')
      .get();

    expect(newOfferSnap.empty).toBe(false);
  });

  it('Auto-book at deadline happens once', async () => {
    const autoOfferId = 'offer-autobook-deadline';
    await db.collection('offers').doc(autoOfferId).set({
      id: autoOfferId,
      kind: 'leave_reschedule',
      appointmentId: 'appt-f16-affected',
      patientHealthId: 'HID-F16-P1',
      userId: 'user-patient-f16',
      doctorName: 'Dr. Leave Doctor',
      options: [
        {
          type: 'same_doctor_next',
          doctorId: 'doc-f16-101',
          doctorName: 'Dr. Leave Doctor',
          date: '2026-10-22',
          timeSlot: '11:00',
          slotId: 'slot-f16-new'
        }
      ],
      autoBookDeadline: new Date(Date.now() - 1000).toISOString(), // Past deadline
      autoBooked: false,
      status: 'open'
    });

    // Run leaveRescheduleJob
    const jobRes = await leaveRescheduleJob();
    expect(jobRes.success).toBe(true);
    expect(jobRes.autoBookedCount).toBeGreaterThanOrEqual(1);

    // Verify offer status updated
    const offerDoc = await db.collection('offers').doc(autoOfferId).get();
    expect(offerDoc.data().status).toBe('accepted');
    expect(offerDoc.data().autoBooked).toBe(true);

    // Second run must NOT auto-book again
    const jobRes2 = await leaveRescheduleJob();
    expect(jobRes2.autoBookedCount).toBe(0);
  });
});

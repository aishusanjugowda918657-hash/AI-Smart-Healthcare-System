import { describe, it, expect, vi, beforeAll } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import dayjs from 'dayjs';

vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'user-tara-workflow-test',
      email: 'tara.patient@smartcare.local',
      role: 'patient'
    };
    next();
  }
}));

describe('TARA Conversational Appointment Booking — End-to-End Workflow', () => {
  const db = assertDbConnected();
  const testUid = 'user-tara-workflow-test';
  const testHealthId = 'HID-TARA-WORKFLOW-001';
  const testDoctorId = 'doc-tara-workflow-1';
  const testDoctorName = 'Dr. Tara Specialist';
  const targetDate = dayjs().add(2, 'day').format('YYYY-MM-DD'); // Safe future date

  beforeAll(async () => {
    // 0. Clean up any existing appointments and locks for this test patient
    const existing = await db.collection('appointments').where('patientHealthId', '==', testHealthId).get();
    for (const doc of existing.docs) {
      await doc.ref.delete();
    }
    const cleanHealthId = String(testHealthId).replace(/[\/\s]/g, '_');
    const cleanDoctorId = String(testDoctorId).replace(/[\/\s]/g, '_');
    const cleanDate = String(targetDate).replace(/[\/\s]/g, '_');
    await db.collection('locks').doc(`dup_${cleanHealthId}_${cleanDoctorId}_${cleanDate}`).delete();
    await db.collection('locks').doc(`lock_dept_${cleanHealthId}_dept-gen_${cleanDate}`).delete();
    await db.collection('locks').doc(`lock_date_${cleanHealthId}_${cleanDate}`).delete();

    // 1. Seed test patient profile
    await db.collection('patients').doc(testUid).set({
      patientHealthId: testHealthId,
      fullName: 'Tara Test Patient',
      name: 'Tara Test Patient',
      phone: '9876543210',
      age: 32,
      gender: 'female'
    }, { merge: true });

    // 2. Seed test doctor
    await db.collection('doctors').doc(testDoctorId).set({
      doctorId: testDoctorId,
      doctorUid: testDoctorId,
      fullName: testDoctorName,
      name: testDoctorName,
      specialization: 'General Medicine',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      active: true
    }, { merge: true });

    await db.collection('users').doc(testDoctorId).set({
      doctorId: testDoctorId,
      role: 'doctor',
      fullName: testDoctorName,
      email: 'doctor.tara@smartcare.local'
    }, { merge: true });

    // 3. Seed free future slots for this doctor
    const testSlot1Id = `slot_tara_wf_1_${targetDate}`;
    const testSlot2Id = `slot_tara_wf_2_${targetDate}`;

    await db.collection('slots').doc(testSlot1Id).set({
      id: testSlot1Id,
      doctorId: testDoctorId,
      date: targetDate,
      startAt: '10:00',
      endAt: '10:15',
      status: 'free'
    });

    await db.collection('slots').doc(testSlot2Id).set({
      id: testSlot2Id,
      doctorId: testDoctorId,
      date: targetDate,
      startAt: '10:30',
      endAt: '10:45',
      status: 'free'
    });
  });

  it('Turn 1: Patient starts booking -> TARA prompts for symptoms with symptom chips', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: 'Book an appointment for me.',
        language: 'en'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bookingState).toBeDefined();
    expect(res.body.bookingState.step).toBe('AWAITING_REASON');
    expect(res.body.bookingState.patientHealthId).toBe(testHealthId);
    expect(res.body.quickChips).toBeDefined();
    expect(res.body.quickChips.length).toBeGreaterThanOrEqual(3);
  });

  it('Turn 2: Patient provides symptoms -> TARA performs clinical triage and lists available doctors', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: 'Fever and mild headache for 2 days',
        language: 'en',
        bookingState: {
          step: 'AWAITING_REASON',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bookingState).toBeDefined();
    expect(res.body.bookingState.step).toBe('SELECT_DOCTOR');
    expect(res.body.bookingState.reasonText).toBe('Fever and mild headache for 2 days');
    expect(res.body.quickChips).toBeDefined();
    expect(res.body.quickChips.length).toBeGreaterThanOrEqual(1);
  });

  it('Turn 3: Patient selects doctor -> TARA retrieves real available slots', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: testDoctorName,
        language: 'en',
        bookingState: {
          step: 'SELECT_DOCTOR',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient',
          reasonText: 'Fever and mild headache',
          departmentId: 'dept-gen',
          doctors: [{
            doctorId: testDoctorId,
            name: testDoctorName,
            departmentId: 'dept-gen'
          }]
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.bookingState).toBeDefined();
    expect(res.body.bookingState.step).toBe('SELECT_SLOT');
    expect(res.body.bookingState.doctorId).toBe(testDoctorId);
    expect(res.body.quickChips).toBeDefined();
    expect(res.body.quickChips.length).toBeGreaterThanOrEqual(1);
  });

  it('Turn 4: Patient selects slot -> TARA issues confirmToken, displays summary, and explains disclaimer', async () => {
    const testSlot1Id = `slot_tara_wf_1_${targetDate}`;
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: '10:00',
        language: 'en',
        bookingState: {
          step: 'SELECT_SLOT',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient',
          reasonText: 'Fever and mild headache',
          departmentId: 'dept-gen',
          doctorId: testDoctorId,
          doctorName: testDoctorName,
          slots: [{
            slotId: testSlot1Id,
            date: targetDate,
            time: '10:00',
            endTime: '10:15'
          }]
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.confirmToken).toBeDefined();
    expect(res.body.actionRequired).toBe('CONFIRM_BOOKING');
    expect(res.body.message).toContain('Appointment Summary');
    expect(res.body.message).toContain('Important Disclaimer');
    expect(res.body.bookingState.step).toBe('AWAITING_CONFIRMATION');
    expect(res.body.bookingState.confirmToken).toBe(res.body.confirmToken);
  });

  it('Turn 5: Confirmation fails if disclaimer is NOT acknowledged', async () => {
    const testSlot1Id = `slot_tara_wf_1_${targetDate}`;
    const preRes = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: '10:00',
        language: 'en',
        bookingState: {
          step: 'SELECT_SLOT',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient',
          reasonText: 'Fever and mild headache',
          departmentId: 'dept-gen',
          doctorId: testDoctorId,
          doctorName: testDoctorName,
          slots: [{ slotId: testSlot1Id, date: targetDate, time: '10:00' }]
        }
      });

    const token = preRes.body.confirmToken;

    const confirmRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('x-test-uid', testUid)
      .send({
        confirmToken: token,
        disclaimerAccepted: false
      });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.message).toContain('disclaimer');
  });

  it('Turn 6: Successful explicit confirmation atomically creates appointment and generates token', async () => {
    const testSlot1Id = `slot_tara_wf_1_${targetDate}`;
    const preRes = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: '10:00',
        language: 'en',
        bookingState: {
          step: 'SELECT_SLOT',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient',
          reasonText: 'Fever and mild headache',
          departmentId: 'dept-gen',
          doctorId: testDoctorId,
          doctorName: testDoctorName,
          slots: [{ slotId: testSlot1Id, date: targetDate, time: '10:00' }]
        }
      });

    const token = preRes.body.confirmToken;

    const confirmRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('x-test-uid', testUid)
      .send({
        confirmToken: token,
        disclaimerAccepted: true,
        disclaimerAck: { acknowledged: true, at: new Date().toISOString() },
        language: 'en'
      });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.appointment).toBeDefined();
    expect(confirmRes.body.appointment.tokenLabel).toBeDefined();
    expect(confirmRes.body.appointment.displayId).toMatch(/^APT-/);

    // Verify slot was marked as booked
    const slotSnap = await db.collection('slots').doc(testSlot1Id).get();
    expect(slotSnap.data().status).toBe('booked');

    // Verify appointment was persisted in Firestore
    const apptSnap = await db.collection('appointments').doc(confirmRes.body.appointment.id).get();
    expect(apptSnap.exists).toBe(true);
    expect(apptSnap.data().patientHealthId).toBe(testHealthId);
  });

  it('Turn 7: Duplicate confirmation with consumed token is rejected with 400', async () => {
    const fakeToken = 'confirm_already_used_or_expired';
    const res = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('x-test-uid', testUid)
      .send({
        confirmToken: fakeToken,
        disclaimerAccepted: true
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('Clinical Safety: Emergency red flag halts booking and gives emergency response', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: 'I have severe chest pain and breathlessness',
        language: 'en',
        bookingState: {
          step: 'AWAITING_REASON',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.isEmergency).toBe(true);
    expect(res.body.message).toContain('108');
    expect(res.body.bookingState).toBeNull();
  });

  it('Cancellation: Patient says "cancel" -> booking state is cleared', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: 'cancel',
        language: 'en',
        bookingState: {
          step: 'SELECT_DOCTOR',
          patientHealthId: testHealthId,
          patientName: 'Tara Test Patient'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.bookingState).toBeNull();
    expect(res.body.message).toContain('cancelled');
  });

  it('Multilingual: Complete flow works in Kannada', async () => {
    const res = await supertest(app)
      .post('/api/ai/chat')
      .set('x-test-uid', testUid)
      .send({
        message: 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ನೀನೇ ಬುಕ್ ಮಾಡು.',
        language: 'kn'
      });

    expect(res.status).toBe(200);
    expect(res.body.language).toBe('kn');
    expect(res.body.message).toContain('ಖಂಡಿತಾ');
    expect(res.body.bookingState.step).toBe('AWAITING_REASON');
  });
});

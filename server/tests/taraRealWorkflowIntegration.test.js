/**
 * taraRealWorkflowIntegration.test.js
 *
 * Vitest Real Workflow Integration Test Suite for TARA Action-Performing AI Agent.
 * Executes live tests against the Firebase Local Emulator (Firestore: 8080, Auth: 9099).
 * Verifies live database mutations before and after every write.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected, isEmulator, getActiveProjectId } from '../src/config/firebase.js';
import {
  executePatientChatTool,
  storeConfirmToken,
  getConfirmTokenData,
  consumeConfirmToken
} from '../src/ai/tools.js';
import { cleanSpeechText } from '../../client/src/hooks/useSpeech.js';
import { checkEmergencyKeywords, getEmergencyResponse } from '../src/ai/guards.js';

describe('TARA Phase 2: Real Workflow Integration Tests (Firebase Emulator)', () => {
  let db;
  const patient1Uid = 'tara-vitest-patient-001';
  const patient1HealthId = 'SCAI-TARA-VP001';
  const childUid = 'tara-vitest-child-002';
  const childHealthId = 'SCAI-TARA-VC002';
  const attackerUid = 'tara-vitest-attacker-003';
  const attackerHealthId = 'SCAI-TARA-VA003';

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const testSlotId = `DOC-001_${tomorrowStr}_1130`;

  let bookedAppointmentId = null;

  beforeAll(async () => {
    db = assertDbConnected();
    expect(isEmulator).toBe(true);
    expect(getActiveProjectId()).toBe('demo-project');

    // Seed Primary Patient (Aarav Sharma)
    await db.collection('users').doc(patient1Uid).set({
      role: 'patient',
      fullName: 'Aarav Sharma',
      displayName: 'Aarav Sharma',
      patientHealthId: patient1HealthId,
      email: 'aarav.sharma@test-health.org',
      status: 'ACTIVE',
      createdAt: new Date()
    });

    await db.collection('patients').doc(patient1Uid).set({
      patientUid: patient1Uid,
      ownerUid: patient1Uid,
      relation: 'self',
      patientHealthId: patient1HealthId,
      fullName: 'Aarav Sharma',
      email: 'aarav.sharma@test-health.org',
      phone: '9876540001',
      gender: 'male',
      dob: '1988-04-12',
      profileCompleted: true
    });

    // Seed Dependent (Child: Meera Sharma)
    await db.collection('patients').doc(childUid).set({
      patientUid: childUid,
      ownerUid: patient1Uid,
      primaryAccountUid: patient1Uid,
      relation: 'child',
      patientHealthId: childHealthId,
      fullName: 'Meera Sharma',
      phone: '9876540001',
      gender: 'female',
      dob: '2018-09-20',
      profileCompleted: true
    });

    // Seed Attacker (Ravi Malgudi)
    await db.collection('users').doc(attackerUid).set({
      role: 'patient',
      fullName: 'Ravi Malgudi',
      patientHealthId: attackerHealthId,
      email: 'ravi.malgudi@test-attacker.org',
      status: 'ACTIVE'
    });

    await db.collection('patients').doc(attackerUid).set({
      patientUid: attackerUid,
      ownerUid: attackerUid,
      relation: 'self',
      patientHealthId: attackerHealthId,
      fullName: 'Ravi Malgudi',
      profileCompleted: true
    });

    // Ensure Doctor DOC-001 exists
    await db.collection('doctors').doc('DOC-001').set({
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      fullName: 'Dr. Sarah Smith',
      name: 'Dr. Sarah Smith',
      departmentId: 'dept-card',
      departmentName: 'Cardiology',
      specialization: 'Cardiologist',
      active: true
    }, { merge: true });

    await db.collection('users').doc('DOC-001').set({
      role: 'doctor',
      doctorId: 'DOC-001',
      fullName: 'Dr. Sarah Smith',
      status: 'ACTIVE'
    }, { merge: true });

    // Seed bookable test slot
    await db.collection('slots').doc(testSlotId).set({
      id: testSlotId,
      doctorId: 'DOC-001',
      doctorDocId: 'DOC-001',
      doctorName: 'Dr. Sarah Smith',
      departmentId: 'dept-card',
      date: tomorrowStr,
      startAt: '11:30',
      endAt: '11:45',
      status: 'free',
      isAvailable: true,
      heldUntil: null,
      heldBy: null,
      appointmentId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  it('1. Patient Authentication & Access Control: Rejects unauthenticated and accepts authenticated patients', async () => {
    const resNoAuth = await supertest(app).post('/api/ai/chat').send({ message: 'Hello' });
    expect(resNoAuth.status).toBe(401);
    expect(resNoAuth.body.success).toBe(false);

    const resWithAuth = await supertest(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ message: 'What is hospital timing?', language: 'en' });
    expect(resWithAuth.status).toBe(200);
    expect(resWithAuth.body.success).toBe(true);
  });

  it('2. Family Member Lookup: Retrieves registered dependents under patient ownership', async () => {
    const familyResult = await executePatientChatTool(
      'get_family_members',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(familyResult.count).toBeGreaterThanOrEqual(1);
    const hasChild = familyResult.familyMembers.some(m => m.relation === 'child' && m.patientHealthId === childHealthId);
    expect(hasChild).toBe(true);
  });

  it('3. Doctor Suggestions: Routes correctly based on symptoms and returns real doctors', async () => {
    const cardioResult = await executePatientChatTool(
      'suggest_doctors',
      { reason: 'severe chest pressure and heart palpitation' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(cardioResult.recommendedDepartment).toBe('dept-card');
    expect(cardioResult.doctors.some(d => d.doctorId === 'DOC-001')).toBe(true);
  });

  it('4. Available Slots Query: Retrieves real bookable slots from emulator database', async () => {
    const slotsResult = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-001', date: tomorrowStr },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(slotsResult.count).toBeGreaterThan(0);
    expect(slotsResult.availableSlots.length).toBeGreaterThan(0);
  });

  it('5. Two-Step Booking Flow: Validates DB mutation before and after confirmation', async () => {
    // Before booking: slot is free
    const slotBefore = await db.collection('slots').doc(testSlotId).get();
    expect(slotBefore.data()?.status).toBe('free');

    // Step 1: Prepare booking
    const prepareResult = await executePatientChatTool(
      'prepare_booking',
      {
        forWhom: 'self',
        doctorId: 'DOC-001',
        doctorName: 'Dr. Sarah Smith',
        date: tomorrowStr,
        slotId: testSlotId,
        timeSlot: '11:30 AM',
        reasonText: 'Cardiology follow-up check'
      },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(prepareResult.confirmToken).toBeDefined();

    // Step 2: Confirm booking
    const confirmRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({
        confirmToken: prepareResult.confirmToken,
        disclaimerAccepted: true,
        language: 'en'
      });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    bookedAppointmentId = confirmRes.body.appointment?.id || confirmRes.body.data?.id;
    expect(bookedAppointmentId).toBeDefined();

    // After booking: slot status is booked
    const slotAfter = await db.collection('slots').doc(testSlotId).get();
    expect(slotAfter.data()?.status).toBe('booked');
    expect(slotAfter.data()?.appointmentId).toBe(bookedAppointmentId);

    // Appointment document stored in Firestore
    const apptDoc = await db.collection('appointments').doc(bookedAppointmentId).get();
    expect(apptDoc.exists).toBe(true);
    expect(apptDoc.data()?.patientHealthId).toBe(patient1HealthId);
  });

  it('6. Double-Booking Prevention: Rejects subsequent booking attempts on the same slot', async () => {
    const secondPrepare = await executePatientChatTool(
      'prepare_booking',
      {
        forWhom: 'self',
        doctorId: 'DOC-001',
        doctorName: 'Dr. Sarah Smith',
        date: tomorrowStr,
        slotId: testSlotId,
        timeSlot: '11:30 AM',
        reasonText: 'Duplicate booking'
      },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    if (secondPrepare.confirmToken) {
      const confirmRes = await supertest(app)
        .post('/api/ai/chat/confirm')
        .set('Authorization', `Bearer test-${patient1Uid}`)
        .set('x-demo-uid', patient1Uid)
        .send({ confirmToken: secondPrepare.confirmToken, disclaimerAccepted: true });
      expect([400, 409]).toContain(confirmRes.status);
      expect(confirmRes.body.success).toBe(false);
    } else {
      expect(secondPrepare.error).toBeDefined();
    }
  });

  it('7. Appointment Cancellation: Sets status to cancelled and preserves PRD Rule A3 undo window', async () => {
    const prepareCancelResult = await executePatientChatTool(
      'prepare_cancel',
      { appointmentId: bookedAppointmentId, reason: 'Patient requested cancellation' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(prepareCancelResult.confirmToken).toBeDefined();

    const cancelRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({
        confirmToken: prepareCancelResult.confirmToken,
        disclaimerAccepted: true,
        language: 'en'
      });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.success).toBe(true);

    const apptAfter = await db.collection('appointments').doc(bookedAppointmentId).get();
    expect(['cancelled', 'CANCELLED']).toContain(apptAfter.data()?.status);
    expect(apptAfter.data()?.cancel?.undoUntil).toBeDefined();
  });

  it('8. Cross-Patient Access Denial: Blocks token theft and unauthorized dependent bookings', async () => {
    const p1Token = storeConfirmToken({
      type: 'BOOKING',
      userId: patient1Uid,
      patientHealthId: patient1HealthId,
      doctorId: 'DOC-001',
      slotId: 'DOC-001_some_slot'
    });

    const crossConfirmRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${attackerUid}`)
      .set('x-demo-uid', attackerUid)
      .send({ confirmToken: p1Token, disclaimerAccepted: true });
    expect(crossConfirmRes.status).toBe(403);

    const unauthorizedFamilyBooking = await executePatientChatTool(
      'prepare_booking',
      {
        forWhom: 'family_member',
        memberId: childHealthId,
        doctorId: 'DOC-001',
        slotId: testSlotId,
        date: tomorrowStr
      },
      { userId: attackerUid, selectedPatientHealthId: attackerHealthId }
    );
    expect(unauthorizedFamilyBooking.confirmToken).toBeUndefined();
  });

  it('9. Token Security Edge Cases: Rejects invalid, expired, reused, and unacknowledged tokens', async () => {
    // Invalid
    const resInvalid = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: 'bogus-token-xyz', disclaimerAccepted: true });
    expect(resInvalid.status).toBe(400);

    // Expired
    const expiredToken = storeConfirmToken({ type: 'CANCEL', userId: patient1Uid, appointmentId: 'dummy-1' });
    const rawData = getConfirmTokenData(expiredToken);
    if (rawData) rawData.expiresAt = Date.now() - 1000;
    const resExpired = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: expiredToken, disclaimerAccepted: true });
    expect(resExpired.status).toBe(400);

    // Reused
    const singleUseToken = storeConfirmToken({ type: 'CANCEL', userId: patient1Uid, appointmentId: 'dummy-2' });
    consumeConfirmToken(singleUseToken);
    const resReused = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: singleUseToken, disclaimerAccepted: true });
    expect(resReused.status).toBe(400);

    // Missing disclaimer
    const validToken = storeConfirmToken({ type: 'BOOKING', userId: patient1Uid, slotId: testSlotId });
    const resNoDisclaimer = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: validToken, disclaimerAccepted: false });
    expect(resNoDisclaimer.status).toBe(400);
  });

  it('10. Queue Token & Waiting Time: Retrieves active token and wait-time estimate', async () => {
    const todayApptId = 'appt-today-vitest-001';
    await db.collection('appointments').doc(todayApptId).set({
      id: todayApptId,
      patientId: patient1Uid,
      patientHealthId: patient1HealthId,
      patientName: 'Aarav Sharma',
      doctorId: 'DOC-001',
      doctorName: 'Dr. Sarah Smith',
      departmentId: 'dept-card',
      date: todayStr,
      timeSlot: '09:00',
      status: 'SCHEDULED',
      tokenNumber: 5,
      tokenLabel: 'CARD-05',
      queueStatus: 'WAITING',
      createdAt: new Date()
    });

    const tokenResult = await executePatientChatTool(
      'get_my_token',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(tokenResult.tokenLabel).toBe('CARD-05');
    expect(tokenResult.doctorName).toBe('Dr. Sarah Smith');
  });

  it('11. Prescription & Reminder Retrieval: Reads live clinical documents from Firestore', async () => {
    const rxId = 'rx-vitest-001';
    await db.collection('prescriptions').doc(rxId).set({
      id: rxId,
      patientId: patient1Uid,
      patientHealthId: patient1HealthId,
      patientName: 'Aarav Sharma',
      doctorId: 'DOC-001',
      doctorName: 'Dr. Sarah Smith',
      date: todayStr,
      diagnosis: 'Hypertension check',
      medicines: [
        { medicineName: 'Amlodipine', dosage: '5mg', frequency: 'Daily morning', durationDays: 30 }
      ],
      createdAt: new Date()
    });

    const remId = 'rem-vitest-001';
    await db.collection('reminders').doc(remId).set({
      id: remId,
      userId: patient1Uid,
      patientId: patient1Uid,
      patientHealthId: patient1HealthId,
      medicineName: 'Amlodipine 5mg',
      dose: '5mg',
      timeSlot: '08:00 AM',
      date: todayStr,
      status: 'PENDING',
      isActive: true,
      createdAt: new Date()
    });

    const rxResult = await executePatientChatTool(
      'get_latest_prescription',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(rxResult.prescriptionId).toBe(rxId);
    expect(rxResult.medicines.length).toBeGreaterThan(0);

    const remResult = await executePatientChatTool(
      'get_medicine_schedule',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(remResult.schedule.length).toBeGreaterThan(0);
  });

  it('12. Anti-Hallucination Guardrails: Prevents inventing unavailable information', async () => {
    const nonExistentSlots = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-IMAGINARY-999', date: tomorrowStr },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(nonExistentSlots.count).toBe(0);

    const pastSlots = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-001', date: '2020-01-01' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );
    expect(pastSlots.availableSlots.length).toBe(0);
    expect(pastSlots.message).toContain('past dates');

    const attackerRx = await executePatientChatTool(
      'get_latest_prescription',
      {},
      { userId: attackerUid, selectedPatientHealthId: attackerHealthId }
    );
    expect(attackerRx.hasPrescription).toBe(false);
  });

  it('13. Emergency Guidance: Triggers instant emergency response in 5 Indic languages', () => {
    const emergencyQueries = [
      { text: 'I have severe chest pain and cannot breathe', lang: 'en' },
      { text: 'ನನಗೆ ಎದೆ ನೋವು ಮತ್ತು ಉಸಿರಾಟದ ತೊಂದರೆ ಇದೆ', lang: 'kn' },
      { text: 'सीने में बहुत तेज दर्द हो रहा है', lang: 'hi' },
      { text: 'తీవ్రమైన గుండె నొప్పి వస్తోంది', lang: 'te' },
      { text: 'எனக்கு கடுமையான நெஞ்சு வலி உள்ளது', lang: 'ta' }
    ];

    for (const q of emergencyQueries) {
      expect(checkEmergencyKeywords(q.text)).toBe(true);
      const resp = getEmergencyResponse(q.lang);
      expect(resp.isEmergency).toBe(true);
      expect(resp.message).toContain('108');
    }
  });

  it('14. Multilingual Speech Cleaning & Quick Replies: Strips markdown and renders Indic text', async () => {
    const rawAiText = '**Dr. Sarah Smith** is available tomorrow.\n\n* Timings: 9:00 AM\n\nDisclaimer: This is AI generated content.';
    const cleanedSpeech = cleanSpeechText(rawAiText);
    expect(cleanedSpeech).not.toContain('**');
    expect(cleanedSpeech).not.toContain('*');
    expect(cleanedSpeech).not.toContain('Disclaimer:');

    const knRes = await supertest(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ message: 'Token Status', language: 'kn' });
    expect(knRes.status).toBe(200);
    expect(/[\u0C80-\u0CFF]/.test(knRes.body.message)).toBe(true);
  });

  it('15. Production Data Quarantine: Guarantees zero connection to production Firestore', () => {
    expect(isEmulator).toBe(true);
    expect(getActiveProjectId()).toBe('demo-project');
  });
});

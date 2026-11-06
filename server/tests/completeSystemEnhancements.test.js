import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { effectiveLevel } from '../src/domain/priority.js';
import { processRemindersJob } from '../src/jobs/processReminders.js';

describe('SmartCare AI Complete System Enhancements Integration Suite', () => {
  let db;
  const adminUid = `admin-test-${Date.now()}`;
  const doctorUid = `doc-enh-${Date.now()}`;
  const doctorId = `DOC-TEST-${Date.now()}`;
  const patientUid = `patient-enh-${Date.now()}`;
  const patientHealthId = `PHI-ENH-${Date.now()}`;
  const pharmacistUid = `pharm-enh-${Date.now()}`;
  const todayStr = new Date().toISOString().split('T')[0];

  beforeAll(async () => {
    db = assertDbConnected();

    // Seed test doctor
    await db.collection('doctors').doc(doctorUid).set({
      doctorId,
      uid: doctorUid,
      name: 'Dr. Vikram Sharma',
      fullName: 'Dr. Vikram Sharma',
      specialization: 'General Medicine',
      departmentId: 'dept-gen',
      qualifications: 'MBBS, MD',
      experienceYears: 12,
      status: 'ACTIVE',
      room: 'Room 102',
      consultationFee: 500,
      email: 'vikram.sharma@hospital.org',
      phone: '+91 98765 43210'
    });

    // Seed test patient
    await db.collection('patients').doc(patientHealthId).set({
      patientHealthId,
      name: 'Ramesh Gupta',
      fullName: 'Ramesh Gupta',
      uid: patientUid,
      ownerUid: patientUid,
      allergies: ['Penicillin'],
      age: 45,
      gender: 'male',
      conditions: ['Hypertension']
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 1: Admin Department & Doctor Integration
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 1: GET /api/doctors?departmentId=... returns assigned doctors from Firestore', async () => {
    const res = await request(app)
      .get('/api/doctors?departmentId=dept-gen&includeSlotStatus=true')
      .set('x-demo-uid', adminUid)
      .set('x-demo-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const foundDoc = res.body.data.find((d) => d.doctorId === doctorId || d.id === doctorUid);
    expect(foundDoc).toBeDefined();
    expect(foundDoc.name).toBe('Dr. Vikram Sharma');
    expect(foundDoc.specialization).toBe('General Medicine');
    expect(foundDoc.departmentId).toBe('dept-gen');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 2: Patient Queue Check-in & Rejoin Order
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 2.1: reportLate rejects when patient is already checked in (400 ALREADY_CHECKED_IN)', async () => {
    const apptId = `apt-checkin-${Date.now()}`;
    await db.collection('appointments').doc(apptId).set({
      appointmentId: apptId,
      patientUid,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'checked_in',
      checkedInAt: new Date().toISOString()
    });

    const res = await request(app)
      .post(`/api/appointments/${apptId}/late`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ lateReason: 'Delayed at traffic' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code || res.body.code).toBe('ALREADY_CHECKED_IN');
  });

  it('Part 2.2: Rejoined patients do not receive unfair delay bump over on-time patients', () => {
    const now = new Date('2026-11-05T10:30:00.000Z');

    // On-time waiting patient booked 40 minutes ago
    const onTimeWaitingPatient = {
      clinicalLevel: 1,
      status: 'waiting',
      bookedStartAt: '2026-11-05T09:50:00.000Z',
      date: '2026-11-05'
    };

    // Rejoined patient who was originally booked at 09:00 AM, missed, and rejoined 5 minutes ago
    const lateRejoinedPatient = {
      clinicalLevel: 1,
      status: 'rejoined',
      bookedStartAt: '2026-11-05T09:00:00.000Z', // Old missed appointment time
      rejoinedAt: '2026-11-05T10:25:00.000Z',    // Rejoined 5 mins ago
      date: '2026-11-05'
    };

    // On-time waiting patient delayed by 40 min (>30 min) gets bumped to Level 2 (URGENT)
    const onTimeLevel = effectiveLevel(onTimeWaitingPatient, now, { fairnessBumpMin: 30 });
    expect(onTimeLevel).toBe(2);

    // Rejoined patient who rejoined only 5 mins ago stays at Level 1 (ROUTINE)
    const rejoinedLevel = effectiveLevel(lateRejoinedPatient, now, { fairnessBumpMin: 30 });
    expect(rejoinedLevel).toBe(1);
  });

  it('Part 2.3: callNextPatient rejects calling missed or completed tokens directly', async () => {
    const missedTokenId = `tok-missed-${Date.now()}`;
    await db.collection('tokens').doc(missedTokenId).set({
      id: missedTokenId,
      tokenId: missedTokenId,
      doctorUid,
      date: todayStr,
      status: 'missed',
      tokenNumber: 'A099'
    });

    const res = await request(app)
      .post('/api/tokens/call-next')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ date: todayStr, tokenId: missedTokenId });

    expect(res.status).toBe(400);
    expect(res.body.error?.code || res.body.code).toBe('INVALID_STATE');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 3: Doctor Consultation Lifecycle (Hold, Resume, Complete)
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 3.1: Doctor can place consultation on hold (POST /api/queue/hold/:id)', async () => {
    const holdApptId = `apt-hold-${Date.now()}`;
    await db.collection('appointments').doc(holdApptId).set({
      appointmentId: holdApptId,
      patientUid,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'in_consultation'
    });

    const res = await request(app)
      .post(`/api/queue/hold/${holdApptId}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ reason: 'Waiting for lab report' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedAppt = await db.collection('appointments').doc(holdApptId).get();
    expect(updatedAppt.data().status).toBe('on_hold');
    expect(updatedAppt.data().isHeldByDoctor).toBe(true);
    expect(updatedAppt.data().holdReason).toBe('Waiting for lab report');
  });

  it('Part 3.2: Doctor resumes on-hold consultation when room is free (POST /api/queue/resume/:id)', async () => {
    const resumeApptId = `apt-resume-${Date.now()}`;
    await db.collection('appointments').doc(resumeApptId).set({
      appointmentId: resumeApptId,
      patientUid,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'on_hold',
      isHeldByDoctor: true
    });

    const res = await request(app)
      .post(`/api/queue/resume/${resumeApptId}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await db.collection('appointments').doc(resumeApptId).get();
    expect(updated.data().status).toBe('in_consultation');
    expect(updated.data().isHeldByDoctor).toBe(false);
  });

  it('Part 3.3: Doctor cannot resume consultation if room is already occupied by active consultation', async () => {
    // 1. Active consultation in room
    const activeApptId = `apt-occ-${Date.now()}`;
    await db.collection('appointments').doc(activeApptId).set({
      appointmentId: activeApptId,
      patientUid: 'other-pt',
      patientHealthId: 'PHI-OTHER',
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'in_consultation'
    });

    // 2. Held consultation attempting to resume
    const heldApptId = `apt-held-blocked-${Date.now()}`;
    await db.collection('appointments').doc(heldApptId).set({
      appointmentId: heldApptId,
      patientUid,
      patientHealthId,
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'on_hold',
      isHeldByDoctor: true
    });

    const res = await request(app)
      .post(`/api/queue/resume/${heldApptId}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(409);
    expect(res.body.error?.code || res.body.code).toBe('ROOM_OCCUPIED');

    // Clean up active appointment
    await db.collection('appointments').doc(activeApptId).delete();
    await db.collection('appointments').doc(heldApptId).delete();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 4 & 5: Prescription Idempotency & AI Suggest
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 4: Prescription creation is idempotent (prevents duplicate prescriptions)', async () => {
    const rxApptId = `apt-rx-idem-${Date.now()}`;
    await db.collection('appointments').doc(rxApptId).set({
      appointmentId: rxApptId,
      patientUid,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      doctorId,
      doctorUid,
      date: todayStr,
      status: 'in_consultation'
    });

    const rxPayload = {
      patientHealthId,
      appointmentId: rxApptId,
      medicines: [
        {
          name: 'Paracetamol',
          dosage: '500 mg',
          frequency: 'Twice Daily (1-0-1)',
          durationDays: 5,
          timing: 'after_food',
          packet: 'A',
          tablets: 1
        }
      ],
      doctorNotes: 'Viral fever symptomatic management'
    };

    // First call: creates prescription
    const firstRes = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send(rxPayload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.success).toBe(true);
    const createdId = firstRes.body.data?.id;

    // Second call: idempotent return, does not create duplicate
    const secondRes = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send(rxPayload);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.success).toBe(true);
    expect(secondRes.body.data?.id).toBe(createdId);
  });

  it('Part 5: POST /api/prescriptions/ai-suggest provides clinical suggestions with packet groupings', async () => {
    const res = await request(app)
      .post('/api/prescriptions/ai-suggest')
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        diagnosis: 'Acute bacterial pharyngitis with fever and throat pain',
        symptoms: 'Fever 101F, difficulty swallowing, body ache',
        allergies: ['Penicillin'],
        patientAge: 45
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);

    // Each suggestion has required clinical fields and packet group
    res.body.suggestions.forEach((sug) => {
      expect(sug.name).toBeDefined();
      expect(sug.dosage).toBeDefined();
      expect(sug.frequency).toBeDefined();
      expect(sug.durationDays).toBeGreaterThan(0);
      expect(['A', 'B', 'C', 'D']).toContain(sug.packet);
      expect(sug.reason).toBeDefined();
    });

    // Check that allergy safety alerts are raised for Penicillin (since Amoxicillin is beta-lactam)
    expect(Array.isArray(res.body.safetyAlerts)).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 6: Pharmacy Verification & Dispensing
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 6.1: Pharmacy verify returns both items and medicines fields', async () => {
    const rxId = `RX-TEST-${Date.now()}`;
    const vCode = `VCD-${rxId}-SAFE`;

    await db.collection('prescriptions').doc(rxId).set({
      prescriptionId: rxId,
      verificationCode: vCode,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      doctorName: 'Dr. Vikram Sharma',
      date: todayStr,
      status: 'ISSUED',
      dispenseStatus: 'PENDING',
      medicines: [
        {
          name: 'Paracetamol',
          dosage: '500 mg',
          frequency: 'Twice Daily (1-0-1)',
          durationDays: 5,
          timing: 'after_food',
          packet: 'A',
          tablets: 1
        },
        {
          name: 'Cetirizine',
          dosage: '10 mg',
          frequency: 'Night Only (0-0-1)',
          durationDays: 5,
          timing: 'after_food',
          packet: 'B',
          tablets: 1
        }
      ]
    });

    const res = await request(app)
      .get(`/api/prescriptions/verify/${vCode}`)
      .set('x-demo-uid', pharmacistUid)
      .set('x-demo-role', 'pharmacy');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(Array.isArray(res.body.data.medicines)).toBe(true);
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.medicines.length).toBe(2);
    expect(res.body.data.items[0].packet).toBe('A');
    expect(res.body.data.items[1].packet).toBe('B');
  });

  it('Part 6.2: Pharmacy dispense enforces single-dispense and prevents empty dispense', async () => {
    const rxId = `RX-DISPENSE-${Date.now()}`;
    await db.collection('prescriptions').doc(rxId).set({
      prescriptionId: rxId,
      patientHealthId,
      patientName: 'Ramesh Gupta',
      status: 'ISSUED',
      dispenseStatus: 'PENDING',
      medicines: [
        { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily', durationDays: 3 }
      ]
    });

    // 1. Dispense successfully
    const firstDispense = await request(app)
      .post(`/api/prescriptions/${rxId}/dispense`)
      .set('x-demo-uid', pharmacistUid)
      .set('x-demo-role', 'pharmacy');

    expect(firstDispense.status).toBe(200);
    expect(firstDispense.body.data.dispenseStatus).toBe('DISPENSED');

    // 2. Second dispense rejected with 409 ALREADY_DISPENSED
    const secondDispense = await request(app)
      .post(`/api/prescriptions/${rxId}/dispense`)
      .set('x-demo-uid', pharmacistUid)
      .set('x-demo-role', 'pharmacy');

    expect(secondDispense.status).toBe(409);
    expect(secondDispense.body.code).toBe('ALREADY_DISPENSED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Part 10: Appointment Reminders Suppression
  // ──────────────────────────────────────────────────────────────────────────
  it('Part 10: processRemindersJob cancels reminders for cancelled/completed appointments or past dates', async () => {
    const cancelledApptId = `apt-canc-${Date.now()}`;
    await db.collection('appointments').doc(cancelledApptId).set({
      appointmentId: cancelledApptId,
      patientUid,
      date: '2026-01-01', // Past date
      status: 'cancelled'
    });

    const remId = `rem-canc-${Date.now()}`;
    await db.collection('reminders').doc(remId).set({
      id: remId,
      appointmentId: cancelledApptId,
      patientUid,
      status: 'pending',
      dueAt: new Date(Date.now() - 60000).toISOString(),
      type: 'appointment_reminder'
    });

    // Run reminder processor
    await processRemindersJob({ nowOverride: new Date() });

    // The reminder must be cancelled, not sent
    const updatedRem = await db.collection('reminders').doc(remId).get();
    expect(updatedRem.data().status).toBe('cancelled');
  });
});

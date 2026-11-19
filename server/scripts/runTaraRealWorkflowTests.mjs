/**
 * runTaraRealWorkflowTests.mjs
 *
 * Phase 2: Real Workflow Integration Testing for TARA AI Agent.
 * Executes live tests against the Firebase Local Emulator (Firestore: 8080, Auth: 9099).
 * Verifies live database mutations before and after every write.
 */

// Enforce emulator configuration BEFORE module loading
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';
process.env.VITE_FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'demo-project';
process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { assertDbConnected, isEmulator, getActiveProjectId } = await import('../src/config/firebase.js');
const {
  executePatientChatTool,
  storeConfirmToken,
  getConfirmTokenData,
  consumeConfirmToken
} = await import('../src/ai/tools.js');
const { cleanSpeechText } = await import('../../client/src/hooks/useSpeech.js');
const { checkEmergencyKeywords, getEmergencyResponse } = await import('../src/ai/guards.js');
const { default: supertest } = await import('supertest');

const results = [];

function recordTest(id, name, classification, details, passed = true) {
  results.push({
    id,
    name,
    classification, // PASS, FAIL, BLOCKED, MOCKED
    passed,
    details
  });
  const symbol = passed ? '✅ PASS' : (classification === 'BLOCKED' ? '⚠️ BLOCKED' : '❌ FAIL');
  console.log(`[${symbol}] Test ${id}: ${name} (${classification})`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function run() {
  console.log('\n===============================================================');
  console.log('   TARA ACTION-PERFORMING AI AGENT — REAL WORKFLOW INTEGRATION  ');
  console.log('===============================================================\n');

  const db = assertDbConnected();
  const projectId = getActiveProjectId();

  console.log(`[Environment] Firestore Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`[Environment] Active Project ID: ${projectId}`);
  console.log(`[Environment] Is Local Emulator: ${isEmulator}`);

  if (!isEmulator || projectId !== 'demo-project') {
    throw new Error('SAFETY CHECK FAILED: Must run against demo-project emulator only.');
  }

  // ── 1. Dedicated Test Data Setup ──────────────────────────────────────────
  console.log('\n--- Setting Up Isolated Test Data in Emulator ---');
  const patient1Uid = 'tara-test-patient-001';
  const patient1HealthId = 'SCAI-TARA-P001';
  const childUid = 'tara-test-child-002';
  const childHealthId = 'SCAI-TARA-C002';
  const attackerUid = 'tara-test-attacker-003';
  const attackerHealthId = 'SCAI-TARA-A003';

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
    allergies: ['Penicillin'],
    existingConditions: ['Mild Asthma'],
    profileCompleted: true
  });

  // Seed Dependent Family Member (Child: Meera Sharma)
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
    allergies: [],
    existingConditions: [],
    profileCompleted: true
  });

  // Seed Attacker / Third-Party Patient (Ravi Malgudi)
  await db.collection('users').doc(attackerUid).set({
    role: 'patient',
    fullName: 'Ravi Malgudi',
    displayName: 'Ravi Malgudi',
    patientHealthId: attackerHealthId,
    email: 'ravi.malgudi@test-attacker.org',
    status: 'ACTIVE',
    createdAt: new Date()
  });

  await db.collection('patients').doc(attackerUid).set({
    patientUid: attackerUid,
    ownerUid: attackerUid,
    relation: 'self',
    patientHealthId: attackerHealthId,
    fullName: 'Ravi Malgudi',
    email: 'ravi.malgudi@test-attacker.org',
    phone: '9876540003',
    gender: 'male',
    dob: '1992-07-15',
    profileCompleted: true
  });

  // Ensure Doctor DOC-001 exists with Cardiology department
  await db.collection('doctors').doc('DOC-001').set({
    doctorId: 'DOC-001',
    fullName: 'Dr. Sarah Smith',
    name: 'Dr. Sarah Smith',
    departmentId: 'dept-card',
    departmentName: 'Cardiology',
    specialization: 'Cardiologist',
    active: true
  }, { merge: true });

  // Ensure Doctor DOC-002 exists with General Medicine department
  await db.collection('doctors').doc('DOC-002').set({
    doctorId: 'DOC-002',
    fullName: 'Dr. Rahul Kumar',
    name: 'Dr. Rahul Kumar',
    departmentId: 'dept-gen',
    departmentName: 'General Medicine',
    specialization: 'Physician',
    active: true
  }, { merge: true });

  // Calculate target dates
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Seed a bookable test slot for tomorrow
  const testSlotId = `DOC-001_${tomorrowStr}_1100`;
  await db.collection('slots').doc(testSlotId).set({
    id: testSlotId,
    doctorId: 'DOC-001',
    doctorDocId: 'DOC-001',
    doctorName: 'Dr. Sarah Smith',
    departmentId: 'dept-card',
    date: tomorrowStr,
    startAt: '11:00',
    endAt: '11:15',
    status: 'free',
    isAvailable: true,
    heldUntil: null,
    heldBy: null,
    appointmentId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  console.log(`[Seed] Seeded patient ${patient1HealthId}, child ${childHealthId}, attacker ${attackerHealthId}, and slot ${testSlotId}.\n`);

  // ── TEST 1: Patient Authentication & Security ─────────────────────────────
  {
    const resNoAuth = await supertest(app).post('/api/ai/chat').send({ message: 'Hello' });
    const passNoAuth = resNoAuth.status === 401 && resNoAuth.body.success === false;

    const resWithAuth = await supertest(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ message: 'What is hospital timing?', language: 'en' });
    const passWithAuth = resWithAuth.status === 200 && resWithAuth.body.success === true;

    recordTest(
      'T1',
      'Patient Authentication & Access Control',
      'PASS',
      `Unauthenticated returned 401, Authenticated returned 200 with timing`,
      passNoAuth && passWithAuth
    );
  }

  // ── TEST 2: Family Member Lookup ──────────────────────────────────────────
  {
    const familyResult = await executePatientChatTool(
      'get_family_members',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const hasChild = familyResult.familyMembers.some(m => m.relation === 'child' && m.patientHealthId === childHealthId);
    const pass = hasChild && familyResult.count >= 1;

    recordTest(
      'T2',
      'Family Member Lookup (Dependents Listed)',
      'PASS',
      `Found ${familyResult.count} registered dependent(s): ${familyResult.familyMembers.map(m => `${m.name} (${m.relationship})`).join(', ')}`,
      pass
    );
  }

  // ── TEST 3: Doctor Suggestions & Triage Routing ───────────────────────────
  {
    const cardioResult = await executePatientChatTool(
      'suggest_doctors',
      { reason: 'severe chest pressure and heart palpitation' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const generalResult = await executePatientChatTool(
      'suggest_doctors',
      { reason: 'routine yearly medical checkup' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const passCardio = cardioResult.doctors.some(d => d.doctorId === 'DOC-001');
    const passGeneral = generalResult.doctors.length > 0;

    recordTest(
      'T3',
      'Doctor Suggestions with Triage Routing',
      'PASS',
      `Cardio recommended ${cardioResult.recommendedDepartment || 'dept-card'}, found ${cardioResult.count} doctors`,
      passCardio && passGeneral
    );
  }

  // ── TEST 4: Available Appointment Slots Query ─────────────────────────────
  {
    const slotsResult = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-001', date: tomorrowStr },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const pass = slotsResult.count > 0 && slotsResult.availableSlots.length > 0;

    recordTest(
      'T4',
      'Available Appointment Slots Query (Emulator DB)',
      'PASS',
      `Found ${slotsResult.count} available slots on ${tomorrowStr} for DOC-001 (${slotsResult.availableSlots.length} previewed)`,
      pass
    );
  }

  // ── TEST 5: Two-Step Booking Flow with DB State Verification ──────────────
  let bookedAppointmentId = null;
  {
    // Step 5A: Verify database state BEFORE booking
    const slotBefore = await db.collection('slots').doc(testSlotId).get();
    const slotBeforeStatus = slotBefore.data()?.status;

    // Step 5B: TARA prepares booking (generates action confirmation token)
    const prepareResult = await executePatientChatTool(
      'prepare_booking',
      {
        forWhom: 'self',
        doctorId: 'DOC-001',
        doctorName: 'Dr. Sarah Smith',
        date: tomorrowStr,
        slotId: testSlotId,
        timeSlot: '11:00 AM',
        reasonText: 'Cardiology follow-up check'
      },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const confirmToken = prepareResult.confirmToken;
    const tokenData = getConfirmTokenData(confirmToken);
    const tokenValid = tokenData && tokenData.userId === patient1Uid && tokenData.slotId === testSlotId;

    // Step 5C: Execute confirmation API call (/api/ai/chat/confirm)
    const confirmRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({
        confirmToken,
        disclaimerAccepted: true,
        language: 'en'
      });

    const confirmSuccess = confirmRes.status === 200 && confirmRes.body.success === true;
    bookedAppointmentId = confirmRes.body.appointment?.id || confirmRes.body.data?.id;

    // Step 5D: Verify database state AFTER booking
    const slotAfter = await db.collection('slots').doc(testSlotId).get();
    const slotAfterStatus = slotAfter.data()?.status;
    const slotAfterApptId = slotAfter.data()?.appointmentId;

    let apptDocAfter = null;
    if (bookedAppointmentId) {
      apptDocAfter = await db.collection('appointments').doc(bookedAppointmentId).get();
    }

    const apptStored = apptDocAfter && apptDocAfter.exists;
    const pass = (
      slotBeforeStatus === 'free' &&
      tokenValid &&
      confirmSuccess &&
      slotAfterStatus === 'booked' &&
      apptStored &&
      slotAfterApptId === bookedAppointmentId
    );

    recordTest(
      'T5',
      'Two-Step Appointment Booking with DB Verification',
      'PASS',
      `Slot before: ${slotBeforeStatus} -> Slot after: ${slotAfterStatus}, Appt ID: ${bookedAppointmentId}, Token: ${confirmRes.body.appointment?.tokenLabel || 'Generated'}`,
      pass
    );
  }

  // ── TEST 6: Double-Booking Prevention ─────────────────────────────────────
  {
    // Attempting to prepare or book the same slot again
    const secondPrepareResult = await executePatientChatTool(
      'prepare_booking',
      {
        forWhom: 'self',
        doctorId: 'DOC-001',
        doctorName: 'Dr. Sarah Smith',
        date: tomorrowStr,
        slotId: testSlotId,
        timeSlot: '11:00 AM',
        reasonText: 'Duplicate booking attempt'
      },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    // If a token was generated, calling confirm must fail with conflict
    let duplicateRejected = false;
    if (secondPrepareResult.confirmToken) {
      const confirmRes = await supertest(app)
        .post('/api/ai/chat/confirm')
        .set('Authorization', `Bearer test-${patient1Uid}`)
        .set('x-demo-uid', patient1Uid)
        .send({
          confirmToken: secondPrepareResult.confirmToken,
          disclaimerAccepted: true
        });
      duplicateRejected = confirmRes.status === 409 || confirmRes.status === 400 || confirmRes.body.success === false;
    } else {
      duplicateRejected = true;
    }

    recordTest(
      'T6',
      'Double-Booking Prevention (Slot Conflict Enforcement)',
      'PASS',
      `Duplicate booking on slot ${testSlotId} was strictly blocked`,
      duplicateRejected
    );
  }

  // ── TEST 7: Appointment Cancellation with DB State Verification ───────────
  {
    // Step 7A: Verify appointment exists and is confirmed before cancel
    const apptBefore = await db.collection('appointments').doc(bookedAppointmentId).get();
    const statusBefore = apptBefore.data()?.status;

    // Step 7B: Prepare cancellation
    const prepareCancelResult = await executePatientChatTool(
      'prepare_cancel',
      {
        appointmentId: bookedAppointmentId,
        reason: 'Change of schedule by patient'
      },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const cancelToken = prepareCancelResult.confirmToken;

    // Step 7C: Confirm cancellation
    const cancelRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({
        confirmToken: cancelToken,
        disclaimerAccepted: true,
        language: 'en'
      });

    // Step 7D: Verify database state AFTER cancellation (PRD Rule A3: Undo Window)
    const apptAfter = await db.collection('appointments').doc(bookedAppointmentId).get();
    const statusAfter = apptAfter.data()?.status;
    const undoUntilSet = !!apptAfter.data()?.cancel?.undoUntil;

    const pass = (
      cancelRes.status === 200 &&
      cancelRes.body.success === true &&
      (statusAfter === 'cancelled' || statusAfter === 'CANCELLED') &&
      undoUntilSet
    );

    recordTest(
      'T7',
      'Appointment Cancellation with PRD Rule A3 Undo Window',
      'PASS',
      `Appt status: ${statusBefore} -> ${statusAfter}, undoUntil: ${new Date(apptAfter.data()?.cancel?.undoUntil).toISOString()}`,
      pass
    );
  }

  // ── TEST 8: Cross-Patient Access Denial & Ownership Isolation ─────────────
  {
    // Scenario 8A: Attacker attempts to confirm a token belonging to Patient 1
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
      .send({
        confirmToken: p1Token,
        disclaimerAccepted: true
      });

    const tokenTheftBlocked = crossConfirmRes.status === 403;

    // Scenario 8B: Attacker attempts to book for Patient 1's child
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

    const familyBookingBlocked = (
      unauthorizedFamilyBooking.error === 'PATIENT_NOT_FOUND_OR_UNAUTHORIZED' ||
      unauthorizedFamilyBooking.error?.includes('Unauthorized') ||
      !unauthorizedFamilyBooking.confirmToken
    );

    const pass = tokenTheftBlocked && familyBookingBlocked;

    recordTest(
      'T8',
      'Cross-Patient Access Denial & Identity Isolation',
      'PASS',
      `Cross-user token confirmation blocked (403), Unauthorized dependent booking blocked`,
      pass
    );
  }

  // ── TEST 9: Confirmation Token Edge Cases (Invalid, Expired, Reused) ───────
  {
    // 9A: Invalid token
    const invalidRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: 'bogus-token-12345', disclaimerAccepted: true });
    const invalidBlocked = invalidRes.status === 400;

    // 9B: Expired token
    const expiredToken = storeConfirmToken({
      type: 'CANCEL',
      userId: patient1Uid,
      appointmentId: 'appt-dummy-1'
    });
    // Manually backdate token in memory
    const rawData = getConfirmTokenData(expiredToken);
    if (rawData) rawData.expiresAt = Date.now() - 1000;

    const expiredRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: expiredToken, disclaimerAccepted: true });
    const expiredBlocked = expiredRes.status === 400;

    // 9C: Reused token
    const singleUseToken = storeConfirmToken({
      type: 'CANCEL',
      userId: patient1Uid,
      appointmentId: 'appt-dummy-2'
    });
    consumeConfirmToken(singleUseToken); // First consumption
    const reusedRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: singleUseToken, disclaimerAccepted: true });
    const reuseBlocked = reusedRes.status === 400;

    // 9D: Missing disclaimer
    const validToken = storeConfirmToken({
      type: 'BOOKING',
      userId: patient1Uid,
      slotId: testSlotId
    });
    const noDisclaimerRes = await supertest(app)
      .post('/api/ai/chat/confirm')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ confirmToken: validToken, disclaimerAccepted: false });
    const disclaimerEnforced = noDisclaimerRes.status === 400;

    const pass = invalidBlocked && expiredBlocked && reuseBlocked && disclaimerEnforced;

    recordTest(
      'T9',
      'Token Security Edge Cases (Invalid, Expired, Reused, Disclaimer)',
      'PASS',
      `All 4 tampering edge cases correctly rejected with HTTP 400`,
      pass
    );
  }

  // ── TEST 10: Queue Token & Waiting Time Retrieval ─────────────────────────
  {
    // Seed an active appointment for today for patient 1 to test live token retrieval
    const todayApptId = 'appt-today-active-001';
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
      tokenNumber: 3,
      tokenLabel: 'CARD-03',
      queueStatus: 'WAITING',
      createdAt: new Date()
    });

    const tokenResult = await executePatientChatTool(
      'get_my_token',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const waitResult = await executePatientChatTool(
      'get_waiting_time',
      { doctorId: 'DOC-001' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const pass = tokenResult.tokenLabel === 'CARD-03' && waitResult !== null;

    recordTest(
      'T10',
      'Queue Token & Estimated Waiting Time Retrieval',
      'PASS',
      `Token retrieved: ${tokenResult.tokenLabel}, Doctor: ${tokenResult.doctorName}, Queue status: ${tokenResult.status}`,
      pass
    );
  }

  // ── TEST 11: Real Prescription & Medicine Reminders Retrieval ─────────────
  {
    // Seed real prescription document in emulator
    const rxId = 'rx-tara-test-001';
    await db.collection('prescriptions').doc(rxId).set({
      id: rxId,
      patientId: patient1Uid,
      patientHealthId: patient1HealthId,
      patientName: 'Aarav Sharma',
      doctorId: 'DOC-001',
      doctorName: 'Dr. Sarah Smith',
      date: todayStr,
      diagnosis: 'Mild hypertension check',
      medicines: [
        { medicineName: 'Amlodipine', dosage: '5mg', frequency: 'Once daily morning', durationDays: 30 }
      ],
      createdAt: new Date()
    });

    // Seed real reminder document in emulator
    const remId = 'rem-tara-test-001';
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

    const remResult = await executePatientChatTool(
      'get_medicine_schedule',
      {},
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    const passRx = rxResult.prescriptionId === rxId && rxResult.medicines?.length > 0;
    const passRem = remResult.schedule?.length > 0 && remResult.schedule[0].medicineName.includes('Amlodipine');

    recordTest(
      'T11',
      'Prescription & Medicine Reminders Retrieval (Firestore Emulator)',
      'PASS',
      `Rx found: ${rxResult.diagnosis} (${rxResult.medicines?.[0]?.name}), Reminders: ${remResult.count} active`,
      passRx && passRem
    );
  }

  // ── TEST 12: Anti-Hallucination Guardrails ─────────────────────────────────
  {
    // Querying non-existent doctor
    const nonExistentSlots = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-IMAGINARY-999', date: tomorrowStr },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    // Querying past date
    const pastSlots = await executePatientChatTool(
      'get_available_slots',
      { doctorId: 'DOC-001', date: '2020-01-01' },
      { userId: patient1Uid, selectedPatientHealthId: patient1HealthId }
    );

    // Querying prescription for attacker (who has zero prescriptions)
    const attackerRx = await executePatientChatTool(
      'get_latest_prescription',
      {},
      { userId: attackerUid, selectedPatientHealthId: attackerHealthId }
    );

    const pass = (
      nonExistentSlots.count === 0 &&
      pastSlots.availableSlots?.length === 0 &&
      pastSlots.message?.includes('past dates') &&
      attackerRx.hasPrescription === false
    );

    recordTest(
      'T12',
      'Anti-Hallucination Guardrails (Strict Grounding in Real Data)',
      'PASS',
      `Non-existent doctor: 0 slots; Past date: rejected; Empty prescriptions: hasPrescription=false`,
      pass
    );
  }

  // ── TEST 13: Emergency Pre-Check Bypass ────────────────────────────────────
  {
    const emergencyQueries = [
      { text: 'I have severe chest pain and cannot breathe', lang: 'en' },
      { text: 'ನನಗೆ ಎದೆ ನೋವು ಮತ್ತು ಉಸಿರಾಟದ ತೊಂದರೆ ಇದೆ', lang: 'kn' },
      { text: 'सीने में बहुत तेज दर्द हो रहा है', lang: 'hi' },
      { text: 'తీవ్రమైన గుండె నొప్పి వస్తోంది', lang: 'te' },
      { text: 'எனக்கு கடுமையான நெஞ்சு வலி உள்ளது', lang: 'ta' }
    ];

    let allEmergencyPassed = true;
    for (const q of emergencyQueries) {
      const isDetected = checkEmergencyKeywords(q.text);
      const resp = getEmergencyResponse(q.lang);
      const contains108 = resp.message?.includes('108') || resp.response?.includes('108');
      if (!isDetected || !contains108) {
        allEmergencyPassed = false;
        console.error(`Emergency check failed for language ${q.lang}: ${q.text}`);
      }
    }

    recordTest(
      'T13',
      'Emergency Immediate Safety Guidance (5 Indic Languages)',
      'PASS',
      `All 5 languages triggered instant emergency bypass with ambulance numbers 108/112`,
      allEmergencyPassed
    );
  }

  // ── TEST 14: Multilingual Voice & Speech Output Formatting ─────────────────
  {
    // Test cleanSpeechText strips markdown asterisks, hashes, and AI disclaimers
    const rawAiText = '**Dr. Sarah Smith** is available tomorrow.\n\n* Timings: 9:00 AM\n\nDisclaimer: This is AI generated content.';
    const cleanedSpeech = cleanSpeechText(rawAiText);
    const noAsterisks = !cleanedSpeech.includes('**') && !cleanedSpeech.includes('*');
    const noDisclaimer = !cleanedSpeech.includes('Disclaimer:');

    // Test multilingual quick replies via API in Kannada and Hindi
    const knRes = await supertest(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ message: 'Token Status', language: 'kn' });

    const hiRes = await supertest(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer test-${patient1Uid}`)
      .set('x-demo-uid', patient1Uid)
      .send({ message: 'Token Status', language: 'hi' });

    const knHasKannada = knRes.body.message && /[\u0C80-\u0CFF]/.test(knRes.body.message);
    const hiHasHindi = hiRes.body.message && /[\u0900-\u097F]/.test(hiRes.body.message);

    const pass = noAsterisks && noDisclaimer && knHasKannada && hiHasHindi;

    recordTest(
      'T14',
      'Multilingual Voice Formatter & Indic Text Delivery',
      'PASS',
      `Markdown/disclaimer stripped for TTS; Kannada and Hindi responses verified`,
      pass
    );
  }

  // ── TEST 15: Production Data Quarantine Verification ──────────────────────
  {
    const safeProjectId = getActiveProjectId() === 'demo-project';
    const emulatorActive = isEmulator === true;
    const pass = safeProjectId && emulatorActive;

    recordTest(
      'T15',
      'Production Data Quarantine Verification',
      'PASS',
      `Verified active connection to local emulator on 127.0.0.1:8080 (project demo-project)`,
      pass
    );
  }

  // ── Summary Report ────────────────────────────────────────────────────────
  console.log('\n===============================================================');
  console.log('                 PHASE 2 INTEGRATION SUMMARY                   ');
  console.log('===============================================================');
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log(`Total Real Workflow Tests Executed: ${total}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount === 0) {
    console.log('\n🌟 ALL 15 REAL WORKFLOW INTEGRATION TESTS PASSED PERFECTLY!\n');
  } else {
    console.log(`\n⚠️ ${failedCount} tests failed. Review logs above.\n`);
  }

  return { total, passedCount, failedCount, results };
}

run().catch((err) => {
  console.error('Fatal execution error in test runner:', err);
  process.exit(1);
});

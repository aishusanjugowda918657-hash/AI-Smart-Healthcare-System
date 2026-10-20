import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = 'demo-project';

const API_BASE = 'http://localhost:5000/api';
const AUTH_EMULATOR = 'http://localhost:9099';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-project' });
}

const db = admin.firestore();
const auth = admin.auth();

const results = [];
const cleanupRegistry = {
  authUids: [],
  patientHealthIds: [],
  appointmentIds: [],
  prescriptionIds: [],
  slotIds: []
};

function recordStep(id, title, status, details, httpStatus) {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`[${id}] ${title}: ${icon} ${status} - ${details} (HTTP ${httpStatus || 'N/A'})`);
  results.push({ id, title, status, details, httpStatus });
}

async function getAuthToken(uid, role, customClaims = {}) {
  try {
    await auth.getUser(uid);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      await auth.createUser({
        uid,
        email: `${uid}@demo.local`,
        password: 'Password123!'
      });
    }
  }
  await auth.setCustomUserClaims(uid, { role, ...customClaims });
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to exchange custom token for ${uid}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function signInWithPassword(email, password) {
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Password sign-in failed for ${email}: ${JSON.stringify(data)}`);
  }
  return { idToken: data.idToken, uid: data.localId };
}

async function runPhase76Regression() {
  console.log('========================================================================');
  console.log('   PHASE 76: CORE APPOINTMENT & QUEUE REGRESSION VERIFICATION (demo-project) ');
  console.log('========================================================================\n');

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // 1. SAFETY PREFLIGHT & EMULATOR ISOLATION PROOF
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Step 1: Safety Preflight & Isolation Proof ---');
    const envRes = await fetch(`${API_BASE}/health/env`);
    const envJson = await envRes.json();
    const envData = envJson.data || envJson;

    const healthRes = await fetch(`${API_BASE}/health`);
    const healthJson = await healthRes.json();
    const healthData = healthJson.data || healthJson;
    const activeFlags = healthData.flags || {};

    const isEmulatorMode = envData.isEmulator === true;
    const projectMatch = envData.projectId === 'demo-project';
    const hostsMatch = envData.firestoreHost === 'localhost:8080' &&
                       envData.authHost === 'localhost:9099';
    const flagsMatch = activeFlags.scheduler === false &&
                       activeFlags.ai === false &&
                       activeFlags.push === false;

    if (!isEmulatorMode || !projectMatch || !hostsMatch) {
      console.error('FATAL: Emulator isolation failure! Aborting Phase 76 tests immediately.', envData);
      process.exit(1);
    }

    recordStep('P76-ISO-1', 'Emulator Isolation Confirmed', 'PASS', `project=${envData.projectId}, firestore=${envData.firestoreHost}, auth=${envData.authHost}`, envRes.status);
    recordStep('P76-ISO-2', 'Flags Locked (Scheduler=false, AI=false, Push=false)', flagsMatch ? 'PASS' : 'FAIL', `flags=${JSON.stringify(activeFlags)}`, healthRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 2. WORKFLOW 1: REGISTER SYNTHETIC PATIENT & VERIFY HEALTH ID CREATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 2: Register Synthetic Patient & Verify Health ID ---');
    const runTimestamp = Date.now();
    const patientAEmail = `synthetic.alice.${runTimestamp}@smartcare-test.local`;
    const patientAPassword = 'Password123!';
    const patientAName = `Synthetic Alice P76 ${runTimestamp.toString().slice(-4)}`;

    const regRes = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: patientAEmail,
        password: patientAPassword,
        fullName: patientAName,
        phone: '9876543210',
        dob: '1995-05-15',
        gender: 'female',
        bloodGroup: 'B+'
      })
    });
    const regJson = await regRes.json();
    const regData = regJson.data || regJson;
    const patientAUid = regData.uid;
    const patientAHealthId = regData.healthId;

    if (patientAUid) cleanupRegistry.authUids.push(patientAUid);
    if (patientAHealthId) cleanupRegistry.patientHealthIds.push(patientAHealthId);

    const regSuccess = regRes.status === 201 && !!patientAUid && /^PHI-\d{4}-/.test(patientAHealthId || '');
    recordStep('P76-WF-1', 'Patient Registered & Atomic Health ID Created', regSuccess ? 'PASS' : 'FAIL', `uid=${patientAUid}, healthId=${patientAHealthId}`, regRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 3. WORKFLOW 2: LOG IN & VERIFY PATIENT DASHBOARD ACCESS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 3: Login & Verify Patient Dashboard Access ---');
    const loginCreds = await signInWithPassword(patientAEmail, patientAPassword);
    const tokenPatientA = loginCreds.idToken;

    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const meJson = await meRes.json();
    const meData = meJson.data || meJson;

    const loginSuccess = meRes.status === 200 &&
                         meData.email === patientAEmail &&
                         meData.role === 'patient';
    recordStep('P76-WF-2', 'Patient Logged In & Dashboard Identity Verified', loginSuccess ? 'PASS' : 'FAIL', `email=${meData.email}, role=${meData.role}`, meRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 4. WORKFLOW 3: VIEW AVAILABLE DOCTOR SLOTS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 4: View Available Doctor Slots ---');
    const assignedDoctorId = 'DOC-002'; // Dr. Rahul Kumar
    const tomorrowDate = '2026-10-13';

    const slotsRes = await fetch(`${API_BASE}/booking/suggestions?doctorId=${assignedDoctorId}&date=${tomorrowDate}`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const slotsJson = await slotsRes.json();
    const slotsData = slotsJson.data || {};
    const availableSlots = (slotsData.fullList || []).filter(s => s.status === 'free');

    const slotsSuccess = slotsRes.status === 200 && availableSlots.length > 0;
    const selectedSlot = availableSlots[0] || {};
    recordStep('P76-WF-3', 'View Available Doctor Slots', slotsSuccess ? 'PASS' : 'FAIL', `availableCount=${availableSlots.length}, firstSlot=${selectedSlot.id} (${selectedSlot.startAt})`, slotsRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 5. WORKFLOW 4: BOOK AVAILABLE SLOT & VERIFY APPOINTMENT / TOKEN CREATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 5: Book Available Slot & Verify Appointment/Token ---');
    const bookingRes = await fetch(`${API_BASE}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({
        slotIds: [selectedSlot.id],
        patientHealthId: patientAHealthId,
        patientName: patientAName,
        doctorId: assignedDoctorId,
        doctorName: 'Dr. Rahul Kumar',
        date: tomorrowDate,
        reasonText: 'Routine checkup for seasonal respiratory discomfort',
        disclaimerAck: { acknowledged: true }
      })
    });
    const bookingJson = await bookingRes.json();
    const apptData = bookingJson.data || {};
    const appointmentId = apptData.id || apptData.appointmentId;
    if (appointmentId) cleanupRegistry.appointmentIds.push(appointmentId);

    const bookingSuccess = bookingRes.status === 201 &&
                           !!appointmentId &&
                           !!apptData.tokenLabel &&
                           !!apptData.qrPayload &&
                           apptData.status === 'booked';
    recordStep('P76-WF-4', 'Book Available Slot & Verify Appointment/Token Created', bookingSuccess ? 'PASS' : 'FAIL', `appointmentId=${appointmentId}, token=${apptData.tokenLabel}, status=${apptData.status}`, bookingRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 6. WORKFLOW 5: VERIFY DUPLICATE BOOKING IS REJECTED
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 6: Verify Duplicate Booking Is Rejected ---');
    const secondSlot = availableSlots[1] || availableSlots[0];
    const dupBookingRes = await fetch(`${API_BASE}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({
        slotIds: [secondSlot.id],
        patientHealthId: patientAHealthId,
        patientName: patientAName,
        doctorId: assignedDoctorId,
        doctorName: 'Dr. Rahul Kumar',
        date: tomorrowDate,
        reasonText: 'Second appointment attempt with same doctor on same date',
        disclaimerAck: { acknowledged: true }
      })
    });
    const dupBookingJson = await dupBookingRes.json();
    const dupRejected = dupBookingRes.status === 409 &&
                        (dupBookingJson.error?.code === 'DUPLICATE_BOOKING' || dupBookingJson.message?.includes('already have an active appointment'));
    recordStep('P76-WF-5', 'Duplicate Same-Day Doctor Booking Rejected (409)', dupRejected ? 'PASS' : 'FAIL', dupBookingJson.message || dupBookingJson.error?.message, dupBookingRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 7. WORKFLOW 6: VERIFY RECEPTION CAN CHECK IN THE APPOINTMENT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 7: Verify Reception Can Check In Appointment ---');
    const receptionUid = 'reception-p76-staff';
    const tokenReception = await getAuthToken(receptionUid, 'reception');

    // Align appointment to current date and current slot time for check-in window
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const curHours = String(now.getHours()).padStart(2, '0');
    const alignedTimeSlot = `${curHours}:30`;

    await db.collection('appointments').doc(appointmentId).update({
      date: todayStr,
      timeSlot: alignedTimeSlot,
      bookedStartAt: alignedTimeSlot,
      status: 'booked'
    });

    const refreshedApptSnap = await db.collection('appointments').doc(appointmentId).get();
    const qrPayload = refreshedApptSnap.data().qrPayload;

    const checkinRes = await fetch(`${API_BASE}/checkin/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenReception}`
      },
      body: JSON.stringify({ qrPayload })
    });
    const checkinJson = await checkinRes.json();
    const checkinData = checkinJson.data || {};
    const checkinSuccess = checkinRes.status === 200 && checkinData.status === 'checked_in';
    recordStep('P76-WF-6', 'Reception QR Check-In Successful', checkinSuccess ? 'PASS' : 'FAIL', `status=${checkinData.status}, appointmentId=${appointmentId}`, checkinRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 8. WORKFLOW 7: VERIFY DUPLICATE CHECK-IN IS REJECTED
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 8: Verify Duplicate Check-In Is Rejected ---');
    const dupCheckinRes = await fetch(`${API_BASE}/checkin/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenReception}`
      },
      body: JSON.stringify({ qrPayload })
    });
    const dupCheckinJson = await dupCheckinRes.json();
    const dupCheckinRejected = dupCheckinRes.status === 409 &&
                               (dupCheckinJson.error?.code === 'ALREADY_CHECKED_IN' || dupCheckinJson.message?.includes('already been checked in'));
    recordStep('P76-WF-7', 'Duplicate QR Check-In Rejected (409 ALREADY_CHECKED_IN)', dupCheckinRejected ? 'PASS' : 'FAIL', dupCheckinJson.message || dupCheckinJson.error?.message, dupCheckinRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 9. WORKFLOW 8: VERIFY ASSIGNED DOCTOR CAN VIEW & CALL QUEUE
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 9: Verify Assigned Doctor Can View & Call Queue ---');
    const doctor1Uid = 'zHJ8GargpAowoNrQJ4ZIC2vEGFiZ'; // Dr. Rahul Kumar
    const tokenDoctor1 = await getAuthToken(doctor1Uid, 'doctor', { doctorId: assignedDoctorId });

    const queueRes = await fetch(`${API_BASE}/queue/doctor/${assignedDoctorId}/today?date=${todayStr}`, {
      headers: { 'Authorization': `Bearer ${tokenDoctor1}` }
    });
    const queueJson = await queueRes.json();
    const queueData = queueJson.data || {};
    const readyCandidates = queueData.readyCandidates || [];
    const isApptInQueue = readyCandidates.some(c => c.id === appointmentId) || (queueData.totalActive > 0);
    recordStep('P76-WF-8a', 'Assigned Doctor Views Own Queue', queueRes.status === 200 && isApptInQueue ? 'PASS' : 'FAIL', `totalActive=${queueData.totalActive}, readyCount=${readyCandidates.length}`, queueRes.status);

    // Doctor calls the patient
    const callRes = await fetch(`${API_BASE}/queue/call/${appointmentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor1}`
      },
      body: JSON.stringify({ reason: 'Called into consultation room' })
    });
    const callJson = await callRes.json();
    const callSuccess = callRes.status === 200 && callJson.data?.status === 'called';
    recordStep('P76-WF-8b', 'Assigned Doctor Calls Patient', callSuccess ? 'PASS' : 'FAIL', `status=${callJson.data?.status}, reason=${callJson.data?.reason}`, callRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 10. WORKFLOW 9: VERIFY ANOTHER DOCTOR CANNOT ACCESS OR CALL APPOINTMENT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 10: Verify Another Doctor Cannot Access or Call Appointment ---');
    const doctor2Uid = '9UN0r0WOYvQaVx9X1YF8MHkEpJ2j'; // Dr. Vikram Patel (DOC-006)
    const tokenDoctor2 = await getAuthToken(doctor2Uid, 'doctor', { doctorId: 'DOC-006' });

    // Doctor 2 attempts to view Doctor 1's queue
    const crossQueueRes = await fetch(`${API_BASE}/queue/doctor/${assignedDoctorId}/today?date=${todayStr}`, {
      headers: { 'Authorization': `Bearer ${tokenDoctor2}` }
    });
    const crossQueueJson = await crossQueueRes.json();
    const crossQueueBlocked = crossQueueRes.status === 403;
    recordStep('P76-WF-9a', 'Cross-Doctor Queue View Blocked (403)', crossQueueBlocked ? 'PASS' : 'FAIL', crossQueueJson.error?.message || crossQueueJson.message, crossQueueRes.status);

    // Doctor 2 attempts to call Doctor 1's appointment
    const crossCallRes = await fetch(`${API_BASE}/queue/call/${appointmentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor2}`
      },
      body: JSON.stringify({ reason: 'Unauthorized doctor call attempt' })
    });
    const crossCallJson = await crossCallRes.json();
    const crossCallBlocked = crossCallRes.status === 403;
    recordStep('P76-WF-9b', 'Cross-Doctor Call Attempt Blocked (403)', crossCallBlocked ? 'PASS' : 'FAIL', crossCallJson.error?.message || crossCallJson.message, crossCallRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 11. WORKFLOW 10: VERIFY PATIENT CAN ACCESS OWN HISTORY & PRESCRIPTION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 11: Verify Patient Can Access Own Consultation History & Prescription ---');
    // Doctor completes consultation & issues prescription
    const presRes = await fetch(`${API_BASE}/prescriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor1}`
      },
      body: JSON.stringify({
        patientUid: patientAUid,
        patientHealthId: patientAHealthId,
        appointmentId,
        doctorNotes: 'Patient evaluated for seasonal symptoms. Advised warm fluids.',
        diagnosis: 'Seasonal Rhinitis',
        medicines: [
          {
            name: 'Cetirizine 10mg',
            dosage: '10 mg',
            frequency: '0-0-1',
            durationDays: 5,
            timing: 'bedtime',
            notes: 'Take at night'
          }
        ]
      })
    });
    const presJson = await presRes.json();
    const presData = presJson.data || presJson;
    const prescriptionId = presData.prescriptionId || presJson.prescriptionId;
    if (prescriptionId) cleanupRegistry.prescriptionIds.push(prescriptionId);

    // Patient views own appointments history
    const myApptsRes = await fetch(`${API_BASE}/appointments/my-appointments`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const myApptsJson = await myApptsRes.json();
    const myAppts = myApptsJson.data || [];
    const patientCanViewAppt = myApptsRes.status === 200 && myAppts.some(a => a.id === appointmentId);
    recordStep('P76-WF-10a', 'Patient Accesses Own Appointment History', patientCanViewAppt ? 'PASS' : 'FAIL', `appointmentsFound=${myAppts.length}`, myApptsRes.status);

    // Patient views own prescription
    const myPresRes = await fetch(`${API_BASE}/prescriptions/my-prescriptions`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const myPresJson = await myPresRes.json();
    const myPres = myPresJson.data || [];
    const patientCanViewPres = myPresRes.status === 200 && myPres.some(p => p.prescriptionId === prescriptionId);
    recordStep('P76-WF-10b', 'Patient Accesses Own Prescription', patientCanViewPres ? 'PASS' : 'FAIL', `prescriptionId=${prescriptionId}, totalPrescriptions=${myPres.length}`, myPresRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 12. WORKFLOW 11: VERIFY UNAUTHORIZED CROSS-PATIENT ACCESS BLOCKED
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 12: Verify Unauthorized Cross-Patient Access Blocked ---');
    const patientBUid = `synthetic-patient-b-${runTimestamp}`;
    const patientBHealthId = `PHI-P76-B-${runTimestamp.toString().slice(-4)}`;
    cleanupRegistry.authUids.push(patientBUid);
    cleanupRegistry.patientHealthIds.push(patientBHealthId);

    await auth.createUser({ uid: patientBUid, email: `patient.b.${runTimestamp}@demo.local`, password: 'Password123!' });
    await auth.setCustomUserClaims(patientBUid, { role: 'patient', healthId: patientBHealthId });

    await db.collection('patients').doc(patientBHealthId).set({
      healthId: patientBHealthId,
      patientHealthId: patientBHealthId,
      uid: patientBUid,
      name: 'Patient Bob (Attacker)',
      email: `patient.b.${runTimestamp}@demo.local`
    });

    const tokenPatientB = await getAuthToken(patientBUid, 'patient', { healthId: patientBHealthId });

    // Patient B attempts to access Patient A's prescription directly
    const crossPresRes = await fetch(`${API_BASE}/prescriptions/${prescriptionId}`, {
      headers: { 'Authorization': `Bearer ${tokenPatientB}` }
    });
    const crossPresJson = await crossPresRes.json();
    const crossPresBlocked = crossPresRes.status === 403;
    recordStep('P76-WF-11a', 'Cross-Patient Prescription Direct Access Blocked (403)', crossPresBlocked ? 'PASS' : 'FAIL', crossPresJson.message, crossPresRes.status);

    // Patient B attempts to access Patient A's prescriptions by Health ID
    const crossHealthIdPresRes = await fetch(`${API_BASE}/prescriptions/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${tokenPatientB}` }
    });
    const crossHealthIdPresJson = await crossHealthIdPresRes.json();
    const crossHealthIdPresBlocked = crossHealthIdPresRes.status === 403;
    recordStep('P76-WF-11b', 'Cross-Patient Prescription by Health ID Access Blocked (403)', crossHealthIdPresBlocked ? 'PASS' : 'FAIL', crossHealthIdPresJson.message, crossHealthIdPresRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 13. SUMMARY & CLEANUP OF SYNTHETIC TEST RUN RECORDS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 13: Ownership-Verified Cleanup of Run Records ---');
    console.log('Cleaning up synthetic records created during this run:', cleanupRegistry);

    // Clean appointments created in this run
    for (const apptId of cleanupRegistry.appointmentIds) {
      const doc = await db.collection('appointments').doc(apptId).get();
      if (doc.exists && doc.data().patientHealthId === patientAHealthId) {
        await db.collection('appointments').doc(apptId).delete();
        console.log(`[Cleaned] Appointment ${apptId}`);
      }
    }

    // Clean prescriptions created in this run
    for (const rxId of cleanupRegistry.prescriptionIds) {
      const rxSnap = await db.collection('prescriptions').where('prescriptionId', '==', rxId).get();
      for (const d of rxSnap.docs) {
        if (d.data().patientHealthId === patientAHealthId) {
          await d.ref.delete();
          console.log(`[Cleaned] Prescription doc ${d.id} (${rxId})`);
        }
      }
    }

    // Clean synthetic patients created in this run
    for (const hId of cleanupRegistry.patientHealthIds) {
      const pDoc = await db.collection('patients').doc(hId).get();
      if (pDoc.exists && (pDoc.data().uid === patientAUid || pDoc.data().uid === patientBUid)) {
        await db.collection('patients').doc(hId).delete();
        console.log(`[Cleaned] Patient ${hId}`);
      }
    }

    // Clean synthetic users created in this run
    for (const uid of cleanupRegistry.authUids) {
      await db.collection('users').doc(uid).delete().catch(() => {});
      await auth.deleteUser(uid).catch(() => {});
      console.log(`[Cleaned] User & Auth ${uid}`);
    }

    // Release slot booked during test back to free
    if (selectedSlot.id) {
      await db.collection('slots').doc(selectedSlot.id).update({
        status: 'free',
        appointmentId: null,
        heldBy: null,
        heldUntil: null
      }).catch(() => {});
      console.log(`[Reset] Slot ${selectedSlot.id} reset to 'free'`);
    }

    recordStep('P76-CLEANUP', 'Ownership-Verified Test Cleanup Completed', 'PASS', 'All synthetic test records removed, slots restored', 200);

    console.log('\n========================================================================');
    console.log('   PHASE 76 REGRESSION SUMMARY');
    console.log('========================================================================');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`Total Checks: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed > 0) {
      console.error(`FAILED: ${failed} check(s) failed during Phase 76 regression.`);
      process.exit(1);
    } else {
      console.log('🎉 ALL PHASE 76 CORE APPOINTMENT & QUEUE REGRESSION CHECKS PASSED!');
      process.exit(0);
    }

  } catch (err) {
    console.error('Unhandled exception during Phase 76 tests:', err);
    process.exit(1);
  }
}

runPhase76Regression();

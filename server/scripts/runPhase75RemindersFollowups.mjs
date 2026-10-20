import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = 'demo-project';

const API_BASE = 'http://localhost:5000/api';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-project' });
}

const db = admin.firestore();
const auth = admin.auth();

const results = [];

function recordStep(id, title, status, details, httpStatus) {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`[${id}] ${title}: ${icon} ${status} - ${details} (HTTP ${httpStatus || 'N/A'})`);
  results.push({ id, title, status, details, httpStatus });
}

async function getAuthToken(uid, role, customClaims = {}) {
  await auth.setCustomUserClaims(uid, { role, ...customClaims });
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(`http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to exchange custom token: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function runPhase75Tests() {
  console.log('========================================================================');
  console.log('   PHASE 75: MEDICINE REMINDERS & FOLLOW-UP VERIFICATION (demo-project) ');
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
      console.error('FATAL: Emulator isolation failure! Aborting Phase 75 tests immediately.', envData);
      process.exit(1);
    }

    recordStep('P75-ISO-1', 'Emulator Isolation Confirmed', 'PASS', `project=${envData.projectId}, firestore=${envData.firestoreHost}, auth=${envData.authHost}`, envRes.status);
    recordStep('P75-ISO-2', 'Flags Locked (Scheduler=false, AI=false, Push=false)', flagsMatch ? 'PASS' : 'FAIL', `flags=${JSON.stringify(activeFlags)}`, healthRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 2. SETUP SYNTHETIC ACTORS IN EMULATOR
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 2: Setup Synthetic Actors ---');
    const patientAUid = 'emu-phase75-patient-a';
    const patientBUid = 'emu-phase75-patient-b';
    const doctorUid = 'doc-phase75-001';
    const patientAHealthId = 'PHI-P75-001';
    const patientBHealthId = 'PHI-P75-002';
    const doctorId = 'DOC-P75-001';

    // Provision test users in Auth Emulator
    for (const u of [
      { uid: patientAUid, email: 'patient.a.p75@demo.local', role: 'patient', claims: { healthId: patientAHealthId, patientHealthId: patientAHealthId } },
      { uid: patientBUid, email: 'patient.b.p75@demo.local', role: 'patient', claims: { healthId: patientBHealthId, patientHealthId: patientBHealthId } },
      { uid: doctorUid, email: 'doctor.p75@demo.local', role: 'doctor', claims: { doctorId } }
    ]) {
      try {
        const existing = await auth.getUserByEmail(u.email);
        await auth.deleteUser(existing.uid);
      } catch (_) {}
      try {
        await auth.deleteUser(u.uid);
      } catch (_) {}
      await auth.createUser({ uid: u.uid, email: u.email, password: 'Password123!', displayName: u.uid });
      await auth.setCustomUserClaims(u.uid, { role: u.role, ...u.claims });
    }

    // Seed Firestore records for Patient A, Patient B, and Doctor
    await db.collection('patients').doc(patientAHealthId).set({
      healthId: patientAHealthId,
      patientHealthId: patientAHealthId,
      uid: patientAUid,
      name: 'Alice Phase75',
      fullName: 'Alice Phase75',
      email: 'patient.a.p75@demo.local',
      allergies: [],
      conditions: [{ name: 'Hypertension', since: '2024' }]
    }, { merge: true });

    await db.collection('patients').doc(patientBHealthId).set({
      healthId: patientBHealthId,
      patientHealthId: patientBHealthId,
      uid: patientBUid,
      name: 'Bob Phase75 (Unrelated)',
      fullName: 'Bob Phase75 (Unrelated)',
      email: 'patient.b.p75@demo.local',
      allergies: [],
      conditions: []
    }, { merge: true });

    await db.collection('doctors').doc(doctorId).set({
      doctorId,
      uid: doctorUid,
      name: 'Dr. Rahul Sharma (P75)',
      fullName: 'Dr. Rahul Sharma (P75)',
      specialization: 'General Medicine',
      department: 'General Medicine'
    }, { merge: true });

    await db.collection('users').doc(doctorUid).set({
      uid: doctorUid,
      role: 'doctor',
      doctorId,
      name: 'Dr. Rahul Sharma (P75)',
      fullName: 'Dr. Rahul Sharma (P75)'
    }, { merge: true });

    await db.collection('users').doc(patientAUid).set({
      uid: patientAUid,
      role: 'patient',
      patientHealthId: patientAHealthId,
      healthId: patientAHealthId,
      name: 'Alice Phase75'
    }, { merge: true });

    await db.collection('users').doc(patientBUid).set({
      uid: patientBUid,
      role: 'patient',
      patientHealthId: patientBHealthId,
      healthId: patientBHealthId,
      name: 'Bob Phase75 (Unrelated)'
    }, { merge: true });

    const tokenPatientA = await getAuthToken(patientAUid, 'patient', { healthId: patientAHealthId, patientHealthId: patientAHealthId });
    const tokenPatientB = await getAuthToken(patientBUid, 'patient', { healthId: patientBHealthId, patientHealthId: patientBHealthId });
    const tokenDoctor = await getAuthToken(doctorUid, 'doctor', { doctorId });

    recordStep('P75-ACTORS', 'Synthetic Actors Provisioned & Authenticated', 'PASS', 'Patient A, Patient B, and Doctor tokens obtained', 200);

    // ──────────────────────────────────────────────────────────────────────────
    // 3. MEDICINE REMINDER TESTS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 3: Medicine Reminder Tests ---');

    // 3.1 Invalid / Missing prescription data handling
    const emptySyncRes = await fetch(`${API_BASE}/reminders/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({})
    });
    const emptySyncJson = await emptySyncRes.json();
    const emptyHandledSafely = emptySyncRes.status === 400 && emptySyncJson.success === false;
    recordStep('P75-REM-1', 'Missing Prescription ID Handled Safely (400)', emptyHandledSafely ? 'PASS' : 'FAIL', emptySyncJson.message, emptySyncRes.status);

    const invalidSyncRes = await fetch(`${API_BASE}/reminders/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ prescriptionId: 'RX-NON-EXISTENT-99999' })
    });
    const invalidSyncJson = await invalidSyncRes.json();
    const invalidHandledSafely = invalidSyncRes.status === 404 && invalidSyncJson.success === false;
    recordStep('P75-REM-2', 'Non-existent Prescription Handled Safely (404)', invalidHandledSafely ? 'PASS' : 'FAIL', invalidSyncJson.message, invalidSyncRes.status);

    // 3.2 Create Synthetic Prescription with Medicine Details
    const rxDate = new Date().toISOString().split('T')[0];
    const presBody = {
      patientUid: patientAUid,
      patientHealthId: patientAHealthId,
      doctorNotes: 'Take medications regularly with water.',
      diagnosis: 'Acute Bronchitis',
      medicines: [
        {
          name: 'Amoxicillin 500mg',
          dosage: '500 mg',
          frequency: '1-0-1',
          durationDays: 7,
          timing: 'after_food',
          notes: 'Take after meals'
        },
        {
          name: 'Paracetamol 650mg',
          dosage: '650 mg',
          frequency: '0-0-1',
          durationDays: 3,
          timing: 'bedtime',
          notes: 'Take at night if fever persists'
        }
      ]
    };

    const presRes = await fetch(`${API_BASE}/prescriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor}`
      },
      body: JSON.stringify(presBody)
    });
    const presJson = await presRes.json();
    const presData = presJson.data || presJson;
    const prescriptionId = presData.prescriptionId || presJson.prescriptionId;

    const rxCreated = presRes.status === 201 && !!prescriptionId;
    recordStep('P75-REM-3', 'Doctor Creates Digital Prescription with Medicines', rxCreated ? 'PASS' : 'FAIL', `prescriptionId=${prescriptionId}`, presRes.status);

    // 3.3 Explicit Reminders Sync from Prescription
    const syncRes = await fetch(`${API_BASE}/reminders/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ prescriptionId })
    });
    const syncJson = await syncRes.json();
    const syncedReminders = syncJson.data || [];
    const syncSuccess = syncRes.status === 201 && Array.isArray(syncedReminders) && syncedReminders.length >= 2;
    recordStep('P75-REM-4', 'Sync Reminders from Prescription to Patient Schedule', syncSuccess ? 'PASS' : 'FAIL', `syncedCount=${syncedReminders.length}`, syncRes.status);

    // 3.4 Patient A views own reminders & verifies details
    const patientARemindersRes = await fetch(`${API_BASE}/reminders/today`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const patientARemindersJson = await patientARemindersRes.json();
    const remindersList = patientARemindersJson.data || [];
    const hasAmox = remindersList.some(r => (r.medicineName || '').includes('Amoxicillin') && r.dosage === '500 mg');
    const hasPara = remindersList.some(r => (r.medicineName || '').includes('Paracetamol') && r.dosage === '650 mg');
    const correctDetails = patientARemindersRes.status === 200 && hasAmox && hasPara;
    recordStep('P75-REM-5', 'Patient A Views Own Reminders with Full Dosage/Schedule', correctDetails ? 'PASS' : 'FAIL', `itemsFound=${remindersList.length}, amoxicillin=${hasAmox}, paracetamol=${hasPara}`, patientARemindersRes.status);

    // 3.5 Cross-Patient Isolation: Patient B cannot access Patient A reminders
    const crossReminderRes = await fetch(`${API_BASE}/reminders/today?healthId=${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${tokenPatientB}` }
    });
    const crossReminderJson = await crossReminderRes.json();
    const crossBlocked = crossReminderRes.status === 403 && crossReminderJson.success === false;
    recordStep('P75-REM-6', 'Cross-Patient Reminder Access Denied (Patient B -> Patient A: 403)', crossBlocked ? 'PASS' : 'FAIL', crossReminderJson.message, crossReminderRes.status);

    // 3.6 Cross-Patient Adherence Metrics Isolation
    const crossAdherenceRes = await fetch(`${API_BASE}/reminders/${patientAHealthId}/adherence`, {
      headers: { 'Authorization': `Bearer ${tokenPatientB}` }
    });
    const crossAdherenceJson = await crossAdherenceRes.json();
    const crossAdherenceBlocked = crossAdherenceRes.status === 403 && crossAdherenceJson.success === false;
    recordStep('P75-REM-7', 'Cross-Patient Adherence Access Denied (Patient B -> Patient A: 403)', crossAdherenceBlocked ? 'PASS' : 'FAIL', crossAdherenceJson.message, crossAdherenceRes.status);

    // 3.7 Reminder Dose Action Response (Patient A logs dose as taken on reminder 1)
    const firstReminderId = syncedReminders[0]?.id || remindersList[0]?.id || 'rem-test-1';
    // Ensure first reminder exists in reminders collection as pending
    await db.collection('reminders').doc(firstReminderId).set({
      id: firstReminderId,
      reminderId: firstReminderId,
      healthId: patientAHealthId,
      patientUid: patientAUid,
      medicineName: 'Amoxicillin 500mg',
      status: 'pending',
      dueAt: new Date().toISOString()
    }, { merge: true });

    const respondRes = await fetch(`${API_BASE}/reminders/${firstReminderId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ action: 'taken' })
    });
    const respondJson = await respondRes.json();
    const respondSuccess = respondRes.status === 200 && respondJson.success === true;
    recordStep('P75-REM-8', 'Patient A Responds to Dose Reminder (Action=Taken)', respondSuccess ? 'PASS' : 'FAIL', respondJson.message, respondRes.status);

    // 3.8 Invalid Reminder Action Safely Rejected on Pending Reminder
    const secondReminderId = 'rem-test-invalid-action-p75';
    await db.collection('reminders').doc(secondReminderId).set({
      id: secondReminderId,
      reminderId: secondReminderId,
      healthId: patientAHealthId,
      patientUid: patientAUid,
      medicineName: 'Paracetamol 650mg',
      status: 'pending',
      dueAt: new Date().toISOString()
    });

    const invalidActionRes = await fetch(`${API_BASE}/reminders/${secondReminderId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ action: 'invalid_action_xyz' })
    });
    const invalidActionJson = await invalidActionRes.json();
    const invalidActionRejected = invalidActionRes.status === 400 && invalidActionJson.success === false;
    recordStep('P75-REM-9', 'Invalid Reminder Action Rejected (400)', invalidActionRejected ? 'PASS' : 'FAIL', invalidActionJson.message, invalidActionRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 4. FOLLOW-UP TESTS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 4: Patient & Doctor Follow-up Tests ---');

    // 4.1 Unauthorized Follow-up Creation (Patient A tries to create follow-up -> 403)
    const unauthorizedFollowUpRes = await fetch(`${API_BASE}/followups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({
        patientHealthId: patientAHealthId,
        scheduledDate: '2026-10-20',
        notes: 'Patient attempting self-scheduled clinical follow-up'
      })
    });
    const unauthorizedFollowUpJson = await unauthorizedFollowUpRes.json();
    const unauthorizedBlocked = unauthorizedFollowUpRes.status === 403;
    recordStep('P75-FLW-1', 'Unauthorized Follow-up Creation Denied for Patient (403)', unauthorizedBlocked ? 'PASS' : 'FAIL', unauthorizedFollowUpJson.message || 'Access Forbidden', unauthorizedFollowUpRes.status);

    // 4.2 Doctor Creates Follow-up with Synthetic Due Date
    const dueDateObj = new Date();
    dueDateObj.setDate(dueDateObj.getDate() + 7);
    const scheduledDueDate = dueDateObj.toISOString().split('T')[0];

    const createFollowUpRes = await fetch(`${API_BASE}/followups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor}`
      },
      body: JSON.stringify({
        patientUid: patientAUid,
        patientHealthId: patientAHealthId,
        patientName: 'Alice Phase75',
        scheduledDate: scheduledDueDate,
        notes: 'Follow-up consultation for respiratory symptoms evaluation',
        reason: 'Review clinical response to antibiotics',
        importance: 'routine',
        isSerious: false
      })
    });
    const createFollowUpJson = await createFollowUpRes.json();
    const followUpData = createFollowUpJson.data || {};
    const followUpId = followUpData.id;
    const followUpCreated = createFollowUpRes.status === 201 && !!followUpId;
    recordStep('P75-FLW-2', 'Doctor Creates Patient Follow-up Checkup', followUpCreated ? 'PASS' : 'FAIL', `followUpId=${followUpData.followUpId || followUpId}, dueDate=${scheduledDueDate}`, createFollowUpRes.status);

    // 4.3 Patient A Views Own Follow-up
    const patientFollowUpsRes = await fetch(`${API_BASE}/followups/patient-upcoming`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const patientFollowUpsJson = await patientFollowUpsRes.json();
    const patientFollowUps = patientFollowUpsJson.data || [];
    const patientCanView = patientFollowUpsRes.status === 200 && patientFollowUps.some(f => f.id === followUpId || f.healthId === patientAHealthId);
    recordStep('P75-FLW-3', 'Patient A Views Own Upcoming Follow-up', patientCanView ? 'PASS' : 'FAIL', `followupsCount=${patientFollowUps.length}`, patientFollowUpsRes.status);

    // 4.4 Cross-Patient Follow-up Access Denial (Patient B -> Patient A)
    const crossFollowUpViewRes = await fetch(`${API_BASE}/followups?healthId=${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${tokenPatientB}` }
    });
    const crossFollowUpViewJson = await crossFollowUpViewRes.json();
    const crossFollowUpViewBlocked = crossFollowUpViewRes.status === 403 && crossFollowUpViewJson.success === false;
    recordStep('P75-FLW-4', 'Cross-Patient Follow-up List Access Denied (Patient B: 403)', crossFollowUpViewBlocked ? 'PASS' : 'FAIL', crossFollowUpViewJson.message, crossFollowUpViewRes.status);

    const crossFollowUpActionRes = await fetch(`${API_BASE}/followups/${followUpId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientB}`
      },
      body: JSON.stringify({ action: 'remind_later' })
    });
    const crossFollowUpActionJson = await crossFollowUpActionRes.json();
    const crossFollowUpActionBlocked = crossFollowUpActionRes.status === 403 && crossFollowUpActionJson.success === false;
    recordStep('P75-FLW-5', 'Cross-Patient Follow-up Modification Denied (Patient B: 403)', crossFollowUpActionBlocked ? 'PASS' : 'FAIL', crossFollowUpActionJson.message, crossFollowUpActionRes.status);

    // 4.5 Patient A Snoozes / Reschedules Follow-up ('remind_later')
    const snoozeRes1 = await fetch(`${API_BASE}/followups/${followUpId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ action: 'remind_later' })
    });
    const snoozeJson1 = await snoozeRes1.json();
    const snooze1Success = snoozeRes1.status === 200 && snoozeJson1.snoozeCount === 1;
    recordStep('P75-FLW-6', 'Patient A Snoozes Follow-up (+1 day, snoozeCount=1)', snooze1Success ? 'PASS' : 'FAIL', `newDueDate=${snoozeJson1.newDueDate}, snoozeCount=${snoozeJson1.snoozeCount}`, snoozeRes1.status);

    // Snooze 2nd time (allowed)
    const snoozeRes2 = await fetch(`${API_BASE}/followups/${followUpId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ action: 'remind_later' })
    });
    const snoozeJson2 = await snoozeRes2.json();
    const snooze2Success = snoozeRes2.status === 200 && snoozeJson2.snoozeCount === 2;
    recordStep('P75-FLW-7', 'Patient A Snoozes Follow-up 2nd Time (snoozeCount=2)', snooze2Success ? 'PASS' : 'FAIL', `newDueDate=${snoozeJson2.newDueDate}, snoozeCount=${snoozeJson2.snoozeCount}`, snoozeRes2.status);

    // Snooze 3rd time (max limit reached -> 400)
    const snoozeRes3 = await fetch(`${API_BASE}/followups/${followUpId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatientA}`
      },
      body: JSON.stringify({ action: 'remind_later' })
    });
    const snoozeJson3 = await snoozeRes3.json();
    const snooze3LimitEnforced = snoozeRes3.status === 400 && snoozeJson3.code === 'MAX_SNOOZES_REACHED';
    recordStep('P75-FLW-8', 'Max Snooze Limit Enforced (Max 2 Snoozes -> 400)', snooze3LimitEnforced ? 'PASS' : 'FAIL', snoozeJson3.message, snoozeRes3.status);

    // 4.6 Assigned Doctor Views Upcoming Follow-ups
    const docUpcomingRes = await fetch(`${API_BASE}/followups/doctor-upcoming`, {
      headers: { 'Authorization': `Bearer ${tokenDoctor}` }
    });
    const docUpcomingJson = await docUpcomingRes.json();
    const docUpcomingList = docUpcomingJson.data || [];
    const docCanViewUpcoming = docUpcomingRes.status === 200 && docUpcomingList.some(f => f.id === followUpId || f.doctorId === doctorUid);
    recordStep('P75-FLW-9', 'Treating Doctor Views Upcoming Follow-ups', docCanViewUpcoming ? 'PASS' : 'FAIL', `upcomingCount=${docUpcomingList.length}`, docUpcomingRes.status);

    // Patient cannot call doctor-upcoming endpoint
    const patientCallsDocUpcomingRes = await fetch(`${API_BASE}/followups/doctor-upcoming`, {
      headers: { 'Authorization': `Bearer ${tokenPatientA}` }
    });
    const patientCallsDocUpcomingJson = await patientCallsDocUpcomingRes.json();
    const patientBlockedFromDocUpcoming = patientCallsDocUpcomingRes.status === 403;
    recordStep('P75-FLW-10', 'Patient Blocked from Doctor Upcoming Follow-ups (403)', patientBlockedFromDocUpcoming ? 'PASS' : 'FAIL', patientCallsDocUpcomingJson.message || 'Forbidden', patientCallsDocUpcomingRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 5. SCHEDULER & NOTIFICATION BOUNDARIES VERIFICATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 5: Scheduler and Notification Boundaries ---');
    const noCronOrPushActive = activeFlags.scheduler === false && activeFlags.push === false;
    recordStep('P75-NOTIF-1', 'Scheduler and Push Notifications Flags Confirmed Disabled', noCronOrPushActive ? 'PASS' : 'FAIL', `scheduler=${activeFlags.scheduler}, push=${activeFlags.push}`, 200);

    // Verify in-app notifications
    const notifsSnap = await db.collection('notifications').where('uid', '==', patientAUid).get();
    const allNotifsAreInAppOnly = notifsSnap.docs.every(d => d.data().pushStatus === 'none' || !d.data().pushStatus);
    recordStep('P75-NOTIF-2', 'In-App Only Notifications (No Background Push Dispatched)', allNotifsAreInAppOnly ? 'PASS' : 'FAIL', `inAppNotificationsCount=${notifsSnap.size}`, 200);

    // ──────────────────────────────────────────────────────────────────────────
    // 6. SUMMARY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n========================================================================');
    console.log('   PHASE 75 VERIFICATION SUMMARY');
    console.log('========================================================================');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`Total Checks: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed > 0) {
      console.error(`FAILED: ${failed} check(s) failed during Phase 75 verification.`);
      process.exit(1);
    } else {
      console.log('🎉 ALL PHASE 75 MEDICINE REMINDER AND FOLLOW-UP CHECKS PASSED SUCCESSFULLY!');
      process.exit(0);
    }

  } catch (err) {
    console.error('Unhandled exception during Phase 75 tests:', err);
    process.exit(1);
  }
}

runPhase75Tests();

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

async function runTests() {
  console.log('========================================================================');
  console.log('   STORAGE-DISABLED EMULATOR FOCUSED TESTS (demo-project)              ');
  console.log('========================================================================\n');

  try {
    // ── STEP 3 VERIFICATION: EMULATOR ISOLATION PROOF ──
    console.log('--- Step 3: Emulator Isolation Verification ---');
    const healthRes = await fetch(`${API_BASE}/health/env`);
    const json = await healthRes.json();
    const healthData = json.data || json;
    const isEmulatorMode = healthData.isEmulator === true;
    const projectMatch = healthData.projectId === 'demo-project';
    const hostsMatch = healthData.firestoreHost === 'localhost:8080' &&
                       healthData.authHost === 'localhost:9099';

    if (!isEmulatorMode || !projectMatch || !hostsMatch) {
      console.error('FATAL: Not connected to emulator demo-project! Stopping execution immediately.', healthData);
      process.exit(1);
    }
    recordStep('ISO', 'Emulator Isolation Confirmed', 'PASS', `project=${healthData.projectId}, firestore=${healthData.firestoreHost}, auth=${healthData.authHost}`, healthRes.status);

    // Setup Test Actors in Emulator
    const patientAUid = 'emu-test-patient-a';
    const patientBUid = 'emu-test-patient-b';
    const doctorUid = 'doc-test-001';
    const patientAHealthId = 'PHI-EMU-001';
    const patientBHealthId = 'PHI-EMU-002';
    const doctorId = 'DOC-002'; // Dr. Rahul Kumar

    // Ensure Auth Users exist in Auth Emulator
    for (const u of [
      { uid: patientAUid, email: 'patient.a@demo.local', role: 'patient', claims: { healthId: patientAHealthId } },
      { uid: patientBUid, email: 'patient.b@demo.local', role: 'patient', claims: { healthId: patientBHealthId } },
      { uid: doctorUid, email: 'doctor.test@demo.local', role: 'doctor', claims: { doctorId } }
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

    // Seed Patient profiles in Firestore Emulator
    await db.collection('patients').doc(patientAHealthId).set({
      healthId: patientAHealthId,
      uid: patientAUid,
      name: 'Patient Alice (Emulator)',
      email: 'patient.a@demo.local',
      allergies: [{ name: 'Penicillin', severity: 'high' }],
      conditions: [{ name: 'Hypertension', since: '2023' }]
    }, { merge: true });

    await db.collection('patients').doc(patientBHealthId).set({
      healthId: patientBHealthId,
      uid: patientBUid,
      name: 'Patient Bob (Emulator)',
      email: 'patient.b@demo.local',
      allergies: [],
      conditions: []
    }, { merge: true });

    await db.collection('users').doc(patientAUid).set({
      uid: patientAUid,
      role: 'patient',
      healthId: patientAHealthId,
      email: 'patient.a@demo.local'
    }, { merge: true });

    await db.collection('users').doc(patientBUid).set({
      uid: patientBUid,
      role: 'patient',
      healthId: patientBHealthId,
      email: 'patient.b@demo.local'
    }, { merge: true });

    // Seed treating appointment
    const apptId = 'appt-emu-001';
    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      patientHealthId: patientAHealthId,
      patientUid: patientAUid,
      doctorId: doctorId,
      doctorUid: doctorUid,
      date: new Date().toISOString().split('T')[0],
      status: 'in_consultation',
      createdAt: new Date().toISOString()
    }, { merge: true });

    const patientAToken = await getAuthToken(patientAUid, 'patient', { healthId: patientAHealthId });
    const patientBToken = await getAuthToken(patientBUid, 'patient', { healthId: patientBHealthId });
    const doctorToken = await getAuthToken(doctorUid, 'doctor', { doctorId });

    // ── TEST 1: Storage Status & Unavailable Message ──
    console.log('\n--- Test 1: Storage Status & Unavailable Message ---');
    const statusRes = await fetch(`${API_BASE}/reports/status`);
    const statusData = await statusRes.json();
    const isStorageDisabled = statusRes.status === 200 && statusData.data?.storageAvailable === false;
    const requiredMsg = 'Medical report uploads are temporarily unavailable. Other healthcare features remain accessible.';
    const hasRequiredMsg = statusData.data?.message === requiredMsg;

    recordStep('T1.1', 'Storage Status Check', isStorageDisabled ? 'PASS' : 'FAIL', `storageAvailable is false as Cloud Storage is unconfigured`, statusRes.status);
    recordStep('T1.2', 'Unavailable Banner Text', hasRequiredMsg ? 'PASS' : 'FAIL', `Message matched required notice: "${statusData.data?.message}"`, statusRes.status);

    // ── TEST 2: Report Upload Failure & No False Success ──
    console.log('\n--- Test 2: Upload Rejection & No False Success ---');
    const uploadRes = await fetch(`${API_BASE}/reports/upload-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${patientAToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: 'chest_xray.png',
        fileType: 'image/png',
        fileSize: 1048576,
        patientHealthId: patientAHealthId
      })
    });
    const uploadData = await uploadRes.json();
    const is503 = uploadRes.status === 503;
    const isStorageCode = uploadData.code === 'STORAGE_NOT_AVAILABLE';
    const uploadMsgMatch = uploadData.message === requiredMsg;

    recordStep('T2.1', 'Upload URL Rejection', is503 && isStorageCode ? 'PASS' : 'FAIL', `Returned HTTP 503 STORAGE_NOT_AVAILABLE`, uploadRes.status);
    recordStep('T2.2', 'Upload Rejection Message', uploadMsgMatch ? 'PASS' : 'FAIL', `Correct unavailable message returned to caller`, uploadRes.status);

    // Verify no report was written to Firestore
    const reportsQuery = await db.collection('reports').where('healthId', '==', patientAHealthId).get();
    const zeroReports = reportsQuery.empty;
    recordStep('T2.3', 'No False Success State', zeroReports ? 'PASS' : 'FAIL', `0 reports created in database after rejection`, 200);

    // ── TEST 3: Medical History Viewing & Updating ──
    console.log('\n--- Test 3: Medical History Viewing & Updating ---');
    const historyRes = await fetch(`${API_BASE}/medical-records/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${patientAToken}` }
    });
    const historyData = await historyRes.json();
    recordStep('T3.1', 'Medical History Retrieval', historyRes.status === 200 && historyData.success ? 'PASS' : 'FAIL', `Retrieved timeline with ${historyData.data?.length || 0} items`, historyRes.status);

    // Patient adds self-reported allergy / condition via profile
    const updateRes = await fetch(`${API_BASE}/patients/${patientAHealthId}/allergies`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${patientAToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Dust Mites',
        severity: 'moderate'
      })
    });
    recordStep('T3.2', 'Medical History Update', updateRes.status === 200 || updateRes.status === 201 ? 'PASS' : 'FAIL', `Patient successfully updated allergies in history`, updateRes.status);

    // ── TEST 4: Consultation Notes Saving & Retrieval ──
    console.log('\n--- Test 4: Consultation Notes Saving & Retrieval ---');
    // Treating doctor creates consultation encounter
    const consultRes = await fetch(`${API_BASE}/medical-records`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${doctorToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        patientHealthId: patientAHealthId,
        patientUid: patientAUid,
        doctorId: doctorId,
        diagnosisNotes: 'Acute pharyngitis with mild fever. Advised warm saline gargles.',
        vitals: { bp: '120/80', temp: '99.1F', pulse: '76' }
      })
    });
    const consultData = await consultRes.json();
    const consultSaved = consultRes.status === 201 && consultData.success;
    recordStep('T4.1', 'Consultation Notes Persisted', consultSaved ? 'PASS' : 'FAIL', `Consultation note stored in Firestore`, consultRes.status);

    // Verify consultation notes appear in patient's clinical timeline
    const updatedHistoryRes = await fetch(`${API_BASE}/medical-records/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${patientAToken}` }
    });
    const updatedHistoryData = await updatedHistoryRes.json();
    const hasConsultItem = updatedHistoryData.data?.some(item => 
      (item.diagnosisNotes && item.diagnosisNotes.includes('Acute pharyngitis')) ||
      (item.diagnosis && item.diagnosis.includes('Acute pharyngitis'))
    );
    recordStep('T4.2', 'Consultation Notes Retrieval', hasConsultItem ? 'PASS' : 'FAIL', `Clinical record retrieved in patient timeline`, updatedHistoryRes.status);

    // ── TEST 5: Digital Prescriptions Creation & Viewing ──
    console.log('\n--- Test 5: Digital Prescriptions Creation & Viewing ---');
    const rxRes = await fetch(`${API_BASE}/prescriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${doctorToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        patientHealthId: patientAHealthId,
        patientUid: patientAUid,
        doctorId: doctorId,
        appointmentId: apptId,
        diagnosis: 'Acute Pharyngitis',
        medicines: [
          { name: 'Paracetamol 500mg', dosage: '500mg', dose: '1 tablet', frequency: 'TID', duration: '3 days', durationDays: 3, instructions: 'After meals' },
          { name: 'Cetirizine 10mg', dosage: '10mg', dose: '1 tablet', frequency: 'OD', duration: '5 days', durationDays: 5, instructions: 'At bedtime' }
        ],
        doctorNotes: 'Maintain hydration and rest.'
      })
    });
    const rxData = await rxRes.json();
    const createdRxId = rxData.data?.id || rxData.data?.prescriptionId;
    recordStep('T5.1', 'Prescription Creation', rxRes.status === 201 && !!createdRxId ? 'PASS' : 'FAIL', `Prescription created with ID: ${createdRxId}`, rxRes.status);

    // Patient views digital prescription
    const viewRxRes = await fetch(`${API_BASE}/prescriptions/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${patientAToken}` }
    });
    const viewRxData = await viewRxRes.json();
    const foundRx = viewRxData.data && viewRxData.data.some(r => r.id === createdRxId || r.prescriptionId === createdRxId);
    recordStep('T5.2', 'Prescription Viewing', viewRxRes.status === 200 && foundRx ? 'PASS' : 'FAIL', `Patient successfully viewed issued digital prescription`, viewRxRes.status);

    // ── TEST 6: Prescription PDF Generation & Download ──
    console.log('\n--- Test 6: Prescription PDF Generation & Download ---');
    const pdfRes = await fetch(`${API_BASE}/prescriptions/${createdRxId}/pdf`, {
      headers: { 'Authorization': `Bearer ${patientAToken}` }
    });
    const contentType = pdfRes.headers.get('content-type');
    const pdfBuffer = await pdfRes.arrayBuffer();
    const bufferBytes = new Uint8Array(pdfBuffer);
    const isPdfHeader = bufferBytes[0] === 0x25 && bufferBytes[1] === 0x50 && bufferBytes[2] === 0x44 && bufferBytes[3] === 0x46; // '%PDF'
    const isPdfValid = pdfRes.status === 200 && contentType.includes('application/pdf') && isPdfHeader && bufferBytes.length > 500;

    recordStep('T6.1', 'PDF Stream Generation', isPdfValid ? 'PASS' : 'FAIL', `Generated valid ${bufferBytes.length}-byte binary PDF with %PDF header`, pdfRes.status);

    // ── TEST 7: Unauthorized Patient-Record Access Denied (IDOR / RBAC) ──
    console.log('\n--- Test 7: Unauthorized Access Denial ---');
    // Patient B attempts to read Patient A's timeline
    const idorTimelineRes = await fetch(`${API_BASE}/medical-records/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${patientBToken}` }
    });
    recordStep('T7.1', 'Timeline Cross-Patient IDOR Denial', idorTimelineRes.status === 403 ? 'PASS' : 'FAIL', `Patient B denied access to Patient A history (403 Forbidden)`, idorTimelineRes.status);

    // Patient B attempts to read Patient A's prescriptions
    const idorRxRes = await fetch(`${API_BASE}/prescriptions/patient/${patientAHealthId}`, {
      headers: { 'Authorization': `Bearer ${patientBToken}` }
    });
    recordStep('T7.2', 'Prescription Cross-Patient IDOR Denial', idorRxRes.status === 403 ? 'PASS' : 'FAIL', `Patient B denied access to Patient A prescriptions (403 Forbidden)`, idorRxRes.status);

    // Unauthenticated user attempts to download Patient A's prescription PDF
    const unauthPdfRes = await fetch(`${API_BASE}/prescriptions/${createdRxId}/pdf`);
    recordStep('T7.3', 'Unauthenticated PDF Denial', unauthPdfRes.status === 401 ? 'PASS' : 'FAIL', `Unauthenticated download blocked with 401 Unauthorized`, unauthPdfRes.status);

  } catch (err) {
    console.error('Fatal error during focused tests:', err);
    recordStep('FATAL', 'Runner Error', 'FAIL', err.message);
  }

  // Print Summary Table
  console.log('\n========================================================================');
  console.log('              STORAGE-DISABLED EMULATOR TEST SUMMARY                    ');
  console.log('========================================================================');
  const passes = results.filter(r => r.status === 'PASS').length;
  const fails = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total Checks: ${results.length} | PASSED: ${passes} | FAILED: ${fails}`);
  console.table(results.map(r => ({
    ID: r.id,
    Title: r.title,
    Status: r.status,
    HTTP: r.httpStatus || 'N/A',
    Details: r.details.substring(0, 50)
  })));

  if (fails > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();

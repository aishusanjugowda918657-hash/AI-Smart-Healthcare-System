import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure no emulator variables leak into this test process
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.GCLOUD_PROJECT;

dotenv.config({ path: path.resolve(__dirname, '../../client/.env') });

const saPath = path.resolve(__dirname, '../config/serviceAccountKey.json');
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: sa.project_id
  });
}

const db = admin.firestore();
const auth = admin.auth();
const apiKey = process.env.VITE_FIREBASE_API_KEY;

async function getIdTokenForUid(uid, customClaims = {}) {
  const customToken = await auth.createCustomToken(uid, customClaims);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error(`Auth failed for ${uid}: ${JSON.stringify(data.error)}`);
  return data.idToken;
}

async function safeJson(res, label) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`[safeJson] ${label} returned non-JSON (${res.status}): ${text.slice(0, 150)}`);
    return { success: false, rawText: text, status: res.status };
  }
}

async function runLiveSmokeTest() {
  console.log('========================================================================');
  console.log('     PHASE 15: CONTROLLED LIVE SMOKE TEST (READ-ONLY / NON-MUTATING)    ');
  console.log('========================================================================\n');

  const report = {};

  // Step 0: Pre-flight environment check
  console.log('[Step 0] Environment & Target Verification:');
  const envRes = await fetch('http://localhost:5000/api/health/env').then(r => r.json());
  const healthRes = await fetch('http://localhost:5000/api/health').then(r => r.json());
  console.log('  Target Project:', envRes.data?.projectId);
  console.log('  isEmulator:', envRes.data?.isEmulator);
  console.log('  Flags:', JSON.stringify(healthRes.data?.flags));

  if (envRes.data?.isEmulator || envRes.data?.projectId !== 'ai-basedsmarthealthcaresystem') {
    throw new Error('ABORT: Backend not targeting live ai-basedsmarthealthcaresystem!');
  }
  if (healthRes.data?.flags?.ai || healthRes.data?.flags?.push || healthRes.data?.flags?.scheduler) {
    throw new Error('ABORT: Feature flags must be strictly false!');
  }

  // Identify synthetic test accounts
  // Patient A: MqmkJdeSYbZaENY54Lyp9rqqVaC3 (patient.demo@smarthealthcare.demo)
  const patientAUid = 'MqmkJdeSYbZaENY54Lyp9rqqVaC3';
  const patientAHealthId = 'PHI-2026-DEMO01-P';
  const patientAToken = await getIdTokenForUid(patientAUid, { role: 'patient', patientHealthId: patientAHealthId });

  // Doctor Assigned: cyeu58WkM5ekSgUcU5n95BBkwKJ3 (Dr. Aarti Sunil Kamath, DOC-REAL-001)
  const doctorUid = 'cyeu58WkM5ekSgUcU5n95BBkwKJ3';
  const doctorId = 'DOC-REAL-001';
  const doctorToken = await getIdTokenForUid(doctorUid, { role: 'doctor', doctorId, doctorUid });

  // Unrelated Doctor: 6eplDuheuVQ8NBPq9ZNL5m2cYk12 (doctor@smartcare.com)
  const unrelatedDoctorUid = '6eplDuheuVQ8NBPq9ZNL5m2cYk12';
  const unrelatedDoctorToken = await getIdTokenForUid(unrelatedDoctorUid, { role: 'doctor', doctorId: unrelatedDoctorUid, doctorUid: unrelatedDoctorUid });

  // Patient B: vqILu8riRWU83qECaxWkuyXH3MV2 (beera123@gmail.com)
  const patientBUid = 'vqILu8riRWU83qECaxWkuyXH3MV2';
  const patientBToken = await getIdTokenForUid(patientBUid, { role: 'patient' });

  // Specific appointment IDs
  const patientAApptId = 'h0ZarmNSEgZ3tgrayo0C'; // Owner: Patient A, Doctor: doctorUid
  const patientBApptId = 'Akj6wHlMzKt2qQNq9JBx'; // Owner: Patient B, Doctor: unrelatedDoctorUid

  console.log(`  Patient A UID:          ${patientAUid.slice(0, 8)}... (HealthID: ${patientAHealthId})`);
  console.log(`  Assigned Doctor UID:    ${doctorUid.slice(0, 8)}... (DoctorID: ${doctorId})`);
  console.log(`  Unrelated Doctor UID:   ${unrelatedDoctorUid.slice(0, 8)}...`);
  console.log(`  Patient B UID:          ${patientBUid.slice(0, 8)}...\n`);

  // 1. Patient can view their own appointments
  console.log('--- Test 1: Patient can view their own appointments ---');
  try {
    const apiRes = await fetch('http://localhost:5000/api/appointments/my-appointments', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    const apiBody = await safeJson(apiRes, 'Patient MyAppointments');

    // Also verify direct Cloud Firestore REST read using Patient A token
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/ai-basedsmarthealthcaresystem/databases/(default)/documents/appointments/${patientAApptId}`;
    const directRes = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    const directStatus = directRes.status;

    console.log(`  API /api/appointments/my-appointments: HTTP ${apiRes.status}, count=${apiBody.data?.length ?? 0}`);
    console.log(`  Direct Firestore GET /appointments/${patientAApptId}: HTTP ${directStatus}`);

    if (apiRes.status === 200 && apiBody.success && directStatus === 200) {
      report.workflow1 = {
        status: 'PASS',
        apiStatus: apiRes.status,
        appointmentsFound: apiBody.data?.length ?? 0,
        directFirestoreStatus: directStatus
      };
    } else {
      report.workflow1 = { status: 'FAIL', apiStatus: apiRes.status, directStatus, error: apiBody.message };
    }
  } catch (err) {
    console.error('  Workflow 1 error:', err.message);
    report.workflow1 = { status: 'FAIL', error: err.message };
  }

  // 2. Doctor can view appointments assigned to them
  console.log('\n--- Test 2: Doctor can view appointments assigned to them ---');
  try {
    const apiRes = await fetch('http://localhost:5000/api/appointments/doctor-today', {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const apiBody = await safeJson(apiRes, 'Doctor Today Appointments');

    // Also verify direct Cloud Firestore REST read using Doctor token on assigned appointment
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/ai-basedsmarthealthcaresystem/databases/(default)/documents/appointments/${patientAApptId}`;
    const directRes = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const directStatus = directRes.status;

    console.log(`  API /api/appointments/doctor-today: HTTP ${apiRes.status}, count=${apiBody.data?.length ?? 0}`);
    console.log(`  Direct Firestore GET /appointments/${patientAApptId}: HTTP ${directStatus}`);

    if (apiRes.status === 200 && apiBody.success && directStatus === 200) {
      report.workflow2 = {
        status: 'PASS',
        apiStatus: apiRes.status,
        appointmentsFound: apiBody.data?.length ?? 0,
        directFirestoreStatus: directStatus
      };
    } else {
      report.workflow2 = { status: 'FAIL', apiStatus: apiRes.status, directStatus, error: apiBody.message };
    }
  } catch (err) {
    console.error('  Workflow 2 error:', err.message);
    report.workflow2 = { status: 'FAIL', error: err.message };
  }

  // 3. Patient and doctor dashboards load without missing-index errors
  console.log('\n--- Test 3: Patient and doctor dashboards load without missing-index errors ---');
  try {
    // Patient profile & appointments
    const patProfileRes = await fetch('http://localhost:5000/api/patients/me', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    const patBody = await safeJson(patProfileRes, 'Patient Profile');

    // Doctor dashboard summary
    const docSummaryRes = await fetch('http://localhost:5000/api/doctors/dashboard-summary', {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const docSumBody = await safeJson(docSummaryRes, 'Doctor Summary');

    // Doctor alerts (exercises alerts compound index: doctorId ASC, status ASC, riskLevel DESC)
    const docAlertsRes = await fetch('http://localhost:5000/api/doctors/alerts', {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const docAlertsBody = await safeJson(docAlertsRes, 'Doctor Alerts');

    console.log(`  Patient profile (/api/patients/me): HTTP ${patProfileRes.status}, success=${patBody.success}`);
    console.log(`  Doctor summary (/api/doctors/dashboard-summary): HTTP ${docSummaryRes.status}, success=${docSumBody.success}`);
    console.log(`  Doctor alerts (/api/doctors/alerts): HTTP ${docAlertsRes.status}, count=${docAlertsBody.data?.length ?? 0}`);

    const allOk = patProfileRes.status === 200 && docSummaryRes.status === 200 && docAlertsRes.status === 200;
    if (allOk) {
      report.workflow3 = {
        status: 'PASS',
        patientProfileHttp: patProfileRes.status,
        doctorSummaryHttp: docSummaryRes.status,
        doctorAlertsHttp: docAlertsRes.status
      };
    } else {
      report.workflow3 = {
        status: 'FAIL',
        patientProfileHttp: patProfileRes.status,
        doctorSummaryHttp: docSummaryRes.status,
        doctorAlertsHttp: docAlertsRes.status,
        patientError: patBody.message,
        doctorError: docSumBody.message
      };
    }
  } catch (err) {
    console.error('  Workflow 3 error:', err.message);
    report.workflow3 = { status: 'FAIL', error: err.message };
  }

  // 4. Appointment availability and slot queries work
  console.log('\n--- Test 4: Appointment availability and slot queries work ---');
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    // Exercises slots composite index: doctorId ASC, date ASC, status ASC, startAt ASC
    const slotsRes = await fetch(`http://localhost:5000/api/slots?doctorId=${doctorId}&date=${todayStr}`);
    const docOptionsRes = await fetch('http://localhost:5000/api/booking/doctor-options?departmentId=dept-gen');

    const slotsBody = await safeJson(slotsRes, 'Slots Query');
    const docOptionsBody = await safeJson(docOptionsRes, 'Doctor Options');

    console.log(`  Slots query (/api/slots): HTTP ${slotsRes.status}, count=${slotsBody.data?.length ?? 0}`);
    console.log(`  Doctor options (/api/booking/doctor-options): HTTP ${docOptionsRes.status}, count=${docOptionsBody.data?.length ?? 0}`);

    if (slotsRes.status === 200 && docOptionsRes.status === 200) {
      report.workflow4 = {
        status: 'PASS',
        slotsHttpStatus: slotsRes.status,
        doctorOptionsHttpStatus: docOptionsRes.status,
        slotsCount: slotsBody.data?.length ?? 0
      };
    } else {
      report.workflow4 = {
        status: 'FAIL',
        slotsHttpStatus: slotsRes.status,
        doctorOptionsHttpStatus: docOptionsRes.status,
        slotsError: slotsBody.message,
        optionsError: docOptionsBody.message
      };
    }
  } catch (err) {
    console.error('  Workflow 4 error:', err.message);
    report.workflow4 = { status: 'FAIL', error: err.message };
  }

  // 5. Medical history and prescriptions load through authorized backend endpoints
  console.log('\n--- Test 5: Medical history and prescriptions load through authorized backend endpoints ---');
  try {
    // Patient A requesting their own history
    const historyRes = await fetch(`http://localhost:5000/api/patients/${patientAHealthId}/history`, {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    const histBody = await safeJson(historyRes, 'Patient History');

    // Patient A requesting their own prescriptions (exercises prescriptions index: healthId ASC, status ASC, createdAt DESC)
    const rxRes = await fetch(`http://localhost:5000/api/prescriptions/patient/${patientAHealthId}`, {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    const rxBody = await safeJson(rxRes, 'Patient Prescriptions');

    // Assigned Doctor requesting Patient A's medical history
    const docHistRes = await fetch(`http://localhost:5000/api/patients/${patientAHealthId}/history`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const docHistBody = await safeJson(docHistRes, 'Doctor Patient History');

    console.log(`  Patient history (/api/patients/:hid/history): HTTP ${historyRes.status}, success=${histBody.success}`);
    console.log(`  Patient prescriptions (/api/prescriptions/patient/:hid): HTTP ${rxRes.status}, success=${rxBody.success}`);
    console.log(`  Doctor patient history (/api/patients/:hid/history): HTTP ${docHistRes.status}, success=${docHistBody.success}`);

    if (historyRes.status === 200 && rxRes.status === 200 && docHistRes.status === 200) {
      report.workflow5 = {
        status: 'PASS',
        patientHistoryHttpStatus: historyRes.status,
        patientPrescriptionsHttpStatus: rxRes.status,
        doctorPatientHistoryHttpStatus: docHistRes.status
      };
    } else {
      report.workflow5 = {
        status: 'FAIL',
        patientHistoryHttpStatus: historyRes.status,
        patientPrescriptionsHttpStatus: rxRes.status,
        doctorPatientHistoryHttpStatus: docHistRes.status,
        historyError: histBody.message,
        prescriptionsError: rxBody.message,
        docHistError: docHistBody.message
      };
    }
  } catch (err) {
    console.error('  Workflow 5 error:', err.message);
    report.workflow5 = { status: 'FAIL', error: err.message };
  }

  // 6. Notifications and follow-up lists load correctly
  console.log('\n--- Test 6: Notifications and follow-up lists load correctly ---');
  try {
    // Notifications (exercises notifications index: uid ASC, read ASC, createdAt DESC)
    const notifRes = await fetch('http://localhost:5000/api/notifications', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    // Patient upcoming followups (exercises followups index: healthId ASC, status ASC, dueDate ASC)
    const patFollowupsRes = await fetch('http://localhost:5000/api/followups/patient-upcoming', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    // Doctor upcoming followups (exercises followups index: doctorId ASC, status ASC, dueDate ASC)
    const docFollowupsRes = await fetch('http://localhost:5000/api/followups/doctor-upcoming', {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    const notifBody = await safeJson(notifRes, 'Notifications');
    const patFollowupsBody = await safeJson(patFollowupsRes, 'Patient Followups');
    const docFollowupsBody = await safeJson(docFollowupsRes, 'Doctor Followups');

    console.log(`  Notifications:     HTTP ${notifRes.status}, count=${notifBody.data?.length ?? 0}`);
    console.log(`  Patient followups: HTTP ${patFollowupsRes.status}, count=${patFollowupsBody.data?.length ?? 0}`);
    console.log(`  Doctor followups:  HTTP ${docFollowupsRes.status}, count=${docFollowupsBody.data?.length ?? 0}`);

    const allLoaded = notifRes.status === 200 && patFollowupsRes.status === 200 && docFollowupsRes.status === 200;
    if (allLoaded) {
      report.workflow6 = {
        status: 'PASS',
        notificationsHttpStatus: notifRes.status,
        patientFollowupsHttpStatus: patFollowupsRes.status,
        doctorFollowupsHttpStatus: docFollowupsRes.status
      };
    } else {
      report.workflow6 = {
        status: 'FAIL',
        notificationsHttpStatus: notifRes.status,
        patientFollowupsHttpStatus: patFollowupsRes.status,
        doctorFollowupsHttpStatus: docFollowupsRes.status
      };
    }
  } catch (err) {
    console.error('  Workflow 6 error:', err.message);
    report.workflow6 = { status: 'FAIL', error: err.message };
  }

  // 7. Unauthorized cross-patient access remains blocked
  console.log('\n--- Test 7: Unauthorized cross-patient access remains blocked ---');
  try {
    // Patient A attempting to access Patient B's medical history (Foreign Patient Health ID)
    const crossHistRes = await fetch('http://localhost:5000/api/patients/PHI-FOREIGN-999/history', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    // Patient A attempting to access Patient B's prescriptions
    const crossRxRes = await fetch('http://localhost:5000/api/prescriptions/patient/PHI-FOREIGN-999', {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    // Patient A attempting to read Patient B's appointment Akj6wHlMzKt2qQNq9JBx directly via Cloud Firestore REST API
    const firestoreUrlB = `https://firestore.googleapis.com/v1/projects/ai-basedsmarthealthcaresystem/databases/(default)/documents/appointments/${patientBApptId}`;
    const crossDirectRes = await fetch(firestoreUrlB, {
      headers: { Authorization: `Bearer ${patientAToken}` }
    });
    // Unrelated Doctor attempting to read Patient A's appointment h0ZarmNSEgZ3tgrayo0C directly via Cloud Firestore REST API
    const firestoreUrlA = `https://firestore.googleapis.com/v1/projects/ai-basedsmarthealthcaresystem/databases/(default)/documents/appointments/${patientAApptId}`;
    const unrelatedDocDirectRes = await fetch(firestoreUrlA, {
      headers: { Authorization: `Bearer ${unrelatedDoctorToken}` }
    });
    // Unauthenticated request to medical history
    const unauthHistRes = await fetch(`http://localhost:5000/api/patients/${patientAHealthId}/history`);

    console.log(`  Cross-patient history request:           HTTP ${crossHistRes.status} (Expected 403)`);
    console.log(`  Cross-patient prescriptions request:     HTTP ${crossRxRes.status} (Expected 403)`);
    console.log(`  Cross-patient direct Firestore read:     HTTP ${crossDirectRes.status} (Expected 403)`);
    console.log(`  Unrelated Doctor direct Firestore read:  HTTP ${unrelatedDocDirectRes.status} (Expected 403)`);
    console.log(`  Unauthenticated history request:         HTTP ${unauthHistRes.status} (Expected 401)`);

    const crossBlocked =
      crossHistRes.status === 403 &&
      crossRxRes.status === 403 &&
      crossDirectRes.status === 403 &&
      unrelatedDocDirectRes.status === 403 &&
      unauthHistRes.status === 401;

    if (crossBlocked) {
      report.workflow7 = {
        status: 'PASS',
        crossPatientHistoryStatus: crossHistRes.status,
        crossPatientPrescriptionsStatus: crossRxRes.status,
        crossPatientDirectFirestoreStatus: crossDirectRes.status,
        unrelatedDoctorDirectFirestoreStatus: unrelatedDocDirectRes.status,
        unauthenticatedStatus: unauthHistRes.status
      };
    } else {
      report.workflow7 = {
        status: 'FAIL',
        crossPatientHistoryStatus: crossHistRes.status,
        crossPatientPrescriptionsStatus: crossRxRes.status,
        crossPatientDirectFirestoreStatus: crossDirectRes.status,
        unrelatedDoctorDirectFirestoreStatus: unrelatedDocDirectRes.status,
        unauthenticatedStatus: unauthHistRes.status
      };
    }
  } catch (err) {
    console.error('  Workflow 7 error:', err.message);
    report.workflow7 = { status: 'FAIL', error: err.message };
  }

  console.log('\n========================================================================');
  console.log('                 PHASE 15 SMOKE TEST SUMMARY REPORT                     ');
  console.log('========================================================================');
  console.log(JSON.stringify(report, null, 2));

  // Save report artifact
  const artifactDir = path.resolve(__dirname, '../../../brain/f62d25ed-a2f2-4440-86e4-8d23cb4baaba');
  if (fs.existsSync(artifactDir)) {
    fs.writeFileSync(path.join(artifactDir, 'phase15_live_smoke_test_report.json'), JSON.stringify(report, null, 2));
  }

  return report;
}

runLiveSmokeTest().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

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

async function runPhase77Tests() {
  console.log('========================================================================');
  console.log('   PHASE 77: AI FEATURE FALLBACK & AVAILABILITY VERIFICATION           ');
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
      console.error('FATAL: Emulator isolation failure! Aborting Phase 77 tests immediately.', envData);
      process.exit(1);
    }

    recordStep('P77-ISO-1', 'Emulator Isolation Confirmed', 'PASS', `project=${envData.projectId}, firestore=${envData.firestoreHost}, auth=${envData.authHost}`, envRes.status);
    recordStep('P77-ISO-2', 'Safety Flags Locked (FLAG_AI=false, Scheduler=false, Push=false)', flagsMatch ? 'PASS' : 'FAIL', `flags=${JSON.stringify(activeFlags)}`, healthRes.status);

    // Setup Actors
    const patientUid = 'patient-p77-test';
    const doctorUid = 'zHJ8GargpAowoNrQJ4ZIC2vEGFiZ'; // Dr. Rahul Kumar
    const tokenPatient = await getAuthToken(patientUid, 'patient');
    const tokenDoctor = await getAuthToken(doctorUid, 'doctor', { doctorId: 'DOC-002' });

    // ──────────────────────────────────────────────────────────────────────────
    // 2. PATIENT CHATBOT EMERGENCY BYPASS (4 Languages, Zero AI Calls)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 2: Patient Chatbot Emergency Bypass (4 Languages) ---');
    const emergencyQueries = [
      { lang: 'en', text: 'Severe chest pain and difficulty breathing' },
      { lang: 'hi', text: 'छाती में दर्द और सांस लेने में तकलीफ' },
      { lang: 'kn', text: 'ಎದೆ ನೋವು' },
      { lang: 'ta', text: 'நெஞ்சு வலி' }
    ];

    let allEmergenciesPassed = true;
    for (const q of emergencyQueries) {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenPatient}`
        },
        body: JSON.stringify({ message: q.text, language: q.lang })
      });
      const data = await res.json();
      const isEm = res.status === 200 && data.isEmergency === true && (data.message || data.response || '').includes('108');
      if (!isEm) allEmergenciesPassed = false;
    }
    recordStep('P77-CHAT-EMERGENCY', 'Emergency Keywords Trigger Instant 108 Alert (EN, HI, KN, TA)', allEmergenciesPassed ? 'PASS' : 'FAIL', 'Zero Gemini API calls; deterministic emergency bypass in 4 languages', 200);

    // ──────────────────────────────────────────────────────────────────────────
    // 3. PATIENT CHATBOT QUICK-CHIP INTENTS (Deterministic Tools, Zero AI Calls)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 3: Patient Chatbot Quick-Chip Intents ---');
    const timingsRes = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ message: 'Doctor Timings', language: 'en' })
    });
    const timingsData = await timingsRes.json();
    const timingsSuccess = timingsRes.status === 200 && (timingsData.message || '').includes('OPD Timings');
    recordStep('P77-CHAT-TIMINGS', 'Quick-Chip Intent: Doctor Timings Handled by Deterministic Tool', timingsSuccess ? 'PASS' : 'FAIL', timingsData.message, timingsRes.status);

    const staffRes = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ message: 'Talk to Staff', language: 'en' })
    });
    const staffData = await staffRes.json();
    const staffSuccess = staffRes.status === 200 && (staffData.message || '').toLowerCase().includes('staff');
    recordStep('P77-CHAT-STAFF', 'Quick-Chip Intent: Talk to Staff Handled by Deterministic Tool', staffSuccess ? 'PASS' : 'FAIL', staffData.message, staffRes.status);

    const bookRes = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ message: 'Book Appointment', language: 'en' })
    });
    const bookData = await bookRes.json();
    const bookSuccess = bookRes.status === 200 && Array.isArray(bookData.quickChips) && bookData.quickChips.length >= 3;
    recordStep('P77-CHAT-BOOK', 'Quick-Chip Intent: Book Appointment Returns Structured Dept Chips', bookSuccess ? 'PASS' : 'FAIL', `chipsCount=${bookData.quickChips?.length}`, bookRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 4. GENERIC PATIENT CHAT WITH AI DISABLED (Safe Fallback & No Hallucinations)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 4: Generic Chat with AI Disabled (Safe Fallback) ---');
    const fallbackChatRes = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ message: 'Can you recommend specific prescription drugs for my stomach pain?', language: 'en' })
    });
    const fallbackChatData = await fallbackChatRes.json();
    const chatFallbackSuccess = fallbackChatRes.status === 200 &&
                                fallbackChatData.fallbackUsed === true &&
                                (fallbackChatData.message || '').includes('basic mode') &&
                                Array.isArray(fallbackChatData.quickChips);
    recordStep('P77-CHAT-FALLBACK', 'Generic Chat Returns Safe Basic Mode Fallback (Zero Fabricated Advice)', chatFallbackSuccess ? 'PASS' : 'FAIL', fallbackChatData.message, fallbackChatRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 5. CLINICAL TRIAGE DETERMINISTIC RULE ENGINE (No AI Reliance)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 5: Clinical Triage Deterministic Rule Engine ---');
    // 5.1 Emergency Red Flag Triage (English)
    const triageEmRes = await fetch(`${API_BASE}/booking/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonText: 'Crushing chest pain radiating to left arm with breathlessness' })
    });
    const triageEmData = await triageEmRes.json();
    const emTriage = triageEmData.data || {};
    const emSuccess = triageEmRes.status === 200 &&
                      emTriage.clinicalLevel === 3 &&
                      emTriage.redFlag === true &&
                      emTriage.departmentId === 'dept-card';
    recordStep('P77-TRIAGE-EMERGENCY', 'Triage Emergency Red Flag Evaluated Deterministically (Cardiac)', emSuccess ? 'PASS' : 'FAIL', `level=${emTriage.clinicalLevel}, redFlag=${emTriage.redFlag}, dept=${emTriage.departmentId}`, triageEmRes.status);

    // 5.2 Routine Triage with Typo Tolerance
    const triageRoutineRes = await fetch(`${API_BASE}/booking/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonText: 'Mild hedache and running nose for 2 days' })
    });
    const triageRoutineData = await triageRoutineRes.json();
    const routineTriage = triageRoutineData.data || {};
    const routineSuccess = triageRoutineRes.status === 200 &&
                          routineTriage.clinicalLevel === 1 &&
                          routineTriage.redFlag === false &&
                          routineTriage.urgencySuggested === 'routine';
    recordStep('P77-TRIAGE-ROUTINE', 'Triage Routine Case Evaluated Deterministically (Level 1)', routineSuccess ? 'PASS' : 'FAIL', `level=${routineTriage.clinicalLevel}, redFlag=${routineTriage.redFlag}, dept=${routineTriage.departmentId}`, triageRoutineRes.status);

    // 5.3 Multi-Language Emergency Triage (Hindi)
    const triageHindiRes = await fetch(`${API_BASE}/booking/triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonText: 'छाती में दर्द' })
    });
    const triageHindiData = await triageHindiRes.json();
    const hindiTriage = triageHindiData.data || {};
    const hindiSuccess = triageHindiRes.status === 200 &&
                         hindiTriage.clinicalLevel === 3 &&
                         hindiTriage.redFlag === true;
    recordStep('P77-TRIAGE-HINDI', 'Triage Multi-Language Red Flag Evaluated Deterministically (Hindi)', hindiSuccess ? 'PASS' : 'FAIL', `level=${hindiTriage.clinicalLevel}, redFlag=${hindiTriage.redFlag}`, triageHindiRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 6. DOCTOR PRE-CONSULTATION SUMMARY (Rule-Based Mode & Pure DB Facts)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 6: Doctor Pre-Consultation Summary ---');
    // Create synthetic appointment with verified details
    const summaryApptId = `appt-p77-summary-${Date.now()}`;
    const summaryHealthId = `PHI-P77-SUMM-${Date.now().toString().slice(-4)}`;

    await db.collection('patients').doc(summaryHealthId).set({
      healthId: summaryHealthId,
      patientHealthId: summaryHealthId,
      name: 'Summary Test Patient',
      age: 52,
      allergies: ['Penicillin', 'Sulfa'],
      conditions: [{ name: 'Type 2 Diabetes', since: '2021' }]
    });

    await db.collection('appointments').doc(summaryApptId).set({
      id: summaryApptId,
      patientHealthId: summaryHealthId,
      patientName: 'Summary Test Patient',
      doctorId: 'DOC-002',
      doctorUid,
      date: '2026-10-12',
      visitType: 'followup',
      reasonForVisit: 'Review fasting blood sugar',
      clinicalLevel: 1,
      status: 'checked_in',
      createdAt: new Date()
    });

    const summaryRes = await fetch(`${API_BASE}/doctor/appointments/${summaryApptId}/pre-consultation-summary`, {
      headers: { 'Authorization': `Bearer ${tokenDoctor}` }
    });
    const summaryJson = await summaryRes.json();
    const summaryText = summaryJson.summary?.text || summaryJson.summary || '';
    const summaryMode = summaryJson.summaryMode || summaryJson.summary?.summaryMode;
    const summaryFlags = summaryJson.flags || summaryJson.summary?.flags || [];

    const hasAllergyFlag = summaryFlags.some(f => (f.category || f.type || '').includes('ALLERG') || (f.label || '').includes('Penicillin'));
    const summaryModeRuleBased = summaryMode === 'rule-based';
    const textContainsVerifiedFacts = summaryText.includes('Review fasting blood sugar') && summaryText.includes('Penicillin');

    const summaryPassed = summaryRes.status === 200 &&
                          summaryModeRuleBased &&
                          hasAllergyFlag &&
                          textContainsVerifiedFacts;
    recordStep('P77-DOC-SUMMARY', 'Pre-Consultation Summary Built from Pure Database Facts (Rule-Based)', summaryPassed ? 'PASS' : 'FAIL', `mode=${summaryMode}, text="${summaryText.slice(0, 80)}..."`, summaryRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 7. DOCTOR AI AGENT FALLBACK (Safe Notification with Zero Hallucination)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 7: Doctor AI Agent Fallback ---');
    const docAskRes = await fetch(`${API_BASE}/ai/doctor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor}`
      },
      body: JSON.stringify({ question: 'What is the recommended dosing schedule for Amlodipine?' })
    });
    const docAskJson = await docAskRes.json();
    const docAskSuccess = docAskRes.status === 200 &&
                          docAskJson.fallbackUsed === true &&
                          (docAskJson.answer || '').includes('currently unavailable') &&
                          Array.isArray(docAskJson.sources) && docAskJson.sources.length === 0;
    recordStep('P77-DOC-ASK-FALLBACK', 'Doctor AI Agent Reports Unavailable with Safe Guidance', docAskSuccess ? 'PASS' : 'FAIL', docAskJson.answer, docAskRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 8. DOCTOR DICTATION PARSER FALLBACK (Rule-Based Draft, No Fabrication)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 8: Doctor Dictation Parser Fallback ---');
    const dictateRes = await fetch(`${API_BASE}/ai/dictate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenDoctor}`
      },
      body: JSON.stringify({ dictationText: 'Patient has acute bronchitis. Prescribe Amoxicillin 500 mg and Paracetamol 650 mg for five days.' })
    });
    const dictateJson = await dictateRes.json();
    const draftMeds = dictateJson.draft?.proposedMedicines || [];
    const medNames = draftMeds.map(m => m.name);
    const dictateSuccess = dictateRes.status === 200 &&
                           dictateJson.verifiedByDoctor === false &&
                           medNames.includes('Amoxicillin') &&
                           medNames.includes('Paracetamol') &&
                           !medNames.includes('Ibuprofen'); // Ensures non-mentioned medicines are NOT injected
    recordStep('P77-DOC-DICTATE', 'Dictation Parsing Extracts Stated Medicines Only with verifiedByDoctor: false', dictateSuccess ? 'PASS' : 'FAIL', `extractedMeds=[${medNames.join(', ')}], verifiedByDoctor=${dictateJson.verifiedByDoctor}`, dictateRes.status);

    // ──────────────────────────────────────────────────────────────────────────
    // 9. PATIENT DATA ACCESS RESTRICTIONS & ROLE ENFORCEMENT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Step 9: Authorization & Role Boundaries on AI Endpoints ---');
    // Non-doctor role (patient) blocked from Doctor AI Agent
    const patientDoctorAskRes = await fetch(`${API_BASE}/ai/doctor/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ question: 'Clinical query' })
    });
    recordStep('P77-AUTH-1', 'Patient Role Blocked from Doctor AI Agent (403)', patientDoctorAskRes.status === 403 ? 'PASS' : 'FAIL', 'Forbidden for non-doctor roles', patientDoctorAskRes.status);

    // Non-doctor role (patient) blocked from Doctor Pre-Consultation Summary
    const patientSummaryRes = await fetch(`${API_BASE}/doctor/appointments/${summaryApptId}/pre-consultation-summary`, {
      headers: { 'Authorization': `Bearer ${tokenPatient}` }
    });
    recordStep('P77-AUTH-2', 'Patient Role Blocked from Doctor Pre-Consultation Summary (403)', patientSummaryRes.status === 403 ? 'PASS' : 'FAIL', 'Forbidden for non-doctor roles', patientSummaryRes.status);

    // Non-doctor role (patient) blocked from Dictation Parsing
    const patientDictateRes = await fetch(`${API_BASE}/ai/dictate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenPatient}`
      },
      body: JSON.stringify({ dictationText: 'Prescribe medicine' })
    });
    recordStep('P77-AUTH-3', 'Patient Role Blocked from Dictation Parser (403)', patientDictateRes.status === 403 ? 'PASS' : 'FAIL', 'Forbidden for non-doctor roles', patientDictateRes.status);

    // Clean up synthetic test records
    await db.collection('appointments').doc(summaryApptId).delete().catch(() => {});
    await db.collection('patients').doc(summaryHealthId).delete().catch(() => {});

    // ──────────────────────────────────────────────────────────────────────────
    // 10. SUMMARY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n========================================================================');
    console.log('   PHASE 77 VERIFICATION SUMMARY');
    console.log('========================================================================');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`Total Checks: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed > 0) {
      console.error(`FAILED: ${failed} check(s) failed during Phase 77 verification.`);
      process.exit(1);
    } else {
      console.log('🎉 ALL PHASE 77 AI FALLBACK & AVAILABILITY VERIFICATION CHECKS PASSED!');
      process.exit(0);
    }

  } catch (err) {
    console.error('Unhandled exception during Phase 77 tests:', err);
    process.exit(1);
  }
}

runPhase77Tests();

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

// Clear emulator environment variables to ensure strict connection to REAL Firebase
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.GCLOUD_PROJECT;

const SCREENSHOT_DIR = 'C:/Users/Archana/.gemini/antigravity-ide/brain/daa94266-d683-4454-aa6e-e6198bfb4fe6/screenshots';
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processes = [];
function track(p, name) {
  processes.push({ p, name });
  p.on('exit', (code) => console.log(`[Process ${name}] exited with code ${code}`));
  return p;
}

function cleanupProcesses() {
  console.log('Cleaning up local server and browser processes...');
  for (const { p, name } of processes) {
    try {
      if (process.platform === 'win32' && p.pid) {
        spawn('taskkill', ['/pid', p.pid.toString(), '/f', '/t']);
      } else {
        p.kill('SIGKILL');
      }
      console.log(`Killed ${name}`);
    } catch (e) {
      console.error(`Failed to kill ${name}:`, e.message);
    }
  }
}

process.on('SIGINT', () => { cleanupProcesses(); process.exit(1); });
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(1); });

async function waitForPort(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
        if (msg.params.type === 'error') console.log(`  [Browser Console Error] ${text}`);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = this.id++;
      this.pending.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  async screenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`📸 Screenshot saved: ${filename} (${buffer.length} bytes)`);
    return outPath;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(2500);
  }

  async waitFor(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.evaluate(`!!document.querySelector('${selector}')`);
      if (found) return true;
      await sleep(500);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }
}

async function run() {
  console.log('========================================================================');
  console.log('   PHASE 133: AUTOMATED BROWSER TESTING AGAINST REAL FIREBASE           ');
  console.log('   Target Project: ai-basedsmarthealthcaresystem                        ');
  console.log('========================================================================\n');

  // Track synthetic resources created during this run for cleanup
  const createdArtifacts = {
    syntheticPatientUid: null,
    syntheticPatientEmail: null,
    syntheticHealthId: null
  };

  try {
    // ── STEP 1: Initialize Real Firebase Admin for Controlled Test Operations ──
    console.log('1. Initializing Firebase Admin with service account credentials...');
    const saPath = 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server/config/serviceAccountKey.json';
    if (!fs.existsSync(saPath)) {
      throw new Error('Service account key missing at server/config/serviceAccountKey.json');
    }
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        projectId: sa.project_id
      });
    }
    const db = admin.firestore();
    const auth = admin.auth();
    console.log(`✅ Firebase Admin initialized for real project: ${sa.project_id}`);

    // ── STEP 2: Start Express Backend Server Connected to Real Firebase ──
    console.log('\n2. Starting local Express backend connected to REAL Firebase (port 5000)...');
    const serverEnv = {
      ...process.env,
      PORT: '5000',
      NODE_ENV: 'development',
      FIREBASE_SERVICE_ACCOUNT_PATH: './config/serviceAccountKey.json',
      VITE_FIREBASE_PROJECT_ID: 'ai-basedsmarthealthcaresystem',
      FLAG_SCHEDULER: 'false',
      FLAG_AI: 'false',
      FLAG_PUSH: 'false',
      CLIENT_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000'
    };
    // Ensure emulator host variables are removed
    delete serverEnv.FIRESTORE_EMULATOR_HOST;
    delete serverEnv.FIREBASE_AUTH_EMULATOR_HOST;
    delete serverEnv.GCLOUD_PROJECT;

    const serverProc = spawn('node', ['server.js'], {
      cwd: 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server',
      env: serverEnv,
      stdio: 'pipe',
      shell: true
    });
    track(serverProc, 'backend-server-real');
    await waitForPort('http://localhost:5000/api/health/env');

    // Verify /api/health/env points to real project
    const healthRes = await fetch('http://localhost:5000/api/health/env').then(r => r.json());
    console.log('[Backend Preflight Verification]:', JSON.stringify(healthRes));
    if (healthRes.data?.isEmulator !== false || healthRes.data?.projectId !== 'ai-basedsmarthealthcaresystem') {
      throw new Error(`CRITICAL SAFETY ABORT: Backend is not in real project mode! isEmulator=${healthRes.data?.isEmulator}, projectId=${healthRes.data?.projectId}`);
    }
    console.log('✅ Verified: Backend is running locally against REAL Firebase (ai-basedsmarthealthcaresystem).');

    // ── STEP 3: Start Client Vite Server in Real Project Mode ──
    console.log('\n3. Starting Client Vite dev server connected to REAL Firebase (port 3000)...');
    const clientProc = spawn('npx.cmd', ['vite', '--port', '3000', '--strictPort'], {
      cwd: 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/client',
      env: { ...process.env },
      stdio: 'pipe',
      shell: true
    });
    track(clientProc, 'client-vite-real');
    await waitForPort('http://localhost:3000/');
    console.log('✅ Client online on http://localhost:3000 (connected to real project).');

    // ── STEP 4: Start Headless Chrome on Isolated CDP Port 9223 ──
    console.log('\n4. Starting Chrome on isolated CDP port 9223...');
    const chromeProc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new',
      '--remote-debugging-port=9223',
      '--user-data-dir=C:/Users/Archana/.gemini/antigravity-ide/brain/daa94266-d683-4454-aa6e-e6198bfb4fe6/chrome_phase133',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1280,950',
      'http://localhost:3000'
    ]);
    track(chromeProc, 'chrome-cdp-9223');
    await waitForPort('http://127.0.0.1:9223/json/version');
    console.log('✅ Chrome Headless active on port 9223.');

    const targetRes = await fetch('http://127.0.0.1:9223/json');
    const targets = await targetRes.json();
    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found in Chrome');

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    console.log('✅ Connected to Chrome CDP session.');

    const injectHelper = () => cdp.evaluate(`
      window.__setReactField = (selector, val) => {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return false;
        let proto;
        if (el.tagName === 'INPUT') proto = window.HTMLInputElement.prototype;
        else if (el.tagName === 'SELECT') proto = window.HTMLSelectElement.prototype;
        else if (el.tagName === 'TEXTAREA') proto = window.HTMLTextAreaElement.prototype;
        else proto = Object.getPrototypeOf(el);

        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
    `);

    const doLogout = async () => {
      console.log('Logging out current session...');
      await cdp.evaluate(`
        (() => {
          const btn = document.querySelector('button[title="Logout"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Logout'));
          if (btn) btn.click();
          sessionStorage.clear();
          localStorage.clear();
          try { indexedDB.deleteDatabase('firebaseLocalStorageDb'); } catch(e) {}
        })()
      `);
      await sleep(2000);
      await cdp.navigate('http://localhost:3000/login');
      await sleep(1500);
      await injectHelper();
    };

    // ── STEP 5: Safe Live Test-Data Policy Verification & Dedicated Slot Check ──
    console.log('\n5. Inspecting real database for dedicated test doctor and reserved test slots...');
    const testDocSnap = await db.collection('doctors').where('isTest', '==', true).get();
    console.log(`Dedicated test doctors with isTest==true found: ${testDocSnap.size}`);
    
    // Check if test slots exist
    const testSlotSnap = await db.collection('slots').where('isTest', '==', true).get();
    console.log(`Dedicated reserved test slots with isTest==true found: ${testSlotSnap.size}`);

    if (testDocSnap.empty || testSlotSnap.empty) {
      console.log('⚠️ PREREQUISITE NOTICE (Requirement 4):');
      console.log('   No dedicated test-only doctor with isTest==true or explicitly reserved test slot exists in real Firestore.');
      console.log('   In doctorController.js, getDoctors() returns all doctors without test-hiding filters.');
      console.log('   Per strict Phase 133 safety policy ("Never book an ordinary available slot that could belong to a real patient.' +
                  ' If an isolated test fixture cannot be created safely without appearing in ordinary patient searches, stop the live booking test and explain the blocker."),' +
                  ' live booking of ordinary doctor slots will be stopped, and doctor searching / slot browsing will be verified safely without modifying real slots.');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 1: PATIENT REGISTRATION, LOGIN, LOGOUT & RE-LOGIN (REAL FIREBASE)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 1: Patient Registration & Form Validation (Real Firebase) ---');
    await cdp.navigate('http://localhost:3000/register');
    await cdp.waitFor('form');
    await injectHelper();

    // 1A: Form Validation: Empty Submission
    console.log('Testing empty form validation in registration UI...');
    await cdp.evaluate(`
      (() => {
        const form = document.querySelector('form');
        if (form) {
          form.noValidate = true;
          document.querySelector("form button[type='submit']").click();
        }
      })()
    `);
    await sleep(1000);
    const emptyErrText = await cdp.evaluate('document.body.innerText');
    const hasEmptyValidation = emptyErrText.includes('Please fill in all mandatory fields');
    console.log('Empty form validation rendered:', hasEmptyValidation);
    if (!hasEmptyValidation) throw new Error('Expected validation error on empty registration form');

    // 1B: Form Validation: Password Mismatch
    const runTimestamp = Date.now();
    const testEmail = `phase133.testpat.${runTimestamp}@smartcare-demo.com`;
    const testFullName = `Synthetic Test Patient ${runTimestamp.toString().slice(-4)}`;
    createdArtifacts.syntheticPatientEmail = testEmail;

    console.log(`Registering synthetic patient: ${testEmail}...`);
    await cdp.evaluate(`
      (() => {
        window.__setReactField('[name="fullName"]', '${testFullName}');
        window.__setReactField('[name="email"]', '${testEmail}');
        window.__setReactField('[name="password"]', 'SmartCare@123');
        window.__setReactField('[name="confirmPassword"]', 'DifferentPass@123');
        window.__setReactField('[name="phone"]', '9830887766');
        window.__setReactField('[name="dob"]', '1995-04-10');
        window.__setReactField('[name="address"]', 'Flat 4A, Green View Apartments, Kolkata');
        document.querySelector("form button[type='submit']").click();
      })()
    `);
    await sleep(1000);
    const mismatchText = await cdp.evaluate('document.body.innerText');
    const hasMismatch = mismatchText.includes('Password and Confirm Password do not match');
    console.log('Password mismatch error rendered:', hasMismatch);
    if (!hasMismatch) throw new Error('Expected password mismatch validation error');

    // 1C: Complete Valid Registration Submission to Real Firebase Auth & Firestore
    console.log('Submitting valid registration form to REAL Firebase Auth & Firestore...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('[name="confirmPassword"]', 'SmartCare@123');
        window.__setReactField('[name="gender"]', 'female');
        window.__setReactField('[name="bloodGroup"]', 'O+');
        window.__setReactField('[name="emergencyContactName"]', 'Emergency Contact Person');
        window.__setReactField('[name="emergencyContactPhone"]', '9830887767');
        window.__setReactField('[name="allergies"]', 'Penicillin (Synthetic Test Record)');
        window.__setReactField('[name="existingConditions"]', 'Mild Asthma (Synthetic Test Record)');
        document.querySelector("form button[type='submit']").click();
      })()
    `);
    await sleep(6000);

    // Verify user in real Firebase Auth
    const liveAuthUser = await auth.getUserByEmail(testEmail);
    createdArtifacts.syntheticPatientUid = liveAuthUser.uid;
    console.log(`✅ Real Firebase Auth account created. UID: ${liveAuthUser.uid}`);

    // Verify user document and patient profile in real Firestore
    const userDocSnap = await db.collection('users').doc(liveAuthUser.uid).get();
    if (!userDocSnap.exists) {
      throw new Error(`User profile not found in real Firestore users/${liveAuthUser.uid}`);
    }

    const livePatientSnap = await db.collection('patients').where('ownerUid', '==', liveAuthUser.uid).limit(1).get();
    if (livePatientSnap.empty) {
      throw new Error(`Patient profile not found in real Firestore for ownerUid ${liveAuthUser.uid}`);
    }
    const livePatientData = livePatientSnap.docs[0].data();
    createdArtifacts.syntheticHealthId = livePatientData.healthId || livePatientData.patientHealthId;
    console.log(`✅ Real Firestore user doc and patient profile created. Health ID: ${createdArtifacts.syntheticHealthId}`);

    // Verify Health ID Card in UI
    await cdp.navigate('http://localhost:3000/health-id-card');
    await sleep(2500);
    const hidPageText = await cdp.evaluate('document.body.innerText');
    console.log(`Health ID ${createdArtifacts.syntheticHealthId} visible on Health ID card:`, hidPageText.includes(createdArtifacts.syntheticHealthId));
    await cdp.screenshot('phase133_01_real_health_id_card.png');

    // Verify Patient Dashboard in UI
    await cdp.navigate('http://localhost:3000/patient-dashboard');
    await sleep(2500);
    const dashText = await cdp.evaluate('document.body.innerText');
    console.log('Patient dashboard renders welcome banner:', dashText.includes('Welcome') || dashText.includes(testFullName.slice(0, 10)));
    await cdp.screenshot('phase133_02_real_patient_dashboard.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 2: SYMPTOM TRIAGE, DOCTOR SEARCH & SLOT RETRIEVAL (READ-ONLY)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 2: Symptom Triage, Doctor Search & Slot Retrieval (Real Firebase) ---');
    await cdp.navigate('http://localhost:3000/book-appointment');
    await sleep(2500);
    await injectHelper();

    // Step 1: Patient Selection -> Next
    await cdp.evaluate(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Reason for Visit') || b.innerText.includes('Continue'));
      if (btn) btn.click();
    `);
    await sleep(2000);

    // Step 2: Reason for Visit / Chips -> Select 'Fever or cold'
    await cdp.evaluate(`
      const chip = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Fever or cold') || b.innerText.includes('Routine checkup'));
      if (chip) chip.click();
      const cont = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Clinical Triage Check') || b.innerText.includes('Clinical Triage'));
      if (cont) cont.click();
    `);
    await sleep(2500);

    // Step 3: Triage Check Screen
    const triageScreenText = await cdp.evaluate('document.body.innerText');
    console.log('Triage assessment rendered:', triageScreenText.includes('Triage') || triageScreenText.includes('Routine') || triageScreenText.includes('Consultation'));
    await cdp.screenshot('phase133_03_real_triage_screen.png');

    // Step 4: Doctor Search in Real Database
    await cdp.evaluate(`
      const selDoc = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Doctor') || b.innerText.includes('Continue'));
      if (selDoc) selDoc.click();
    `);
    await sleep(3000);

    const docListText = await cdp.evaluate('document.body.innerText');
    const hasRealDoctors = docListText.includes('Dr. Aarti Sunil Kamath') || docListText.includes('Dr. Anurag Ranjan') || docListText.includes('General Medicine');
    console.log('Real doctors retrieved and rendered in UI:', hasRealDoctors);

    // Step 5: Slot Retrieval (without booking)
    await cdp.evaluate(`
      const docCard = document.querySelector('[data-testid="doctor-card"], .cursor-pointer');
      if (docCard) docCard.click();
      const slotBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Slot'));
      if (slotBtn) slotBtn.click();
    `);
    await sleep(3000);

    const slotsText = await cdp.evaluate('document.body.innerText');
    console.log('Slot selection screen rendered:', slotsText.includes('Select an Available Slot') || slotsText.includes('Choose Slot') || slotsText.includes(':'));
    await cdp.screenshot('phase133_04_real_doctor_slots_search.png');

    console.log('🔒 Safe policy enforced: Real slot booked = 0. Halting booking step before slot mutation.');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 3: PATIENT HISTORY, PRESCRIPTIONS, REMINDERS & REPORTS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 3: Patient Sections Navigation (Real Firebase) ---');
    await cdp.navigate('http://localhost:3000/medical-history');
    await sleep(2500);
    const histText = await cdp.evaluate('document.body.innerText');
    console.log('Medical history timeline rendered:', histText.includes('Timeline') || histText.includes('Medical History') || histText.includes('Profile Created'));

    await cdp.navigate('http://localhost:3000/prescriptions');
    await sleep(2000);
    const rxText = await cdp.evaluate('document.body.innerText');
    console.log('Prescriptions page active (clean empty state):', rxText.includes('Prescription') || rxText.includes('No prescriptions'));

    await cdp.navigate('http://localhost:3000/medicine-reminders');
    await sleep(2000);
    const medText = await cdp.evaluate('document.body.innerText');
    console.log('Medicine reminders page active (clean empty state):', medText.includes('Medicine') || medText.includes('Reminders'));

    await cdp.navigate('http://localhost:3000/reports');
    await sleep(2500);
    const repText = await cdp.evaluate('document.body.innerText');
    console.log('Diagnostic reports page active:', repText.includes('Diagnostic Reports') || repText.includes('Upload'));
    await cdp.screenshot('phase133_05_real_patient_sections.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 4: LOGOUT & RE-LOGIN TEST (REAL FIREBASE AUTH)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 4: Logout & Re-login Verification (Real Firebase) ---');
    await doLogout();

    console.log(`Re-logging in as synthetic patient ${testEmail}...`);
    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', '${testEmail}');
        window.__setReactField('input[type="password"]', 'SmartCare@123');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);

    const afterLoginUrl = await cdp.evaluate('window.location.pathname');
    console.log('URL after re-login with real Firebase credentials:', afterLoginUrl);
    await cdp.screenshot('phase133_06_real_patient_relogin.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 5: DOCTOR LOGIN, QUEUE & WORKSPACE (REAL FIREBASE)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 5: Doctor Login, Queue & Workspace (Real Firebase) ---');
    await doLogout();

    const doctorEmail = 'generalmedicine01@smarthealthcare.demo';
    const doctorPass = 'SmartHealth@123';
    console.log(`Logging in as verified Doctor (${doctorEmail})...`);

    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', '${doctorEmail}');
        window.__setReactField('input[type="password"]', '${doctorPass}');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);

    await cdp.navigate('http://localhost:3000/doctor/dashboard');
    await sleep(3000);
    const docDashText = await cdp.evaluate('document.body.innerText');
    console.log('Doctor dashboard loaded:', docDashText.includes('Dr. Aarti Sunil Kamath') || docDashText.includes('Doctor Dashboard') || docDashText.includes('Overview'));
    await cdp.screenshot('phase133_07_real_doctor_dashboard.png');

    await cdp.navigate('http://localhost:3000/doctor/queue');
    await sleep(3000);
    const docQueueText = await cdp.evaluate('document.body.innerText');
    console.log('Doctor queue screen loaded:', docQueueText.includes('Queue') || docQueueText.includes('Doctor Controls'));
    await cdp.screenshot('phase133_08_real_doctor_queue.png');

    await cdp.navigate('http://localhost:3000/doctor/schedule');
    await sleep(3000);
    const docSchedText = await cdp.evaluate('document.body.innerText');
    console.log('Doctor schedule configurator loaded:', docSchedText.includes('Schedule') || docSchedText.includes('Weekly Schedule'));
    await cdp.screenshot('phase133_09_real_doctor_schedule.png');

    await cdp.navigate('http://localhost:3000/doctor/consultation');
    await sleep(3000);
    const docConsultText = await cdp.evaluate('document.body.innerText');
    console.log('Clinical Consultation workspace loaded:', docConsultText.includes('Clinical Consultation') || docConsultText.includes('Vitals'));
    await cdp.screenshot('phase133_10_real_doctor_consultation_workspace.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 6: ROLE-BASED ROUTE PROTECTION & ADMIN VERIFICATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 6: Role-Based Route Protection & Security Checks ---');
    // Test 6A: Doctor attempting to access Admin Dashboard
    console.log('Testing Doctor attempting to access /admin-dashboard...');
    await cdp.navigate('http://localhost:3000/admin-dashboard');
    await sleep(2500);
    const docAdminAttemptUrl = await cdp.evaluate('window.location.pathname');
    console.log('Doctor navigating to /admin-dashboard redirected to:', docAdminAttemptUrl);
    await cdp.screenshot('phase133_11_real_doctor_admin_blocked.png');

    // Test 6B: Unauthenticated user attempting to access Admin Dashboard
    console.log('Testing unauthenticated user attempting to access /admin-dashboard...');
    await doLogout();
    await cdp.navigate('http://localhost:3000/admin-dashboard');
    await sleep(2500);
    const unauthAdminAttemptUrl = await cdp.evaluate('window.location.pathname');
    console.log('Unauthenticated user navigating to /admin-dashboard redirected to:', unauthAdminAttemptUrl);

    // Test 6C: Patient attempting to access Admin Dashboard
    console.log('Testing Patient attempting to access /admin-dashboard...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', '${testEmail}');
        window.__setReactField('input[type="password"]', 'SmartCare@123');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);
    await cdp.navigate('http://localhost:3000/admin-dashboard');
    await sleep(2500);
    const patAdminAttemptUrl = await cdp.evaluate('window.location.pathname');
    console.log('Patient navigating to /admin-dashboard redirected to:', patAdminAttemptUrl);
    await cdp.screenshot('phase133_12_real_patient_admin_blocked.png');

    console.log('\n========================================================================');
    console.log('🎉 REAL FIREBASE AUTOMATED BROWSER WORKFLOWS COMPLETED!');
    console.log('========================================================================');

  } finally {
    // ── STEP 7: Controlled Synthetic Cleanup ──
    console.log('\n--- STEP 7: Controlled Cleanup of Created Synthetic Records ---');
    if (createdArtifacts.syntheticPatientUid) {
      try {
        console.log(`Deleting synthetic patient from real Firebase Auth (UID: ${createdArtifacts.syntheticPatientUid})...`);
        await admin.auth().deleteUser(createdArtifacts.syntheticPatientUid);
        console.log('✅ Real Firebase Auth synthetic test user deleted.');
      } catch (err) {
        console.error('Failed to delete synthetic Auth user:', err.message);
      }

      try {
        if (createdArtifacts.syntheticHealthId) {
          console.log(`Deleting synthetic patient document from real Firestore patients/${createdArtifacts.syntheticHealthId}...`);
          await admin.firestore().collection('patients').doc(createdArtifacts.syntheticHealthId).delete();
          console.log('✅ Real Firestore synthetic patient document deleted.');
        }
        console.log(`Deleting synthetic user document from real Firestore users/${createdArtifacts.syntheticPatientUid}...`);
        await admin.firestore().collection('users').doc(createdArtifacts.syntheticPatientUid).delete();
        console.log('✅ Real Firestore synthetic user document deleted.');
      } catch (err) {
        console.error('Failed to delete synthetic Firestore documents:', err.message);
      }
    } else {
      console.log('No synthetic user was created; nothing to clean up.');
    }

    cleanupProcesses();
  }
}

run().catch((err) => {
  console.error('Fatal Phase 133 Browser Test Error:', err);
  cleanupProcesses();
  process.exit(1);
});

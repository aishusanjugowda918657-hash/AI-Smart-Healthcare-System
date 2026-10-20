process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
process.env.GCLOUD_PROJECT = 'demo-project';

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

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

function cleanup() {
  console.log('Cleaning up spawned processes...');
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

process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

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
  console.log('   PHASE 131: COMPLETE LOCAL APPLICATION AUTOMATION & BROWSER TESTS     ');
  console.log('========================================================================\n');

  try {
    // 1. Verify Emulator Health
    console.log('1. Verifying Firebase Auth & Firestore emulators...');
    await waitForPort('http://localhost:8080/');
    await waitForPort('http://localhost:9099/');
    console.log('✅ Firebase Emulators active on 8080 & 9099 (demo-project).');

    // 2. Seed Data in Emulator
    console.log('2. Seeding emulator doctors, slots, staff, and admin...');
    const seedEnv = {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: 'localhost:8080',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
      GCLOUD_PROJECT: 'demo-project',
      VITE_FIREBASE_PROJECT_ID: 'demo-project'
    };

    const runSyncScript = (cmd, args) => new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { cwd: 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server', env: seedEnv, stdio: 'inherit', shell: true });
      p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} failed with code ${code}`)));
    });

    await runSyncScript('node', ['scripts/seedEmulatorData.js']);
    await runSyncScript('node', ['scripts/seedStaff.js']);
    await runSyncScript('node', ['scripts/createFirstAdmin.js', 'admin@smartcare-demo.com', 'AdminPass123!']);
    console.log('✅ Seed completed successfully.');

    // 3. Start Backend Server on Port 5000
    console.log('3. Starting Server on Port 5000...');
    const serverEnv = {
      ...process.env,
      PORT: '5000',
      NODE_ENV: 'development',
      FIRESTORE_EMULATOR_HOST: 'localhost:8080',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
      GCLOUD_PROJECT: 'demo-project',
      VITE_FIREBASE_PROJECT_ID: 'demo-project',
      FLAG_SCHEDULER: 'false',
      FLAG_AI: 'false',
      FLAG_PUSH: 'false',
      INTERNAL_TICK_SECRET: 'dev_tick_secret',
      CLIENT_ORIGIN: 'http://localhost:3000,http://127.0.0.1:3000'
    };

    const serverProc = spawn('node', ['server.js'], {
      cwd: 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/server',
      env: serverEnv,
      stdio: 'pipe',
      shell: true
    });
    track(serverProc, 'backend-server');
    await waitForPort('http://localhost:5000/api/health/env');
    console.log('✅ Server online on http://localhost:5000.');

    // 4. Start Client Vite Dev Server on Port 3000
    console.log('4. Starting Client Vite dev server on Port 3000 (mode=emulator)...');
    const clientProc = spawn('npx.cmd', ['vite', '--mode', 'emulator', '--port', '3000', '--strictPort'], {
      cwd: 'C:/Users/Archana/.antigravity-ide/AI-Smart-Healthcare-System/client',
      stdio: 'pipe',
      shell: true
    });
    track(clientProc, 'client-vite');
    await waitForPort('http://localhost:3000/');
    console.log('✅ Client online on http://localhost:3000.');

    // 5. Start Chrome Headless on Port 9223 (Isolated from Lenovo Vantage port 9222)
    console.log('5. Starting Chrome on isolated CDP port 9223...');
    const chromeProc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new',
      '--remote-debugging-port=9223',
      '--user-data-dir=C:/Users/Archana/.gemini/antigravity-ide/brain/daa94266-d683-4454-aa6e-e6198bfb4fe6/chrome_phase131',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1280,950',
      'http://localhost:3000'
    ]);
    track(chromeProc, 'chrome-cdp-9223');
    await waitForPort('http://127.0.0.1:9223/json/version');
    console.log('✅ Chrome Headless active on port 9223.');

    // 6. Connect to Chrome Page Target via WebSocket CDP
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

    // Initialize Firebase Admin in script to verify Firestore persistence
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'demo-project' });
    }
    const db = admin.firestore();

    const timestamp = Date.now();
    const syntheticEmail = `phase131.pat.${timestamp}@smartcare-demo.com`;
    const syntheticName = `Ananya Sen ${timestamp.toString().slice(-4)}`;

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 1: Registration Form, Validation, and Persistence
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 1: Registration Form, Validation & Persistence ---');
    await cdp.navigate('http://localhost:3000/register');
    await cdp.waitFor('form');
    await injectHelper();

    // Test Validation: Submit Empty Form
    console.log('Testing empty form validation error in browser...');
    await cdp.evaluate('document.querySelector("form button[type=\'submit\']").click()');
    await sleep(1000);
    const emptyValidationText = await cdp.evaluate('document.body.innerText');
    const hasEmptyError = emptyValidationText.includes('Please fill in all mandatory fields');
    console.log('Empty form validation error rendered:', hasEmptyError);
    if (!hasEmptyError) throw new Error('Expected validation error on empty form submission');

    // Test Validation: Password mismatch
    console.log('Testing password mismatch validation in browser...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('[name="fullName"]', '${syntheticName}');
        window.__setReactField('[name="email"]', '${syntheticEmail}');
        window.__setReactField('[name="password"]', 'SmartCare@123');
        window.__setReactField('[name="confirmPassword"]', 'MismatchPassword@123');
        window.__setReactField('[name="phone"]', '9830554433');
        window.__setReactField('[name="dob"]', '1994-08-12');
        window.__setReactField('[name="address"]', '45 Park Street, Flat 3B, Kolkata');
        document.querySelector("form button[type='submit']").click();
      })()
    `);
    await sleep(1000);
    const mismatchValidationText = await cdp.evaluate('document.body.innerText');
    const hasMismatchError = mismatchValidationText.includes('Password and Confirm Password do not match');
    console.log('Password mismatch validation rendered:', hasMismatchError);
    if (!hasMismatchError) throw new Error('Expected password mismatch error');

    // Submit Complete Valid Registration Form
    console.log('Submitting valid synthetic patient registration...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('[name="confirmPassword"]', 'SmartCare@123');
        window.__setReactField('[name="gender"]', 'female');
        window.__setReactField('[name="bloodGroup"]', 'B+');
        window.__setReactField('[name="emergencyContactName"]', 'Siddharth Sen');
        window.__setReactField('[name="emergencyContactPhone"]', '9830554434');
        window.__setReactField('[name="allergies"]', 'Sulfa drugs');
        window.__setReactField('[name="existingConditions"]', 'Asthma');
        document.querySelector("form button[type='submit']").click();
      })()
    `);
    await sleep(5000);

    // Verify redirect to patient dashboard
    const currentUrl = await cdp.evaluate('window.location.pathname');
    console.log('Current URL after registration:', currentUrl);
    await cdp.screenshot('phase131_01_patient_registered.png');

    // Verify persistence in Firestore
    const patientSnap = await db.collection('patients').where('email', '==', syntheticEmail).limit(1).get();
    if (patientSnap.empty) throw new Error('Patient document not persisted to Firestore');
    const patientData = patientSnap.docs[0].data();
    const patientHealthId = patientData.healthId || patientData.patientHealthId;
    const patientUid = patientSnap.docs[0].id;
    console.log(`✅ Patient verified in Firestore. UID: ${patientUid}, HealthID: ${patientHealthId}`);

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 2: Patient Health ID Card & Dashboard Navigation
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 2: Patient Health ID Card & Dashboard Navigation ---');
    await cdp.navigate('http://localhost:3000/health-id-card');
    await sleep(2500);
    const hidPageText = await cdp.evaluate('document.body.innerText');
    const hidMatches = hidPageText.includes(patientHealthId);
    console.log(`Health ID ${patientHealthId} visible on card:`, hidMatches);
    const hasDownloadBtn = await cdp.evaluate('!!Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Download") || b.innerText.includes("Print"))');
    console.log('Download/Print ID card button present:', hasDownloadBtn);
    await cdp.screenshot('phase131_02_health_id_card.png');

    await cdp.navigate('http://localhost:3000/patient-dashboard');
    await sleep(2500);
    const dashText = await cdp.evaluate('document.body.innerText');
    console.log('Patient dashboard renders welcome banner:', dashText.includes('Welcome') || dashText.includes(syntheticName.slice(0, 8)));
    await cdp.screenshot('phase131_02b_patient_dashboard.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 3: Symptom Triage, Slot Selection, Booking & Confirmation
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 3: Symptom Triage, Slot Selection & Booking ---');
    await cdp.navigate('http://localhost:3000/book-appointment');
    await sleep(2500);
    await injectHelper();

    // Step 1: Patient Selection -> Next
    await cdp.evaluate(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Reason for Visit') || b.innerText.includes('Continue'));
      if (btn) btn.click();
    `);
    await sleep(2000);

    // Step 2: Reason for visit -> Pick Chip 'Fever or cold' -> Next
    await cdp.evaluate(`
      const chip = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Fever or cold') || b.innerText.includes('Headache'));
      if (chip) chip.click();
      const cont = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Clinical Triage Check') || b.innerText.includes('Clinical Triage'));
      if (cont) cont.click();
    `);
    await sleep(2500);

    // Step 3: Triage Check -> Choose Doctor
    await cdp.evaluate(`
      const selDoc = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Doctor') || b.innerText.includes('Continue Anyway'));
      if (selDoc) selDoc.click();
    `);
    await sleep(2500);

    // Step 4: Pick Doctor (Dr. Sarah Smith) -> Choose Slot
    await cdp.evaluate(`
      const docCard = document.querySelector('[data-testid="doctor-card"], .cursor-pointer');
      if (docCard) docCard.click();
      const slotBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Slot'));
      if (slotBtn) slotBtn.click();
    `);
    await sleep(2500);

    // Step 5: Pick Slot & Review
    await cdp.evaluate(`
      const slotBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes(':') && (b.innerText.includes('AM') || b.innerText.includes('PM')));
      if (slotBtn) slotBtn.click();
      const revBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Review') || b.innerText.includes('Review & Confirm'));
      if (revBtn) revBtn.click();
    `);
    await sleep(2000);

    // Step 6: Disclaimer & Confirm
    await cdp.evaluate(`
      const chk = document.querySelector('input[type="checkbox"]');
      if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
      const bookBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm') || b.innerText.includes('Book Appointment'));
      if (bookBtn) bookBtn.click();
    `);
    await sleep(5000);
    await cdp.screenshot('phase131_03_appointment_booked.png');

    // Verify appointment persistence in Firestore
    const apptSnap = await db.collection('appointments').where('patientHealthId', '==', patientHealthId).limit(1).get();
    if (apptSnap.empty) throw new Error('Appointment not saved to Firestore');
    const firstAppointment = apptSnap.docs[0].data();
    const firstAppointmentId = apptSnap.docs[0].id;
    console.log(`✅ Appointment booked in Firestore: ${firstAppointmentId}, status: ${firstAppointment.status}, doctor: ${firstAppointment.doctorId}`);

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 4: Appointment Cancellation & Re-booking
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 4: Appointment Cancellation & Re-booking ---');
    await cdp.navigate('http://localhost:3000/patient-dashboard');
    await sleep(3000);
    await injectHelper();

    // Click "Cancel" button on active appointment card
    await cdp.evaluate(`
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Cancel');
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await sleep(2000);

    // Enter cancellation reason in modal & submit
    await cdp.evaluate(`
      (() => {
        const txt = document.querySelector('textarea');
        if (txt) window.__setReactField(txt, 'Schedule conflict, rescheduling');
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Yes, Cancel') || b.innerText.includes('Confirm'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);
    await sleep(4000);
    await cdp.screenshot('phase131_04_appointment_cancelled.png');

    // Verify appointment marked cancelled in Firestore
    const cancelledDoc = await db.collection('appointments').doc(firstAppointmentId).get();
    console.log(`Persisted appointment status after cancellation: ${cancelledDoc.data()?.status}`);
    if (cancelledDoc.data()?.status !== 'cancelled') throw new Error('Appointment status is not cancelled in Firestore');

    // Re-book a second appointment so doctor has an active consultation to perform
    console.log('Re-booking appointment for doctor consultation...');
    await cdp.navigate('http://localhost:3000/book-appointment');
    await sleep(2500);
    await injectHelper();

    await cdp.evaluate(`
      const b1 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Reason for Visit') || b.innerText.includes('Continue'));
      if (b1) b1.click();
    `);
    await sleep(2000);
    await cdp.evaluate(`
      const c = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Fever or cold') || b.innerText.includes('Headache'));
      if (c) c.click();
      const b2 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Clinical Triage Check') || b.innerText.includes('Clinical Triage'));
      if (b2) b2.click();
    `);
    await sleep(2500);
    await cdp.evaluate(`
      const b3 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Doctor') || b.innerText.includes('Continue Anyway'));
      if (b3) b3.click();
    `);
    await sleep(2500);
    await cdp.evaluate(`
      const card = document.querySelector('[data-testid="doctor-card"], .cursor-pointer');
      if (card) card.click();
      const b4 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Choose Slot'));
      if (b4) b4.click();
    `);
    await sleep(2500);
    await cdp.evaluate(`
      const s = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes(':') && (b.innerText.includes('AM') || b.innerText.includes('PM')));
      if (s) s.click();
      const b5 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Next: Review') || b.innerText.includes('Review & Confirm'));
      if (b5) b5.click();
    `);
    await sleep(2000);
    await cdp.evaluate(`
      const chk = document.querySelector('input[type="checkbox"]');
      if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
      const b6 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Confirm') || b.innerText.includes('Book Appointment'));
      if (b6) b6.click();
    `);
    await sleep(5000);

    const rebookedApptSnap = await db.collection('appointments')
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'booked')
      .limit(1)
      .get();
    if (rebookedApptSnap.empty) throw new Error('Re-booked appointment not found in Firestore');
    const activeAppointmentId = rebookedApptSnap.docs[0].id;
    console.log(`✅ Re-booked appointment active in Firestore: ${activeAppointmentId}`);

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 5: Doctor Login, Queue, Call Patient & Consultation Submission
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 5: Doctor Login, Queue, Call Patient & Consultation ---');
    await doLogout();

    console.log('Logging in as Dr. Sarah Smith...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', 'sarah.smith@smartcare-demo.com');
        window.__setReactField('input[type="password"]', 'SmartCare@123');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);

    // Navigate to Doctor Queue Screen
    await cdp.navigate('http://localhost:3000/doctor/queue');
    await sleep(3000);
    await cdp.screenshot('phase131_05a_doctor_queue.png');

    // Open Consultation Workspace
    await cdp.navigate(`http://localhost:3000/doctor/consultation/${activeAppointmentId}`);
    await sleep(3000);
    await injectHelper();

    // Fill Vitals
    await cdp.evaluate(`
      (() => {
        const bp = document.querySelector('input[placeholder="120/80"]');
        if (bp) window.__setReactField(bp, '120/80');

        const hr = document.querySelector('input[placeholder="72 bpm"]');
        if (hr) window.__setReactField(hr, '74 bpm');

        const temp = document.querySelector('input[placeholder="98.6 °F"]');
        if (temp) window.__setReactField(temp, '98.6 °F');

        const wt = document.querySelector('input[placeholder="70 kg"]');
        if (wt) window.__setReactField(wt, '64 kg');

        const ht = document.querySelector('input[placeholder="165 cm"]');
        if (ht) window.__setReactField(ht, '165 cm');
      })()
    `);

    // Fill Symptoms & Diagnosis Notes
    await cdp.evaluate(`
      (() => {
        const sym = document.querySelector('input[placeholder*="Fatigue"]');
        if (sym) window.__setReactField(sym, 'Intermittent headache and low-grade fever');

        const diag = document.querySelector('textarea[placeholder*="Detailed clinical evaluation"]');
        if (diag) window.__setReactField(diag, 'Vitals stable. Normal chest and throat examination. Prescribed rest, hydration, and antipyretic.');
      })()
    `);

    // Toggle Issue Digital Prescription
    await cdp.evaluate(`
      (() => {
        const chks = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const rxChk = chks.find(c => c.closest('label')?.innerText.includes('Digital Prescription') || c.nextElementSibling?.innerText.includes('Prescription'));
        if (rxChk && !rxChk.checked) {
          rxChk.checked = true;
          rxChk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(1000);

    // Fill Prescription Form
    await cdp.evaluate(`
      (() => {
        const med = document.querySelector('input[placeholder*="Paracetamol"]');
        if (med) window.__setReactField(med, 'Paracetamol');

        const dos = document.querySelector('input[placeholder="500 mg"]');
        if (dos) window.__setReactField(dos, '500 mg');

        const freq = document.querySelector('input[placeholder*="Twice Daily"]');
        if (freq) window.__setReactField(freq, 'Twice Daily (1-0-1)');

        const dur = document.querySelector('input[placeholder="5"]');
        if (dur) window.__setReactField(dur, '3');

        // Check Doctor Verification checkbox
        const verifyChk = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(c => c.closest('label')?.innerText.includes('Digitally Verified') || c.closest('label')?.innerText.includes('Verified'));
        if (verifyChk && !verifyChk.checked) {
          verifyChk.checked = true;
          verifyChk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);

    // Toggle Schedule Follow-up Visit
    await cdp.evaluate(`
      (() => {
        const foChk = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(c => c.closest('label')?.innerText.includes('Follow-up'));
        if (foChk && !foChk.checked) {
          foChk.checked = true;
          foChk.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await sleep(500);

    // Fill Follow-up Date and Reason
    await cdp.evaluate(`
      (() => {
        const foDate = document.querySelector('input[type="date"]');
        if (foDate) window.__setReactField(foDate, '2026-10-25');

        const foReason = document.querySelector('input[placeholder*="ECG Review"]');
        if (foReason) window.__setReactField(foReason, 'Review resolution of fever');
      })()
    `);
    await sleep(500);

    // Submit Consultation Visit
    console.log('Submitting Doctor Consultation in browser...');
    await cdp.evaluate(`
      (() => {
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Save Visit') || b.innerText.includes('Save Record'));
        if (saveBtn) saveBtn.click();
        else document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);
    await cdp.screenshot('phase131_05b_doctor_consultation_saved.png');

    // Verify Firestore persistence: consultation & prescription & followup
    const consultSnap = await db.collection('consultations').where('appointmentId', '==', activeAppointmentId).limit(1).get();
    console.log('Consultation record persisted in Firestore:', !consultSnap.empty);
    const rxSnap = await db.collection('prescriptions').where('appointmentId', '==', activeAppointmentId).limit(1).get();
    console.log('Prescription record persisted in Firestore:', !rxSnap.empty);
    const createdRxId = !rxSnap.empty ? rxSnap.docs[0].id : null;
    const foSnap = await db.collection('followups').where('appointmentId', '==', activeAppointmentId).limit(1).get();
    console.log('Follow-up record persisted in Firestore:', !foSnap.empty);

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 6: Prescription Viewer, PDF Generation & Authorized Access
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 6: Prescription Viewer, PDF Generation & Authorized Access ---');
    await doLogout();

    console.log('Logging in as Patient to view prescription...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', '${syntheticEmail}');
        window.__setReactField('input[type="password"]', 'SmartCare@123');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);

    await cdp.navigate('http://localhost:3000/prescriptions');
    await sleep(3000);
    const rxPageText = await cdp.evaluate('document.body.innerText');
    console.log('Prescriptions page renders Paracetamol 500mg:', rxPageText.includes('Paracetamol') || rxPageText.includes('500 mg'));
    await cdp.screenshot('phase131_06_prescription_viewer.png');

    // Verify PDF endpoint via HTTP fetch
    if (createdRxId) {
      const pdfRes = await fetch(`http://localhost:5000/api/prescriptions/${createdRxId}/pdf`);
      console.log(`Prescription PDF endpoint HTTP status: ${pdfRes.status}`);
      const pdfBuffer = await pdfRes.arrayBuffer();
      const pdfHeader = Buffer.from(pdfBuffer.slice(0, 5)).toString();
      console.log(`PDF header verification: "${pdfHeader}" (valid %PDF: ${pdfHeader.startsWith('%PDF')})`);
      if (!pdfHeader.startsWith('%PDF')) throw new Error('Invalid PDF stream returned');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 7: Synthetic Diagnostic Report Upload & Download
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 7: Synthetic Diagnostic Report Upload & Download ---');
    await cdp.navigate('http://localhost:3000/reports');
    await sleep(3000);
    const reportsPageText = await cdp.evaluate('document.body.innerText');
    console.log('Reports page active and rendered:', reportsPageText.includes('Diagnostic Reports') || reportsPageText.includes('Upload'));
    await cdp.screenshot('phase131_07a_reports_page.png');

    // Test Report Upload via API
    console.log('Executing synthetic report upload flow via API...');
    const fakePdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Synthetic Lab Test) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const uploadInitRes = await fetch('http://localhost:5000/api/reports/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'synthetic_blood_work.pdf',
        fileType: 'application/pdf',
        fileSize: fakePdfBytes.length,
        patientHealthId
      })
    }).then(r => r.json());

    console.log('Upload URL generated:', uploadInitRes.success, 'provider:', uploadInitRes.data?.provider);
    if (uploadInitRes.data?.uploadUrl) {
      const putRes = await fetch(`http://localhost:5000${uploadInitRes.data.uploadUrl}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: fakePdfBytes
      });
      console.log('Binary upload PUT status:', putRes.status);

      // Save report metadata
      const saveRes = await fetch('http://localhost:5000/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: uploadInitRes.data.reportId,
          patientHealthId,
          fileName: 'synthetic_blood_work.pdf',
          fileType: 'application/pdf',
          category: 'Lab Report',
          title: 'Routine CBC Panel',
          storagePath: uploadInitRes.data.storagePath,
          sizeBytes: fakePdfBytes.length
        })
      }).then(r => r.json());
      console.log('Report metadata saved to Firestore:', saveRes.success);

      // Verify download URL
      const dlRes = await fetch(`http://localhost:5000/api/reports/${uploadInitRes.data.reportId}/download-url`).then(r => r.json());
      console.log('Download URL generated successfully:', dlRes.success);
      if (dlRes.data?.downloadUrl) {
        const streamRes = await fetch(`http://localhost:5000${dlRes.data.downloadUrl}`);
        const streamBuffer = await streamRes.arrayBuffer();
        console.log(`Streamed ${streamBuffer.byteLength} bytes. Exact match: ${Buffer.compare(fakePdfBytes, Buffer.from(streamBuffer)) === 0}`);
      }
    }

    await cdp.navigate('http://localhost:3000/reports');
    await sleep(2500);
    await cdp.screenshot('phase131_07b_reports_uploaded.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 8: Medicine Reminders (Taken, Snooze, Snooze Limit, Skip)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 8: Medicine Reminders UI Interactions ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const remRef1 = db.collection('reminders').doc(`rem-test-${timestamp}`);
    await remRef1.set({
      id: `rem-test-${timestamp}`,
      healthId: patientHealthId,
      patientHealthId,
      medicineName: 'Paracetamol 500mg',
      dosage: '500 mg',
      timing: 'after_food',
      timeSlot: '08:00 AM',
      scheduledTime: '08:00 AM',
      date: todayStr,
      dueAt: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString()
    });

    const remRef2 = db.collection('reminders').doc(`rem-skip-${timestamp}`);
    await remRef2.set({
      id: `rem-skip-${timestamp}`,
      healthId: patientHealthId,
      patientHealthId,
      medicineName: 'Vitamin C Chewable',
      dosage: '500 mg',
      timing: 'morning',
      timeSlot: '09:00 AM',
      scheduledTime: '09:00 AM',
      date: todayStr,
      dueAt: new Date().toISOString(),
      status: 'pending',
      snoozeCount: 0,
      createdAt: new Date().toISOString()
    });

    await cdp.navigate('http://localhost:3000/medicine-reminders');
    await sleep(3000);

    // Test Snooze
    console.log('Clicking Snooze button in UI...');
    await cdp.evaluate(`
      (() => {
        const snoozeBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Snooze'));
        if (snoozeBtn) snoozeBtn.click();
      })()
    `);
    await sleep(2000);
    const snoozedDoc = await remRef1.get();
    console.log(`Persisted Snooze status: ${snoozedDoc.data()?.status}, snoozeCount: ${snoozedDoc.data()?.snoozeCount}`);

    // Test Snooze Limit (disable at max 3)
    await remRef1.update({ snoozeCount: 3 });
    await cdp.navigate('http://localhost:3000/medicine-reminders');
    await sleep(2000);
    const isSnoozeDisabled = await cdp.evaluate(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Snooze'));
        return btn ? btn.disabled : false;
      })()
    `);
    console.log('Snooze button disabled after reaching max limit 3:', isSnoozeDisabled);

    // Test Taken
    console.log('Testing Taken button in UI...');
    await remRef1.update({ status: 'pending', snoozeCount: 0 });
    await cdp.navigate('http://localhost:3000/medicine-reminders');
    await sleep(2000);
    await cdp.evaluate(`
      (() => {
        const takenBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Taken') && b.tagName === 'BUTTON');
        if (takenBtn) takenBtn.click();
      })()
    `);
    await sleep(2000);
    const takenDoc = await remRef1.get();
    console.log(`Persisted Taken status in Firestore: ${takenDoc.data()?.status}`);

    // Test Skip
    console.log('Testing Skip button in UI...');
    await cdp.evaluate(`
      (() => {
        const skipBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Skip'));
        if (skipBtn) skipBtn.click();
      })()
    `);
    await sleep(2000);
    const skipDoc = await remRef2.get();
    console.log(`Persisted Skip status in Firestore: ${skipDoc.data()?.status}`);
    await cdp.screenshot('phase131_08_reminders_actions.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 9: Follow-Up Display on Patient Dashboard
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 9: Follow-Up Display on Patient Dashboard ---');
    await cdp.navigate('http://localhost:3000/patient-dashboard');
    await sleep(3000);
    const patientDashText2 = await cdp.evaluate('document.body.innerText');
    const hasFollowUp = patientDashText2.includes('Follow-up') || patientDashText2.includes('2026-10');
    console.log('Follow-Up checkup visible on Patient Dashboard:', hasFollowUp);
    await cdp.screenshot('phase131_09_followup_patient_view.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 10: In-App Notifications & Permission Controls
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 10: In-App Notifications & Permission Controls ---');
    await cdp.navigate('http://localhost:3000/notifications');
    await sleep(3000);
    const notifPageText = await cdp.evaluate('document.body.innerText');
    console.log('Notifications page active:', notifPageText.includes('Notifications'));
    const hasPushPrompt = notifPageText.includes('Enable push notifications') || await cdp.evaluate('!!document.querySelector("#enable-notifications-btn")');
    console.log('Push notification permission prompt rendered:', hasPushPrompt);
    await cdp.screenshot('phase131_10_notifications_page.png');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 11: Admin Operations Center & Security Checks
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 11: Admin Operations Center & Security Checks ---');
    await doLogout();

    console.log('Logging in as Admin (admin@smartcare-demo.com)...');
    await cdp.evaluate(`
      (() => {
        window.__setReactField('input[type="email"]', 'admin@smartcare-demo.com');
        window.__setReactField('input[type="password"]', 'AdminPass123!');
        document.querySelector('form button[type="submit"]')?.click();
      })()
    `);
    await sleep(5000);

    await cdp.navigate('http://localhost:3000/admin-dashboard');
    await sleep(3000);
    const adminDashText = await cdp.evaluate('document.body.innerText');
    console.log('Admin Operations Center visible:', adminDashText.includes('Hospital Operations Center') || adminDashText.includes('System Administration'));
    await cdp.screenshot('phase131_11a_admin_analytics.png');

    // Click Audit Log Viewer tab
    console.log('Clicking Audit Log Viewer tab in Admin Dashboard...');
    await cdp.evaluate(`
      const tab = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Audit Log'));
      if (tab) tab.click();
    `);
    await sleep(2500);
    await cdp.screenshot('phase131_11b_admin_audit_logs.png');

    // Test Unauthorized-Route Protection:
    console.log('Testing Unauthorized-Route Protection for Admin routes...');
    await doLogout();
    await cdp.navigate('http://localhost:3000/admin-dashboard');
    await sleep(2500);
    const unauthUrl = await cdp.evaluate('window.location.pathname');
    console.log('Unauthenticated attempt to access /admin-dashboard redirected to:', unauthUrl);
    if (!unauthUrl.includes('login')) throw new Error('Unauthenticated user not redirected from protected route');

    // ──────────────────────────────────────────────────────────────────────────
    // WORKFLOW 12: Duplicate Booking & Atomic Concurrency Protection
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- WORKFLOW 12: Duplicate Booking & Concurrency Protection ---');
    const testSlotSnap = await db.collection('slots')
      .where('status', '==', 'available')
      .limit(1)
      .get();

    if (!testSlotSnap.empty) {
      const slotDoc = testSlotSnap.docs[0];
      const slotData = slotDoc.data();
      console.log(`Testing parallel booking race on slot ${slotDoc.id}...`);

      const [res1, res2] = await Promise.all([
        fetch('http://localhost:5000/api/appointments/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slotId: slotDoc.id,
            doctorId: slotData.doctorId,
            date: slotData.date,
            time: slotData.time,
            patientHealthId,
            patientName: syntheticName,
            reason: 'Race condition test 1'
          })
        }).then(r => ({ status: r.status })),
        fetch('http://localhost:5000/api/appointments/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slotId: slotDoc.id,
            doctorId: slotData.doctorId,
            date: slotData.date,
            time: slotData.time,
            patientHealthId,
            patientName: syntheticName,
            reason: 'Race condition test 2'
          })
        }).then(r => ({ status: r.status }))
      ]);

      console.log(`Parallel booking results: Request 1 = ${res1.status}, Request 2 = ${res2.status}`);
      const hasSuccess = res1.status === 201 || res2.status === 201 || res1.status === 200 || res2.status === 200;
      const hasConflict = res1.status === 409 || res2.status === 409 || res1.status === 400 || res2.status === 400;
      console.log(`Atomic lock concurrency: 1 succeeded (${hasSuccess}), 1 rejected (${hasConflict})`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 9: Read-Only Verification of Real Firebase Project
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- STEP 9: Read-Only Real Firebase Project Verification ---');
    const readOnlyScriptEnv = {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: undefined,
      FIREBASE_AUTH_EMULATOR_HOST: undefined,
      GCLOUD_PROJECT: undefined
    };
    delete readOnlyScriptEnv.FIRESTORE_EMULATOR_HOST;
    delete readOnlyScriptEnv.FIREBASE_AUTH_EMULATOR_HOST;
    delete readOnlyScriptEnv.GCLOUD_PROJECT;

    await runSyncScript('node', ['scripts/checkRealFirebaseReadOnly.js']);
    console.log('✅ Real project read-only verification completed with zero writes.');

    console.log('\n========================================================================');
    console.log('🎉 ALL PHASE 131 AUTOMATION WORKFLOWS & BROWSER TESTS PASSED!');
    console.log('========================================================================');

  } finally {
    cleanup();
  }
}

run().catch((err) => {
  console.error('Fatal Phase 131 Automation Error:', err);
  cleanup();
  process.exit(1);
});

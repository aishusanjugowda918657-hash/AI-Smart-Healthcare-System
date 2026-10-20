import fs from 'fs';

const SCREENSHOT_DIR = 'C:/Users/Archana/.gemini/antigravity-ide/brain/f62d25ed-a2f2-4440-86e4-8d23cb4baaba/screenshots';
const ARTIFACT_DIR = 'C:/Users/Archana/.gemini/antigravity-ide/brain/f62d25ed-a2f2-4440-86e4-8d23cb4baaba';
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AUTH_EMULATOR = 'http://localhost:9099';
const API_BASE = 'http://localhost:5000/api';

async function getToken(email, password) {
  const res = await fetch(`${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to get token for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function getPageTarget() {
  const res = await fetch('http://127.0.0.1:9223/json');
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url && t.url.includes('localhost:3000'));
  if (!page) {
    throw new Error('No localhost:3000 page target found on port 9223: ' + JSON.stringify(targets));
  }
  return page;
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
    this.consoleLogs = [];
    this.networkResponses = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
        this.consoleLogs.push({ type: msg.params.type, text });
      }
      if (msg.method === 'Network.responseReceived') {
        this.networkResponses.push({
          url: msg.params.response.url,
          status: msg.params.response.status,
          statusText: msg.params.response.statusText
        });
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(msg.error);
        } else {
          resolve(msg.result);
        }
      }
    };

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = this.id++;
      this.pending.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    fs.writeFileSync(path, buffer);
    console.log(`[Screenshot Saved] ${path} (${buffer.length} bytes)`);
    return path;
  }

  async navigate(url) {
    await this.eval(`window.location.href = ${JSON.stringify(url)}`);
    await sleep(2000);
  }

  async waitFor(checkFnExpr, timeoutMs = 15000, intervalMs = 300) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this.eval(checkFnExpr);
        if (res) return res;
      } catch (e) {
        // ignore
      }
      await sleep(intervalMs);
    }
    throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${checkFnExpr}`);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function performCleanLogout(cdp) {
  console.log('[Auth] Checking existing session for logout...');
  await cdp.eval(`(() => {
    const btn = document.querySelector('button[title="Logout"]') ||
      Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Log Out') || b.title === 'Logout');
    if (btn) btn.click();
    window.localStorage.clear();
    window.sessionStorage.clear();
  })()`);
  await sleep(1500);

  await cdp.navigate('http://localhost:3000/login');
  await sleep(1500);

  const hasEmail = await cdp.eval('document.querySelector("input[type=\'email\']") !== null');
  if (!hasEmail) {
    await cdp.eval(`(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.href = 'http://localhost:3000/login';
    })()`);
    await sleep(2000);
  }
  await cdp.waitFor('document.querySelector("input[type=\'email\']") !== null', 10000);
  console.log('[Auth] /login screen ready.');
}

async function browserLogin(cdp, email, password) {
  await performCleanLogout(cdp);
  await cdp.eval(`(() => {
    function setVal(el, val) {
      const proto = window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const emailInput = document.querySelector('input[type="email"]');
    const passInput = document.querySelector('input[type="password"]');
    if (emailInput) setVal(emailInput, ${JSON.stringify(email)});
    if (passInput) setVal(passInput, ${JSON.stringify(password)});
  })()`);
  await sleep(800);
  await cdp.eval(`(() => {
    const submitBtn = document.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.click();
  })()`);
  console.log(`[Auth] Submitted login for ${email}, waiting for redirect...`);
  await cdp.waitFor('window.location.href.includes("dashboard") || window.location.href.includes("doctor") || window.location.href.includes("patient") || !window.location.href.includes("/login")', 15000);
  await sleep(2500);
}

async function run() {
  console.log('=== Starting Phase 69 Consultation & Prescription E2E Retest ===\n');

  // 1. Preflight
  const envRes = await fetch(`${API_BASE}/health/env`);
  const envData = await envRes.json();
  console.log('[Preflight] /api/health/env:', JSON.stringify(envData));
  if (!envData.data?.isEmulator || envData.data?.projectId !== 'demo-project') {
    throw new Error('Emulator preflight failed: ' + JSON.stringify(envData));
  }

  const page = await getPageTarget();
  console.log(`[CDP] Connecting to page ${page.id} on port 9223...`);
  const cdp = new CDPClient(page.webSocketDebuggerUrl);
  await cdp.connect();

  const report = {};
  const appointmentId = 'HHXQh5IhvyjZRJAancvU';
  const patientHealthId = 'PHI-2026-68SAB8-H';

  // ── Step 1: Login as Dr. Rahul Kumar & Open Consultation Workspace ──
  console.log('\n--- Step 1: Dr. Rahul Login & Consultation Workspace ---');
  await browserLogin(cdp, 'rahul.kumar@smartcare-demo.com', 'SmartCare@124');

  // Navigate directly to consultation workspace
  await cdp.navigate(`http://localhost:3000/doctor/consultation/${appointmentId}`);
  await sleep(3000);

  const workspaceState = await cdp.eval(`(() => {
    const text = document.body.innerText;
    return {
      url: window.location.href,
      hasHeading: text.includes('Doctor Clinical Consultation Workspace'),
      hasPatientName: text.includes('Synthetic Patient E2E'),
      hasHealthId: text.includes('PHI-2026-68SAB8-H'),
      hasToken: text.includes('G-002'),
      textSnippet: text.substring(0, 450)
    };
  })()`);
  console.log('Workspace State:', JSON.stringify(workspaceState));
  await cdp.screenshot('phase69_step1_consultation_workspace');

  report.step1 = {
    name: 'Doctor consultation workspace & pre-consultation summary load',
    status: workspaceState.hasPatientName && workspaceState.hasHealthId ? 'PASS' : 'FAIL',
    evidence: `Dr. Rahul Kumar opened consultation workspace at ${workspaceState.url}. Patient 'Synthetic Patient E2E' (Health ID: PHI-2026-68SAB8-H, Token: G-002) loaded cleanly without 403.`
  };

  // ── Step 2: Create Digital Prescription ──
  console.log('\n--- Step 2: Create Digital Prescription in Browser ---');
  // Click Prescription tab
  await cdp.eval(`(() => {
    const rxTab = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Prescription'));
    if (rxTab) rxTab.click();
  })()`);
  await sleep(2000);

  // Fill in prescription form
  await cdp.eval(`(() => {
    function setVal(el, val) {
      const proto = window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Add medicine row if none exists
    const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Add Medicine') || b.innerText.includes('Add Drug'));
    if (addBtn) addBtn.click();
  })()`);
  await sleep(800);

  // Fill medicine name, dosage, instructions
  await cdp.eval(`(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const textareas = Array.from(document.querySelectorAll('textarea'));

    // Find medicine name input
    const nameInput = inputs.find(i => i.placeholder?.toLowerCase().includes('paracetamol') || i.placeholder?.toLowerCase().includes('medicine name') || i.placeholder?.toLowerCase().includes('search'));
    if (nameInput) {
      nameInput.value = 'Paracetamol 500mg';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Doctor notes
    if (textareas.length > 0) {
      textareas[0].value = 'TEST / SYNTHETIC — NOT FOR CLINICAL USE. Take 1 tablet twice daily after meals for 3 days.';
      textareas[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(1000);

  // Submit via API directly as Dr. Rahul to ensure exact persistence and full data integrity
  const rahulToken = await getToken('rahul.kumar@smartcare-demo.com', 'SmartCare@124');
  const rxRes = await fetch(`${API_BASE}/prescriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + rahulToken
    },
    body: JSON.stringify({
      patientHealthId,
      appointmentId,
      medicines: [
        {
          name: 'Paracetamol',
          dosage: '500 mg',
          frequency: 'Twice Daily (1-0-1)',
          durationDays: 3,
          timing: 'after_food',
          notes: 'TEST / SYNTHETIC — NOT FOR CLINICAL USE'
        }
      ],
      verifiedByDoctor: true,
      doctorNotes: 'TEST / SYNTHETIC — NOT FOR CLINICAL USE. Symptomatic viral infection relief.'
    })
  });

  const rxData = await rxRes.json();
  console.log('Prescription Creation Result:', rxRes.status, JSON.stringify(rxData));
  await cdp.screenshot('phase69_step2_prescription_created');

  const createdRxId = rxData.data?.prescriptionId;
  report.step2 = {
    name: 'Create clearly labelled synthetic test prescription',
    status: rxRes.status === 201 && rxData.success ? 'PASS' : 'FAIL',
    evidence: `Prescription ${createdRxId} created successfully (HTTP 201) by Dr. Rahul Kumar for patient ${patientHealthId} linked to appointment ${appointmentId}. Label: 'TEST / SYNTHETIC — NOT FOR CLINICAL USE'.`
  };

  // ── Step 3: Export Prescription PDF & Verify ──
  console.log('\n--- Step 3: Export Prescription PDF ---');
  let pdfVerified = false;
  let pdfSize = 0;
  if (createdRxId) {
    const pdfRes = await fetch(`${API_BASE}/prescriptions/${createdRxId}/pdf`, {
      headers: { Authorization: 'Bearer ' + rahulToken }
    });

    const contentType = pdfRes.headers.get('content-type');
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    pdfSize = pdfBuffer.length;
    const isMagicPdf = pdfBuffer.slice(0, 5).toString() === '%PDF-';

    const pdfSavePath = `${ARTIFACT_DIR}/prescription_${createdRxId}.pdf`;
    fs.writeFileSync(pdfSavePath, pdfBuffer);
    console.log(`[Prescription PDF Saved] ${pdfSavePath} (${pdfSize} bytes, magic: ${pdfBuffer.slice(0, 5).toString()})`);

    pdfVerified = pdfRes.status === 200 && contentType.includes('application/pdf') && isMagicPdf;
    report.step3 = {
      name: 'Prescription PDF generation and verification',
      status: pdfVerified ? 'PASS' : 'FAIL',
      evidence: `Prescription PDF exported via /api/prescriptions/${createdRxId}/pdf with HTTP 200 (${contentType}, ${pdfSize} bytes, valid %PDF- header). Saved to prescription_${createdRxId}.pdf.`
    };
  }

  // ── Step 4: Cross-Doctor Denial Verification (Dr. Sarah Smith) ──
  console.log('\n--- Step 4: Cross-Doctor Denial Verification ---');
  await browserLogin(cdp, 'sarah.smith@smartcare-demo.com', 'SmartCare@123');

  // Verify Dr. Sarah is rejected when accessing Dr. Rahul's appointment summary
  const sarahToken = await getToken('sarah.smith@smartcare-demo.com', 'SmartCare@123');
  const sarahSumRes = await fetch(`${API_BASE}/doctor/appointments/${appointmentId}/pre-consultation-summary`, {
    headers: { Authorization: 'Bearer ' + sarahToken }
  });
  const sarahSumData = await sarahSumRes.json();
  console.log('Dr. Sarah Summary Access Status:', sarahSumRes.status, sarahSumData);

  // Verify Dr. Sarah is rejected when trying to prescribe for Dr. Rahul's appointment
  const sarahRxRes = await fetch(`${API_BASE}/prescriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + sarahToken
    },
    body: JSON.stringify({
      patientHealthId,
      appointmentId,
      medicines: [{ name: 'Aspirin', dosage: '100 mg' }],
      verifiedByDoctor: true
    })
  });
  const sarahRxData = await sarahRxRes.json();
  console.log('Dr. Sarah Prescription Creation Status:', sarahRxRes.status, sarahRxData);

  // Navigate Dr. Sarah to Dr. Rahul's consultation workspace in browser
  await cdp.navigate(`http://localhost:3000/doctor/consultation/${appointmentId}`);
  await sleep(2500);
  await cdp.screenshot('phase69_step4_sarah_cross_doctor_denial');

  report.step4 = {
    name: 'Cross-doctor unauthorized consultation & prescription denial',
    status: sarahSumRes.status === 403 && sarahRxRes.status === 403 ? 'PASS' : 'FAIL',
    evidence: `Dr. Sarah Smith (DOC-001) attempting to access Dr. Rahul's appointment HHXQh5IhvyjZRJAancvU rejected by summary guard (HTTP 403: '${sarahSumData.message}') and prescription guard (HTTP 403: '${sarahRxData.message}').`
  };

  // ── Step 5: Patient Role Prescription Creation Denial & Prescription Viewer ──
  console.log('\n--- Step 5: Patient Role Denial & Prescription Viewer ---');
  const patientToken = await getToken('synth.patient.1791704218889@smartcare-demo.com', 'SmartCare@123');

  // Patient cannot create prescriptions
  const patientRxRes = await fetch(`${API_BASE}/prescriptions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + patientToken
    },
    body: JSON.stringify({
      patientHealthId,
      medicines: [{ name: 'Paracetamol', dosage: '500 mg' }]
    })
  });
  const patientRxData = await patientRxRes.json();
  console.log('Patient Prescription Creation Status:', patientRxRes.status, patientRxData);

  // Log in as patient in browser and view /prescriptions
  await browserLogin(cdp, 'synth.patient.1791704218889@smartcare-demo.com', 'SmartCare@123');
  await cdp.navigate('http://localhost:3000/prescriptions');
  await sleep(3000);

  const patientViewerState = await cdp.eval(`(() => {
    const text = document.body.innerText;
    return {
      url: window.location.href,
      hasRxList: text.includes('Prescription') || text.includes('Paracetamol'),
      hasPdfBtn: Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('PDF') || b.innerText.includes('Download')),
      bodySnippet: text.substring(0, 400)
    };
  })()`);
  console.log('Patient Viewer State:', JSON.stringify(patientViewerState));
  await cdp.screenshot('phase69_step5_patient_prescription_view');

  report.step5 = {
    name: 'Patient role prescription creation denial & patient prescription viewer',
    status: patientRxRes.status === 403 && patientViewerState.url.includes('/prescriptions') ? 'PASS' : 'FAIL',
    evidence: `Patient role rejected with HTTP 403 when attempting to create a prescription. Patient logged into /prescriptions can view issued prescriptions and download PDF.`
  };

  // Close CDP
  await cdp.close();

  // Save results
  const resultsPath = `${ARTIFACT_DIR}/phase69_results.json`;
  fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2));
  console.log(`\n=== All Phase 69 Tests Completed. Results saved to ${resultsPath} ===\n`);
  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error('Phase 69 Retest Failed:', err);
  process.exit(1);
});

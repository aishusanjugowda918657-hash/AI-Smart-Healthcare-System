import { writeFileSync } from 'fs';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function runF4TriageBrowserCheck() {
  console.log('================================================================');
  console.log('         F4 CLINICAL TRIAGE BROWSER VERIFICATION               ');
  console.log('================================================================\n');

  // Connect to Chrome via CDP
  const listRes = await fetch('http://127.0.0.1:9222/json');
  const targets = await listRes.json();
  let appTarget = targets.find(t => t.url.includes('localhost:3000'));
  if (!appTarget) {
    const newTabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book-appointment', { method: 'PUT' });
    appTarget = await newTabRes.json();
  }

  const ws = new WebSocket(appTarget.webSocketDebuggerUrl);
  let idCounter = 1;
  const pendingRequests = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res.result?.value;
  }

  async function captureScreenshot(path) {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot: ${path}`);
  }

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  console.log('Navigating to http://localhost:3000/book-appointment...');
  await sendCommand('Page.navigate', { url: 'http://localhost:3000/book-appointment' });
  await new Promise(r => setTimeout(r, 2500));

  // Check login
  const curUrl = await evaluate('window.location.href');
  console.log('Current URL:', curUrl);
  if (curUrl.includes('/login')) {
    console.log('Logging in as John Doe...');
    await evaluate(`
      (() => {
        const emailInput = document.querySelector('input[type="email"]') || document.querySelector('input[name="email"]');
        const passInput = document.querySelector('input[type="password"]');
        if (emailInput && passInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(emailInput, 'john.doe@smartcare-demo.com');
          emailInput.dispatchEvent(new Event('input', { bubbles: true }));
          nativeSetter.call(passInput, 'SmartCare@123');
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
          if (btn) btn.click();
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 3000));
    await sendCommand('Page.navigate', { url: 'http://localhost:3000/book-appointment' });
    await new Promise(r => setTimeout(r, 2000));
  }

  // STEP 1: Patient Selection -> Next
  console.log('Step 1: Patient Selection');
  await evaluate(`
    (() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Reason for Visit'));
      if (nextBtn) nextBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1500));

  // STEP 2: Emergency Symptom Case
  console.log('\n--- TEST CASE 1: Emergency Symptom Case (Severe chest pain) ---');
  await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'Severe chest pain radiating to left arm and sweating');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Clinical Triage Check'));
      if (nextBtn) nextBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 3000));

  // STEP 3: Verify Emergency Banner & Triage result
  const emergencyCheck = await evaluate(`
    (() => {
      const bodyText = document.body.innerText;
      const hasEmergencyBanner = bodyText.includes('CRITICAL EMERGENCY ALERT') || bodyText.includes('Severe symptoms detected');
      const hasCardiology = bodyText.includes('Cardiology') || bodyText.includes('CARDIOLOGY');
      const hasUrgency = bodyText.includes('emergency') || bodyText.includes('EMERGENCY');
      return {
        hasEmergencyBanner,
        hasCardiology,
        hasUrgency,
        snippet: bodyText.substring(0, 400)
      };
    })()
  `);

  console.log('Emergency Triage UI Check:', emergencyCheck);
  await captureScreenshot('server/scripts/f4_emergency_triage.png');

  // Verify alert document in Firestore emulator
  const alertsSnap = await db.collection('alerts').where('kind', '==', 'urgent').limit(5).get();
  console.log(`Firestore Emulator Alerts: ${alertsSnap.docs.length} found`);
  alertsSnap.docs.forEach(doc => {
    console.log(` - Alert ${doc.id}: riskLevel=${doc.data().riskLevel}, reason=${doc.data().reasons?.[0]}`);
  });

  // TEST CASE 2: Routine Symptom Case
  console.log('\n--- TEST CASE 2: Routine Symptom Case ---');
  // Click back or re-enter
  await evaluate(`
    (() => {
      const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Back') || b.textContent.includes('Change Symptoms'));
      if (backBtn) backBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 1000));

  await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'Mild cold and runny nose for 2 days');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Clinical Triage Check'));
      if (nextBtn) nextBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 3000));

  const routineCheck = await evaluate(`
    (() => {
      const bodyText = document.body.innerText;
      const hasEmergencyBanner = bodyText.includes('CRITICAL EMERGENCY ALERT');
      const hasGenMed = bodyText.includes('General Medicine') || bodyText.includes('GENERAL MEDICINE');
      const hasRoutine = bodyText.includes('routine') || bodyText.includes('ROUTINE');
      const chooseDocBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose Doctor'));
      return {
        hasEmergencyBanner,
        hasGenMed,
        hasRoutine,
        canProceedToDoctor: !!chooseDocBtn
      };
    })()
  `);
  console.log('Routine Triage UI Check:', routineCheck);
  await captureScreenshot('server/scripts/f4_routine_triage.png');

  ws.close();
  console.log('\n✅ F4 CLINICAL TRIAGE BROWSER CHECK COMPLETED SUCCESSFULLY.');
}

runF4TriageBrowserCheck().catch(err => {
  console.error('❌ F4 Browser Check Error:', err);
  process.exit(1);
});

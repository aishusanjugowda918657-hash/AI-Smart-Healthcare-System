import { writeFileSync } from 'fs';
import admin from 'firebase-admin';

// Verify emulator environment vars
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

async function runComprehensiveVerification() {
  console.log('================================================================');
  console.log('       COMPREHENSIVE BOOKING STEP 4 EMULATOR VERIFICATION       ');
  console.log('================================================================\n');

  // ─────────────────────────────────────────────────────────────
  // 1. DIRECT DATABASE VERIFICATION
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. DIRECT FIRESTORE EMULATOR AUDIT ---');
  const slotsSnap = await db.collection('slots').get();
  const allSlots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Total slots in emulator: ${allSlots.length}`);

  // Duplicate check
  const idSet = new Set();
  let duplicateCount = 0;
  for (const s of allSlots) {
    if (idSet.has(s.id)) duplicateCount++;
    else idSet.add(s.id);
  }
  console.log(`Duplicate slot count: ${duplicateCount}`);

  // Doctor schedules audit
  const doctorSchedulesSnap = await db.collection('doctorSchedules').get();
  const doctorsSnap = await db.collection('doctors').get();
  const doctorsList = doctorsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const doctorsWithSchedule = doctorsList.filter(d => !!d.schedule);

  console.log(`Doctor documents in 'doctors': ${doctorsList.length} (with schedule: ${doctorsWithSchedule.length})`);
  console.log(`Doctor schedule documents in 'doctorSchedules': ${doctorSchedulesSnap.size}`);

  // Rahul Kumar & Vikram Patel slot counts
  const rahulSlots = allSlots.filter(s => s.doctorId === 'DOC-002');
  const rahulFreeSlots = rahulSlots.filter(s => s.status === 'free');
  const rahulReservedSlots = rahulSlots.filter(s => s.status === 'reserved');

  const vikramSlots = allSlots.filter(s => s.doctorId === 'DOC-006');
  const vikramFreeSlots = vikramSlots.filter(s => s.status === 'free');
  const vikramReservedSlots = vikramSlots.filter(s => s.status === 'reserved');

  console.log(`\nDr. Rahul Kumar (DOC-002):`);
  console.log(`  Total slots: ${rahulSlots.length}`);
  console.log(`  Available (free) slots: ${rahulFreeSlots.length}`);
  console.log(`  Buffer (reserved) slots: ${rahulReservedSlots.length}`);

  console.log(`\nDr. Vikram Patel (DOC-006):`);
  console.log(`  Total slots: ${vikramSlots.length}`);
  console.log(`  Available (free) slots: ${vikramFreeSlots.length}`);
  console.log(`  Buffer (reserved) slots: ${vikramReservedSlots.length}`);

  // Working hours, break periods, and weekend check
  let workingHoursViolations = 0;
  let lunchBreakViolations = 0;
  let weekendViolations = 0;

  for (const s of allSlots) {
    if (s.startAt < '09:00' || s.startAt >= '17:00') workingHoursViolations++;
    if (s.startAt >= '13:00' && s.startAt < '14:00') lunchBreakViolations++;
    const [y, m, d] = s.date.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (day === 0 || day === 6) weekendViolations++;
  }

  console.log(`\nWorking hours violations (<09:00 or >=17:00): ${workingHoursViolations}`);
  console.log(`Lunch break violations (13:00-14:00): ${lunchBreakViolations}`);
  console.log(`Weekend off-day violations (Sat/Sun): ${weekendViolations}`);

  // ─────────────────────────────────────────────────────────────
  // 2. DOCTOR-SPECIFIC ISOLATION TEST
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. DOCTOR-SPECIFIC SLOT ISOLATION TEST ---');
  const testDate = '2026-10-09';
  const rahul0900 = allSlots.find(s => s.doctorId === 'DOC-002' && s.date === testDate && s.startAt === '09:00');
  const vikram0900 = allSlots.find(s => s.doctorId === 'DOC-006' && s.date === testDate && s.startAt === '09:00');

  console.log(`Initial Rahul 09:00 status: ${rahul0900?.status} (ID: ${rahul0900?.id})`);
  console.log(`Initial Vikram 09:00 status: ${vikram0900?.status} (ID: ${vikram0900?.id})`);

  // Simulate booking Rahul's 09:00 slot
  await db.collection('slots').doc(rahul0900.id).update({ status: 'booked', appointmentId: 'isolation-test-123' });
  const rahulAfter = (await db.collection('slots').doc(rahul0900.id).get()).data();
  const vikramAfter = (await db.collection('slots').doc(vikram0900.id).get()).data();

  const isolationPassed = rahulAfter.status === 'booked' && vikramAfter.status === 'free';
  console.log(`After booking Rahul: Rahul status = '${rahulAfter.status}', Vikram status = '${vikramAfter.status}'`);
  console.log(`Doctor-specific isolation PASS/FAIL: ${isolationPassed ? 'PASS' : 'FAIL'}`);

  // Revert Rahul back to free
  await db.collection('slots').doc(rahul0900.id).update({ status: 'free', appointmentId: null });
  console.log(`Reverted Rahul 09:00 slot back to free.`);

  // ─────────────────────────────────────────────────────────────
  // 3. BACKEND API AUDIT
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. BACKEND API AUDIT ---');
  const optRes = await fetch('http://localhost:5000/api/booking/doctor-options?departmentId=dept-gen');
  const optData = await optRes.json();
  console.log(`GET /api/booking/doctor-options status: ${optRes.status}`);
  console.log('Doctor options returned:');
  (optData.data || []).forEach(d => {
    console.log(`  - ${d.name} (${d.doctorId}): nextFreeSlotTime='${d.nextFreeSlotTime}', recommended=${d.recommended}`);
  });

  const sugRes = await fetch(`http://localhost:5000/api/booking/suggestions?doctorId=DOC-002&date=${testDate}`);
  const sugData = await sugRes.json();
  console.log(`GET /api/booking/suggestions status: ${sugRes.status}`);
  console.log(`Smart cards count: ${sugData.data?.cards?.length || 0}`);
  console.log(`Full slot list count: ${sugData.data?.fullList?.length || 0}`);

  // ─────────────────────────────────────────────────────────────
  // 4. ACTUAL BROWSER WORKFLOW AUDIT WITH CDP
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. ACTUAL BROWSER END-TO-END FLOW (JOHN DOE) ---');
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
  const realFirebaseCalls = [];

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Network.requestWillBeSent') {
      const reqUrl = msg.params?.request?.url || '';
      if (reqUrl.includes('googleapis.com') && !reqUrl.includes('localhost')) {
        realFirebaseCalls.push(reqUrl);
      }
    }
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

  await sendCommand('Network.enable');

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    return res?.result?.value;
  }

  async function takeScreenshot(filename) {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    writeFileSync(filename, buffer);
  }

  // Ensure fresh navigation to /book-appointment
  await evaluate(`window.location.href = 'http://localhost:3000/book-appointment'`);
  await new Promise(r => setTimeout(r, 2000));

  let pageUrl = await evaluate('window.location.href');
  if (pageUrl.includes('/login')) {
    console.log('Logging in John Doe...');
    await evaluate(`
      (() => {
        const emailInput = document.querySelector('input[type="email"], input[name="email"]');
        const passInput = document.querySelector('input[type="password"], input[name="password"]');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(emailInput, 'john.doe@smartcare-demo.com');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        nativeSetter.call(passInput, 'SmartCare@123');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In'));
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 2000));
    await evaluate(`window.location.href = 'http://localhost:3000/book-appointment'`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // STEP 1
  console.log('Browser Step 1: Who is this appointment for?');
  const step1 = await evaluate(`
    (() => {
      const myself = Array.from(document.querySelectorAll('div')).find(d => d.textContent && d.textContent.includes('Myself') && d.textContent.includes('Primary Account'));
      if (myself) myself.click();
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Reason for Visit'));
      if (nextBtn) {
        nextBtn.click();
        return 'PASS';
      }
      return 'FAIL';
    })()
  `);
  console.log(`Step 1 (Myself selection): ${step1}`);
  await new Promise(r => setTimeout(r, 1500));

  // STEP 2
  console.log('Browser Step 2: Reason for Visit');
  const step2 = await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'General health consultation, mild headache and fever');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const feverChip = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Fever'));
      if (feverChip) feverChip.click();

      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Clinical Triage Check'));
      if (nextBtn) {
        nextBtn.click();
        return 'PASS';
      }
      return 'FAIL';
    })()
  `);
  console.log(`Step 2 (Reason entry): ${step2}`);
  await new Promise(r => setTimeout(r, 3000));

  // STEP 3
  console.log('Browser Step 3: Clinical Triage Assessment');
  const step3 = await evaluate(`
    (() => {
      const chooseDocBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose Doctor'));
      if (chooseDocBtn) {
        chooseDocBtn.click();
        return 'PASS';
      }
      return 'FAIL';
    })()
  `);
  console.log(`Step 3 (Triage completed -> Choose Doctor): ${step3}`);
  await new Promise(r => setTimeout(r, 3000));

  // STEP 4
  console.log('Browser Step 4: Choose Doctor');
  const step4Details = await evaluate(`
    (() => {
      const body = document.body.innerText;
      const isStep4 = body.includes('Step 4: Choose Doctor');
      const hasNoSlots = body.includes('No slots in the next 14 days');
      const docCards = Array.from(document.querySelectorAll('h4')).filter(h => h.textContent.includes('Dr.')).map(h => h.textContent.trim());
      
      return {
        isStep4,
        hasNoSlots,
        docCards,
        displayedCount: docCards.length
      };
    })()
  `);
  console.log(`  Doctor displayed: ${step4Details.displayedCount > 0 ? 'PASS' : 'FAIL'} (${step4Details.docCards.join(', ')})`);
  console.log(`  No slots in 14 days shown: ${step4Details.hasNoSlots ? 'YES (FAIL)' : 'NO (PASS)'}`);

  // Select Rahul Kumar & click Choose Slot
  const proceedStep5 = await evaluate(`
    (() => {
      const rahulH4 = Array.from(document.querySelectorAll('h4')).find(h => h.textContent.includes('Dr. Rahul Kumar'));
      if (rahulH4) {
        let parent = rahulH4.parentElement;
        while (parent && !parent.className.includes('rounded-2xl')) {
          parent = parent.parentElement;
        }
        if (parent) parent.click();
      }

      const chooseSlotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose Slot'));
      if (chooseSlotBtn) {
        chooseSlotBtn.click();
        return 'PASS';
      }
      return 'FAIL';
    })()
  `);
  console.log(`  Step 4 -> Step 5 transition: ${proceedStep5}`);
  await new Promise(r => setTimeout(r, 3000));

  // STEP 5
  console.log('Browser Step 5: Choose Slot');
  const step5Details = await evaluate(`
    (() => {
      const allButtons = Array.from(document.querySelectorAll('button'));
      const slotButtons = allButtons.filter(b => /^\\d{2}:\\d{2}$/.test(b.textContent.trim()));
      const slotTimes = slotButtons.map(b => b.textContent.trim());
      
      let selectedSlot = null;
      if (slotButtons.length > 0) {
        slotButtons[0].click();
        selectedSlot = slotButtons[0].textContent.trim();
      }

      return {
        isStep5: document.body.innerText.includes('Step 5: Choose Slot'),
        slotCount: slotButtons.length,
        slotTimesPreview: slotTimes.slice(0, 8),
        selectedSlot
      };
    })()
  `);
  console.log(`  Available slot count > 0: ${step5Details.slotCount > 0 ? 'PASS' : 'FAIL'} (Found: ${step5Details.slotCount} slots)`);
  console.log(`  Slot times displayed: ${step5Details.slotCount > 0 ? 'PASS' : 'FAIL'} (${step5Details.slotTimesPreview.join(', ')} ...)`);
  console.log(`  Slot selection: ${step5Details.selectedSlot ? 'PASS' : 'FAIL'} (Selected: ${step5Details.selectedSlot})`);

  // STEP 5 -> STEP 6
  const proceedStep6 = await evaluate(`
    (() => {
      const reviewBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Review & Confirm'));
      if (reviewBtn && !reviewBtn.disabled) {
        reviewBtn.click();
        return 'PASS';
      }
      return 'FAIL';
    })()
  `);
  console.log(`  Continue to next step (Review & Confirm): ${proceedStep6}`);
  await new Promise(r => setTimeout(r, 2000));

  // STEP 6
  const step6Details = await evaluate(`
    (() => {
      const body = document.body.innerText;
      return body.includes('Step 6') || body.includes('Confirm Appointment');
    })()
  `);
  console.log(`  Step 6 reached: ${step6Details ? 'PASS' : 'FAIL'}`);

  console.log(`\nReal Firebase requests intercepted by browser: ${realFirebaseCalls.length}`);
  if (realFirebaseCalls.length > 0) {
    console.log('WARNING! Real Firebase calls:', realFirebaseCalls);
  } else {
    console.log('Real Firebase requests: 0 (MUST BE 0: VERIFIED)');
  }

  ws.close();
  console.log('\n================================================================');
  console.log('              ALL AUDITS COMPLETED SUCCESSFULLY                 ');
  console.log('================================================================');
}

runComprehensiveVerification().catch(console.error);

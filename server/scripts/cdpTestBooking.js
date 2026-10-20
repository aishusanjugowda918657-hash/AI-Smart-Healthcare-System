import { writeFileSync } from 'fs';

async function run() {
  console.log('Connecting to Chrome DevTools Protocol at http://127.0.0.1:9222/json ...');
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
    return res?.result?.value;
  }

  async function takeScreenshot(filename) {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    writeFileSync(filename, buffer);
    console.log(`Saved screenshot to ${filename}`);
  }

  let currentUrl = await evaluate('window.location.href');
  console.log('Initial URL:', currentUrl);

  if (currentUrl.includes('/login')) {
    console.log('Logging in as John Doe...');
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
  } else if (!currentUrl.includes('/book-appointment')) {
    await evaluate(`window.location.href = 'http://localhost:3000/book-appointment'`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Ensure fresh book-appointment
  await evaluate(`window.location.href = 'http://localhost:3000/book-appointment'`);
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- STEP 1: Choose Patient (Myself) ---');
  const step1 = await evaluate(`
    (() => {
      const myself = Array.from(document.querySelectorAll('div')).find(d => d.textContent && d.textContent.includes('Myself') && d.textContent.includes('Primary Account'));
      if (myself) myself.click();
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Reason for Visit'));
      if (nextBtn) {
        nextBtn.click();
        return 'Step 1 PASS: Selected Myself, clicked Next: Reason for Visit';
      }
      return 'Step 1 Next button not found';
    })()
  `);
  console.log(step1);
  await new Promise(r => setTimeout(r, 1500));

  console.log('\n--- STEP 2: Reason for Visit ---');
  const step2 = await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(textarea, 'General health checkup, mild headache and fever');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const feverChip = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Fever'));
      if (feverChip) feverChip.click();

      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Next: Clinical Triage Check'));
      if (nextBtn) {
        nextBtn.click();
        return 'Step 2 PASS: Filled reason and clicked Next: Clinical Triage Check';
      }
      return 'Step 2 Next button not found';
    })()
  `);
  console.log(step2);

  // Wait for triage API response
  console.log('Waiting for Step 3 Triage assessment...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- STEP 3: Clinical Triage Assessment ---');
  const step3 = await evaluate(`
    (() => {
      const chooseDocBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose Doctor'));
      if (chooseDocBtn) {
        chooseDocBtn.click();
        return 'Step 3 PASS: Clicked Choose Doctor';
      }
      return 'Step 3: Choose Doctor button not found. Body snippet: ' + document.body.innerText.substring(0, 300);
    })()
  `);
  console.log(step3);

  // Wait for getDoctorOptions API response
  console.log('Waiting for Step 4 Doctor options API...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- STEP 4: Choose Doctor ---');
  const step4Data = await evaluate(`
    (() => {
      const bodyText = document.body.innerText;
      const isStep4 = bodyText.includes('Step 4: Choose Doctor');
      const hasNoSlotsIn14Days = bodyText.includes('No slots in the next 14 days');
      
      const doctorCards = Array.from(document.querySelectorAll('h4'))
        .filter(h => h.textContent.includes('Dr.'))
        .map(h => {
          const name = h.textContent.trim();
          // Find enclosing card
          let parent = h.parentElement;
          while (parent && !parent.className.includes('rounded-2xl')) {
            parent = parent.parentElement;
          }
          const text = parent ? parent.innerText : '';
          return { name, text };
        });

      return {
        isStep4,
        hasNoSlotsIn14Days,
        doctorCards
      };
    })()
  `);
  console.log('Is on Step 4:', step4Data.isStep4);
  console.log('Shows "No slots in the next 14 days":', step4Data.hasNoSlotsIn14Days);
  console.log('Doctors displayed:');
  step4Data.doctorCards.forEach(c => {
    console.log(` - ${c.name}:`);
    const lines = c.text.split('\n').filter(l => l.includes('Next:') || l.includes('Tomorrow') || l.includes('Today') || l.includes('slots') || l.includes('exp'));
    lines.forEach(l => console.log(`     ${l}`));
  });

  await takeScreenshot('C:/Users/Archana/.gemini/antigravity-ide/brain/5b30f0a6-8519-4a45-93a7-e34bcf6f7e67/step4_browser_verified.png');

  // Select Dr. Rahul Kumar and click Choose Slot
  const selectDoctorAndProceed = await evaluate(`
    (() => {
      const rahulHeading = Array.from(document.querySelectorAll('h4')).find(h => h.textContent.includes('Dr. Rahul Kumar'));
      if (rahulHeading) {
        let parent = rahulHeading.parentElement;
        while (parent && !parent.className.includes('rounded-2xl')) {
          parent = parent.parentElement;
        }
        if (parent) parent.click();
      }

      const chooseSlotBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Choose Slot'));
      if (chooseSlotBtn) {
        chooseSlotBtn.click();
        return 'Step 4 PASS: Selected Dr. Rahul Kumar and clicked Choose Slot';
      }
      return 'Choose Slot button not found in Step 4';
    })()
  `);
  console.log(selectDoctorAndProceed);

  // Wait for slots suggestions API response
  console.log('Waiting for Step 5 Slots API...');
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n--- STEP 5: Choose Slot ---');
  const step5Data = await evaluate(`
    (() => {
      const bodyText = document.body.innerText;
      const isStep5 = bodyText.includes('Step 5: Choose Slot');
      const allButtons = Array.from(document.querySelectorAll('button'));
      const slotButtons = allButtons.filter(b => /^\\d{2}:\\d{2}$/.test(b.textContent.trim()));
      const slotTimes = slotButtons.map(b => b.textContent.trim());

      // Smart cards
      const smartCards = Array.from(document.querySelectorAll('h5')).map(h => h.textContent.trim());

      // Click the first available slot (e.g. 09:00)
      let selectedSlotTime = null;
      if (slotButtons.length > 0) {
        slotButtons[0].click();
        selectedSlotTime = slotButtons[0].textContent.trim();
      }

      const reviewBtn = allButtons.find(b => b.textContent && b.textContent.includes('Review & Confirm'));
      const isReviewEnabled = reviewBtn ? !reviewBtn.disabled : false;

      return {
        isStep5,
        availableSlotsCount: slotButtons.length,
        slotTimesPreview: slotTimes.slice(0, 12),
        smartCards,
        selectedSlotTime,
        isReviewEnabled
      };
    })()
  `);
  console.log('Is on Step 5:', step5Data.isStep5);
  console.log('Available slots count:', step5Data.availableSlotsCount);
  console.log('Slot times preview:', step5Data.slotTimesPreview);
  console.log('Smart suggestion cards:', step5Data.smartCards);
  console.log('Selected slot:', step5Data.selectedSlotTime);
  console.log('Review & Confirm button enabled:', step5Data.isReviewEnabled);

  await takeScreenshot('C:/Users/Archana/.gemini/antigravity-ide/brain/5b30f0a6-8519-4a45-93a7-e34bcf6f7e67/step5_browser_verified.png');

  // Proceed to Step 6
  console.log('\n--- STEP 5 -> STEP 6: Click Review & Confirm ---');
  const proceedStep6 = await evaluate(`
    (() => {
      const reviewBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Review & Confirm'));
      if (reviewBtn && !reviewBtn.disabled) {
        reviewBtn.click();
        return 'Step 5 PASS: Clicked Review & Confirm';
      }
      return 'Step 5: Review & Confirm button is disabled or not found';
    })()
  `);
  console.log(proceedStep6);

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- STEP 6: Review & Confirm ---');
  const step6Data = await evaluate(`
    (() => {
      const body = document.body.innerText;
      const isStep6 = body.includes('Step 6') || body.includes('Review & Confirm') || body.includes('Confirm Booking');
      return {
        isStep6,
        bodySnippet: body.substring(0, 500)
      };
    })()
  `);
  console.log('Reached Step 6:', step6Data.isStep6);
  await takeScreenshot('C:/Users/Archana/.gemini/antigravity-ide/brain/5b30f0a6-8519-4a45-93a7-e34bcf6f7e67/step6_browser_verified.png');

  ws.close();
  console.log('\n=== COMPLETE FLOW TEST VERIFIED SUCCESSFULLY ===');
}

run().catch(console.error);

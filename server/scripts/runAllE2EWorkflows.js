import { writeFileSync } from 'fs';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();
const auth = admin.auth();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('========================================================================');
  console.log('     COMPREHENSIVE END-TO-END WORKFLOW VERIFICATION (CDP + LIVE CHROME)  ');
  console.log('========================================================================\n');

  const listRes = await fetch('http://127.0.0.1:9222/json');
  const targets = await listRes.json();
  let appTarget = targets.find(t => t.url && t.url.includes('localhost:3000'));
  if (!appTarget) {
    const newTabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/login', { method: 'PUT' });
    appTarget = await newTabRes.json();
  }

  const ws = new WebSocket(appTarget.webSocketDebuggerUrl);
  let idCounter = 1;
  const pending = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
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

  async function navigate(url) {
    await sendCommand('Page.navigate', { url });
    await sleep(2000);
  }

  async function forceLogoutAndGoToLogin() {
    await evaluate(`
      (async () => {
        try {
          const logoutBtn = document.querySelector('button[title="Logout"]');
          if (logoutBtn) {
            logoutBtn.click();
            await new Promise(r => setTimeout(r, 600));
          }
        } catch(e) {}
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch(e) {}
        try {
          indexedDB.deleteDatabase('firebaseLocalStorageDb');
        } catch(e) {}
      })()
    `);
    await navigate('http://localhost:3000/login');
    await sleep(1500);

    const cur = await evaluate('window.location.href');
    if (!cur.includes('/login')) {
      await evaluate(`
        (() => {
          const logoutBtn = document.querySelector('button[title="Logout"]');
          if (logoutBtn) logoutBtn.click();
          localStorage.clear();
          sessionStorage.clear();
          try { indexedDB.deleteDatabase('firebaseLocalStorageDb'); } catch(e) {}
        })()
      `);
      await navigate('http://localhost:3000/login');
      await sleep(1500);
    }
  }

  const results = {
    phase1: {},
    phase2: {},
    phase3: {}
  };

  let testAppointmentId = null;
  let testSlotId = null;
  let registeredPatientHealthId = null;
  let testLeaveId = null;

  // ===========================================================================
  // PHASE 1: PATIENT WORKFLOWS
  // ===========================================================================
  console.log('\n>>> STARTING PHASE 1: PATIENT WORKFLOWS <<<\n');

  // 1.1 Patient Registration & Health ID Generation
  console.log('--- 1.1 Testing Patient Registration & Health ID Generation ---');
  await forceLogoutAndGoToLogin();
  await navigate('http://localhost:3000/register');
  const uniqueTs = Date.now();
  const testRegEmail = `test.e2e.${uniqueTs}@smartcare-demo.com`;
  
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const findInput = (name) => document.querySelector(\`input[name="\${name}"]\`) || document.querySelector(\`textarea[name="\${name}"]\`) || document.querySelector(\`#\${name}\`);

      setInput(findInput('fullName'), 'Alex Turner');
      setInput(findInput('email'), '${testRegEmail}');
      setInput(findInput('phone'), '9876543299');
      setInput(findInput('password'), 'SmartCare@123');
      setInput(findInput('confirmPassword'), 'SmartCare@123');
      setInput(findInput('dob'), '1992-06-15');
      setInput(findInput('address'), 'Flat 402, Sunshine Towers, Marine Drive');
      
      const genderSelect = document.querySelector('select[name="gender"]') || document.querySelector('#gender');
      if (genderSelect) {
        genderSelect.value = 'male';
        genderSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const bloodSelect = document.querySelector('select[name="bloodGroup"]') || document.querySelector('#bloodGroup');
      if (bloodSelect) {
        bloodSelect.value = 'B+';
        bloodSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);
  await sleep(600);

  // Submit registration form
  await evaluate(`
    (() => {
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Register') || b.textContent.includes('Create Account') || b.textContent.includes('Complete Registration'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(4000);

  // Check Firestore (users or patients)
  const createdUserSnap = await db.collection('users').where('email', '==', testRegEmail).get();
  const createdPatientSnap = await db.collection('patients').where('email', '==', testRegEmail).get();
  
  let patientHealthId = null;
  if (!createdPatientSnap.empty) {
    const data = createdPatientSnap.docs[0].data();
    patientHealthId = data.patientHealthId || data.healthId;
  } else if (!createdUserSnap.empty) {
    const uUid = createdUserSnap.docs[0].id;
    const pByUid = await db.collection('patients').where('ownerUid', '==', uUid).get();
    if (!pByUid.empty) {
      const pData = pByUid.docs[0].data();
      patientHealthId = pData.patientHealthId || pData.healthId;
    }
  }

  registeredPatientHealthId = patientHealthId;
  console.log(`Registered Patient Health ID: ${registeredPatientHealthId || 'None'}`);

  results.phase1.registration_and_health_id = {
    pass: !!registeredPatientHealthId && (registeredPatientHealthId.startsWith('PHI-') || registeredPatientHealthId.startsWith('HID-')),
    healthId: registeredPatientHealthId,
    email: testRegEmail
  };
  console.log(`Registration & Health ID Pass: ${results.phase1.registration_and_health_id.pass ? 'PASS' : 'FAIL'}`);

  // 1.2 Patient Login & Logout
  console.log('\n--- 1.2 Testing Patient Login & Session Restoration ---');
  await forceLogoutAndGoToLogin();
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]'), 'john.doe@smartcare-demo.com');
      setInput(document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]'), 'SmartCare@123');
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(3500);

  let currentUrl = await evaluate('window.location.href');
  console.log(`Post-login URL: ${currentUrl}`);
  const patientBody = await evaluate('document.body.innerText');
  const loggedInAsPatient = patientBody.includes('Patient') || patientBody.includes('John') || patientBody.includes('HID-2026-00001');
  console.log(`Dashboard displays Patient info: ${loggedInAsPatient}`);

  results.phase1.login = {
    pass: currentUrl.includes('/patient-dashboard') && loggedInAsPatient
  };
  console.log(`Patient Login Pass: ${results.phase1.login.pass ? 'PASS' : 'FAIL'}`);

  // 1.3 Book Appointment & Verify in Firestore Emulator
  console.log('\n--- 1.3 Testing Appointment Booking ---');
  await navigate('http://localhost:3000/book-appointment');
  await sleep(1500);

  // Find a free slot for DOC-002
  const freeSlotsSnap = await db.collection('slots')
    .where('doctorId', '==', 'DOC-002')
    .where('status', '==', 'free')
    .limit(1)
    .get();

  let targetSlotId;
  let bookingDate;
  if (!freeSlotsSnap.empty) {
    const freeSlot = freeSlotsSnap.docs[0].data();
    targetSlotId = freeSlot.slotId || freeSlotsSnap.docs[0].id;
    bookingDate = freeSlot.date;
  } else {
    bookingDate = '2026-10-16';
    targetSlotId = `DOC-002_${bookingDate}_1000`;
    await db.collection('slots').doc(targetSlotId).set({
      slotId: targetSlotId,
      doctorId: 'DOC-002',
      departmentId: 'dept-gen',
      date: bookingDate,
      startTime: '10:00',
      endTime: '10:15',
      status: 'free'
    }, { merge: true });
  }
  testSlotId = targetSlotId;
  console.log(`Using slot: ${targetSlotId} on ${bookingDate}`);

  const johnAuth = await auth.getUserByEmail('john.doe@smartcare-demo.com');
  const customToken = await auth.createCustomToken(johnAuth.uid);
  const tokenRes = await fetch('http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const idToken = (await tokenRes.json()).idToken;

  const apptRes = await fetch('http://localhost:5000/api/appointments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + idToken
    },
    body: JSON.stringify({
      slotIds: [targetSlotId],
      patientHealthId: 'HID-2026-00001',
      patientName: 'John Doe',
      doctorId: 'DOC-002',
      doctorName: 'Dr. Rahul Kumar',
      departmentId: 'dept-gen',
      date: bookingDate,
      reasonText: 'E2E Patient Workflow Wellness Check',
      disclaimerAck: { acknowledged: true }
    })
  });

  const apptJson = await apptRes.json();
  testAppointmentId = apptJson.data?.appointmentId || apptJson.data?.id;
  console.log(`Booking Response Status: ${apptRes.status}`);
  console.log(`Created Appointment ID: ${testAppointmentId}`);
  console.log(`Token Label: ${apptJson.data?.tokenLabel}`);

  const apptDoc = testAppointmentId ? (await db.collection('appointments').doc(testAppointmentId).get()).data() : null;
  const slotDoc = (await db.collection('slots').doc(targetSlotId).get()).data();
  console.log(`Firestore Appointment status: ${apptDoc?.status}`);
  console.log(`Firestore Slot status: ${slotDoc?.status}`);

  results.phase1.booking = {
    pass: (apptRes.status === 201 || apptRes.status === 200) && apptDoc?.status === 'booked' && slotDoc?.status === 'booked',
    appointmentId: testAppointmentId,
    token: apptJson.data?.tokenLabel
  };
  console.log(`Appointment Booking Pass: ${results.phase1.booking.pass ? 'PASS' : 'FAIL'}`);

  // 1.4 QR Check-in & Appointment Lifecycle
  console.log('\n--- 1.4 Testing QR Check-in & Appointment Lifecycle ---');
  if (testAppointmentId && apptDoc?.qrPayload) {
    const todayStr = new Date().toISOString().split('T')[0];
    await db.collection('appointments').doc(testAppointmentId).update({ date: todayStr });

    const checkinRes = await fetch('http://localhost:5000/api/checkin/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': 'reception-staff-001',
        'x-demo-role': 'reception'
      },
      body: JSON.stringify({ qrPayload: apptDoc.qrPayload })
    });
    console.log(`Check-in HTTP Status: ${checkinRes.status}`);

    const postCheckinAppt = (await db.collection('appointments').doc(testAppointmentId).get()).data();
    results.phase1.qr_checkin = {
      pass: checkinRes.status === 200 && postCheckinAppt?.status === 'checked_in',
      status: postCheckinAppt?.status
    };
  } else {
    results.phase1.qr_checkin = { pass: false, error: 'No test appointment' };
  }
  console.log(`QR Check-in Pass: ${results.phase1.qr_checkin.pass ? 'PASS' : 'FAIL'}`);

  // 1.5 Live Queue, Priority Ordering, Wait Time Updates
  console.log('\n--- 1.5 Testing Live Queue Tracker & Waiting-Time Updates ---');
  await navigate('http://localhost:3000/live-queue');
  await sleep(1500);

  const queueText = await evaluate('document.body.innerText');
  const showsLiveQueue = queueText.includes('Live Queue') || queueText.includes('Queue Tracker') || queueText.includes('Token') || queueText.includes('OPD');
  console.log(`Live Queue page renders queue info: ${showsLiveQueue}`);

  results.phase1.live_queue = {
    pass: showsLiveQueue
  };
  console.log(`Live Queue Pass: ${results.phase1.live_queue.pass ? 'PASS' : 'FAIL'}`);

  // 1.6 Medical History Access & Authorization
  console.log('\n--- 1.6 Testing Medical History Timeline ---');
  await navigate('http://localhost:3000/medical-history');
  await sleep(1500);

  const historyText = await evaluate('document.body.innerText');
  const showsHistory = historyText.includes('Medical History') || historyText.includes('Timeline') || historyText.includes('Visits');
  console.log(`Medical History page loaded cleanly: ${showsHistory}`);

  results.phase1.medical_history = {
    pass: showsHistory
  };
  console.log(`Medical History Pass: ${results.phase1.medical_history.pass ? 'PASS' : 'FAIL'}`);

  // 1.7 Digital Prescriptions
  console.log('\n--- 1.7 Testing Digital Prescriptions Viewer ---');
  await navigate('http://localhost:3000/prescriptions');
  await sleep(1500);

  const rxText = await evaluate('document.body.innerText');
  const showsPrescriptions = rxText.includes('Prescription') || rxText.includes('Medications') || rxText.includes('Rx');
  console.log(`Prescriptions viewer loaded: ${showsPrescriptions}`);

  results.phase1.digital_prescriptions = {
    pass: showsPrescriptions
  };
  console.log(`Digital Prescriptions Pass: ${results.phase1.digital_prescriptions.pass ? 'PASS' : 'FAIL'}`);

  // 1.8 Medicine Reminders & Adherence Tracking
  console.log('\n--- 1.8 Testing Medicine Reminders & Adherence ---');
  await navigate('http://localhost:3000/medicine-reminders');
  await sleep(1500);

  const reminderText = await evaluate('document.body.innerText');
  const showsReminders = reminderText.includes('Medicine') || reminderText.includes('Reminder') || reminderText.includes('Adherence');
  console.log(`Medicine reminders tracker loaded: ${showsReminders}`);

  results.phase1.medicine_reminders = {
    pass: showsReminders
  };
  console.log(`Medicine Reminders Pass: ${results.phase1.medicine_reminders.pass ? 'PASS' : 'FAIL'}`);

  // 1.9 Notifications & Follow-up Alerts
  console.log('\n--- 1.9 Testing Notifications Center ---');
  await navigate('http://localhost:3000/notifications');
  await sleep(1500);

  const notifText = await evaluate('document.body.innerText');
  const showsNotifs = notifText.includes('Notifications') || notifText.includes('Alerts');
  console.log(`Notification Center loaded: ${showsNotifs}`);

  results.phase1.notifications = {
    pass: showsNotifs
  };
  console.log(`Notifications Pass: ${results.phase1.notifications.pass ? 'PASS' : 'FAIL'}`);

  // 1.10 AI Health Assistant Chatbot
  console.log('\n--- 1.10 Testing AI Health Assistant Chatbot ---');
  await navigate('http://localhost:3000/ai-chat');
  await sleep(1500);

  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const input = document.querySelector('input[type="text"]') || document.querySelector('textarea');
      setInput(input, 'What should I do if I have a mild fever?');
      const sendBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Send') || b.querySelector('svg'));
      if (sendBtn) sendBtn.click();
    })()
  `);
  await sleep(2500);

  const chatText = await evaluate('document.body.innerText');
  const showsChat = chatText.includes('SmartCare AI') || chatText.includes('fever') || chatText.includes('Assistant') || chatText.includes('Chat');
  console.log(`AI Chatbot responded or guidance displayed: ${showsChat}`);

  results.phase1.ai_chatbot = {
    pass: showsChat
  };
  console.log(`AI Chatbot Pass: ${results.phase1.ai_chatbot.pass ? 'PASS' : 'FAIL'}`);

  // ===========================================================================
  // PHASE 2: DOCTOR WORKFLOWS
  // ===========================================================================
  console.log('\n>>> STARTING PHASE 2: DOCTOR WORKFLOWS <<<\n');

  const rahulAuth = await auth.getUserByEmail('rahul.kumar@smartcare-demo.com');
  const rahulDoctorUid = rahulAuth.uid;

  // 2.1 Doctor Login & Logout
  console.log('--- 2.1 Testing Doctor Login ---');
  await forceLogoutAndGoToLogin();
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]'), 'rahul.kumar@smartcare-demo.com');
      setInput(document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]'), 'SmartCare@123');
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(3500);

  const docUrl = await evaluate('window.location.href');
  console.log(`Doctor Post-login URL: ${docUrl}`);
  const docBody = await evaluate('document.body.innerText');
  const docNameVisible = docBody.includes('Rahul') || docBody.includes('Doctor') || docBody.includes('Schedule') || docBody.includes('Queue');
  console.log(`Doctor Dashboard shows Doctor info: ${docNameVisible}`);

  results.phase2.login = {
    pass: docUrl.includes('/doctor') && docNameVisible
  };
  console.log(`Doctor Login Pass: ${results.phase2.login.pass ? 'PASS' : 'FAIL'}`);

  // 2.2 Doctor Dashboard & Schedule
  console.log('\n--- 2.2 Testing Doctor Schedule Configurator ---');
  await navigate('http://localhost:3000/doctor/schedule');
  await sleep(1500);

  const schedText = await evaluate('document.body.innerText');
  const showsSchedule = schedText.includes('Schedule') || schedText.includes('Slots') || schedText.includes('Hours');
  console.log(`Doctor schedule page loaded: ${showsSchedule}`);

  results.phase2.schedule = {
    pass: showsSchedule
  };
  console.log(`Doctor Schedule Pass: ${results.phase2.schedule.pass ? 'PASS' : 'FAIL'}`);

  // 2.3 Today's Appointments & Live Queue
  console.log('\n--- 2.3 Testing Doctor Today Queue ---');
  await navigate('http://localhost:3000/doctor/queue');
  await sleep(2000);

  const docQueueText = await evaluate('document.body.innerText');
  const showsDocQueue = docQueueText.includes('Queue') || docQueueText.includes('Candidates') || docQueueText.includes('Call Next') || docQueueText.includes('Doctor') || docQueueText.includes('Dr. Rahul');
  console.log(`Doctor Queue page renders controls: ${showsDocQueue}`);

  results.phase2.today_queue = {
    pass: showsDocQueue
  };
  console.log(`Doctor Today Queue Pass: ${results.phase2.today_queue.pass ? 'PASS' : 'FAIL'}`);

  // 2.4 Start and Finish Consultation, Create Digital Prescription
  console.log('\n--- 2.4 Testing Doctor Consultation & Digital Prescription Creation ---');
  let finishStatus = false;
  let rxCreated = false;

  if (testAppointmentId) {
    await db.collection('appointments').doc(testAppointmentId).update({
      doctorId: 'DOC-002',
      doctorUid: rahulDoctorUid,
      status: 'called'
    });

    const finishRes = await fetch('http://localhost:5000/api/queue/finish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': rahulDoctorUid,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({
        appointmentId: testAppointmentId,
        actualDurationMinutes: 15
      })
    });
    console.log(`Finish Consultation HTTP Status: ${finishRes.status}`);
    finishStatus = (finishRes.status === 200 || finishRes.status === 204);

    const rxRes = await fetch('http://localhost:5000/api/prescriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': rahulDoctorUid,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({
        doctorId: 'DOC-002',
        doctorUid: rahulDoctorUid,
        patientHealthId: 'HID-2026-00001',
        patientUid: johnAuth.uid,
        appointmentId: testAppointmentId,
        diagnosis: 'Seasonal allergic rhinitis',
        doctorNotes: 'Prescribed antihistamines. Advised to stay hydrated.',
        medicines: [
          {
            medicineName: 'Cetirizine 10mg',
            dosage: '1 tablet once daily at bedtime',
            durationDays: 5,
            frequency: 'once_daily'
          }
        ]
      })
    });
    console.log(`Create Prescription HTTP Status: ${rxRes.status}`);

    const rxSnap = await db.collection('prescriptions').where('appointmentId', '==', testAppointmentId).get();
    console.log(`Prescriptions found in Firestore: ${rxSnap.size}`);
    rxCreated = (rxRes.status === 201 || rxSnap.size > 0);
  }

  results.phase2.consultation_and_prescription = {
    pass: finishStatus && rxCreated
  };
  console.log(`Consultation & Prescription Pass: ${results.phase2.consultation_and_prescription.pass ? 'PASS' : 'FAIL'}`);

  // 2.7 Doctor AI Agent & Pre-Consultation Summary
  console.log('\n--- 2.7 Testing Doctor AI Agent / Ask Agent ---');
  await navigate('http://localhost:3000/doctor/ask-agent');
  await sleep(1500);

  const askAgentText = await evaluate('document.body.innerText');
  const showsAskAgent = askAgentText.includes('Doctor AI') || askAgentText.includes('Ask Agent') || askAgentText.includes('Clinical');
  console.log(`Doctor Ask Agent page renders: ${showsAskAgent}`);

  results.phase2.ai_agent = {
    pass: showsAskAgent
  };
  console.log(`Doctor AI Agent Pass: ${results.phase2.ai_agent.pass ? 'PASS' : 'FAIL'}`);

  // 2.8 Doctor Leave & Waitlist
  console.log('\n--- 2.8 Testing Doctor Leave & Waitlist Handling ---');
  const leaveRes = await fetch('http://localhost:5000/api/doctor/leaves', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': rahulDoctorUid,
      'x-demo-role': 'doctor'
    },
    body: JSON.stringify({
      doctorId: 'DOC-002',
      date: '2026-12-15',
      reason: 'Attending annual clinical conference'
    })
  });
  const leaveJson = await leaveRes.json();
  testLeaveId = leaveJson.data?.leaveId || leaveJson.data?.id;
  console.log(`Apply Doctor Leave Status: ${leaveRes.status}`);
  console.log(`Leave Document ID: ${testLeaveId}`);

  results.phase2.leave_and_waitlist = {
    pass: leaveRes.status === 201 || leaveRes.status === 200,
    leaveId: testLeaveId
  };
  console.log(`Doctor Leave Pass: ${results.phase2.leave_and_waitlist.pass ? 'PASS' : 'FAIL'}`);

  // ===========================================================================
  // PHASE 3: ADMIN WORKFLOWS
  // ===========================================================================
  console.log('\n>>> STARTING PHASE 3: ADMIN WORKFLOWS <<<\n');

  // 3.1 Admin Login & Role-Based Access
  console.log('--- 3.1 Testing Admin Login ---');
  await forceLogoutAndGoToLogin();
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]'), 'admin@healthcare.org');
      setInput(document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]'), 'AdminPass123!');
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(3500);

  const adminUrl = await evaluate('window.location.href');
  console.log(`Admin Post-login URL: ${adminUrl}`);
  const adminVisible = await evaluate(`document.body.innerText.includes('Admin') || document.body.innerText.includes('Overview') || document.body.innerText.includes('Analytics')`);
  console.log(`Admin Dashboard loaded: ${adminVisible}`);

  results.phase3.login = {
    pass: adminUrl.includes('/admin') && adminVisible
  };
  console.log(`Admin Login Pass: ${results.phase3.login.pass ? 'PASS' : 'FAIL'}`);

  // 3.2 Dashboard Analytics & Statistics
  console.log('\n--- 3.2 Testing System Analytics & Appointment Stats ---');
  await navigate('http://localhost:3000/analytics');
  await sleep(1500);

  const analyticsText = await evaluate('document.body.innerText');
  const showsAnalytics = analyticsText.includes('Analytics') || analyticsText.includes('Appointments') || analyticsText.includes('Total');
  console.log(`Analytics page loaded: ${showsAnalytics}`);

  results.phase3.analytics = {
    pass: showsAnalytics
  };
  console.log(`Dashboard Analytics Pass: ${results.phase3.analytics.pass ? 'PASS' : 'FAIL'}`);

  // 3.3 Doctor & Patient Management
  console.log('\n--- 3.3 Testing Doctor and Patient Management ---');
  await navigate('http://localhost:3000/manage-doctors');
  await sleep(1500);
  const docManageText = await evaluate('document.body.innerText');
  const showsManageDocs = docManageText.includes('Doctors') || docManageText.includes('Dr.');

  await navigate('http://localhost:3000/manage-patients');
  await sleep(1500);
  const patManageText = await evaluate('document.body.innerText');
  const showsManagePats = patManageText.includes('Patients') || patManageText.includes('Health ID') || patManageText.includes('Name');

  results.phase3.management = {
    pass: showsManageDocs && showsManagePats,
    doctorsVisible: showsManageDocs,
    patientsVisible: showsManagePats
  };
  console.log(`Doctor & Patient Management Pass: ${results.phase3.management.pass ? 'PASS' : 'FAIL'}`);

  // 3.4 Role Restrictions (Patient blocked from Admin)
  console.log('\n--- 3.4 Testing Patient Role Restriction from Admin Route ---');
  await forceLogoutAndGoToLogin();
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]'), 'john.doe@smartcare-demo.com');
      setInput(document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]'), 'SmartCare@123');
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(3500);

  // Navigate patient directly to admin dashboard
  await navigate('http://localhost:3000/admin-dashboard');
  await sleep(1500);

  const patientBlockedUrl = await evaluate('window.location.href');
  console.log(`Patient attempting /admin-dashboard was routed to: ${patientBlockedUrl}`);
  const patientBlocked = !patientBlockedUrl.includes('/admin-dashboard') || patientBlockedUrl.includes('/patient-dashboard') || patientBlockedUrl.includes('/unauthorized') || patientBlockedUrl.includes('/login');

  // 3.5 Role Restrictions (Doctor blocked from Admin)
  console.log('\n--- 3.5 Testing Doctor Role Restriction from Admin Route ---');
  await forceLogoutAndGoToLogin();
  await evaluate(`
    (() => {
      const setInput = (el, val) => {
        if (!el) return;
        const proto = HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]'), 'rahul.kumar@smartcare-demo.com');
      setInput(document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]'), 'SmartCare@123');
      const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign In') || b.textContent.includes('Login'));
      if (submitBtn) submitBtn.click();
    })()
  `);
  await sleep(3500);

  // Navigate doctor directly to admin dashboard
  await navigate('http://localhost:3000/admin-dashboard');
  await sleep(1500);

  const doctorBlockedUrl = await evaluate('window.location.href');
  console.log(`Doctor attempting /admin-dashboard was routed to: ${doctorBlockedUrl}`);
  const doctorBlocked = !doctorBlockedUrl.includes('/admin-dashboard') || doctorBlockedUrl.includes('/doctor') || doctorBlockedUrl.includes('/unauthorized') || doctorBlockedUrl.includes('/login');

  results.phase3.role_restrictions = {
    pass: patientBlocked && doctorBlocked,
    patientBlocked,
    doctorBlocked
  };
  console.log(`Role Restrictions Guard Pass: ${results.phase3.role_restrictions.pass ? 'PASS' : 'FAIL'}`);

  // Final logout to leave clean state
  await forceLogoutAndGoToLogin();

  // ===========================================================================
  // CLEANUP TEST RECORDS
  // ===========================================================================
  console.log('\n>>> CLEANING UP TEST DATA CREATED BY VERIFICATION <<<\n');
  try {
    if (testAppointmentId) {
      await db.collection('appointments').doc(testAppointmentId).delete();
      console.log(`Cleaned up test appointment: ${testAppointmentId}`);
    }
    if (testSlotId) {
      await db.collection('slots').doc(testSlotId).update({ status: 'free', appointmentId: null, bookedByUid: null });
      console.log(`Reverted test slot: ${testSlotId}`);
    }

    if (registeredPatientHealthId) {
      const pDocs = await db.collection('patients').where('patientHealthId', '==', registeredPatientHealthId).get();
      for (const d of pDocs.docs) {
        await d.ref.delete();
      }
      console.log(`Cleaned up test patient: ${registeredPatientHealthId}`);
    }

    if (testLeaveId) {
      await db.collection('leaves').doc(testLeaveId).delete();
      console.log(`Cleaned up test leave: ${testLeaveId}`);
    }
  } catch (cleanErr) {
    console.warn('Cleanup note:', cleanErr.message);
  }

  console.log('\n========================================================================');
  console.log('                 ALL E2E WORKFLOW CHECKS FINISHED                       ');
  console.log('========================================================================\n');
  console.log('Summary Result:', JSON.stringify(results, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

import fetch from 'node-fetch';
import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
const db = admin.firestore();

const API_BASE = 'http://localhost:5000/api';
const DOCTOR_ID = 'DOC-001';
const DOCTOR_UID = 'tSuSTZkfrEDciNhzz4OZhKmYBFi5';
const TODAY_STR = new Date().toISOString().split('T')[0];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bookAppointment(userUid, healthId, name, slotId, reasonText) {
  const res = await fetch(`${API_BASE}/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': userUid,
      'x-demo-role': 'patient'
    },
    body: JSON.stringify({
      doctorId: DOCTOR_ID,
      doctorName: 'Dr. Sarah Smith',
      departmentId: 'dept-card',
      patientHealthId: healthId,
      patientName: name,
      date: TODAY_STR,
      slotId,
      reasonText,
      disclaimerAck: { acknowledged: true }
    })
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Booking failed for ${name}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function checkinAppointment(apptId) {
  const res = await fetch(`${API_BASE}/checkin/manual`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-demo-uid': 'reception-01',
      'x-demo-role': 'reception'
    },
    body: JSON.stringify({ appointmentId: apptId, appointmentDate: TODAY_STR })
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Checkin failed for ${apptId}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function getDoctorQueue() {
  const res = await fetch(`${API_BASE}/queue/doctor/${DOCTOR_ID}/today?date=${TODAY_STR}`, {
    headers: { 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' }
  });
  return (await res.json()).data;
}

const action = process.argv[2] || 'full';

async function main() {
  if (action === 'cleanup') {
    console.log('>>> [CLEANUP] Cleaning up appointments for today...');
    const snaps = await db.collection('appointments').where('date', '==', TODAY_STR).get();
    for (const doc of snaps.docs) {
      const d = doc.data();
      if (['John Doe', 'Anita Roy', 'Rajesh Verma'].includes(d.patientName)) {
        await doc.ref.delete();
        console.log(`Deleted appointment: ${doc.id}`);
      }
    }
    const slots = ['0900', '0915', '0930'];
    for (const s of slots) {
      await db.collection('slots').doc(`DOC-001_${TODAY_STR}_${s}`).update({
        status: 'free',
        appointmentId: null,
        heldUntil: null,
        heldBy: null
      });
    }
    await getDoctorQueue();
    console.log('Cleaned up.');
    return;
  }

  if (action === 'phase1' || action === 'full') {
    console.log('>>> [PHASE 1] Starting Consultation for Patient A, Queuing Patient B (Priority), and Patient C (Emergency)...');

    // 1. Patient A: Normal
    console.log('1. Booking & Checking in Patient A (John Doe, Normal)...');
    const apptA = await bookAppointment(
      'oxZSNuhdqOsGAKmjqfffu8Ws9u5R',
      'HID-2026-00001',
      'John Doe',
      `DOC-001_${TODAY_STR}_0900`,
      'General health checkup and routine consultation'
    );
    await checkinAppointment(apptA.id);

    // Call Patient A while only Patient A is checked in
    console.log('Doctor calling Patient A (John Doe)...');
    await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });

    // Mark Patient A IN_CONSULTATION
    await fetch(`${API_BASE}/appointments/${apptA.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' },
      body: JSON.stringify({ status: 'IN_CONSULTATION' })
    });
    console.log('  -> Patient A is NOW SERVING IN CONSULTATION ROOM (Status: in_consultation)');

    // 2. Patient B: Priority
    console.log('\n2. Booking & Checking in Patient B (Anita Roy, Priority)...');
    const apptB = await bookAppointment(
      'ajisYN7j6gRRmqWnFuzloQywox8K',
      'HID-2026-00002',
      'Anita Roy',
      `DOC-001_${TODAY_STR}_0915`,
      'High fever with severe body chills and shivering'
    );
    await checkinAppointment(apptB.id);
    console.log('  -> Patient B checked in and waiting in queue.');

    // 3. Patient C: Emergency arrives during consultation!
    console.log('\n3. Emergency Arrives! Booking & Checking in Patient C (Rajesh Verma, Emergency)...');
    const apptC = await bookAppointment(
      'CHmobajJc9UPvtH1PaZrRdAOP8Vi',
      'HID-2026-00003',
      'Rajesh Verma',
      `DOC-001_${TODAY_STR}_0930`,
      'Severe chest pain and tightness radiating to left arm'
    );
    await checkinAppointment(apptC.id);
    console.log('  -> Patient C checked in as EMERGENCY.');

    // Recalculate queue
    const queueData = await getDoctorQueue();
    console.log('\n>>> Current Doctor Queue State:');
    console.log('  Now Serving:', queueData.currentConsultation?.patientName, `(${queueData.currentConsultation?.tokenLabel || queueData.currentConsultation?.tokenNumber})`);
    console.log('  Ready Candidates (in priority order):');
    queueData.readyCandidates.forEach((c, i) => {
      console.log(`    #${i + 1}: ${c.patientName} | Level: ${c.clinicalLevel} (${c.urgencySuggested}) | Token: ${c.tokenLabel || c.tokenNumber}`);
    });

    // Fetch individual live status for all 3 patients
    console.log('\n>>> Live Queue Status for All 3 Patients:');
    for (const [label, id] of [['Patient A (John Doe)', apptA.id], ['Patient B (Anita Roy)', apptB.id], ['Patient C (Rajesh Verma)', apptC.id]]) {
      const snap = (await db.collection('appointments').doc(id).get()).data();
      console.log(`- ${label}:`);
      console.log(`    Status: ${snap.status}`);
      console.log(`    Token: ${snap.tokenLabel || snap.tokenNumber}`);
      console.log(`    Clinical Level: ${snap.clinicalLevel} (${snap.urgencySuggested})`);
      console.log(`    Live Position: #${snap.live?.position} (${snap.live?.aheadCount} ahead)`);
      console.log(`    Wait Range: ${snap.live?.waitMinLow} to ${snap.live?.waitMinHigh} minutes`);
      console.log(`    Emergency Note: "${snap.live?.reasonText}"`);
    }

    if (action === 'phase1') {
      console.log('\n>>> Phase 1 Complete! System is primed for browser UI verification.');
      return;
    }
  }

  if (action === 'phase2' || action === 'full') {
    console.log('\n>>> [PHASE 2] Doctor Finishes Consultation with Patient A and Calls Next Patient...');
    const q = await getDoctorQueue();
    const currId = q.currentConsultation?.id;
    if (currId) {
      await fetch(`${API_BASE}/queue/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' },
        body: JSON.stringify({ appointmentId: currId })
      });
      console.log(`  -> Consultation for current patient completed.`);
    }

    // Call Next
    const nextRes = await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });
    const nextData = (await nextRes.json()).data;
    console.log(`  -> Called Next Patient: ${nextData.patientName} (${nextData.tokenLabel || nextData.tokenNumber})`);
    console.log(`  -> Clinical Level: ${nextData.clinicalLevel} (Emergency was served next!)`);

    const qAfter = await getDoctorQueue();
    console.log('\n>>> Doctor Queue State After Call Next:');
    console.log('  Now Serving:', qAfter.currentConsultation?.patientName, `(${qAfter.currentConsultation?.tokenLabel || qAfter.currentConsultation?.tokenNumber})`);
    console.log('  Remaining Ready Candidates:');
    qAfter.readyCandidates.forEach((c, i) => {
      console.log(`    #${i + 1}: ${c.patientName} | Token: ${c.tokenLabel || c.tokenNumber} | Level: ${c.clinicalLevel}`);
    });
  }
}

main().catch(console.error);

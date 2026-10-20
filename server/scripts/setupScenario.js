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

async function main() {
  console.log('>>> [SETUP] Booking and checking in Patients A, B, and C...');

  const patientConfigs = [
    {
      label: 'Patient A (NORMAL / ROUTINE)',
      uid: 'oxZSNuhdqOsGAKmjqfffu8Ws9u5R',
      healthId: 'HID-2026-00001',
      name: 'John Doe',
      slotId: `DOC-001_${TODAY_STR}_0900`,
      reasonText: 'General health checkup and routine consultation',
      expectedClinicalLevel: 1
    },
    {
      label: 'Patient B (PRIORITY / URGENT)',
      uid: 'ajisYN7j6gRRmqWnFuzloQywox8K',
      healthId: 'HID-2026-00002',
      name: 'Anita Roy',
      slotId: `DOC-001_${TODAY_STR}_0915`,
      reasonText: 'High fever with severe body chills and shivering',
      expectedClinicalLevel: 2
    },
    {
      label: 'Patient C (EMERGENCY)',
      uid: 'CHmobajJc9UPvtH1PaZrRdAOP8Vi',
      healthId: 'HID-2026-00003',
      name: 'Rajesh Verma',
      slotId: `DOC-001_${TODAY_STR}_0930`,
      reasonText: 'Severe chest pain and tightness radiating to left arm',
      expectedClinicalLevel: 3
    }
  ];

  const results = [];

  for (const p of patientConfigs) {
    console.log(`Booking for ${p.label}...`);
    const bookRes = await fetch(`${API_BASE}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': p.uid,
        'x-demo-role': 'patient'
      },
      body: JSON.stringify({
        doctorId: DOCTOR_ID,
        doctorName: 'Dr. Sarah Smith',
        departmentId: 'dept-card',
        patientHealthId: p.healthId,
        patientName: p.name,
        date: TODAY_STR,
        slotId: p.slotId,
        reasonText: p.reasonText,
        disclaimerAck: { acknowledged: true }
      })
    });

    const bookJson = await bookRes.json();
    if (!bookRes.ok || !bookJson.success) {
      throw new Error(`Booking failed for ${p.name}: ${JSON.stringify(bookJson)}`);
    }

    const apptData = bookJson.data;
    const stored = (await db.collection('appointments').doc(apptData.id).get()).data();

    results.push({
      ...p,
      apptId: apptData.id,
      token: stored.tokenLabel || stored.tokenNumber,
      clinicalLevel: stored.clinicalLevel,
      urgencySuggested: stored.urgencySuggested
    });
  }

  console.log('\n>>> Sequential Check-in: Order A -> B -> C...');
  for (let i = 0; i < results.length; i++) {
    const p = results[i];
    console.log(`Checking in [${i + 1}/3] ${p.name} (${p.label})...`);
    const checkinRes = await fetch(`${API_BASE}/checkin/manual`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': 'reception-demo-01',
        'x-demo-role': 'reception'
      },
      body: JSON.stringify({
        appointmentId: p.apptId,
        appointmentDate: TODAY_STR
      })
    });

    const checkinJson = await checkinRes.json();
    if (!checkinRes.ok || !checkinJson.success) {
      throw new Error(`Checkin failed: ${JSON.stringify(checkinJson)}`);
    }

    const fresh = (await db.collection('appointments').doc(p.apptId).get()).data();
    p.checkedInAt = fresh.checkedInAt;
    p.status = fresh.status;
    p.live = fresh.live;

    await sleep(1000);
  }

  // Recalculate queue
  await fetch(`${API_BASE}/queue/doctor/${DOCTOR_ID}/today?date=${TODAY_STR}`, {
    headers: { 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' }
  });

  console.log('\n>>> Setup complete! Created appointments:');
  for (const r of results) {
    const fresh = (await db.collection('appointments').doc(r.apptId).get()).data();
    console.log(`- ${r.name} (${r.label}):`);
    console.log(`    Appt ID: ${r.apptId}`);
    console.log(`    Token: ${r.token}`);
    console.log(`    Clinical Level: ${r.clinicalLevel}`);
    console.log(`    Status: ${fresh.status}`);
    console.log(`    Live Position: #${fresh.live?.position} (${fresh.live?.aheadCount} ahead)`);
    console.log(`    Wait: ${fresh.live?.waitMinLow} to ${fresh.live?.waitMinHigh} min`);
    console.log(`    Checked-in: ${fresh.checkedInAt}`);
  }
}

main().catch(console.error);

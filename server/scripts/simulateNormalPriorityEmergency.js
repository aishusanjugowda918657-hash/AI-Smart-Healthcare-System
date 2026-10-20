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

async function runScenario() {
  console.log('========================================================================');
  console.log(' QUICK E2E TEST: NORMAL vs PRIORITY vs EMERGENCY PATIENT QUEUE BEHAVIOR ');
  console.log('========================================================================\n');
  console.log(`Target Date: ${TODAY_STR}`);
  console.log(`Target Doctor: Dr. Sarah Smith (${DOCTOR_ID})\n`);

  const createdApptIds = [];
  const bookedSlotIds = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Patient Arrival & Classification
    // -------------------------------------------------------------------------
    console.log('>>> TEST 1: Booking 3 appointments with server-side triage classification...\n');

    const patientConfigs = [
      {
        label: 'Patient A (NORMAL / ROUTINE)',
        uid: 'oxZSNuhdqOsGAKmjqfffu8Ws9u5R',
        healthId: 'HID-2026-00001',
        name: 'John Doe',
        email: 'john.doe@smartcare-demo.com',
        slotId: `DOC-001_${TODAY_STR}_0900`,
        reasonText: 'General health checkup and routine consultation',
        expectedClinicalLevel: 1,
        expectedClassification: 'routine'
      },
      {
        label: 'Patient B (PRIORITY / URGENT)',
        uid: 'ajisYN7j6gRRmqWnFuzloQywox8K',
        healthId: 'HID-2026-00002',
        name: 'Anita Roy',
        email: 'anita.roy@smartcare-demo.com',
        slotId: `DOC-001_${TODAY_STR}_0915`,
        reasonText: 'High fever with severe body chills and shivering',
        expectedClinicalLevel: 2,
        expectedClassification: 'urgent'
      },
      {
        label: 'Patient C (EMERGENCY)',
        uid: 'CHmobajJc9UPvtH1PaZrRdAOP8Vi',
        healthId: 'HID-2026-00003',
        name: 'Rajesh Verma',
        email: 'rajesh.verma@smartcare-demo.com',
        slotId: `DOC-001_${TODAY_STR}_0930`,
        reasonText: 'Severe chest pain and tightness radiating to left arm',
        expectedClinicalLevel: 3,
        expectedClassification: 'emergency'
      }
    ];

    const bookedPatients = [];

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
      createdApptIds.push(apptData.id || apptData.appointmentId);
      bookedSlotIds.push(p.slotId);

      // Verify server-side clinical level enforcement
      const storedSnap = await db.collection('appointments').doc(apptData.id).get();
      const stored = storedSnap.data();

      console.log(`  -> Appointment ID: ${apptData.id}`);
      console.log(`  -> Token: ${stored.tokenLabel || stored.tokenNumber}`);
      console.log(`  -> Stored Clinical Level: ${stored.clinicalLevel} (Expected: ${p.expectedClinicalLevel})`);
      console.log(`  -> Urgency: ${stored.urgencySuggested} (Expected: ${p.expectedClassification})\n`);

      if (stored.clinicalLevel !== p.expectedClinicalLevel) {
        throw new Error(`Clinical level mismatch for ${p.name}: got ${stored.clinicalLevel}, expected ${p.expectedClinicalLevel}`);
      }

      bookedPatients.push({
        ...p,
        apptId: apptData.id,
        token: stored.tokenLabel || stored.tokenNumber,
        qrPayload: stored.qrPayload
      });
    }

    // -------------------------------------------------------------------------
    // Sequential Check-in: Order A -> B -> C
    // -------------------------------------------------------------------------
    console.log('>>> Checking in patients sequentially in order A -> B -> C...\n');

    for (let i = 0; i < bookedPatients.length; i++) {
      const p = bookedPatients[i];
      console.log(`Checking in [${i + 1}/3] ${p.label} at ${new Date().toISOString()}...`);

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
        throw new Error(`Check-in failed for ${p.name}: ${JSON.stringify(checkinJson)}`);
      }

      const freshDoc = (await db.collection('appointments').doc(p.apptId).get()).data();
      p.checkedInAt = freshDoc.checkedInAt;
      console.log(`  -> Status: ${freshDoc.status}`);
      console.log(`  -> CheckedInAt: ${p.checkedInAt}\n`);

      // Ensure distinct timestamps for arrival order
      await sleep(1000);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Inspect Doctor Dashboard Queue Prioritization
    // -------------------------------------------------------------------------
    console.log('>>> TEST 2: Doctor Dashboard Queue Inspection...\n');

    const queueRes = await fetch(`${API_BASE}/queue/doctor/${DOCTOR_ID}/today?date=${TODAY_STR}`, {
      headers: {
        'x-demo-uid': DOCTOR_UID,
        'x-demo-role': 'doctor'
      }
    });

    const queueJson = await queueRes.json();
    if (!queueRes.ok || !queueJson.success) {
      throw new Error(`Failed to fetch doctor queue: ${JSON.stringify(queueJson)}`);
    }

    const { readyCandidates } = queueJson.data;
    console.log(`Total Ready Waiting Patients: ${readyCandidates.length}`);

    readyCandidates.forEach((c, idx) => {
      console.log(`  Position #${idx + 1}: ${c.patientName} | Level ${c.clinicalLevel} (${c.urgencySuggested}) | Token: ${c.tokenLabel || c.tokenNumber} | CheckedIn: ${c.checkedInAt}`);
    });
    console.log('');

    // Verification of Priority Engine Rules:
    // Emergency (Patient C) MUST be position #1
    // Priority (Patient B) MUST be position #2
    // Normal (Patient A) MUST be position #3
    if (readyCandidates[0].id !== bookedPatients[2].apptId) {
      throw new Error(`Emergency Preemption Failed! Expected Patient C at #1, got: ${readyCandidates[0].patientName}`);
    }
    if (readyCandidates[1].id !== bookedPatients[1].apptId) {
      throw new Error(`Priority Ordering Failed! Expected Patient B at #2, got: ${readyCandidates[1].patientName}`);
    }
    if (readyCandidates[2].id !== bookedPatients[0].apptId) {
      throw new Error(`Normal Ordering Failed! Expected Patient A at #3, got: ${readyCandidates[2].patientName}`);
    }

    console.log('✅ PREEMPTION VERIFIED: Patient C (Emergency) preempts Patient B and Patient A despite arriving last!\n');

    // -------------------------------------------------------------------------
    // TEST 3: Pre-Call Patient Waiting-Time Screens Status
    // -------------------------------------------------------------------------
    console.log('>>> TEST 3: Pre-Call Patient Waiting-Time Statuses...\n');

    const preCallWaitStatus = {};
    for (const p of bookedPatients) {
      const snap = await db.collection('appointments').doc(p.apptId).get();
      const data = snap.data();
      preCallWaitStatus[p.name] = {
        token: data.tokenLabel || data.tokenNumber,
        position: data.live?.position,
        aheadCount: data.live?.aheadCount,
        waitMinLow: data.live?.waitMinLow,
        waitMinHigh: data.live?.waitMinHigh,
        reasonText: data.live?.reasonText,
        status: data.status
      };
      console.log(`[PRE-CALL] ${p.name}:`);
      console.log(`  Token: ${preCallWaitStatus[p.name].token}`);
      console.log(`  Queue Position: #${preCallWaitStatus[p.name].position} (${preCallWaitStatus[p.name].aheadCount} ahead)`);
      console.log(`  Wait Time Range: ${preCallWaitStatus[p.name].waitMinLow} to ${preCallWaitStatus[p.name].waitMinHigh} minutes`);
      console.log(`  Status: ${preCallWaitStatus[p.name].status}`);
      console.log(`  Clinical Note: ${preCallWaitStatus[p.name].reasonText}\n`);
    }

    // -------------------------------------------------------------------------
    // Execute CALL NEXT (Doctor calls the next patient)
    // -------------------------------------------------------------------------
    console.log('>>> Doctor triggers CALL NEXT (/api/queue/call-next)...\n');

    const callRes = await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': DOCTOR_UID,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });

    const callJson = await callRes.json();
    if (!callRes.ok || !callJson.success) {
      throw new Error(`Call next failed: ${JSON.stringify(callJson)}`);
    }

    const calledPatient = callJson.data;
    console.log(`Called Patient: ${calledPatient.patientName} (${calledPatient.tokenLabel || calledPatient.tokenNumber})`);
    console.log(`New Status: ${calledPatient.status} at ${calledPatient.calledAt}\n`);

    if (calledPatient.id !== bookedPatients[2].apptId) {
      throw new Error(`CALL NEXT ERROR: Expected Patient C (Emergency) to be called, but got: ${calledPatient.patientName}`);
    }
    console.log('✅ CALL NEXT ACCURACY VERIFIED: Patient C (Emergency) was called first!\n');

    // -------------------------------------------------------------------------
    // Post-Call Patient Waiting-Time Screens Status
    // -------------------------------------------------------------------------
    console.log('>>> TEST 3 (POST-CALL): Recalculated Patient Waiting-Time Statuses...\n');

    const postCallWaitStatus = {};
    for (const p of bookedPatients) {
      const snap = await db.collection('appointments').doc(p.apptId).get();
      const data = snap.data();
      postCallWaitStatus[p.name] = {
        token: data.tokenLabel || data.tokenNumber,
        position: data.live?.position,
        aheadCount: data.live?.aheadCount,
        waitMinLow: data.live?.waitMinLow,
        waitMinHigh: data.live?.waitMinHigh,
        reasonText: data.live?.reasonText,
        status: data.status
      };
      console.log(`[POST-CALL] ${p.name}:`);
      console.log(`  Token: ${postCallWaitStatus[p.name].token}`);
      console.log(`  Queue Position: ${postCallWaitStatus[p.name].position ? '#' + postCallWaitStatus[p.name].position : 'IN CONSULTATION / CALLED'} (${postCallWaitStatus[p.name].aheadCount ?? 0} ahead)`);
      console.log(`  Wait Time Range: ${postCallWaitStatus[p.name].waitMinLow ?? 0} to ${postCallWaitStatus[p.name].waitMinHigh ?? 0} minutes`);
      console.log(`  Status: ${postCallWaitStatus[p.name].status}\n`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Regression Checks (Call Next Idempotency & Bypass Safety)
    // -------------------------------------------------------------------------
    console.log('>>> TEST 4: Testing Call Next Idempotency & Active Patient Guard...\n');

    // Call Next again should call Patient B (Priority)
    const callRes2 = await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': DOCTOR_UID,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });
    const callJson2 = await callRes2.json();
    if (!callRes2.ok || !callJson2.success) {
      throw new Error(`Second Call Next failed: ${JSON.stringify(callJson2)}`);
    }
    console.log(`Second Called Patient: ${callJson2.data.patientName} (Expected: Anita Roy / Patient B)`);
    if (callJson2.data.id !== bookedPatients[1].apptId) {
      throw new Error(`Expected Patient B to be called second, got ${callJson2.data.patientName}`);
    }
    console.log('✅ REPEATED CALL GUARD VERIFIED: Does not re-call Patient C, advances to Patient B.\n');

    // Call Next a third time should call Patient A (Normal)
    const callRes3 = await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': DOCTOR_UID,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });
    const callJson3 = await callRes3.json();
    if (!callRes3.ok || !callJson3.success) {
      throw new Error(`Third Call Next failed: ${JSON.stringify(callJson3)}`);
    }
    console.log(`Third Called Patient: ${callJson3.data.patientName} (Expected: John Doe / Patient A)`);
    if (callJson3.data.id !== bookedPatients[0].apptId) {
      throw new Error(`Expected Patient A to be called third, got ${callJson3.data.patientName}`);
    }

    // A fourth call should return 404 NO_READY_CANDIDATES
    const callRes4 = await fetch(`${API_BASE}/queue/call-next`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-uid': DOCTOR_UID,
        'x-demo-role': 'doctor'
      },
      body: JSON.stringify({ doctorId: DOCTOR_ID, date: TODAY_STR })
    });
    console.log(`Fourth Call Status (Empty Queue): ${callRes4.status} (Expected: 404)`);
    if (callRes4.status !== 404) {
      throw new Error(`Expected 404 on empty queue, got ${callRes4.status}`);
    }
    console.log('✅ EMPTY QUEUE GUARD VERIFIED: Returns 404 when no candidates remain.\n');

    // -------------------------------------------------------------------------
    // Summary Output
    // -------------------------------------------------------------------------
    console.log('========================================================================');
    console.log('                        ALL E2E SCENARIO TESTS PASSED                   ');
    console.log('========================================================================\n');

    return {
      success: true,
      bookedPatients,
      preCallWaitStatus,
      postCallWaitStatus,
      calledOrder: [
        callJson.data.patientName,
        callJson2.data.patientName,
        callJson3.data.patientName
      ]
    };

  } finally {
    // -------------------------------------------------------------------------
    // Clean up temporary test records created by this scenario
    // -------------------------------------------------------------------------
    console.log('>>> Cleaning up test appointments and reverting slots...\n');
    for (const id of createdApptIds) {
      try {
        await db.collection('appointments').doc(id).delete();
        console.log(`  Deleted test appointment: ${id}`);
      } catch (e) {
        console.error(`  Error deleting appointment ${id}:`, e.message);
      }
    }

    for (const slotId of bookedSlotIds) {
      try {
        await db.collection('slots').doc(slotId).update({
          status: 'free',
          appointmentId: null,
          heldUntil: null,
          heldBy: null,
          updatedAt: new Date()
        });
        console.log(`  Reverted test slot to free: ${slotId}`);
      } catch (e) {
        console.error(`  Error reverting slot ${slotId}:`, e.message);
      }
    }

    // Recalculate queue to restore clean queue state
    await fetch(`${API_BASE}/queue/doctor/${DOCTOR_ID}/today?date=${TODAY_STR}`, {
      headers: { 'x-demo-uid': DOCTOR_UID, 'x-demo-role': 'doctor' }
    });
    console.log('  Cleaned up and recalculated doctor queue.\n');
  }
}

runScenario()
  .then((result) => {
    console.log('Scenario Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Scenario Failed:', err);
    process.exit(1);
  });

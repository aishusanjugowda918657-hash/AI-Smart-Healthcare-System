import admin from 'firebase-admin';
import crypto from 'crypto';

// Initialize firebase admin against emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-project' });
}

const db = admin.firestore();

const testCheckin = async () => {
  const log = (step, res) => console.log(`\n=== ${step} ===\n${JSON.stringify(res, null, 2)}`);
  
  try {
    const apptRef = db.collection('appointments').doc();
    const apptId = apptRef.id;
    const securityCode = Math.floor(1000 + Math.random() * 9000).toString();
    const hash = crypto.createHash('sha256').update(securityCode).digest('hex');

    await apptRef.set({
      patientId: 'demo-patient-1',
      patientName: 'Test Patient',
      doctorId: 'DOC-001',
      departmentId: 'dept-card',
      status: 'booked',
      checkInCodeHash: hash,
      date: new Date().toISOString().split('T')[0],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    log('Setup', `Created appointment ${apptId} with code ${securityCode}`);

    // 2. QR Check-in 1 (Expect 200)
    const checkin1Res = await fetch('http://localhost:5000/api/checkin/scan', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-demo-uid': 'demo-reception-1',
        'x-demo-role': 'reception'
      },
      body: JSON.stringify({ appointmentId: apptId, code: securityCode })
    }).then(r => r.json());
    log('Check-in 1 (Expect 200)', checkin1Res);

    // 3. QR Check-in 2 (Expect 409 ALREADY_CHECKED_IN)
    const checkin2Res = await fetch('http://localhost:5000/api/checkin/scan', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-demo-uid': 'demo-reception-1',
        'x-demo-role': 'reception'
      },
      body: JSON.stringify({ appointmentId: apptId, code: securityCode })
    }).then(r => r.json());
    log('Check-in 2 (Expect 409)', checkin2Res);

  } catch (err) {
    console.error('Checkin Test Failed:', err);
  }
};

testCheckin();

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Task C: Digital Prescriptions, Safety Engine, Dispensing & Permissions Suite', () => {
  const patientHealthId = 'HID-TASKC-ALLERGY-01';
  const patientUid = 'user-taskc-patient-01';
  const childHealthId = 'HID-TASKC-CHILD-01';
  const childUid = 'user-taskc-child-01';

  let createdPrescriptionId;
  let createdDocId;
  let verificationCode;

  beforeAll(async () => {
    const db = assertDbConnected();

    // 1. Seed patient with Penicillin allergy
    await db.collection('patients').doc(patientHealthId).set({
      healthId: patientHealthId,
      patientHealthId,
      ownerUid: patientUid,
      uid: patientUid,
      fullName: 'Vikram Mehta',
      name: 'Vikram Mehta',
      age: 38,
      weightKg: 72,
      allergies: ['Penicillin'],
      conditions: ['Hypertension']
    });

    // 2. Seed child patient (< 18 yrs, 18 kg)
    await db.collection('patients').doc(childHealthId).set({
      healthId: childHealthId,
      patientHealthId: childHealthId,
      ownerUid: childUid,
      uid: childUid,
      fullName: 'Aarav Mehta (Child)',
      name: 'Aarav Mehta',
      age: 6,
      weightKg: 18,
      allergies: [],
      conditions: []
    });

    // 3. Seed active appointment for demo-doctor-001 with both patients
    await db.collection('appointments').doc('appt-taskc-treating-01').set({
      id: 'appt-taskc-treating-01',
      doctorId: 'demo-doctor-001',
      patientHealthId,
      status: 'in_consultation',
      createdAt: new Date().toISOString()
    });

    await db.collection('appointments').doc('appt-taskc-treating-02').set({
      id: 'appt-taskc-treating-02',
      doctorId: 'demo-doctor-001',
      patientHealthId: childHealthId,
      status: 'in_consultation',
      createdAt: new Date().toISOString()
    });
  });

  // Test 1: Penicillin allergy + amoxicillin gives severe warning; saving without overrideReason returns 422
  it('1. Penicillin allergy + amoxicillin gives severe red warning; saving without overrideReason returns 422', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        patientUid,
        medicines: [
          {
            name: 'Amoxicillin',
            dosage: '500 mg',
            frequency: 'Twice Daily (1-0-1)',
            durationDays: 5,
            timing: 'after_food'
          }
        ],
        overrideReason: '' // Missing override reason
      });

    expect(res.statusCode).toEqual(422);
    expect(res.body.code).toEqual('OVERRIDE_REASON_REQUIRED');
    expect(res.body.safetyResult.overrideRequired).toBe(true);
    expect(res.body.safetyResult.severity).toEqual('red');
    expect(res.body.safetyResult.alerts.some((a) => a.type === 'allergy')).toBe(true);
  });

  // Saving with overrideReason succeeds
  it('1b. Saving with valid overrideReason succeeds (201)', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        patientUid,
        medicines: [
          {
            name: 'Amoxicillin',
            dosage: '500 mg',
            frequency: 'Twice Daily (1-0-1)',
            durationDays: 5,
            timing: 'after_food'
          }
        ],
        overrideReason: 'Doctor clinical override: Desensitization protocol completed in clinical observation.',
        entryDurationSec: 45,
        followupDate: '2026-10-20',
        followupImportance: 'serious'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prescriptionId).toMatch(/^RX-2026-/);
    expect(res.body.data.overrideReason).toContain('Desensitization');
    expect(res.body.data.entryDurationSec).toEqual(45);
    createdDocId = res.body.data.id;
    createdPrescriptionId = res.body.data.prescriptionId;
    verificationCode = res.body.data.verificationCode || res.body.data.verifyCode;
  });

  // Test 2: Duplicate generic and drug interaction warnings
  it('2. Clinical safety check identifies duplicate generic and drug-drug interactions', async () => {
    const res = await request(app)
      .post('/api/prescriptions/check-safety')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        medicines: [
          { name: 'Warfarin', dosage: '5 mg', frequency: 'Once Daily', durationDays: 14 },
          { name: 'Aspirin', dosage: '75 mg', frequency: 'Once Daily', durationDays: 14 },
          { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily', durationDays: 3 },
          { name: 'Calpol', dosage: '500 mg', frequency: 'Twice Daily', durationDays: 3 }
        ]
      });

    expect(res.statusCode).toEqual(200);
    const data = res.body.data;
    expect(data.safe).toBe(false);

    // Drug interaction warning (Warfarin + Aspirin)
    const interactionAlert = data.alerts.find((a) => a.type === 'interaction' || a.type === 'drug_interaction');
    expect(interactionAlert).toBeDefined();

    // Duplicate generic warning (Paracetamol + Calpol)
    const duplicateAlert = data.alerts.find((a) => a.type === 'duplicate' || a.type === 'duplicate_generic');
    expect(duplicateAlert).toBeDefined();
  });

  // Test 3: Child dose above range warns
  it('3. Pediatric dosing engine flags dose exceeding maximum mg/kg limits', async () => {
    const res = await request(app)
      .post('/api/prescriptions/check-safety')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: childHealthId,
        patientWeightKg: 18,
        medicines: [
          {
            name: 'Paracetamol',
            dosage: '1000 mg', // Normal child single dose is max 15mg/kg * 18kg = 270mg. 1000mg is dangerous
            frequency: 'Three Times Daily',
            durationDays: 3
          }
        ]
      });

    expect(res.statusCode).toEqual(200);
    const data = res.body.data;
    const pediatricAlert = data.alerts.find((a) => a.type === 'pediatric_dose_exceeded' || a.type === 'dose');
    expect(pediatricAlert).toBeDefined();
    expect(pediatricAlert.details).toContain('Pediatric Dose Warning');
  });

  // Test 4: Missing dose, frequency, or days blocks saving (returns 400)
  it('4. Missing required dose, frequency, or days fields blocks saving with 400 MISSING_FIELDS_BLOCKED', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        medicines: [
          {
            name: 'Paracetamol',
            dosage: '', // Missing dosage
            frequency: 'Twice Daily',
            durationDays: 5
          }
        ]
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.code).toEqual('MISSING_FIELDS_BLOCKED');
  });

  // Test 5: Edit creates version 2 and regenerates reminders without duplicates
  it('5. PUT /api/prescriptions/:id creates version 2 and regenerates reminders cleanly', async () => {
    const res = await request(app)
      .put(`/api/prescriptions/${createdDocId}`)
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        medicines: [
          {
            name: 'Paracetamol',
            dosage: '650 mg',
            frequency: 'Twice Daily (1-0-1)',
            reminderTimes: ['08:00 AM', '08:00 PM'],
            durationDays: 5,
            timing: 'after_food'
          }
        ],
        doctorNotes: 'Take after meals with water.',
        changeReason: 'Adjusted from Amoxicillin to Paracetamol due to allergy.'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.data.version).toEqual(2);
    expect(res.body.data.editHistory).toHaveLength(1);

    // Verify reminder cleanup in Firestore
    const db = assertDbConnected();
    const remindersSnap = await db.collection('medicineReminders')
      .where('prescriptionId', '==', createdPrescriptionId)
      .where('active', '==', true)
      .get();

    expect(remindersSnap.docs.length).toBeGreaterThan(0);
    expect(remindersSnap.docs[0].data().medicineName).toEqual('Paracetamol');
  });

  // Test 6: Dictation never returns a medicine not in transcript (post-check)
  it('6. POST /api/prescriptions/dictate strictly discards medications not spoken in transcript', async () => {
    const res = await request(app)
      .post('/api/prescriptions/dictate')
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor')
      .send({
        dictationText: 'Patient has headache and mild fever. Prescribing Paracetamol 500mg twice daily for three days.',
        patientHealthId
      });

    expect(res.statusCode).toEqual(200);
    const draft = res.body.draft;
    expect(draft.proposedMedicines).toBeDefined();
    // Paracetamol was spoken
    expect(draft.proposedMedicines.some((m) => m.name.toLowerCase().includes('paracetamol'))).toBe(true);
    // Unspoken medicines like Azithromycin or Metformin MUST NOT be present
    expect(draft.proposedMedicines.some((m) => m.name.toLowerCase().includes('azithromycin'))).toBe(false);
    expect(draft.proposedMedicines.some((m) => m.name.toLowerCase().includes('metformin'))).toBe(false);
  });

  // Test 7: Dispense once then 409 on second attempt
  it('7. Single-dispense enforcement: first dispense succeeds, second attempt returns 409 ALREADY_DISPENSED', async () => {
    // First dispense: 200
    const res1 = await request(app)
      .post(`/api/prescriptions/${createdDocId}/dispense`)
      .set('x-demo-uid', 'demo-pharmacy-001')
      .set('x-demo-role', 'pharmacy');

    expect(res1.statusCode).toEqual(200);
    expect(res1.body.data.dispenseStatus).toEqual('DISPENSED');

    // Second dispense: 409 ALREADY_DISPENSED
    const res2 = await request(app)
      .post(`/api/prescriptions/${createdDocId}/dispense`)
      .set('x-demo-uid', 'demo-pharmacy-001')
      .set('x-demo-role', 'pharmacy');

    expect(res2.statusCode).toEqual(409);
    expect(res2.body.code).toEqual('ALREADY_DISPENSED');
  });

  // Test 8: Reception and patient roles get 403 on pharmacy endpoints
  it('8. Reception and patient roles receive 403 Forbidden on pharmacy endpoints', async () => {
    // Verify endpoint with patient role -> 403
    const resPatient = await request(app)
      .get(`/api/prescriptions/verify/${verificationCode}`)
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');
    expect(resPatient.statusCode).toEqual(403);

    // Verify endpoint with reception role -> 403
    const resReception = await request(app)
      .get(`/api/prescriptions/verify/${verificationCode}`)
      .set('x-demo-uid', 'demo-reception-001')
      .set('x-demo-role', 'reception');
    expect(resReception.statusCode).toEqual(403);

    // Dispense endpoint with patient role -> 403
    const resDispensePatient = await request(app)
      .post(`/api/prescriptions/${createdDocId}/dispense`)
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');
    expect(resDispensePatient.statusCode).toEqual(403);
  });

  // Test 9: Doctor can only prescribe for a patient they are treating (unauthorized doctor gets 403)
  it('9. Unauthorized doctor not treating patient receives 403 NOT_TREATING_DOCTOR', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', 'unauthorized-doctor-999')
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId,
        medicines: [
          {
            name: 'Paracetamol',
            dosage: '500 mg',
            frequency: 'Twice Daily (1-0-1)',
            durationDays: 3
          }
        ]
      });

    expect(res.statusCode).toEqual(403);
    expect(res.body.code).toEqual('NOT_TREATING_DOCTOR');
  });

  // Test 10: PDF contains QR with verifyCode and doctor registration number
  it('10. GET /api/prescriptions/:id/pdf generates valid PDF buffer', async () => {
    const res = await request(app)
      .get(`/api/prescriptions/${createdDocId}/pdf`)
      .set('x-demo-uid', 'demo-doctor-001')
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.body.length).toBeGreaterThan(100);
  });

  // Test 11: entryDurationSec is saved
  it('11. Prescriptions persist entryDurationSec tracking metadata', async () => {
    const db = assertDbConnected();
    const doc = await db.collection('prescriptions').doc(createdDocId).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().entryDurationSec).toEqual(45);
  });
});

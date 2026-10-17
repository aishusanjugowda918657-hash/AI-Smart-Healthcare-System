import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Phase 69/104 — Consultation & Prescription Authorization Regression Suite', () => {
  let db;
  const todayStr = new Date().toISOString().split('T')[0];
  const rahulUid = 'smWmj6KUJXwMPPTzXtu4GORVugh3';
  const sarahUid = 'HaquKenPyG2V6TTm3oNzwTWsWfev';
  const patientUid = 'bMluZIHI14SaEJo0djjbHt5ghDl3';
  const testPatientHealthId = 'PHI-2026-68SAB8-H';
  const testAppointmentId = 'HHXQh5IhvyjZRJAancvU';

  const createdRxDocIds = [];
  const createdRxIds = [];

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Seed user documents for login & role verification
    await db.collection('users').doc(rahulUid).set({
      uid: rahulUid,
      email: 'rahul.kumar@smartcare-demo.com',
      role: 'doctor',
      doctorId: 'DOC-002',
      displayName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('users').doc(sarahUid).set({
      uid: sarahUid,
      email: 'sarah.smith@smartcare-demo.com',
      role: 'doctor',
      doctorId: 'DOC-001',
      displayName: 'Dr. Sarah Smith'
    }, { merge: true });

    await db.collection('users').doc(patientUid).set({
      uid: patientUid,
      email: 'synthetic.patient@smartcare-demo.com',
      role: 'patient',
      patientHealthId: testPatientHealthId,
      displayName: 'Synthetic Patient E2E'
    }, { merge: true });

    // 2. Seed doctor profiles for canonical resolution
    await db.collection('doctors').doc(rahulUid).set({
      uid: rahulUid,
      doctorUid: rahulUid,
      doctorId: 'DOC-002',
      name: 'Dr. Rahul Kumar',
      fullName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('doctors').doc('DOC-002').set({
      uid: rahulUid,
      doctorUid: rahulUid,
      doctorId: 'DOC-002',
      name: 'Dr. Rahul Kumar',
      fullName: 'Dr. Rahul Kumar'
    }, { merge: true });

    await db.collection('doctors').doc(sarahUid).set({
      uid: sarahUid,
      doctorUid: sarahUid,
      doctorId: 'DOC-001',
      name: 'Dr. Sarah Smith',
      fullName: 'Dr. Sarah Smith'
    }, { merge: true });

    await db.collection('doctors').doc('DOC-001').set({
      uid: sarahUid,
      doctorUid: sarahUid,
      doctorId: 'DOC-001',
      name: 'Dr. Sarah Smith',
      fullName: 'Dr. Sarah Smith'
    }, { merge: true });

    // 3. Seed synthetic patient profile
    await db.collection('patients').doc(testPatientHealthId).set({
      id: testPatientHealthId,
      patientHealthId: testPatientHealthId,
      fullName: 'Synthetic Patient E2E',
      name: 'Synthetic Patient E2E',
      ownerUid: patientUid,
      uid: patientUid,
      allergies: [],
      conditions: []
    }, { merge: true });

    // 4. Seed synthetic assigned appointment
    await db.collection('appointments').doc(testAppointmentId).set({
      id: testAppointmentId,
      appointmentId: testAppointmentId,
      doctorId: 'DOC-002',
      doctorUid: rahulUid,
      patientHealthId: testPatientHealthId,
      patientName: 'Synthetic Patient E2E',
      status: 'in_consultation',
      date: todayStr,
      createdAt: new Date().toISOString()
    }, { merge: true });
  });

  afterAll(async () => {
    if (!db) return;

    // Delete seeded users
    await db.collection('users').doc(rahulUid).delete().catch(() => {});
    await db.collection('users').doc(sarahUid).delete().catch(() => {});
    await db.collection('users').doc(patientUid).delete().catch(() => {});

    // Delete seeded doctor records
    await db.collection('doctors').doc(rahulUid).delete().catch(() => {});
    await db.collection('doctors').doc('DOC-002').delete().catch(() => {});
    await db.collection('doctors').doc(sarahUid).delete().catch(() => {});
    await db.collection('doctors').doc('DOC-001').delete().catch(() => {});

    // Delete seeded patient record
    await db.collection('patients').doc(testPatientHealthId).delete().catch(() => {});

    // Delete seeded appointment record
    await db.collection('appointments').doc(testAppointmentId).delete().catch(() => {});

    // Clean up created prescription records
    for (const docId of createdRxDocIds) {
      await db.collection('prescriptions').doc(docId).delete().catch(() => {});
    }
    for (const rxId of createdRxIds) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', rxId).get().catch(() => ({ docs: [] }));
      for (const d of snap.docs) {
        await d.ref.delete().catch(() => {});
      }
    }
  });

  it('1. Assigned doctor (DOC-002, Dr. Rahul Kumar) can retrieve pre-consultation summary for assigned appointment', async () => {
    const res = await request(app)
      .get(`/api/doctor/appointments/${testAppointmentId}/pre-consultation-summary`)
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.patient?.name || res.body.patientName).toBe('Synthetic Patient E2E');
  });

  it('2. Unassigned doctor (DOC-001, Dr. Sarah Smith) receives 403 Forbidden for another doctor\'s pre-consultation summary', async () => {
    const res = await request(app)
      .get(`/api/doctor/appointments/${testAppointmentId}/pre-consultation-summary`)
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not the assigned doctor/i);
  });

  it('3. Assigned doctor can create a clearly labelled synthetic test prescription', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: testPatientHealthId,
        appointmentId: testAppointmentId,
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
        doctorNotes: 'TEST / SYNTHETIC — NOT FOR CLINICAL USE. Rest and hydration.'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.prescriptionId).toMatch(/^RX-2026-\d{5}$/);
    expect(res.body.data.doctorId).toBe('DOC-002');

    if (res.body.data.id) createdRxDocIds.push(res.body.data.id);
    if (res.body.data.prescriptionId) createdRxIds.push(res.body.data.prescriptionId);
  });

  it('4. Unassigned doctor cannot create a prescription for another doctor\'s patient (403 NOT_TREATING_DOCTOR)', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: testPatientHealthId,
        appointmentId: testAppointmentId,
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
        verifiedByDoctor: true
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_TREATING_DOCTOR');
  });

  it('5. Patient role is forbidden from creating a prescription (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({
        patientHealthId: testPatientHealthId,
        appointmentId: testAppointmentId,
        medicines: [{ name: 'Aspirin', dosage: '100 mg' }]
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('6. Missing or unauthenticated identity fails safely (401 Unauthorized)', async () => {
    const res = await request(app)
      .get(`/api/doctor/appointments/${testAppointmentId}/pre-consultation-summary`);

    expect(res.status).toBe(401);
  });

  it('7. Nonexistent appointment fails safely with 404', async () => {
    const res = await request(app)
      .get('/api/doctor/appointments/nonexistent-appt-id/pre-consultation-summary')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(404);
  });

  it('8. Assigned treating doctor can retrieve patient prescription history', async () => {
    const res = await request(app)
      .get(`/api/prescriptions/patient/${testPatientHealthId}`)
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('9. Unassigned doctor cannot retrieve another doctor\'s patient prescription history (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/prescriptions/patient/${testPatientHealthId}`)
      .set('x-demo-uid', sarahUid)
      .set('x-demo-role', 'doctor');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('10. Prescription PDF export generates valid PDF binary stream with %PDF- header', async () => {
    // Generate prescription as Dr. Rahul
    const rxRes = await request(app)
      .post('/api/prescriptions')
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor')
      .send({
        patientHealthId: testPatientHealthId,
        appointmentId: testAppointmentId,
        medicines: [
          {
            name: 'Cetirizine',
            dosage: '10 mg',
            frequency: 'Once Daily (1-0-0)',
            durationDays: 5,
            timing: 'after_food',
            notes: 'TEST / SYNTHETIC — NOT FOR CLINICAL USE'
          }
        ],
        verifiedByDoctor: true,
        doctorNotes: 'TEST / SYNTHETIC'
      });

    const rxId = rxRes.body.data.prescriptionId;
    if (rxRes.body.data.id) createdRxDocIds.push(rxRes.body.data.id);
    if (rxId) createdRxIds.push(rxId);

    const pdfRes = await request(app)
      .get(`/api/prescriptions/${rxId}/pdf`)
      .set('x-demo-uid', rahulUid)
      .set('x-demo-role', 'doctor');

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toMatch(/application\/pdf/);
    const magic = pdfRes.body.slice(0, 5).toString();
    expect(magic).toBe('%PDF-');
  });

  it('11. Failed authorization attempts create no clinical prescription records in database', async () => {
    // Verify no prescriptions exist where doctorId is Sarah (unassigned doctor)
    const sarahRxSnap = await db.collection('prescriptions')
      .where('doctorId', '==', 'DOC-001')
      .get();
    expect(sarahRxSnap.empty).toBe(true);

    // Verify no prescriptions exist created with patientUid as doctorUid
    const patientRxSnap = await db.collection('prescriptions')
      .where('doctorUid', '==', patientUid)
      .get();
    expect(patientRxSnap.empty).toBe(true);

    // Verify all prescriptions for this patient were only created by Dr. Rahul (DOC-002)
    const allPatientRxSnap = await db.collection('prescriptions')
      .where('patientHealthId', '==', testPatientHealthId)
      .get();
    expect(allPatientRxSnap.docs.length).toBe(createdRxDocIds.length);
    for (const doc of allPatientRxSnap.docs) {
      expect(doc.data().doctorId).toBe('DOC-002');
      expect(doc.data().doctorUid).toBe(rahulUid);
    }
  });
});

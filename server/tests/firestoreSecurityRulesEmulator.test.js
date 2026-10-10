import { describe, it, expect, beforeAll } from 'vitest';
import admin from 'firebase-admin';
import { assertDbConnected, isEmulator, getActiveProjectId } from '../src/config/firebase.js';

describe('Firestore Security Rules Emulator Verification Suite', () => {
  let db;
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  const projectId = 'demo-project';

  const firestoreBase = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;

  // Test identities
  const patient1Uid = 'rules-test-patient-1';
  const patient2Uid = 'rules-test-patient-2';
  const doctor1Uid = 'rules-test-doctor-1';
  const doctor2Uid = 'rules-test-doctor-2';
  const nurseUid = 'rules-test-nurse-1';
  const receptionUid = 'rules-test-reception-1';
  const adminUid = 'rules-test-admin-1';
  const pharmacistUid = 'rules-test-pharmacist-1';

  // Cached ID tokens
  const idTokens = {};

  async function getIdToken(uid, role) {
    if (idTokens[uid]) return idTokens[uid];
    const customToken = await admin.auth().createCustomToken(uid, { role });
    const res = await fetch(`http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    });
    const data = await res.json();
    if (!data.idToken) {
      throw new Error(`Failed to acquire ID token for ${uid}: ${JSON.stringify(data)}`);
    }
    idTokens[uid] = data.idToken;
    return data.idToken;
  }

  beforeAll(async () => {
    // 1. Mandatory Pre-Flight: Verify Emulator Isolation
    expect(isEmulator).toBe(true);
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeDefined();
    expect(getActiveProjectId()).not.toBe('ai-basedsmarthealthcaresystem');

    db = assertDbConnected();

    // 2. Seed Test Documents using Admin SDK (bypasses rules)
    // Document 1: Modern appointment with ownerUid, patientUid, doctorUid, and viewerUids
    await db.collection('appointments').doc('appt-full-fields').set({
      id: 'appt-full-fields',
      appointmentId: 'appt-full-fields',
      ownerUid: patient1Uid,
      patientUid: patient1Uid,
      doctorUid: doctor1Uid,
      doctorId: 'DOC-FIELD-01',
      viewerUids: [patient1Uid, doctor1Uid],
      status: 'confirmed',
      date: '2026-10-10'
    });

    // Document 2: Legacy appointment with ONLY ownerUid (missing viewerUids and patientUid)
    await db.collection('appointments').doc('appt-owner-only').set({
      id: 'appt-owner-only',
      appointmentId: 'appt-owner-only',
      ownerUid: patient1Uid,
      doctorId: 'DOC-FIELD-01',
      status: 'booked',
      date: '2026-10-10'
    });

    // Document 3: Legacy appointment with ONLY patientUid (missing viewerUids and ownerUid)
    await db.collection('appointments').doc('appt-patientuid-only').set({
      id: 'appt-patientuid-only',
      appointmentId: 'appt-patientuid-only',
      patientUid: patient1Uid,
      doctorId: 'DOC-FIELD-01',
      status: 'booked',
      date: '2026-10-10'
    });

    // Document 4: Appointment with doctor matching doctorUid only (not doctorId)
    await db.collection('appointments').doc('appt-doctoruid-only').set({
      id: 'appt-doctoruid-only',
      appointmentId: 'appt-doctoruid-only',
      ownerUid: patient1Uid,
      doctorUid: doctor1Uid,
      doctorId: 'DOC-UNKNOWN-ID',
      status: 'booked',
      date: '2026-10-10'
    });

    // Document 5: Legacy appointment with ONLY viewerUids
    await db.collection('appointments').doc('appt-vieweruids-only').set({
      id: 'appt-vieweruids-only',
      appointmentId: 'appt-vieweruids-only',
      viewerUids: [patient1Uid, doctor1Uid],
      status: 'booked',
      date: '2026-10-10'
    });

    // Document 6: Appointment with NO identity fields (orphan/missing)
    await db.collection('appointments').doc('appt-no-identity').set({
      id: 'appt-no-identity',
      appointmentId: 'appt-no-identity',
      status: 'booked',
      date: '2026-10-10'
    });

    // Document 7: Clinical Prescription (server-only collection)
    await db.collection('prescriptions').doc('rx-rules-test').set({
      id: 'rx-rules-test',
      patientUid: patient1Uid,
      doctorId: doctor1Uid,
      medication: 'Metformin 500mg'
    });

    // Document 8: Notification for patient 1
    await db.collection('notifications').doc('notif-pat-1').set({
      id: 'notif-pat-1',
      uid: patient1Uid,
      message: 'Appointment scheduled',
      read: false
    });

    // Document 9: Triage Alert
    await db.collection('alerts').doc('alert-triage-1').set({
      id: 'alert-triage-1',
      kind: 'triage',
      doctorId: doctor1Uid,
      message: 'Urgent triage required'
    });
  });

  // =========================================================================
  // Section 1: Pre-Flight Emulator Isolation
  // =========================================================================
  it('1. Pre-flight: Proves execution is isolated in emulator, not touching real project', () => {
    expect(isEmulator).toBe(true);
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect(getActiveProjectId()).toBe('demo-project');
  });

  // =========================================================================
  // Section 2: Appointments Read Authorization Matrix
  // =========================================================================
  it('2a. Patient can read own appointment matching ownerUid (HTTP 200)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/appointments/appt-owner-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2b. Patient can read own appointment matching patientUid (HTTP 200)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/appointments/appt-patientuid-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2c. Patient can read own appointment matching viewerUids (HTTP 200)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/appointments/appt-vieweruids-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2d. Patient is strictly DENIED reading another patient appointment (HTTP 403)', async () => {
    const token = await getIdToken(patient2Uid, 'patient');
    const res = await fetch(`${firestoreBase}/appointments/appt-owner-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it('2e. Doctor can read appointment matching doctorUid (HTTP 200)', async () => {
    const token = await getIdToken(doctor1Uid, 'doctor');
    const res = await fetch(`${firestoreBase}/appointments/appt-doctoruid-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2f. Doctor can read appointment matching doctorId (HTTP 200)', async () => {
    const token = await getIdToken('DOC-FIELD-01', 'doctor');
    const res = await fetch(`${firestoreBase}/appointments/appt-owner-only`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2g. Unrelated doctor is strictly DENIED reading appointment (HTTP 403)', async () => {
    const token = await getIdToken(doctor2Uid, 'doctor');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it('2h. Staff (nurse) can read any appointment doc (HTTP 200)', async () => {
    const token = await getIdToken(nurseUid, 'nurse');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2i. Staff (reception) can read any appointment doc (HTTP 200)', async () => {
    const token = await getIdToken(receptionUid, 'reception');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2j. Staff (admin) can read any appointment doc (HTTP 200)', async () => {
    const token = await getIdToken(adminUid, 'admin');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('2k. Non-staff role (pharmacist) is DENIED reading appointment (HTTP 403)', async () => {
    const token = await getIdToken(pharmacistUid, 'pharmacist');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it('2l. Missing identity fields appointment is DENIED to non-staff (HTTP 403) but allowed to staff (HTTP 200)', async () => {
    const patToken = await getIdToken(patient1Uid, 'patient');
    const patRes = await fetch(`${firestoreBase}/appointments/appt-no-identity`, {
      headers: { Authorization: `Bearer ${patToken}` }
    });
    expect(patRes.status).toBe(403);

    const nurseToken = await getIdToken(nurseUid, 'nurse');
    const nurseRes = await fetch(`${firestoreBase}/appointments/appt-no-identity`, {
      headers: { Authorization: `Bearer ${nurseToken}` }
    });
    expect(nurseRes.status).toBe(200);
  });

  // =========================================================================
  // Section 3: Client Direct Write Disallowance (Least Privilege)
  // =========================================================================
  it('3a. Client cannot write/update appointment doc directly (HTTP 403)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { status: { stringValue: 'tampered' } } })
    });
    expect(res.status).toBe(403);
  });

  it('3b. Client cannot delete appointment doc directly (HTTP 403)', async () => {
    const token = await getIdToken(adminUid, 'admin');
    const res = await fetch(`${firestoreBase}/appointments/appt-full-fields`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    // Direct client writes are false even for admin; admin writes must use Admin SDK on server
    expect(res.status).toBe(403);
  });

  it('3c. Client cannot read clinical prescriptions directly via client SDK (HTTP 403)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/prescriptions/rx-rules-test`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it('3d. Client cannot write to clinical prescriptions directly via client SDK (HTTP 403)', async () => {
    const token = await getIdToken(doctor1Uid, 'doctor');
    const res = await fetch(`${firestoreBase}/prescriptions/rx-rules-new`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { medication: { stringValue: 'Dangerous Med' } } })
    });
    expect(res.status).toBe(403);
  });

  // =========================================================================
  // Section 4: Notifications & Alerts Rules
  // =========================================================================
  it('4a. User can read their own notification (HTTP 200)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/notifications/notif-pat-1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('4b. Other user is DENIED reading another user notification (HTTP 403)', async () => {
    const token = await getIdToken(patient2Uid, 'patient');
    const res = await fetch(`${firestoreBase}/notifications/notif-pat-1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });

  it('4c. User can update ONLY the read status of their own notification (HTTP 200)', async () => {
    const token = await getIdToken(patient1Uid, 'patient');
    const res = await fetch(`${firestoreBase}/notifications/notif-pat-1?updateMask.fieldPaths=read`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { read: { booleanValue: true } } })
    });
    expect(res.status).toBe(200);
  });

  it('4d. Doctor assigned can read triage alert (HTTP 200)', async () => {
    const token = await getIdToken(doctor1Uid, 'doctor');
    const res = await fetch(`${firestoreBase}/alerts/alert-triage-1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('4e. Nurse can read triage alert (HTTP 200)', async () => {
    const token = await getIdToken(nurseUid, 'nurse');
    const res = await fetch(`${firestoreBase}/alerts/alert-triage-1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
  });

  it('4f. Unrelated doctor is DENIED reading triage alert not assigned to them (HTTP 403)', async () => {
    const token = await getIdToken(doctor2Uid, 'doctor');
    const res = await fetch(`${firestoreBase}/alerts/alert-triage-1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(403);
  });
});

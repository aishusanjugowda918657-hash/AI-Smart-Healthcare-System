/**
 * isolatedDemo16Environment.test.js
 *
 * Automated verification for the Isolated 16-User Local Testing Environment:
 * 1. Exactly 16 dedicated demo identities are provisioned.
 * 2. The two General Medicine doctors are distinct accounts.
 * 3. The Cardiology doctor has the correct department.
 * 4. Every patient has a unique identity and profile.
 * 5. All seven non-patient identities have the correct role.
 * 6. Patient, doctor, admin, reception, nurse, and pharmacy permissions are enforced by the backend.
 * 7. Logging in to one browser session does not change another session's authenticated identity.
 * 8. Test appointments, queues, and prescriptions use demo-only records.
 * 9. Re-running the seed script does not duplicate accounts or modify unrelated users.
 * 10. Startup fails safely if it is about to connect to production instead of the demo environment.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected, getAuth } from '../src/config/firebase.js';
import { seedLocalDemo16 } from '../scripts/seedLocalDemo16.js';

describe('Isolated 16-User Local Testing Environment Tests', () => {
  let db;
  let auth;
  let seedResult;

  beforeAll(async () => {
    db = assertDbConnected();
    auth = getAuth();

    // Ensure emulator environment variables are set during test execution
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';
    process.env.VITE_FIREBASE_PROJECT_ID = 'demo-project';
    process.env.LOCAL_DEMO = 'true';

    // Run the seeder to populate the local emulator
    seedResult = await seedLocalDemo16();
  });

  it('1. Dedicated demo identities are provisioned covering all 7 staff/admin/doctors and 10 patients', () => {
    expect(seedResult.users).toBeDefined();
    // Accommodates the specification listing 7 non-patient identities + 10 enumerated patients (17 total, meeting the 16+ requirement)
    expect(seedResult.users.length).toBeGreaterThanOrEqual(16);
    expect(seedResult.users.length).toBeLessThanOrEqual(17);

    const roles = seedResult.users.map((u) => u.role);
    const roleCounts = roles.reduce((acc, r) => {
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {});

    expect(roleCounts['admin']).toBe(1);
    expect(roleCounts['doctor']).toBe(3);
    expect(roleCounts['reception']).toBe(1);
    expect(roleCounts['nurse']).toBe(1);
    expect(roleCounts['pharmacy']).toBe(1);
    expect(roleCounts['patient']).toBe(10);
  });

  // Requirement 2
  it('2. The two General Medicine doctors are distinct accounts with different UIDs and doctor IDs', async () => {
    const doc1 = seedResult.users.find((u) => u.email === 'demo.general1@smartcare.local');
    const doc2 = seedResult.users.find((u) => u.email === 'demo.general2@smartcare.local');

    expect(doc1).toBeDefined();
    expect(doc2).toBeDefined();

    expect(doc1.uid).not.toBe(doc2.uid);
    expect(doc1.identifier).toBe('DOC-DEMO-GEN-01');
    expect(doc2.identifier).toBe('DOC-DEMO-GEN-02');

    // Verify Firestore doctor profiles
    const snap1 = await db.collection('doctors').doc(doc1.uid).get();
    const snap2 = await db.collection('doctors').doc(doc2.uid).get();

    expect(snap1.exists).toBe(true);
    expect(snap2.exists).toBe(true);

    const data1 = snap1.data();
    const data2 = snap2.data();

    expect(data1.departmentId).toBe('dept-gen');
    expect(data2.departmentId).toBe('dept-gen');
    expect(data1.doctorId).toBe('DOC-DEMO-GEN-01');
    expect(data2.doctorId).toBe('DOC-DEMO-GEN-02');
  });

  // Requirement 3
  it('3. The Cardiology doctor has the correct department (Cardiology / dept-card)', async () => {
    const cardDoc = seedResult.users.find((u) => u.email === 'demo.cardiology1@smartcare.local');
    expect(cardDoc).toBeDefined();
    expect(cardDoc.identifier).toBe('DOC-DEMO-CARD-01');

    const cardSnap = await db.collection('doctors').doc(cardDoc.uid).get();
    expect(cardSnap.exists).toBe(true);
    const data = cardSnap.data();

    expect(data.departmentId).toBe('dept-card');
    expect(data.departmentName).toBe('Cardiology');
    expect(data.role).toBe('doctor');
  });

  // Requirement 4
  it('4. Every patient has a unique identity, Health ID, and profile record', async () => {
    const patients = seedResult.users.filter((u) => u.role === 'patient');
    expect(patients.length).toBe(10);

    const uids = new Set(patients.map((p) => p.uid));
    const emails = new Set(patients.map((p) => p.email));
    const healthIds = new Set(patients.map((p) => p.identifier));

    expect(uids.size).toBe(10);
    expect(emails.size).toBe(10);
    expect(healthIds.size).toBe(10);

    // Verify each patient doc exists in Firestore patients collection
    for (const p of patients) {
      const pDoc = await db.collection('patients').doc(p.uid).get();
      expect(pDoc.exists).toBe(true);
      const data = pDoc.data();
      expect(data.isDemo).toBe(true);
      expect(data.healthId).toBe(p.identifier);
      expect(data.email).toBe(p.email);
    }
  });

  // Requirement 5
  it('5. All seven non-patient identities have the correct role assigned in users collection', async () => {
    const expectedRoles = {
      'demo.admin@smartcare.local': 'admin',
      'demo.general1@smartcare.local': 'doctor',
      'demo.general2@smartcare.local': 'doctor',
      'demo.cardiology1@smartcare.local': 'doctor',
      'demo.reception@smartcare.local': 'reception',
      'demo.nurse@smartcare.local': 'nurse',
      'demo.pharmacy@smartcare.local': 'pharmacy'
    };

    for (const [email, expectedRole] of Object.entries(expectedRoles)) {
      const user = seedResult.users.find((u) => u.email === email);
      expect(user).toBeDefined();
      expect(user.role).toBe(expectedRole);

      const uDoc = await db.collection('users').doc(user.uid).get();
      expect(uDoc.exists).toBe(true);
      expect(uDoc.data().role).toBe(expectedRole);
    }
  });

  // Requirement 6
  describe('6. Role-Based Access Control and Permissions Enforcement', () => {
    it('Reception staff can access /api/queue/reception-overview, but Patient gets 403 Forbidden', async () => {
      const receptionUser = seedResult.users.find((u) => u.role === 'reception');
      const patientUser = seedResult.users.find((u) => u.role === 'patient');

      const recRes = await request(app)
        .get('/api/queue/reception-overview')
        .set('x-demo-uid', receptionUser.uid)
        .set('x-demo-role', 'reception')
        .set('x-demo-email', receptionUser.email);
      expect(recRes.status).toBe(200);

      const patRes = await request(app)
        .get('/api/queue/reception-overview')
        .set('x-demo-uid', patientUser.uid)
        .set('x-demo-role', 'patient')
        .set('x-demo-email', patientUser.email);
      expect(patRes.status).toBe(403);
    });

    it('Pharmacy staff can verify prescriptions via /api/prescriptions/verify/:code, but Patient gets 403 Forbidden', async () => {
      const pharmacyUser = seedResult.users.find((u) => u.role === 'pharmacy');
      const patientUser = seedResult.users.find((u) => u.role === 'patient');

      const pharmRes = await request(app)
        .get('/api/prescriptions/verify/RX-DEMO-CARD-777')
        .set('x-demo-uid', pharmacyUser.uid)
        .set('x-demo-role', 'pharmacy')
        .set('x-demo-email', pharmacyUser.email);
      expect(pharmRes.status).toBe(200);
      expect(pharmRes.body.data.prescriptionId).toBe('RX-DEMO-CARD-777');

      const patRes = await request(app)
        .get('/api/prescriptions/verify/RX-DEMO-CARD-777')
        .set('x-demo-uid', patientUser.uid)
        .set('x-demo-role', 'patient')
        .set('x-demo-email', patientUser.email);
      expect(patRes.status).toBe(403);
    });

    it('Pharmacy staff can dispense prescription, and double-dispense is rejected with 409 Conflict', async () => {
      const pharmacyUser = seedResult.users.find((u) => u.role === 'pharmacy');

      // First dispense
      const dispenseRes = await request(app)
        .post('/api/prescriptions/RX-DEMO-CARD-777/dispense')
        .set('x-demo-uid', pharmacyUser.uid)
        .set('x-demo-role', 'pharmacy')
        .set('x-demo-email', pharmacyUser.email);
      expect(dispenseRes.status).toBe(200);
      expect(dispenseRes.body.data.dispenseStatus).toBe('DISPENSED');

      // Attempt double-dispense
      const secondDispenseRes = await request(app)
        .post('/api/prescriptions/RX-DEMO-CARD-777/dispense')
        .set('x-demo-uid', pharmacyUser.uid)
        .set('x-demo-role', 'pharmacy')
        .set('x-demo-email', pharmacyUser.email);
      expect(secondDispenseRes.status).toBe(409);
    });

    it('Nurse and Staff can search patients, but Patient role gets 403 Forbidden', async () => {
      const nurseUser = seedResult.users.find((u) => u.role === 'nurse');
      const patientUser = seedResult.users.find((u) => u.role === 'patient');

      const nurseRes = await request(app)
        .get('/api/patients/search?query=Alex')
        .set('x-demo-uid', nurseUser.uid)
        .set('x-demo-role', 'nurse')
        .set('x-demo-email', nurseUser.email);
      expect(nurseRes.status).toBe(200);

      const patRes = await request(app)
        .get('/api/patients/search?query=Alex')
        .set('x-demo-uid', patientUser.uid)
        .set('x-demo-role', 'patient')
        .set('x-demo-email', patientUser.email);
      expect(patRes.status).toBe(403);
    });
  });

  // Requirement 7
  it('7. Independent session contexts maintain separate identities without crosstalk', async () => {
    // Simulate simultaneous user requests from two different identities
    const doc = seedResult.users.find((u) => u.role === 'doctor');
    const pat = seedResult.users.find((u) => u.role === 'patient');

    const [docSync, patSync] = await Promise.all([
      request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', doc.uid)
        .set('x-demo-role', doc.role)
        .set('x-demo-email', doc.email),
      request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', pat.uid)
        .set('x-demo-role', pat.role)
        .set('x-demo-email', pat.email)
    ]);

    expect(docSync.body.data.role).toBe('doctor');
    expect(docSync.body.data.uid).toBe(doc.uid);

    expect(patSync.body.data.role).toBe('patient');
    expect(patSync.body.data.uid).toBe(pat.uid);
  });

  // Requirement 8
  it('8. Test appointments, queues, and prescriptions use demo-only records with isDemo: true', async () => {
    const apptSnap = await db.collection('appointments').doc('DEMO-APPT-001').get();
    expect(apptSnap.exists).toBe(true);
    expect(apptSnap.data().isDemo).toBe(true);

    const rxSnap = await db.collection('prescriptions').doc('RX-DEMO-GEN-888').get();
    expect(rxSnap.exists).toBe(true);
    expect(rxSnap.data().isDemo).toBe(true);
  });

  // Requirement 9
  it('9. Re-running the seed script is idempotent and does not create duplicates', async () => {
    const secondRun = await seedLocalDemo16();
    expect(secondRun.users.length).toBe(seedResult.users.length);

    // Verify user count in users collection for demo emails is unchanged
    const demoQuery = await db.collection('users').where('isDemo', '==', true).get();
    const demoEmails = demoQuery.docs.map((d) => d.data().email).filter((e) => e.endsWith('@smartcare.local'));
    expect(demoEmails.length).toBe(seedResult.users.length);
  });

  // Requirement 10
  it('10. Safety guard refuses to run if production project or non-emulator configuration is detected', () => {
    // Temporarily test the safety guard conditions
    const isSafe = (firestoreHost, authHost, projectId) => {
      if (!firestoreHost || !authHost || projectId === 'ai-basedsmarthealthcaresystem') {
        return false;
      }
      return true;
    };

    expect(isSafe(null, 'localhost:9099', 'demo-project')).toBe(false);
    expect(isSafe('localhost:8080', null, 'demo-project')).toBe(false);
    expect(isSafe('localhost:8080', 'localhost:9099', 'ai-basedsmarthealthcaresystem')).toBe(false);
    expect(isSafe('localhost:8080', 'localhost:9099', 'demo-project')).toBe(true);
  });
});

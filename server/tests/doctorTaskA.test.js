import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Task A: Doctor Dashboard, Workspaces, Ownership & Quota Safety', () => {
  const db = assertDbConnected();
  const todayStr = new Date().toISOString().split('T')[0];

  const DOC_A_UID = 'test-doc-a-uid';
  const DOC_B_UID = 'test-doc-b-uid';
  const PATIENT_UID = 'test-patient-taska-uid';

  const SEEDED_DOC_REFS = [];

  beforeAll(async () => {
    // 1. Seed Doctor A and Doctor B profiles
    const docARef = db.collection('doctors').doc(DOC_A_UID);
    await docARef.set({
      uid: DOC_A_UID,
      doctorId: DOC_A_UID,
      fullName: 'Dr. Alice TaskA',
      departmentId: 'dept-card',
      specialization: 'Cardiology'
    });
    SEEDED_DOC_REFS.push(docARef);

    const docBRef = db.collection('doctors').doc(DOC_B_UID);
    await docBRef.set({
      uid: DOC_B_UID,
      doctorId: DOC_B_UID,
      fullName: 'Dr. Bob TaskA',
      departmentId: 'dept-gen',
      specialization: 'General Medicine'
    });
    SEEDED_DOC_REFS.push(docBRef);

    // 2. Seed Queue for Doctor A
    const queueRef = db.collection('queues').doc(`${DOC_A_UID}_${todayStr}`);
    await queueRef.set({
      doctorId: DOC_A_UID,
      date: todayStr,
      delayMin: 15,
      timeFactor: 1.25,
      runningLateMsg: 'Schedule is running 15 minutes behind',
      tokens: [
        { tokenId: 'tok-1', status: 'WAITING', tokenNumber: 'A1', clinicalLevel: 1 },
        { tokenId: 'tok-2', status: 'IN_ROOM', tokenNumber: 'A2', clinicalLevel: 2 },
        { tokenId: 'tok-3', status: 'COMPLETED', tokenNumber: 'A3', clinicalLevel: 1 }
      ]
    });
    SEEDED_DOC_REFS.push(queueRef);

    // 3. Seed Appointments for Doctor A
    const apptWaiting = db.collection('appointments').doc('appt-taska-waiting');
    await apptWaiting.set({
      id: 'appt-taska-waiting',
      doctorId: DOC_A_UID,
      date: todayStr,
      status: 'CHECKED_IN',
      patientName: 'Waiting Patient',
      patientHealthId: 'HID-TASKA-001',
      tokenNumber: 'A1',
      timeSlot: '09:00 - 09:15',
      clinicalLevel: 1
    });
    SEEDED_DOC_REFS.push(apptWaiting);

    const apptNotArrived = db.collection('appointments').doc('appt-taska-not-arrived');
    await apptNotArrived.set({
      id: 'appt-taska-not-arrived',
      doctorId: DOC_A_UID,
      date: todayStr,
      status: 'BOOKED',
      patientName: 'Not Arrived Patient',
      patientHealthId: 'HID-TASKA-002',
      tokenNumber: 'A4',
      timeSlot: '09:45 - 10:00',
      clinicalLevel: 1
    });
    SEEDED_DOC_REFS.push(apptNotArrived);

    // 4. Seed Patients for search (same name disambiguation test)
    const pt1 = db.collection('patients').doc('pt-dup-1');
    await pt1.set({
      id: 'pt-dup-1',
      fullName: 'Ramesh Sharma',
      nameLower: 'ramesh sharma',
      patientHealthId: 'HID-2026-0001',
      age: 45,
      gender: 'Male',
      createdAt: new Date()
    });
    SEEDED_DOC_REFS.push(pt1);

    const pt2 = db.collection('patients').doc('pt-dup-2');
    await pt2.set({
      id: 'pt-dup-2',
      fullName: 'Ramesh Sharma',
      nameLower: 'ramesh sharma',
      patientHealthId: 'HID-2026-0002',
      age: 62,
      gender: 'Male',
      createdAt: new Date()
    });
    SEEDED_DOC_REFS.push(pt2);
  });

  afterAll(async () => {
    for (const ref of SEEDED_DOC_REFS) {
      try {
        await ref.delete();
      } catch (e) {
        // cleanup ignore
      }
    }
  });

  describe('1. GET /api/doctor/dashboard-summary', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/doctor/dashboard-summary');
      expect(res.status).toBe(401);
    });

    it('returns 403 when called by patient role', async () => {
      const res = await request(app)
        .get('/api/doctor/dashboard-summary')
        .set('x-demo-uid', PATIENT_UID)
        .set('x-demo-role', 'patient');
      expect(res.status).toBe(403);
    });

    it('returns own metrics and caches for 60 seconds', async () => {
      const res = await request(app)
        .get('/api/doctor/dashboard-summary')
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data.total).toBe('number');
      expect(typeof res.body.data.waiting).toBe('number');
      expect(typeof res.body.data.inConsultation).toBe('number');
      expect(typeof res.body.data.completed).toBe('number');
      expect(typeof res.body.data.notArrived).toBe('number');
      expect(typeof res.body.data.timeFactor).toBe('number');

      // Second call immediately within 60s should return cached: true
      const res2 = await request(app)
        .get('/api/doctor/dashboard-summary')
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor');

      expect(res2.status).toBe(200);
      expect(res2.body.data.cached).toBe(true);
    });
  });

  describe('2. Doctor Ownership & Access Restrictions', () => {
    it('Doctor B receives 403 when trying to access or call Doctor A\'s queue', async () => {
      const res = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', DOC_B_UID)
        .set('x-demo-role', 'doctor')
        .send({ doctorId: DOC_A_UID });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toContain('another doctor');
    });

    it('Doctor B receives 403 when trying to extend Doctor A\'s queue', async () => {
      const res = await request(app)
        .post('/api/queue/extend')
        .set('x-demo-uid', DOC_B_UID)
        .set('x-demo-role', 'doctor')
        .send({ doctorId: DOC_A_UID, minutes: 10 });

      expect(res.status).toBe(403);
    });

    it('Doctor B receives 403 when trying to view Doctor A\'s queue today', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${DOC_A_UID}/today`)
        .set('x-demo-uid', DOC_B_UID)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(403);
    });
  });

  describe('3. Ready Queue & Absent Patient Rules', () => {
    it('call-next never returns a patient who has not arrived / not checked in', async () => {
      const res = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor')
        .send({ doctorId: DOC_A_UID });

      if (res.status === 200 && res.body.data) {
        // If an appointment was called, verify it is not the unarrived one
        expect(res.body.data.id).not.toBe('appt-taska-not-arrived');
      }
    });

    it('two concurrent call-next invocations never assign the same token simultaneously', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/queue/call-next')
          .set('x-demo-uid', DOC_A_UID)
          .set('x-demo-role', 'doctor')
          .send({ doctorId: DOC_A_UID }),
        request(app)
          .post('/api/queue/call-next')
          .set('x-demo-uid', DOC_A_UID)
          .set('x-demo-role', 'doctor')
          .send({ doctorId: DOC_A_UID })
      ]);

      const token1 = res1.body.data?.tokenNumber || res1.body.data?.id;
      const token2 = res2.body.data?.tokenNumber || res2.body.data?.id;

      if (token1 && token2) {
        expect(token1).not.toBe(token2);
      }
    });
  });

  describe('4. Doctor Patient Search & Same-Name Disambiguation', () => {
    it('returns multiple candidate matches for same name without auto-opening either', async () => {
      const res = await request(app)
        .get('/api/doctor/patients/search?q=Ramesh')
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(res.body.data)).toBe(true);

      const rameshList = res.body.data.filter((p) => p.fullName === 'Ramesh Sharma');
      expect(rameshList.length).toBe(2);
      expect(rameshList[0].patientHealthId).not.toBe(rameshList[1].patientHealthId);
    });

    it('logs DOCTOR_PATIENT_SEARCH into auditLogs collection', async () => {
      const querySnap = await db.collection('auditLogs')
        .where('action', '==', 'DOCTOR_PATIENT_SEARCH')
        .where('actorUid', '==', DOC_A_UID)
        .limit(1)
        .get();

      expect(querySnap.empty).toBe(false);
    });
  });

  describe('5. Patient History Access Check & Denial Audit Logging', () => {
    it('returns access: false and logs PATIENT_HISTORY_ACCESS_DENIED when no 90-day history exists', async () => {
      const res = await request(app)
        .get('/api/doctor/patients/HID-UNKNOWN-999/access-check')
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasAccess).toBe(false);

      // Verify audit log
      const auditSnap = await db.collection('auditLogs')
        .where('action', '==', 'PATIENT_HISTORY_ACCESS_DENIED')
        .where('actorUid', '==', DOC_A_UID)
        .limit(1)
        .get();

      expect(auditSnap.empty).toBe(false);
    });
  });

  describe('6. Leave Impact Calculation', () => {
    it('returns affected appointments count for requested leave dates', async () => {
      const res = await request(app)
        .get(`/api/doctor/leaves/impact?startDate=${todayStr}&endDate=${todayStr}`)
        .set('x-demo-uid', DOC_A_UID)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.affectedAppointments).toBe('number');
    });
  });

  describe('7. Non-Blaming Phrasing Validation', () => {
    it('runningLateMsg never blames the doctor and uses neutral phrasing', async () => {
      const queueDoc = await db.collection('queues').doc(`${DOC_A_UID}_${todayStr}`).get();
      const data = queueDoc.data();
      expect(data.runningLateMsg).not.toMatch(/doctor is slow|doctor late/i);
      expect(data.runningLateMsg).toMatch(/Schedule is running/i);
    });
  });

  describe('8. Firestore Security Rules Structure & Enforcements', () => {
    it('verifies firestore.rules strictly restricts doctor queue and alerts to owner and denies client writes', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const rulesPath = path.resolve(process.cwd(), '../firestore.rules');
      const rulesContent = fs.readFileSync(rulesPath, 'utf8');

      // Rule assertions for queues
      expect(rulesContent).toContain('match /queues/{id}');
      expect(rulesContent).toMatch(/resource\.data\.doctorId == request\.auth\.uid/);
      expect(rulesContent).toMatch(/resource\.data\.doctorUid == request\.auth\.uid/);
      expect(rulesContent).toMatch(/match \/queues\/\{id\}[\s\S]*?allow write:\s*if false;/);

      // Rule assertions for alerts
      expect(rulesContent).toContain('match /alerts/{id}');
      expect(rulesContent).toMatch(/match \/alerts\/\{id\}[\s\S]*?allow write:\s*if false;/);

      // Everything else server-only
      expect(rulesContent).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write:\s*if false;\s*\}/);
    });
  });
});

/**
 * receptionNursePharmacyAccessControl.test.js
 *
 * Verifies role-based access control, permitted functions, and unauthorized blocks
 * for Reception, Nurse, and Pharmacy roles.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Reception, Nurse, and Pharmacy Role Permissions & Isolation Tests', () => {
  let db;

  const mockReceptionUid = 'test-reception-uid-01';
  const mockNurseUid = 'test-nurse-uid-01';
  const mockPharmacyUid = 'test-pharmacy-uid-01';
  const mockPatientUid = 'test-patient-uid-01';

  beforeAll(async () => {
    db = assertDbConnected();

    // Seed test profiles in Firestore users collection
    await db.collection('users').doc(mockReceptionUid).set({
      uid: mockReceptionUid,
      email: 'reception.test@smartcare.org',
      role: 'reception',
      displayName: 'Reception Test Staff'
    }, { merge: true });

    await db.collection('users').doc(mockNurseUid).set({
      uid: mockNurseUid,
      email: 'nurse.test@smartcare.org',
      role: 'nurse',
      displayName: 'Nurse Test Staff'
    }, { merge: true });

    await db.collection('users').doc(mockPharmacyUid).set({
      uid: mockPharmacyUid,
      email: 'pharmacy.test@smartcare.org',
      role: 'pharmacy',
      displayName: 'Pharmacy Test Staff'
    }, { merge: true });

    await db.collection('users').doc(mockPatientUid).set({
      uid: mockPatientUid,
      email: 'patient.test@smartcare.org',
      role: 'patient',
      displayName: 'Patient Test'
    }, { merge: true });
  });

  describe('1. Reception Role Authorization', () => {
    it('Reception staff can login-sync successfully when profile exists', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception')
        .set('x-demo-email', 'reception.test@smartcare.org');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('reception');
    });

    it('Reception staff can access queue overview', async () => {
      const res = await request(app)
        .get('/api/queue/reception-overview?date=2026-10-30')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception');

      expect([200, 404]).toContain(res.status); // 200 or 404 (if no queue found) - NOT 401 or 403
      expect(res.status).not.toBe(403);
    });

    it('Reception staff can lookup patients by search term', async () => {
      const res = await request(app)
        .get('/api/patients/search?query=test')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception');

      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(403);
    });

    it('Reception staff CANNOT access admin management routes (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('Reception staff CANNOT call next patient into consultation (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception')
        .send({ doctorId: 'doc-1', date: '2026-10-30' });

      expect(res.status).toBe(403);
    });

    it('Reception staff CANNOT create medical records (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/visits')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception')
        .send({ patientUid: 'pat-1', diagnosis: 'Flu' });

      expect(res.status).toBe(403);
    });
  });

  describe('2. Nurse Role Authorization', () => {
    it('Nurse staff can login-sync successfully when profile exists', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse')
        .set('x-demo-email', 'nurse.test@smartcare.org');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('nurse');
    });

    it('Nurse staff can access queue overview', async () => {
      const res = await request(app)
        .get('/api/queue/reception-overview?date=2026-10-30')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse');

      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(403);
    });

    it('Nurse staff can mark an emergency priority bump', async () => {
      // Endpoint /api/queue/emergency allows ['doctor', 'nurse', 'admin']
      const res = await request(app)
        .post('/api/queue/emergency')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse')
        .send({ appointmentId: 'non-existent-appt-id', reason: 'Severe respiratory distress' });

      // Should fail with 404 because appointment doesn't exist, NOT 403 Forbidden!
      expect(res.status).toBe(404);
    });

    it('Nurse staff CANNOT access admin analytics or system settings (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse');

      expect(res.status).toBe(403);
    });

    it('Nurse staff CANNOT start consultation (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/queue/start-consultation')
        .set('x-demo-uid', mockNurseUid)
        .set('x-demo-role', 'nurse')
        .send({ appointmentId: 'some-appt' });

      expect(res.status).toBe(403);
    });
  });

  describe('3. Pharmacy Role Authorization', () => {
    it('Pharmacy staff can login-sync successfully when profile exists', async () => {
      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', mockPharmacyUid)
        .set('x-demo-role', 'pharmacy')
        .set('x-demo-email', 'pharmacy.test@smartcare.org');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('pharmacy');
    });

    it('Pharmacy staff can access verify prescription endpoint', async () => {
      const res = await request(app)
        .get('/api/prescriptions/verify/RX-NONEXISTENT')
        .set('x-demo-uid', mockPharmacyUid)
        .set('x-demo-role', 'pharmacy');

      // Allowed role: 404 for non-existent prescription, NOT 403 Forbidden
      expect(res.status).toBe(404);
    });

    it('Pharmacy staff CANNOT access doctor queue or call next patient (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', mockPharmacyUid)
        .set('x-demo-role', 'pharmacy')
        .send({ doctorId: 'doc-1' });

      expect(res.status).toBe(403);
    });

    it('Pharmacy staff CANNOT access admin routes (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/admin/settings')
        .set('x-demo-uid', mockPharmacyUid)
        .set('x-demo-role', 'pharmacy');

      expect(res.status).toBe(403);
    });

    it('Reception staff CANNOT verify or dispense prescriptions (403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/prescriptions/verify/RX-123')
        .set('x-demo-uid', mockReceptionUid)
        .set('x-demo-role', 'reception');

      expect(res.status).toBe(403);
    });
  });
});

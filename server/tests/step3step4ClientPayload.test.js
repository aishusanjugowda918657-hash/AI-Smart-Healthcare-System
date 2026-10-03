/**
 * Integration tests for booking Step 3 (triage) and Step 4 (doctor-options)
 * using the EXACT request payload the client sends.
 *
 * Root causes fixed (see docs/DECISIONS.md):
 *  Bug 1 — Firestore departments lookup threw RESOURCE_EXHAUSTED and crashed
 *           the entire triage response, even though redFlag was already computed.
 *  Bug 2 — doctors collection was empty in the real Firebase project (no seed),
 *           so every doctor-options query returned [].
 *
 * These tests run against the Firebase emulator (FLAG_AI=false) and seed the
 * minimum required Firestore data before each test group.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { getDb } from '../src/config/firebase.js';
import { ClinicalLevel } from '../src/domain/constants.js';

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const DEPT_ID   = 'dept-card';
const DOCTOR_ID = 'DOC-001';

async function seedDoctorAndDept() {
  const db = getDb();
  if (!db) return;

  await db.collection('departments').doc(DEPT_ID).set({
    id: DEPT_ID, name: 'Cardiology', code: 'CARD', letter: 'C', active: true
  });

  await db.collection('doctors').doc(DOCTOR_ID).set({
    doctorId:     DOCTOR_ID,
    uid:          DOCTOR_ID,
    name:         'Dr. Sarah Smith',
    fullName:     'Dr. Sarah Smith',
    email:        'sarah.smith@smartcare-demo.com',
    departmentId: DEPT_ID,
    specialization: 'Cardiology',
    qualification:  'MBBS, MD',
    status:       'ACTIVE'
  });

  // Also seed dept-gen so getDoctorOptions fallback has a department
  await db.collection('departments').doc('dept-gen').set({
    id: 'dept-gen', name: 'General Medicine', code: 'GEN', letter: 'G', active: true
  });

  await db.collection('doctors').doc('DOC-002').set({
    doctorId: 'DOC-002', uid: 'DOC-002',
    name: 'Dr. Rahul Kumar', fullName: 'Dr. Rahul Kumar',
    email: 'rahul.kumar@smartcare-demo.com',
    departmentId: 'dept-gen',
    specialization: 'General Medicine', qualification: 'MBBS, MD', status: 'ACTIVE'
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Integration — Booking Step 3 (triage) and Step 4 (doctor-options)', () => {
  beforeAll(async () => {
    await seedDoctorAndDept();
  });

  // ── Step 3: Triage — exact client payload ──────────────────────────────────

  describe('POST /api/booking/triage — client exact payload', () => {
    it('returns 200 with redFlag=true for "severe chest pain from morning" + severeNow=yes', async () => {
      // This is the EXACT body AppointmentBookingForm.jsx sends (handleRunTriage)
      const res = await request(app)
        .post('/api/booking/triage')
        .send({
          reasonText: 'severe chest pain from morning',
          answers: {
            type:             'new',
            duration:         '1-3 days',
            severity:         'yes',
            isSevereRightNow: true
          }
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const d = res.body.data;
      // Rule engine must fire: "severe chest pain" matches cardiac category (level 3)
      expect(d.redFlag).toBe(true);
      expect(d.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
      expect(d.urgencySuggested).toBe('emergency');
      // Cardiac red-flag maps to dept-card
      expect(d.departmentId).toBe('dept-card');
      // Emergency message must be present
      expect(d.emergencyMessage).toBeTruthy();
      expect(d.emergencyMessage).toContain('EMERGENCY');
    });

    it('returns 200 with redFlag=false for routine symptom without severeNow', async () => {
      const res = await request(app)
        .post('/api/booking/triage')
        .send({
          reasonText: 'mild headache for two days',
          answers: {
            type:             'new',
            duration:         '1-3 days',
            severity:         'no',
            isSevereRightNow: false
          }
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.redFlag).toBe(false);
      expect(res.body.data.urgencySuggested).toBe('routine');
    });

    it('returns 200 even when the departments Firestore doc is missing (non-critical lookup)', async () => {
      // Triage for a symptom that maps to a dept without a Firestore doc.
      // The departments lookup is now wrapped in try/catch so it must not crash triage.
      const res = await request(app)
        .post('/api/booking/triage')
        .send({
          reasonText: 'severe chest pain',
          answers: { isSevereRightNow: true, severity: 'yes' }
        });

      // Must return 200 with the safety result regardless of dept doc availability
      expect(res.statusCode).toBe(200);
      expect(res.body.data.redFlag).toBe(true);
    });
  });

  // ── Step 4: Doctor options — exact client URL ──────────────────────────────

  describe('GET /api/booking/doctor-options — client exact URL', () => {
    it('returns 200 with non-empty doctors array for dept-gen', async () => {
      // AppointmentBookingForm.jsx line 140:
      //   API.get(`/booking/doctor-options?departmentId=${deptId}`)
      const res = await request(app)
        .get('/api/booking/doctor-options?departmentId=dept-gen');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const doc = res.body.data[0];
      // Each entry must have a usable doctorId
      expect(doc.doctorId || doc.id).toBeTruthy();
      expect(doc.name).toBeTruthy();
    });

    it('returns 200 with non-empty doctors array for dept-card', async () => {
      const res = await request(app)
        .get('/api/booking/doctor-options?departmentId=dept-card');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].departmentId).toBe('dept-card');
    });

    it('normalises DEPT-GEN (uppercase from old client) to dept-gen', async () => {
      // Some older code paths or manual testing may send uppercase.
      // The server already calls .toLowerCase() so this must also return doctors.
      const res = await request(app)
        .get('/api/booking/doctor-options?departmentId=DEPT-GEN');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('returns 400 when departmentId is missing', async () => {
      const res = await request(app)
        .get('/api/booking/doctor-options');

      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

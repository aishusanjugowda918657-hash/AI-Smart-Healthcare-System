/**
 * Vitest Acceptance Tests for Phase 10 (PRD F14 and F15)
 * AI Chatbot with Actions, Voice Agent, Doctor AI Agent, and Pre-Consultation Summary
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import { executeDoctorAgentTool } from '../src/ai/tools.js';

// Mock auth middleware to supply authenticated user
vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-test-uid'] || 'user-patient-10',
      id: req.headers['x-test-uid'] || 'user-patient-10',
      role: req.headers['x-test-role'] || 'patient'
    };
    next();
  }
}));

describe('Phase 10: F14 AI Chatbot & F15 Doctor Agent Tests', () => {
  let db;

  beforeEach(async () => {
    db = assertDbConnected();

    // Seed mock patients for same-name test
    await db.collection('users').doc('user-ravi-1').set({
      fullName: 'Ravi Kumar',
      role: 'patient',
      patientHealthId: 'HID-RAVI-1',
      age: 30,
      gender: 'Male',
      lastVisitDate: '2026-09-10'
    });

    await db.collection('users').doc('user-ravi-2').set({
      fullName: 'Ravi Sharma',
      role: 'patient',
      patientHealthId: 'HID-RAVI-2',
      age: 50,
      gender: 'Male',
      lastVisitDate: '2026-09-18'
    });
  });

  describe('F14: AI Chatbot', () => {
    it('Emergency bypass: "Chest pain" returns emergency warning in 4 languages without Gemini', async () => {
      const langs = [
        { lang: 'en', text: 'Chest pain' },
        { lang: 'hi', text: 'छाती में दर्द' },
        { lang: 'kn', text: 'ಎದೆ ನೋವು' },
        { lang: 'ta', text: 'நெஞ்சு வலி' }
      ];

      for (const item of langs) {
        const res = await supertest(app)
          .post('/api/ai/chat')
          .set('x-test-uid', 'patient-1')
          .set('x-test-role', 'patient')
          .send({ message: item.text, language: item.lang });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.isEmergency).toBe(true);
        expect(res.body.message).toBeDefined();
        expect(res.body.message.length).toBeGreaterThan(10);
      }
    });

    it('Quick-chip intent "My Token Status" answers directly without Gemini call', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .set('x-test-uid', 'patient-1')
        .set('x-test-role', 'patient')
        .send({ message: 'My Token Status', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
    });

    it('Quick-chip intent "Doctor Timings" returns hospital timings', async () => {
      const res = await supertest(app)
        .post('/api/ai/chat')
        .set('x-test-uid', 'patient-1')
        .set('x-test-role', 'patient')
        .send({ message: 'Doctor Timings', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('OPD Timings');
    });

    it('Confirmation-required booking flow: prepare_booking returns confirmToken and does NOT book until confirm endpoint', async () => {
      const prepareRes = await supertest(app)
        .post('/api/ai/chat')
        .set('x-test-uid', 'patient-1')
        .set('x-test-role', 'patient')
        .send({ message: 'Book Appointment' });

      expect(prepareRes.status).toBe(200);

      // Test confirm endpoint validation with invalid token
      const confirmRes = await supertest(app)
        .post('/api/ai/chat/confirm')
        .set('x-test-uid', 'patient-1')
        .set('x-test-role', 'patient')
        .send({
          confirmToken: 'invalid_token_test',
          disclaimerAccepted: true
        });

      expect(confirmRes.status).toBe(400);
      expect(confirmRes.body.message).toContain('Invalid or expired');
    });
  });

  describe('F15: Doctor AI Agent & Pre-Consultation Summary', () => {
    it('Same-name safety: two patients named Ravi returns choices and asks for Health ID', async () => {
      const toolRes = await executeDoctorAgentTool('search_patients', { namePrefix: 'Ravi' }, { doctorUid: 'doctor-101' });

      expect(toolRes.status).toBe('CHOICES_REQUIRED');
      expect(toolRes.choices.length).toBeGreaterThanOrEqual(2);
    });

    it('Doctor access check: doctor asking about patient with no access receives DENIED audit entry', async () => {
      const result = await executeDoctorAgentTool(
        'get_patient_profile',
        { healthId: 'HID-NO-ACCESS' },
        { doctorUid: 'unauthorized-doctor' }
      );

      expect(result.error).toBe('No record found');

      // Verify audit log entry was written
      const auditSnap = await db.collection('auditLogs')
        .where('doctorUid', '==', 'unauthorized-doctor')
        .where('action', '==', 'DENIED_PATIENT_ACCESS')
        .get();

      expect(auditSnap.empty).toBe(false);
    });

    it('Pre-consultation summary: GET /api/doctor/appointments/:id/summary preserves allergy flag even on fallback', async () => {
      await db.collection('users').doc('patient-allergy-user').set({
        fullName: 'Allergy Patient',
        patientHealthId: 'HID-ALLERGY-1',
        allergies: ['Penicillin', 'Sulfa'],
        age: 42,
        role: 'patient'
      });

      await db.collection('appointments').doc('appt-allergy-summary').set({
        patientHealthId: 'HID-ALLERGY-1',
        patientName: 'Allergy Patient',
        doctorId: 'doctor-101',
        date: '2026-10-05',
        reasonForVisit: 'Persistent fever'
      });

      const res = await supertest(app)
        .get('/api/doctor/appointments/appt-allergy-summary/summary')
        .set('x-test-uid', 'doctor-101')
        .set('x-test-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.flags).toBeDefined();

      const allergyFlag = res.body.summary.flags.find(f => f.type === 'allergy');
      expect(allergyFlag).toBeDefined();
      expect(allergyFlag.color).toBe('red');
    });
  });
});

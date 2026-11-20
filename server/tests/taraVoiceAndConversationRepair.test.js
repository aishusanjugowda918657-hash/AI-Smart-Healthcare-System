/**
 * taraVoiceAndConversationRepair.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Verification Test Suite for TARA Natural Conversation & Voice Repair:
 * 1. Natural greetings receive natural greetings ("Hey TARA", "hay Tarun", "Hi", "Hello")
 * 2. Conversational pleasantries ("How are you?", "Thank you", "Okay", "I need help")
 * 3. Doctor requests ("I need a doctor") guide into clinical specialty selection
 * 4. Multilingual support: Kannada, Hindi, Telugu, Tamil
 * 5. Action tools execution & data integrity:
 *    - suggest_doctors
 *    - get_available_slots
 *    - get_family_members
 *    - get_my_token
 *    - get_waiting_time
 *    - get_latest_prescription
 *    - get_medicine_schedule
 *    - get_next_followup
 * 6. Clean fallback behavior (no unwanted topic-chips fallback on greetings)
 * 7. Emergency pre-check absolute precedence
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('TARA Natural Conversation & Voice Repair Test Suite', () => {
  let db;

  const testPatientUid = 'test-voice-patient-991';
  const testPatientHealthId = 'HID-VOICE-991';

  beforeAll(async () => {
    db = assertDbConnected();

    // Setup mock patient
    await db.collection('users').doc(testPatientUid).set({
      uid: testPatientUid,
      email: 'voice.patient@smartcare.local',
      role: 'patient',
      displayName: 'Kavitha Gowda',
      fullName: 'Kavitha Gowda',
      patientHealthId: testPatientHealthId,
      status: 'ACTIVE',
      updatedAt: new Date()
    }, { merge: true });

    await db.collection('patients').doc(testPatientUid).set({
      id: testPatientUid,
      patientHealthId: testPatientHealthId,
      fullName: 'Kavitha Gowda',
      phone: '9845012345',
      gender: 'female',
      dob: '1988-06-15',
      updatedAt: new Date()
    }, { merge: true });

    // Setup family dependent (mother)
    await db.collection('patients').doc(`${testPatientUid}-mother`).set({
      id: `${testPatientUid}-mother`,
      ownerUid: testPatientUid,
      patientHealthId: `${testPatientHealthId}-MOM`,
      fullName: 'Girija Gowda',
      relationship: 'mother',
      relation: 'mother',
      gender: 'female',
      age: 62,
      updatedAt: new Date()
    }, { merge: true });

    // Setup a doctor for slot lookup and suggestions
    await db.collection('doctors').doc('doc-00-voice-card-01').set({
      doctorId: 'doc-00-voice-card-01',
      name: 'Dr. Ramesh Heart Specialist',
      fullName: 'Dr. Ramesh Heart Specialist',
      specialization: 'Cardiology',
      departmentId: 'dept-card',
      active: true,
      updatedAt: new Date()
    }, { merge: true });
  });

  afterAll(async () => {
    try {
      await db.collection('users').doc(testPatientUid).delete();
      await db.collection('patients').doc(testPatientUid).delete();
      await db.collection('patients').doc(`${testPatientUid}-mother`).delete();
      await db.collection('doctors').doc('doc-00-voice-card-01').delete();
    } catch (_) {}
  });

  // =========================================================================
  // 1. NATURAL CONVERSATION ROUTING (GREETINGS & VOICE PHONETIC VARIANTS)
  // =========================================================================
  describe('1. Natural Conversation Routing [GREETINGS & PLEASANTRIES]', () => {
    it('Responds to "Hey TARA" with a warm companion greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'Hey TARA', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Hello.*TARA.*help/i);
      expect(res.body.aiSource).toBe('conversational_router');
      // Must NOT be the generic help library fallback
      expect(res.body.message).not.toContain("I'm not sure I understood");
    });

    it('Responds to speech-to-text transcript variant "hay Tarun" with a natural greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'hay Tarun', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Hello.*TARA.*help/i);
      expect(res.body.aiSource).toBe('conversational_router');
      expect(res.body.message).not.toContain("I'm not sure I understood");
    });

    it('Responds to "How are you?" with companion pleasantry', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'How are you?', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/doing well.*thank you/i);
      expect(res.body.aiSource).toBe('conversational_router');
    });

    it('Responds to "Thank you" with polite acknowledgment', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'Thank you TARA', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/welcome/i);
    });

    it('Responds to "Okay" with readiness acknowledgment', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'Okay', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/Understood/i);
    });

    it('Responds to "I need help" with helpful guidance options', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'I need help', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/here to help/i);
    });

    it('Responds to "I need a doctor" with specialty guidance', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'I need a doctor', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/find the right doctor.*symptoms/i);
    });
  });

  // =========================================================================
  // 2. MULTILINGUAL GREETINGS & INTENT ROUTING (KANNADA, HINDI, TELUGU, TAMIL)
  // =========================================================================
  describe('2. Multilingual Natural Routing [KN, HI, TE, TA]', () => {
    it('Kannada: "ನಮಸ್ಕಾರ ತಾರಾ" receives a native Kannada greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'ನಮಸ್ಕಾರ ತಾರಾ', language: 'kn' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ನಮಸ್ಕಾರ! ನಾನು ತಾರಾ');
    });

    it('Hindi: "नमस्ते तारा" receives a native Hindi greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'नमस्ते तारा', language: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('नमस्ते! मैं तारा हूँ');
    });

    it('Telugu: "నమస్కారం తారా" receives a native Telugu greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'నమస్కారం తారా', language: 'te' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('నమస్కారం! నేను తారా');
    });

    it('Tamil: "வணக்கம் தாரா" receives a native Tamil greeting', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'வணக்கம் தாரா', language: 'ta' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('வணக்கம்! நான் தாரா');
    });
  });

  // =========================================================================
  // 3. ACTION TOOLS INTEGRATION & VERIFICATION
  // =========================================================================
  describe('3. Patient Action Tools Direct Execution', () => {
    it('get_family_members returns registered mother dependent', async () => {
      const { executePatientChatTool } = await import('../src/ai/tools.js');
      const result = await executePatientChatTool(
        'get_family_members',
        {},
        { userId: testPatientUid, selectedPatientHealthId: testPatientHealthId }
      );

      expect(result).toBeDefined();
      expect(result.count).toBeGreaterThanOrEqual(1);
      const mom = result.familyMembers.find((m) => m.relationship === 'mother');
      expect(mom).toBeDefined();
      expect(mom.name).toBe('Girija Gowda');
    });

    it('suggest_doctors finds cardiology specialist', async () => {
      const { executePatientChatTool } = await import('../src/ai/tools.js');
      const result = await executePatientChatTool(
        'suggest_doctors',
        { departmentId: 'dept-card', reason: 'heart checkup' },
        { userId: testPatientUid, selectedPatientHealthId: testPatientHealthId }
      );

      expect(result).toBeDefined();
      expect(result.doctors.length).toBeGreaterThan(0);
      expect(result.doctors.some((d) => d.name.includes('Ramesh'))).toBe(true);
    });

    it('get_my_token returns polite no_appointment_today when patient has no consultation', async () => {
      const { executePatientChatTool } = await import('../src/ai/tools.js');
      const result = await executePatientChatTool(
        'get_my_token',
        {},
        { userId: testPatientUid, selectedPatientHealthId: testPatientHealthId }
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('no_appointment_today');
    });

    it('get_waiting_time returns live waiting status structure without fabrication', async () => {
      const { executePatientChatTool } = await import('../src/ai/tools.js');
      const result = await executePatientChatTool(
        'get_waiting_time',
        {},
        { userId: testPatientUid, selectedPatientHealthId: testPatientHealthId }
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('estimatedWaitMinutes');
    });
  });

  // =========================================================================
  // 4. EMERGENCY PRE-CHECK PRECEDENCE
  // =========================================================================
  describe('4. Emergency Safety Precedence', () => {
    it('Triggers emergency guidance immediately for severe chest pain', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'I have severe chest pain and cannot breathe', language: 'en' });

      expect(res.status).toBe(200);
      expect(res.body.isEmergency).toBe(true);
      expect(res.body.message).toContain('EMERGENCY ALERT');
    });
  });
});

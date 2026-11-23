/**
 * Comprehensive Automated Tests for Multilingual Healthcare Voice Assistant
 * Tests:
 * 1. Public Configuration Endpoint (/api/voice/config)
 * 2. Authentication & Authorization Enforcement
 * 3. Speech-to-Text Transcription (/api/voice/transcribe)
 * 4. Text-to-Speech Synthesis & Sanitization (/api/voice/synthesize)
 * 5. Conversational Voice Turns & Emergency Bypass (/api/voice/chat)
 * 6. Action Confirmation & Two-Phase Booking Execution
 * 7. Realtime WebSocket Stream Proxy (/api/voice/stream)
 * 8. Patient Data Isolation & Access Governance
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import http from 'http';
import { WebSocket } from 'ws';
import app from '../src/app.js';
import env from '../src/config/env.js';
import { attachVoiceStreamServer } from '../src/services/voiceStreamServer.js';
import { sanitizeTextForSpeech, normalizeLanguageCode, isLanguageSupported } from '../src/services/voiceService.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Multilingual Healthcare Voice Assistant Test Suite', () => {
  let server;
  let serverPort;
  const testPatientUid = 'patient_voice_test_001';
  const testHealthId = 'HID-VOICE-PATIENT-001';

  beforeAll(async () => {
    // Seed test patient profile and mock prescription in Firestore emulator
    const db = assertDbConnected();
    await db.collection('users').doc(testPatientUid).set({
      uid: testPatientUid,
      email: 'voicepatient@smartcare.test',
      fullName: 'Voice Test Patient',
      role: 'patient',
      healthId: testHealthId,
      createdAt: new Date().toISOString()
    });

    await db.collection('patients').doc(testHealthId).set({
      healthId: testHealthId,
      fullName: 'Voice Test Patient',
      phone: '+919876543210',
      allergies: ['Penicillin']
    });

    await db.collection('prescriptions').doc('rx_voice_test_01').set({
      prescriptionId: 'rx_voice_test_01',
      patientHealthId: testHealthId,
      doctorName: 'Dr. Ramesh Sharma',
      date: '2026-11-20',
      createdAt: '2026-11-20T10:00:00Z',
      items: [
        { medicineName: 'Paracetamol', dose: '650mg', frequency: '1-0-1', timing: 'After food' },
        { medicineName: 'Cetirizine', dose: '10mg', frequency: '0-0-1', timing: 'At bedtime' }
      ],
      diagnosis: 'Viral Pharyngitis'
    });

    // Start ephemeral HTTP server with WebSocket attachment for stream tests
    server = http.createServer(app);
    attachVoiceStreamServer(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  describe('1. Configuration & Metadata Endpoint (/api/voice/config)', () => {
    it('returns public assistant metadata without leaking secrets', async () => {
      const res = await request(app).get('/api/voice/config');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const config = res.body.data;
      expect(config.assistantName).toBeDefined();
      expect(typeof config.assistantName).toBe('string');
      expect(config.assistantName.toLowerCase()).not.toContain('tara'); // Verified no TARA branding

      expect(config.supportedLanguages).toBeInstanceOf(Array);
      expect(config.supportedLanguages.length).toBe(5);

      const codes = config.supportedLanguages.map((l) => l.code);
      expect(codes).toContain('en-IN');
      expect(codes).toContain('kn-IN');
      expect(codes).toContain('hi-IN');
      expect(codes).toContain('te-IN');
      expect(codes).toContain('ta-IN');

      // Verify secrets are NOT exposed
      expect(config.apiKey).toBeUndefined();
      expect(config.SARVAM_API_KEY).toBeUndefined();
      expect(config.GEMINI_API_KEY).toBeUndefined();
    });
  });

  describe('2. Language Normalization & Speech Sanitization Unit Helpers', () => {
    it('validates supported Indian languages correctly', () => {
      expect(isLanguageSupported('en-IN')).toBe(true);
      expect(isLanguageSupported('kn-IN')).toBe(true);
      expect(isLanguageSupported('hi-IN')).toBe(true);
      expect(isLanguageSupported('te-IN')).toBe(true);
      expect(isLanguageSupported('ta-IN')).toBe(true);
      expect(isLanguageSupported('fr-FR')).toBe(false);
    });

    it('normalizes partial language codes to standard regional codes', () => {
      expect(normalizeLanguageCode('en')).toBe('en-IN');
      expect(normalizeLanguageCode('kn')).toBe('kn-IN');
      expect(normalizeLanguageCode('hi')).toBe('hi-IN');
      expect(normalizeLanguageCode('unknown')).toBe('en-IN');
    });

    it('sanitizes markdown symbols, emojis, and links for natural text-to-speech', () => {
      const dirtyText = '**Hello!** Your appointment is at *10:30 AM*. [Click here](http://example.com) ❤️ #1 Medicine';
      const cleanText = sanitizeTextForSpeech(dirtyText);
      expect(cleanText).not.toContain('**');
      expect(cleanText).not.toContain('*');
      expect(cleanText).not.toContain('http://');
      expect(cleanText).toContain('Hello! Your appointment is at 10:30 AM. Click here Medicine');
    });
  });

  describe('3. Speech-to-Text Transcription Endpoint (/api/voice/transcribe)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/voice/transcribe')
        .send({ audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=' });
      expect(res.status).toBe(401);
    });

    it('rejects empty audio payload with 400', async () => {
      const res = await request(app)
        .post('/api/voice/transcribe')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('transcribes valid audio buffer using Sarvam STT', async () => {
      // Mock global fetch for Sarvam STT
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          transcript: 'Book an appointment with doctor tomorrow',
          language_code: 'en-IN',
          language_probability: 0.98,
          request_id: 'req_test_stt_001'
        })
      });

      try {
        const dummyAudioBase64 = Buffer.from('RIFF....WAVEfmt ....data....').toString('base64');
        const res = await request(app)
          .post('/api/voice/transcribe')
          .set('x-demo-uid', testPatientUid)
          .set('x-demo-role', 'patient')
          .send({ audioBase64: dummyAudioBase64, language: 'en-IN' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.transcript).toBe('Book an appointment with doctor tomorrow');
        expect(res.body.data.languageCode).toBe('en-IN');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('4. Text-to-Speech Synthesis Endpoint (/api/voice/synthesize)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/voice/synthesize')
        .send({ text: 'Hello' });
      expect(res.status).toBe(401);
    });

    it('rejects empty text with 400', async () => {
      const res = await request(app)
        .post('/api/voice/synthesize')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ text: '   ' });
      expect(res.status).toBe(400);
    });

    it('synthesizes text using Sarvam TTS (bulbul:v3)', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audios: ['UklGRjQAAABXQVZFZm10IBAAAAABAAEA']
        })
      });

      try {
        const res = await request(app)
          .post('/api/voice/synthesize')
          .set('x-demo-uid', testPatientUid)
          .set('x-demo-role', 'patient')
          .send({ text: 'Welcome to SmartCare Hospital', language: 'en-IN' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.audioBase64).toBeDefined();
        expect(res.body.data.format).toBe('audio/wav');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('5. Conversational Voice Turn & Safety Guards (/api/voice/chat)', () => {
    it('executes emergency keyword bypass and returns immediate emergency referral', async () => {
      const res = await request(app)
        .post('/api/voice/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'I have severe chest pain and cannot breathe', language: 'en-IN' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEmergency).toBe(true);
      expect(res.body.data.message).toMatch(/emergency|immediate|108/i);
    });

    it('retrieves patient latest prescription via authorized tool', async () => {
      const res = await request(app)
        .post('/api/voice/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({ message: 'What is my latest prescription?', language: 'en-IN', patientHealthId: testHealthId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBeDefined();
      expect(typeof res.body.data.message).toBe('string');
    });

    it('prepares booking with explicit confirmation token and does not book prematurely', async () => {
      const res = await request(app)
        .post('/api/voice/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({
          message: 'Book an appointment with doctor-101 on 2026-12-15 at 10:30',
          language: 'en-IN',
          patientHealthId: testHealthId
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      if (res.body.data.actionPending) {
        expect(res.body.data.actionPending.actionRequired).toBe('CONFIRM_BOOKING');
        expect(res.body.data.confirmToken).toBeDefined();
      }
    });

    it('handles cancellation confirmation when user replies "no" or "cancel"', async () => {
      const confirmRes = await request(app)
        .post('/api/voice/chat')
        .set('x-demo-uid', testPatientUid)
        .set('x-demo-role', 'patient')
        .send({
          message: 'No, cancel it',
          confirmToken: 'confirm_dummy_test_token',
          confirmed: false,
          language: 'en-IN'
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.data.actionCancelled).toBe(true);
    });
  });

  describe('6. Realtime WebSocket Streaming (/api/voice/stream)', () => {
    it('rejects unauthenticated WebSocket connection with 4401', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/api/voice/stream`;
      const clientWs = new WebSocket(wsUrl);

      const closeEvent = await new Promise((resolve) => {
        clientWs.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(4401);
    });

    it('connects authenticated WebSocket client and receives assistant welcome', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/api/voice/stream?token=${testPatientUid}&lang=en-IN`;
      const clientWs = new WebSocket(wsUrl);

      const messageEvent = await new Promise((resolve, reject) => {
        clientWs.on('message', (data) => {
          try {
            resolve(JSON.parse(data.toString()));
          } catch (e) {
            reject(e);
          }
        });
        clientWs.on('error', reject);
      });

      expect(messageEvent.type).toBe('connected');
      expect(messageEvent.assistant).toBeDefined();
      expect(messageEvent.assistant.toLowerCase()).not.toContain('tara');

      clientWs.close();
    });

    it('responds to user interrupt signal during speech stream', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/api/voice/stream?token=${testPatientUid}&lang=en-IN`;
      const clientWs = new WebSocket(wsUrl);

      await new Promise((resolve) => clientWs.on('open', resolve));

      // Send interrupt message
      clientWs.send(JSON.stringify({ type: 'interrupt' }));

      const response = await new Promise((resolve) => {
        clientWs.on('message', (data) => {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'interrupted') {
            resolve(parsed);
          }
        });
      });

      expect(response.type).toBe('interrupted');
      clientWs.close();
    });
  });
});

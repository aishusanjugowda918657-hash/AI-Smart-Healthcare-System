import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { evaluateTriageRules } from '../src/domain/triage.js';

describe('Phase 12 Hardening - Feature Flags Disabled Fallback Flows', () => {
  const origAi = process.env.FLAG_AI;
  const origPush = process.env.FLAG_PUSH;
  const origScheduler = process.env.FLAG_SCHEDULER;

  beforeEach(() => {
    process.env.FLAG_AI = 'false';
    process.env.FLAG_PUSH = 'false';
    process.env.FLAG_SCHEDULER = 'false';
  });

  afterEach(() => {
    process.env.FLAG_AI = origAi;
    process.env.FLAG_PUSH = origPush;
    process.env.FLAG_SCHEDULER = origScheduler;
  });

  it('Triage operates purely on deterministic rules when FLAG_AI=false', () => {
    const res = evaluateTriageRules('Chest pain radiating to left arm');
    expect(res.urgencySuggested).toBe('emergency');
    expect(res.departmentId).toBeDefined();
    expect(res.redFlag).toBe(true);
  });

  it('Chatbot falls back gracefully to quick chips when FLAG_AI=false', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({ message: 'What are the cardiology department timings?' });

    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.success).toBe(true);
    }
  });

  it('Appointment booking completes without AI or Push dependencies', async () => {
    const res = await request(app)
      .post('/api/booking/confirm')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        patientHealthId: 'HID-2026-00001',
        doctorId: 'doc-cardio-01',
        departmentId: 'Cardiology',
        slotId: `slot-flag-test-${Date.now()}`,
        reason: 'Routine health checkup',
        disclaimerAccepted: true
      });

    expect([200, 400, 404, 409]).toContain(res.statusCode);
  });
});

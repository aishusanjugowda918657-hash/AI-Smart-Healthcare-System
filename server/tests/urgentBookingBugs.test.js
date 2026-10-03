import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { evaluateTriageRules, mergeAIWithRulesTriage } from '../src/domain/triage.js';
import { seedDemoDoctors } from '../scripts/seedDemoDoctors.js';

describe('Urgent Booking Bugs Verification Suite', () => {
  beforeAll(async () => {
    process.env.FLAG_AI = 'false';
    await seedDemoDoctors();
  }, 30000);

  afterEach(() => {
    process.env.FLAG_AI = 'false';
  });

  describe('BUG 1: Case-Insensitive Doctor Options API Integration Test', () => {
    it('GET /api/booking/doctor-options returns doctors for dept-gen in lowercase', async () => {
      const res = await request(app)
        .get('/api/booking/doctor-options?departmentId=dept-gen')
        .set('x-demo-uid', 'demo-patient-001')
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.some(d => d.name.includes('Rahul') || d.name.includes('Vikram'))).toBe(true);
    });

    it('GET /api/booking/doctor-options returns doctors for DEPT-GEN in uppercase (case-insensitive)', async () => {
      const res = await request(app)
        .get('/api/booking/doctor-options?departmentId=DEPT-GEN')
        .set('x-demo-uid', 'demo-patient-001')
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('BUG 2: Red Flag Triage & Safety Safeguard Unit Tests', () => {
    const testCases = [
      { text: 'severe chest pain from morning', expectedUrgency: 'emergency', category: 'cardiac' },
      { text: 'sever chest pain from morning', expectedUrgency: 'emergency', category: 'cardiac' },
      { text: 'cannot breathe', expectedUrgency: 'emergency', category: 'respiratory_severe' },
      { text: 'breathing difficulty', expectedUrgency: 'emergency', category: 'respiratory_severe' },
      { text: 'unconscious', expectedUrgency: 'emergency', category: 'neurological' },
      { text: 'heavy bleeding that will not stop', expectedUrgency: 'emergency', category: 'hemorrhage_severe' },
      { text: 'chhati me dard', expectedUrgency: 'emergency', category: 'cardiac' },
      { text: 'saans lene me takleef', expectedUrgency: 'emergency', category: 'respiratory_severe' },
      { text: 'usiru kattuvike', expectedUrgency: 'emergency', category: 'respiratory_severe' },
      { text: 'moochu thinaral', expectedUrgency: 'emergency', category: 'respiratory_severe' },
      { text: 'nenjil vali', expectedUrgency: 'emergency', category: 'cardiac' },
      { text: 'edeyalli novu', expectedUrgency: 'emergency', category: 'cardiac' }
    ];

    testCases.forEach(({ text, expectedUrgency }) => {
      it(`Triage flags "${text}" as ${expectedUrgency} with FLAG_AI=false (rules only)`, () => {
        const result = evaluateTriageRules(text);
        expect(result.urgencySuggested).toBe(expectedUrgency);
        expect(result.redFlag).toBe(true);
      });

      it(`Rules override mocked AI "routine" output for "${text}" (rules must win)`, () => {
        const ruleResult = evaluateTriageRules(text);
        const mockedAiRoutine = {
          clinicalLevel: 1,
          urgencySuggested: 'routine',
          redFlag: false,
          departmentId: 'dept-gen'
        };

        const merged = mergeAIWithRulesTriage(ruleResult, mockedAiRoutine);
        expect(merged.urgencySuggested).toBe('emergency');
        expect(merged.redFlag).toBe(true);
        expect(merged.clinicalLevel).toBe(3);
      });
    });

    it('Rule 4: "chest pain" with severe right now = Yes elevates to emergency', () => {
      const result = evaluateTriageRules('chest pain', { severity: 'yes' });
      expect(result.urgencySuggested).toBe('emergency');
      expect(result.redFlag).toBe(true);
    });

    it('Rule 4: Mild symptom with severe right now = Yes elevates to at least urgent', () => {
      const result = evaluateTriageRules('mild fever', { severity: 'yes' });
      expect(result.clinicalLevel).toBeGreaterThanOrEqual(2);
      expect(['urgent', 'emergency']).toContain(result.urgencySuggested);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { evaluateTriageRules, mergeAIWithRulesTriage, normalizeText } from '../src/domain/triage.js';
import { ClinicalLevel, Complexity } from '../src/domain/constants.js';

describe('Domain Module: Clinical Triage & Red Flag Safety Rules (PRD F4 & Section 9)', () => {
  it('normalizes multi-language text correctly', () => {
    expect(normalizeText('Chest Pain!!!')).toBe('chest pain');
    expect(normalizeText('Chhati me DARD')).toBe('chhati me dard');
    expect(normalizeText('Nenju Vali')).toBe('nenju vali');
  });

  it('flags cardiac emergency (Level 3) for English, Hindi, Tamil symptom matches', () => {
    // English
    const resEn = evaluateTriageRules('I have severe chest pain');
    expect(resEn.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resEn.redFlag).toBe(true);
    expect(resEn.departmentId).toBe('dept-card');

    // Hindi Transliterated
    const resHi = evaluateTriageRules('mujhe chhati me dard ho raha hai');
    expect(resHi.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resHi.redFlag).toBe(true);

    // Tamil Transliterated
    const resTa = evaluateTriageRules('enaku nenju vali erukku');
    expect(resTa.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resTa.redFlag).toBe(true);
  });

  it('flags high fever as Urgent (Level 2)', () => {
    const res = evaluateTriageRules('tez bukhar and chills');
    expect(res.clinicalLevel).toBe(ClinicalLevel.URGENT);
    expect(res.urgencySuggested).toBe('urgent');
    expect(res.redFlag).toBe(false);
  });

  it('returns Routine (Level 1) for normal non-emergent complaints', () => {
    const res = evaluateTriageRules('mild runny nose and mild cough for 2 days');
    expect(res.clinicalLevel).toBe(ClinicalLevel.ROUTINE);
    expect(res.redFlag).toBe(false);
  });

  it('CRITICAL SAFEGUARD: Gemini AI cannot lower a rule-based emergency result', () => {
    const ruleResult = evaluateTriageRules('severe chest pain');
    expect(ruleResult.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);

    // Malicious or hallucinated AI response attempting to downgrade to Level 1 Routine
    const fakeAiResult = {
      clinicalLevel: ClinicalLevel.ROUTINE,
      urgencySuggested: 'routine',
      departmentId: 'dept-gen',
      complexity: Complexity.SIMPLE
    };

    const merged = mergeAIWithRulesTriage(ruleResult, fakeAiResult);

    expect(merged.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(merged.redFlag).toBe(true);
    expect(merged.urgencySuggested).toBe('emergency');
    expect(merged.emergencyMessage).toBeDefined();
  });
});

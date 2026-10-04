import { describe, it, expect } from 'vitest';
import { evaluateTriageRules, mergeAIWithRulesTriage, normalizeText } from '../src/domain/triage.js';
import { ClinicalLevel, Complexity } from '../src/domain/constants.js';

describe('Domain Module: Clinical Triage & Red Flag Safety Rules (PRD F4 & Section 9)', () => {
  it('normalizes multi-language text correctly', () => {
    expect(normalizeText('Chest Pain!!!')).toBe('chest pain');
    expect(normalizeText('Chhati me DARD')).toBe('chhati me dard');
    expect(normalizeText('Nenju Vali')).toBe('nenju vali');
    expect(normalizeText('छाती में दर्द')).toBe('छाती में दर्द');
    expect(normalizeText('நெஞ்சு வலி')).toBe('நெஞ்சு வலி');
    expect(normalizeText('ಎದೆಯಲ್ಲಿ ನೋವು')).toBe('ಎದೆಯಲ್ಲಿ ನೋವು');
  });

  it('flags cardiac emergency (Level 3) across all 4 supported languages (English, Hindi, Tamil, Kannada)', () => {
    // English
    const resEn = evaluateTriageRules('I have severe chest pain');
    expect(resEn.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resEn.redFlag).toBe(true);
    expect(resEn.departmentId).toBe('dept-card');

    // Hindi Transliterated
    const resHiTrans = evaluateTriageRules('mujhe chhati me dard ho raha hai');
    expect(resHiTrans.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resHiTrans.redFlag).toBe(true);

    // Hindi Native Script
    const resHiNative = evaluateTriageRules('मुझे छाती में दर्द हो रहा है');
    expect(resHiNative.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resHiNative.redFlag).toBe(true);

    // Tamil Transliterated
    const resTaTrans = evaluateTriageRules('enaku nenju vali erukku');
    expect(resTaTrans.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resTaTrans.redFlag).toBe(true);

    // Tamil Native Script
    const resTaNative = evaluateTriageRules('எனக்கு நெஞ்சு வலி இருக்கிறது');
    expect(resTaNative.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resTaNative.redFlag).toBe(true);

    // Kannada Transliterated
    const resKnTrans = evaluateTriageRules('nanage edeyalli novu ide');
    expect(resKnTrans.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resKnTrans.redFlag).toBe(true);

    // Kannada Native Script
    const resKnNative = evaluateTriageRules('ನನಗೆ ಎದೆಯಲ್ಲಿ ನೋವು ಇದೆ');
    expect(resKnNative.clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(resKnNative.redFlag).toBe(true);
  });

  it('flags severe respiratory distress (Level 3) for English, Hindi, Tamil, Kannada', () => {
    expect(evaluateTriageRules('cannot breathe').clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(evaluateTriageRules('saans lene me takleef').clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(evaluateTriageRules('moochu thinaral').clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
    expect(evaluateTriageRules('usiru kattuvike').clinicalLevel).toBe(ClinicalLevel.EMERGENCY);
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

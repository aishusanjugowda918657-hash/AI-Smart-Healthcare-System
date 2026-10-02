/**
 * Pure Domain Module: Clinical Triage & Red Flag Rule Engine (PRD F4 & Section 9)
 * Guarantees rule-based safety overrides so AI can NEVER downgrade an emergency.
 */

import redFlagsConfig from '../config/clinical/redflags.json' with { type: 'json' };
import { ClinicalLevel, Complexity, VisitType } from './constants.js';

/**
 * Normalize text for robust multi-language pattern matching
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u0DFF]/g, ' ') // Preserve English, Devanagari, Tamil, Kannada chars
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pure function: Evaluate clinical triage rules against reason text & user answers
 *
 * @param {string} reasonText - Patient input text
 * @param {Object} [answers={}] - Extra triage questions
 * @returns {Object} Rule evaluation result
 */
export function evaluateTriageRules(reasonText = '', answers = {}) {
  const normalized = normalizeText(
    `${reasonText} ${answers.duration || ''} ${answers.severity || ''} ${answers.type || ''}`
  );

  let highestLevel = ClinicalLevel.ROUTINE;
  let urgencySuggested = 'routine';
  let redFlag = false;
  let emergencyMessage = null;
  let matchedCategory = null;

  for (const category of redFlagsConfig.categories || []) {
    for (const pattern of category.patterns || []) {
      const normPattern = normalizeText(pattern);
      if (normPattern && normalized.includes(normPattern)) {
        if (category.level > highestLevel) {
          highestLevel = category.level;
          urgencySuggested = category.urgencySuggested;
          redFlag = category.level === ClinicalLevel.EMERGENCY;
          emergencyMessage = category.emergencyMessage;
          matchedCategory = category;
        }
      }
    }
  }

  const suggestedDept = matchedCategory?.departmentId || 'dept-gen';
  const visitType = answers.type === 'followup' ? VisitType.FOLLOWUP : VisitType.NEW;
  const complexity = highestLevel === ClinicalLevel.EMERGENCY
    ? Complexity.COMPLEX
    : (highestLevel === ClinicalLevel.URGENT ? Complexity.MODERATE : Complexity.SIMPLE);

  return {
    clinicalLevel: highestLevel,
    urgencySuggested,
    redFlag,
    emergencyMessage,
    matchedCategory: matchedCategory?.id || null,
    departmentId: suggestedDept,
    visitType,
    complexity,
    followUpQuestion: highestLevel === ClinicalLevel.EMERGENCY
      ? 'Emergency alert: Do you have someone with you to help you reach the hospital?'
      : 'How long have you been experiencing these symptoms?'
  };
}

/**
 * Pure function: Safeguard merger combining Rule-Based Triage with AI Triage
 * Rule: AI can NEVER lower a rule-based clinical level!
 */
export function mergeAIWithRulesTriage(ruleResult, aiResult = null) {
  if (!aiResult) {
    return { ...ruleResult };
  }

  // Ensure AI cannot lower rule-based clinical level
  const mergedLevel = Math.max(
    ruleResult.clinicalLevel || ClinicalLevel.ROUTINE,
    aiResult.clinicalLevel || ClinicalLevel.ROUTINE
  );

  // If rule detected Emergency (Level 3), enforce Emergency parameters strictly
  if (ruleResult.clinicalLevel === ClinicalLevel.EMERGENCY) {
    return {
      ...ruleResult,
      clinicalLevel: ClinicalLevel.EMERGENCY,
      urgencySuggested: 'emergency',
      redFlag: true,
      emergencyMessage: ruleResult.emergencyMessage,
      departmentId: aiResult.departmentId || ruleResult.departmentId,
      complexity: Complexity.COMPLEX,
      followUpQuestion: ruleResult.followUpQuestion
    };
  }

  const urgencySuggestedMap = {
    [ClinicalLevel.EMERGENCY]: 'emergency',
    [ClinicalLevel.URGENT]: 'urgent',
    [ClinicalLevel.ROUTINE]: 'routine'
  };

  return {
    clinicalLevel: mergedLevel,
    urgencySuggested: urgencySuggestedMap[mergedLevel] || ruleResult.urgencySuggested,
    redFlag: mergedLevel === ClinicalLevel.EMERGENCY,
    emergencyMessage: mergedLevel === ClinicalLevel.EMERGENCY
      ? (ruleResult.emergencyMessage || 'Emergency level flagged. Please seek urgent care.')
      : null,
    matchedCategory: ruleResult.matchedCategory,
    departmentId: aiResult.departmentId || ruleResult.departmentId || 'dept-gen',
    visitType: aiResult.visitType || ruleResult.visitType || VisitType.NEW,
    complexity: aiResult.complexity || ruleResult.complexity || Complexity.MODERATE,
    followUpQuestion: aiResult.followUpQuestion || ruleResult.followUpQuestion
  };
}

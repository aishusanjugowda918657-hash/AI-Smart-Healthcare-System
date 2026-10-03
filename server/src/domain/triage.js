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
 * Levenshtein Distance for Typo Tolerance (edit-distance <= 1 for words > 4 chars)
 */
function editDistance(a, b) {
  if (!a || !b) return (a || b).length;
  if (Math.abs(a.length - b.length) > 1) return Math.abs(a.length - b.length);
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        m[i][j] = m[i - 1][j - 1];
      } else {
        m[i][j] = Math.min(
          m[i - 1][j - 1] + 1,
          m[i][j - 1] + 1,
          m[i - 1][j] + 1
        );
      }
    }
  }
  return m[b.length][a.length];
}

function tokenMatchesWithTypo(inputWord, patternWord) {
  if (inputWord === patternWord) return true;
  if (patternWord.length > 4 && inputWord.length >= 4) {
    return editDistance(inputWord, patternWord) <= 1;
  }
  return false;
}

/**
 * Check if input text matches a pattern string with phrase or word-level typo tolerance
 */
export function matchPatternWithTypo(normalizedInput, pattern) {
  const normPattern = normalizeText(pattern);
  if (!normPattern || !normalizedInput) return false;

  // Direct substring match
  if (normalizedInput.includes(normPattern)) return true;

  // Token sequence match with edit-distance tolerance
  const inputWords = normalizedInput.split(' ');
  const patternWords = normPattern.split(' ');

  if (patternWords.length === 1) {
    return inputWords.some(w => tokenMatchesWithTypo(w, patternWords[0]));
  }

  // Multi-word pattern sequence check
  for (let i = 0; i <= inputWords.length - patternWords.length; i++) {
    let match = true;
    for (let j = 0; j < patternWords.length; j++) {
      if (!tokenMatchesWithTypo(inputWords[i + j], patternWords[j])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }

  return false;
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
      if (matchPatternWithTypo(normalized, pattern)) {
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

  // Rule 4: "Severe right now = Yes" handling
  const isSevereRightNow =
    answers.severity === 'yes' ||
    answers.severity === 'high' ||
    answers.severity === true ||
    answers.isSevereRightNow === 'yes' ||
    answers.isSevereRightNow === true;

  // Key emergency symptom check (chest, breathing, bleeding, stroke, consciousness)
  const hasCriticalSymptom =
    matchedCategory?.id === 'cardiac' ||
    matchedCategory?.id === 'respiratory_severe' ||
    matchedCategory?.id === 'neurological' ||
    matchedCategory?.id === 'hemorrhage_severe' ||
    matchPatternWithTypo(normalized, 'chest') ||
    matchPatternWithTypo(normalized, 'breathe') ||
    matchPatternWithTypo(normalized, 'breathing') ||
    matchPatternWithTypo(normalized, 'bleed') ||
    matchPatternWithTypo(normalized, 'bleeding') ||
    matchPatternWithTypo(normalized, 'stroke') ||
    matchPatternWithTypo(normalized, 'unconscious');

  if (isSevereRightNow) {
    if (hasCriticalSymptom || highestLevel === ClinicalLevel.EMERGENCY) {
      highestLevel = ClinicalLevel.EMERGENCY;
      urgencySuggested = 'emergency';
      redFlag = true;
      if (!emergencyMessage) {
        emergencyMessage = 'CRITICAL EMERGENCY ALERT: Severe acute symptoms detected. Immediate emergency medical evaluation required.';
      }
    } else {
      if (highestLevel < ClinicalLevel.URGENT) {
        highestLevel = ClinicalLevel.URGENT;
        urgencySuggested = 'urgent';
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
    redFlagSuspected: redFlag,
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
      redFlagSuspected: true,
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
    redFlagSuspected: mergedLevel === ClinicalLevel.EMERGENCY,
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

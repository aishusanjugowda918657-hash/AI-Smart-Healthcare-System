/**
 * Rule-Based AI Fallbacks (PRD Section 9.1)
 * Used when FLAG_AI=false or Gemini API is unreachable
 */
import { ClinicalLevel, Complexity, VisitType } from '../domain/constants.js';

export function getTriageFallback(reasonText = '') {
  const lower = reasonText.toLowerCase();

  let departmentId = 'dept-gen';
  if (lower.includes('heart') || lower.includes('chest') || lower.includes('cardio')) {
    departmentId = 'dept-card';
  } else if (lower.includes('child') || lower.includes('baby') || lower.includes('pediatric')) {
    departmentId = 'dept-ped';
  } else if (lower.includes('bone') || lower.includes('joint') || lower.includes('fracture')) {
    departmentId = 'dept-ortho';
  } else if (lower.includes('skin') || lower.includes('rash')) {
    departmentId = 'dept-derm';
  }

  const visitType = lower.includes('follow') || lower.includes('checkup') ? VisitType.FOLLOWUP : VisitType.NEW;
  const complexity = lower.includes('severe') || lower.includes('chronic') ? Complexity.COMPLEX : Complexity.MODERATE;

  return {
    departmentId,
    visitType,
    complexity,
    urgencySuggested: 'routine',
    clinicalLevel: ClinicalLevel.ROUTINE,
    followUpQuestion: 'How long have you had these symptoms?'
  };
}

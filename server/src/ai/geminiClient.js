/**
 * Gemini Client Integration (PRD Section 9.1)
 * Safe wrapper with fallback handling when AI is disabled or API key unavailable
 */

import env from '../config/env.js';
import { isAiAvailable } from './guards.js';
import { getTriageFallback } from './fallbacks.js';
import { buildTriagePrompt } from './prompts/triage.js';
import { generateText } from '../services/geminiService.js';

/**
 * Execute clinical triage analysis via Gemini API
 */
export async function analyzeTriageWithGemini(reasonText, answers = {}) {
  if (!isAiAvailable()) {
    return getTriageFallback(reasonText);
  }

  try {
    const prompt = buildTriagePrompt(reasonText, answers);
    const text = await generateText(prompt);

    const cleanJsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJsonStr);

    return {
      departmentId: parsed.departmentId || 'dept-gen',
      visitType: parsed.visitType || 'new',
      complexity: parsed.complexity || 'moderate',
      urgencySuggested: parsed.urgencySuggested || 'routine',
      followUpQuestion: parsed.followUpQuestion || 'How long have you had these symptoms?'
    };
  } catch (error) {
    console.warn('⚠️ Gemini API triage error, falling back to rule engine:', error.message);
    return getTriageFallback(reasonText);
  }
}

/**
 * Gemini Client Integration (PRD Section 9.1)
 * Safe wrapper with fallback handling when AI is disabled or API key unavailable
 */

import { GoogleGenAI } from '@google/genai';
import env from '../config/env.js';
import { isAiAvailable } from './guards.js';
import { getTriageFallback } from './fallbacks.js';
import { buildTriagePrompt } from './prompts/triage.js';

let aiInstance = null;

try {
  if (env.GEMINI_API_KEY && !env.GEMINI_API_KEY.includes('demo')) {
    aiInstance = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
} catch (err) {
  console.warn('⚠️ Gemini AI client init warning:', err.message);
}

/**
 * Execute clinical triage analysis via Gemini API
 */
export async function analyzeTriageWithGemini(reasonText, answers = {}) {
  if (!isAiAvailable() || !aiInstance) {
    return getTriageFallback(reasonText);
  }

  try {
    const prompt = buildTriagePrompt(reasonText, answers);
    const model = aiInstance.getGenerativeModel({ model: 'gemini-3.8-flash' });
    const response = await model.generateContent(prompt);
    const text = response.text ? response.text() : '';

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

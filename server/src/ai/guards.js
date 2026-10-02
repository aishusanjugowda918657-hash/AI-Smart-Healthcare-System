/**
 * AI Service Guards & Feature Flag Inspector (PRD Section 9 & 12)
 */
import flags from '../config/flags.js';
import env from '../config/env.js';

export function isAiAvailable() {
  if (!flags.ai) return false;
  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.includes('demo') || env.GEMINI_API_KEY.includes('placeholder')) {
    return false; // API key unavailable or placeholder
  }
  return true;
}

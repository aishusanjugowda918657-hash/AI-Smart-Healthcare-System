import { ai, getAiClient } from '../config/gemini.js';

/**
 * Get configured Gemini model name from process.env.GEMINI_MODEL
 * with fallback to the standard default model.
 */
export const getModelName = () => {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
};

/**
 * Maximum time allowed for Gemini to respond (ms).
 * Keeps clinical and triage response times bounded.
 */
export const GEMINI_TIMEOUT_MS = 6000;

/**
 * Sanitize error message to ensure no API keys or credentials can ever appear in logs
 */
function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'Unknown Gemini error';
  return msg
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
}

/**
 * Generate text using Google Gen AI SDK.
 *
 * Implements:
 * - Secure environment API-key resolution
 * - Input validation
 * - Bounded timeouts
 * - Bounded retries on transient errors (rate-limit / 429 / 503)
 * - Safe error sanitization
 */
export const generateText = async (prompt, options = {}) => {
  if (!prompt || (typeof prompt !== 'string' && typeof prompt !== 'object')) {
    throw new Error('Invalid prompt provided to Gemini generateText.');
  }

  const client = getAiClient();
  if (!client) {
    throw new Error('GEMINI_API_KEY is missing or unconfigured.');
  }

  const model = getModelName();
  const timeoutMs = Number(options.timeoutMs) || GEMINI_TIMEOUT_MS;
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 1;

  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;
    let timeoutTimer = null;
    try {
      const geminiRequest = client.models.generateContent({
        model,
        contents: prompt,
      });

      const timeout = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error('Gemini API request timed out.'));
        }, timeoutMs);
      });

      const response = await Promise.race([geminiRequest, timeout]);

      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (typeof response?.text === 'function') {
        return response.text();
      }

      if (typeof response?.text === 'string') {
        return response.text;
      }

      const textFromParts = response?.candidates?.[0]?.content?.parts?.[0]?.text;
      return typeof textFromParts === 'string' ? textFromParts : '';
    } catch (error) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const sanitized = sanitizeErrorMessage(error?.message || String(error));
      lastError = new Error(sanitized);

      const isRetryable =
        sanitized.includes('429') ||
        sanitized.includes('quota') ||
        sanitized.includes('ResourceExhausted') ||
        sanitized.includes('503') ||
        sanitized.includes('timed out');

      if (attempt <= maxRetries && isRetryable) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }

      console.warn(`⚠️ Gemini API error with model [${model}]:`, sanitized);
      throw lastError;
    }
  }

  throw lastError || new Error('Gemini API call failed after retries.');
};
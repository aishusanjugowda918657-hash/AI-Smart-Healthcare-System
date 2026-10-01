import { ai } from '../config/gemini.js';

/**
 * Get configured Gemini model name from process.env.GEMINI_MODEL
 * with fallback to the current supported model.
 */
export const getModelName = () => {
  return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
};

/**
 * Maximum time we allow Gemini to respond.
 * If Gemini is unavailable or slow, the application uses
 * its existing safe fallback instead of waiting indefinitely.
 */
const GEMINI_TIMEOUT_MS = 6000;

/**
 * Generate text using Google Gen AI SDK.
 *
 * Gemini is an assistive feature only.
 * Core healthcare workflows must continue working
 * when Gemini is unavailable.
 */
export const generateText = async (prompt) => {
  if (!ai) {
    throw new Error('GEMINI_API_KEY is missing or unconfigured.');
  }

  const model = getModelName();

  try {
    const geminiRequest = ai.models.generateContent({
      model,
      contents: prompt,
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Gemini API request timed out.'));
      }, GEMINI_TIMEOUT_MS);
    });

    const response = await Promise.race([
      geminiRequest,
      timeout,
    ]);

    if (typeof response?.text === 'function') {
      return response.text();
    }

    if (typeof response?.text === 'string') {
      return response.text;
    }

    return response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (error) {
    console.warn(
      `⚠️ Gemini API error with model [${model}]:`,
      error?.message || error
    );

    throw error;
  }
};
/**
 * Cloud-Based Multilingual Voice Service
 * Integrates with Sarvam AI for:
 * - Speech-to-Text (STT): saaras:v4 (realtime streaming & REST transcription)
 * - Text-to-Speech (TTS): bulbul:v3 / bulbul:v4-flash (natural Indian voices)
 *
 * Supported languages:
 * - en-IN: English (India)
 * - kn-IN: Kannada
 * - hi-IN: Hindi
 * - te-IN: Telugu
 * - ta-IN: Tamil
 */

import env from '../config/env.js';

export const SUPPORTED_VOICE_LANGUAGES = [
  { code: 'en-IN', name: 'English', nativeName: 'English' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்' }
];

export const DEFAULT_LANGUAGE = 'en-IN';
export const DEFAULT_SPEAKER = env.SARVAM_TTS_SPEAKER || 'ritu';
export const DEFAULT_STT_MODEL = env.SARVAM_STT_MODEL || 'saaras:v4';
export const DEFAULT_TTS_MODEL = env.SARVAM_TTS_MODEL || 'bulbul:v3';
export const ASSISTANT_NAME = env.VOICE_ASSISTANT_NAME || 'Arogya';

/**
 * Validate whether a language code is supported
 */
export function isLanguageSupported(code) {
  if (!code) return false;
  return SUPPORTED_VOICE_LANGUAGES.some(
    (l) => l.code === code || l.code.toLowerCase().startsWith(code.toLowerCase().split('-')[0])
  );
}

/**
 * Normalize language code to standard xx-IN
 */
export function normalizeLanguageCode(code) {
  if (!code) return DEFAULT_LANGUAGE;
  const match = SUPPORTED_VOICE_LANGUAGES.find(
    (l) => l.code.toLowerCase() === code.toLowerCase() ||
           l.code.toLowerCase().startsWith(code.toLowerCase().split('-')[0])
  );
  return match ? match.code : DEFAULT_LANGUAGE;
}

/**
 * Clean text for natural speech synthesis (remove markdown syntax, URLs, citations)
 */
export function sanitizeTextForSpeech(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold **text** -> text
    .replace(/\*(.*?)\*/g, '$1')     // Italic *text* -> text
    .replace(/__(.*?)__/g, '$1')     // Underline __text__ -> text
    .replace(/`(.*?)`/g, '$1')       // Inline code `code` -> code
    .replace(/```[\s\S]*?```/g, '')  // Code blocks -> remove
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // Links [text](url) -> text
    .replace(/^[#>*\-\d.]+\s+/gm, '') // List markers, blockquotes, headings at line start
    .replace(/#\d+\s*/g, '')          // Inline #1, #2 markers
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u2600-\u27BF]/gu, '') // Comprehensive emoji & pictographic removal
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transcribe Audio Buffer using Sarvam STT
 */
export async function transcribeAudio(audioBuffer, options = {}) {
  const apiKey = env.SARVAM_API_KEY;
  if (!apiKey) {
    const error = new Error('SARVAM_API_KEY is not configured on the backend.');
    error.code = 'SARVAM_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const {
    mimeType = 'audio/wav',
    languageCode,
    model = DEFAULT_STT_MODEL
  } = options;

  const normalizedLang = languageCode ? normalizeLanguageCode(languageCode) : undefined;

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType }), 'audio.wav');
  form.append('model', model);
  if (normalizedLang) {
    form.append('language_code', normalizedLang);
  }

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey
    },
    body: form
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Sarvam STT failed with status ${response.status}: ${errText}`);
    error.code = 'STT_PROVIDER_ERROR';
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }

  const data = await response.json();
  return {
    transcript: data.transcript || '',
    languageCode: data.language_code || normalizedLang || DEFAULT_LANGUAGE,
    languageProbability: data.language_probability,
    requestId: data.request_id
  };
}

/**
 * Synthesize Speech Audio using Sarvam TTS
 */
export async function synthesizeSpeech(text, options = {}) {
  const apiKey = env.SARVAM_API_KEY;
  if (!apiKey) {
    const error = new Error('SARVAM_API_KEY is not configured on the backend.');
    error.code = 'SARVAM_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const cleanText = sanitizeTextForSpeech(text);
  if (!cleanText) {
    return { audioBase64: null, format: 'audio/wav', durationEstimateSec: 0 };
  }

  const {
    languageCode = DEFAULT_LANGUAGE,
    speaker = DEFAULT_SPEAKER,
    model = DEFAULT_TTS_MODEL,
    pace = 1.0
  } = options;

  const normalizedLang = normalizeLanguageCode(languageCode);

  const payload = {
    inputs: [cleanText],
    target_language_code: normalizedLang,
    speaker: speaker,
    model: model,
    pace: pace
  };

  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Sarvam TTS failed with status ${response.status}: ${errText}`);
    error.code = 'TTS_PROVIDER_ERROR';
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }

  const data = await response.json();
  const audioBase64 = data.audios && data.audios[0] ? data.audios[0] : null;

  return {
    audioBase64,
    format: 'audio/wav',
    languageCode: normalizedLang,
    speaker
  };
}

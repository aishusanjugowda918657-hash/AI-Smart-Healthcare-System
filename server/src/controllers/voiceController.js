import express from 'express';

const SARVAM_BASE_URL = 'https://api.sarvam.ai';
const SUPPORTED_LANGUAGES = new Set(['en-IN', 'hi-IN', 'kn-IN', 'te-IN', 'ta-IN']);

function getSarvamKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    const error = new Error('Voice service is not configured. Please contact the administrator.');
    error.statusCode = 503;
    throw error;
  }
  return key;
}

function safeProviderMessage(payload, fallback) {
  return payload?.error?.message || payload?.message || fallback;
}

/**
 * POST /api/voice/transcribe
 * Accepts a raw audio body (WebM/WAV/OGG/MP4/MP3) and returns the transcript.
 * Audio is processed in memory and is not written to disk or Firestore.
 */
export async function transcribeVoice(req, res, next) {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ success: false, message: 'Audio recording is required.' });
    }

    const contentType = String(req.headers['content-type'] || 'audio/webm').split(';')[0].toLowerCase();
    const allowedTypes = new Set([
      'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/ogg',
      'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/flac'
    ]);
    if (!allowedTypes.has(contentType)) {
      return res.status(415).json({ success: false, message: 'Unsupported audio format.' });
    }

    const languageCode = String(req.query.languageCode || 'unknown');
    if (languageCode !== 'unknown' && !SUPPORTED_LANGUAGES.has(languageCode)) {
      return res.status(400).json({ success: false, message: 'Unsupported language code.' });
    }

    const extensionByType = {
      'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
      'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
      'audio/aac': 'aac', 'audio/flac': 'flac'
    };

    const form = new FormData();
    form.append('file', new Blob([req.body], { type: contentType }), `patient-voice.${extensionByType[contentType] || 'webm'}`);
    form.append('model', process.env.SARVAM_STT_MODEL || 'saaras:v4');
    form.append('language_code', languageCode);
    form.append('mode', 'transcribe');

    const providerResponse = await fetch(`${SARVAM_BASE_URL}/speech-to-text`, {
      method: 'POST',
      headers: { 'api-subscription-key': getSarvamKey() },
      body: form,
      signal: AbortSignal.timeout(35000)
    });

    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      console.error('[voice] Speech-to-text provider returned', providerResponse.status);
      return res.status(providerResponse.status === 429 ? 429 : 502).json({
        success: false,
        message: safeProviderMessage(payload, 'Speech recognition is temporarily unavailable.')
      });
    }

    return res.status(200).json({
      success: true,
      transcript: payload.transcript || '',
      languageCode: payload.language_code || languageCode,
      languageProbability: payload.language_probability ?? null
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/voice/speak
 * Converts an assistant response to audio. The API key remains server-side.
 */
export async function speakVoice(req, res, next) {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const languageCode = String(req.body?.languageCode || 'en-IN');

    if (!text || text.length > 2500) {
      return res.status(400).json({ success: false, message: 'Speech text must contain 1–2500 characters.' });
    }
    if (!SUPPORTED_LANGUAGES.has(languageCode)) {
      return res.status(400).json({ success: false, message: 'Unsupported language code.' });
    }

    const providerResponse = await fetch(`${SARVAM_BASE_URL}/text-to-speech`, {
      method: 'POST',
      headers: {
        'api-subscription-key': getSarvamKey(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
        language_code: languageCode,
        speaker: process.env[`SARVAM_TTS_SPEAKER_${languageCode.replace('-', '_')}`] || ({ 'en-IN': 'ishita', 'hi-IN': 'priya', 'kn-IN': 'ishita', 'te-IN': 'neha', 'ta-IN': 'ishita' })[languageCode] || process.env.SARVAM_TTS_SPEAKER || 'ishita',
        output_audio_codec: 'wav',
        speech_sample_rate: 24000,
        pace: 0.96
      }),
      signal: AbortSignal.timeout(35000)
    });

    const payload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok || !Array.isArray(payload.audios) || !payload.audios[0]) {
      console.error('[voice] Text-to-speech provider returned', providerResponse.status);
      return res.status(providerResponse.status === 429 ? 429 : 502).json({
        success: false,
        message: safeProviderMessage(payload, 'Voice generation is temporarily unavailable.')
      });
    }

    return res.status(200).json({
      success: true,
      audio: payload.audios[0],
      contentType: 'audio/wav',
      languageCode,
      requestId: payload.request_id || null
    });
  } catch (error) {
    next(error);
  }
}

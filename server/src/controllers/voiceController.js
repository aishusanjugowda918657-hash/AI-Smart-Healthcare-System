/**
 * Multilingual Voice Assistant Controller
 * Manages cloud speech processing (STT & TTS via Sarvam AI) and
 * conversational voice turns integrated with healthcare tools.
 */

import env from '../config/env.js';
import {
  transcribeAudio,
  synthesizeSpeech,
  SUPPORTED_VOICE_LANGUAGES,
  DEFAULT_LANGUAGE,
  DEFAULT_SPEAKER,
  DEFAULT_STT_MODEL,
  DEFAULT_TTS_MODEL,
  ASSISTANT_NAME,
  normalizeLanguageCode,
  isLanguageSupported
} from '../services/voiceService.js';
import { checkEmergencyKeywords, getEmergencyResponse } from '../ai/guards.js';
import { buildChatSystemPrompt } from '../ai/prompts/chat.js';
import { runWithTools } from '../ai/geminiClient.js';
import { PATIENT_CHAT_TOOL_DECLARATIONS, executePatientChatTool, consumeConfirmToken } from '../ai/tools.js';
import { createAppointment } from './bookingController.js';
import { cancelAppointment } from './appointmentController.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';

/**
 * GET /api/voice/config
 * Returns public configuration for the voice assistant.
 */
export async function getVoiceConfig(req, res) {
  return res.status(200).json(
    formatSuccessResponse({
      assistantName: ASSISTANT_NAME,
      defaultLanguage: DEFAULT_LANGUAGE,
      defaultSpeaker: DEFAULT_SPEAKER,
      supportedLanguages: SUPPORTED_VOICE_LANGUAGES,
      models: {
        stt: DEFAULT_STT_MODEL,
        tts: DEFAULT_TTS_MODEL
      },
      hasSarvamKey: Boolean(env.SARVAM_API_KEY),
      streamingSupported: true
    })
  );
}

/**
 * POST /api/voice/transcribe
 * Transcribes audio buffer / base64 using Sarvam STT (saaras:v4)
 */
export async function transcribeAudioFile(req, res, next) {
  try {
    let audioBuffer;
    let mimeType = req.headers['content-type'] || 'audio/wav';
    const languageCode = req.query.language || req.body?.language || DEFAULT_LANGUAGE;

    if (req.body?.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
      mimeType = req.body.mimeType || 'audio/wav';
    } else if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
    } else if (req.file?.buffer) {
      audioBuffer = req.file.buffer;
      mimeType = req.file.mimetype || mimeType;
    } else {
      return res.status(400).json(
        formatErrorResponse('BAD_REQUEST', 'Audio payload (audioBase64 or multipart file) is required.')
      );
    }

    if (audioBuffer.length > 15 * 1024 * 1024) {
      return res.status(413).json(
        formatErrorResponse('PAYLOAD_TOO_LARGE', 'Audio file size exceeds the 15 MB limit.')
      );
    }

    const result = await transcribeAudio(audioBuffer, {
      mimeType,
      languageCode
    });

    return res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    if (error.code === 'SARVAM_NOT_CONFIGURED') {
      return res.status(503).json(
        formatErrorResponse('SARVAM_NOT_CONFIGURED', 'Voice transcription service is currently unavailable.')
      );
    }
    next(error);
  }
}

/**
 * POST /api/voice/synthesize
 * Synthesizes text into high-quality speech audio using Sarvam TTS (bulbul:v3)
 */
export async function synthesizeAudio(req, res, next) {
  try {
    const { text, language = DEFAULT_LANGUAGE, speaker = DEFAULT_SPEAKER, pace = 1.0 } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json(
        formatErrorResponse('BAD_REQUEST', 'Text is required for speech synthesis.')
      );
    }

    if (text.length > 2000) {
      return res.status(400).json(
        formatErrorResponse('BAD_REQUEST', 'Text length exceeds the 2000 character limit.')
      );
    }

    const result = await synthesizeSpeech(text, {
      languageCode: language,
      speaker,
      pace
    });

    return res.status(200).json(formatSuccessResponse(result));
  } catch (error) {
    if (error.code === 'SARVAM_NOT_CONFIGURED') {
      return res.status(503).json(
        formatErrorResponse('SARVAM_NOT_CONFIGURED', 'Voice synthesis service is currently unavailable.')
      );
    }
    next(error);
  }
}

/**
 * POST /api/voice/chat
 * Handles an end-to-end voice conversational turn:
 * 1. Transcribes incoming audio if speech was sent.
 * 2. Checks emergency keywords (emergency bypass).
 * 3. Handles conversational confirmation (yes/no) for pending actions.
 * 4. Calls Gemini with healthcare tools.
 * 5. Synthesizes voice audio response.
 */
export async function voiceChat(req, res, next) {
  try {
    let {
      message = '',
      language = DEFAULT_LANGUAGE,
      patientHealthId,
      audioBase64,
      mimeType = 'audio/wav',
      confirmToken,
      confirmed
    } = req.body;

    const { uid } = req.user || {};
    const selectedPatientHealthId = patientHealthId || uid;
    const langCode = normalizeLanguageCode(language);

    // 1. Transcribe audio if speech payload provided without text message
    if (!message.trim() && audioBase64) {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const sttResult = await transcribeAudio(audioBuffer, {
          mimeType,
          languageCode: langCode
        });
        message = sttResult.transcript || '';
        if (sttResult.languageCode && isLanguageSupported(sttResult.languageCode)) {
          language = sttResult.languageCode;
        }
      } catch (err) {
        console.warn('[VoiceChat] Transcription error:', err.message);
        // If STT fails and no message was provided, return informative error
        return res.status(422).json(
          formatErrorResponse('SPEECH_RECOGNITION_FAILED', 'Could not transcribe speech. Please try speaking again or use text input.')
        );
      }
    }

    if (!message || !message.trim()) {
      return res.status(400).json(
        formatErrorResponse('BAD_REQUEST', 'A spoken voice query or text message is required.')
      );
    }

    // 2. Emergency Keywords Safety Check
    if (checkEmergencyKeywords(message)) {
      const emergencyData = getEmergencyResponse(langCode.split('-')[0]);
      let emergencyAudio = null;
      if (env.SARVAM_API_KEY) {
        try {
          const synth = await synthesizeSpeech(emergencyData.message, { languageCode: langCode });
          emergencyAudio = synth.audioBase64;
        } catch (e) {
          console.warn('[VoiceChat] Emergency audio synthesis failed:', e.message);
        }
      }

      return res.status(200).json(
        formatSuccessResponse({
          userMessage: message,
          message: emergencyData.message,
          isEmergency: true,
          audioBase64: emergencyAudio,
          language: langCode
        })
      );
    }

    // 3. Spoken Action Confirmation Check (if client sent a pending confirmToken or user says "confirm" / "yes")
    const lower = message.toLowerCase().trim();
    const affirmativeWords = ['yes', 'yeah', 'yep', 'confirm', 'book it', 'proceed', 'go ahead', 'sure', 'ಸರಿ', 'ಹೌದು', 'ಮಾಡಿ', 'हाँ', 'हां', 'कर दो', 'சரி', 'அவுను'];
    const negativeWords = ['no', 'cancel', 'stop', 'dont', "don't", 'ಬೇಡ', 'ರದ್ದು', 'नहीं', 'வேண்டாம்', 'వద్దు'];

    if (confirmToken) {
      if (confirmed === true || affirmativeWords.some((w) => lower.includes(w))) {
        const tokenData = consumeConfirmToken(confirmToken);
        if (!tokenData) {
          const expiredMsg = 'Confirmation token has expired or is invalid. Please make the request again.';
          return res.status(200).json(
            formatSuccessResponse({
              userMessage: message,
              message: expiredMsg,
              audioBase64: null,
              language: langCode
            })
          );
        }

        // Execute confirmed action through standard controllers
        if (tokenData.type === 'BOOKING') {
          const fakeReq = {
            body: {
              patientHealthId: tokenData.patientHealthId,
              doctorId: tokenData.doctorId,
              date: tokenData.date,
              timeSlot: tokenData.timeSlot
            },
            user: { uid: tokenData.userId }
          };
          let bookingResult;
          const fakeRes = {
            status: (code) => ({
              json: (data) => { bookingResult = { code, ...data }; }
            })
          };

          await createAppointment(fakeReq, fakeRes, next);
          const successMsg = bookingResult?.success
            ? `Your appointment on ${tokenData.date} at ${tokenData.timeSlot} has been successfully confirmed!`
            : (bookingResult?.message || 'Failed to complete booking. Please try again.');

          let audioBase64 = null;
          if (env.SARVAM_API_KEY) {
            try {
              const synth = await synthesizeSpeech(successMsg, { languageCode: langCode });
              audioBase64 = synth.audioBase64;
            } catch (e) {
              console.warn('[VoiceChat] Synthesis error:', e.message);
            }
          }

          return res.status(200).json(
            formatSuccessResponse({
              userMessage: message,
              message: successMsg,
              actionExecuted: 'BOOKING',
              result: bookingResult,
              audioBase64,
              language: langCode
            })
          );
        }

        if (tokenData.type === 'CANCEL') {
          const fakeReq = {
            params: { id: tokenData.appointmentId },
            body: { reason: 'Cancelled by patient via voice assistant' },
            user: { uid: tokenData.userId }
          };
          let cancelResult;
          const fakeRes = {
            status: (code) => ({
              json: (data) => { cancelResult = { code, ...data }; }
            })
          };

          await cancelAppointment(fakeReq, fakeRes, next);
          const successMsg = cancelResult?.success
            ? `Appointment ${tokenData.appointmentId} has been successfully cancelled.`
            : (cancelResult?.message || 'Failed to cancel appointment.');

          let audioBase64 = null;
          if (env.SARVAM_API_KEY) {
            try {
              const synth = await synthesizeSpeech(successMsg, { languageCode: langCode });
              audioBase64 = synth.audioBase64;
            } catch (e) {
              console.warn('[VoiceChat] Synthesis error:', e.message);
            }
          }

          return res.status(200).json(
            formatSuccessResponse({
              userMessage: message,
              message: successMsg,
              actionExecuted: 'CANCEL',
              result: cancelResult,
              audioBase64,
              language: langCode
            })
          );
        }
      } else if (confirmed === false || negativeWords.some((w) => lower.includes(w))) {
        consumeConfirmToken(confirmToken);
        const cancelMsg = 'Action has been cancelled. How else may I assist you?';
        let audioBase64 = null;
        if (env.SARVAM_API_KEY) {
          try {
            const synth = await synthesizeSpeech(cancelMsg, { languageCode: langCode });
            audioBase64 = synth.audioBase64;
          } catch (e) {
            console.warn('[VoiceChat] Synthesis error:', e.message);
          }
        }
        return res.status(200).json(
          formatSuccessResponse({
            userMessage: message,
            message: cancelMsg,
            actionCancelled: true,
            audioBase64,
            language: langCode
          })
        );
      }
    }

    // 4. Run AI Conversation via Gemini with Healthcare Tools
    const systemInstruction = buildChatSystemPrompt(langCode);
    let aiResponseText = '';
    let pendingAction = null;

    try {
      const toolExecutor = async (toolName, toolArgs) => {
        const result = await executePatientChatTool(toolName, toolArgs, {
          userId: uid,
          selectedPatientHealthId
        });
        if (result?.actionRequired) {
          pendingAction = result;
        }
        return result;
      };

      const result = await runWithTools(
        systemInstruction,
        message,
        PATIENT_CHAT_TOOL_DECLARATIONS,
        toolExecutor,
        {
          language: langCode,
          patientHealthId: selectedPatientHealthId
        }
      );

      aiResponseText = result.text || 'I am here to help you with SmartCare hospital services.';
    } catch (err) {
      console.warn('[VoiceChat] Gemini tool execution error:', err.message);
      aiResponseText = 'I am currently unable to reach the medical assistant service. Please check your appointments directly or speak to hospital reception.';
    }

    // 5. Synthesize voice audio for response
    let audioBase64Result = null;
    if (env.SARVAM_API_KEY && aiResponseText) {
      try {
        const synth = await synthesizeSpeech(aiResponseText, {
          languageCode: langCode,
          speaker: req.body.speaker || DEFAULT_SPEAKER
        });
        audioBase64Result = synth.audioBase64;
      } catch (synthErr) {
        console.warn('[VoiceChat] Speech synthesis error:', synthErr.message);
      }
    }

    return res.status(200).json(
      formatSuccessResponse({
        userMessage: message,
        message: aiResponseText,
        audioBase64: audioBase64Result,
        actionPending: pendingAction,
        confirmToken: pendingAction?.confirmToken || null,
        language: langCode
      })
    );
  } catch (error) {
    next(error);
  }
}

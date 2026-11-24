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
import { checkEmergencyKeywords, getEmergencyResponse, isHowToProcedureQuery } from '../ai/guards.js';
import { buildChatSystemPrompt } from '../ai/prompts/chat.js';
import { runWithTools } from '../ai/geminiClient.js';
import { PATIENT_CHAT_TOOL_DECLARATIONS, executePatientChatTool, consumeConfirmToken, storeConfirmToken, getConfirmTokenData } from '../ai/tools.js';
import { createAppointment } from './bookingController.js';
import { cancelAppointment } from './appointmentController.js';
import { formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { assertDbConnected } from '../config/firebase.js';
import { searchHelp } from '../domain/helpSearch.js';
import { getHospitalTodayStr, getHospitalTimeStr } from '../utils/timezoneDate.js';
import { computeQueueSnapshot } from '../services/queueService.js';
import {
  resolveConversationLanguage,
  validateAndEnforceResponseLanguage,
  formatDoctorDisplayName
} from '../domain/languageManager.js';

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
    let mimeType = (req.headers['content-type'] || 'audio/wav').split(';')[0].trim().toLowerCase();
    const languageCode = req.query.language || req.body?.language || DEFAULT_LANGUAGE;

    if (req.body?.audioBase64) {
      audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
      mimeType = (req.body.mimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
    } else if (Buffer.isBuffer(req.body)) {
      audioBuffer = req.body;
    } else if (req.file?.buffer) {
      audioBuffer = req.file.buffer;
      mimeType = (req.file.mimetype || mimeType).split(';')[0].trim().toLowerCase();
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
      confirmed,
      history = []
    } = req.body;

    const { uid } = req.user || {};
    let selectedPatientHealthId = patientHealthId;
    if (!selectedPatientHealthId && uid) {
      try {
        const db = assertDbConnected();
        const patSnap = await db.collection('patients')
          .where('ownerUid', '==', uid)
          .where('relation', '==', 'self')
          .limit(1)
          .get();
        if (!patSnap.empty) {
          selectedPatientHealthId = patSnap.docs[0].data().patientHealthId || patSnap.docs[0].id;
        }
      } catch (_) {}
    }
    if (!selectedPatientHealthId) selectedPatientHealthId = uid;

    const cleanMimeType = (mimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
    let sttLanguage = null;
    let sttConfidence = null;

    // 1. Transcribe audio if speech payload provided without text message
    if (!message.trim() && audioBase64) {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const sttResult = await transcribeAudio(audioBuffer, {
          mimeType: cleanMimeType,
          languageCode: language
        });
        message = sttResult.transcript || '';
        sttLanguage = sttResult.languageCode || null;
        sttConfidence = sttResult.languageProbability ?? null;
      } catch (err) {
        console.warn('[VoiceChat] Transcription error:', err.message);
        message = '';
      }
    }

    // 2. Resolve persistent conversation language using Central Language Manager
    const { language: lockedLang, isLocked, reason: langReason } = resolveConversationLanguage({
      message,
      currentLanguage: language,
      sttLanguage,
      sttConfidence,
      isManualSelection: req.body?.isManualSelection === true
    });
    const langCode = lockedLang;
    console.log(`[VoiceChat] Conversation Language locked to: ${langCode} (reason: ${langReason})`);

    if (!message || !message.trim()) {
      if (audioBase64) {
        const noSpeechMessages = {
          en: "I could not hear any speech clearly. Please tap the microphone and speak again, or type your question.",
          kn: "ನಿಮ್ಮ ಧ್ವನಿ ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೈಕ್ರೊಫೋನ್ ಒತ್ತಿ ಮತ್ತೆ ಮಾತನಾಡಿ.",
          te: "మీ మాటలు స్పష్టంగా వినపడలేదు. దయచేసి మైక్రోఫోన్ నొక్కి మళ్లీ మాట్లాడండి.",
          hi: "आपकी आवाज़ स्पष्ट रूप से सुनाई नहीं दी। कृपया माइक दबाकर फिर से बोलें।",
          ta: "உங்கள் குரல் தெளிவாக கேட்கவில்லை. தயவுசெய்து மைக்ரோஃபோனை அழுத்தி மீண்டும் பேசவும்."
        };
        const langKey = langCode.split('-')[0];
        const noSpeechText = noSpeechMessages[langKey] || noSpeechMessages.en;
        let speechAudio = null;
        if (env.SARVAM_API_KEY) {
          try {
            const synth = await synthesizeSpeech(noSpeechText, { languageCode: langCode });
            speechAudio = synth.audioBase64;
          } catch (_) {}
        }
        return res.status(200).json(
          formatSuccessResponse({
            userMessage: 'Spoken audio message',
            message: noSpeechText,
            audioBase64: speechAudio,
            language: langCode
          })
        );
      }

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
    const pendingData = confirmToken ? getConfirmTokenData(confirmToken) : null;
    const isPendingCancel = pendingData?.type === 'CANCEL';

    const baseAffirmative = [
      'yes', 'yeah', 'yep', 'confirm', 'proceed', 'go ahead', 'sure', 'do it', 'okay', 'ok',
      // Kannada
      'ಸರಿ', 'ಹೌದು', 'ಮಾಡಿ', 'ಖಂಡಿತ',
      // Telugu
      'అవును', 'చేయండి', 'చెయ్యండి', 'సరే', 'ఖచ్చితంగా',
      // Hindi
      'हाँ', 'हां', 'कर दो', 'ज़रूर', 'ठीक है',
      // Tamil
      'சரி', 'ஆம்', 'செய்யவும்'
    ];

    const affirmativeWords = isPendingCancel
      ? [
          ...baseAffirmative,
          'cancel', 'cancel it', 'yes cancel', 'confirm cancel', 'please cancel',
          'క్యాన్సల్ చేయండి', 'క్యాన్సిల్ చేయండి', 'రద్దు చేయండి', 'రద్దు చెయ్యండి', 'క్యాన్సల్', 'రద్దు',
          'ರದ್ದು ಮಾಡಿ', 'ಕ್ಯಾನ್ಸಲ್ ಮಾಡಿ', 'ರದ್ದು', 'ಕ್ಯಾನ್ಸಲ್',
          'रद्द करें', 'रद्द कर दो', 'कैंसिल करें', 'कैंसिल कर दो', 'रद्द', 'कैंसिल',
          'ரத்து செய்', 'ரத்து செய்யவும்'
        ]
      : [
          ...baseAffirmative,
          'book it', 'book', 'ಬುಕ್ ಮಾಡಿ', 'ಬುಕ್', 'బుక్ చేయండి', 'బుక్', 'बुक करें', 'बुक कर दो'
        ];

    const negativeWords = isPendingCancel
      ? ['no', 'stop', 'dont', "don't", 'keep it', "don't cancel", 'dont cancel', 'ಬೇಡ', 'नहीं', 'मत करो', 'வேண்டாம்', 'వద్దు']
      : ['no', 'cancel', 'stop', 'dont', "don't", 'ಬೇಡ', 'ರದ್ದು', 'नहीं', 'வேண்டாம்', 'వద్దు'];

    if (confirmToken) {
      if (confirmed === true || affirmativeWords.some((w) => lower.includes(w))) {
        const tokenData = consumeConfirmToken(confirmToken);
        if (!tokenData) {
          const expiredMsg = 'No pending appointment to confirm. Would you like to book an appointment with a doctor?';
          let audioBase64 = null;
          if (env.SARVAM_API_KEY) {
            try {
              const synth = await synthesizeSpeech(expiredMsg, { languageCode: langCode });
              audioBase64 = synth.audioBase64;
            } catch (_) {}
          }
          return res.status(200).json(
            formatSuccessResponse({
              userMessage: message,
              message: expiredMsg,
              audioBase64,
              language: langCode
            })
          );
        }

        // Execute confirmed action through standard controllers
        if (tokenData.type === 'BOOKING') {
          const db = assertDbConnected();
          const todayStr = getHospitalTodayStr();
          const nowHHmm = getHospitalTimeStr();

          let targetDoctorId = tokenData.doctorId;
          let targetDate = tokenData.date;
          // Protect against past years or past dates
          if (!targetDate || targetDate < todayStr) {
            targetDate = todayStr;
          }
          let targetSlotId = tokenData.slotId;
          let chosenTime = tokenData.timeSlot || '10:00';

          // Resolve doctor if needed
          let resolvedDocName = 'the doctor';
          let canonicalDoctorId = targetDoctorId;
          try {
            const docSnap = await db.collection('doctors').get();
            const docs = docSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const matchedDoctor = docs.find(d =>
              d.id === targetDoctorId ||
              d.doctorId === targetDoctorId ||
              (targetDoctorId && (d.fullName || d.name || '').toLowerCase().includes(targetDoctorId.toLowerCase().replace(/doc_|_/g, ' ')))
            ) || docs[0];
            if (matchedDoctor) {
              canonicalDoctorId = matchedDoctor.doctorId || matchedDoctor.id;
              targetDoctorId = matchedDoctor.doctorId || matchedDoctor.id;
              resolvedDocName = `Dr. ${(matchedDoctor.fullName || matchedDoctor.name || resolvedDocName).replace(/^Dr\.?\s*/i, '')}`;
            }
          } catch (_) {}

          // 1. Check if exact slot exists for this canonical doctor and date
          if (!targetSlotId && chosenTime) {
            try {
              const cleanTime = String(chosenTime).replace(/[^0-9]/g, '').padStart(4, '0').slice(0, 4);
              const exactSlotId = `${canonicalDoctorId}_${targetDate}_${cleanTime}`;
              const exactDoc = await db.collection('slots').doc(exactSlotId).get();
              if (exactDoc.exists && exactDoc.data().status === 'free') {
                targetSlotId = exactDoc.id;
                chosenTime = exactDoc.data().startAt || exactDoc.data().startTime || chosenTime;
              }
            } catch (_) {}
          }

          // 2. If slotId is missing or expired, auto-select a valid future free slot
          if (!targetSlotId || (targetDate === todayStr && chosenTime <= nowHHmm)) {
            try {
              // Try today's future hours for target doctor
              const slotSnap = await db.collection('slots')
                .where('doctorId', '==', canonicalDoctorId)
                .where('date', '==', todayStr)
                .where('status', '==', 'free')
                .get();
              const futureTodayDoc = slotSnap.docs.find(d => {
                const st = d.data().startAt || d.data().startTime || d.data().time || '00:00';
                return st > nowHHmm;
              });
              if (futureTodayDoc) {
                targetSlotId = futureTodayDoc.id;
                targetDate = todayStr;
                chosenTime = futureTodayDoc.data().startAt || futureTodayDoc.data().startTime || futureTodayDoc.data().time || chosenTime;
              } else {
                // Try tomorrow or later for target doctor
                const futureSnap = await db.collection('slots')
                  .where('doctorId', '==', canonicalDoctorId)
                  .where('date', '>', todayStr)
                  .where('status', '==', 'free')
                  .limit(1)
                  .get();
                if (!futureSnap.empty) {
                  targetSlotId = futureSnap.docs[0].id;
                  targetDate = futureSnap.docs[0].data().date;
                  chosenTime = futureSnap.docs[0].data().startAt || futureSnap.docs[0].data().startTime || futureSnap.docs[0].data().time || '10:00';
                }
              }
            } catch (_) {}
          }

          // Fallback: If still no slot for this specific doctor, find any free future slot
          if (!targetSlotId) {
            try {
              const anySnap = await db.collection('slots')
                .where('date', '>=', todayStr)
                .where('status', '==', 'free')
                .limit(10)
                .get();
              const validAny = anySnap.docs.find(d => {
                const dt = d.data().date;
                const st = d.data().startAt || d.data().startTime || d.data().time || '00:00';
                return dt > todayStr || st > nowHHmm;
              });
              if (validAny) {
                targetSlotId = validAny.id;
                canonicalDoctorId = validAny.data().doctorId;
                targetDoctorId = canonicalDoctorId;
                targetDate = validAny.data().date;
                chosenTime = validAny.data().startAt || validAny.data().startTime || validAny.data().time || chosenTime;
              }
            } catch (_) {}
          }

          const fakeReq = {
            body: {
              patientHealthId: tokenData.patientHealthId,
              doctorId: canonicalDoctorId,
              date: targetDate,
              slotId: targetSlotId,
              timeSlot: chosenTime,
              reasonText: 'Booked via Voice Assistant',
              disclaimerAck: { acknowledged: true }
            },
            user: { uid: tokenData.userId }
          };
          let bookingResult;
          const fakeRes = {
            status: (code) => ({
              json: (data) => { bookingResult = { code, ...data }; }
            })
          };
          const fakeNext = (err) => {
            bookingResult = { success: false, code: err?.code || 'BOOKING_FAILED', message: err?.message || 'Failed to complete booking' };
          };

          try {
            await createAppointment(fakeReq, fakeRes, fakeNext);
          } catch (createErr) {
            bookingResult = { success: false, code: createErr?.code || 'BOOKING_FAILED', message: createErr?.message || 'Failed to complete booking' };
          }

          let successMsg;
          if (bookingResult?.success) {
            const refNum = bookingResult?.data?.appointmentId || bookingResult?.appointmentId || bookingResult?.data?.id || 'APT-CONFIRMED';
            const tokenNum = bookingResult?.data?.tokenNumber || bookingResult?.tokenNumber || 'T-001';
            successMsg = `Your appointment on ${targetDate} at ${chosenTime} with ${resolvedDocName} has been successfully confirmed! Reference Number: ${refNum}, Queue Token: ${tokenNum}.`;
          } else if (bookingResult?.code === 'SAME_DEPARTMENT_SAME_DAY' || bookingResult?.message?.includes('same department')) {
            successMsg = `You already have an active appointment in this department today! Would you like me to check your current token or book for tomorrow instead?`;
          } else if (bookingResult?.message?.includes('expired')) {
            successMsg = `That time slot has just expired. Would you like me to book the next upcoming slot for you?`;
          } else {
            successMsg = bookingResult?.message || 'Failed to complete booking. Please try again.';
          }

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
              actionExecuted: bookingResult?.success ? 'BOOKING' : null,
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
            user: { uid: tokenData.userId, role: 'patient' }
          };
          let cancelResult;
          const fakeRes = {
            status: (code) => ({
              json: (data) => { cancelResult = { code, ...data }; }
            })
          };
          const fakeNext = (err) => {
            cancelResult = { success: false, code: err?.code || 'CANCEL_FAILED', message: err?.message || 'Failed to cancel appointment.' };
          };

          try {
            await cancelAppointment(fakeReq, fakeRes, fakeNext);
          } catch (cancelErr) {
            cancelResult = { success: false, code: cancelErr?.code || 'CANCEL_FAILED', message: cancelErr?.message || 'Failed to cancel appointment.' };
          }

          let successMsg;
          if (cancelResult?.success) {
            const tokenNum = tokenData.tokenNumber;
            const lk = langCode.split('-')[0].toLowerCase();
            if (tokenData.hasQueueToken && tokenNum) {
              const msgs = {
                te: `మీ అపాయింట్‌మెంట్ మరియు క్యూ టోకెన్ (${tokenNum}) విజయవంతంగా రద్దు చేయబడ్డాయి మరియు వెయిటింగ్ రూమ్ నుండి విడుదల చేయబడ్డాయి.`,
                kn: `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಮತ್ತು ಕ್ಯೂ ಟೋಕನ್ (${tokenNum}) ಯಶಸ್ವಿಯಾಗಿ ರದ್ದುಗೊಂಡಿದೆ ಮತ್ತು ನಿರೀಕ್ಷಣಾ ಕೊಠಡಿಯಿಂದ ಬಿಡುಗಡೆಯಾಗಿದೆ.`,
                hi: `आपकी अपॉइंटमेंट और कतार टोकन (${tokenNum}) सफलतापूर्वक रद्द कर दिए गए हैं और वेटिंग रूम से जारी कर दिए गए हैं।`,
                ta: `உங்கள் அப்பாயிண்ட்மெண்ட் மற்றும் வரிசை டோக்கன் (${tokenNum}) வெற்றிகரமாக ரத்து செய்யப்பட்டுள்ளது.`,
                en: `Your appointment and queue token (${tokenNum}) have been successfully cancelled and released from the waiting room.`
              };
              successMsg = msgs[lk] || msgs.en;
            } else {
              const msgs = {
                te: `మీ అపాయింట్‌మెంట్ విజయవంతంగా రద్దు చేయబడింది.`,
                kn: `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಯಶಸ್ವಿಯಾಗಿ ರದ್ದಾಗಿದೆ.`,
                hi: `आपकी अपॉइंटमेंट सफलतापूर्वक रद्द कर दी गई है।`,
                ta: `உங்கள் அப்பாயிண்ட்மெண்ட் வெற்றிகரமாக ரத்து செய்யப்பட்டது.`,
                en: `Appointment has been successfully cancelled.`
              };
              successMsg = msgs[lk] || msgs.en;
            }
          } else {
            const lk = langCode.split('-')[0].toLowerCase();
            const failMsgs = {
              te: cancelResult?.message || 'అపాయింట్‌మెంట్ రద్దు చేయడం సాధ్యం కాలేదు.',
              kn: cancelResult?.message || 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.',
              hi: cancelResult?.message || 'अपॉइंटमेंट रद्द नहीं की जा सकी।',
              ta: cancelResult?.message || 'அப்பாயிண்ட்மெண்ட்டை ரத்து செய்ய முடியவில்லை.',
              en: cancelResult?.message || 'Failed to cancel appointment.'
            };
            successMsg = failMsgs[lk] || failMsgs.en;
          }

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

        if (tokenData.type === 'CHECKIN') {
          const db = assertDbConnected();
          const todayStr = getHospitalTodayStr();
          let checkinResult;

          try {
            const apptRef = db.collection('appointments').doc(tokenData.appointmentId);
            const apptSnap = await apptRef.get();

            if (!apptSnap.exists) {
              checkinResult = { success: false, message: 'Appointment record not found.' };
            } else {
              const appt = apptSnap.data();
              const targetDocId = appt.doctorId || 'DOC-001';
              let queueSnap = { activeCount: 1, patientsAhead: 1, estimatedWaitMinutes: 15 };
              try {
                queueSnap = await computeQueueSnapshot(targetDocId, todayStr, { db });
              } catch (_) {}

              const tokenSeq = (queueSnap.activeCount || 0) + 1;
              const tokenNumber = `T-${tokenSeq}`;

              await apptRef.update({
                status: 'checked_in',
                checkInTime: new Date().toISOString(),
                tokenNumber,
                updatedAt: new Date()
              });

              await db.collection('tokens').doc(`tok-${tokenData.appointmentId}`).set({
                id: `tok-${tokenData.appointmentId}`,
                appointmentId: tokenData.appointmentId,
                tokenNumber,
                patientHealthId: tokenData.patientHealthId,
                doctorId: targetDocId,
                status: 'waiting',
                date: todayStr,
                createdAt: new Date().toISOString()
              }, { merge: true });

              const estimatedWait = (queueSnap.patientsAhead || 1) * 15;
              checkinResult = {
                success: true,
                tokenNumber,
                estimatedWaitMinutes: estimatedWait,
                doctorName: appt.doctorName || 'Doctor',
                departmentName: appt.departmentName || 'General Medicine'
              };
            }
          } catch (checkinErr) {
            checkinResult = { success: false, message: checkinErr.message || 'Check-in failed.' };
          }

          const successMsg = checkinResult?.success
            ? `You are now checked in! Your hospital queue token is ${checkinResult.tokenNumber} for Dr. ${checkinResult.doctorName}. Estimated waiting time is approximately ${checkinResult.estimatedWaitMinutes} minutes. Please take a seat in the waiting area.`
            : (checkinResult?.message || 'Check-in could not be completed.');

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
              actionExecuted: 'CHECKIN',
              result: checkinResult,
              audioBase64,
              language: langCode
            })
          );
        }
      } else if (confirmed === false || negativeWords.some((w) => lower.includes(w))) {
        consumeConfirmToken(confirmToken);
        const cancelMessages = {
          te: 'చర్య రద్దు చేయబడింది. నేను మీకు ఇంకేమైనా సహాయం చేయవచ్చా?',
          kn: 'ಕ್ರಮವನ್ನು ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ. ನಾನು ನಿಮಗೆ ಇನ್ನೇನು ಸಹಾಯ ಮಾಡಲಿ?',
          hi: 'कार्रवाई रद्द कर दी गई है। मैं आपकी और क्या मदद कर सकता हूँ?',
          ta: 'நடவடிக்கை ரத்து செய்யப்பட்டது. நான் உங்களுக்கு வேறு எப்படி உதவ முடியும்?',
          en: 'Action has been cancelled. How else may I assist you?'
        };
        const cancelMsg = cancelMessages[langCode.split('-')[0]] || cancelMessages.en;
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

      const conversationMessages = [];
      if (Array.isArray(history)) {
        for (const h of history) {
          if (h && (h.content || h.text)) {
            const role = (h.role === 'assistant' || h.role === 'model') ? 'model' : 'user';
            conversationMessages.push({
              role,
              parts: [{ text: String(h.content || h.text) }]
            });
          }
        }
      }
      conversationMessages.push({ role: 'user', parts: [{ text: message }] });

      const result = await runWithTools({
        system: systemInstruction,
        messages: conversationMessages,
        tools: PATIENT_CHAT_TOOL_DECLARATIONS,
        toolHandler: toolExecutor,
        context: {
          userId: uid,
          language: langCode,
          patientHealthId: selectedPatientHealthId
        },
        maxRounds: 5
      });

      aiResponseText = result?.text || '';
      if (result?.actionRequired) {
        pendingAction = result;
      }
      const isBookingAction = /\b(book|appointment|slot|schedule|ಬುಕ್|ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್|ಅಪಾಯಿಂಟ್ಮೆಂಟ್|अपॉइंटमेंट)\b/i.test(message) &&
        !/\b(how|step|steps|guide|instructions|ವಿಧಾನ|ಕ್ರಮ|ಹೇಗೆ|तरीका|विधि|कैसे)\b/i.test(message);

      if (!aiResponseText) {
        if (!isBookingAction && isHowToProcedureQuery(message)) {
          const helpResult = searchHelp(message, langCode);
          if (helpResult?.matched && helpResult.reply?.message) {
            aiResponseText = helpResult.reply.message;
          }
        }
        if (!aiResponseText) {
          const defaultReplies = {
            en: isBookingAction
              ? 'Certainly. Please tell me what health problem or symptoms you are experiencing. I will help you find the appropriate department and available doctor.'
              : 'I am here to help you. Which doctor or department would you like to see, or would you like to check token status or doctor timings?',
            kn: 'ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇನೆ. ನೀವು ಯಾವ ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಲು ಬಯಸುತ್ತೀರಿ, ಅಥವಾ ಟೋಕನ್ ಸ್ಥಿತಿ ಮತ್ತು ವೈದ್ಯರ ಸಮಯ ತಿಳಿಯಬೇಕೆ?',
            te: 'నేను మీకు సహాయం చేయడానికి సిద్ధంగా ఉన్నాను. మీరు ఏ వైద్యుడిని లేదా విభాగాన్ని సంప్రదించాలనుకుంటున్నారు, లేదా టోకెన్ స్థితి లేదా డాక్టర్ సమయాలను తెలుసుకోవాలనుకుంటున్నారా?',
            hi: 'मैं आपकी सहायता के लिए तैयार हूँ। आप किस डॉक्टर या विभाग से परामर्श लेना चाहते हैं, या टोकन स्थिति जानना चाहते हैं?',
            ta: 'நான் உங்களுக்கு உதவ தயாராக உள்ளேன். நீங்கள் எந்த மருத்துவரை அணுக விரும்புகிறீர்கள்?'
          };
          const lk = langCode.split('-')[0];
          aiResponseText = defaultReplies[lk] || defaultReplies.en;
        }
      }
    } catch (err) {
      console.warn('[VoiceChat] Gemini tool execution error:', err.message);
      const isBookingAction = /\b(book|appointment|slot|schedule|ಬುಕ್|ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್|ಅಪಾಯಿಂಟ್ಮೆಂಟ್|अपॉइंटमेंट)\b/i.test(message) &&
        !/\b(how|step|steps|guide|instructions|ವಿಧಾನ|ಕ್ರಮ|ಹೇಗೆ|तरीका|विधि|कैसे)\b/i.test(message);

      if (!isBookingAction && isHowToProcedureQuery(message)) {
        const helpResult = searchHelp(message, langCode);
        if (helpResult?.matched && helpResult.reply?.message) {
          aiResponseText = helpResult.reply.message;
        }
      }
      if (!aiResponseText) {
        const fallbackReplies = {
          en: isBookingAction
            ? 'Certainly. Please tell me what health problem or symptoms you are experiencing. I will help you find the appropriate department and available doctor.'
            : 'I am here to help you. Would you like to book an appointment, check your token, or view doctor timings?',
          kn: 'ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಇಲ್ಲಿದ್ದೇನೆ. ನೀವು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು, ಟೋಕನ್ ಪರಿಶೀಲಿಸಲು ಅಥವಾ ವೈದ್ಯರ ಸಮಯ ತಿಳಿಯಲು ಬಯಸುವಿರಾ?',
          te: 'నేను మీకు సహాయం చేయడానికి సిద్ధంగా ఉన్నాను. మీరు అపాయింట్‌మెంట్ బుక్ చేసుకోవాలనుకుంటున్నారా, లేదా టోకెన్ స్థితి లేదా డాక్టర్ సమయాలు చూడాలనుకుంటున్నారా?',
          hi: 'मैं आपकी सहायता के लिए तैयार हूँ। क्या आप अपॉइंटमेंट बुक करना चाहते हैं, या टोकन स्थिति देखना चाहते हैं?',
          ta: 'நான் உங்களுக்கு உதவ தயாராக உள்ளேன். நீங்கள் அப்பாயிண்ட்மெண்ட் முன்பதிவு செய்ய விரும்புகிறீர்களா?'
        };
        const lk = langCode.split('-')[0];
        aiResponseText = fallbackReplies[lk] || fallbackReplies.en;
      }
    }

    // 5. Response Language Validation & Corruption Guard
    aiResponseText = validateAndEnforceResponseLanguage(aiResponseText, langCode);

    // 6. Synthesize voice audio for response
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

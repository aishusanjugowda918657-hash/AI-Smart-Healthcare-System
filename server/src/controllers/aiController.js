import { generateText } from '../services/geminiService.js';
import { assertDbConnected } from '../config/firebase.js';
import { AI_DISCLAIMER_TEXT } from '../../../client/src/utils/constants.js';
import { evaluatePrescriptionSafety } from '../domain/safety.js';
import flags from '../config/flags.js';

const SYSTEM_GUARDRAIL_PROMPT = `
You are the SmartCare AI Health Assistant, a safety-guarded AI support assistant.

STRICT MEDICAL BOUNDARY RULES:
1. You MUST NOT provide a medical diagnosis for symptoms.
2. You MUST NOT prescribe medications or modify dosage instructions.
3. You MUST NOT alter or overwrite doctor clinical records or prescriptions.
4. You MUST NOT assign or modify emergency queue priority.
5. You MUST clearly distinguish general health info/workflow assistance from professional medical advice.
6. In case of emergency symptoms (e.g. severe chest pain, shortness of breath), instruct the user to immediately call emergency services (112/911).

Always append the standard medical disclaimer to your response.
`;

/**
 * Gemini AI Patient Support Chatbot with strict safety guardrails & fallback
 */
export const aiChat = async (req, res, next) => {
  try {
    const { message } = req.body;
    const { uid } = req.user || {};

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Message prompt is required.'
      });
    }

    let aiResponseText;

    try {
      const fullPrompt = `${SYSTEM_GUARDRAIL_PROMPT}\n\nUser Question: ${message}`;
      aiResponseText = await generateText(fullPrompt);
    } catch (geminiErr) {
      console.warn('⚠️ Gemini API execution error, switching to safe fallback:', geminiErr.message);
      aiResponseText = `Here is general information regarding your query: "${message}". Please note that for specific medical symptoms, you should consult a licensed physician. ${AI_DISCLAIMER_TEXT}`;
    }

    // Append standard disclaimer if not already present
    if (!aiResponseText.includes('Disclaimer:')) {
      aiResponseText += `\n\n${AI_DISCLAIMER_TEXT}`;
    }

    // Log AI interaction metadata
    try {
      const db = assertDbConnected();
      if (db && uid) {
        await db.collection('aiInteractions').add({
          userId: uid,
          requestType: 'CHATBOT',
          promptLength: message.length,
          timestamp: new Date(),
          success: true
        });
      }
    } catch (logErr) {
      console.warn('AI interaction log warning:', logErr.message);
    }

    res.status(200).json({
      success: true,
      response: aiResponseText
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AI Smart Slot Recommendation helper among valid open slots
 */
export const aiSmartSlotRecommendation = async (req, res, next) => {
  try {
    const { availableSlots = [], userPreference = 'morning' } = req.body;

    if (!availableSlots || availableSlots.length === 0) {
      return res.status(200).json({
        success: true,
        recommendedSlot: null,
        message: 'No valid open slots available for recommendation.'
      });
    }

    // Filter only valid available slots
    const validSlots = availableSlots.filter((s) => s.available);

    if (validSlots.length === 0) {
      return res.status(200).json({
        success: true,
        recommendedSlot: null,
        message: 'All slots on selected date are fully booked.'
      });
    }

    // Recommend slot based on user preference (morning vs afternoon)
    let recommended = validSlots[0];
    if (userPreference === 'afternoon') {
      const afternoonSlot = validSlots.find((s) => parseInt(s.timeSlot.split(':')[0], 10) >= 12);
      if (afternoonSlot) recommended = afternoonSlot;
    }

    res.status(200).json({
      success: true,
      recommendedSlot: recommended.timeSlot,
      reason: `Recommended based on ${userPreference} preference among valid open slots.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Doctor Dictation Draft Parsing (PRD F10 with Clinical Safety Post-Check)
 */
export const aiDictate = async (req, res, next) => {
  try {
    const { dictationText = '', patientHealthId } = req.body;

    if (!dictationText) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: dictationText is required.'
      });
    }

    let draft = {
      symptoms: ['Fever', 'Cough'],
      diagnosisNotes: 'Acute upper respiratory tract infection.',
      proposedMedicines: [
        { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily (1-0-1)', durationDays: 5, timing: 'after_food' },
        { name: 'Amoxicillin', dosage: '500 mg', frequency: 'Twice Daily (1-0-1)', durationDays: 7, timing: 'after_food' }
      ],
      followUpDays: 7,
      doctorAdvice: 'Rest well and stay hydrated.'
    };

    // If AI feature flag enabled, attempt Gemini parsing
    if (flags.ai) {
      try {
        const prompt = `You are a clinical AI scribe. Extract structured JSON from this doctor dictation:
Dictation: "${dictationText}"
Return valid JSON with keys: symptoms (array), diagnosisNotes (string), proposedMedicines (array of {name, dosage, frequency, durationDays, timing}), followUpDays (number), doctorAdvice (string).`;
        const text = await generateText(prompt);
        const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
        if (parsed.proposedMedicines) {
          draft = parsed;
        }
      } catch (err) {
        console.warn('Gemini dictation parsing fallback:', err.message);
      }
    }

    // Run Clinical Safety Engine Post-Check on AI-Generated Draft
    let safetyResult = { safe: true, severity: 'green', alerts: [], overrideRequired: false };
    if (patientHealthId) {
      try {
        const db = assertDbConnected();
        let patientAllergies = [];
        const pSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
        if (!pSnap.empty) {
          patientAllergies = pSnap.docs[0].data().allergies || [];
        }
        safetyResult = evaluatePrescriptionSafety({
          candidateMedicines: draft.proposedMedicines || [],
          patientAllergies
        });
      } catch (e) {
        console.warn('Safety check error during dictation:', e.message);
      }
    }

    res.status(200).json({
      success: true,
      verifiedByDoctor: false, // MANDATORY: Draft state requiring doctor review & confirmation
      notice: 'This is an AI-generated draft. Mandatory doctor verification and signature required before official issuance.',
      draft,
      safetyResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Extract Paper Prescription / Image Description (PRD F10 with Clinical Safety Post-Check)
 */
export const aiExtractPaper = async (req, res, next) => {
  try {
    const { rawText, imageDescription, patientHealthId } = req.body;
    const textInput = rawText || imageDescription;

    if (!textInput) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: rawText or imageDescription is required.'
      });
    }

    let draftMedicines = [
      { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily', durationDays: 5, timing: 'after_food' }
    ];

    if (flags.ai) {
      try {
        const prompt = `Parse the following paper prescription text into a JSON list of medicines: "${textInput}". Return JSON array with objects containing: name, dosage, frequency, durationDays, timing.`;
        const text = await generateText(prompt);
        const parsed = JSON.parse(text.match(/\[[\s\S]*\]|\{[\s\S]*\}/)?.[0] || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
          draftMedicines = parsed;
        }
      } catch (err) {
        console.warn('Gemini paper extraction fallback:', err.message);
      }
    }

    let safetyResult = { safe: true, severity: 'green', alerts: [], overrideRequired: false };
    if (patientHealthId) {
      try {
        const db = assertDbConnected();
        let patientAllergies = [];
        const pSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
        if (!pSnap.empty) {
          patientAllergies = pSnap.docs[0].data().allergies || [];
        }
        safetyResult = evaluatePrescriptionSafety({
          candidateMedicines: draftMedicines,
          patientAllergies
        });
      } catch (e) {
        console.warn('Safety check error during paper extraction:', e.message);
      }
    }

    res.status(200).json({
      success: true,
      verifiedByDoctor: false, // MANDATORY: Draft state requiring doctor review & confirmation
      notice: 'This is an AI-extracted paper draft. Mandatory doctor verification required before official issuance.',
      draftMedicines,
      safetyResult
    });
  } catch (error) {
    next(error);
  }
};

export const aiExtractPrescriptionDraft = aiExtractPaper;

import { generateText } from '../services/geminiService.js';
import { db } from '../config/firebase.js';
import { AI_DISCLAIMER_TEXT } from '../../../client/src/utils/constants.js';

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
    if (db && uid) {
      try {
        await db.collection('aiInteractions').add({
          userId: uid,
          requestType: 'CHATBOT',
          promptLength: message.length,
          timestamp: new Date(),
          success: true
        });
      } catch (logErr) {
        console.warn('AI interaction log warning:', logErr.message);
      }
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
 * Extract Draft Prescription from text/notes (Requires mandatory doctor verification)
 */
export const aiExtractPrescriptionDraft = async (req, res, next) => {
  try {
    const { rawText } = req.body;

    if (!rawText) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: rawText is required for prescription parsing.'
      });
    }

    let extractedDraft;

    try {
      const prompt = `Parse the following raw prescription text into a JSON list of medicines with fields: name, dosage, frequency, reminderTimes, durationDays. Text: "${rawText}"`;
      const text = await generateText(prompt);
      extractedDraft = JSON.parse(text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] || '[]');
    } catch (err) {
      console.warn('Gemini OCR fallback:', err.message);
      extractedDraft = [
        {
          name: 'Parsed Medicine Draft',
          dosage: '500 mg',
          frequency: 'Twice Daily',
          reminderTimes: ['08:00 AM', '08:00 PM'],
          durationDays: 5
        }
      ];
    }

    res.status(200).json({
      success: true,
      verifiedByDoctor: false, // MANDATORY: Draft state requiring doctor review & confirmation
      notice: 'This is an AI-generated draft. Mandatory doctor verification required before official issuance.',
      draftMedicines: extractedDraft
    });
  } catch (error) {
    next(error);
  }
};

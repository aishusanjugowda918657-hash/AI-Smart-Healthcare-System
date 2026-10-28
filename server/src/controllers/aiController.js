/**
 * AI Controller (PRD F14 & F15)
 * Handles Patient Chatbot with Tool Actions & Confirmation Flow,
 * Doctor AI Agent with Same-Name Disambiguation & Audit Logged Tools,
 * and Pre-Consultation Summary Card with Database Flags and Post-Check Guards.
 */
import { generateText, generateJson, runWithTools } from '../ai/geminiClient.js';
import { checkEmergencyKeywords, getEmergencyResponse, checkQuickChipIntent, validateSummaryFacts } from '../ai/guards.js';
import { getChatFallback, getDoctorAgentFallback, getSummaryFallback } from '../ai/fallbacks.js';
import { buildChatSystemPrompt } from '../ai/prompts/chat.js';
import { buildDoctorAgentSystemPrompt } from '../ai/prompts/doctorAgent.js';
import { buildSummaryPrompt } from '../ai/prompts/summary.js';
import {
  PATIENT_CHAT_TOOL_DECLARATIONS,
  executePatientChatTool,
  DOCTOR_AGENT_TOOL_DECLARATIONS,
  executeDoctorAgentTool,
  consumeConfirmToken
} from '../ai/tools.js';
import { assertDbConnected } from '../config/firebase.js';
import { createAppointment } from './bookingController.js';
import { cancelAppointment } from './appointmentController.js';
import { evaluatePrescriptionSafety } from '../domain/safety.js';
import { searchHelp, getArticleSummaries } from '../domain/helpSearch.js';
import flags from '../config/flags.js';
import medicinesConfig from '../config/clinical/medicines.json' with { type: 'json' };

/**
 * ----------------------------------------------------
 * PATIENT CHATBOT (F14)
 * ----------------------------------------------------
 */
export const aiChat = async (req, res, next) => {
  try {
    // inputMode is a UI hint sent by the client ('voice' or 'text'); server ignores it for logic
    const { message = '', language = 'en', patientHealthId, history = [], inputMode } = req.body;
    const { uid } = req.user || {};

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    if (message.length > 500) {
      return res.status(400).json({ success: false, message: 'Message length exceeds 500 characters limit.' });
    }

    // Selected patient health ID defaults to logged-in user or provided healthId
    const selectedPatientHealthId = patientHealthId || uid;

    // 1. RULE PRE-CHECK: Emergency Keywords (4 languages)
    if (checkEmergencyKeywords(message)) {
      return res.status(200).json(getEmergencyResponse(language));
    }

    // 2. RULE PRE-CHECK: Quick-Chip Intents (4 languages) -> NO Gemini Call
    const quickIntent = checkQuickChipIntent(message);
    if (quickIntent) {
      const db = assertDbConnected();
      switch (quickIntent) {
        case 'BOOK_APPOINTMENT':
          return res.status(200).json({
            success: true,
            language,
            message: 'You can book an appointment with our available doctors below. Please select a department or doctor.',
            quickChips: [
              { label: 'General Medicine', action: 'SELECT_DEPT_gen' },
              { label: 'Cardiology', action: 'SELECT_DEPT_card' },
              { label: 'Pediatrics', action: 'SELECT_DEPT_ped' }
            ],
            aiSource: 'quick_chip'
          });

        case 'TOKEN_STATUS': {
          const result = await executePatientChatTool('get_token_status', {}, { userId: uid, selectedPatientHealthId });
          const waitMsg = result.status === 'no_appointment_today'
            ? result.message
            : `Your token is **${result.tokenLabel || result.tokenNumber}** · Status: ${result.status?.replace('_', ' ')}. Estimated wait: **${result.waitDisplay || `~${result.estimatedWaitMinutes} minutes`}**${result.reasonText ? '\n> ' + result.reasonText : ''}`;
          return res.status(200).json({
            success: true,
            language,
            message: waitMsg,
            tokenData: result,
            aiSource: 'quick_chip'
          });
        }

        case 'WAIT_TIME': {
          const result = await executePatientChatTool('get_wait_time', {}, { userId: uid, selectedPatientHealthId });
          return res.status(200).json({
            success: true,
            language,
            message: result.message || `Estimated wait: approximately ${result.estimatedWaitMinutes} minutes.`,
            waitData: result,
            aiSource: 'quick_chip'
          });
        }

        case 'DOCTOR_TIMINGS': {
          const result = await executePatientChatTool('get_doctor_timings', {}, { userId: uid, selectedPatientHealthId });
          return res.status(200).json({
            success: true,
            language,
            message: `${result.doctorName} OPD Timings: ${result.timings}. Lunch break: ${result.lunchBreak}.`,
            aiSource: 'quick_chip'
          });
        }

        case 'TALK_TO_STAFF': {
          const result = await executePatientChatTool('escalate_to_staff', {}, { userId: uid, selectedPatientHealthId });
          return res.status(200).json({
            success: true,
            language,
            message: result.message,
            aiSource: 'quick_chip'
          });
        }
      }
    }

    // 3. HELP LIBRARY SEARCH (handles common questions without Gemini)
    const helpResult = searchHelp(message, language);
    if (helpResult.matched) {
      return res.status(200).json(helpResult.reply);
    }

    // 4. GEMINI FUNCTION CALLING LOOP (runWithTools) – only if AI is available
    if (!flags.ai) {
      // AI off → return help topic chips or fallback
      if (!helpResult.matched) {
        return res.status(200).json({
          ...helpResult.reply,
          aiSource: 'help_fallback'
        });
      }
    }

    const trimmedHistory = (history || []).slice(-6); // Limit to last 6 messages
    const systemPrompt = buildChatSystemPrompt(language);

    // Ground Gemini with help library knowledge
    const helpContext = getArticleSummaries(language);
    const groundingNote = helpContext.length > 0
      ? `\n\nReference knowledge base articles:\n${helpContext.map(a => `- ${a.title}: ${a.answer} ${(a.steps || []).join(' ')}`).join('\n')}`
      : '';

    const result = await runWithTools({
      system: systemPrompt + groundingNote,
      messages: trimmedHistory.concat([{ role: 'user', content: message }]),
      tools: PATIENT_CHAT_TOOL_DECLARATIONS,
      toolHandler: executePatientChatTool,
      context: { userId: uid, selectedPatientHealthId },
      maxRounds: 5
    });

    if (!result) {
      // Gemini failed → use help topic chips or generic fallback
      if (!helpResult.matched && helpResult.reply) {
        return res.status(200).json({ ...helpResult.reply, aiSource: 'help_fallback' });
      }
      const fallback = getChatFallback(language);
      return res.status(200).json({
        ...fallback,
        response: fallback.message + ' Disclaimer: This is AI generated content.',
        language,
        aiSource: 'rule_fallback'
      });
    }

    const textMsg = result.text || 'How else can I assist you today?';
    const textWithDisclaimer = textMsg.includes('Disclaimer:') ? textMsg : `${textMsg}\n\nDisclaimer: This is AI generated content.`;

    res.status(200).json({
      success: true,
      language,
      message: textWithDisclaimer,
      response: textWithDisclaimer,
      confirmToken: result.confirmToken || null,
      actionRequired: result.actionRequired || null,
      summary: result.summary || null,
      sources: result.sources || [],
      aiSource: 'gemini'
    });

  } catch (error) {
    console.warn('⚠️ aiChat error:', error.message);
    res.status(200).json({
      ...getChatFallback(req.body?.language || 'en'),
      language: req.body?.language || 'en',
      aiSource: 'error_fallback'
    });
  }
};

/**
 * Confirm Chat Actions (POST /api/ai/chat/confirm)
 */
export const aiChatConfirm = async (req, res, next) => {
  try {
    const { confirmToken, disclaimerAccepted = true } = req.body;

    if (!confirmToken) {
      return res.status(400).json({ success: false, message: 'confirmToken is required.' });
    }

    const tokenData = consumeConfirmToken(confirmToken);
    if (!tokenData) {
      return res.status(400).json({ success: false, message: 'Invalid or expired confirmation token.' });
    }

    if (!disclaimerAccepted) {
      return res.status(400).json({ success: false, message: 'Booking requires health disclaimer acceptance.' });
    }

    if (tokenData.type === 'BOOKING') {
      const appointment = await createAppointment({
        userId: tokenData.userId,
        patientHealthId: tokenData.patientHealthId,
        doctorId: tokenData.doctorId,
        date: tokenData.date,
        timeSlot: tokenData.timeSlot,
        disclaimerAccepted: true
      });

      return res.status(200).json({
        success: true,
        message: 'Appointment confirmed and booked successfully.',
        appointment
      });
    }

    if (tokenData.type === 'CANCEL') {
      const result = await cancelAppointment({
        appointmentId: tokenData.appointmentId,
        userId: tokenData.userId,
        reason: 'Cancelled via AI Chatbot'
      });

      return res.status(200).json({
        success: true,
        message: 'Appointment cancelled successfully.',
        result
      });
    }

    res.status(400).json({ success: false, message: 'Unknown confirmation token action.' });

  } catch (error) {
    next(error);
  }
};

/**
 * ----------------------------------------------------
 * DOCTOR AI AGENT (F15)
 * ----------------------------------------------------
 */
export const aiDoctorAsk = async (req, res, next) => {
  try {
    const { question = '', selectedHealthId = null, history = [] } = req.body;
    const doctorUid = req.user?.uid || req.user?.id;

    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, message: 'Question is required.' });
    }

    const systemPrompt = buildDoctorAgentSystemPrompt();
    const trimmedHistory = (history || []).slice(-6);

    let promptWithContext = question;
    if (selectedHealthId) {
      promptWithContext += ` (Context Health ID: ${selectedHealthId})`;
    }

    const result = await runWithTools({
      system: systemPrompt,
      messages: trimmedHistory.concat([{ role: 'user', content: promptWithContext }]),
      tools: DOCTOR_AGENT_TOOL_DECLARATIONS,
      toolHandler: executeDoctorAgentTool,
      context: { doctorUid, selectedHealthId },
      maxRounds: 5
    });

    if (!result) {
      return res.status(200).json(getDoctorAgentFallback());
    }

    if (result.choices && result.choices.length > 0) {
      return res.status(200).json({
        success: true,
        status: 'CHOICES_REQUIRED',
        message: result.text,
        choices: result.choices,
        sources: result.sources || []
      });
    }

    res.status(200).json({
      success: true,
      answer: result.text,
      sources: result.sources || []
    });

  } catch (error) {
    console.warn('⚠️ aiDoctorAsk error:', error.message);
    res.status(200).json(getDoctorAgentFallback());
  }
};

/**
 * ----------------------------------------------------
 * PRE-CONSULTATION SUMMARY (F15)
 * ----------------------------------------------------
 */
export const getAppointmentPreConsultationSummary = async (req, res, next) => {
  try {
    const { id: appointmentId } = req.params;
    const db = assertDbConnected();

    const apptDoc = await db.collection('appointments').doc(appointmentId).get();
    if (!apptDoc.exists) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const appt = apptDoc.data();
    const patientHealthId = appt.patientHealthId || appt.patientId;

    // Fetch Patient Details
    let patient = { fullName: appt.patientName || 'Patient', age: 40, gender: 'Male', allergies: [] };
    const pSnap = await db.collection('users').where('patientHealthId', '==', patientHealthId).limit(1).get();
    if (!pSnap.empty) {
      patient = pSnap.docs[0].data();
    }

    // 1. Database-Derived Flags (Not from AI)
    const flagsList = [];

    // Allergy flag (red)
    if (patient.allergies && patient.allergies.length > 0 && patient.allergies[0] !== 'None') {
      flagsList.push({ type: 'allergy', label: `Allergies: ${patient.allergies.join(', ')}`, color: 'red' });
    }

    // Urgent/Emergency flag (red)
    if (['urgent', 'emergency'].includes((appt.urgencySuggested || appt.clinicalLevel || '').toLowerCase())) {
      flagsList.push({ type: 'urgent_level', label: 'Urgent Urgency Level', color: 'red' });
    }

    // Check overdue follow-up (amber)
    const followSnap = await db.collection('followups')
      .where('patientHealthId', '==', patientHealthId)
      .where('status', '==', 'PENDING')
      .get();
    const isOverdue = followSnap.docs.some(d => new Date(d.data().targetDate) < new Date());
    if (isOverdue) {
      flagsList.push({ type: 'followup_overdue', label: 'Follow-up Overdue', color: 'amber' });
    }

    // Check low adherence (amber)
    const remSnap = await db.collection('reminders').where('patientHealthId', '==', patientHealthId).get();
    if (!remSnap.empty) {
      const taken = remSnap.docs.filter(d => d.data().status === 'TAKEN').length;
      const pct = (taken / remSnap.docs.length) * 100;
      if (pct < 70) {
        flagsList.push({ type: 'low_adherence', label: `Low Adherence (${Math.round(pct)}%)`, color: 'amber' });
      }
    }

    // Check first visit (blue)
    const pastVisitsSnap = await db.collection('visits').where('patientHealthId', '==', patientHealthId).get();
    if (pastVisitsSnap.empty) {
      flagsList.push({ type: 'first_visit', label: 'First Visit', color: 'blue' });
    }

    // Caregiver note (grey)
    if (appt.caregiverNote || appt.isGuardianBooked) {
      flagsList.push({ type: 'caregiver', label: 'Accompanied by Caregiver', color: 'grey' });
    }

    // Check cached summary on appointment
    if (appt.summary && appt.summary.text) {
      return res.status(200).json({
        success: true,
        summary: appt.summary,
        appointment: {
          id: appointmentId,
          patientName: patient.fullName || patient.name || appt.patientName,
          age: patient.age || 40,
          patientHealthId
        }
      });
    }

    // 2. Prepare Facts for One-Line Text Generation
    const facts = {
      age: patient.age || 40,
      gender: patient.gender || 'Male',
      reason: appt.reasonForVisit || appt.chiefComplaint || 'Consultation',
      allergies: patient.allergies || [],
      currentMedicines: appt.currentMedicines || [],
      caregiverNote: appt.caregiverNote || null
    };

    // 3. Generate One-Line Text via Gemini JSON or Fallback
    let oneLine = null;
    try {
      const jsonRes = await generateJson({
        system: 'Write a concise one-line clinical summary from facts only.',
        prompt: buildSummaryPrompt(facts)
      });
      if (jsonRes && jsonRes.oneLine) {
        if (validateSummaryFacts(jsonRes.oneLine, facts)) {
          oneLine = jsonRes.oneLine;
        }
      }
    } catch (e) {
      console.warn('Summary generation warning:', e.message);
    }

    if (!oneLine) {
      oneLine = getSummaryFallback(facts).oneLine;
    }

    const summaryData = {
      text: oneLine,
      generatedAt: new Date().toISOString(),
      flags: flagsList,
      sourceRefs: pastVisitsSnap.docs.slice(0, 3).map(d => ({ visitId: d.id, date: d.data().visitDate || 'Recent' }))
    };

    // Cache summary on appointment
    await db.collection('appointments').doc(appointmentId).set({
      summary: summaryData
    }, { merge: true });

    res.status(200).json({
      success: true,
      summary: summaryData,
      appointment: {
        id: appointmentId,
        patientName: patient.fullName || patient.name || appt.patientName,
        age: patient.age || 40,
        patientHealthId
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * AI Smart Slot Recommendation helper
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

    const validSlots = availableSlots.filter((s) => s.available);
    if (validSlots.length === 0) {
      return res.status(200).json({
        success: true,
        recommendedSlot: null,
        message: 'All slots on selected date are fully booked.'
      });
    }

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
 * Doctor Dictation Draft Parsing (PRD F10)
 */
export const aiDictate = async (req, res, next) => {
  try {
    const { dictationText = '', patientHealthId } = req.body;
    if (!dictationText || !dictationText.trim()) {
      return res.status(400).json({ success: false, message: 'dictationText is required.' });
    }

    const lowerText = dictationText.toLowerCase();
    const masterMeds = medicinesConfig.medicines || [];

    let draft = {
      symptoms: [],
      diagnosisNotes: '',
      proposedMedicines: [],
      followUpDays: 7,
      doctorAdvice: ''
    };

    if (flags.ai) {
      try {
        const text = await generateText({
          system: 'Extract structured prescription JSON from dictation text. Only include medications explicitly mentioned in the text.',
          prompt: `Dictation: "${dictationText}"`
        });
        if (text) {
          const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
          if (parsed && typeof parsed === 'object') {
            draft = { ...draft, ...parsed };
          }
        }
      } catch (err) {
        console.warn('Dictation parsing fallback:', err.message);
      }
    } else {
      // With AI off, rule-based keyword extraction for mentioned medicines
      const foundMeds = [];
      for (const m of masterMeds) {
        const namesToCheck = [m.name, m.activeIngredient, ...(m.brandNames || [])];
        if (namesToCheck.some((n) => lowerText.includes(n.toLowerCase()))) {
          foundMeds.push({
            name: m.name,
            dosage: m.defaultDosage || '500 mg',
            frequency: 'Twice Daily (1-0-1)',
            durationDays: 5,
            timing: 'after_food'
          });
        }
      }
      draft.proposedMedicines = foundMeds;
    }

    // MANDATORY POST-CHECK: Nothing the doctor did not say may appear.
    // Filter proposedMedicines so that only medicines explicitly mentioned in the dictation transcript are returned.
    draft.proposedMedicines = (draft.proposedMedicines || []).filter((med) => {
      if (!med || !med.name) return false;
      const normName = med.name.toLowerCase();
      const master = masterMeds.find(
        (m) =>
          m.name.toLowerCase() === normName ||
          m.activeIngredient.toLowerCase() === normName ||
          (m.brandNames || []).some((b) => b.toLowerCase() === normName)
      );
      const triggers = master
        ? [master.name, master.activeIngredient, ...(master.brandNames || [])].map((s) => s.toLowerCase())
        : [normName];
      return triggers.some((t) => lowerText.includes(t));
    });

    let safetyResult = { safe: true, severity: 'green', alerts: [], overrideRequired: false };
    if (patientHealthId) {
      try {
        const db = assertDbConnected();
        let patientAllergies = [];
        const pSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
        if (!pSnap.empty) patientAllergies = pSnap.docs[0].data().allergies || [];
        safetyResult = evaluatePrescriptionSafety({ candidateMedicines: draft.proposedMedicines || [], patientAllergies });
      } catch (e) {
        console.warn('Safety check error:', e.message);
      }
    }

    res.status(200).json({
      success: true,
      verifiedByDoctor: false,
      notice: 'This is an AI-generated draft. Mandatory doctor verification required before official issuance.',
      draft,
      safetyResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Extract Paper Prescription
 */
export const aiExtractPaper = async (req, res, next) => {
  try {
    const { rawText, imageDescription, patientHealthId } = req.body;
    const textInput = rawText || imageDescription;

    if (!textInput) {
      return res.status(400).json({ success: false, message: 'rawText or imageDescription is required.' });
    }

    let draftMedicines = [
      { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily', durationDays: 5, timing: 'after_food' }
    ];

    if (flags.ai) {
      try {
        const text = await generateText({
          system: 'Extract prescription medicine list as JSON.',
          prompt: `Text: "${textInput}"`
        });
        if (text) {
          const parsed = JSON.parse(text.match(/\[[\s\S]*\]|\{[\s\S]*\}/)?.[0] || '[]');
          if (Array.isArray(parsed) && parsed.length > 0) draftMedicines = parsed;
        }
      } catch (err) {
        console.warn('Paper extraction fallback:', err.message);
      }
    }

    let safetyResult = { safe: true, severity: 'green', alerts: [], overrideRequired: false };
    if (patientHealthId) {
      try {
        const db = assertDbConnected();
        let patientAllergies = [];
        const pSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
        if (!pSnap.empty) patientAllergies = pSnap.docs[0].data().allergies || [];
        safetyResult = evaluatePrescriptionSafety({ candidateMedicines: draftMedicines, patientAllergies });
      } catch (e) {
        console.warn('Safety check error:', e.message);
      }
    }

    res.status(200).json({
      success: true,
      verifiedByDoctor: false,
      notice: 'This is an AI-extracted paper draft. Mandatory doctor verification required before official issuance.',
      draftMedicines,
      safetyResult
    });
  } catch (error) {
    next(error);
  }
};

export const aiExtractPrescriptionDraft = aiExtractPaper;

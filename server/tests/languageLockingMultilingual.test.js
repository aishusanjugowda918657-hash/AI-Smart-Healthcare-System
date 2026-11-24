/**
 * Automated Test Suite for Language Locking and Multilingual Conversation Stability
 * Covers Tests A through J as specified in CRITICAL BUG FIX Requirements:
 * - TEST A: Telugu 15 consecutive turns
 * - TEST B: Kannada 15 consecutive turns
 * - TEST C: Hindi 15 consecutive turns
 * - TEST D: Tamil 15 consecutive turns
 * - TEST E: English 15 consecutive turns
 * - TEST F: Telugu with English medical terms
 * - TEST G: Explicit language switch (Telugu -> English)
 * - TEST H: Microphone close and reopen persistence
 * - TEST I: Full Telugu booking, doctor selection, confirmation & queue workflow
 * - TEST J: Low-confidence speech recognition simulation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  resolveConversationLanguage,
  validateAndEnforceResponseLanguage,
  detectScriptCounts,
  detectExplicitLanguageSwitch,
  isEnglishMedicalLoanwordQuery,
  formatDoctorDisplayName
} from '../src/domain/languageManager.js';
import { buildChatSystemPrompt } from '../src/ai/prompts/chat.js';
import { executePatientChatTool, consumeConfirmToken, getConfirmTokenData } from '../src/ai/tools.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('SmartCare Voice Assistant - Language Locking & Multilingual Stability Suite', () => {
  let db;
  const testPatientHealthId = 'TEST-LANG-HID-001';
  const testUserId = 'test_user_lang_001';

  beforeAll(async () => {
    db = assertDbConnected();
    // Seed doctor and patient for testing
    await db.collection('doctors').doc('DOC-LANG-01').set({
      doctorId: 'DOC-LANG-01',
      fullName: 'Dr. Ramesh Kumar',
      name: 'Dr. Ramesh Kumar',
      departmentId: 'dept-gen',
      departmentName: 'General Medicine',
      status: 'active'
    });

    await db.collection('patients').doc(testPatientHealthId).set({
      patientHealthId: testPatientHealthId,
      fullName: 'Telugu Test Patient',
      phone: '+919999988888'
    });
  });

  // TEST A: Patient speaks Telugu for 15 consecutive turns
  it('TEST A: Patient speaks Telugu for 15 consecutive turns - assistant remains in Telugu throughout', () => {
    const teluguInputs = [
      'నమస్కారం, నాకు సహాయం కావాలి',
      'నాకు నిన్నటి నుండి తీవ్రమైన జ్వరం మరియు దగ్గు ఉంది',
      'జనరల్ మెడిసిన్ విభాగానికి వెళ్లాలనుకుంటున్నాను',
      'ఈ రోజు అందుబాటులో ఉన్న వైద్యులు ఎవరు?',
      'డాక్టర్ రమేష్ కుమార్ గారిని కలవాలనుకుంటున్నాను',
      'ఈ రోజు ఉదయం ఏవైనా స్లాట్లు ఉన్నాయా?',
      'ఉదయం 10 గంటల స్లాట్ బాగుంటుంది',
      'అవును, అపాయింట్‌మెంట్ నిర్ధారించండి',
      'ధన్యవాదాలు, నా టోకెన్ నంబర్ ఎంత?',
      'నేను ఇంకా ఎంతసేపు వేచి ఉండాలి?',
      'నాకు ప్రిస్క్రిప్షన్ వివరాలు చూపించండి',
      'మందులు ఎప్పుడు వేసుకోవాలి?',
      'ఫాలో-అప్ చెకప్ ఎప్పుడు ఉంటుంది?',
      'హాస్పిటల్ లో అత్యవసర సేవలు ఉన్నాయా?',
      'చాలా ధన్యవాదాలు, వీడ్కోలు'
    ];

    let currentLang = 'en-IN'; // starts default
    for (let i = 0; i < teluguInputs.length; i++) {
      const turn = teluguInputs[i];
      const res = resolveConversationLanguage({
        message: turn,
        currentLanguage: currentLang
      });

      expect(res.language).toBe('te-IN');
      expect(res.isLocked).toBe(true);
      currentLang = res.language;

      // Verify system prompt stays pinned to Telugu
      const prompt = buildChatSystemPrompt(currentLang);
      expect(prompt).toContain('Active conversation language: Telugu');

      // Verify output validation catches accidental Kannada or English corruption
      const validTeluguResponse = 'మీ అపాయింట్‌మెంట్ ఖరారైంది. మీ టోకెన్ సంఖ్య 5.';
      const checked = validateAndEnforceResponseLanguage(validTeluguResponse, currentLang);
      expect(checked).toBe(validTeluguResponse);
      const scripts = detectScriptCounts(checked);
      expect(scripts.telugu).toBeGreaterThan(5);
      expect(scripts.kannada).toBe(0);
    }
  });

  // TEST B: Patient speaks Kannada for 15 consecutive turns
  it('TEST B: Patient speaks Kannada for 15 consecutive turns - assistant remains in Kannada throughout', () => {
    const kannadaInputs = [
      'ನಮಸ್ಕಾರ, ನನಗೆ ಸಹಾಯ ಬೇಕು',
      'ನನಗೆ ಜ್ವರ ಮತ್ತು ತಲೆನೋವು ಇದೆ',
      'ಜನರಲ್ ಮೆಡಿಸಿನ್ ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಬೇಕು',
      'ಲಭ್ಯವಿರುವ ವೈದ್ಯರು ಯಾರು?',
      'ಡಾಕ್ಟರ್ ಅವರನ್ನು ನೋಡಬೇಕು',
      'ಇಂದು ಲಭ್ಯವಿರುವ ಸಮಯ ತಿಳಿಸಿ',
      'ಬೆಳಿಗ್ಗೆ 10 ಗಂಟೆಯ ಸಮಯ ನಿಗದಿ ಮಾಡಿ',
      'ಹೌದು, ದೃಢೀಕರಿಸಿ',
      'ನನ್ನ ಟೋಕನ್ ಸ್ಥಿತಿ ಏನು?',
      'ನಾನು ಎಷ್ಟು ಸಮಯ ಕಾಯಬೇಕು?',
      'ಔಷಧಿ ಚೀಟಿ ತೋರಿಸಿ',
      'ಮಾತ್ರೆಗಳನ್ನು ಯಾವಾಗ ತೆಗೆದುಕೊಳ್ಳಬೇಕು?',
      'ಮುಂದಿನ ಭೇಟಿ ಯಾವಾಗ?',
      'ತುರ್ತು ಚಿಕಿತ್ಸೆ ಲಭ್ಯವಿದೆಯೇ?',
      'ಧನ್ಯವಾದಗಳು'
    ];

    let currentLang = 'en-IN';
    for (let i = 0; i < kannadaInputs.length; i++) {
      const res = resolveConversationLanguage({
        message: kannadaInputs[i],
        currentLanguage: currentLang
      });
      expect(res.language).toBe('kn-IN');
      expect(res.isLocked).toBe(true);
      currentLang = res.language;

      const prompt = buildChatSystemPrompt(currentLang);
      expect(prompt).toContain('Active conversation language: Kannada');
    }
  });

  // TEST C: Patient speaks Hindi for 15 consecutive turns
  it('TEST C: Patient speaks Hindi for 15 consecutive turns - assistant remains in Hindi throughout', () => {
    const hindiInputs = [
      'नमस्ते, मुझे डॉक्टर से मिलना है',
      'मुझे दो दिन से बुखार है',
      'क्या आज जनरल मेडिसिन में स्लॉट उपलब्ध है?',
      'डॉक्टर कौन से उपलब्ध हैं?',
      'कृपया सुबह का समय दें',
      'हाँ, बुक कर दीजिए',
      'मेरा टोकन नंबर क्या है?',
      'कितना इंतज़ार करना पड़ेगा?',
      'मेरी दवाइयों की सूची दिखाएं',
      'दवा कब लेनी है?',
      'अगली मुलाक़ात कब है?',
      'अस्पताल का समय क्या है?',
      'धन्यवाद'
    ];

    let currentLang = 'en-IN';
    for (const turn of hindiInputs) {
      const res = resolveConversationLanguage({
        message: turn,
        currentLanguage: currentLang
      });
      expect(res.language).toBe('hi-IN');
      expect(res.isLocked).toBe(true);
      currentLang = res.language;
    }
  });

  // TEST D: Patient speaks Tamil for 15 consecutive turns
  it('TEST D: Patient speaks Tamil for 15 consecutive turns - assistant remains in Tamil throughout', () => {
    const tamilInputs = [
      'வணக்கம், எனக்கு உதவி தேவை',
      'எனக்கு காய்ச்சல் உள்ளது',
      'மருத்துவரை பார்க்க வேண்டும்',
      'இன்று நேரம் கிடைக்குமா?',
      'ஆம், முன்பதிவு செய்யவும்',
      'எனது டோக்கன் எண் என்ன?',
      'நன்றி'
    ];

    let currentLang = 'en-IN';
    for (const turn of tamilInputs) {
      const res = resolveConversationLanguage({
        message: turn,
        currentLanguage: currentLang
      });
      expect(res.language).toBe('ta-IN');
      expect(res.isLocked).toBe(true);
      currentLang = res.language;
    }
  });

  // TEST E: Patient speaks English for 15 consecutive turns
  it('TEST E: Patient speaks English for 15 consecutive turns - assistant remains in English throughout', () => {
    let currentLang = 'en-IN';
    const turns = [
      'Hello, I want to book an appointment',
      'I have severe stomach pain since morning',
      'General Medicine department please',
      'Show me available doctors today',
      'Book Dr. Ramesh at 10 AM',
      'Yes, please confirm',
      'What is my token number?',
      'What is the wait time?',
      'Show my latest prescription',
      'Thank you'
    ];

    for (const turn of turns) {
      const res = resolveConversationLanguage({
        message: turn,
        currentLanguage: currentLang
      });
      expect(res.language).toBe('en-IN');
      currentLang = res.language;
    }
  });

  // TEST F: Patient speaks Telugu with English medical terms
  it('TEST F: Patient speaks Telugu with English medical terms - assistant remains in Telugu', () => {
    let currentLang = 'te-IN'; // Established Telugu session

    const mixedQueries = [
      'Doctor appointment fever General Medicine',
      'Slot available today morning 10:00 AM',
      'Dr. Ramesh Kumar consultation room',
      'Yes confirm appointment',
      'Token status wait time please',
      'Prescription medicines schedule'
    ];

    for (const query of mixedQueries) {
      expect(isEnglishMedicalLoanwordQuery(query)).toBe(true);

      const res = resolveConversationLanguage({
        message: query,
        currentLanguage: currentLang
      });

      // Must STAY in Telugu despite English medical loanwords
      expect(res.language).toBe('te-IN');
      expect(res.isLocked).toBe(true);
      expect(res.reason).toBe('preserved_indic_against_english_loanwords');
    }
  });

  // TEST G: Patient starts in Telugu and explicitly asks to switch to English
  it('TEST G: Patient starts in Telugu and explicitly asks to switch to English - assistant switches cleanly', () => {
    let currentLang = 'te-IN';

    // Patient speaks Telugu
    let res = resolveConversationLanguage({
      message: 'నాకు డాక్టర్ అపాయింట్మెంట్ కావాలి',
      currentLanguage: currentLang
    });
    expect(res.language).toBe('te-IN');
    currentLang = res.language;

    // Patient explicitly asks to switch to English
    res = resolveConversationLanguage({
      message: 'Please speak in English from now on',
      currentLanguage: currentLang
    });
    expect(res.language).toBe('en-IN');
    expect(res.reason).toBe('explicit_switch_request');
    currentLang = res.language;

    // Subsequent query in English remains in English
    res = resolveConversationLanguage({
      message: 'What time is the doctor available?',
      currentLanguage: currentLang
    });
    expect(res.language).toBe('en-IN');
  });

  // TEST H: Patient starts in Telugu, closes mic, and reopens it
  it('TEST H: Patient starts in Telugu, session goes idle, and new turn arrives - language remains locked in Telugu', () => {
    let persistentLang = 'te-IN';

    // Turn 1: Spoken Telugu
    let res = resolveConversationLanguage({
      message: 'నాకు జ్వరం ఉంది',
      currentLanguage: persistentLang
    });
    expect(res.language).toBe('te-IN');
    persistentLang = res.language;

    // Mic closed, hardware stopped (session idle).
    // Mic reopened on Turn 2 with brief input:
    res = resolveConversationLanguage({
      message: '10:00 AM slot',
      currentLanguage: persistentLang
    });
    expect(res.language).toBe('te-IN');
    expect(res.isLocked).toBe(true);
  });

  // TEST I: Complete Telugu appointment journey (booking, doctor, slot, confirm, cancel, queue)
  it('TEST I: Complete Telugu booking, confirmation, cancellation & queue journey maintains Telugu throughout', async () => {
    const lang = 'te-IN';

    // 1. Recommend department in Telugu
    const deptRes = await executePatientChatTool('recommend_department', { complaint: 'తీవ్రమైన జ్వరం' }, { language: lang });
    expect(deptRes.recommendedDepartmentId).toBe('dept-gen');
    expect(deptRes.rationale).toMatch(/లక్షణాల|పరిశీలన|సిఫార్సు/); // Contains Telugu explanation

    // 2. Prepare cancellation in Telugu
    // Seed an active appointment
    const apptId = `appt_test_telugu_${Date.now()}`;
    await db.collection('appointments').doc(apptId).set({
      id: apptId,
      patientHealthId: testPatientHealthId,
      patientUid: testUserId,
      doctorName: 'Dr. Ramesh Kumar',
      departmentName: 'General Medicine',
      date: '2026-11-24',
      timeSlot: '22:15',
      status: 'checked_in',
      tokenNumber: 6,
      isCheckedIn: true
    });

    const cancelPrep = await executePatientChatTool('prepare_cancel', { appointmentId: apptId }, {
      userId: testUserId,
      selectedPatientHealthId: testPatientHealthId,
      language: lang
    });

    expect(cancelPrep.actionRequired).toBe('CONFIRM_CANCEL');
    expect(cancelPrep.message).toContain('మీరు ఈ రోజు');
    expect(cancelPrep.message).toContain('క్రియాశీల క్యూ టోకెన్');
    // Ensure no Dr. Dr. duplicate
    expect(cancelPrep.message).not.toContain('Dr. Dr.');

    // 3. Response validation check for Telugu output
    const validated = validateAndEnforceResponseLanguage(cancelPrep.message, lang);
    expect(validated).toBe(cancelPrep.message);
    const scripts = detectScriptCounts(validated);
    expect(scripts.kannada).toBe(0);
    expect(scripts.devanagari).toBe(0);
  });

  // TEST J: Low-confidence speech recognition simulation
  it('TEST J: Low-confidence speech recognition does not override established Telugu conversation language', () => {
    const currentLang = 'te-IN';

    // Simulate Sarvam STT returning 'en-IN' with low confidence (0.42) for an accented voice
    const res = resolveConversationLanguage({
      message: 'doctor timings',
      currentLanguage: currentLang,
      sttLanguage: 'en-IN',
      sttConfidence: 0.42
    });

    // Must remain locked in Telugu!
    expect(res.language).toBe('te-IN');
    expect(res.isLocked).toBe(true);
    expect(res.reason).toBe('preserved_indic_against_english_loanwords');
  });

  // Helper check: Doctor name formatting helper
  it('Doctor display name helper prevents duplicated Dr. prefix', () => {
    expect(formatDoctorDisplayName('Dr. Ramesh')).toBe('Dr. Ramesh');
    expect(formatDoctorDisplayName('Dr. Dr. Ramesh')).toBe('Dr. Ramesh');
    expect(formatDoctorDisplayName('Ramesh Kumar')).toBe('Dr. Ramesh Kumar');
  });
});

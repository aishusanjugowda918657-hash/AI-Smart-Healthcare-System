/**
 * Rule-Based AI Fallbacks (PRD Section 9.4)
 * Used when FLAG_AI=false, GEMINI_API_KEY is missing, or Gemini API fails
 */
import { ClinicalLevel, Complexity, VisitType } from '../domain/constants.js';

export function getTriageFallback(reasonText = '') {
  const lower = reasonText.toLowerCase();

  let departmentId = 'dept-gen';
  if (lower.includes('heart') || lower.includes('chest') || lower.includes('cardio')) {
    departmentId = 'dept-card';
  } else if (lower.includes('child') || lower.includes('baby') || lower.includes('pediatric')) {
    departmentId = 'dept-ped';
  } else if (lower.includes('bone') || lower.includes('joint') || lower.includes('fracture')) {
    departmentId = 'dept-ortho';
  } else if (lower.includes('skin') || lower.includes('rash')) {
    departmentId = 'dept-derm';
  }

  const visitType = lower.includes('follow') || lower.includes('checkup') ? VisitType.FOLLOWUP : VisitType.NEW;
  const complexity = lower.includes('severe') || lower.includes('chronic') ? Complexity.COMPLEX : Complexity.MODERATE;

  return {
    departmentId,
    visitType,
    complexity,
    urgencySuggested: 'routine',
    clinicalLevel: ClinicalLevel.ROUTINE,
    followUpQuestion: 'How long have you had these symptoms?'
  };
}

export function getChatFallback(language = 'en') {
  const messages = {
    en: 'I am currently operating in basic mode. You can use the quick buttons below to check token status, doctor timings, or book an appointment.',
    hi: 'मैं वर्तमान में बुनियादी मोड में काम कर रहा हूँ। आप टोकन स्थिति, डॉक्टर का समय, या अपॉइंटमेंट बुक करने के लिए नीचे दिए गए बटन का उपयोग कर सकते हैं।',
    kn: 'ನಾನು ಪ್ರಸ್ತುತ ಮೂಲಭೂತ ಮೋಡ್‌ನಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿದ್ದೇನೆ. ಟೋಕನ್ ಸ್ಥಿತಿ, ವೈದ್ಯರ ಸಮಯವನ್ನು ಪರಿಶೀಲಿಸಲು ಅಥವಾ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಕಾಯ್ದಿರಿಸಲು ನೀವು ಕೆಳಗಿನ ಬಟನ್‌ಗಳನ್ನು ಬಳಸಬಹುದು.',
    ta: 'நான் தற்போது அடிப்படை முறையில் இயங்குகிறேன். டோக்கன் நிலை, டாக்டர் நேரம் அல்லது அப்பாயிண்ட்மெண்ட் முன்பதிவு செய்ய கீழே உள்ள பொத்தான்களைப் பயன்படுத்தலாம்.'
  };

  return {
    success: true,
    message: messages[language] || messages.en,
    quickChips: [
      { label: 'Book Appointment', action: 'BOOK_APPOINTMENT' },
      { label: 'My Token Status', action: 'TOKEN_STATUS' },
      { label: 'Doctor Timings', action: 'DOCTOR_TIMINGS' },
      { label: 'Talk to Staff', action: 'TALK_TO_STAFF' }
    ],
    fallbackUsed: true
  };
}

export function getDoctorAgentFallback() {
  return {
    success: true,
    answer: 'The AI assistant is currently unavailable. Please use the patient search and history screens directly.',
    sources: [],
    fallbackUsed: true
  };
}

export function getSummaryFallback(facts = {}) {
  const ageStr = facts.age ? `${facts.age}yo` : '';
  const genderStr = facts.gender || '';
  const reasonStr = facts.reason ? `presenting for ${facts.reason}` : 'presenting for consultation';

  const allergyList = Array.isArray(facts.allergies) && facts.allergies.length > 0
    ? `Allergies: ${facts.allergies.join(', ')}.`
    : 'No known allergies.';

  const medList = Array.isArray(facts.currentMedicines) && facts.currentMedicines.length > 0
    ? `Active meds: ${facts.currentMedicines.join(', ')}.`
    : '';

  const caregiverStr = facts.caregiverNote ? `Accompanied by caregiver (${facts.caregiverNote}).` : '';

  const oneLine = [ageStr, genderStr, reasonStr, allergyList, medList, caregiverStr].filter(Boolean).join(' ').trim();

  return {
    oneLine: oneLine || 'Patient presenting for consultation. No recorded allergies.'
  };
}

export function getExplainWaitFallback(reasonText = '') {
  return reasonText || 'Your call time is estimated based on current consultation progress.';
}

export function getInstructionsFallback(prescriptionItems = []) {
  if (!prescriptionItems || prescriptionItems.length === 0) return 'Take medications as directed by your doctor.';
  return prescriptionItems.map(item => `${item.medicineName || item.name}: Take ${item.dose || '1 dose'} ${item.frequency || ''} for ${item.durationDays || 5} days.`).join('\n');
}

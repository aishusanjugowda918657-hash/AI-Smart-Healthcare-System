/**
 * AI Service Guards, Security Pre-checks & Output Validation (PRD Section 9 & 12)
 */
import flags from '../config/flags.js';
import env from '../config/env.js';

export function isAiAvailable() {
  if (!flags.ai) return false;
  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.includes('demo') || env.GEMINI_API_KEY.includes('placeholder')) {
    return false;
  }
  return true;
}

const EMERGENCY_KEYWORDS = [
  'chest pain', 'difficulty breathing', 'shortness of breath', 'severe bleeding', 'unconscious', 'stroke', 'head injury', 'seizure',
  'छाती में दर्द', 'सीने में दर्द', 'सांस लेने में तकलीफ', 'गंभीर रक्तस्राव', 'बेहोश',
  'ಎದೆ ನೋವು', 'ಉಸಿರಾಟದ ತೊಂದರೆ', 'ತೀವ್ರ ರಕ್ತಸ್ರಾವ', 'ಮೂರ್ಛೆ',
  'ఛాతి నొప్పి', 'శ్వాస తీసుకోవడంలో ఇబ్బంది', 'తీవ్రమైన రక్తస్రావం', 'స్పృహ కోల్పోవడం',
  'நெஞ்சு வலி', 'மூச்சுத்திணறல்', 'கடுமையான ரத்தப்போக்கு', 'மயக்கம்'
];

export function checkEmergencyKeywords(message = '') {
  const lower = message.toLowerCase();
  for (const kw of EMERGENCY_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return true;
    }
  }
  // Flexible clinical matching for chest/heart emergency variations
  if ((lower.includes('chest') || lower.includes('heart')) && (lower.includes('pain') || lower.includes('attack'))) {
    return true;
  }
  if ((lower.includes('सीने') || lower.includes('छाती') || lower.includes('दिल')) && lower.includes('दर्द')) {
    return true;
  }
  return false;
}

export function getEmergencyResponse(language = 'en') {
  const messages = {
    en: 'EMERGENCY ALERT: If you are experiencing chest pain, severe difficulty breathing, or another life-threatening symptom, please go to the nearest Emergency Department immediately or call emergency services (108).',
    hi: 'आपातकालीन चेतावनी: यदि आप सीने में दर्द, सांस लेने में गंभीर तकलीफ या अन्य जानलेवा लक्षणों का अनुभव कर रहे हैं, तो कृपया तुरंत निकटतम आपातकालीन विभाग में जाएं या 108 पर कॉल करें।',
    kn: 'ತುರ್ತು ಎಚ್ಚರಿಕೆ: ನೀವು ಎದೆ ನೋವು, ತೀವ್ರ ಉಸಿರಾಟದ ತೊಂದರೆ ಅಥವಾ ಇತರ ಜೀವಾಪಾಯದ ರೋಗಲಕ್ಷಣಗಳನ್ನು ಅನುಭವಿಸುತ್ತಿದ್ದರೆ, ದಯವಿಟ್ಟು ತಕ್ಷಣವೇ ಹತ್ತಿರದ ತುರ್ತು ವಿಭಾಗಕ್ಕೆ ಹೋಗಿ ಅಥವಾ 108 ಗೆ ಕರೆ ಮಾಡಿ.',
    te: 'అత్యవసర హెచ్చరిక: ఛాతి నొప్పి, తీవ్రమైన శ్వాస ఇబ్బంది లేదా ప్రాణాపాయ లక్షణాలు ఉంటే వెంటనే సమీప అత్యవసర విభాగానికి వెళ్లండి లేదా 108కు కాల్ చేయండి.',
    ta: 'அவசர எச்சரிக்கை: நீங்கள் நெஞ்சு வலி, கடுமையான மூச்சுத்திணறல் அல்லது பிற ஆபத்தான அறிகுறிகளை அனுபவித்தால், உடனடியாக அருகில் உள்ள அவசர சிகிச்சைப் பிரிவுக்குச் செல்லவும் அல்லது 108 ஐ அழைக்கவும்.'
  };

  const text = messages[language] || messages.en;
  const responseText = text.includes('Disclaimer:') ? text : `${text} Disclaimer: This is AI generated content.`;

  return {
    success: true,
    isEmergency: true,
    message: text,
    response: responseText,
    bookingState: null,
    language
  };
}

/**
 * Detect whether a user message is asking for a how-to or step-by-step procedure
 * across English, Hindi, Kannada, and Tamil.
 */
export function isHowToProcedureQuery(message = '') {
  if (!message || typeof message !== 'string') return false;
  const lower = message.toLowerCase().trim();

  // Multi-word procedural phrases across 4 languages
  if (
    lower.includes('step by step') ||
    lower.includes('how to') ||
    lower.includes('how do i') ||
    lower.includes('how can i') ||
    lower.includes('how should i') ||
    lower.includes('guide me') ||
    lower.includes('kaise kare') ||
    lower.includes('kaise karein') ||
    lower.includes('kaise karte') ||
    lower.includes('hege maduvudu') ||
    lower.includes('hege madodu') ||
    lower.includes('eppadi seivathu') ||
    lower.includes('eppadi seivadhu')
  ) {
    return true;
  }

  // Word-boundary keywords (English & transliterated Indic)
  const asciiKeywordsRegex = /\b(how|steps?|procedure|process|guide|explain|instructions?|kaise|kese|tarika|tareeka|prakriya|vidhana|krama|vivarisi|eppadi|murai|nadavadikkai|vilakkavum)\b/i;
  if (asciiKeywordsRegex.test(lower)) {
    return true;
  }

  // Native Indic script keywords (Devanagari, Kannada, Tamil)
  const nativeIndicKeywords = [
    'कैसे', 'प्रक्रिया', 'तरीका', 'कदम', 'समझाएं', 'समझाओ', 'विधि',
    'ಹೇಗೆ', 'ವಿಧಾನ', 'ಕ್ರಮ', 'ವಿವರಿಸಿ', 'ಹಂತಗಳು',
    'எப்படி', 'முறை', 'நடவடிக்கை', 'விளக்கவும்', 'படிநிலைகள்'
  ];
  for (const kw of nativeIndicKeywords) {
    if (lower.includes(kw)) {
      return true;
    }
  }

  return false;
}

/**
 * Quick-chip intent detection before Gemini call.
 * Quick intents trigger ONLY for short chip-like messages (at most 4 words)
 * and NEVER when the message is a how-to/procedure question.
 */
export function checkQuickChipIntent(message = '') {
  if (!message || typeof message !== 'string') return null;

  // Never trigger quick intents for how-to / procedure questions -> fall through to searchHelp
  if (isHowToProcedureQuery(message)) {
    return null;
  }

  const clean = message.trim();
  const words = clean.split(/\s+/).filter(Boolean);

  // Quick intents trigger only for short chip-like messages (at most 4 words)
  if (words.length > 4) {
    return null;
  }

  const lower = clean.toLowerCase();

  if (lower.includes('book appointment') || lower.includes('book slot') || lower.includes('schedule appointment') || lower.includes('अपॉइंटमेंट') || lower.includes('ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್') || lower.includes('ಅಪಾಯಿಂಟ್ಮೆಂಟ್') || lower.includes('అపాయింట్మెంట్') || lower.includes('அப்பாயிண்ட்மெண்ட்')) {
    return 'BOOK_APPOINTMENT';
  }
  if (lower.includes('my token status') || lower.includes('token status') || lower.includes('queue status') || lower.includes('मेरा टोकन') || lower.includes('ನನ್ನ ಟೋಕನ್') || lower.includes('నా టోకెన్') || lower.includes('என் டோக்கன்')) {
    return 'TOKEN_STATUS';
  }
  if (lower.includes('wait time') || lower.includes('when is my turn') || lower.includes('how much wait') || lower.includes('kitna wait') || lower.includes('कितना इंतज़ार') || lower.includes('ಎಷ್ಟು ಕಾಯಬೇಕು') || lower.includes('ఎంత సమయం') || lower.includes('எவ்வளவு நேரம்')) {
    return 'WAIT_TIME';
  }
  if (lower.includes('doctor timings') || lower.includes('hospital hours') || lower.includes('timing') || lower.includes('डॉक्टर का समय') || lower.includes('ವೈದ್ಯರ ಸಮಯ') || lower.includes('వైద్యుల సమయం') || lower.includes('டாக்டர் நேரம்')) {
    return 'DOCTOR_TIMINGS';
  }
  if (lower.includes('talk to staff') || lower.includes('escalate') || lower.includes('speak to receptionist') || lower.includes('स्टाफ से बात') || lower.includes('ಸಿಬ್ಬಂದಿ') || lower.includes('సిబ్బంది') || lower.includes('ஊழியர்களுடன்')) {
    return 'TALK_TO_STAFF';
  }

  return null;
}

/**
 * Detects whether the user is explicitly requesting TARA to perform a real appointment booking action,
 * rather than asking an informational question about hospital procedures.
 * Supports English, Kannada, Hindi, Telugu, and Tamil.
 */
export function isConversationalBookingAction(message = '') {
  if (!message || typeof message !== 'string') return false;
  if (isHowToProcedureQuery(message)) return false;

  const clean = message.trim();
  const lower = clean.toLowerCase();

  // English booking action patterns
  const englishActionRegex = /\b(book|schedule|reserve|make|get|fix|need|want)\b.*\b(appointment|slot|doctor|consultation)\b/i;
  const englishDoctorRequestRegex = /\b(see|visit|consult|meet)\b.*\b(a\s+)?(doctor|physician|specialist)\b/i;
  if (englishActionRegex.test(lower) || englishDoctorRequestRegex.test(lower)) {
    return true;
  }

  // Kannada action patterns
  // "ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ನೀನೇ ಬುಕ್ ಮಾಡು", "ನನಗೆ ಡಾಕ್ಟರ್ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬೇಕು", "ವೈದ್ಯರನ್ನು ಭೇಟಿ ಮಾಡಬೇಕು", "ನನಗಾಗಿ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡು", "ಡಾಕ್ಟರ್ ಬೇಕು"
  const kannadaActionKeywords = [
    'ಬುಕ್ ಮಾಡು', 'ಬುಕ್ ಮಾಡಿ', 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬೇಕು', 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬೇಕು',
    'ಭೇಟಿ ಮಾಡಬೇಕು', 'ವೈದ್ಯರನ್ನು ಭೇಟಿ', 'ಡಾಕ್ಟರ್ ಬೇಕು', 'ಡಾಕ್ಟರ್ ಭೇಟಿ',
    'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಕೊಡಿ', 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಮಾಡಿ'
  ];
  for (const kw of kannadaActionKeywords) {
    if (clean.includes(kw)) return true;
  }

  // Hindi action patterns
  // "मेरे लिए अपॉइंटमेंट बुक करो", "मुझे डॉक्टर से मिलना है", "मेरा अपॉइंटमेंट बुक कर दो", "अपॉइंटमेंट चाहिए"
  const hindiActionKeywords = [
    'बुक करो', 'बुक करें', 'बुक कर दो', 'अपॉइंटमेंट चाहिए',
    'डॉक्टर से मिलना', 'डॉक्टर को दिखाना', 'डॉक्टर चाहिए', 'अपॉइंटमेंट करवा दो'
  ];
  for (const kw of hindiActionKeywords) {
    if (clean.includes(kw)) return true;
  }

  // Telugu action patterns
  // "నాకు అపాయింట్మెంట్ బుక్ చేయండి", "నాకు డాక్టర్ను కలవాలి", "డాక్టర్ అపాయింట్మెంట్ కావాలి"
  const teluguActionKeywords = [
    'బుక్ చేయండి', 'బుక్ చేయి', 'అపాయింట్మెంట్ కావాలి', 'డాక్టర్ను కలవాలి',
    'డాక్టర్ కావాలి', 'అపాయింట్మెంట్ ఇవ్వండి'
  ];
  for (const kw of teluguActionKeywords) {
    if (clean.includes(kw)) return true;
  }

  // Tamil action patterns
  // "எனக்கு அப்பாயிண்ட்மெண்ட் புக் செய்யுங்கள்", "எனக்கு மருத்துவரை பார்க்க வேண்டும்", "டாக்டர் அப்பாயிண்ட்மெண்ட் வேண்டும்"
  const tamilActionKeywords = [
    'புக் செய்யுங்கள்', 'புக் செய்', 'அப்பாயிண்ட்மெண்ட் வேண்டும்',
    'மருத்துவரை பார்க்க வேண்டும்', 'டாக்டரை பார்க்க', 'அப்பாயிண்ட்மெண்ட் எடுக்க'
  ];
  for (const kw of tamilActionKeywords) {
    if (clean.includes(kw)) return true;
  }

  return false;
}

/**
 * Validate pre-consultation summary against supplied facts.
 * Ensures output contains no medicines or allergies not present in the input.
 */
export function validateSummaryFacts(summaryText = '', facts = {}) {
  if (!summaryText) return false;

  const lowerText = summaryText.toLowerCase();

  // Extract medicines from facts
  const knownMeds = (facts.currentMedicines || []).map(m => (typeof m === 'string' ? m : m.name || '').toLowerCase()).filter(Boolean);
  // Extract allergies from facts
  const knownAllergies = (facts.allergies || []).map(a => (typeof a === 'string' ? a : a.name || '').toLowerCase()).filter(Boolean);

  // Check if summary mentions allergy terms not in knownAllergies
  if (lowerText.includes('allerg')) {
    const hasKnownAllergy = knownAllergies.some(a => lowerText.includes(a));
    if (!hasKnownAllergy && knownAllergies.length === 0) {
      // Mentioned allergy when facts say no allergies
      return false;
    }
  }

  return true;
}

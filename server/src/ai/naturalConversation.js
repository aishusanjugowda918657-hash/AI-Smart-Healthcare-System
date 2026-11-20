/**
 * naturalConversation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Natural Conversation & Conversational Intent Pre-Router for TARA (PRD F14 & Voice)
 *
 * Handles:
 * 1. Warm, natural greetings (Hi, Hello, Hey TARA, speech-to-text "hay Tarun", Good morning, etc.)
 * 2. Small talk & companion queries (How are you?, Who are you?)
 * 3. Politeness & gratitude (Thank you, Thanks, You're welcome)
 * 4. Conversational acknowledgments (Okay, Ok, Got it, Fine)
 * 5. General assistance requests (I need help, Can you help me?)
 * 6. Doctor search triggers (I need a doctor, Doctor beku, Doctor chahiye)
 *
 * Supports 5 languages: English (en), Kannada (kn), Hindi (hi), Telugu (te), Tamil (ta).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CONVERSATIONAL_REPLIES = {
  GREETING: {
    en: "Hello! I am TARA, your healthcare companion. How can I help you today?",
    kn: "ನಮಸ್ಕಾರ! ನಾನು ತಾರಾ, ನಿಮ್ಮ ಆರೋಗ್ಯದ ಗೆಳತಿ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
    hi: "नमस्ते! मैं तारा हूँ, आपकी स्वास्थ्य साथी। आज मैं आपकी क्या मदद कर सकती हूँ?",
    te: "నమస్కారం! నేను తారా, మీ ఆరోగ్య సహాయకురాలిని. ఈరోజు నేను మీకు ఎలా సహాయపడగలను?",
    ta: "வணக்கம்! நான் தாரா, உங்கள் சுகாதாரத் தோழி. இன்று நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?"
  },
  HOW_ARE_YOU: {
    en: "I'm doing well, thank you! I'm here and ready to help you with your healthcare needs. What would you like to do today?",
    kn: "ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ, ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಆರೋಗ್ಯದ ಕಾಳಜಿ ವಹಿಸಲು ನಾನು ಇಲ್ಲಿದ್ದೇನೆ. ಇಂದು ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?",
    hi: "मैं अच्छी हूँ, धन्यवाद! मैं आपकी स्वास्थ्य सेवा में मदद के लिए तैयार हूँ। आज आप क्या करना चाहेंगे?",
    te: "నేను బాగున్నాను, ధన్యవాదాలు! మీ ఆరోగ్య అవసరాలలో సహాయం చేయడానికి నేను సిద్ధంగా ఉన్నాను. ఈరోజు మీరు ఏమి చేయాలనుకుంటున్నారు?",
    ta: "நான் நலமாக உள்ளேன், நன்றி! உங்கள் சுகாதாரத் தேவைகளில் உதவ நான் தயாராக உள்ளேன். இன்று நீங்கள் என்ன செய்ய விரும்புகிறீர்கள்?"
  },
  WHO_ARE_YOU: {
    en: "I am TARA, your SmartCare AI healthcare voice companion. I can help you book appointments, check live queue tokens, view waiting times, and track your prescriptions.",
    kn: "ನಾನು ತಾರಾ, ನಿಮ್ಮ ಸ್ಮಾರ್ಟ್‌ಕೇರ್ ಧ್ವನಿ ಸಹಾಯಕ. ನಾನು ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್, ಲೈವ್ ಕ್ಯೂ ಟೋಕನ್, ಕಾಯುವ ಸಮಯ ಮತ್ತು ಔಷಧಿಗಳ ಪರಿಶೀಲನೆಗೆ ಸಹಾಯ ಮಾಡುತ್ತೇನೆ.",
    hi: "मैं तारा हूँ, आपकी स्मार्टकेयर एआई वॉइस साथी। मैं अपॉइंटमेंट बुक करने, लाइव टोकन देखने और दवाइयों की जानकारी में मदद कर सकती हूँ।",
    te: "నేను తారా, మీ స్మార్ట్‌కేర్ AI వాయిస్ సహాయకురాలిని. అపాయింట్‌మెంట్‌లు బుక్ చేయడానికి మరియు టోకెన్ స్థితిని చూడటానికి సహాయం చేస్తాను.",
    ta: "நான் தாரா, உங்கள் ஸ்மார்ட்கேர் AI குரல் தோழி. மருத்துவ முன்பதிவு மற்றும் வரிசை டோக்கன் நிலையை அறிய நான் உதவுகிறேன்."
  },
  GRATITUDE: {
    en: "You're very welcome! Please let me know if you need any other assistance.",
    kn: "ತುಂಬಾ ಧನ್ಯವಾದಗಳು! ನಿಮಗೆ ಇನ್ನಾವುದಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ದಯವಿಟ್ಟು ತಿಳಿಸಿ.",
    hi: "आपका बहुत-बहुत स्वागत है! यदि आपको किसी अन्य सहायता की आवश्यकता हो तो अवश्य बताएं।",
    te: "చాలా స్వాగతం! మీకు ఇతర సహాయం అవసరమైతే దయచేసి తెలియజేయండి.",
    ta: "மிக்க மகிழ்ச்சி! வேறு ஏதேனும் உதவி தேவைப்பட்டால் தயங்காமல் கேளுங்கள்."
  },
  OKAY: {
    en: "Understood! Let me know whenever you're ready or if you'd like to check appointments, tokens, or prescriptions.",
    kn: "ಸರಿ! ನೀವು ಸಿದ್ಧರಾದಾಗ ತಿಳಿಸಿ ಅಥವಾ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್, ಟೋಕನ್ ಅಥವಾ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಪರಿಶೀಲಿಸಲು ಹೇಳಿ.",
    hi: "समझ गई! जब भी आप तैयार हों, बताएं या अपॉइंटमेंट, टोकन या दवाइयों की जानकारी मांगें।",
    te: "అర్థమైంది! మీరు సిద్ధంగా ఉన్నప్పుడు చెప్పండి లేదా అపాయింట్‌మెంట్, టోకెన్ వివరాలు అడగండి.",
    ta: "புரிந்துகொண்டேன்! நீங்கள் தயாராக இருக்கும்போது சொல்லுங்கள் அல்லது முன்பதிவு விவரங்களைக் கேளுங்கள்."
  },
  NEED_HELP: {
    en: "I'm right here to help! You can say: 'Book an appointment', 'What is my token number?', 'When will the doctor see me?', or 'Show my latest prescription'.",
    kn: "ನಾನು ಇಲ್ಲೇ ಇದ್ದೇನೆ! ನೀವು ಹೇಳಬಹುದು: 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ', 'ನನ್ನ ಟೋಕನ್ ಸಂಖ್ಯೆ ಏನು?', ಅಥವಾ 'ನನ್ನ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ತೋರಿಸಿ'.",
    hi: "मैं आपकी मदद के लिए यहाँ हूँ! आप कह सकते हैं: 'अपॉइंटमेंट बुक करें', 'मेरा टोकन नंबर क्या है?', या 'मेरी दवाइयां दिखाएं'।",
    te: "నేను సహాయం చేయడానికి ఇక్కడే ఉన్నాను! మీరు 'అపాయింట్‌మెంట్ బుక్ చేయండి', 'నా టోకెన్ నంబర్ ఎంత?', లేదా 'నా మందుల వివరాలు' అని అడగవచ్చు.",
    ta: "உங்களுக்கு உதவ நான் இங்கே உள்ளேன்! 'மருத்துவ முன்பதிவு செய்', 'என் டோக்கன் எண் என்ன?', அல்லது 'மருந்து சீட்டை காட்டு' என்று கேட்கலாம்."
  },
  NEED_DOCTOR: {
    en: "I can help you find the right doctor. What symptoms or health concern are you experiencing, or which department would you like to visit?",
    kn: "ಸೂಕ್ತ ವೈದ್ಯರನ್ನು ಹುಡುಕಲು ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ನಿಮಗೆ ಯಾವ ರೋಗಲಕ್ಷಣಗಳಿವೆ ಅಥವಾ ಯಾವ ವಿಭಾಗಕ್ಕೆ ಭೇಟಿ ನೀಡಲು ಬಯಸುತ್ತೀರಿ?",
    hi: "मैं सही डॉक्टर ढूँढने में आपकी मदद कर सकती हूँ। आपको क्या लक्षण या तकलीफ़ है, या आप किस विभाग में दिखाना चाहते हैं?",
    te: "సరైన వైద్యుడిని కనుగొనడంలో నేను మీకు సహాయం చేస్తాను. మీకు ఏ విధమైన లక్షణాలు ఉన్నాయి?",
    ta: "சரியான மருத்துவரைத் தேர்ந்தெடுக்க நான் உதவுகிறேன். உங்களுக்கு என்ன உடல்நல பிரச்சனை அல்லது அறிகுறிகள் உள்ளன?"
  }
};

/**
 * Normalizes text for conversation classification.
 */
function clean(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[?!.,;:'"(){}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if the input message is a natural conversation phrase.
 * Returns null if not a conversational match, or an object:
 * {
 *   intent: 'GREETING' | 'HOW_ARE_YOU' | 'WHO_ARE_YOU' | 'GRATITUDE' | 'OKAY' | 'NEED_HELP' | 'NEED_DOCTOR',
 *   replyText: string,
 *   quickChips?: Array<{ label: string, text: string }>
 * }
 */
export function detectNaturalConversation(message = '', language = 'en') {
  if (!message || typeof message !== 'string') return null;

  const text = clean(message);
  if (!text) return null;

  const langKey = (language || 'en').split('-')[0].toLowerCase();
  const lang = CONVERSATIONAL_REPLIES.GREETING[langKey] ? langKey : 'en';

  // 1. GREETINGS
  // Matches "hi", "hello", "hey", "hey tara", "hay tarun" (STT transcription), "heyy", "hlo",
  // "good morning", "good afternoon", "good evening", "namaste", "namaskara", "vanakkam", "namaskaram"
  const greetingRegex = /^(hey|hay|hi|hii|hiii|hello|heyy|hlo|good\s+morning|good\s+afternoon|good\s+evening|namaste|namaskar|namaskara|namaskaram|vanakkam|vanakam)(\s+(tara|tarun|taru|taara|thara|there|friend|companion|doc|doctor))?$/i;
  const isGreetingPrefix = /^(hey|hay|hi|hello)\s+(tara|tarun|taara|thara)$/i;

  if (greetingRegex.test(text) || isGreetingPrefix.test(text) || text === 'tara' || text === 'tarun') {
    return {
      intent: 'GREETING',
      message: CONVERSATIONAL_REPLIES.GREETING[lang],
      aiSource: 'conversational_router',
      quickChips: [
        { label: 'Book Appointment', text: 'Book Appointment' },
        { label: 'My Token Status', text: 'My Token Status' },
        { label: 'Doctor Timings', text: 'Doctor Timings' },
        { label: 'My Prescriptions', text: 'Show my latest prescription' }
      ]
    };
  }

  // Kannada native script greetings
  if (['ನಮಸ್ಕಾರ', 'ನಮಸ್ಕಾರ ತಾರಾ', 'ನಮಸ್ತೆ', 'ಶುಭೋದಯ', 'ಹಲೋ', 'ಹಾಯ್'].some(k => text === k || text.startsWith(k))) {
    return {
      intent: 'GREETING',
      message: CONVERSATIONAL_REPLIES.GREETING.kn,
      aiSource: 'conversational_router',
      quickChips: [
        { label: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ', text: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಿ' },
        { label: 'ನನ್ನ ಟೋಕನ್ ಸ್ಥಿತಿ', text: 'ನನ್ನ ಟೋಕನ್ ಸ್ಥಿತಿ' },
        { label: 'ವೈದ್ಯರ ಸಮಯ', text: 'ವೈದ್ಯರ ಸಮಯ' }
      ]
    };
  }

  // Hindi native script greetings
  if (['नमस्ते', 'नमस्ते तारा', 'प्रणाम', 'सुप्रभात', 'हेलो', 'हाय'].some(k => text === k || text.startsWith(k))) {
    return {
      intent: 'GREETING',
      message: CONVERSATIONAL_REPLIES.GREETING.hi,
      aiSource: 'conversational_router',
      quickChips: [
        { label: 'अपॉइंटमेंट बुक करें', text: 'अपॉइंटमेंट बुक करें' },
        { label: 'मेरा टोकन स्टेटस', text: 'मेरा टोकन स्टेटस' },
        { label: 'डॉक्टर का समय', text: 'डॉक्टर का समय' }
      ]
    };
  }

  // Telugu native script greetings
  if (['నమస్కారం', 'నమస్కారం తారా', 'నమస్తే', 'శుభోదయం', 'హలో', 'హాయ్'].some(k => text === k || text.startsWith(k))) {
    return {
      intent: 'GREETING',
      message: CONVERSATIONAL_REPLIES.GREETING.te,
      aiSource: 'conversational_router'
    };
  }

  // Tamil native script greetings
  if (['வணக்கம்', 'வணக்கம் தாரா', 'காலை வணக்கம்', 'ஹலோ', 'ஹாய்'].some(k => text === k || text.startsWith(k))) {
    return {
      intent: 'GREETING',
      message: CONVERSATIONAL_REPLIES.GREETING.ta,
      aiSource: 'conversational_router'
    };
  }

  // 2. HOW ARE YOU?
  const howAreYouRegex = /^(how\s+are\s+you|how\s+r\s+u|how\s+are\s+you\s+doing|how\s+is\s+it\s+going|how\s+do\s+you\s+do|are\s+you\s+there|you\s+there)(\s+tara)?$/i;
  const indicHowAreYou = /^(hegiddeera|hegiddira|kaise\s+ho|kese\s+ho|aap\s+kaise\s+hain|ela\s+unnaru|eppadi\s+irukkinga)$/i;

  if (howAreYouRegex.test(text) || indicHowAreYou.test(text) || text.includes('ಹೇಗಿದ್ದೀರಾ') || text.includes('कैसी हो') || text.includes('कैसे हैं') || text.includes('ఎలా ఉన్నారు') || text.includes('எப்படி இருக்கிறீர்கள்')) {
    return {
      intent: 'HOW_ARE_YOU',
      message: CONVERSATIONAL_REPLIES.HOW_ARE_YOU[lang],
      aiSource: 'conversational_router'
    };
  }

  // 3. WHO ARE YOU?
  const whoAreYouRegex = /^(who\s+are\s+you|what\s+is\s+your\s+name|what\s+can\s+you\s+do|introduce\s+yourself|tell\s+me\s+about\s+yourself)(\s+tara)?$/i;
  if (whoAreYouRegex.test(text) || text.includes('ನೀವು ಯಾರು') || text.includes('आप कौन हैं') || text.includes('మీరు ఎవరు') || text.includes('நீங்கள் யார்')) {
    return {
      intent: 'WHO_ARE_YOU',
      message: CONVERSATIONAL_REPLIES.WHO_ARE_YOU[lang],
      aiSource: 'conversational_router'
    };
  }

  // 4. GRATITUDE (Thank you, Thanks)
  const gratitudeRegex = /^(thank\s+you|thanks|thank\s+you\s+so\s+much|thanks\s+a\s+lot|tysm|dhanyavad|dhanyavada|shukriya|nandri|dhanyavadamulu)(\s+tara)?$/i;
  if (gratitudeRegex.test(text) || text.includes('ಧನ್ಯವಾದಗಳು') || text.includes('धन्यवाद') || text.includes('शुक्रिया') || text.includes('ధన్యవాదాలు') || text.includes('நன்றி')) {
    return {
      intent: 'GRATITUDE',
      message: CONVERSATIONAL_REPLIES.GRATITUDE[lang],
      aiSource: 'conversational_router'
    };
  }

  // 5. OKAY / ACKNOWLEDGMENT (Okay, Ok, Sure, Got it, Fine)
  const okayRegex = /^(ok|okay|k|sure|fine|got\s+it|alright|all\s+right|no\s+problem|sari|theek\s+hai)(\s+tara)?$/i;
  if (okayRegex.test(text) || text === 'ಸರಿ' || text === 'ठीक है' || text === 'సరే' || text === 'சரி') {
    return {
      intent: 'OKAY',
      message: CONVERSATIONAL_REPLIES.OKAY[lang],
      aiSource: 'conversational_router'
    };
  }

  // 6. GENERAL NEED HELP (I need help, Help me, Can you help me)
  const needHelpRegex = /^(i\s+need\s+help|help\s+me|can\s+you\s+help\s+me|help|please\s+help|sahaya\s+beku|madad\s+chahiye|sahayam\s+kavali|udavi\s+vendum)(\s+tara)?$/i;
  if (needHelpRegex.test(text) || text.includes('ಸಹಾಯ ಬೇಕು') || text.includes('मदद चाहिए') || text.includes('సహాయం కావాలి') || text.includes('உதவி வேண்டும்')) {
    return {
      intent: 'NEED_HELP',
      message: CONVERSATIONAL_REPLIES.NEED_HELP[lang],
      aiSource: 'conversational_router',
      quickChips: [
        { label: 'Book Appointment', text: 'Book Appointment' },
        { label: 'My Token Status', text: 'My Token Status' },
        { label: 'Wait Time', text: 'When is my turn?' },
        { label: 'Talk to Staff', text: 'Talk to Staff' }
      ]
    };
  }

  // 7. NEED DOCTOR (I need a doctor, Find a doctor, Doctor beku, Doctor chahiye)
  // This helps guide the patient into the clinical doctor search flow
  const needDoctorRegex = /^(i\s+need\s+a\s+doctor|i\s+want\s+a\s+doctor|find\s+a\s+doctor|find\s+me\s+a\s+doctor|doctor\s+beku|doctor\s+chahiye|doctor\s+kavali|doctor\s+vendum)(\s+tara)?$/i;
  if (needDoctorRegex.test(text) || text.includes('ಡಾಕ್ಟರ್ ಬೇಕು') || text.includes('ವೈದ್ಯರು ಬೇಕು') || text.includes('डॉक्टर चाहिए') || text.includes('వైద్యుడు కావాలి') || text.includes('மருத்துவர் வேண்டும்')) {
    return {
      intent: 'NEED_DOCTOR',
      message: CONVERSATIONAL_REPLIES.NEED_DOCTOR[lang],
      aiSource: 'conversational_router',
      quickChips: [
        { label: 'General Medicine', text: 'I want General Medicine doctor' },
        { label: 'Cardiology', text: 'I want Cardiology doctor' },
        { label: 'Pediatrics', text: 'I want Pediatrics doctor' },
        { label: 'Orthopedics', text: 'I want Orthopedics doctor' }
      ]
    };
  }

  return null;
}

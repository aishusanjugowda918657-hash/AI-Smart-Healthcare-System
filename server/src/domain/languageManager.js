/**
 * Central Conversation Language Manager
 * Enforces strict persistent language state, language locking,
 * mixed-language handling (e.g. English medical terms in Telugu),
 * and response language validation across:
 * - English: en-IN
 * - Kannada: kn-IN
 * - Hindi: hi-IN
 * - Telugu: te-IN
 * - Tamil: ta-IN
 */

export const SUPPORTED_LANGUAGES = ['en-IN', 'kn-IN', 'hi-IN', 'te-IN', 'ta-IN'];
export const DEFAULT_LANGUAGE = 'en-IN';

// Unicode Script Ranges
const SCRIPT_RANGES = {
  telugu: /[\u0C00-\u0C7F]/g,
  kannada: /[\u0C80-\u0CFF]/g,
  devanagari: /[\u0900-\u097F]/g,
  tamil: /[\u0B80-\u0BFF]/g,
  latin: /[a-zA-Z]/g
};

/**
 * Count script characters in a message
 */
export function detectScriptCounts(text = '') {
  if (!text || typeof text !== 'string') {
    return { telugu: 0, kannada: 0, devanagari: 0, tamil: 0, latin: 0, total: 0 };
  }

  const telugu = (text.match(SCRIPT_RANGES.telugu) || []).length;
  const kannada = (text.match(SCRIPT_RANGES.kannada) || []).length;
  const devanagari = (text.match(SCRIPT_RANGES.devanagari) || []).length;
  const tamil = (text.match(SCRIPT_RANGES.tamil) || []).length;
  const latin = (text.match(SCRIPT_RANGES.latin) || []).length;
  const total = telugu + kannada + devanagari + tamil + latin;

  return { telugu, kannada, devanagari, tamil, latin, total };
}

/**
 * Detect if message contains explicit command to switch language
 */
export function detectExplicitLanguageSwitch(text = '') {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();

  // Switch to English
  if (
    /(\b(speak|talk|switch|change|reply|respond)\s+(in|to)?\s*english\b|in\s+english\b|english\s*please\b)/i.test(lower) ||
    /ఇంగ్లీష్\s*(లో)?|ಇಂಗ್ಲಿಷ್\s*(ನಲ್ಲಿ)?|अंग्रेजी\s*(में)?|ஆங்கிலத்தில்/i.test(lower)
  ) {
    return 'en-IN';
  }

  // Switch to Telugu
  if (
    /(\b(speak|talk|switch|change|reply|respond)\s+(in|to)?\s*telugu\b|in\s+telugu\b|telugu\s*please\b)/i.test(lower) ||
    /తెలుగు\s*(లో)?\s*(మాట్లాడండి|చెప్పండి)?/i.test(lower)
  ) {
    return 'te-IN';
  }

  // Switch to Kannada
  if (
    /(\b(speak|talk|switch|change|reply|respond)\s+(in|to)?\s*kannada\b|in\s+kannada\b|kannada\s*please\b)/i.test(lower) ||
    /ಕನ್ನಡ\s*(ದಲ್ಲಿ)?\s*(ಮಾತನಾಡಿ|ಹೇಳಿ)?/i.test(lower)
  ) {
    return 'kn-IN';
  }

  // Switch to Hindi
  if (
    /(\b(speak|talk|switch|change|reply|respond)\s+(in|to)?\s*hindi\b|in\s+hindi\b|hindi\s*please\b)/i.test(lower) ||
    /हिन्दी\s*(में)?\s*(बोलिए|बात\s*करो)?|हिंदी\s*(में)?/i.test(lower)
  ) {
    return 'hi-IN';
  }

  // Switch to Tamil
  if (
    /(\b(speak|talk|switch|change|reply|respond)\s+(in|to)?\s*tamil\b|in\s+tamil\b|tamil\s*please\b)/i.test(lower) ||
    /தமிழ்\s*(இல்)?\s*(பேசுங்கள்)?/i.test(lower)
  ) {
    return 'ta-IN';
  }

  return null;
}

/**
 * Check whether a message contains predominantly loanwords / medical terms in English
 */
const COMMON_HEALTHCARE_LOANWORDS = new Set([
  'doctor', 'doctors', 'dr', 'appointment', 'appointments', 'slot', 'slots', 'token', 'tokens',
  'fever', 'cough', 'cold', 'pain', 'headache', 'hospital', 'medicine', 'medicines', 'tablet', 'tablets',
  'syrup', 'prescription', 'prescriptions', 'queue', 'waiting', 'cancel', 'cancelling', 'cancellation',
  'confirm', 'confirmation', 'checkin', 'check-in', 'time', 'date', 'today', 'tomorrow', 'morning', 'evening',
  'general', 'cardiology', 'dermatology', 'orthopedics', 'pediatrics', 'ophthalmology',
  'ent', 'gynecology', 'room', 'opd', 'yes', 'no', 'ok', 'okay', 'thank', 'thanks', 'please',
  'consultation', 'visit', 'review', 'problem', 'symptom', 'symptoms', 'check', 'emergency',
  'schedule', 'reminders', 'status', 'available'
]);

export function isEnglishMedicalLoanwordQuery(text = '') {
  if (!text || typeof text !== 'string') return false;
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const loanCount = words.filter(w => COMMON_HEALTHCARE_LOANWORDS.has(w) || /^\d+$/.test(w) || /^\d+:\d+$/.test(w) || /^(am|pm)$/i.test(w)).length;
  return (loanCount / words.length) >= 0.4 || loanCount >= 2;
}

/**
 * Resolve and maintain persistent conversation language across turns
 */
export function resolveConversationLanguage({
  message = '',
  currentLanguage = DEFAULT_LANGUAGE,
  sttLanguage = null,
  sttConfidence = null,
  isManualSelection = false
}) {
  // 1. Manual user override from UI dropdown is authoritative
  if (isManualSelection && currentLanguage && SUPPORTED_LANGUAGES.includes(currentLanguage)) {
    return {
      language: currentLanguage,
      isLocked: true,
      reason: 'manual_selection'
    };
  }

  // 2. Explicit patient verbal request to change language takes precedence
  const explicitSwitch = detectExplicitLanguageSwitch(message);
  if (explicitSwitch) {
    return {
      language: explicitSwitch,
      isLocked: true,
      reason: 'explicit_switch_request'
    };
  }

  const scripts = detectScriptCounts(message);
  const isCurrentlyIndic = currentLanguage && currentLanguage !== 'en-IN';

  // 3. If currently locked into an Indic language (e.g. te-IN):
  if (isCurrentlyIndic) {
    // If message contains the current script -> reinforce lock
    if (currentLanguage === 'te-IN' && scripts.telugu > 0) {
      return { language: 'te-IN', isLocked: true, reason: 'confirmed_telugu_script' };
    }
    if (currentLanguage === 'kn-IN' && scripts.kannada > 0) {
      return { language: 'kn-IN', isLocked: true, reason: 'confirmed_kannada_script' };
    }
    if (currentLanguage === 'hi-IN' && scripts.devanagari > 0) {
      return { language: 'hi-IN', isLocked: true, reason: 'confirmed_hindi_script' };
    }
    if (currentLanguage === 'ta-IN' && scripts.tamil > 0) {
      return { language: 'ta-IN', isLocked: true, reason: 'confirmed_tamil_script' };
    }

    // If message is in Latin / English characters:
    // Check if it's medical loanwords ("fever today slot available", "book appointment", "cancel")
    // or short confirmation ("yes", "confirm", "9:00").
    // DO NOT break the Indic language lock!
    if (scripts.latin > 0 || isEnglishMedicalLoanwordQuery(message)) {
      return {
        language: currentLanguage,
        isLocked: true,
        reason: 'preserved_indic_against_english_loanwords'
      };
    }

    // Ignore low-confidence STT detection (< 0.85) from overriding established Indic language
    if (sttLanguage && sttLanguage !== currentLanguage) {
      if (typeof sttConfidence === 'number' && sttConfidence < 0.85) {
        return {
          language: currentLanguage,
          isLocked: true,
          reason: 'ignored_low_confidence_stt_switch'
        };
      }
    }

    // Default for active Indic conversation: preserve lock
    return {
      language: currentLanguage,
      isLocked: true,
      reason: 'active_indic_session_locked'
    };
  }

  // 4. If current language is English (or initial turn):
  // Check if message is in an Indic script -> immediately establish and lock to that Indic language!
  if (scripts.telugu >= 2) {
    return { language: 'te-IN', isLocked: true, reason: 'initial_telugu_script_detected' };
  }
  if (scripts.kannada >= 2) {
    return { language: 'kn-IN', isLocked: true, reason: 'initial_kannada_script_detected' };
  }
  if (scripts.devanagari >= 2) {
    return { language: 'hi-IN', isLocked: true, reason: 'initial_hindi_script_detected' };
  }
  if (scripts.tamil >= 2) {
    return { language: 'ta-IN', isLocked: true, reason: 'initial_tamil_script_detected' };
  }

  // Check high-confidence STT language if provided on initial turn
  if (sttLanguage && SUPPORTED_LANGUAGES.includes(sttLanguage) && sttLanguage !== 'en-IN') {
    if (typeof sttConfidence !== 'number' || sttConfidence >= 0.85) {
      return { language: sttLanguage, isLocked: true, reason: 'high_confidence_stt_detection' };
    }
  }

  return {
    language: currentLanguage || DEFAULT_LANGUAGE,
    isLocked: false,
    reason: 'default_language'
  };
}

/**
 * Validate that response matches the target conversation language.
 * Prevents accidental cross-language corruption (e.g. Kannada during Telugu conversation).
 */
export function validateAndEnforceResponseLanguage(responseText, targetLanguageCode) {
  if (!responseText || typeof responseText !== 'string') return responseText;

  const scripts = detectScriptCounts(responseText);
  const norm = targetLanguageCode || DEFAULT_LANGUAGE;

  // Case 1: Target is Telugu (te-IN)
  if (norm === 'te-IN') {
    // If response contains Kannada characters, it is corrupted!
    if (scripts.kannada > 0 || scripts.devanagari > 0) {
      // Strip out illegal Kannada or Devanagari characters
      let cleaned = responseText
        .replace(SCRIPT_RANGES.kannada, '')
        .replace(SCRIPT_RANGES.devanagari, '')
        .replace(/\s+/g, ' ')
        .trim();

      const newScripts = detectScriptCounts(cleaned);
      if (newScripts.telugu >= 5) {
        return cleaned;
      }
      // If stripped text lost meaningful Telugu content, return safe Telugu fallback
      return 'ఖచ్చితంగా, మీ అభ్యర్థనను స్వీకరించాము. మీకు ఎలా సహాయపడమంటారు?';
    }
    return responseText;
  }

  // Case 2: Target is Kannada (kn-IN)
  if (norm === 'kn-IN') {
    if (scripts.telugu > 0 || scripts.devanagari > 0) {
      let cleaned = responseText
        .replace(SCRIPT_RANGES.telugu, '')
        .replace(SCRIPT_RANGES.devanagari, '')
        .replace(/\s+/g, ' ')
        .trim();

      const newScripts = detectScriptCounts(cleaned);
      if (newScripts.kannada >= 5) {
        return cleaned;
      }
      return 'ಖಂಡಿತ, ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಸ್ವೀಕರಿಸಲಾಗಿದೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?';
    }
    return responseText;
  }

  // Case 3: Target is Hindi (hi-IN)
  if (norm === 'hi-IN') {
    if (scripts.telugu > 0 || scripts.kannada > 0) {
      let cleaned = responseText
        .replace(SCRIPT_RANGES.telugu, '')
        .replace(SCRIPT_RANGES.kannada, '')
        .replace(/\s+/g, ' ')
        .trim();

      const newScripts = detectScriptCounts(cleaned);
      if (newScripts.devanagari >= 5) {
        return cleaned;
      }
      return 'ज़रूर, आपका अनुरोध प्राप्त हो गया है। मैं आपकी किस प्रकार सहायता कर सकता हूँ?';
    }
    return responseText;
  }

  // Case 4: Target is Tamil (ta-IN)
  if (norm === 'ta-IN') {
    if (scripts.telugu > 0 || scripts.kannada > 0 || scripts.devanagari > 0) {
      let cleaned = responseText
        .replace(SCRIPT_RANGES.telugu, '')
        .replace(SCRIPT_RANGES.kannada, '')
        .replace(SCRIPT_RANGES.devanagari, '')
        .replace(/\s+/g, ' ')
        .trim();

      const newScripts = detectScriptCounts(cleaned);
      if (newScripts.tamil >= 5) {
        return cleaned;
      }
      return 'நிச்சயமாக, உங்கள் கோரிக்கை பெறப்பட்டது. நான் உங்களுக்கு எவ்வாறு உதவ முடியும்?';
    }
    return responseText;
  }

  return responseText;
}

/**
 * Clean and format doctor name safely to prevent duplicated 'Dr. Dr.' prefixes
 */
export function formatDoctorDisplayName(rawName = '') {
  if (!rawName) return 'Dr. Doctor';
  const clean = String(rawName).trim().replace(/^(?:Dr\.?\s*)+/i, '');
  return `Dr. ${clean}`;
}

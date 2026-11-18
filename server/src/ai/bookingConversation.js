/**
 * Conversational Appointment Booking Engine for TARA
 * Follows exact existing booking workflow, clinical triage checks,
 * doctor resolution, real slot retrieval, disclaimer acknowledgement,
 * and atomic appointment persistence.
 */
import { assertDbConnected } from '../config/firebase.js';
import { evaluateTriageRules } from '../domain/triage.js';
import { getSlots } from '../controllers/slotController.js';
import { storeConfirmToken } from './tools.js';
import { createAppointment } from '../controllers/bookingController.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';
import dayjs from 'dayjs';

/**
 * Multi-language copy for conversational booking steps
 */
const I18N = {
  en: {
    greetingPrompt: "Certainly! 😊 I can help you book an appointment for myself or a family member. What symptoms or health concerns are you experiencing today?",
    commonSymptoms: [
      { label: 'General Checkup', value: 'General Checkup' },
      { label: 'Fever & Cold', value: 'Fever & Cold' },
      { label: 'Headache', value: 'Headache' },
      { label: 'Stomach Pain', value: 'Stomach Pain' },
      { label: 'Cough', value: 'Cough' }
    ],
    doctorPrompt: (reason) => `Based on your symptoms ("${reason}"), here are the available specialists. Please select a doctor:`,
    noDoctors: "Currently, no doctors are available for this specialty. Please try another department or visit hospital reception.",
    slotPrompt: (doctor, date) => `Dr. ${doctor} has the following available slots on ${date}. Please select your preferred time:`,
    noSlots: (doctor) => `Dr. ${doctor} has no available slots in the next few days. Would you like to select another doctor?`,
    summaryHeader: "📋 **Appointment Summary:**",
    doctorLabel: "Doctor",
    dateTimeLabel: "Date & Time",
    reasonLabel: "Reason",
    disclaimerText: "⚠️ **Important Disclaimer:** Appointment times are indicative. Dynamic hospital waiting times may vary based on ongoing emergency cases. Please acknowledge this disclaimer and confirm to book.",
    confirmChips: [
      { label: 'Confirm & Book', value: 'CONFIRM' },
      { label: 'Cancel', value: 'CANCEL' }
    ],
    cancelled: "Appointment booking cancelled. How else can I assist you today?",
    success: (doctor, date, time, token) => `✅ Your appointment with ${doctor} is confirmed for ${date} at ${time}. Your queue token is ${token}.`,
    error: "Sorry, your appointment could not be booked right now. Please try again or visit reception.",
    emergencyAlert: "🚨 **EMERGENCY WARNING:** Your symptoms may require urgent medical attention. Please visit the nearest Emergency Room or call **108** immediately."
  },
  kn: {
    greetingPrompt: "ಖಂಡಿತಾ, ನಾನು ನಿಮಗೆ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಸಹಾಯ ಮಾಡುತ್ತೇನೆ! 😊 ಇಂದು ನಿಮಗೆ ಯಾವ ರೀತಿಯ ಆರೋಗ್ಯ ಸಮಸ್ಯೆ ಅಥವಾ ಲಕ್ಷಣಗಳಿವೆ?",
    commonSymptoms: [
      { label: 'ಸಾಮಾನ್ಯ ತಪಾಸಣೆ', value: 'ಸಾಮಾನ್ಯ ತಪಾಸಣೆ' },
      { label: 'ಜ್ವರ ಮತ್ತು ಶೀತ', value: 'ಜ್ವರ ಮತ್ತು ಶೀತ' },
      { label: 'ತಲೆನೋವು', value: 'ತಲೆನೋವು' },
      { label: 'ಹೊಟ್ಟೆ ನೋವು', value: 'ಹೊಟ್ಟೆ ನೋವು' },
      { label: 'ಕೆಮ್ಮು', value: 'ಕೆಮ್ಮು' }
    ],
    doctorPrompt: (reason) => `ನಿಮ್ಮ ಲಕ್ಷಣಗಳ ("${reason}") ಆಧಾರದ ಮೇಲೆ ಲಭ್ಯವಿರುವ ತಜ್ಞ ವೈದ್ಯರು ಇಲ್ಲಿವೆ. ದಯವಿಟ್ಟು ಒಬ್ಬ ವೈದ್ಯರನ್ನು ಆಯ್ಕೆಮಾಡಿ:`,
    noDoctors: "ಪ್ರಸ್ತುತ ಈ ವಿಭಾಗದಲ್ಲಿ ವೈದ್ಯರು ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಆಸ್ಪತ್ರೆಯ ರಿಸೆಪ್ಷನ್ ಸಂಪರ್ಕಿಸಿ.",
    slotPrompt: (doctor, date) => `ಡಾ. ${doctor} ಅವರೊಂದಿಗೆ ${date} ರಂದು ಈ ಕೆಳಗಿನ ಸಮಯ ಸ್ಲಾಟ್‌ಗಳು ಲಭ್ಯವಿವೆ. ನಿಮ್ಮ ಸಮಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ:`,
    noSlots: (doctor) => `ಡಾ. ${doctor} ಅವರೊಂದಿಗೆ ಮುಂದಿನ ದಿನಗಳಲ್ಲಿ ಯಾವುದೇ ಸ್ಲಾಟ್‌ಗಳು ಲಭ್ಯವಿಲ್ಲ. ಬೇರೆ ವೈದ್ಯರನ್ನು ಆಯ್ಕೆಮಾಡಲು ಬಯಸುವಿರಾ?`,
    summaryHeader: "📋 **ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ವಿವರ:**",
    doctorLabel: "ವೈದ್ಯರು",
    dateTimeLabel: "ದಿನಾಂಕ & ಸಮಯ",
    reasonLabel: "ಕಾರಣ",
    disclaimerText: "⚠️ **ಮುಖ್ಯ ಸೂಚನೆ:** ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಮಯವು ಅಂದಾಜು ಆಗಿರುತ್ತದೆ. ತುರ್ತು ಚಿಕಿತ್ಸೆಗಳ ಆಧಾರದ ಮೇಲೆ ಕಾಯುವ ಸಮಯ ಬದಲಾಗಬಹುದು. ಈ ಸೂಚನೆಯನ್ನು ಒಪ್ಪಿ ಮುಂದುವರಿಯಲು ದೃಢೀಕರಿಸಿ.",
    confirmChips: [
      { label: 'ದೃಢೀಕರಿಸಿ & ಬುಕ್ ಮಾಡಿ', value: 'CONFIRM' },
      { label: 'ರದ್ದುಮಾಡಿ', value: 'CANCEL' }
    ],
    cancelled: "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕಿಂಗ್ ರದ್ದುಗೊಂಡಿದೆ. ನಾನು ನಿಮಗೆ ಇನ್ನೇನು ಸಹಾಯ ಮಾಡಲಿ?",
    success: (doctor, date, time, token) => `✅ ${doctor} ಅವರೊಂದಿಗೆ ${date} ರಂದು ${time} ಗಂಟೆಗೆ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಆಗಿದೆ. ನಿಮ್ಮ ಟೋಕನ್ ಸಂಖ್ಯೆ ${token}.`,
    error: "ಕ್ಷಮಿಸಿ, ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ ಅಥವಾ ರಿಸೆಪ್ಷನ್ ಸಂಪರ್ಕಿಸಿ.",
    emergencyAlert: "🚨 **ತುರ್ತು ಎಚ್ಚರಿಕೆ:** ನಿಮ್ಮ ಲಕ್ಷಣಗಳಿಗೆ ತಕ್ಷಣದ ತುರ್ತು ಚಿಕಿತ್ಸೆ ಅಗತ್ಯವಿರಬಹುದು. ದಯವಿಟ್ಟು ಹತ್ತಿರದ ತುರ್ತು ಚಿಕಿತ್ಸಾ ವಿಭಾಗಕ್ಕೆ ತೆರಳಿ ಅಥವಾ ತಕ್ಷಣವೇ **108** ಗೆ ಕರೆ ಮಾಡಿ."
  },
  hi: {
    greetingPrompt: "जरूर! मैं आपके लिए अपॉइंटमेंट बुक करने में मदद करूँगी। 😊 आज आपको क्या स्वास्थ्य समस्या या लक्षण महसूस हो रहे हैं?",
    commonSymptoms: [
      { label: 'सामान्य जांच', value: 'सामान्य जांच' },
      { label: 'बुखार और सर्दी', value: 'बुखार और सर्दी' },
      { label: 'सिरदर्द', value: 'सिरदर्द' },
      { label: 'पेट दर्द', value: 'पेट दर्द' },
      { label: 'खांसी', value: 'खांसी' }
    ],
    doctorPrompt: (reason) => `आपके लक्षणों ("${reason}") के आधार पर उपलब्ध विशेषज्ञ डॉक्टर यहाँ हैं। कृपया एक डॉक्टर चुनें:`,
    noDoctors: "वर्तमान में इस विभाग के डॉक्टर उपलब्ध नहीं हैं। कृपया अस्पताल रिसेप्शन से संपर्क करें।",
    slotPrompt: (doctor, date) => `डॉ. ${doctor} के लिए ${date} को निम्नलिखित स्लॉट उपलब्ध हैं। कृपया अपना समय चुनें:`,
    noSlots: (doctor) => `डॉ. ${doctor} के लिए आगामी दिनों में स्लॉट उपलब्ध नहीं हैं। क्या आप किसी अन्य डॉक्टर को चुनना चाहते हैं?`,
    summaryHeader: "📋 **अपॉइंटमेंट विवरण:**",
    doctorLabel: "डॉक्टर",
    dateTimeLabel: "दिनांक और समय",
    reasonLabel: "कारण",
    disclaimerText: "⚠️ **महत्वपूर्ण अस्वीकरण:** अपॉइंटमेंट का समय अनुमानित है। आपातकालीन स्थितियों के आधार पर प्रतीक्षा समय बदल सकता है। कृपया इस अस्वीकरण को स्वीकार करें और पुष्टि करें।",
    confirmChips: [
      { label: 'पुष्टि करें और बुक करें', value: 'CONFIRM' },
      { label: 'रद्द करें', value: 'CANCEL' }
    ],
    cancelled: "अपॉइंटमेंट बुकिंग रद्द कर दी गई है। मैं आपकी और क्या मदद कर सकती हूँ?",
    success: (doctor, date, time, token) => `✅ ${doctor} के साथ आपकी अपॉइंटमेंट ${date} को ${time} बजे बुक हो गई है। आपका टोकन नंबर ${token} है।`,
    error: "क्षमा करें, अपॉइंटमेंट बुक नहीं हो सकी। कृपया पुनः प्रयास करें या रिसेप्शन से संपर्क करें।",
    emergencyAlert: "🚨 **आपातकालीन चेतावनी:** आपके लक्षणों को तत्काल चिकित्सा की आवश्यकता हो सकती है। कृपया निकटतम आपातकालीन कक्ष में जाएँ या तुरंत **108** पर कॉल करें।"
  },
  te: {
    greetingPrompt: "తప్పకుండా! నేను మీకు అపాయింట్‌మెంట్ బుక్ చేయడానికి సహాయం చేస్తాను. 😊 ఈరోజు మీకు ఉన్న ఆరోగ్య సమస్య లేదా లక్షణాలు ఏమిటి?",
    commonSymptoms: [
      { label: 'సాధారణ తనిఖీ', value: 'సాధారణ తనిఖీ' },
      { label: 'జ్వరం మరియు జలుబు', value: 'జ్వరం మరియు జలుబు' },
      { label: 'తలనొప్పి', value: 'తలనొప్పి' },
      { label: 'కడుపు నొప్పి', value: 'కడుపు నొప్పి' },
      { label: 'దగ్గు', value: 'దగ్గు' }
    ],
    doctorPrompt: (reason) => `మీ లక్షణాలు ("${reason}") ఆధారంగా అందుబాటులో ఉన్న నిపుణులైన డాక్టర్లు ఇక్కడ ఉన్నారు. దయచేసి ఒక డాక్టర్‌ను ఎంచుకోండి:`,
    noDoctors: "ప్రస్తుతం ఈ విభాగానికి డాక్టర్లు అందుబాటులో లేరు. దయచేసి రిసెప్షన్‌ను సంప్రదించండి.",
    slotPrompt: (doctor, date) => `డా. ${doctor} గారికి ${date} న కింది స్లాట్లు అందుబాటులో ఉన్నాయి. దయచేసి సమయాన్ని ఎంచుకోండి:`,
    noSlots: (doctor) => `డా. ${doctor} గారికి రాబోయే రోజుల్లో స్లాట్లు లేవు. మీరు వేరే డాక్టర్‌ను ఎంచుకోవాలనుకుంటున్నారా?`,
    summaryHeader: "📋 **అపాయింట్‌మెంట్ వివరాలు:**",
    doctorLabel: "డాక్టర్",
    dateTimeLabel: "తేదీ & సమయం",
    reasonLabel: "కారణం",
    disclaimerText: "⚠️ **ముఖ్య గమనిక:** అపాయింట్‌మెంట్ సమయం సుమారుగా ఉంటుంది. అత్యవసర కేసుల ఆధారంగా వేచి ఉండే సమయం మారవచ్చు. దయచేసి దీన్ని అంగీకరించి నిర్ధారించండి.",
    confirmChips: [
      { label: 'నిర్ధారించి బుక్ చేయండి', value: 'CONFIRM' },
      { label: 'రద్దు చేయండి', value: 'CANCEL' }
    ],
    cancelled: "అపాయింట్‌మెంట్ బుకింగ్ రద్దు చేయబడింది. నేను మీకు ఇంకేమైనా సహాయం చేయగలనా?",
    success: (doctor, date, time, token) => `✅ ${doctor} తో మీ అపాయింట్‌మెంట్ ${date} న ${time} గంటలకు బుక్ అయింది. మీ టోకెన్ నంబర్ ${token}.`,
    error: "క్షమించండి, అపాయింట్‌మెంట్ బుక్ కాలేదు. దయచేసి మళ్లీ ప్రయత్నించండి లేదా రిసెప్షన్‌ను సంప్రదించండి.",
    emergencyAlert: "🚨 **అత్యవసర హెచ్చరిక:** మీ లక్షణాలకు అత్యవసర వైద్య సంరక్షణ అవసరం కావచ్చు. దయచేసి వెంటనే అత్యవసర విభాగానికి వెళ్లండి లేదా **108** కి కాల్ చేయండి."
  },
  ta: {
    greetingPrompt: "நிச்சயமாக! நான் உங்களுக்கு அப்பாயிண்ட்மெண்ட் புக் செய்ய உதவுகிறேன். 😊 இன்று உங்களுக்கு என்ன உடல்நலக் குறைவு அல்லது அறிகுறிகள் உள்ளன?",
    commonSymptoms: [
      { label: 'பொது பரிசோதனை', value: 'பொது பரிசோதனை' },
      { label: 'காய்ச்சல் மற்றும் சளி', value: 'காய்ச்சல் மற்றும் சளி' },
      { label: 'தலைவலி', value: 'தலைவலி' },
      { label: 'வயிற்று வலி', value: 'வயிற்று வலி' },
      { label: 'இருமல்', value: 'இருமல்' }
    ],
    doctorPrompt: (reason) => `உங்கள் அறிகுறிகளின் ("${reason}") அடிப்படையில் கிடைக்கும் சிறப்பு மருத்துவர்கள் இதோ. தயவுசெய்து ஒரு மருத்துவரைத் தேர்ந்தெடுக்கவும்:`,
    noDoctors: "தற்போது இந்த பிரிவில் மருத்துவர்கள் கிடைக்கவில்லை. தயவுசெய்து வரவேற்பறைக்குச் செல்லவும்.",
    slotPrompt: (doctor, date) => `டாக்டர் ${doctor} அவர்களுக்கு ${date} அன்று பின்வரும் நேர ஸ்லாட்டுகள் கிடைக்கின்றன. உங்கள் நேரத்தைத் தேர்ந்தெடுக்கவும்:`,
    noSlots: (doctor) => `டாக்டர் ${doctor} அவர்களுக்கு அடுத்த சில நாட்களில் நேர ஸ்லாட்டுகள் இல்லை. வேறு மருத்துவரைத் தேர்ந்தெடுக்க விரும்புகிறீர்களா?`,
    summaryHeader: "📋 **சந்திப்பு விவரம்:**",
    doctorLabel: "மருத்துவர்",
    dateTimeLabel: "தேதி & நேரம்",
    reasonLabel: "காரணம்",
    disclaimerText: "⚠️ **முக்கிய அறிவிப்பு:** சந்திப்பு நேரம் தோராயமானது. அவசர சிகிச்சை காரணமாக காத்திருப்பு நேரம் மாறுபடலாம். இதை ஏற்று உறுதிப்படுத்தவும்.",
    confirmChips: [
      { label: 'உறுதிப்படுத்தி பதிவு செய்', value: 'CONFIRM' },
      { label: 'ரத்து செய்', value: 'CANCEL' }
    ],
    cancelled: "அப்பாயிண்ட்மெண்ட் முன்பதிவு ரத்து செய்யப்பட்டது. நான் உங்களுக்கு வேறு என்ன உதவி செய்ய முடியும்?",
    success: (doctor, date, time, token) => `✅ ${doctor} அவர்களுடன் உங்கள் சந்திப்பு ${date} அன்று ${time} மணிக்கு பதிவு செய்யப்பட்டது. உங்கள் டோக்கன் எண் ${token}.`,
    error: "மன்னிக்கவும், அப்பாயிண்ட்மெண்ட் பதிவு செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது வரவேற்பைத் தொடர்பு கொள்ளவும்.",
    emergencyAlert: "🚨 **அவசர எச்சரிக்கை:** உங்கள் அறிகுறிகளுக்கு உடனடி மருத்துவ கவனிப்பு தேவைப்படலாம். தயவுசெய்து அருகிலுள்ள அவசர சிகிச்சைப் பிரிவிற்குச் செல்லவும் அல்லது **108** ஐ அழைக்கவும்."
  }
};

const AFFIRMATIVE_WORDS = new Set([
  'yes', 'yes please', 'confirm', 'confirm it', 'book it', 'go ahead', 'proceed', 'okay', 'ok', 'sure',
  'ಹೌದು', 'ಹೌದು ಬುಕ್ ಮಾಡಿ', 'ಬುಕ್ ಮಾಡಿ', 'ಮಾಡಿ', 'ಸರಿ',
  'हाँ', 'हां', 'ठीक है', 'हाँ बुक करें', 'कर दीजिए', 'बुकिंग करो', 'पुष्टि करें',
  'అవును', 'అవును బుక్ చేయండి', 'బుక్ చేయండి', 'చేయండి', 'సరే', 'నిర్ధారించండి',
  'ஆம்', 'சரி', 'ஆம் பதிவு செய்யுங்கள்', 'பதிவு செய்', 'உறுதிப்படுத்துகிறேன்'
]);

const CANCEL_WORDS = new Set([
  'no', 'no thanks', 'cancel', 'stop', 'dont', "don't", 'abort',
  'ಬೇಡ', 'ಇಲ್ಲ', 'ರದ್ದು', 'ರದ್ದುಮಾಡಿ',
  'नहीं', 'मत करो', 'रद्द', 'रद्द करें',
  'వద్దు', 'కాదు', 'రద్దు', 'రద్దు చేయండి',
  'வேண்டாம்', 'இல்லை', 'ரத்து', 'ரத்து செய்'
]);

/**
 * Resolves authenticated patient profile from Firestore.
 * Does not re-ask information already present.
 */
export async function getPatientProfileForBooking(uid, db) {
  if (!uid) return { patientHealthId: 'TEMP_PATIENT', patientName: 'Patient' };
  try {
    const pSnap = await db.collection('patients').doc(uid).get();
    if (pSnap.exists) {
      const data = pSnap.data();
      return {
        patientHealthId: data.patientHealthId || data.healthId || uid,
        patientName: data.fullName || data.name || 'Patient',
        phone: data.phone || data.patientPhone || null,
        age: data.age || data.patientAge || null,
        gender: data.gender || null
      };
    }
    const uSnap = await db.collection('users').doc(uid).get();
    if (uSnap.exists) {
      const data = uSnap.data();
      return {
        patientHealthId: data.patientHealthId || data.healthId || uid,
        patientName: data.fullName || data.name || 'Patient',
        phone: data.phone || null,
        age: data.age || null,
        gender: data.gender || null
      };
    }
  } catch (err) {
    console.warn('[bookingConversation] profile lookup failed:', err.message);
  }
  return { patientHealthId: uid, patientName: 'Patient' };
}

/**
 * Invokes an Express controller function wrapped in a Promise
 */
function invokeController(controller, request) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const response = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode, body });
        return this;
      }
    };
    try {
      const pending = controller(request, response, reject);
      if (pending && typeof pending.catch === 'function') pending.catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Main conversational booking step processor.
 */
export async function processConversationalBookingStep({
  user,
  message = '',
  language = 'en',
  bookingState = null,
  history = [],
  db = assertDbConnected(),
  requestId = null,
  headers = {}
}) {
  const langKey = (language || 'en').split('-')[0];
  const t = I18N[langKey] || I18N.en;
  const cleanMsg = message.trim();
  const lowerMsg = cleanMsg.toLowerCase();

  // 1. Check for cancellation intent at any step
  if (bookingState && (CANCEL_WORDS.has(lowerMsg) || lowerMsg.includes('cancel') || cleanMsg.includes('ರದ್ದು') || cleanMsg.includes('रद्द'))) {
    return {
      success: true,
      language: langKey,
      message: t.cancelled,
      response: `${t.cancelled}\n\nDisclaimer: This is AI generated content.`,
      quickChips: [
        { label: 'Book Appointment', text: 'Book Appointment' },
        { label: 'My Token Status', text: 'My Token Status' },
        { label: 'Doctor Timings', text: 'Doctor Timings' }
      ],
      bookingState: null,
      aiSource: 'conversational_booking_flow'
    };
  }

  // Resolve patient profile if not already cached in state
  let profile = {
    patientHealthId: bookingState?.patientHealthId,
    patientName: bookingState?.patientName
  };
  if (!profile.patientHealthId && user?.uid) {
    const fetched = await getPatientProfileForBooking(user.uid, db);
    profile.patientHealthId = fetched.patientHealthId;
    profile.patientName = fetched.patientName;
  }

  // --------------------------------------------------------------------------
  // STEP A: Initial intent -> Ask for reason/symptoms (or process reason if already provided)
  // --------------------------------------------------------------------------
  if (!bookingState || !bookingState.step) {
    // Check if user already provided reason/symptoms along with intent (e.g. "I have fever, book appointment")
    const words = cleanMsg.split(/\s+/).filter(Boolean);
    const isBriefIntentOnly = words.length <= 4 ||
      ['book an appointment for me', 'ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ನೀನೇ ಬುಕ್ ಮಾಡು', 'ನನಗೆ ಡಾಕ್ಟರ್ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬೇಕು',
       'मेरे लिए अपॉइंटमेंट बुक करो', 'నాకు అపాయింట్మెంట్ బుక్ చేయండి', 'எனக்கு அப்பாயிண்ட்மெண்ட் புக் செய்யுங்கள்'
      ].some(p => lowerMsg.includes(p.toLowerCase()));

    if (isBriefIntentOnly) {
      return {
        success: true,
        language: langKey,
        message: t.greetingPrompt,
        response: `${t.greetingPrompt}\n\nDisclaimer: This is AI generated content.`,
        quickChips: t.commonSymptoms.map(s => ({ label: s.label, text: s.value })),
        actionButtons: [{ label: '📅 Open Interactive Booking', route: '/book-appointment' }],
        bookingState: {
          step: 'AWAITING_REASON',
          patientHealthId: profile.patientHealthId,
          patientName: profile.patientName
        },
        aiSource: 'conversational_booking_flow'
      };
    }

    // Reason was included in initial message -> advance directly to reason evaluation!
    bookingState = {
      step: 'AWAITING_REASON',
      patientHealthId: profile.patientHealthId,
      patientName: profile.patientName
    };
  }

  // --------------------------------------------------------------------------
  // STEP B: AWAITING_REASON -> Clinical Triage -> Doctor Selection
  // --------------------------------------------------------------------------
  if (bookingState.step === 'AWAITING_REASON') {
    const reasonText = cleanMsg;

    // Run clinical triage rules (multi-language red flag matching)
    const triageResult = evaluateTriageRules(reasonText);

    // EMERGENCY RED FLAG: Immediate escalation to Emergency Room / 108
    if (triageResult.redFlag) {
      return {
        success: true,
        isEmergency: true,
        language: langKey,
        message: t.emergencyAlert,
        response: `${t.emergencyAlert}\n\nDisclaimer: This is AI generated content.`,
        quickChips: [
          { label: '🚑 Call 108 Emergency', text: '108' },
          { label: 'Hospital Reception', text: 'Talk to Staff' }
        ],
        bookingState: null,
        aiSource: 'conversational_booking_flow'
      };
    }

    const departmentId = triageResult.departmentId || 'dept-gen';

    // Retrieve active doctors in this department
    let doctorsSnap = await db.collection('doctors')
      .where('departmentId', '==', departmentId)
      .limit(10)
      .get();

    let docs = doctorsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.active !== false);

    // Fallback: if no active doctors in specific dept, query general doctors
    if (docs.length === 0) {
      const fallbackSnap = await db.collection('doctors')
        .where('departmentId', '==', 'dept-gen')
        .limit(10)
        .get();
      docs = fallbackSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.active !== false);
    }

    // Secondary fallback: any active doctors
    if (docs.length === 0) {
      const allDocsSnap = await db.collection('doctors').limit(10).get();
      docs = allDocsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.active !== false);
    }

    if (docs.length === 0) {
      return {
        success: true,
        language: langKey,
        message: t.noDoctors,
        response: `${t.noDoctors}\n\nDisclaimer: This is AI generated content.`,
        bookingState: null,
        actionButtons: [{ label: '📅 Open Booking Page', route: '/book-appointment' }],
        aiSource: 'conversational_booking_flow'
      };
    }

    const doctorsList = docs.map(d => ({
      doctorId: d.doctorId || d.id,
      name: d.fullName || d.name || 'Doctor',
      departmentId: d.departmentId || departmentId
    }));

    const promptText = t.doctorPrompt(reasonText);
    const doctorChips = doctorsList.map(d => ({
      label: d.name.startsWith('Dr.') ? d.name : `Dr. ${d.name}`,
      text: d.name
    }));

    return {
      success: true,
      language: langKey,
      message: promptText,
      response: `${promptText}\n\nDisclaimer: This is AI generated content.`,
      quickChips: doctorChips,
      bookingState: {
        step: 'SELECT_DOCTOR',
        patientHealthId: profile.patientHealthId,
        patientName: profile.patientName,
        reasonText,
        departmentId,
        doctors: doctorsList
      },
      aiSource: 'conversational_booking_flow'
    };
  }

  // --------------------------------------------------------------------------
  // STEP C: SELECT_DOCTOR -> Slot Retrieval -> Slot Selection
  // --------------------------------------------------------------------------
  if (bookingState.step === 'SELECT_DOCTOR') {
    // Find matching doctor
    const doctors = bookingState.doctors || [];
    let selectedDoctor = doctors.find(d =>
      cleanMsg.toLowerCase().includes(d.name.toLowerCase()) ||
      d.name.toLowerCase().includes(cleanMsg.toLowerCase()) ||
      cleanMsg.toLowerCase().includes((d.doctorId || '').toLowerCase())
    );

    if (!selectedDoctor && doctors.length > 0) {
      // If user typed 1st, 2nd, etc. or a generic affirmative, take the first doctor
      selectedDoctor = doctors[0];
    }

    if (!selectedDoctor) {
      return {
        success: true,
        language: langKey,
        message: "Please choose one of the available doctors:",
        quickChips: doctors.map(d => ({ label: d.name, text: d.name })),
        bookingState,
        aiSource: 'conversational_booking_flow'
      };
    }

    // Look for slots: start with tomorrow (to avoid expired slots), fallback to today
    const tomorrowStr = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const todayStr = getHospitalTodayStr();

    let targetDate = tomorrowStr;
    let slotRes = await invokeController(getSlots, {
      query: { doctorId: selectedDoctor.doctorId, date: targetDate }
    });

    let rawSlots = slotRes.body?.data?.slots || [];
    let freeSlots = rawSlots.filter(s => String(s.status || '').toLowerCase() === 'free');

    // If no slots tomorrow, check today for future slots
    if (freeSlots.length === 0) {
      targetDate = todayStr;
      slotRes = await invokeController(getSlots, {
        query: { doctorId: selectedDoctor.doctorId, date: targetDate }
      });
      const nowTime = dayjs().format('HH:mm');
      rawSlots = slotRes.body?.data?.slots || [];
      freeSlots = rawSlots.filter(s =>
        String(s.status || '').toLowerCase() === 'free' && s.startAt > nowTime
      );
    }

    if (freeSlots.length === 0) {
      const noSlotMsg = t.noSlots(selectedDoctor.name);
      return {
        success: true,
        language: langKey,
        message: noSlotMsg,
        response: `${noSlotMsg}\n\nDisclaimer: This is AI generated content.`,
        quickChips: doctors.filter(d => d.doctorId !== selectedDoctor.doctorId).map(d => ({ label: d.name, text: d.name })),
        bookingState: {
          ...bookingState,
          step: 'SELECT_DOCTOR'
        },
        aiSource: 'conversational_booking_flow'
      };
    }

    const availableSlots = freeSlots.slice(0, 6).map(s => ({
      slotId: s.id,
      date: targetDate,
      time: s.startAt,
      endTime: s.endAt
    }));

    const slotPromptText = t.slotPrompt(selectedDoctor.name, targetDate);
    const slotChips = availableSlots.map(s => ({
      label: s.time,
      text: s.time
    }));

    return {
      success: true,
      language: langKey,
      message: slotPromptText,
      response: `${slotPromptText}\n\nDisclaimer: This is AI generated content.`,
      quickChips: slotChips,
      bookingState: {
        step: 'SELECT_SLOT',
        patientHealthId: profile.patientHealthId,
        patientName: profile.patientName,
        reasonText: bookingState.reasonText,
        departmentId: selectedDoctor.departmentId || bookingState.departmentId,
        doctorId: selectedDoctor.doctorId,
        doctorName: selectedDoctor.name,
        date: targetDate,
        slots: availableSlots
      },
      aiSource: 'conversational_booking_flow'
    };
  }

  // --------------------------------------------------------------------------
  // STEP D: SELECT_SLOT -> Disclaimer Explanation & Confirmation Summary
  // --------------------------------------------------------------------------
  if (bookingState.step === 'SELECT_SLOT') {
    const slots = bookingState.slots || [];
    let selectedSlot = slots.find(s => cleanMsg.includes(s.time) || cleanMsg.includes(s.slotId));

    if (!selectedSlot && slots.length > 0) {
      selectedSlot = slots[0];
    }

    if (!selectedSlot) {
      return {
        success: true,
        language: langKey,
        message: "Please select an available time slot:",
        quickChips: slots.map(s => ({ label: s.time, text: s.time })),
        bookingState,
        aiSource: 'conversational_booking_flow'
      };
    }

    // Issue single-use confirmation token
    const confirmToken = storeConfirmToken({
      type: 'BOOKING',
      userId: user.uid,
      patientHealthId: bookingState.patientHealthId,
      patientName: bookingState.patientName,
      doctorId: bookingState.doctorId,
      doctorName: bookingState.doctorName,
      departmentId: bookingState.departmentId,
      date: selectedSlot.date,
      timeSlot: selectedSlot.time,
      slotId: selectedSlot.slotId,
      reasonText: bookingState.reasonText
    });

    const summaryText = `${t.summaryHeader}
- **${t.doctorLabel}:** ${bookingState.doctorName}
- **${t.dateTimeLabel}:** ${selectedSlot.date} at ${selectedSlot.time}
- **${t.reasonLabel}:** ${bookingState.reasonText}

${t.disclaimerText}`;

    return {
      success: true,
      language: langKey,
      message: summaryText,
      response: `${summaryText}\n\nDisclaimer: This is AI generated content.`,
      confirmToken,
      actionRequired: 'CONFIRM_BOOKING',
      summary: `Book appointment with ${bookingState.doctorName} on ${selectedSlot.date} at ${selectedSlot.time}`,
      quickChips: t.confirmChips.map(c => ({ label: c.label, text: c.label })),
      bookingState: {
        step: 'AWAITING_CONFIRMATION',
        confirmToken,
        patientHealthId: bookingState.patientHealthId,
        patientName: bookingState.patientName,
        doctorId: bookingState.doctorId,
        doctorName: bookingState.doctorName,
        departmentId: bookingState.departmentId,
        date: selectedSlot.date,
        timeSlot: selectedSlot.time,
        slotId: selectedSlot.slotId,
        reasonText: bookingState.reasonText
      },
      aiSource: 'conversational_booking_flow'
    };
  }

  // --------------------------------------------------------------------------
  // STEP E: AWAITING_CONFIRMATION -> Final Booking Execution
  // --------------------------------------------------------------------------
  if (bookingState.step === 'AWAITING_CONFIRMATION') {
    const isAffirmative = AFFIRMATIVE_WORDS.has(lowerMsg) ||
      cleanMsg.includes('ಬುಕ್') || cleanMsg.includes('ದೃಢೀಕರಿಸಿ') || cleanMsg.includes('पुष्टि') ||
      cleanMsg.includes('నిర్ధారించండి') || cleanMsg.includes('உறுதிப்படுத்துகிறேன்');

    if (isAffirmative) {
      // Invoke existing appointment controller with mandatory disclaimerAck
      const result = await invokeController(createAppointment, {
        body: {
          slotId: bookingState.slotId,
          slotIds: [bookingState.slotId],
          patientHealthId: bookingState.patientHealthId,
          patientName: bookingState.patientName || 'Patient',
          doctorId: bookingState.doctorId,
          departmentId: bookingState.departmentId || undefined,
          date: bookingState.date,
          reasonText: bookingState.reasonText || 'Routine checkup',
          disclaimerAck: {
            acknowledged: true,
            at: new Date().toISOString(),
            version: '1.0'
          }
        },
        user: { uid: user.uid, role: 'patient' },
        requestId: requestId || `ai_confirm_${Date.now()}`,
        headers
      });

      if (result.statusCode >= 400 || !result.body?.success) {
        return {
          success: false,
          language: langKey,
          message: result.body?.message || t.error,
          response: `${result.body?.message || t.error}\n\nDisclaimer: This is AI generated content.`,
          bookingState: null,
          aiSource: 'conversational_booking_flow'
        };
      }

      const apptData = result.body.data || {};
      const doctor = apptData.doctorName || bookingState.doctorName;
      const date = apptData.date || bookingState.date;
      const time = apptData.bookedStartAt || apptData.timeSlot || bookingState.timeSlot;
      const token = apptData.tokenLabel || apptData.tokenNumber || 'Token Generated';

      const successMsg = t.success(doctor, date, time, token);

      return {
        success: true,
        language: langKey,
        message: successMsg,
        response: `${successMsg}\n\nDisclaimer: This is AI generated content.`,
        appointment: apptData,
        data: apptData,
        bookingState: null,
        quickChips: [
          { label: 'My Token Status', text: 'My Token Status' },
          { label: 'Doctor Timings', text: 'Doctor Timings' }
        ],
        actionButtons: [{ label: 'View Appointments', route: '/appointments' }],
        aiSource: 'conversational_booking_flow'
      };
    }

    // Non-affirmative reply -> prompt again or cancel
    return {
      success: true,
      language: langKey,
      message: `Please confirm to proceed with booking your appointment with Dr. ${bookingState.doctorName} on ${bookingState.date} at ${bookingState.timeSlot}:`,
      quickChips: t.confirmChips.map(c => ({ label: c.label, text: c.label })),
      bookingState,
      aiSource: 'conversational_booking_flow'
    };
  }

  return {
    success: true,
    language: langKey,
    message: t.greetingPrompt,
    bookingState: null,
    aiSource: 'conversational_booking_flow'
  };
}

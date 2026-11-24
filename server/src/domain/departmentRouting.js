/**
 * Hospital Department Routing & Clinical Triage Ruleset (PRD Module 1 & Clinical Safety)
 *
 * Rules:
 * 1. Patients should NOT be required to know department or doctor names.
 * 2. Emergency warning signs must stop routine appointment booking immediately.
 * 3. Complaint-to-department recommendations are based on hospital-approved clinical routing rules.
 * 4. Clear, patient-friendly rationale in simple language across supported languages.
 */

import { evaluateTriageRules, normalizeText } from './triage.js';
import redFlagsConfig from '../config/clinical/redflags.json' with { type: 'json' };

export const HOSPITAL_DEPARTMENTS = [
  {
    id: 'dept-gen',
    name: 'General Medicine',
    code: 'GEN',
    aliases: ['general', 'medicine', 'internal medicine', 'physician', 'ಸಾಮಾನ್ಯ ವೈದ್ಯಕೀಯ', 'ಸಾಮಾನ್ಯ ವಿಭಾಗ', 'जनरल मेडिसिन', 'பொது மருத்துவம்', 'జనరల్ మెడిసిన్'],
    description: 'Comprehensive assessment for fever, viral illnesses, common infections, fatigue, and general health concerns.',
    symptoms: ['fever', 'cough', 'cold', 'infection', 'viral', 'fatigue', 'weakness', 'headache', 'body pain', 'chills', 'vomiting', 'nausea', 'stomach upset', 'ಜ್ವರ', 'ಕೆಮ್ಮು', 'ನೆಗಡಿ', 'ತಲೆನೋವು', 'बुखार', 'खांसी', 'जुकाम', 'कாய்ச்சல்', 'இருமல்', 'జ్వరం', 'దగ్గు'],
    room: 'Room 101-104',
    wing: 'North Wing',
    active: true
  },
  {
    id: 'dept-card',
    name: 'Cardiology',
    code: 'CARD',
    aliases: ['cardio', 'heart', 'cardiac', 'ಹೃದ್ರೋಗ', 'हृदय रोग', 'இதயவியல்', 'కార్డియోలజీ'],
    description: 'Heart health, blood pressure management, mild palpitations, and cardiovascular follow-up.',
    symptoms: ['heart', 'palpitation', 'blood pressure', 'hypertension', 'cholesterol', 'cardiac checkup', 'mild chest flutter', 'ಹೃದಯ', 'ರಕ್ತದೊತ್ತಡ', 'दिल', 'ब्लड प्रेशर', 'இதயம்'],
    room: 'Room 201-205',
    wing: 'East Wing',
    active: true
  },
  {
    id: 'dept-derm',
    name: 'Dermatology',
    code: 'DERM',
    aliases: ['skin', 'derma', 'ಚರ್ಮ ರೋಗ', 'त्वचा रोग', 'தோல் மருத்துவம்', 'డెర్మటాలజీ'],
    description: 'Skin conditions, rashes, acne, allergies, itching, and hair or nail problems.',
    symptoms: ['skin', 'rash', 'itching', 'acne', 'allergy', 'eczema', 'hair fall', 'scalp', 'boil', 'ಚರ್ಮ', 'ತುರಿಕೆ', 'ತಲೆಹೊಟ್ಟು', 'त्वचा', 'खुजली', 'தோல்', 'అలర్జీ', 'చర్మం'],
    room: 'Room 401-402',
    wing: 'South Wing',
    active: true
  },
  {
    id: 'dept-ophth',
    name: 'Ophthalmology',
    code: 'OPHTH',
    aliases: ['eye', 'eyes', 'vision', 'ಕಣ್ಣಿನ ವಿಭಾಗ', 'नेत्र रोग', 'கண் மருத்துவம்', 'నేత్ర వైద్యం'],
    description: 'Eye care, vision problems, eye redness, irritation, and cataract assessment.',
    symptoms: ['eye', 'eyes', 'vision', 'blur', 'red eye', 'eye pain', 'irritation', 'spectacles', 'glasses', 'ಕಣ್ಣು', 'ದೃಷ್ಟಿ', 'आंख', 'कண்', 'కన్ను'],
    room: 'Room 301-303',
    wing: 'East Wing',
    active: true
  },
  {
    id: 'dept-dent',
    name: 'Dentistry',
    code: 'DENT',
    aliases: ['dental', 'teeth', 'tooth', 'ದಂತ ವೈದ್ಯಕೀಯ', 'दंत चिकित्सा', 'பல் மருத்துவம்', 'దంత వైద్యం'],
    description: 'Teeth, gums, toothache, cavities, dental cleaning, and oral health.',
    symptoms: ['tooth', 'teeth', 'toothache', 'gum', 'gums', 'cavity', 'dental', 'mouth ulcer', 'ಹಲ್ಲು', 'ಹಲ್ಲುನೋವು', 'दांत', 'दंत', 'பல்', 'దంతాల నొప్పి'],
    room: 'Room 206-208',
    wing: 'North Wing',
    active: true
  },
  {
    id: 'dept-ortho',
    name: 'Orthopedics',
    code: 'ORTH',
    aliases: ['bone', 'joint', 'ortho', 'ಮೂಳೆ ರೋಗ', 'हड्डी रोग', 'எலும்பியல்', 'ఆర్థోపెడిక్స్'],
    description: 'Bones, joints, fractures, back pain, knee pain, arthritis, and sports injuries.',
    symptoms: ['bone', 'joint', 'knee', 'back pain', 'joint pain', 'fracture', 'sprain', 'arthritis', 'shoulder pain', 'ಮೂಳೆ', 'ಕೀಲು ನೋವು', 'ಬೆನ್ನು ನೋವು', 'हड्डी', 'घुटने का दर्द', 'மூட்டு வலி', 'ఎముకల నొప్పి'],
    room: 'Room 206-210',
    wing: 'East Wing',
    active: true
  },
  {
    id: 'dept-ped',
    name: 'Pediatrics',
    code: 'PED',
    aliases: ['child', 'children', 'infant', 'baby', 'kids', 'ಮಕ್ಕಳ ತಜ್ಞರು', 'बाल रोग', 'குழந்தை மருத்துவம்', 'పీడియాట్రిక్స్'],
    description: 'Child health, infant care, pediatric infections, growth, and vaccination.',
    symptoms: ['child', 'baby', 'infant', 'toddler', 'pediatric', 'kid', 'newborn', 'vaccine for child', 'ಮಗು', 'ಮಕ್ಕಳು', 'बच्चा', 'शिशु', 'குழந்தை', 'పిల్లల'],
    room: 'Room 301-303',
    wing: 'West Wing',
    active: true
  },
  {
    id: 'dept-obgyn',
    name: 'Obstetrics and Gynecology',
    code: 'OBG',
    aliases: ['pregnancy', 'gynae', 'gynecology', 'obgyn', 'ಮಹಿಳಾ ಮತ್ತು ಪ್ರಸೂತಿ', 'स्त्री रोग', 'மகப்பேறு மருத்துவம்', 'గైనకాలజీ'],
    description: 'Pregnancy care, prenatal checkups, menstrual health, and women wellness.',
    symptoms: ['pregnant', 'pregnancy', 'period', 'menstrual', 'prenatal', 'uterus', 'cramp', 'ಗರ್ಭಿಣಿ', 'ಪ್ರಸೂತಿ', 'गर्भावस्था', 'पीरियड', 'கர்ப்பம்', 'గర్భధారణ'],
    room: 'Room 501-505',
    wing: 'North Wing',
    active: true
  },
  {
    id: 'dept-ent',
    name: 'ENT (Ear, Nose & Throat)',
    code: 'ENT',
    aliases: ['ear', 'nose', 'throat', 'ent', 'ಕಿವಿ ಮೂಗು ಗಂಟಲು', 'कान नाक गला', 'காது மூக்கு தொண்டை', 'ఈఎన్‌టీ'],
    description: 'Ear infections, hearing issues, sinusitis, tonsils, and throat problems.',
    symptoms: ['ear', 'ear pain', 'earache', 'hearing', 'throat', 'sore throat', 'tonsil', 'sinus', 'nose bleed', 'ಕಿವಿ', 'ಗಂಟಲು', 'ಗಂಟಲು ನೋವು', 'कान', 'गला', 'காது', 'தொண்டை', 'చెవి నొప్పి'],
    room: 'Room 305-307',
    wing: 'West Wing',
    active: true
  }
];

/**
 * Screen patient complaints for emergency warning signs
 */
export function screenEmergencyWarningSigns(complaint = '', answers = {}) {
  const text = `${complaint} ${answers.duration || ''} ${answers.severity || ''}`.trim();
  const triage = evaluateTriageRules(text, answers);

  const normalized = normalizeText(text);

  // Check explicit red flags
  const emergencyKeywords = [
    'chest pain', 'sever chest pain', 'heart attack',
    'cannot breathe', 'difficulty breathing', 'shortness of breath', 'gasping',
    'stroke', 'sudden weakness', 'paralysis', 'unconscious', 'fainted', 'loss of consciousness',
    'heavy bleeding', 'uncontrolled bleeding',
    'stiff neck with high fever', 'convulsion', 'seizure',
    'chhati me tej dard', 'saans lene me takleef', 'behosh',
    'edeyalli teevra novu', 'usiru kattuvike', 'svabodhina'
  ];

  const hasDirectEmergency = emergencyKeywords.some(kw => normalized.includes(normalizeText(kw)));

  if (hasDirectEmergency || triage.level === 3 || triage.urgencySuggested === 'emergency') {
    return {
      isEmergency: true,
      emergencyMessage: triage.emergencyMessage || 'CRITICAL EMERGENCY: Severe warning signs detected. Please proceed to the Emergency Department immediately or call 108 / 112.',
      emergencyNumber: '108 / 112',
      stopBooking: true
    };
  }

  return { isEmergency: false };
}

/**
 * Recommend the most appropriate hospital department based on patient complaint
 */
export function routeComplaintToDepartment(complaint = '', answers = {}, language = 'en') {
  // 1. First run emergency screening
  const emergencyCheck = screenEmergencyWarningSigns(complaint, answers);
  if (emergencyCheck.isEmergency) {
    return {
      isEmergency: true,
      emergencyMessage: emergencyCheck.emergencyMessage,
      emergencyNumber: '108 / 112',
      stopBooking: true,
      message: `${emergencyCheck.emergencyMessage} Please call 108 / 112 for immediate assistance.`
    };
  }

  const normInput = normalizeText(`${complaint} ${answers.additional || ''}`);
  let matchedDept = null;
  let highestScore = 0;

  for (const dept of HOSPITAL_DEPARTMENTS) {
    let score = 0;
    // Check symptom matches
    for (const sym of dept.symptoms) {
      if (normInput.includes(normalizeText(sym))) {
        score += 3;
      }
    }
    // Check alias matches
    for (const alias of dept.aliases) {
      if (normInput.includes(normalizeText(alias))) {
        score += 5;
      }
    }

    if (score > highestScore) {
      highestScore = score;
      matchedDept = dept;
    }
  }

  // Fallback to General Medicine if no specific department match
  if (!matchedDept || highestScore === 0) {
    matchedDept = HOSPITAL_DEPARTMENTS.find(d => d.id === 'dept-gen');
  }

  // Generate simple language rationale
  const rationales = {
    'dept-gen': {
      en: `Based on your symptoms, I recommend our ${matchedDept.name} department for an overall evaluation and primary treatment.`,
      kn: `ನಿಮ್ಮ ರೋಗಲಕ್ಷಣಗಳ ಆಧಾರದ ಮೇಲೆ, ಸಮಗ್ರ ತಪಾಸಣೆ ಮತ್ತು ಚಿಕಿತ್ಸೆಗಾಗಿ ನಮ್ಮ ${matchedDept.name} (ಸಾಮಾನ್ಯ ವೈದ್ಯಕೀಯ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `आपके लक्षणों के आधार पर, मैं प्रारंभिक जांच और उपचार के लिए हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `మీ లక్షణాల ఆధారంగా, సమగ్ర పరిశీలన కోసం మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `உங்கள் அறிகுறிகளின் அடிப்படையில், ஆரம்ப பரிசோதனைக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-derm': {
      en: `For your skin-related concern, I recommend our ${matchedDept.name} department where specialists examine skin, hair, and rash conditions.`,
      kn: `ಚರ್ಮ, ದದ್ದು ಮತ್ತು ತುರಿಕೆಗೆ ಸಂಬಂಧಿಸಿದ ಸಮಸ್ಯೆಗೆ ನಮ್ಮ ${matchedDept.name} (ಚರ್ಮ ರೋಗ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `त्वचा, दाने और खुजली से जुड़ी समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `చర్మ సంబంధిత సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `தோல் சம்பந்தப்பட்ட பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-ophth': {
      en: `For eye and vision concerns, I recommend our ${matchedDept.name} department for focused eye assessment.`,
      kn: `ಕಣ್ಣು ಮತ್ತು ದೃಷ್ಟಿಗೆ ಸಂಬಂಧಿಸಿದ ಸಮಸ್ಯೆಗೆ ನಮ್ಮ ${matchedDept.name} (ನೇತ್ರ ಚಿಕಿತ್ಸಾ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `आंखों और दृष्टि से जुड़ी समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `కంటి సంబంధిత సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `கண் சம்பந்தப்பட்ட பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-dent': {
      en: `For dental and tooth-related issues, I recommend our ${matchedDept.name} department for oral care.`,
      kn: `ಹಲ್ಲು ಮತ್ತು ವಸಡಿನ ನೋವಿಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ನಮ್ಮ ${matchedDept.name} (ದಂತ ವೈದ್ಯಕೀಯ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `दांत और मसूड़ों से जुड़ी समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `దంత సంబంధిత సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `பல் சம்பந்தப்பட்ட பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-ortho': {
      en: `For bone and joint concerns, I recommend our ${matchedDept.name} department specializing in joints, spine, and movement care.`,
      kn: `ಮೂಳೆ ಮತ್ತು ಕೀಲು ನೋವಿಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ನಮ್ಮ ${matchedDept.name} (ಮೂಳೆ ರೋಗ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `हड्डी और जोड़ों से जुड़ी समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `ఎముకలు మరియు కీళ్ల సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `எலும்பு மற்றும் மூட்டு பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-ped': {
      en: `For child health concerns, I recommend our ${matchedDept.name} department dedicated to infant and children health.`,
      kn: `ಮಕ್ಕಳ ಆರೋಗ್ಯ ಸಮಸ್ಯೆಗೆ ನಮ್ಮ ${matchedDept.name} (ಮಕ್ಕಳ ತಜ್ಞರ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `बच्चों के स्वास्थ्य से जुड़े मामलों के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `పిల్లల ఆరోగ్య సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `குழந்தைகளின் நலன் சார்ந்த பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-obgyn': {
      en: `For pregnancy or women health concerns, I recommend our ${matchedDept.name} department for specialized care.`,
      kn: `ಗರ್ಭಾವಸ್ಥೆ ಅಥವಾ ಮಹಿಳೆಯರ ಆರೋಗ್ಯ ಸಮಸ್ಯೆಗೆ ನಮ್ಮ ${matchedDept.name} (ಪ್ರಸೂತಿ ಮತ್ತು ಸ್ತ್ರೀರೋಗ) ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `गर्भावस्था या महिला स्वास्थ्य से जुड़ी समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `గర్భధారణ లేదా స్త్రీల ఆరోగ్య సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `கர்ப்பம் அல்லது பெண்கள் நலம் சார்ந்த பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-card': {
      en: `For heart checkups or blood pressure concerns, I recommend our ${matchedDept.name} department.`,
      kn: `ಹೃದಯದ ತಪಾಸಣೆ ಮತ್ತು ರಕ್ತದೊತ್ತಡಕ್ಕೆ ಸಂಬಂಧಿಸಿದಂತೆ ನಮ್ಮ ${matchedDept.name} ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `हृदय जांच और ब्लड प्रेशर के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `గుండె పరీక్షలు లేదా రక్తపోటు సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `இதய பரிசோதனைக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    },
    'dept-ent': {
      en: `For ear, nose, or throat concerns, I recommend our ${matchedDept.name} department for focused evaluation.`,
      kn: `ಕಿವಿ, ಮೂಗು ಅಥವಾ ಗಂಟಲಿನ ಸಮಸ್ಯೆಗೆ ನಮ್ಮ ${matchedDept.name} ವಿಭಾಗವನ್ನು ಶಿಫಾರಸು ಮಾಡುತ್ತೇನೆ.`,
      hi: `कान, नाक या गले की समस्या के लिए मैं हमारे ${matchedDept.name} विभाग की सलाह देता हूँ।`,
      te: `చెవి, ముక్కు లేదా గొంతు సమస్యలకు మా ${matchedDept.name} విభాగాన్ని సిఫార్సు చేస్తున్నాను.`,
      ta: `காது, மூக்கு, தொண்டை பிரச்சனைகளுக்கு எங்கள் ${matchedDept.name} துறையை பரிந்துரைக்கிறேன்.`
    }
  };

  const lk = (language || 'en').split('-')[0];
  const deptRationale = rationales[matchedDept.id]?.[lk] || rationales[matchedDept.id]?.en || rationales['dept-gen'].en;

  const followUpQuestion = {
    en: 'Would you like to proceed with this department, or would you prefer a different one?',
    kn: 'ನೀವು ಈ ವಿಭಾಗದೊಂದಿಗೆ ಮುಂದುವರಿಯಲು ಬಯಸುವಿರಾ, ಅಥವಾ ಬೇರೆ ವಿಭಾಗವನ್ನು ಆಯ್ಕೆಮಾಡಲು ಬಯಸುವಿರಾ?',
    hi: 'क्या आप इस विभाग के साथ आगे बढ़ना चाहेंगे, या कोई अन्य विभाग चुनना चाहेंगे?',
    te: 'మీరు ఈ విభాగంతో ముందుకు వెళ్లాలనుకుంటున్నారా, లేదా వేరొక విభాగాన్ని ఎంచుకోవాలనుకుంటున్నారా?',
    ta: 'நீங்கள் இந்தத் துறையுடன் தொடர விரும்புகிறீர்களா, அல்லது வேறு துறையைத் தேர்ந்தெடுக்க விரும்புகிறீர்களா?'
  }[lk] || 'Would you like to proceed with this department, or would you prefer a different one?';

  return {
    isEmergency: false,
    recommendedDepartmentId: matchedDept.id,
    departmentName: matchedDept.name,
    code: matchedDept.code,
    room: matchedDept.room,
    wing: matchedDept.wing,
    rationale: deptRationale,
    message: `${deptRationale} ${followUpQuestion}`
  };
}

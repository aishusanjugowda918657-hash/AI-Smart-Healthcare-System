import { assertDbConnected } from '../config/firebase.js';
import { generateText } from './geminiService.js';

/**
 * Natural-Language Patient Information Agent Service
 * Handles intent extraction, Firestore queries across medical collections,
 * and factual response generation without inventing medical facts.
 */

export const INTENTS = {
  MEDICAL_CONDITIONS: 'MEDICAL_CONDITIONS',
  VISIT_COUNT: 'VISIT_COUNT',
  APPOINTMENT_COUNT: 'APPOINTMENT_COUNT',
  CURRENT_MEDICATIONS: 'CURRENT_MEDICATIONS',
  UPCOMING_FOLLOWUP: 'UPCOMING_FOLLOWUP',
  DIAGNOSIS_HISTORY: 'DIAGNOSIS_HISTORY',
  MEDICAL_HISTORY: 'MEDICAL_HISTORY',
  BLOOD_GROUP: 'BLOOD_GROUP',
  ALLERGIES: 'ALLERGIES',
  LATEST_VITALS: 'LATEST_VITALS',
  LAST_TREATING_DOCTOR: 'LAST_TREATING_DOCTOR',
  MEDICINE_ADHERENCE: 'MEDICINE_ADHERENCE',
  PRESCRIPTIONS: 'PRESCRIPTIONS',
  GENERAL_INFO: 'GENERAL_INFO'
};

/**
 * Extract Patient Name and Intent from natural-language question.
 */
export const parseQuestion = async (question) => {
  const trimmed = question.trim();

  // Try Gemini AI for intent & patient name parsing
  try {
    const prompt = `You are an NLP parsing engine for a healthcare application.
Extract the patient's full name (if present) and the query intent from the doctor's question.

DOCTOR QUESTION: "${trimmed}"

Return ONLY a JSON object with this exact structure:
{
  "patientName": "Extracted Patient Name or empty string",
  "intent": "One of [MEDICAL_CONDITIONS, VISIT_COUNT, APPOINTMENT_COUNT, CURRENT_MEDICATIONS, UPCOMING_FOLLOWUP, DIAGNOSIS_HISTORY, MEDICAL_HISTORY, BLOOD_GROUP, ALLERGIES, LATEST_VITALS, LAST_TREATING_DOCTOR, MEDICINE_ADHERENCE, PRESCRIPTIONS, GENERAL_INFO]"
}
Do not include markdown formatting or backticks. Return raw JSON string only.`;

    const rawResponse = await generateText(prompt);
    const cleaned = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.patientName && parsed.patientName.trim() && parsed.intent) {
      return {
        patientName: parsed.patientName.trim(),
        intent: parsed.intent.toUpperCase()
      };
    }
  } catch (err) {
    console.warn('Gemini intent extraction fallback to rule-based parser:', err.message);
  }

  // Fallback deterministic rule-based parser
  return fallbackParseQuestion(trimmed);
};

/**
 * Rule-based fallback parser for question intent & patient name
 */
export const fallbackParseQuestion = (question) => {
  const lower = question.toLowerCase();

  let intent = INTENTS.GENERAL_INFO;

  if (lower.includes('disease') || lower.includes('suffering') || lower.includes('condition') || lower.includes('illness')) {
    intent = INTENTS.MEDICAL_CONDITIONS;
  } else if (lower.includes('how many times') || lower.includes('visit') || lower.includes('visited')) {
    intent = INTENTS.VISIT_COUNT;
  } else if (lower.includes('appointment')) {
    intent = INTENTS.APPOINTMENT_COUNT;
  } else if (lower.includes('medicine') || lower.includes('medication') || lower.includes('taking') || lower.includes('drug')) {
    intent = INTENTS.CURRENT_MEDICATIONS;
  } else if (lower.includes('follow-up') || lower.includes('followup') || lower.includes('next visit') || lower.includes('checkup')) {
    intent = INTENTS.UPCOMING_FOLLOWUP;
  } else if (lower.includes('previous diagnosis') || lower.includes('past diagnosis') || lower.includes('diagnosis')) {
    intent = INTENTS.DIAGNOSIS_HISTORY;
  } else if (lower.includes('medical history') || lower.includes('history')) {
    intent = INTENTS.MEDICAL_HISTORY;
  } else if (lower.includes('blood group') || lower.includes('blood type')) {
    intent = INTENTS.BLOOD_GROUP;
  } else if (lower.includes('allergy') || lower.includes('allergies') || lower.includes('allergic')) {
    intent = INTENTS.ALLERGIES;
  } else if (lower.includes('vital') || lower.includes('vitals') || lower.includes('bp') || lower.includes('blood pressure') || lower.includes('heart rate') || lower.includes('temperature')) {
    intent = INTENTS.LATEST_VITALS;
  } else if (lower.includes('treated') || lower.includes('treating doctor') || lower.includes('last doctor') || lower.includes('who saw')) {
    intent = INTENTS.LAST_TREATING_DOCTOR;
  } else if (lower.includes('regular') || lower.includes('regularly') || lower.includes('adherence') || lower.includes('take medicine')) {
    intent = INTENTS.MEDICINE_ADHERENCE;
  } else if (lower.includes('prescription')) {
    intent = INTENTS.PRESCRIPTIONS;
  }

  // Name extraction regex logic
  // Match common patterns like "John Doe what disease...", "How many times has John Doe visited?", "What is John Doe's..."
  let patientName = '';
  
  // Strip question words/phrases to isolate name candidate
  const stripped = lower
    .replace(/['’]s\b/g, '')
    .replace(/\b(what|how|when|who|where|does|is|has|show|me|the|a|an|times|disease|suffering|from|visited|taking|medicines|medications|next|follow-up|followup|previous|diagnosis|medical|history|blood|group|type|allergies|allergy|latest|vitals|treated|last|time|appointments|had|prescriptions|taking|regularly|have|any|he|she|his|her|patient|doctor|id)\b/g, ' ')
    .replace(/['’\?\!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length > 1) {
    patientName = stripped;
  }

  return { patientName, intent };
};

/**
 * Search patients collection by normalized patient name (nameLower)
 */
export const lookupPatientByName = async (db, name) => {
  const nameLower = name.trim().toLowerCase();

  const snapshot = await db.collection('patients')
    .where('nameLower', '==', nameLower)
    .get();

  if (snapshot.empty) {
    // Try substring/contains match if exact match on nameLower is empty
    const allPatients = await db.collection('patients').get();
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matchingDocs = allPatients.docs.filter(d => {
      const data = d.data();
      const n = (data.fullName || data.name || '').toLowerCase().trim();
      const nl = (data.nameLower || '').toLowerCase().trim();
      if (!n && !nl) return false;
      if (n === nameLower || nl === nameLower) return true;
      if (nameLower.length >= 3 && (n.startsWith(nameLower) || nl.startsWith(nameLower))) return true;
      if (n && n.length >= 3) {
        try {
          if (new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(nameLower)) return true;
          if (new RegExp(`\\b${escapeRegExp(nameLower)}\\b`, 'i').test(n)) return true;
        } catch (_) {}
      }
      if (nl && nl.length >= 3) {
        try {
          if (new RegExp(`\\b${escapeRegExp(nl)}\\b`, 'i').test(nameLower)) return true;
          if (new RegExp(`\\b${escapeRegExp(nameLower)}\\b`, 'i').test(nl)) return true;
        } catch (_) {}
      }
      return false;
    });

    if (matchingDocs.length === 0) {
      return { status: 'not_found' };
    }
    if (matchingDocs.length === 1) {
      const doc = matchingDocs[0];
      return { status: 'found', patient: { id: doc.id, ...doc.data() } };
    }

    const matches = matchingDocs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        fullName: d.fullName || d.name || '',
        patientHealthId: d.patientHealthId || null,
        age: d.age ?? null,
        gender: d.gender ?? null,
        contact: d.phone || d.contact || null,
        lastVisit: d.lastVisit ?? null
      };
    });

    return { status: 'duplicate', count: matches.length, matches };
  }

  if (snapshot.size === 1) {
    const doc = snapshot.docs[0];
    return { status: 'found', patient: { id: doc.id, ...doc.data() } };
  }

  const matches = snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      fullName: d.fullName || d.name || '',
      patientHealthId: d.patientHealthId || null,
      age: d.age ?? null,
      gender: d.gender ?? null,
      contact: d.phone || d.contact || null,
      lastVisit: d.lastVisit ?? null
    };
  });

  return { status: 'duplicate', count: matches.length, matches };
};

/**
 * Direct patient lookup by unique ID (Firestore Doc ID or patientHealthId)
 */
export const lookupPatientByUniqueId = async (db, uniqueId) => {
  const trimmed = uniqueId.trim();

  // Try direct doc ID
  const doc = await db.collection('patients').doc(trimmed).get();
  if (doc.exists) {
    return { status: 'found', patient: { id: doc.id, ...doc.data() } };
  }

  // Try patientHealthId
  const snap = await db.collection('patients').where('patientHealthId', '==', trimmed).get();
  if (!snap.empty) {
    const d = snap.docs[0];
    return { status: 'found', patient: { id: d.id, ...d.data() } };
  }

  return { status: 'not_found' };
};

/**
 * Efficiently fetch only the required Firestore collections for an intent
 */
export const fetchPatientRecords = async (db, patient, intent) => {
  const healthId = patient.patientHealthId;
  const uid = patient.id || patient.patientUid;

  const records = {
    patient,
    medicalRecords: [],
    prescriptions: [],
    appointments: [],
    followUps: [],
    medicineReminders: [],
    medicineLogs: []
  };

  const sources = [];

  // Helper to query collection by healthId or patientUid
  const queryCollection = async (collName) => {
    const coll = db.collection(collName);
    const docsMap = new Map();

    if (healthId) {
      const snap1 = await coll.where('patientHealthId', '==', healthId).get();
      snap1.docs.forEach(d => docsMap.set(d.id, { id: d.id, ...d.data() }));
    }
    if (uid) {
      const snap2 = await coll.where('patientUid', '==', uid).get();
      snap2.docs.forEach(d => docsMap.set(d.id, { id: d.id, ...d.data() }));

      const snap3 = await coll.where('patientId', '==', uid).get();
      snap3.docs.forEach(d => docsMap.set(d.id, { id: d.id, ...d.data() }));
    }

    return Array.from(docsMap.values());
  };

  // Determine needed collections based on intent
  if ([INTENTS.MEDICAL_CONDITIONS, INTENTS.DIAGNOSIS_HISTORY, INTENTS.MEDICAL_HISTORY, INTENTS.LATEST_VITALS, INTENTS.LAST_TREATING_DOCTOR, INTENTS.GENERAL_INFO].includes(intent)) {
    records.medicalRecords = await queryCollection('medicalRecords');
    sources.push('medicalRecords');
  }

  if ([INTENTS.CURRENT_MEDICATIONS, INTENTS.PRESCRIPTIONS, INTENTS.MEDICAL_HISTORY, INTENTS.GENERAL_INFO].includes(intent)) {
    records.prescriptions = await queryCollection('prescriptions');
    sources.push('prescriptions');
  }

  if ([INTENTS.VISIT_COUNT, INTENTS.APPOINTMENT_COUNT, INTENTS.LAST_TREATING_DOCTOR, INTENTS.MEDICAL_HISTORY, INTENTS.GENERAL_INFO].includes(intent)) {
    records.appointments = await queryCollection('appointments');
    sources.push('appointments');
  }

  if ([INTENTS.UPCOMING_FOLLOWUP, INTENTS.MEDICAL_HISTORY, INTENTS.GENERAL_INFO].includes(intent)) {
    records.followUps = await queryCollection('followUps');
    sources.push('followUps');
  }

  if ([INTENTS.CURRENT_MEDICATIONS, INTENTS.MEDICINE_ADHERENCE, INTENTS.GENERAL_INFO].includes(intent)) {
    records.medicineReminders = await queryCollection('medicineReminders');
    sources.push('medicineReminders');
  }

  if ([INTENTS.MEDICINE_ADHERENCE, INTENTS.GENERAL_INFO].includes(intent)) {
    records.medicineLogs = await queryCollection('medicineLogs');
    sources.push('medicineLogs');
  }

  // Always list 'patients' as a source
  sources.push('patients');

  // Resolve Doctor names for appointments/records/followups if doctorUid exists
  const doctorIds = new Set();
  records.medicalRecords.forEach(r => r.doctorUid && doctorIds.add(r.doctorUid));
  records.appointments.forEach(r => r.doctorUid && doctorIds.add(r.doctorUid));
  records.followUps.forEach(r => r.doctorUid && doctorIds.add(r.doctorUid));

  const doctorsMap = new Map();
  for (const docUid of doctorIds) {
    try {
      const docSnap = await db.collection('doctors').doc(docUid).get();
      if (docSnap.exists) {
        doctorsMap.set(docUid, docSnap.data().fullName || docSnap.data().name);
      }
    } catch (e) {
      // Ignore
    }
  }

  records.doctorsMap = doctorsMap;
  records.sources = [...new Set(sources)];

  return records;
};

/**
 * Format the factual response using retrieved Firestore records.
 * Uses Gemini if available, with deterministic code fallback.
 */
export const generateAnswerResponse = async ({ patient, intent, question, records }) => {
  const patientName = patient.fullName || patient.name || 'Patient';
  const healthId = patient.patientHealthId || patient.id;

  // Build deterministic fallback text first
  const fallbackAnswer = buildDeterministicAnswer(patient, intent, records);

  // If Gemini is available, format cleanly while adhering strictly to facts
  try {
    const prompt = `You are a natural-language medical record lookup assistant for doctors in a Smart Healthcare System.

DOCTOR QUESTION: "${question}"
INTENT: ${intent}
PATIENT: ${patientName} (${healthId})

RETRIEVED FIRESTORE DATA:
${JSON.stringify({
  patientInfo: {
    fullName: patientName,
    healthId,
    dob: patient.dob,
    gender: patient.gender,
    bloodGroup: patient.bloodGroup,
    allergies: patient.allergies,
    existingConditions: patient.existingConditions
  },
  medicalRecords: records.medicalRecords,
  prescriptions: records.prescriptions,
  appointments: records.appointments,
  followUps: records.followUps,
  medicineReminders: records.medicineReminders,
  medicineLogs: records.medicineLogs
}, null, 2)}

STRICT RULES FOR YOUR RESPONSE:
1. ONLY use facts present in RETRIEVED FIRESTORE DATA above. DO NOT invent diagnoses, medicines, dates, vitals, or appointments.
2. If data is empty or not present in the records, state explicitly: "No information is recorded for this in the available patient records." or "No diagnosis is recorded in the available medical records."
3. Use attribution phrases like: "John Doe's recorded diagnosis is...", "The medical records show...", "According to the available records...", "The latest recorded visit was...".
4. Format using clear GitHub Markdown:
   - Header with PATIENT name and Health ID.
   - ANSWER section with clear bullet points.
5. Keep response concise, readable, and factual.

Generate the final answer response now:`;

    const aiAnswer = await generateText(prompt);
    if (aiAnswer && aiAnswer.trim()) {
      return aiAnswer.trim();
    }
  } catch (err) {
    console.warn('Gemini response formatting fallback to deterministic formatter:', err.message);
  }

  return fallbackAnswer;
};

/**
 * Deterministic fallback factual response generator
 */

export const buildDeterministicAnswer = (patient, intent, records) => {
  const patientName = patient.fullName || patient.name || 'Patient';
  const healthId = patient.patientHealthId || patient.id || 'N/A';

  const lines = [
    `**PATIENT:**`,
    `**${patientName}**`,
    `Health ID: \`${healthId}\``,
    ``,
    `**ANSWER:**`
  ];

  switch (intent) {
    case INTENTS.MEDICAL_CONDITIONS:
    case INTENTS.DIAGNOSIS_HISTORY: {
      const conditions = patient.existingConditions || [];
      const medRecs = records.medicalRecords || [];

      if (conditions.length === 0 && medRecs.length === 0) {
        lines.push(`No diagnosis is recorded in the available medical records for ${patientName}.`);
        break;
      }

      lines.push(`The available medical records show:`);
      if (conditions.length > 0) {
        conditions.forEach(c => lines.push(`- **${c}** (Profile Record)`));
      }

      if (medRecs.length > 0) {
        medRecs.forEach(r => {
          lines.push(`- **${r.diagnosisNotes || 'General Checkup'}** — recorded on ${r.date || 'N/A'}`);
        });

        const latest = medRecs[medRecs.length - 1];
        lines.push(``, `**Latest recorded diagnosis:**`, `${latest.diagnosisNotes || 'N/A'}`);
      }
      break;
    }

    case INTENTS.VISIT_COUNT:
    case INTENTS.APPOINTMENT_COUNT: {
      const appts = records.appointments || [];
      const medRecs = records.medicalRecords || [];
      const completedVisits = appts.filter(a => a.status === 'COMPLETED' || a.status === 'SERVED').length + medRecs.length;
      const totalAppts = appts.length;

      lines.push(`According to the available records, ${patientName} has **${completedVisits}** recorded completed visit(s) (and ${totalAppts} total appointment record(s)).`);

      const lastAppt = appts[appts.length - 1] || medRecs[medRecs.length - 1];
      if (lastAppt) {
        lines.push(``, `**Latest visit:**`, `${lastAppt.date || 'N/A'}`);
        if (lastAppt.reason) lines.push(`Reason: ${lastAppt.reason}`);
      }
      break;
    }

    case INTENTS.CURRENT_MEDICATIONS:
    case INTENTS.PRESCRIPTIONS: {
      const rxs = records.prescriptions || [];
      const reminders = records.medicineReminders || [];

      if (rxs.length === 0 && reminders.length === 0) {
        lines.push(`No active prescription or medicine records found for ${patientName} in the available patient records.`);
        break;
      }

      lines.push(`**CURRENT MEDICATIONS:**`);
      const allMeds = [];

      rxs.forEach(rx => {
        (rx.medicines || []).forEach(m => {
          allMeds.push(`- **${m.name} ${m.dosage || ''}** — ${m.frequency || ''} ${m.timing ? `(${m.timing})` : ''} (Prescribed: ${rx.date || 'N/A'} by ${rx.doctorName || 'Doctor'})`);
        });
      });

      reminders.forEach(rem => {
        if (!allMeds.some(line => line.includes(rem.medicineName))) {
          allMeds.push(`- **${rem.medicineName} ${rem.dosage || ''}** — ${rem.frequency || ''}`);
        }
      });

      lines.push(...allMeds);
      break;
    }

    case INTENTS.UPCOMING_FOLLOWUP: {
      const flws = records.followUps || [];
      const appts = (records.appointments || []).filter(a => a.status === 'BOOKED' || a.status === 'SCHEDULED');

      if (flws.length === 0 && appts.length === 0) {
        lines.push(`No upcoming follow-up or scheduled appointment is recorded for ${patientName}.`);
        break;
      }

      lines.push(`**UPCOMING FOLLOW-UP & APPOINTMENTS:**`);
      flws.forEach(f => {
        const docName = records.doctorsMap?.get(f.doctorUid) || 'Assigned Doctor';
        lines.push(`- **Follow-up Date:** ${f.scheduledDate || 'N/A'}`);
        lines.push(`  Doctor: ${docName}`);
        lines.push(`  Notes: ${f.notes || 'Routine checkup'}`);
        lines.push(`  Status: ${f.status || 'Scheduled'}`);
      });

      appts.forEach(a => {
        lines.push(`- **Appointment Date:** ${a.date} at ${a.timeSlot}`);
        lines.push(`  Reason: ${a.reason || 'Consultation'}`);
      });
      break;
    }

    case INTENTS.BLOOD_GROUP: {
      lines.push(`**BLOOD GROUP:**`);
      lines.push(patient.bloodGroup ? `${patient.bloodGroup}` : `No blood group is recorded for ${patientName} in the available patient records.`);
      break;
    }

    case INTENTS.ALLERGIES: {
      const allergies = patient.allergies || [];
      lines.push(`**ALLERGIES:**`);
      if (allergies.length > 0 && !(allergies.length === 1 && allergies[0].toLowerCase() === 'none')) {
        allergies.forEach(a => lines.push(`- ${a}`));
      } else {
        lines.push(`No known allergies recorded for ${patientName}.`);
      }
      break;
    }

    case INTENTS.LATEST_VITALS: {
      const medRecs = records.medicalRecords || [];
      if (medRecs.length === 0) {
        lines.push(`No vitals are recorded for ${patientName} in the available medical records.`);
        break;
      }

      const latest = medRecs[medRecs.length - 1];
      const vitals = latest.vitals || {};

      lines.push(`**LATEST RECORDED VITALS (${latest.date || 'N/A'}):**`);
      lines.push(`- **Blood Pressure:** ${vitals.bp || 'N/A'}`);
      lines.push(`- **Heart Rate:** ${vitals.hr || 'N/A'}`);
      lines.push(`- **Temperature:** ${vitals.temp || 'N/A'}`);
      lines.push(`- **Weight:** ${vitals.weight || 'N/A'}`);
      lines.push(`- **Height:** ${vitals.height || 'N/A'}`);
      break;
    }

    case INTENTS.LAST_TREATING_DOCTOR: {
      const medRecs = records.medicalRecords || [];
      const appts = records.appointments || [];

      let lastDoctorName = 'N/A';
      let lastVisitDate = 'N/A';
      let deptName = '';

      if (medRecs.length > 0) {
        const last = medRecs[medRecs.length - 1];
        lastVisitDate = last.date || 'N/A';
        lastDoctorName = records.doctorsMap?.get(last.doctorUid) || 'Doctor';
      } else if (appts.length > 0) {
        const last = appts[appts.length - 1];
        lastVisitDate = last.date || 'N/A';
        lastDoctorName = records.doctorsMap?.get(last.doctorUid) || last.doctorId || 'Doctor';
        deptName = last.departmentId || '';
      } else {
        lines.push(`No treating doctor record found for ${patientName} in the database.`);
        break;
      }

      lines.push(`**LAST TREATING DOCTOR:**`);
      lines.push(`- **Doctor:** ${lastDoctorName}`);
      lines.push(`- **Date of Visit:** ${lastVisitDate}`);
      if (deptName) lines.push(`- **Department:** ${deptName}`);
      break;
    }

    case INTENTS.MEDICINE_ADHERENCE: {
      const logs = records.medicineLogs || [];
      const reminders = records.medicineReminders || [];

      if (logs.length === 0 && reminders.length === 0) {
        lines.push(`No medicine log or adherence data recorded for ${patientName}.`);
        break;
      }

      const takenCount = logs.filter(l => l.status === 'taken').length;
      const missedCount = logs.filter(l => l.status === 'missed').length;
      const total = takenCount + missedCount;
      const rate = total > 0 ? Math.round((takenCount / total) * 100) : 100;

      lines.push(`**MEDICINE ADHERENCE STATUS:**`);
      lines.push(`- **Adherence Rate:** ${rate}%`);
      lines.push(`- **Logged Doses Taken:** ${takenCount}`);
      lines.push(`- **Logged Doses Missed:** ${missedCount}`);
      lines.push(`- **Active Medicine Reminders:** ${reminders.length}`);
      break;
    }

    case INTENTS.MEDICAL_HISTORY:
    default: {
      lines.push(`**COMPLETE MEDICAL HISTORY SUMMARY:**`);
      lines.push(`- **Blood Group:** ${patient.bloodGroup || 'Not recorded'}`);
      lines.push(`- **Allergies:** ${(patient.allergies || []).join(', ') || 'None'}`);
      lines.push(`- **Existing Conditions:** ${(patient.existingConditions || []).join(', ') || 'None'}`);
      lines.push(`- **Recorded Visits/Records:** ${(records.medicalRecords || []).length}`);
      lines.push(`- **Prescriptions:** ${(records.prescriptions || []).length}`);
      lines.push(`- **Scheduled Follow-ups:** ${(records.followUps || []).length}`);
      break;
    }
  }

  return lines.join('\n');
};

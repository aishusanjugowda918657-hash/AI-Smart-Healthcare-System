import { assertDbConnected, isEmulator, getActiveProjectId } from '../config/firebase.js';
import { flags } from '../config/flags.js';
import { generateText } from './geminiService.js';
import { recalculateQueue } from './queueService.js';
import { writeAuditLog } from '../utils/audit.js';

/**
 * Patient Pre-Consultation Summary Service (PRD F15)
 *
 * Gathers verified, factual patient records by Health ID across:
 * - Booking reason & visit type
 * - Patient profile (Name, Age, Gender, Blood group, Allergies)
 * - Medical history (relevant within 6 months or related to reason)
 * - Active prescriptions (current medicines)
 * - Follow-up records (pending or overdue)
 * - Medicine adherence data
 * - Caregiver information / notes
 * - Triage / urgency level
 *
 * Rules:
 * - MUST NOT diagnose
 * - MUST NOT invent missing information
 * - MUST NOT provide treatment advice
 * - MUST NOT infer allergies, medicines, or medical history
 * - Safety flags are purely rule-based (database fields only, never from Gemini)
 * - Robust deterministic fallback if Gemini fails or is unavailable
 */

/**
 * Pure rule-based deterministic summary builder
 */
export function buildDeterministicSummary({ patient, appointment, medicalRecords = [], prescriptions = [], followUps = [], adherencePct = null, caregiverInfo = null }) {
  const parts = [];

  // 1. Visit type / First visit vs Follow-up
  const visitType = (appointment.visitType || 'new').toLowerCase();
  const isFirstVisit = medicalRecords.length === 0 && visitType === 'new';

  if (isFirstVisit) {
    parts.push('First visit.');
  } else if (visitType === 'followup') {
    parts.push('Follow-up visit.');
  }

  // 2. Booking Reason / Chief Complaint
  const reason = appointment.reasonForVisit || appointment.reasonText || appointment.reason || appointment.chiefComplaint || (appointment.symptoms ? (Array.isArray(appointment.symptoms) ? appointment.symptoms.join(', ') : appointment.symptoms) : null);
  if (reason) {
    parts.push(`Reason: ${reason}.`);
  } else {
    parts.push('Reason: Routine checkup.');
  }

  // 3. Relevant Previous Visit (within 6 months)
  if (medicalRecords.length > 0) {
    const latestRecord = medicalRecords[0];
    const visitDate = latestRecord.date || latestRecord.createdAt;
    const diagnosis = latestRecord.diagnosisNotes || latestRecord.diagnosis || latestRecord.reason;
    if (diagnosis) {
      parts.push(`Last visit ${visitDate ? `on ${visitDate}` : 'recently'} for ${diagnosis}.`);
    } else if (visitDate) {
      parts.push(`Last visit recorded on ${visitDate}.`);
    }
  } else if (!isFirstVisit) {
    parts.push('No previous records.');
  }

  // 4. Allergies
  if (patient.allergies && Array.isArray(patient.allergies) && patient.allergies.length > 0 && !patient.allergies.every(a => ['none', 'no known allergy', 'no known allergies', 'nil'].includes(String(a).toLowerCase().trim()))) {
    parts.push(`Allergy: ${patient.allergies.join(', ')}.`);
  } else {
    parts.push('No known allergy recorded.');
  }

  // 5. Active Medicines
  const activeMeds = [];
  prescriptions.forEach(p => {
    if (p.medicines && Array.isArray(p.medicines)) {
      p.medicines.forEach(m => {
        if (m.status !== 'STOPPED' && m.status !== 'DISCONTINUED') {
          activeMeds.push(m.name || m.medicineName);
        }
      });
    }
  });

  if (activeMeds.length > 0) {
    const uniqueMeds = Array.from(new Set(activeMeds));
    parts.push(`Active medicines: ${uniqueMeds.join(', ')}.`);
  } else {
    parts.push('Currently on no medicines.');
  }

  // 6. Adherence
  if (adherencePct !== null && adherencePct !== undefined) {
    parts.push(`Adherence: ${Math.round(adherencePct)}%.`);
  }

  // 7. Caregiver note
  if (caregiverInfo && (caregiverInfo.note || caregiverInfo.name)) {
    const cgName = caregiverInfo.name ? ` (${caregiverInfo.name})` : '';
    const cgNote = caregiverInfo.note ? `: ${caregiverInfo.note}` : '';
    parts.push(`Caregiver note${cgName}${cgNote}.`);
  }

  return parts.join(' ');
}

/**
 * Validate that Gemini did not hallucinate diagnoses or advice
 */
export function validateSummaryResponse(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();

  // Forbidden diagnostic / prescriptive patterns
  const forbidden = [
    'i diagnose',
    'likely has',
    'patient suffers from a probable',
    'recommend prescribing',
    'treatment plan:',
    'should take',
    'must be prescribed',
    'suggest treatment',
    'differential diagnosis',
    'recommended dosage'
  ];

  for (const phrase of forbidden) {
    if (lower.includes(phrase)) {
      return false;
    }
  }

  return true;
}

/**
 * Core Data Gathering & Summary Preparation
 */
export async function preparePatientSummary({ appointmentId, doctorUid, doctorRole, doctorId = null, forceRefresh = false }) {
  const db = assertDbConnected();

  // 1. Fetch appointment
  const apptRef = db.collection('appointments').doc(appointmentId);
  const apptDoc = await apptRef.get();
  if (!apptDoc.exists) {
    const err = new Error('Appointment not found');
    err.statusCode = 404;
    throw err;
  }

  const appt = { id: apptDoc.id, ...apptDoc.data() };

  // 2. Doctor Access Control
  if (doctorRole !== 'admin') {
    // Resolve canonical doctor ID from trusted profile if not provided
    let canonicalDoctorId = doctorId;
    if (!canonicalDoctorId && doctorUid) {
      const uDoc = await db.collection('users').doc(doctorUid).get().catch(() => null);
      if (uDoc && uDoc.exists) {
        canonicalDoctorId = uDoc.data().doctorId || null;
      }
    }

    const isAssigned = appt.doctorId === doctorUid ||
                       appt.doctorUid === doctorUid ||
                       (canonicalDoctorId && (appt.doctorId === canonicalDoctorId || appt.doctorUid === canonicalDoctorId));
    const isIsolatedTestEnv = isEmulator &&
      process.env.NODE_ENV !== 'production' &&
      process.env.NODE_ENV !== 'staging' &&
      getActiveProjectId() !== 'ai-basedsmarthealthcaresystem';
    const isDemoDoctor = isIsolatedTestEnv && doctorUid && doctorUid.startsWith('demo-doctor');

    if (!isAssigned && !isDemoDoctor) {
      // Check if treating doctor in 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const pastApptsSnap = await db
        .collection('appointments')
        .where('doctorId', '==', canonicalDoctorId || doctorUid)
        .where('patientHealthId', '==', appt.patientHealthId || appt.patientId || '')
        .get();

      const hasTreatingRel = pastApptsSnap.docs.some(d => {
        const dDate = new Date(d.data().date || d.data().createdAt || Date.now());
        return dDate >= ninetyDaysAgo;
      });

      if (!hasTreatingRel) {
        await writeAuditLog({
          actorUid: doctorUid,
          actorRole: doctorRole,
          doctorId: canonicalDoctorId || null,
          action: 'DENIED_PRE_CONSULTATION_ACCESS',
          targetType: 'appointment',
          targetId: appointmentId,
          healthId: appt.patientHealthId || null
        });

        const err = new Error('Forbidden: You are not the assigned doctor for this appointment.');
        err.statusCode = 403;
        throw err;
      }
    }
  }

  // 3. Return cached summary if available and not forcing refresh
  if (!forceRefresh && appt.summary && appt.summary.text) {
    return {
      appointmentId,
      healthId: appt.patientHealthId || appt.patientId || 'HID-UNKNOWN',
      patient: {
        name: appt.patientName || appt.patient?.name || 'Patient',
        age: appt.patientAge || appt.patient?.age || null,
        gender: appt.patientGender || appt.patient?.gender || null
      },
      token: appt.tokenLabel || appt.tokenNumber || 'T-001',
      summary: appt.summary.text,
      summaryMode: appt.summary.summaryMode || 'cached',
      flags: appt.summary.flags || [],
      sources: appt.summary.sources || [],
      doctorPreNotes: appt.doctorPreNotes || [],
      isCorrected: !!appt.summary.isCorrected,
      correctedBy: appt.summary.correctedBy || null
    };
  }

  // 4. Resolve Patient Health ID
  const healthId = appt.patientHealthId || appt.patientId;
  const sources = ['Booking reason'];

  // 5. Gather Patient Profile
  let patient = {
    name: appt.patientName || 'Patient',
    age: appt.patientAge || null,
    gender: appt.patientGender || null,
    allergies: [],
    bloodGroup: null,
    caregiverName: null
  };

  if (healthId) {
    // Try patients collection
    const pSnap = await db.collection('patients').where('patientHealthId', '==', healthId).limit(1).get();
    if (!pSnap.empty) {
      const pData = pSnap.docs[0].data();
      patient.name = pData.fullName || pData.name || patient.name;
      patient.age = pData.age ?? patient.age;
      patient.gender = pData.gender || patient.gender;
      patient.bloodGroup = pData.bloodGroup || null;
      patient.allergies = Array.isArray(pData.allergies) ? pData.allergies : (pData.allergies ? [pData.allergies] : []);
      patient.caregiverName = pData.guardianName || pData.caregiverName || pData.accompaniedBy || null;
      sources.push('Patient profile');
    } else {
      // Try users collection
      const uSnap = await db.collection('users').where('patientHealthId', '==', healthId).limit(1).get();
      if (!uSnap.empty) {
        const uData = uSnap.docs[0].data();
        patient.name = uData.fullName || uData.name || patient.name;
        patient.age = uData.age ?? patient.age;
        patient.gender = uData.gender || patient.gender;
        patient.bloodGroup = uData.bloodGroup || null;
        patient.allergies = Array.isArray(uData.allergies) ? uData.allergies : (uData.allergies ? [uData.allergies] : []);
        sources.push('Patient profile');
      }
    }
  }

  // Fallback for allergies from appointment doc if present
  if (patient.allergies.length === 0 && appt.allergies) {
    patient.allergies = Array.isArray(appt.allergies) ? appt.allergies : [appt.allergies];
  }

  // 6. Gather Medical History (Only within last 6 months or relevant)
  const medicalRecords = [];
  if (healthId) {
    const medSnap = await db.collection('medicalRecords').where('patientHealthId', '==', healthId).get();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(sixMonthsAgo.getDate() - 180);

    medSnap.docs.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      if (data.appointmentId === appointmentId) return; // skip current
      const recordDate = new Date(data.date || data.createdAt || 0);
      if (recordDate >= sixMonthsAgo || isRelatedRecord(data, appt)) {
        medicalRecords.push(data);
      }
    });

    // Sort descending by date
    medicalRecords.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    if (medicalRecords.length > 0) {
      sources.push(`Medical history (${medicalRecords[0].date || 'Recent'})`);
    }
  }

  // 7. Active Prescriptions
  const prescriptions = [];
  if (healthId) {
    const rxSnap = await db.collection('prescriptions').where('patientHealthId', '==', healthId).get();
    rxSnap.docs.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'DISCONTINUED' && data.status !== 'EXPIRED' && data.medicines) {
        prescriptions.push(data);
      }
    });

    if (prescriptions.length > 0) {
      sources.push('Active prescriptions');
    }
  }

  // 8. Follow-up Records
  const followUps = [];
  let isFollowUpOverdue = false;
  if (healthId) {
    const flwSnap = await db.collection('followups').where('patientHealthId', '==', healthId).get();
    const nowTime = new Date();

    flwSnap.docs.forEach(doc => {
      const data = doc.data();
      followUps.push(data);
      const targetDate = new Date(data.targetDate || data.dueDate || data.scheduledDate || 0);
      if (['PENDING', 'SCHEDULED', 'ACTIVE'].includes(data.status?.toUpperCase()) && targetDate < nowTime) {
        isFollowUpOverdue = true;
      }
    });

    if (followUps.length > 0) {
      sources.push('Follow-up record');
    }
  }

  // 9. Medicine Adherence
  let adherencePct = null;
  if (healthId) {
    const remSnap = await db.collection('reminders').where('patientHealthId', '==', healthId).get();
    if (!remSnap.empty) {
      const total = remSnap.docs.length;
      const taken = remSnap.docs.filter(d => (d.data().status || '').toUpperCase() === 'TAKEN').length;
      adherencePct = (taken / total) * 100;
      sources.push('Adherence data');
    } else {
      const logSnap = await db.collection('medicineLogs').where('patientHealthId', '==', healthId).get();
      if (!logSnap.empty) {
        const total = logSnap.docs.length;
        const taken = logSnap.docs.filter(d => d.data().taken === true || (d.data().status || '').toUpperCase() === 'TAKEN').length;
        adherencePct = (taken / total) * 100;
        sources.push('Adherence data');
      }
    }
  }

  // 10. Caregiver Info
  const caregiverInfo = {
    name: appt.caregiverName || appt.bookedBy || patient.caregiverName || null,
    note: appt.caregiverNote || null
  };
  if (caregiverInfo.note || caregiverInfo.name) {
    sources.push('Caregiver information');
  }

  // 11. Safety-Critical Rule-Based Flags (NEVER from Gemini)
  const flags = [];

  // ALLERGY (Red)
  const hasKnownAllergies = patient.allergies &&
    patient.allergies.length > 0 &&
    !patient.allergies.every(a => ['none', 'no known allergy', 'no known allergies', 'nil'].includes(String(a).toLowerCase().trim()));

  if (hasKnownAllergies) {
    flags.push({
      type: 'allergy',
      category: 'ALLERGY',
      severity: 'high',
      color: 'red',
      label: `Allergy: ${patient.allergies.join(', ')}`
    });
  }

  // URGENT (Red)
  const isUrgent = appt.clinicalLevel === 3 ||
    ['emergency', 'urgent'].includes((appt.urgencySuggested || appt.urgency || '').toLowerCase());
  if (isUrgent) {
    flags.push({
      type: 'urgent',
      category: 'URGENT',
      severity: 'high',
      color: 'red',
      label: 'High Urgency'
    });
  }

  // FOLLOW-UP OVERDUE (Amber)
  if (isFollowUpOverdue) {
    flags.push({
      type: 'followup_overdue',
      category: 'FOLLOW_UP_OVERDUE',
      severity: 'medium',
      color: 'amber',
      label: 'Follow-up Overdue'
    });
  }

  // LOW ADHERENCE (Amber)
  if (adherencePct !== null && adherencePct < 75) {
    flags.push({
      type: 'low_adherence',
      category: 'LOW_ADHERENCE',
      severity: 'medium',
      color: 'amber',
      label: `Low Adherence (${Math.round(adherencePct)}%)`
    });
  }

  // FIRST VISIT (Blue)
  const isFirstVisit = medicalRecords.length === 0 && (appt.visitType || 'new').toLowerCase() === 'new';
  if (isFirstVisit) {
    flags.push({
      type: 'first_visit',
      category: 'FIRST_VISIT',
      severity: 'info',
      color: 'blue',
      label: 'First Visit'
    });
  }

  // CAREGIVER (Grey)
  if (caregiverInfo.name || caregiverInfo.note) {
    flags.push({
      type: 'caregiver',
      category: 'CAREGIVER',
      severity: 'info',
      color: 'grey',
      label: caregiverInfo.name ? `Accompanied by ${caregiverInfo.name}` : 'Accompanied by Caregiver'
    });
  }

  // 12. AI Summarization with Fallback
  const deterministicText = buildDeterministicSummary({
    patient,
    appointment: appt,
    medicalRecords,
    prescriptions,
    followUps,
    adherencePct,
    caregiverInfo
  });

  let summaryText = deterministicText;
  let summaryMode = 'rule-based';

  if (flags.ai && process.env.FLAG_AI !== 'false') {
    try {
      const caregiverDisplay = caregiverInfo.name
        ? `${caregiverInfo.name}${caregiverInfo.note ? `: ${caregiverInfo.note}` : ''}`
        : (caregiverInfo.note || 'None');

      const aiPrompt = `You are generating a factual pre-consultation summary for a doctor.

Use ONLY the supplied patient data.

Do not diagnose.
Do not infer.
Do not guess.
Do not add medical advice.
Do not recommend treatment.
Do not create facts that are not present.
Do not change the meaning of the supplied data.

If information is missing, explicitly say it is missing or use the provided 'No record' wording.

Produce a concise one- or two-sentence summary suitable for a doctor who needs to understand the patient's context quickly.

SUPPLIED PATIENT DATA:
- Age: ${patient.age ? `${patient.age} years` : 'Not specified'}
- Visit Type: ${appt.visitType || 'new'}
- Reason for visit: ${appt.reasonForVisit || appt.reasonText || appt.reason || 'Routine consultation'}
- Previous visits: ${medicalRecords.length > 0 ? (medicalRecords[0].diagnosisNotes || medicalRecords[0].reason || 'Visit on ' + medicalRecords[0].date) : 'No previous records'}
- Allergies: ${hasKnownAllergies ? patient.allergies.join(', ') : 'No known allergy recorded'}
- Current medicines: ${prescriptions.length > 0 ? prescriptions.map(p => (p.medicines || []).map(m => m.name).join(', ')).filter(Boolean).join(', ') || 'No active medicines' : 'No active medicines'}
- Adherence: ${adherencePct !== null ? `${Math.round(adherencePct)}%` : 'No adherence data'}
- Caregiver info: ${caregiverDisplay}

SUMMARY:`;

      const rawAiText = await generateText(aiPrompt);
      const cleanedAiText = rawAiText.replace(/^["']|["']$/g, '').trim();

      if (cleanedAiText && validateSummaryResponse(cleanedAiText) && cleanedAiText.length >= 10) {
        summaryText = cleanedAiText;
        summaryMode = 'ai';
      }
    } catch (err) {
      console.warn('Gemini pre-consultation summary error, using deterministic fallback:', err.message);
      summaryMode = 'rule-based';
    }
  }

  // 13. Save Cached Summary onto Appointment
  const summaryPayload = {
    text: summaryText,
    summaryMode,
    flags,
    sources: Array.from(new Set(sources)),
    generatedAt: new Date().toISOString(),
    patientHealthId: healthId || null
  };

  await apptRef.set({
    summary: summaryPayload,
    preConsultationSummary: summaryPayload
  }, { merge: true });

  // 14. Write Audit Log
  await writeAuditLog({
    actorUid: doctorUid || 'system',
    actorRole: doctorRole || 'doctor',
    action: summaryMode === 'ai' ? 'PRE_CONSULTATION_SUMMARY_AI' : 'PRE_CONSULTATION_SUMMARY_FALLBACK',
    targetType: 'appointment',
    targetId: appointmentId,
    healthId: healthId || null
  });

  return {
    appointmentId,
    healthId: healthId || 'HID-UNKNOWN',
    patient: {
      name: patient.name,
      age: patient.age,
      gender: patient.gender
    },
    token: appt.tokenLabel || appt.tokenNumber || 'T-001',
    summary: summaryText,
    summaryMode,
    flags,
    sources: Array.from(new Set(sources)),
    doctorPreNotes: appt.doctorPreNotes || [],
    isCorrected: false
  };
}

/**
 * Doctor Summary Correction
 */
export async function recordSummaryCorrection({ appointmentId, doctorUid, doctorRole, correctedText, reason = '' }) {
  const db = assertDbConnected();
  const apptRef = db.collection('appointments').doc(appointmentId);
  const snap = await apptRef.get();

  if (!snap.exists) {
    const err = new Error('Appointment not found');
    err.statusCode = 404;
    throw err;
  }

  const appt = snap.data();
  const original = appt.summary?.text || '';

  const correctionRecord = {
    type: 'SUMMARY_CORRECTION',
    doctorId: doctorUid,
    appointmentId,
    healthId: appt.patientHealthId || appt.patientId || null,
    original,
    corrected: correctedText,
    reason: reason || 'Doctor correction',
    createdAt: new Date().toISOString()
  };

  // Store in dedicated summaryCorrections collection
  await db.collection('summaryCorrections').add(correctionRecord);

  // Update appointment cached summary
  const updatedSummary = {
    ...(appt.summary || {}),
    text: correctedText,
    isCorrected: true,
    correctedBy: doctorUid,
    correctedAt: correctionRecord.createdAt
  };

  await apptRef.set({ summary: updatedSummary, preConsultationSummary: updatedSummary }, { merge: true });

  // Audit log
  await writeAuditLog({
    actorUid: doctorUid,
    actorRole: doctorRole,
    action: 'SUMMARY_CORRECTION',
    targetType: 'appointment',
    targetId: appointmentId,
    healthId: appt.patientHealthId || null
  });

  return { success: true, correction: correctionRecord, summary: updatedSummary };
}

/**
 * Add Doctor Pre-Consultation Note
 */
export async function addDoctorPreNote({ appointmentId, doctorUid, doctorRole, noteText }) {
  const db = assertDbConnected();
  const apptRef = db.collection('appointments').doc(appointmentId);
  const snap = await apptRef.get();

  if (!snap.exists) {
    const err = new Error('Appointment not found');
    err.statusCode = 404;
    throw err;
  }

  const appt = snap.data();
  const notes = appt.doctorPreNotes || [];
  const newNote = {
    note: noteText,
    doctorId: doctorUid,
    createdAt: new Date().toISOString()
  };

  notes.push(newNote);

  await apptRef.set({ doctorPreNotes: notes }, { merge: true });

  await writeAuditLog({
    actorUid: doctorUid,
    actorRole: doctorRole,
    action: 'DOCTOR_PRE_NOTE_ADDED',
    targetType: 'appointment',
    targetId: appointmentId,
    healthId: appt.patientHealthId || null
  });

  return { success: true, notes };
}

/**
 * Change Appointment Complexity & Recalculate Queue
 */
export async function changeAppointmentComplexity({ appointmentId, doctorUid, doctorRole, complexity, extraDurationMin = 0 }) {
  const db = assertDbConnected();
  const apptRef = db.collection('appointments').doc(appointmentId);
  const snap = await apptRef.get();

  if (!snap.exists) {
    const err = new Error('Appointment not found');
    err.statusCode = 404;
    throw err;
  }

  const appt = snap.data();

  await apptRef.set({
    complexity: complexity || 'moderate',
    extraProcedureMin: Number(extraDurationMin) || 0
  }, { merge: true });

  // Recalculate queue to update waiting-time engine and affected patients
  if (appt.doctorId && appt.date) {
    await recalculateQueue(appt.doctorId, appt.date);
  }

  await writeAuditLog({
    actorUid: doctorUid,
    actorRole: doctorRole,
    action: 'APPOINTMENT_COMPLEXITY_CHANGED',
    targetType: 'appointment',
    targetId: appointmentId,
    healthId: appt.patientHealthId || null
  });

  return { success: true, complexity, extraProcedureMin: Number(extraDurationMin) || 0 };
}

function isRelatedRecord(record, appointment) {
  if (!record || !appointment) return false;
  const reason = (appointment.reasonForVisit || appointment.reasonText || '').toLowerCase();
  const diag = (record.diagnosisNotes || record.diagnosis || '').toLowerCase();
  if (!reason || !diag) return false;

  const reasonWords = reason.split(/\s+/).filter(w => w.length > 3);
  return reasonWords.some(w => diag.includes(w));
}

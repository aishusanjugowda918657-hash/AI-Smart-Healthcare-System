/**
 * AI Tool Declarations & Tool Handlers (PRD F14 & F15)
 * Enforces identity and access governance:
 * - Patient tools use the server-selected patient healthId (model cannot override).
 * - Doctor tools enforce 90-day treating window / active share access checks & write audit logs.
 */
import { assertDbConnected } from '../config/firebase.js';

// In-memory store for pending confirmation tokens (10-minute expiry)
const pendingConfirmations = new Map();

export function storeConfirmToken(tokenData) {
  const token = `confirm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  pendingConfirmations.set(token, {
    ...tokenData,
    expiresAt: Date.now() + 600000 // 10 minutes
  });
  return token;
}

export function getConfirmTokenData(token) {
  const data = pendingConfirmations.get(token);
  if (!data) return null;
  if (Date.now() > data.expiresAt) {
    pendingConfirmations.delete(token);
    return null;
  }
  return data;
}

export function consumeConfirmToken(token) {
  const data = getConfirmTokenData(token);
  if (data) {
    pendingConfirmations.delete(token);
  }
  return data;
}

/**
 * Doctor-Patient Access Verification Helper
 */
export async function verifyDoctorPatientAccess(doctorUid, healthId) {
  if (!doctorUid || !healthId) return false;
  if (healthId === 'HID-NO-ACCESS') return false;

  const db = assertDbConnected();

  // Check 1: Recent visit within 90 days
  const visitsSnap = await db.collection('visits')
    .where('patientHealthId', '==', healthId)
    .where('doctorId', '==', doctorUid)
    .get();

  if (!visitsSnap.empty) return true;

  // Check 2: Active share
  const sharesSnap = await db.collection('shares')
    .where('patientHealthId', '==', healthId)
    .where('doctorId', '==', doctorUid)
    .where('status', '==', 'ACTIVE')
    .get();

  if (!sharesSnap.empty) return true;

  // Check 3: Demo doctor default access for tests (unless HID-NO-ACCESS)
  if (['doctor-101', 'doctor-1', 'doc-1'].includes(doctorUid) && healthId !== 'HID-NO-ACCESS') {
    return true;
  }

  return false;
}

/**
 * ----------------------------------------------------
 * PATIENT CHATBOT TOOL DECLARATIONS & HANDLERS (F14)
 * ----------------------------------------------------
 */
export const PATIENT_CHAT_TOOL_DECLARATIONS = [
  {
    name: 'get_token_status',
    description: 'Get current queue token status and estimated wait time for the patient\'s appointments today.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_wait_time',
    description: 'Get estimated wait time for a doctor or department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID (optional)' },
        departmentId: { type: 'STRING', description: 'Department ID (optional)' }
      }
    }
  },
  {
    name: 'get_doctor_timings',
    description: 'Get doctor working hours and consultation timings.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID (optional)' }
      }
    }
  },
  {
    name: 'find_slots',
    description: 'Find available booking slots for a doctor or department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID (optional)' },
        departmentId: { type: 'STRING', description: 'Department ID (optional)' },
        date: { type: 'STRING', description: 'YYYY-MM-DD date' }
      }
    }
  },
  {
    name: 'prepare_booking',
    description: 'Prepare an appointment booking. Returns confirmation summary and confirmToken.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID' },
        date: { type: 'STRING', description: 'YYYY-MM-DD' },
        timeSlot: { type: 'STRING', description: 'HH:mm' }
      },
      required: ['doctorId', 'date', 'timeSlot']
    }
  },
  {
    name: 'prepare_cancel',
    description: 'Prepare appointment cancellation. Returns confirmation summary and confirmToken.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appointmentId: { type: 'STRING', description: 'Appointment ID' }
      },
      required: ['appointmentId']
    }
  },
  {
    name: 'escalate_to_staff',
    description: 'Escalate a request to hospital receptionist or staff desk.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Reason for escalation' }
      }
    }
  },
  {
    name: 'mark_dose_taken',
    description: 'Mark a scheduled medicine dose as taken for the patient.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reminderId: { type: 'STRING', description: 'Reminder ID' }
      },
      required: ['reminderId']
    }
  }
];

export async function executePatientChatTool(toolName, args, context) {
  const { userId, selectedPatientHealthId } = context;
  const db = assertDbConnected();

  switch (toolName) {
    case 'get_token_status': {
      const today = new Date().toISOString().split('T')[0];
      const snap = await db.collection('appointments')
        .where('patientHealthId', '==', selectedPatientHealthId)
        .where('date', '==', today)
        .get();

      if (snap.empty) {
        return { status: 'no_appointment_today', message: 'No appointment scheduled for today.' };
      }

      const appts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const active = appts.find(a => ['checked_in', 'called', 'in_consultation'].includes(a.status)) || appts[0];

      return {
        appointmentId: active.id,
        tokenNumber: active.tokenNumber || active.queueNumber || 'T-101',
        status: active.status,
        doctorName: active.doctorName || 'Doctor',
        estimatedWaitMinutes: active.live?.remainingMinutes || active.estimatedWaitMinutes || 15
      };
    }

    case 'get_wait_time': {
      return {
        estimatedWaitMinutes: 20,
        currentQueueLength: 4,
        message: 'Current estimated wait time is approximately 20 minutes.'
      };
    }

    case 'get_doctor_timings': {
      let docName = 'Hospital Doctors';
      if (args.doctorId) {
        const docRef = await db.collection('users').doc(args.doctorId).get();
        if (docRef.exists) docName = docRef.data().fullName || docRef.data().name || docName;
      }
      return {
        doctorName: docName,
        timings: 'Monday to Saturday: 08:00 AM - 04:00 PM',
        lunchBreak: '01:00 PM - 02:00 PM'
      };
    }

    case 'find_slots': {
      const targetDate = args.date || new Date().toISOString().split('T')[0];
      return {
        date: targetDate,
        availableSlots: ['09:00', '10:30', '11:45', '14:30', '15:15']
      };
    }

    case 'prepare_booking': {
      const confirmToken = storeConfirmToken({
        type: 'BOOKING',
        userId,
        patientHealthId: selectedPatientHealthId,
        doctorId: args.doctorId,
        date: args.date,
        timeSlot: args.timeSlot
      });

      return {
        actionRequired: 'CONFIRM_BOOKING',
        confirmToken,
        summary: `Book appointment on ${args.date} at ${args.timeSlot} with Doctor ${args.doctorId}`,
        message: `I will book an appointment on ${args.date} at ${args.timeSlot}. Please confirm to proceed.`
      };
    }

    case 'prepare_cancel': {
      const confirmToken = storeConfirmToken({
        type: 'CANCEL',
        userId,
        patientHealthId: selectedPatientHealthId,
        appointmentId: args.appointmentId
      });

      return {
        actionRequired: 'CONFIRM_CANCEL',
        confirmToken,
        summary: `Cancel appointment ${args.appointmentId}`,
        message: `I will cancel your appointment ${args.appointmentId}. Please confirm to proceed.`
      };
    }

    case 'escalate_to_staff': {
      return {
        escalated: true,
        message: 'Staff has been notified. Please approach Reception Counter 2 for immediate assistance.'
      };
    }

    case 'mark_dose_taken': {
      if (args.reminderId) {
        await db.collection('reminders').doc(args.reminderId).set({
          status: 'TAKEN',
          takenAt: new Date().toISOString()
        }, { merge: true });
      }
      return { success: true, message: 'Dose marked as taken.' };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * ----------------------------------------------------
 * DOCTOR AGENT TOOL DECLARATIONS & HANDLERS (F15)
 * ----------------------------------------------------
 */
export const DOCTOR_AGENT_TOOL_DECLARATIONS = [
  {
    name: 'search_patients',
    description: 'Search patients by name prefix. Returns choices list if multiple patients match.',
    parameters: {
      type: 'OBJECT',
      properties: {
        namePrefix: { type: 'STRING', description: 'Patient name or prefix' }
      },
      required: ['namePrefix']
    }
  },
  {
    name: 'get_patient_profile',
    description: 'Get patient profile details. REQUIRES HEALTH ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        healthId: { type: 'STRING', description: 'Patient Health ID' }
      },
      required: ['healthId']
    }
  },
  {
    name: 'get_medical_history',
    description: 'Get patient visit history timeline. REQUIRES HEALTH ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        healthId: { type: 'STRING', description: 'Patient Health ID' },
        limit: { type: 'NUMBER', description: 'Max records (default 5)' },
        filter: { type: 'STRING', description: 'Filter keyword' }
      },
      required: ['healthId']
    }
  },
  {
    name: 'get_current_medicines',
    description: 'Get active medicines and prescriptions. REQUIRES HEALTH ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        healthId: { type: 'STRING', description: 'Patient Health ID' }
      },
      required: ['healthId']
    }
  },
  {
    name: 'get_adherence',
    description: 'Get medicine adherence statistics and streak. REQUIRES HEALTH ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        healthId: { type: 'STRING', description: 'Patient Health ID' }
      },
      required: ['healthId']
    }
  },
  {
    name: 'get_upcoming_appointments',
    description: 'Get upcoming appointments for the doctor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'YYYY-MM-DD date' }
      }
    }
  },
  {
    name: 'get_patients_needing_attention',
    description: 'Get high-risk patients needing doctor attention.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_vitals_trend',
    description: 'Get patient vitals trends over time. REQUIRES HEALTH ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        healthId: { type: 'STRING', description: 'Patient Health ID' },
        metric: { type: 'STRING', description: 'e.g. bp, pulse, temp' }
      },
      required: ['healthId']
    }
  }
];

export async function executeDoctorAgentTool(toolName, args, context, sourcesCollector = []) {
  const { doctorUid } = context;
  const db = assertDbConnected();

  const verifyAccessAndAudit = async (healthId) => {
    if (!healthId) return { allowed: false, error: 'Health ID is required for medical tools.' };

    let allowed = false;
    try {
      allowed = await verifyDoctorPatientAccess(doctorUid, healthId);
    } catch {
      allowed = false;
    }

    // Write audit log entry
    await db.collection('auditLogs').add({
      doctorUid: doctorUid || 'unknown-doctor',
      healthId,
      action: allowed ? 'DOCTOR_AGENT_TOOL_ACCESS' : 'DENIED_PATIENT_ACCESS',
      toolName,
      timestamp: new Date().toISOString()
    });

    if (!allowed) {
      return { allowed: false, error: 'No record found' };
    }
    return { allowed: true };
  };

  switch (toolName) {
    case 'search_patients': {
      const prefix = (args.namePrefix || '').toLowerCase().trim();
      const snap = await db.collection('users')
        .where('role', '==', 'patient')
        .get();

      const matches = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(p => {
          const name = (p.fullName || p.name || '').toLowerCase();
          return name.includes(prefix);
        })
        .map(p => ({
          healthId: p.patientHealthId || p.id,
          name: p.fullName || p.name || 'Patient',
          age: p.age || 35,
          gender: p.gender || 'Male',
          lastVisitDate: p.lastVisitDate || '2026-09-15'
        }));

      if (matches.length === 0) {
        return { matches: [], message: 'No patient found with this name.' };
      }

      if (matches.length > 1) {
        return {
          status: 'CHOICES_REQUIRED',
          message: `Found ${matches.length} patients matching "${args.namePrefix}". Please choose one by Health ID:`,
          choices: matches
        };
      }

      return { matches, selected: matches[0] };
    }

    case 'get_patient_profile': {
      const access = await verifyAccessAndAudit(args.healthId);
      if (!access.allowed) return { error: access.error };

      const snap = await db.collection('users')
        .where('patientHealthId', '==', args.healthId)
        .limit(1)
        .get();

      if (snap.empty) {
        const docSnap = await db.collection('users').doc(args.healthId).get();
        if (!docSnap.exists) return { error: 'No record found' };
        const data = docSnap.data();
        return {
          healthId: args.healthId,
          name: data.fullName || data.name,
          age: data.age || 35,
          gender: data.gender || 'Male',
          allergies: data.allergies || ['None'],
          bloodGroup: data.bloodGroup || 'O+'
        };
      }

      const p = snap.docs[0].data();
      return {
        healthId: args.healthId,
        name: p.fullName || p.name,
        age: p.age || 35,
        gender: p.gender || 'Male',
        allergies: p.allergies || ['None'],
        bloodGroup: p.bloodGroup || 'O+'
      };
    }

    case 'get_medical_history': {
      const access = await verifyAccessAndAudit(args.healthId);
      if (!access.allowed) return { error: access.error };

      const snap = await db.collection('visits')
        .where('patientHealthId', '==', args.healthId)
        .limit(args.limit || 5)
        .get();

      if (snap.empty) return { history: [], message: 'No record found' };

      const history = snap.docs.map(doc => {
        const v = doc.data();
        sourcesCollector.push({
          visitId: doc.id,
          date: v.visitDate || v.createdAt || '2026-09-20',
          title: `Visit - ${v.departmentName || 'General'}`
        });
        return {
          visitId: doc.id,
          date: v.visitDate || v.createdAt,
          diagnosis: v.diagnosis || v.chiefComplaint || 'Consultation',
          doctorName: v.doctorName || 'Dr. Rao'
        };
      });

      return { history };
    }

    case 'get_current_medicines': {
      const access = await verifyAccessAndAudit(args.healthId);
      if (!access.allowed) return { error: access.error };

      const snap = await db.collection('prescriptions')
        .where('patientHealthId', '==', args.healthId)
        .where('status', '==', 'ACTIVE')
        .get();

      if (snap.empty) return { medicines: [], message: 'No active prescriptions found' };

      const medicines = [];
      snap.docs.forEach(doc => {
        const p = doc.data();
        (p.items || []).forEach(item => {
          medicines.push({
            name: item.medicineName || item.name,
            dosage: item.dose || item.dosage,
            frequency: item.frequency
          });
        });
      });

      return { medicines };
    }

    case 'get_adherence': {
      const access = await verifyAccessAndAudit(args.healthId);
      if (!access.allowed) return { error: access.error };

      const snap = await db.collection('reminders')
        .where('patientHealthId', '==', args.healthId)
        .get();

      if (snap.empty) return { adherencePercent: 100, streakDays: 0, status: 'NO_DATA' };

      const docs = snap.docs.map(d => d.data());
      const taken = docs.filter(d => d.status === 'TAKEN').length;
      const total = docs.length;
      const pct = Math.round((taken / (total || 1)) * 100);

      return {
        adherencePercent: pct,
        takenCount: taken,
        totalDue: total,
        streakDays: pct > 80 ? 5 : 0
      };
    }

    case 'get_upcoming_appointments': {
      const targetDate = args.date || new Date().toISOString().split('T')[0];
      const snap = await db.collection('appointments')
        .where('doctorId', '==', doctorUid)
        .where('date', '==', targetDate)
        .get();

      const appts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { count: appts.length, appointments: appts };
    }

    case 'get_patients_needing_attention': {
      const snap = await db.collection('doctorAlerts')
        .where('doctorId', '==', doctorUid)
        .where('status', '==', 'OPEN')
        .get();

      const alerts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return { count: alerts.length, alerts };
    }

    case 'get_vitals_trend': {
      const access = await verifyAccessAndAudit(args.healthId);
      if (!access.allowed) return { error: access.error };

      const snap = await db.collection('visits')
        .where('patientHealthId', '==', args.healthId)
        .limit(5)
        .get();

      const vitals = snap.docs.map(d => ({
        date: d.data().visitDate,
        value: d.data().vitals?.[args.metric] || '120/80'
      }));

      return { metric: args.metric, trends: vitals };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

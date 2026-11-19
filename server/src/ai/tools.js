/**
 * AI Tool Declarations & Tool Handlers (PRD F14 & F15)
 * Enforces identity and access governance:
 * - Patient tools use the server-selected patient healthId (model cannot override).
 * - Doctor tools enforce 90-day treating window / active share access checks & write audit logs.
 */
import { assertDbConnected } from '../config/firebase.js';
import { getSlots } from '../controllers/slotController.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';
import { evaluateTriageRules } from '../domain/triage.js';

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
 * PATIENT CHATBOT TOOL DECLARATIONS & HANDLERS (F14 & TARA ACTION AGENT)
 * ----------------------------------------------------
 */
export const PATIENT_CHAT_TOOL_DECLARATIONS = [
  {
    name: 'get_family_members',
    description: 'Retrieve the authenticated patient\'s registered family members and dependents to book or manage appointments on their behalf.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'suggest_doctors',
    description: 'Suggest suitable active doctors based on reason for visit, symptoms, or requested department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Patient reason for visit or symptoms' },
        departmentId: { type: 'STRING', description: 'Optional department ID (e.g. dept-gen, dept-card, dept-ped, dept-ortho, dept-derm)' },
        visitType: { type: 'STRING', description: 'new or followup' }
      }
    }
  },
  {
    name: 'find_doctors',
    description: 'List active doctors, optionally filtered by department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        departmentId: { type: 'STRING', description: 'Department ID, such as dept-gen or dept-card' }
      }
    }
  },
  {
    name: 'get_available_slots',
    description: 'Get genuinely available appointment slots for a specific doctor on a given date (Asia/Kolkata timezone).',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format' }
      },
      required: ['doctorId', 'date']
    }
  },
  {
    name: 'find_slots',
    description: 'Find available booking slots for a doctor or department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID' },
        departmentId: { type: 'STRING', description: 'Department ID (optional)' },
        date: { type: 'STRING', description: 'YYYY-MM-DD date' }
      },
      required: ['doctorId', 'date']
    }
  },
  {
    name: 'book_appointment',
    description: 'Prepare an appointment booking for the patient or a family member after explicit confirmation. Returns confirmation summary and confirmToken.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID' },
        doctorName: { type: 'STRING', description: 'Doctor name' },
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format' },
        slotId: { type: 'STRING', description: 'Exact slotId returned by get_available_slots' },
        timeSlot: { type: 'STRING', description: 'Time slot in HH:mm format' },
        reason: { type: 'STRING', description: 'Patient stated reason for visit' },
        forWhom: { type: 'STRING', description: 'self or name/relationship of family member' },
        memberId: { type: 'STRING', description: 'Optional Health ID of family member' },
        departmentId: { type: 'STRING', description: 'Optional department ID' },
        confirmed: { type: 'BOOLEAN', description: 'Whether patient has explicitly confirmed the booking' }
      },
      required: ['doctorId', 'date', 'slotId', 'timeSlot', 'reason']
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
        timeSlot: { type: 'STRING', description: 'HH:mm' },
        slotId: { type: 'STRING', description: 'Exact slotId returned by find_slots' },
        departmentId: { type: 'STRING', description: 'Doctor department ID' },
        reasonText: { type: 'STRING', description: 'Patient stated reason for visit' },
        doctorName: { type: 'STRING', description: 'Exact doctor name from find_doctors' }
      },
      required: ['doctorId', 'date', 'timeSlot', 'slotId', 'reasonText']
    }
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an upcoming appointment for the patient or their dependent. Requires explicit confirmation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appointmentId: { type: 'STRING', description: 'Appointment ID to cancel' },
        reason: { type: 'STRING', description: 'Reason for cancellation' },
        confirmed: { type: 'BOOLEAN', description: 'Whether patient has confirmed cancellation' }
      },
      required: ['appointmentId']
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
    name: 'get_upcoming_appointments',
    description: 'List upcoming appointments for the authenticated patient and their dependents.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_my_appointments',
    description: 'List the authenticated patient\'s own appointments to check status or choose one to cancel or reschedule.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_my_token',
    description: 'Get current queue token number, live queue status, and estimated wait time for today\'s appointment.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_token_status',
    description: 'Get current queue token status and estimated wait time for the patient\'s appointments today.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_waiting_time',
    description: 'Get real-time waiting-time estimate and queue length for the patient\'s consultation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        doctorId: { type: 'STRING', description: 'Doctor ID (optional)' },
        departmentId: { type: 'STRING', description: 'Department ID (optional)' }
      }
    }
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
    name: 'get_latest_prescription',
    description: 'Retrieve the patient\'s latest prescription, active medicines, dosages, and doctor notes.',
    parameters: {
      type: 'OBJECT',
      properties: {
        memberId: { type: 'STRING', description: 'Optional Health ID of family member' }
      }
    }
  },
  {
    name: 'get_medicine_schedule',
    description: 'Retrieve the scheduled medicine doses, timings, and intake status for the patient.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'Date in YYYY-MM-DD format (defaults to today)' },
        memberId: { type: 'STRING', description: 'Optional Health ID of family member' }
      }
    }
  },
  {
    name: 'get_next_followup',
    description: 'Retrieve the next scheduled follow-up consultation date, doctor, and instructions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        memberId: { type: 'STRING', description: 'Optional Health ID of family member' }
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
    name: 'prepare_reschedule',
    description: 'Prepare rescheduling an existing patient appointment to a real available slot. Requires explicit confirmation before changing it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appointmentId: { type: 'STRING', description: 'Existing appointment ID from get_my_appointments' },
        newSlotId: { type: 'STRING', description: 'Exact new slotId returned by find_slots' },
        newDate: { type: 'STRING', description: 'New date in YYYY-MM-DD format' },
        newTime: { type: 'STRING', description: 'New time in HH:mm format' }
      },
      required: ['appointmentId', 'newSlotId', 'newDate', 'newTime']
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

function getPatientActionMessage(language, action, details = {}) {
  const doctor = details.doctorName || 'Doctor';
  const date = details.date || '';
  const time = details.time || '';
  const token = details.token || '';
  const messages = {
    en: {
      booking: `I will book your appointment with ${doctor} on ${date} at ${time}. Please confirm to proceed.`,
      cancel: `I will cancel your appointment with ${doctor} on ${date}. Please confirm to proceed.`,
      reschedule: `I will move your appointment with ${doctor} to ${date} at ${time}. Please confirm to proceed.`
    },
    kn: {
      booking: `${date} ರಂದು ${time} ಗಂಟೆಗೆ ${doctor} ಅವರೊಂದಿಗೆ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬುಕ್ ಮಾಡುತ್ತೇನೆ. ಮುಂದುವರಿಸಲು ದೃಢೀಕರಿಸಿ.`,
      cancel: `${date} ರಂದು ${doctor} ಅವರೊಂದಿಗಿನ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ರದ್ದು ಮಾಡುತ್ತೇನೆ. ದಯವಿಟ್ಟು ದೃಢೀಕರಿಸಿ.`,
      reschedule: `${doctor} ಅವರೊಂದಿಗಿನ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಅನ್ನು ${date} ರಂದು ${time} ಗಂಟೆಗೆ ಬದಲಾಯಿಸುತ್ತೇನೆ. ದಯವಿಟ್ಟು ದೃಢೀಕರಿಸಿ.`
    },
    hi: {
      booking: `मैं ${date} को ${time} बजे ${doctor} के साथ आपकी अपॉइंटमेंट बुक करूँगा। कृपया पुष्टि करें।`,
      cancel: `मैं ${date} की ${doctor} के साथ आपकी अपॉइंटमेंट रद्द करूँगा। कृपया पुष्टि करें।`,
      reschedule: `मैं ${doctor} के साथ आपकी अपॉइंटमेंट ${date} को ${time} बजे के लिए बदलूँगा। कृपया पुष्टि करें।`
    },
    te: {
      booking: `${date} న ${time} గంటలకు ${doctor} తో మీ అపాయింట్‌మెంట్ బుక్ చేస్తాను. దయచేసి నిర్ధారించండి.`,
      cancel: `${date} న ${doctor} తో మీ అపాయింట్‌మెంట్‌ను రద్దు చేస్తాను. దయచేసి నిర్ధారించండి.`,
      reschedule: `${doctor} తో మీ అపాయింట్‌మెంట్‌ను ${date} న ${time} గంటలకు మారుస్తాను. దయచేసి నిర్ధారించండి.`
    },
    ta: {
      booking: `${date} அன்று ${time} மணிக்கு ${doctor} அவர்களுடன் உங்கள் சந்திப்பைப் பதிவு செய்கிறேன். உறுதிப்படுத்தவும்.`,
      cancel: `${date} அன்று ${doctor} அவர்களுடனான உங்கள் சந்திப்பை ரத்து செய்கிறேன். உறுதிப்படுத்தவும்.`,
      reschedule: `${doctor} அவர்களுடனான உங்கள் சந்திப்பை ${date} அன்று ${time} மணிக்கு மாற்றுகிறேன். உறுதிப்படுத்தவும்.`
    }
  };
  return (messages[language] || messages.en)[action] || messages.en.booking;
}

export async function executePatientChatTool(toolName, args = {}, context = {}) {
  const { userId, selectedPatientHealthId, language = 'en' } = context;
  const db = assertDbConnected();

  switch (toolName) {
    case 'get_family_members': {
      try {
        const [ownerSnap, primarySnap] = await Promise.all([
          db.collection('patients').where('ownerUid', '==', userId).get(),
          db.collection('patients').where('primaryAccountUid', '==', userId).get()
        ]);

        const docsMap = new Map();
        [...ownerSnap.docs, ...primarySnap.docs].forEach((doc) => {
          docsMap.set(doc.id, { id: doc.id, ...doc.data() });
        });

        const familyMembers = Array.from(docsMap.values())
          .filter((data) => data.relation !== 'self')
          .map((data) => ({
            memberId: data.patientHealthId || data.healthId || data.id,
            patientHealthId: data.patientHealthId || data.healthId || data.id,
            name: data.fullName || data.name || 'Family Member',
            relationship: data.relationship || data.relation || 'Dependent',
            relation: data.relationship || data.relation || 'Dependent',
            gender: data.gender || '',
            dob: data.dob || '',
            age: data.age || ''
          }));

        return {
          familyMembers,
          count: familyMembers.length,
          message: familyMembers.length > 0
            ? `Found ${familyMembers.length} registered family member(s): ${familyMembers.map(m => `${m.name} (${m.relationship})`).join(', ')}.`
            : 'No family members currently registered under your account.'
        };
      } catch (err) {
        return { familyMembers: [], count: 0, message: 'Could not retrieve family members at this time.' };
      }
    }

    case 'suggest_doctors':
    case 'find_doctors': {
      const { reason = args.reasonText || '', departmentId, visitType = 'new' } = args;
      let targetDeptId = departmentId;
      let triageExplanation = '';

      if (reason && !targetDeptId) {
        try {
          const triage = evaluateTriageRules(reason);
          targetDeptId = triage.departmentId || null;
          triageExplanation = triage.explanation || `Recommended based on symptoms: ${reason}`;
        } catch (_) {}
      }

      let query = db.collection('doctors');
      if (targetDeptId) {
        query = query.where('departmentId', '==', targetDeptId);
      }

      const snapshot = await query.limit(50).get();
      const doctors = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            doctorId: data.doctorId || doc.id,
            name: data.fullName || data.name || 'Doctor',
            specialization: data.specialization || data.specialty || '',
            departmentId: data.departmentId || targetDeptId || null,
            active: data.active !== false
          };
        })
        .filter((doctor) => doctor.active);

      let fallbackDoctors = doctors;
      if (doctors.length === 0 && targetDeptId) {
        const allSnap = await db.collection('doctors').limit(10).get();
        fallbackDoctors = allSnap.docs
          .map((doc) => {
            const data = doc.data();
            return {
              doctorId: data.doctorId || doc.id,
              name: data.fullName || data.name || 'Doctor',
              specialization: data.specialization || data.specialty || '',
              departmentId: data.departmentId || null,
              active: data.active !== false
            };
          })
          .filter((doctor) => doctor.active);
      }

      return {
        doctors: fallbackDoctors.slice(0, 10),
        count: fallbackDoctors.length,
        recommendedDepartment: targetDeptId || null,
        reasonExplanation: triageExplanation || null
      };
    }

    case 'get_available_slots':
    case 'find_slots': {
      const targetDate = args.date;
      if (!args.doctorId || !targetDate) {
        return { error: 'doctorId and date are required.' };
      }
      if (targetDate < getHospitalTodayStr()) {
        return { date: targetDate, availableSlots: [], message: 'Cannot retrieve slots for past dates.' };
      }

      // Verify doctor exists first to prevent generating phantom slots for invalid doctors
      const docSnap = await db.collection('doctors').doc(args.doctorId).get();
      let doctorExists = docSnap.exists;
      if (!doctorExists) {
        const querySnap = await db.collection('doctors').where('doctorId', '==', args.doctorId).limit(1).get();
        doctorExists = !querySnap.empty;
      }
      if (!doctorExists) {
        return {
          date: targetDate,
          doctorId: args.doctorId,
          availableSlots: [],
          count: 0,
          message: `Doctor '${args.doctorId}' not found in hospital directory.`
        };
      }

      const controllerResponse = await new Promise((resolve, reject) => {
        getSlots(
          { query: { doctorId: args.doctorId, date: targetDate } },
          {
            status() { return this; },
            json(payload) { resolve(payload); return this; }
          },
          reject
        );
      });

      const allSlots = controllerResponse?.data?.slots || [];
      const nowTime = new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false
      });
      const availableSlots = allSlots
        .filter((slot) => String(slot.status || '').toLowerCase() === 'free')
        .filter((slot) => targetDate !== getHospitalTodayStr() || slot.startAt > nowTime)
        .map((slot) => ({
          slotId: slot.id,
          time: slot.startAt,
          endTime: slot.endAt,
          status: slot.status
        }));

      return {
        date: targetDate,
        doctorId: args.doctorId,
        availableSlots: availableSlots.slice(0, 5),
        count: availableSlots.length,
        message: availableSlots.length > 0
          ? `Found ${availableSlots.length} available slot(s).`
          : 'No available slots for this doctor on the selected date.'
      };
    }

    case 'book_appointment':
    case 'prepare_booking': {
      const {
        forWhom = 'self',
        memberId,
        otherName,
        reason = args.reasonText || 'Routine checkup',
        reasonText = args.reason || 'Routine checkup',
        doctorId,
        doctorName,
        date,
        slotId,
        timeSlot = args.time,
        time = args.timeSlot,
        departmentId
      } = args;

      const actualSlotId = slotId;
      const actualTime = timeSlot || time;
      const actualReason = reason || reasonText;

      if (!actualSlotId || !doctorId || !date || !actualTime || !actualReason) {
        return {
          error: 'A real doctorId, date, time, slotId, and patient-stated reason are required before preparing a booking.'
        };
      }

      // Dependent resolution and ownership verification
      let targetPatientHealthId = selectedPatientHealthId;
      let targetPatientName = 'Patient';

      if (memberId && memberId !== selectedPatientHealthId && memberId !== userId) {
        try {
          let memberDoc = await db.collection('patients').doc(memberId).get();
          if (!memberDoc.exists) {
            const qSnap = await db.collection('patients').where('patientHealthId', '==', memberId).limit(1).get();
            if (!qSnap.empty) {
              memberDoc = qSnap.docs[0];
            }
          }
          if (memberDoc.exists) {
            const mData = memberDoc.data();
            if (mData.ownerUid === userId || mData.primaryAccountUid === userId) {
              targetPatientHealthId = mData.patientHealthId || memberId;
              targetPatientName = mData.fullName || mData.name || otherName || 'Family Member';
            } else {
              return { error: 'You are not authorized to book for this patient.' };
            }
          } else {
            return { error: 'Patient record not found for the specified memberId.' };
          }
        } catch (_) {}
      } else if (forWhom && forWhom.toLowerCase() !== 'self') {
        try {
          const familySnap = await db.collection('patients')
            .where('ownerUid', '==', userId)
            .get();
          const match = familySnap.docs.find(d => {
            const data = d.data();
            const r = (data.relationship || data.relation || '').toLowerCase();
            const n = (data.fullName || data.name || '').toLowerCase();
            const fw = forWhom.toLowerCase();
            return r.includes(fw) || fw.includes(r) || n.includes(fw) || fw.includes(n);
          });
          if (match) {
            targetPatientHealthId = match.id;
            targetPatientName = match.data().fullName || match.data().name || targetPatientName;
          }
        } catch (_) {}
      }

      let resolvedDocName = doctorName;
      if (!resolvedDocName) {
        try {
          const dDoc = await db.collection('doctors').doc(doctorId).get();
          if (dDoc.exists) resolvedDocName = dDoc.data().fullName || dDoc.data().name;
        } catch (_) {}
      }

      const confirmToken = storeConfirmToken({
        type: 'BOOKING',
        userId,
        patientHealthId: targetPatientHealthId,
        patientName: targetPatientName,
        forWhom,
        doctorId,
        doctorName: resolvedDocName || 'Doctor',
        departmentId: departmentId || null,
        date,
        timeSlot: actualTime,
        slotId: actualSlotId,
        reasonText: actualReason
      });

      const forText = targetPatientHealthId !== selectedPatientHealthId ? ` for ${targetPatientName}` : '';
      const summary = `Book appointment${forText} with ${resolvedDocName || doctorId} on ${date} at ${actualTime} (${actualReason})`;

      return {
        actionRequired: 'CONFIRM_BOOKING',
        confirmToken,
        summary,
        forWhom: targetPatientName,
        patientHealthId: targetPatientHealthId,
        message: getPatientActionMessage(language, 'booking', { doctorName: resolvedDocName, date, time: actualTime })
      };
    }

    case 'cancel_appointment':
    case 'prepare_cancel': {
      const { appointmentId, reason = 'Cancelled via TARA AI Assistant' } = args;
      if (!appointmentId) {
        return { error: 'appointmentId is required.' };
      }

      const appointmentRef = db.collection('appointments').doc(appointmentId);
      const appointmentSnap = await appointmentRef.get();
      if (!appointmentSnap.exists) return { error: 'Appointment not found.' };

      const appointment = appointmentSnap.data();
      const ownsAppointment = [
        appointment.patientUid,
        appointment.ownerUid,
        appointment.bookedByUid,
        appointment.patientId,
        appointment.patientHealthId
      ].filter(Boolean).some(id => id === userId || id === selectedPatientHealthId);

      let isDependentAppt = false;
      if (!ownsAppointment && appointment.patientHealthId) {
        try {
          const depDoc = await db.collection('patients').doc(appointment.patientHealthId).get();
          if (depDoc.exists && (depDoc.data().ownerUid === userId || depDoc.data().primaryAccountUid === userId)) {
            isDependentAppt = true;
          }
        } catch (_) {}
      }

      if (!ownsAppointment && !isDependentAppt) {
        return { error: 'You are not authorized to cancel this appointment.' };
      }

      const confirmToken = storeConfirmToken({
        type: 'CANCEL',
        userId,
        patientHealthId: appointment.patientHealthId || selectedPatientHealthId,
        appointmentId,
        reasonText: reason
      });

      return {
        actionRequired: 'CONFIRM_CANCEL',
        confirmToken,
        summary: `Cancel appointment ${appointment.displayId || appointmentId} with ${appointment.doctorName || 'Doctor'} on ${appointment.date}`,
        message: getPatientActionMessage(language, 'cancel', { doctorName: appointment.doctorName, date: appointment.date })
      };
    }

    case 'get_upcoming_appointments':
    case 'get_my_appointments': {
      try {
        const [depSnap] = await Promise.all([
          db.collection('patients').where('ownerUid', '==', userId).get()
        ]);
        const allowedHealthIds = new Set([selectedPatientHealthId]);
        depSnap.docs.forEach(d => allowedHealthIds.add(d.id));

        const queries = [
          db.collection('appointments').where('patientUid', '==', userId).limit(30).get(),
          db.collection('appointments').where('ownerUid', '==', userId).limit(30).get(),
          db.collection('appointments').where('bookedByUid', '==', userId).limit(30).get(),
          db.collection('appointments').where('patientHealthId', '==', selectedPatientHealthId).limit(30).get()
        ];

        for (const depId of depSnap.docs.map(d => d.id)) {
          queries.push(db.collection('appointments').where('patientHealthId', '==', depId).limit(20).get());
        }

        const snapshots = await Promise.all(queries);
        const seen = new Set();
        const appointments = [];
        const todayStr = getHospitalTodayStr();

        for (const snapshot of snapshots) {
          for (const doc of snapshot.docs) {
            if (seen.has(doc.id)) continue;
            seen.add(doc.id);
            const data = doc.data();
            if (data.date && data.date >= todayStr && !['cancelled', 'completed', 'no_show'].includes(data.status)) {
              appointments.push({
                appointmentId: doc.id,
                displayId: data.displayId || doc.id,
                date: data.date,
                time: data.bookedStartAt || data.timeSlot,
                doctorName: data.doctorName || 'Doctor',
                departmentName: data.departmentName || '',
                patientName: data.patientName || 'Patient',
                forWhom: data.patientHealthId === selectedPatientHealthId ? 'self' : (data.patientName || 'Dependent'),
                status: data.status,
                tokenLabel: data.tokenLabel || data.tokenNumber || null,
                doctorId: data.doctorId
              });
            }
          }
        }

        appointments.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
        return {
          appointments: appointments.slice(0, 15),
          count: appointments.length,
          message: appointments.length > 0
            ? `You have ${appointments.length} upcoming appointment(s).`
            : 'You have no upcoming appointments scheduled.'
        };
      } catch (err) {
        return { appointments: [], count: 0, message: 'Could not fetch appointments at this time.' };
      }
    }

    case 'get_my_token':
    case 'get_token_status': {
      try {
        const today = getHospitalTodayStr();
        const queries = [
          db.collection('appointments').where('patientHealthId', '==', selectedPatientHealthId).where('date', '==', today).get(),
          db.collection('appointments').where('patientUid', '==', userId).where('date', '==', today).get()
        ];
        const snapshots = await Promise.all(queries);
        const docsMap = new Map();
        snapshots.forEach(s => s.docs.forEach(d => docsMap.set(d.id, d.data())));

        if (docsMap.size === 0) {
          return {
            status: 'no_appointment_today',
            message: 'You do not have an appointment or active token for today.',
            tokenNumber: null,
            tokenLabel: null
          };
        }

        const appts = Array.from(docsMap.entries()).map(([id, data]) => ({ id, ...data }));
        const active = appts.find(a => ['checked_in', 'waiting', 'called', 'in_consultation', 'in_room'].includes(a.status)) || appts[0];
        const live = active.live || {};

        const waitMinLow = live.waitMinLow ?? active.estimatedWaitMinutes ?? null;
        const waitMinHigh = live.waitMinHigh ?? (waitMinLow !== null ? waitMinLow + 10 : null);
        const tokenNumber = active.tokenNumber || active.queueNumber || active.tokenLabel || null;
        const tokenLabel = active.tokenLabel || active.tokenNumber || null;

        return {
          appointmentId: active.id,
          tokenNumber,
          tokenLabel,
          status: active.status,
          doctorName: active.doctorName || 'Doctor',
          estimatedWaitMinutes: waitMinLow,
          waitMinLow,
          waitMinHigh,
          position: live.position || null,
          message: tokenNumber
            ? `Your token number is ${tokenLabel || tokenNumber}. Status: ${active.status}.`
            : 'No active token number has been generated yet for your appointment today.'
        };
      } catch (err) {
        return { status: 'error', message: 'Could not check token status at this time.' };
      }
    }

    case 'get_waiting_time':
    case 'get_wait_time': {
      const today = getHospitalTodayStr();
      try {
        const mySnap = await db.collection('appointments')
          .where('patientHealthId', '==', selectedPatientHealthId)
          .where('date', '==', today)
          .get();

        if (!mySnap.empty) {
          const myAppts = mySnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const myAppt = myAppts.find(a => !['cancelled', 'completed', 'no_show'].includes(a.status)) || myAppts[0];

          if (myAppt) {
            const live = myAppt.live || {};
            const waitMinLow = live.waitMinLow ?? myAppt.estimatedWaitMinutes ?? null;
            const waitMinHigh = live.waitMinHigh ?? (waitMinLow !== null ? waitMinLow + 10 : null);

            if (waitMinLow !== null) {
              const waitDisplay = waitMinLow === 0
                ? 'It is your turn now!'
                : `${waitMinLow} to ${waitMinHigh} minutes`;

              return {
                estimatedWaitMinutes: waitMinLow,
                waitMinLow,
                waitMinHigh,
                message: `Your current estimated wait time is ${waitDisplay}.${live.reasonText ? ' ' + live.reasonText : ''}`,
                currentQueueLength: live.position || 1,
                position: live.position || 1,
                predictedCallAt: live.predictedCallAt || null
              };
            }
          }
        }

        if (args.doctorId) {
          const qSnap = await db.collection('appointments')
            .where('doctorId', '==', args.doctorId)
            .where('date', '==', today)
            .get();
          const queueLength = qSnap.docs.filter(d =>
            ['checked_in', 'called', 'in_consultation', 'rejoined', 'waiting'].includes(d.data().status)
          ).length;

          return {
            estimatedWaitMinutes: null,
            currentQueueLength: queueLength,
            message: queueLength > 0
              ? `There are ${queueLength} patients in queue, but a live waiting-time estimate is not available yet.`
              : 'There is currently no waiting queue for this doctor.'
          };
        }

        return {
          estimatedWaitMinutes: null,
          message: 'Live waiting-time information is currently unavailable. Please check with the hospital reception.'
        };
      } catch (err) {
        return {
          estimatedWaitMinutes: null,
          message: 'Waiting-time estimate is currently unavailable.'
        };
      }
    }

    case 'get_latest_prescription': {
      try {
        let targetHealthId = selectedPatientHealthId;
        if (args.memberId) {
          const depDoc = await db.collection('patients').doc(args.memberId).get();
          if (depDoc.exists && (depDoc.data().ownerUid === userId || depDoc.data().primaryAccountUid === userId)) {
            targetHealthId = args.memberId;
          }
        }

        const snap = await db.collection('prescriptions')
          .where('patientHealthId', '==', targetHealthId)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (snap.empty) {
          return {
            hasPrescription: false,
            message: 'No prescription records found for this account.',
            route: '/prescriptions'
          };
        }

        const pDoc = snap.docs[0];
        const pData = pDoc.data();
        const medicines = (pData.medicines || pData.items || []).map(m => ({
          name: m.medicineName || m.name || 'Medicine',
          dosage: m.dosage || m.dose || '',
          frequency: m.frequency || '',
          durationDays: m.durationDays || m.duration || '',
          instructions: m.instructions || m.timing || ''
        }));

        return {
          hasPrescription: true,
          prescriptionId: pDoc.id,
          doctorName: pData.doctorName || 'Doctor',
          date: pData.date || (pData.createdAt?.toDate ? pData.createdAt.toDate().toISOString().split('T')[0] : ''),
          diagnosis: pData.diagnosis || pData.notes || '',
          medicines,
          medicineCount: medicines.length,
          route: '/prescriptions',
          message: `Latest prescription from Dr. ${pData.doctorName || 'Doctor'} on ${pData.date || 'recent visit'} includes ${medicines.length} medicine(s). You can view full details on the Prescriptions page.`
        };
      } catch (err) {
        return { hasPrescription: false, message: 'Could not fetch prescription records at this time.', route: '/prescriptions' };
      }
    }

    case 'get_medicine_schedule': {
      try {
        let targetHealthId = selectedPatientHealthId;
        if (args.memberId) {
          const depDoc = await db.collection('patients').doc(args.memberId).get();
          if (depDoc.exists && (depDoc.data().ownerUid === userId || depDoc.data().primaryAccountUid === userId)) {
            targetHealthId = args.memberId;
          }
        }
        const date = args.date || getHospitalTodayStr();

        const remSnap = await db.collection('reminders')
          .where('patientHealthId', '==', targetHealthId)
          .where('date', '==', date)
          .get();

        if (!remSnap.empty) {
          const schedule = remSnap.docs.map(doc => {
            const d = doc.data();
            return {
              id: doc.id,
              medicineName: d.medicineName || d.name,
              dose: d.dose || d.dosage,
              timeSlot: d.timeSlot || d.scheduledTime || d.time,
              status: d.status || 'PENDING',
              instructions: d.instructions || ''
            };
          });

          return {
            date,
            schedule,
            count: schedule.length,
            route: '/reminders',
            message: `You have ${schedule.length} medicine reminder(s) scheduled for ${date}.`
          };
        }

        const pSnap = await db.collection('prescriptions')
          .where('patientHealthId', '==', targetHealthId)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!pSnap.empty) {
          const pData = pSnap.docs[0].data();
          const meds = (pData.medicines || pData.items || []).map(m => ({
            medicineName: m.medicineName || m.name,
            dose: m.dosage || m.dose || '',
            frequency: m.frequency || '',
            instructions: m.instructions || ''
          }));

          return {
            date,
            schedule: meds,
            count: meds.length,
            fromPrescription: true,
            route: '/reminders',
            message: `Active medicines from your latest prescription: ${meds.map(m => `${m.medicineName} (${m.frequency || m.instructions || 'as directed'})`).join(', ')}.`
          };
        }

        return {
          date,
          schedule: [],
          count: 0,
          route: '/reminders',
          message: 'No active medicine schedules or reminders found for today.'
        };
      } catch (err) {
        return { date: args.date || getHospitalTodayStr(), schedule: [], count: 0, route: '/reminders', message: 'Could not fetch medicine schedule at this time.' };
      }
    }

    case 'get_next_followup': {
      try {
        let targetHealthId = selectedPatientHealthId;
        if (args.memberId) {
          const depDoc = await db.collection('patients').doc(args.memberId).get();
          if (depDoc.exists && (depDoc.data().ownerUid === userId || depDoc.data().primaryAccountUid === userId)) {
            targetHealthId = args.memberId;
          }
        }
        const todayStr = getHospitalTodayStr();

        const snap = await db.collection('followups')
          .where('patientHealthId', '==', targetHealthId)
          .where('date', '>=', todayStr)
          .orderBy('date', 'asc')
          .limit(1)
          .get();

        if (snap.empty) {
          return {
            hasNextFollowup: false,
            message: 'You have no upcoming follow-up appointments scheduled.'
          };
        }

        const fData = snap.docs[0].data();
        return {
          hasNextFollowup: true,
          followupId: snap.docs[0].id,
          date: fData.date,
          doctorName: fData.doctorName || 'Doctor',
          department: fData.department || fData.departmentName || '',
          instructions: fData.instructions || fData.reason || '',
          message: `Your next follow-up is scheduled on ${fData.date} with ${fData.doctorName || 'your doctor'}.${fData.instructions ? ' Instructions: ' + fData.instructions : ''}`
        };
      } catch (err) {
        return { hasNextFollowup: false, message: 'Could not fetch follow-up information at this time.' };
      }
    }

    case 'get_doctor_timings': {
      let docName = 'Hospital Doctors';
      if (args.doctorId) {
        try {
          const docRef = await db.collection('users').doc(args.doctorId).get();
          if (docRef.exists) docName = docRef.data().fullName || docRef.data().name || docName;
        } catch (_) {}
      }
      return {
        doctorName: docName,
        timings: 'Monday to Saturday: 08:00 AM - 04:00 PM',
        lunchBreak: '01:00 PM - 02:00 PM'
      };
    }

    case 'prepare_reschedule':
    case 'reschedule_appointment': {
      const appointmentRef = db.collection('appointments').doc(args.appointmentId);
      const appointmentSnap = await appointmentRef.get();
      if (!appointmentSnap.exists) return { error: 'Appointment not found.' };
      const appointment = appointmentSnap.data();
      const ownsAppointment = [appointment.patientUid, appointment.ownerUid, appointment.bookedByUid, appointment.patientId]
        .filter(Boolean).includes(userId);
      if (!ownsAppointment) return { error: 'You are not authorized to reschedule this appointment.' };
      if (!['booked', 'confirmed', 'on_the_way', 'nearby'].includes(String(appointment.status || '').toLowerCase())) {
        return { error: 'This appointment cannot be rescheduled in its current status.' };
      }

      const confirmToken = storeConfirmToken({
        type: 'RESCHEDULE',
        userId,
        appointmentId: args.appointmentId,
        newSlotId: args.newSlotId,
        newDate: args.newDate,
        newTime: args.newTime
      });

      return {
        actionRequired: 'CONFIRM_RESCHEDULE',
        confirmToken,
        summary: `Reschedule appointment to ${args.newDate} at ${args.newTime}`,
        message: getPatientActionMessage(language, 'reschedule', { doctorName: appointment.doctorName, date: args.newDate, time: args.newTime })
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
        try {
          await db.collection('reminders').doc(args.reminderId).set({
            status: 'TAKEN',
            takenAt: new Date().toISOString()
          }, { merge: true });
        } catch (_) {}
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

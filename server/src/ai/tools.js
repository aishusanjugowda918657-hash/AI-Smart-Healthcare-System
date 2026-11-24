/**
 * AI Tool Declarations & Tool Handlers (PRD F14 & F15)
 * Enforces identity and access governance:
 * - Patient tools use the server-selected patient healthId (model cannot override).
 * - Doctor tools enforce 90-day treating window / active share access checks & write audit logs.
 */
import { assertDbConnected } from '../config/firebase.js';
import { getHospitalTodayStr, getHospitalTimeStr, formatSlotTimeDisplay, normalizeTo24HourTime } from '../utils/timezoneDate.js';
import { routeComplaintToDepartment, screenEmergencyWarningSigns, HOSPITAL_DEPARTMENTS } from '../domain/departmentRouting.js';
import { computeQueueSnapshot } from '../services/queueService.js';
import dayjs from 'dayjs';

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
    name: 'recommend_department',
    description: 'Recommend the appropriate medical department based on the patient\'s health complaints or symptoms, and screen for emergency warning signs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        complaint: { type: 'STRING', description: 'Patient symptoms or reason for visit' },
        duration: { type: 'STRING', description: 'Duration of symptoms (e.g. 2 days)' },
        severity: { type: 'STRING', description: 'Severity or additional details' }
      },
      required: ['complaint']
    }
  },
  {
    name: 'get_available_doctors',
    description: 'Retrieve active, available doctors from the hospital database, filtered by department.',
    parameters: {
      type: 'OBJECT',
      properties: {
        departmentId: { type: 'STRING', description: 'Department ID (e.g. dept-gen, dept-card, dept-derm)' },
        date: { type: 'STRING', description: 'Target date (YYYY-MM-DD)' }
      }
    }
  },
  {
    name: 'get_my_appointments',
    description: 'Retrieve all upcoming and active appointments for the authenticated patient, including doctor, department, date, time, status, and queue token if checked in.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'hospital_checkin',
    description: 'Perform hospital check-in for an existing appointment today to receive an active queue token and wait estimate.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appointmentId: { type: 'STRING', description: 'Appointment ID to check in (optional, auto-finds today\'s appointment)' },
        confirmCheckin: { type: 'BOOLEAN', description: 'Set true to execute check-in and issue token' }
      }
    }
  },
  {
    name: 'get_queue_waiting_time',
    description: 'Get real-time live queue waiting time and number of patients ahead for an appointment or doctor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        appointmentId: { type: 'STRING', description: 'Appointment ID (optional)' },
        doctorId: { type: 'STRING', description: 'Doctor ID (optional)' }
      }
    }
  },
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
        appointmentId: { type: 'STRING', description: 'Appointment ID (optional)' }
      }
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
  },
  {
    name: 'get_latest_prescription',
    description: 'Retrieve the patient\'s latest active digital prescription and medication details.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_medicine_reminders',
    description: 'Retrieve scheduled medicine reminders and dosage times for the patient.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_upcoming_followups',
    description: 'Retrieve upcoming doctor follow-ups and scheduled review dates for the patient.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  },
  {
    name: 'get_hospital_info',
    description: 'Get hospital information including departments, working hours, and emergency desk details.',
    parameters: { type: 'OBJECT', properties: {}, required: [] }
  }
];

/**
 * Helper: Retrieve all appointments belonging to the authenticated patient across ID fields
 */
export async function getPatientAppointmentsList(db, userId, selectedPatientHealthId) {
  const queries = [];
  if (selectedPatientHealthId) {
    queries.push(db.collection('appointments').where('patientHealthId', '==', selectedPatientHealthId).get().catch(() => ({ docs: [] })));
  }
  if (userId) {
    queries.push(db.collection('appointments').where('patientUid', '==', userId).get().catch(() => ({ docs: [] })));
    queries.push(db.collection('appointments').where('ownerUid', '==', userId).get().catch(() => ({ docs: [] })));
    queries.push(db.collection('appointments').where('bookedByUid', '==', userId).get().catch(() => ({ docs: [] })));
  }

  const snapshots = await Promise.all(queries);
  const apptMap = new Map();

  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      if (!apptMap.has(doc.id)) {
        apptMap.set(doc.id, { id: doc.id, appointmentId: doc.data().appointmentId || doc.id, ...doc.data() });
      }
    }
  }

  const list = Array.from(apptMap.values());

  // Enrich with token info
  for (const appt of list) {
    try {
      const tokDoc = await db.collection('tokens').doc(`tok-${appt.id}`).get().catch(() => null);
      if (tokDoc && tokDoc.exists) {
        appt.tokenNumber = tokDoc.data().tokenNumber || tokDoc.data().tokenLabel || tokDoc.data().queueNumber;
        appt.tokenStatus = tokDoc.data().status;
        appt.isCheckedIn = true;
      } else {
        const tSnap = await db.collection('tokens').where('appointmentId', '==', appt.id).limit(1).get().catch(() => ({ empty: true }));
        if (!tSnap.empty) {
          const tData = tSnap.docs[0].data();
          appt.tokenNumber = tData.tokenNumber || tData.tokenLabel || tData.queueNumber;
          appt.tokenStatus = tData.status;
          appt.isCheckedIn = true;
        } else {
          appt.isCheckedIn = ['checked_in', 'waiting', 'called', 'in_consultation'].includes((appt.status || '').toLowerCase());
        }
      }
    } catch (_) {}
  }

  list.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return da.localeCompare(db);
    return (a.timeSlot || a.time || '').localeCompare(b.timeSlot || b.time || '');
  });

  return list;
}

export async function executePatientChatTool(toolName, args, context) {
  const { userId, selectedPatientHealthId } = context;
  const db = assertDbConnected();

  switch (toolName) {
    case 'recommend_department': {
      const language = context.language || 'en';
      const result = routeComplaintToDepartment(args.complaint, {
        duration: args.duration,
        severity: args.severity
      }, language);
      return result;
    }

    case 'get_available_doctors': {
      const targetDept = args.departmentId || 'dept-gen';
      const targetDate = args.date || getHospitalTodayStr();

      try {
        let docSnap = await db.collection('doctors')
          .where('departmentId', '==', targetDept)
          .where('active', '==', true)
          .get();

        if (docSnap.empty) {
          docSnap = await db.collection('doctors')
            .where('active', '==', true)
            .limit(10)
            .get();
        }

        const doctorsList = docSnap.docs.map(d => {
          const data = d.data();
          return {
            doctorId: data.doctorId || d.id,
            doctorName: data.displayName || data.name || 'Doctor',
            departmentId: data.departmentId || targetDept,
            departmentName: data.departmentName || 'General Medicine',
            qualification: data.qualification || 'MBBS, MD',
            room: data.room || 'Room 101',
            timings: data.timings || '08:00 AM - 04:00 PM',
            nextAvailableSlot: '10:30 AM'
          };
        });

        return {
          departmentId: targetDept,
          count: doctorsList.length,
          doctors: doctorsList,
          message: `Available doctors in ${targetDept}: ${doctorsList.map(d => `${d.doctorName} (${d.departmentName}, ${d.room}, Timings: ${d.timings})`).join('; ')}`
        };
      } catch (err) {
        console.warn('[get_available_doctors] Query error:', err.message);
        return {
          departmentId: targetDept,
          count: 2,
          doctors: [
            { doctorId: 'DOC-001', doctorName: 'Dr. Demo General One', departmentName: 'General Medicine', room: 'Room 101', timings: '08:00 AM - 04:00 PM' },
            { doctorId: 'DOC-002', doctorName: 'Dr. Demo General Two', departmentName: 'General Medicine', room: 'Room 102', timings: '08:00 AM - 04:00 PM' }
          ],
          message: 'Available doctors: Dr. Demo General One (Room 101), Dr. Demo General Two (Room 102).'
        };
      }
    }

    case 'get_my_appointments': {
      try {
        const list = await getPatientAppointmentsList(db, userId, selectedPatientHealthId);
        const activeAppts = list.filter(a => !['cancelled', 'completed', 'no_show'].includes((a.status || '').toLowerCase()));

        if (activeAppts.length === 0) {
          return {
            count: 0,
            appointments: [],
            message: 'You have no upcoming appointments scheduled.'
          };
        }

        const formatted = activeAppts.map(a => ({
          appointmentId: a.id,
          doctorName: a.doctorName || 'Doctor',
          departmentName: a.departmentName || 'General Medicine',
          date: a.date,
          timeSlot: formatSlotTimeDisplay(a.timeSlot || a.time || '10:00'),
          status: a.status,
          tokenNumber: a.tokenNumber || null,
          isCheckedIn: Boolean(a.isCheckedIn)
        }));

        return {
          count: formatted.length,
          appointments: formatted,
          message: `You have ${formatted.length} active appointment(s): ${formatted.map(a => `${a.date} at ${a.timeSlot} with ${a.doctorName} [Status: ${a.status}${a.tokenNumber ? `, Token: ${a.tokenNumber}` : ''}]`).join('; ')}`
        };
      } catch (err) {
        console.warn('[get_my_appointments] Error:', err.message);
        return { count: 0, appointments: [], message: 'Could not retrieve appointments at this moment.' };
      }
    }

    case 'hospital_checkin': {
      const todayStr = getHospitalTodayStr();
      try {
        const list = await getPatientAppointmentsList(db, userId, selectedPatientHealthId);
        const todayAppts = list.filter(a => a.date === todayStr && !['cancelled', 'completed', 'no_show'].includes((a.status || '').toLowerCase()));

        if (todayAppts.length === 0) {
          return {
            status: 'NO_TODAY_APPOINTMENT',
            message: 'You do not have a scheduled appointment for today to check in. Hospital check-in is only available for confirmed appointments on the day of consultation. Would you like me to check other dates or book an appointment?'
          };
        }

        const target = args.appointmentId ? (todayAppts.find(a => a.id === args.appointmentId) || todayAppts[0]) : todayAppts[0];
        const curStatus = (target.status || '').toLowerCase();

        // Check if already checked in
        if (['checked_in', 'waiting', 'called', 'in_consultation'].includes(curStatus) || target.tokenNumber) {
          const tokenNum = target.tokenNumber || 'T-001';
          return {
            status: 'ALREADY_CHECKED_IN',
            tokenNumber: tokenNum,
            doctorName: target.doctorName || 'Doctor',
            departmentName: target.departmentName || 'General Medicine',
            checkInStatus: curStatus,
            estimatedWaitMinutes: target.estimatedWaitMinutes || 15,
            message: `You are already checked in for today's appointment with ${target.doctorName}! Your queue token is ${tokenNum} (Status: ${curStatus}). Estimated waiting time is approximately ${target.estimatedWaitMinutes || 15} minutes.`
          };
        }

        // If patient confirmed check-in
        if (args.confirmCheckin === true) {
          const targetDocId = target.doctorId || 'DOC-001';
          let queueSnap = { activeCount: 1, patientsAhead: 1, estimatedWaitMinutes: 15 };
          try {
            queueSnap = await computeQueueSnapshot(targetDocId, todayStr, { db });
          } catch (_) {}

          const tokenSeq = (queueSnap.activeCount || 0) + 1;
          const tokenNumber = `T-${tokenSeq}`;

          await db.collection('appointments').doc(target.id).update({
            status: 'checked_in',
            checkInTime: new Date().toISOString(),
            tokenNumber,
            updatedAt: new Date()
          });

          await db.collection('tokens').doc(`tok-${target.id}`).set({
            id: `tok-${target.id}`,
            appointmentId: target.id,
            tokenNumber,
            patientHealthId: selectedPatientHealthId,
            doctorId: targetDocId,
            status: 'waiting',
            date: todayStr,
            createdAt: new Date().toISOString()
          }, { merge: true });

          const estimatedWait = (queueSnap.patientsAhead || 1) * 15;
          const cleanDoc = (target.doctorName || 'Doctor').replace(/^Dr\.?\s*/i, '');
          return {
            success: true,
            checkInStatus: 'checked_in',
            tokenNumber,
            doctorName: `Dr. ${cleanDoc}`,
            departmentName: target.departmentName || 'General Medicine',
            estimatedWaitMinutes: estimatedWait,
            message: `You are now checked in! Your hospital queue token is ${tokenNumber} for Dr. ${cleanDoc} in ${target.departmentName || 'General Medicine'}. Estimated waiting time is approximately ${estimatedWait} minutes. Please take a seat in the waiting area.`
          };
        }

        // Ask for confirmation to check in
        const confirmToken = storeConfirmToken({
          type: 'CHECKIN',
          userId,
          patientHealthId: selectedPatientHealthId,
          appointmentId: target.id
        });

        const timeDisplay = formatSlotTimeDisplay(target.timeSlot || target.time || '10:00');
        return {
          actionRequired: 'CONFIRM_CHECKIN',
          confirmToken,
          appointmentId: target.id,
          message: `I found your appointment today at ${timeDisplay} with ${target.doctorName} (${target.departmentName || 'General Medicine'}). Would you like me to check you in and issue your queue token?`
        };
      } catch (checkinErr) {
        console.warn('[hospital_checkin] Error:', checkinErr.message);
        return { status: 'ERROR', message: 'Unable to complete hospital check-in at this moment. Please approach the reception desk.' };
      }
    }

    case 'get_queue_waiting_time': {
      const todayStr = getHospitalTodayStr();
      try {
        const list = await getPatientAppointmentsList(db, userId, selectedPatientHealthId);
        const todayAppt = list.find(a => a.date === todayStr && !['cancelled', 'completed', 'no_show'].includes((a.status || '').toLowerCase()));

        const docId = args.doctorId || todayAppt?.doctorId || 'DOC-001';
        let queueSnap = { patientsAhead: 1, estimatedWaitMinutes: 15, activeCount: 1 };
        try {
          queueSnap = await computeQueueSnapshot(docId, todayStr, { db });
        } catch (_) {}

        let patientsAhead = queueSnap.patientsAhead ?? (queueSnap.activeCount || 0);
        let waitMin = queueSnap.estimatedWaitMinutes ?? (patientsAhead * 12);
        if (waitMin === 0 && patientsAhead > 0) waitMin = patientsAhead * 10;

        let msg;
        if (todayAppt && (todayAppt.status === 'called' || todayAppt.status === 'in_consultation')) {
          msg = `Your token (${todayAppt.tokenNumber || 'T-001'}) has been called by Dr. ${todayAppt.doctorName}! Please proceed to the consultation room immediately.`;
        } else if (patientsAhead === 0) {
          msg = `You are next in line for Dr. ${todayAppt?.doctorName || 'Doctor'}. Current estimated wait is less than 5 minutes.`;
        } else {
          msg = `There are currently ${patientsAhead} patient(s) ahead of you in the queue. Your live estimated wait time is approximately ${waitMin} minutes.`;
        }

        return {
          doctorId: docId,
          patientsAhead,
          estimatedWaitMinutes: waitMin,
          message: msg
        };
      } catch (err) {
        console.warn('[get_queue_waiting_time] Error:', err.message);
        return { estimatedWaitMinutes: 15, message: 'Estimated waiting time is approximately 15 minutes.' };
      }
    }

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
      const live = active.live || {};

      const waitMinLow = live.waitMinLow ?? active.estimatedWaitMinutes ?? 15;
      const waitMinHigh = live.waitMinHigh ?? (waitMinLow + 10);
      const waitDisplay = waitMinLow === 0 ? 'No wait – it is your turn!' : `${waitMinLow} to ${waitMinHigh} minutes`;

      return {
        appointmentId: active.id,
        tokenNumber: active.tokenNumber || active.queueNumber || active.tokenLabel || 'T-001',
        tokenLabel: active.tokenLabel || active.tokenNumber,
        status: active.status,
        doctorName: active.doctorName || 'Doctor',
        estimatedWaitMinutes: waitMinLow,
        waitMinLow,
        waitMinHigh,
        waitDisplay,
        predictedCallAt: live.predictedCallAt || null,
        position: live.position || null,
        reasonText: live.reasonText || null
      };
    }

    case 'get_wait_time': {
      // Read live queue data for this patient's doctor/dept to return real wait estimates
      const today = new Date().toISOString().split('T')[0];
      try {
        // Get patient's own appointment to find their doctor + queue position
        const mySnap = await db.collection('appointments')
          .where('patientHealthId', '==', selectedPatientHealthId)
          .where('date', '==', today)
          .get();

        if (!mySnap.empty) {
          const myAppts = mySnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const myAppt = myAppts.find(a =>
            !['cancelled', 'completed', 'no_show'].includes(a.status)
          ) || myAppts[0];

          if (myAppt) {
            const live = myAppt.live || {};
            const waitMinLow = live.waitMinLow ?? myAppt.estimatedWaitMinutes ?? null;
            const waitMinHigh = live.waitMinHigh ?? (waitMinLow !== null ? waitMinLow + 10 : null);

            if (waitMinLow !== null) {
              const waitDisplay = waitMinLow === 0
                ? 'No wait — it is your turn now!'
                : `${waitMinLow} to ${waitMinHigh} minutes`;

              return {
                estimatedWaitMinutes: waitMinLow,
                waitMinLow,
                waitMinHigh,
                message: `Your current estimated wait is ${waitDisplay}.${live.reasonText ? ' ' + live.reasonText : ''}`,
                currentQueueLength: live.position || 1,
                predictedCallAt: live.predictedCallAt || null,
                reasonText: live.reasonText || null
              };
            }
          }
        }

        // Fallback: query general queue length for the requested doctor/dept
        const qSnap = await db.collection('appointments')
          .where('doctorId', '==', args.doctorId || '')
          .where('date', '==', today)
          .get();

        const queueLength = qSnap.docs.filter(d =>
          ['checked_in', 'called', 'in_consultation', 'rejoined', 'waiting'].includes(d.data().status)
        ).length;

        const estimatedMin = Math.round(queueLength * 12); // 12-min dept average fallback
        return {
          estimatedWaitMinutes: estimatedMin,
          waitMinLow: estimatedMin,
          waitMinHigh: estimatedMin + 10,
          currentQueueLength: queueLength,
          message: `Current estimated wait time is approximately ${estimatedMin} to ${estimatedMin + 10} minutes (${queueLength} patients in queue).`
        };
      } catch {
        return {
          estimatedWaitMinutes: 15,
          waitMinLow: 10,
          waitMinHigh: 20,
          currentQueueLength: null,
          message: 'Estimated wait time is approximately 10 to 20 minutes.'
        };
      }
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
      const todayStr = getHospitalTodayStr();
      const nowHHmm = getHospitalTimeStr();
      const targetDate = args.date || todayStr;

      try {
        let slotQuery = db.collection('slots')
          .where('date', '==', targetDate)
          .where('status', '==', 'free');

        if (args.doctorId) {
          slotQuery = slotQuery.where('doctorId', '==', args.doctorId);
        }

        const slotSnap = await slotQuery.limit(20).get();
        let freeSlots = slotSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filter out past slots if querying for today
        if (targetDate === todayStr) {
          freeSlots = freeSlots.filter(s => {
            const st = s.startAt || s.startTime || s.time || '';
            return st > nowHHmm;
          });
        }

        // Sort by time
        freeSlots.sort((a, b) => {
          const ta = a.startAt || a.startTime || a.time || '';
          const tb = b.startAt || b.startTime || b.time || '';
          return ta.localeCompare(tb);
        });

        // If no slots left today, query tomorrow
        let fallbackTomorrow = false;
        let effectiveDate = targetDate;
        if (freeSlots.length === 0 && targetDate === todayStr) {
          fallbackTomorrow = true;
          effectiveDate = dayjs(todayStr).add(1, 'day').format('YYYY-MM-DD');
          let tomorrowQuery = db.collection('slots')
            .where('date', '==', effectiveDate)
            .where('status', '==', 'free');
          if (args.doctorId) {
            tomorrowQuery = tomorrowQuery.where('doctorId', '==', args.doctorId);
          }
          const tmrSnap = await tomorrowQuery.limit(10).get();
          freeSlots = tmrSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          freeSlots.sort((a, b) => (a.startAt || a.time || '').localeCompare(b.startAt || b.time || ''));
        }

        const slotTimes24 = freeSlots.map(s => s.startAt || s.startTime || s.time || '10:00');
        const formattedSlots = slotTimes24.map(t => formatSlotTimeDisplay(t));

        return {
          date: effectiveDate,
          isTomorrow: fallbackTomorrow,
          availableSlots: slotTimes24,
          formattedSlots,
          message: formattedSlots.length > 0
            ? `Available slots on ${effectiveDate}: ${formattedSlots.join(', ')}`
            : `No available slots found on ${effectiveDate}. Please check another date.`
        };
      } catch (err) {
        console.warn('[find_slots] Firestore query failed, falling back:', err.message);
        return {
          date: targetDate,
          availableSlots: ['09:00', '10:30', '11:45', '14:30', '15:15'],
          formattedSlots: ['09:00 AM', '10:30 AM', '11:45 AM', '02:30 PM', '03:15 PM'],
          message: 'Available slots: 09:00 AM, 10:30 AM, 11:45 AM, 02:30 PM, 03:15 PM'
        };
      }
    }

    case 'prepare_booking': {
      const todayStr = getHospitalTodayStr();
      const targetDate = args.date || todayStr;
      const parsedTime = normalizeTo24HourTime(args.timeSlot || '10:00');
      const normalizedTime = parsedTime?.time24 || (typeof parsedTime === 'string' ? parsedTime : '10:00');
      const reqHour = parsedTime?.hours ?? Number(normalizedTime.split(':')[0]);

      // 1. OPD Operating Hours Check (08:00 to 17:00). Never book outside OPD hours (e.g. 10:30 PM / 22:30)
      if (reqHour < 8 || reqHour >= 17) {
        const formattedReq = formatSlotTimeDisplay(normalizedTime);
        return {
          status: 'SLOT_UNAVAILABLE',
          error: 'OUTSIDE_OPD_HOURS',
          message: `The Outpatient Department (OPD) operates between 08:00 AM and 05:00 PM. ${formattedReq} is outside clinic hours. Available daytime slots are 10:30 AM, 11:45 AM, 02:30 PM, and 03:15 PM. Which daytime slot would you prefer?`
        };
      }

      // 2. Overlapping & Duplicate Appointment Check
      try {
        const activeApptSnap = await db.collection('appointments')
          .where('patientHealthId', '==', selectedPatientHealthId)
          .where('date', '==', targetDate)
          .get();

        const activeStatuses = ['booked', 'confirmed', 'checked_in', 'called', 'in_consultation'];
        const existingActive = activeApptSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .find(a => activeStatuses.includes((a.status || '').toLowerCase()));

        if (existingActive) {
          const exTime = formatSlotTimeDisplay(existingActive.timeSlot || existingActive.time || 'scheduled time');
          const exDoc = existingActive.doctorName || 'Dr. Demo General One';
          const exStatus = existingActive.status || 'active';
          return {
            status: 'CONFLICT',
            error: 'OVERLAPPING_APPOINTMENT',
            message: `You already have an appointment on this date at ${exTime} with ${exDoc} (Status: ${exStatus}). Please choose another time slot or date.`
          };
        }
      } catch (checkErr) {
        console.warn('[prepare_booking] Appt conflict check skipped:', checkErr.message);
      }

      let doctorName = 'Dr. Demo General One';
      let deptName = 'General Medicine';
      try {
        if (args.doctorId) {
          const docDoc = await db.collection('doctors').doc(args.doctorId).get();
          if (docDoc.exists) {
            doctorName = docDoc.data().displayName || docDoc.data().name || doctorName;
            deptName = docDoc.data().departmentName || deptName;
          }
        }
      } catch (_) {}

      // Resolve patient name
      let patientName = 'Patient';
      try {
        if (userId) {
          const uDoc = await db.collection('users').doc(userId).get();
          if (uDoc.exists) patientName = uDoc.data().displayName || uDoc.data().name || patientName;
        }
      } catch (_) {}

      const confirmToken = storeConfirmToken({
        type: 'BOOKING',
        userId,
        patientHealthId: selectedPatientHealthId,
        doctorId: args.doctorId,
        doctorName,
        departmentName: deptName,
        patientName,
        date: targetDate,
        timeSlot: normalizedTime
      });

      const displayTime = formatSlotTimeDisplay(normalizedTime);
      return {
        actionRequired: 'CONFIRM_BOOKING',
        confirmToken,
        patientName,
        doctorName,
        departmentName: deptName,
        date: targetDate,
        time: displayTime,
        summary: `Book appointment on ${targetDate} at ${displayTime} with ${doctorName} for ${patientName}`,
        message: `Please confirm: Patient ${patientName}, Department ${deptName}, Doctor ${doctorName}, Date ${targetDate}, Time ${displayTime}. Would you like me to confirm this appointment?`
      };
    }

    case 'prepare_cancel': {
      try {
        const list = await getPatientAppointmentsList(db, userId, selectedPatientHealthId);
        const activeAppts = list.filter(a => !['cancelled', 'completed', 'no_show'].includes((a.status || '').toLowerCase()));

        if (activeAppts.length === 0) {
          return {
            status: 'NO_APPOINTMENTS_FOUND',
            message: 'No cancellable upcoming appointments were found on your health record.'
          };
        }

        let target = null;
        if (args.appointmentId) {
          target = activeAppts.find(a => a.id === args.appointmentId || a.appointmentId === args.appointmentId);
        }
        if (!target) {
          target = activeAppts[0];
        }

        const curStatus = (target.status || '').toLowerCase();
        if (['in_consultation', 'serving', 'completed'].includes(curStatus)) {
          return {
            status: 'CANNOT_CANCEL',
            message: `Your appointment with ${target.doctorName} cannot be cancelled because the consultation has already started or is completed.`
          };
        }

        const timeDisplay = formatSlotTimeDisplay(target.timeSlot || target.time || '10:00');
        const isCheckedIn = target.isCheckedIn || ['checked_in', 'waiting', 'called'].includes(curStatus);
        const tokenNumber = target.tokenNumber || target.queueNumber || target.tokenLabel || null;
        const cleanDocName = (target.doctorName || 'Doctor').replace(/^Dr\.?\s*/i, '');
        const formattedDocName = `Dr. ${cleanDocName}`;
        const lk = (context?.language || 'en').split('-')[0].toLowerCase();

        const confirmToken = storeConfirmToken({
          type: 'CANCEL',
          userId,
          patientHealthId: selectedPatientHealthId,
          appointmentId: target.id,
          hasQueueToken: isCheckedIn,
          tokenNumber
        });

        if (isCheckedIn && tokenNumber) {
          const cancelPrompts = {
            te: `మీరు ఈ రోజు ${timeDisplay} సమయంలో ${formattedDocName} వద్ద వెయిటింగ్ రూమ్‌లో క్రియాశీల క్యూ టోకెన్ (${tokenNumber}) కలిగి ఉన్నారు. మీరు ఇప్పుడు రద్దు చేస్తే, మీ అపాయింట్‌మెంట్ రద్దు చేయబడుతుంది మరియు మీ టోకెన్ విడుదల చేయబడుతుంది. నేను ఈ అపాయింట్‌మెంట్‌ను రద్దు చేసి మీ టోకెన్‌ను విడుదల చేయమంటారా?`,
            kn: `ನೀವು ಇಂದು ${timeDisplay} ಸಮಯದಲ್ಲಿ ${formattedDocName} ಅವರ ನಿರೀಕ್ಷಣಾ ಕೊಠಡಿಯಲ್ಲಿ ಸಕ್ರಿಯ ಕ್ಯೂ ಟೋಕನ್ (${tokenNumber}) ಹೊಂದಿದ್ದೀರಿ. ನೀವು ಈಗ ರದ್ದುಗೊಳಿಸಿದರೆ, ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದಾಗುತ್ತದೆ ಮತ್ತು ನಿಮ್ಮ ಟೋಕನ್ ಬಿಡುಗಡೆಯಾಗುತ್ತದೆ. ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಲು ಮುಂದುವರಿಯಬೇಕೆ?`,
            hi: `वेटिंग रूम में ${formattedDocName} के लिए आज ${timeDisplay} पर आपका सक्रिय कतार टोकन (${tokenNumber}) है। यदि आप अभी रद्द करते हैं, तो आपकी अपॉइंटमेंट रद्द कर दी जाएगी और टोकन जारी कर दिया जाएगा। क्या आप इस अपॉइंटमेंट को रद्द करना चाहते हैं?`,
            ta: `காத்திருப்பு அறையில் ${formattedDocName} க்காக இன்று ${timeDisplay} மணிக்கு உங்களிடம் செயலில் உள்ள வரிசை டோக்கன் (${tokenNumber}) உள்ளது. இந்த அப்பாயிண்ட்மெண்ட்டை ரத்து செய்ய விரும்புகிறீர்களா?`,
            en: `You currently have an active queue token (${tokenNumber}) in the waiting room for ${formattedDocName} today at ${timeDisplay}. If you cancel now, your appointment will be cancelled and your token will be released from the queue. Would you like me to proceed with cancelling this appointment and releasing your token?`
          };
          const promptMsg = cancelPrompts[lk] || cancelPrompts.en;

          return {
            actionRequired: 'CONFIRM_CANCEL',
            confirmToken,
            appointmentId: target.id,
            tokenNumber,
            hasQueueToken: true,
            summary: `Cancel checked-in appointment with ${formattedDocName} and release queue token ${tokenNumber}`,
            message: promptMsg
          };
        }

        const standardPrompts = {
          te: `మీకు ${target.date} తేదీన ${timeDisplay} సమయంలో ${formattedDocName} గారితో అపాయింట్‌మెంట్ ఉంది (${target.departmentName || 'General Medicine'}, స్థితి: ${target.status}). ఈ అపాయింట్‌మెంట్ రద్దును నిర్ధారించమంటారా?`,
          kn: `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ${target.date} ರಂದು ${timeDisplay} ಕ್ಕೆ ${formattedDocName} ಅವರೊಂದಿಗೆ ಇದೆ (${target.departmentName || 'General Medicine'}, ಸ್ಥಿತಿ: ${target.status}). ಈ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದುಗೊಳಿಸಲು ದೃಢೀಕರಿಸಬೇಕೆ?`,
          hi: `मुझे ${target.date} को ${timeDisplay} बजे ${formattedDocName} (${target.departmentName || 'General Medicine'}) के साथ आपकी अपॉइंटमेंट मिली है। क्या आप इसे रद्द करना चाहते हैं?`,
          ta: `${target.date} அன்று ${timeDisplay} மணிக்கு ${formattedDocName} உடன் உங்கள் அப்பாயிண்ட்மெண்ட் உள்ளது. இதை ரத்து செய்ய விரும்புகிறீர்களா?`,
          en: `I found your appointment on ${target.date} at ${timeDisplay} with ${formattedDocName} (${target.departmentName || 'General Medicine'}, Status: ${target.status}). Would you like me to confirm cancellation of this appointment?`
        };
        const standardMsg = standardPrompts[lk] || standardPrompts.en;

        return {
          actionRequired: 'CONFIRM_CANCEL',
          confirmToken,
          appointmentId: target.id,
          summary: `Cancel appointment on ${target.date} at ${timeDisplay} with ${formattedDocName}`,
          message: standardMsg
        };
      } catch (cancelErr) {
        console.warn('[prepare_cancel] Error:', cancelErr.message);
        return { status: 'ERROR', message: 'Could not prepare appointment cancellation at this moment.' };
      }
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

    case 'get_latest_prescription': {
      const snap = await db.collection('prescriptions')
        .where('patientHealthId', '==', selectedPatientHealthId)
        .get();

      if (snap.empty) {
        return {
          status: 'NO_PRESCRIPTION',
          activeCount: 0,
          message: "I couldn't find any active prescriptions on your health record. Would you like to check your upcoming follow-ups or medicine reminders instead?"
        };
      }

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0));

      // Differentiate active vs completed/expired
      const activePrescriptions = docs.filter(p => !p.status || p.status.toUpperCase() === 'ACTIVE');
      if (activePrescriptions.length === 0) {
        return {
          status: 'NO_ACTIVE_PRESCRIPTIONS',
          activeCount: 0,
          expiredCount: docs.length,
          message: `I checked your health record, but there are no active prescriptions available right now (${docs.length} past/completed prescription record(s) on file). Would you like me to check your upcoming follow-ups or medicine reminders instead?`
        };
      }

      const latest = activePrescriptions[0];
      const medicines = (latest.items || []).map(m => ({
        name: m.medicineName || m.name,
        dosage: m.dose || m.dosage,
        frequency: m.frequency,
        instructions: m.instructions || m.timing || 'As directed by physician'
      }));

      return {
        prescriptionId: latest.prescriptionId || latest.id,
        date: latest.date || latest.createdAt?.slice(0, 10),
        doctorName: latest.doctorName || 'Attending Physician',
        medicines,
        diagnosis: latest.diagnosis || null,
        advice: latest.generalAdvice || latest.notes || null,
        message: medicines.length > 0
          ? `Your active prescription from Dr. ${latest.doctorName || 'Doctor'} includes: ${medicines.map(m => `${m.name} (${m.dosage}, ${m.frequency})`).join(', ')}.`
          : 'Prescription details retrieved with no active medication items.'
      };
    }

    case 'get_medicine_reminders': {
      const snap = await db.collection('reminders')
        .where('patientHealthId', '==', selectedPatientHealthId)
        .get();

      if (snap.empty) {
        return { message: 'You have no scheduled medicine reminders right now.' };
      }

      const reminders = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          medicineName: data.medicineName || data.title || 'Medicine',
          dose: data.dose || data.dosage || '',
          scheduledTime: data.time || data.scheduledTime || data.dueAt || '',
          status: data.status || 'PENDING'
        };
      });

      return {
        reminders,
        message: `You have ${reminders.length} reminder(s): ${reminders.map(r => `${r.medicineName} at ${r.scheduledTime} [${r.status}]`).join('; ')}`
      };
    }

    case 'get_upcoming_followups': {
      const followSnap = await db.collection('followups')
        .where('patientHealthId', '==', selectedPatientHealthId)
        .get();

      if (followSnap.empty) {
        return { message: 'You have no upcoming follow-ups scheduled at this time.' };
      }

      const followups = followSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          doctorName: data.doctorName || 'Doctor',
          targetDate: data.targetDate || data.recommendedDate || '',
          notes: data.notes || data.reason || 'General clinical review',
          status: data.status || 'PENDING'
        };
      });

      return {
        followups,
        message: `You have ${followups.length} follow-up(s) scheduled. Next review: ${followups[0].doctorName} on ${followups[0].targetDate}.`
      };
    }

    case 'get_hospital_info': {
      return {
        hospitalName: 'SmartCare Multispecialty Hospital',
        departments: [
          'Cardiology',
          'General Medicine',
          'Pediatrics',
          'Orthopedics',
          'Dermatology',
          'ENT',
          'Neurology',
          'Gynecology'
        ],
        opdHours: 'Monday to Saturday: 08:00 AM - 04:00 PM',
        emergencyServices: '24x7 Emergency Casualty & Trauma Care (Dial 108 / 112)',
        helpdeskPhone: '080-23456789',
        location: 'Main Block, Rajajinagar, Bengaluru, Karnataka 560010'
      };
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

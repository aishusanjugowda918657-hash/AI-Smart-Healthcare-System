import { assertDbConnected } from '../config/firebase.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { generateSlotsForDoctorDate } from '../domain/slots.js';
import { notify } from '../services/notify.js';
import { clock } from '../utils/clock.js';
import { writeAuditLog } from '../utils/audit.js';
import { assignBatchDoctorDisplayIds, assignDoctorDisplayId } from '../services/doctorDisplayIdService.js';
import { parseSlotTimeToDate, getHospitalTodayStr } from '../utils/timezoneDate.js';

// 60-second in-memory cache for doctor dashboard totals
export const dashboardSummaryCache = new Map();

function calculateAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    years--;
  }
  return years >= 0 ? years : null;
}

/**
 * List all active medical departments
 */
export const getDepartments = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const [deptSnapshot, docSnapshot] = await Promise.all([
      db.collection('departments').get(),
      db.collection('doctors').get()
    ]);

    // Count active doctors per department
    const activeCounts = {};
    docSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const status = String(data.status || 'ACTIVE').toUpperCase();
      const isActive = status !== 'INACTIVE' && status !== 'DISABLED';
      if (isActive) {
        const deptId = data.departmentId || data.deptId;
        if (deptId) {
          activeCounts[deptId] = (activeCounts[deptId] || 0) + 1;
        }
      }
    });

    const WING_MAPPING = {
      'dept-gen': { room: 'Room 101-104', wing: 'North Wing' },
      'dept-card': { room: 'Room 201-205', wing: 'East Wing' },
      'dept-ortho': { room: 'Room 206-210', wing: 'East Wing' },
      'dept-gastro': { room: 'Room 301-304', wing: 'West Wing' },
      'dept-nephro': { room: 'Room 305-308', wing: 'West Wing' },
      'dept-neuro': { room: 'Room 401-405', wing: 'South Wing' },
      'dept-onco': { room: 'Room 406-410', wing: 'South Wing' },
      'dept-obgyn': { room: 'Room 501-505', wing: 'North Wing' },
      'dept-ped': { room: 'Room 301-303', wing: 'West Wing' },
      'dept-derm': { room: 'Room 401-402', wing: 'South Wing' }
    };

    const departments = deptSnapshot.docs.map((doc) => {
      const data = doc.data();
      const defaultWing = WING_MAPPING[doc.id] || { room: 'Room 501', wing: 'Main Hospital Wing' };
      return {
        id: doc.id,
        room: data.room || defaultWing.room,
        wing: data.wing || defaultWing.wing,
        ...data,
        activeDoctors: activeCounts[doc.id] || 0
      };
    });

    res.status(200).json(formatSuccessResponse(departments));
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new department (Admin only)
 */
export const createDepartment = async (req, res, next) => {
  try {
    const { name, letter, code, room, wing, description = '', defaultDurationsMin } = req.body;
    if (!name || (!letter && !code)) {
      throw new AppError('VALIDATION_ERROR', 'Department Name and Letter/Code are required.', 400);
    }

    const db = assertDbConnected();
    const deptLetter = (letter || code || 'G').toUpperCase().substring(0, 1);
    const id = req.body.id || `dept-${deptLetter.toLowerCase()}`;

    const deptData = {
      id,
      name,
      letter: deptLetter,
      code: (code || deptLetter).toUpperCase(),
      room: room || 'Room 501',
      wing: wing || 'North Wing',
      description,
      defaultDurationsMin: defaultDurationsMin || {
        new: { simple: 10, moderate: 20, complex: 30 },
        followup: { simple: 10, moderate: 15, complex: 20 },
        report_review: { simple: 10 },
        procedure: { simple: 30 }
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('departments').doc(id).set(deptData, { merge: true });

    res.status(201).json(formatSuccessResponse(deptData));
  } catch (error) {
    next(error);
  }
};

/**
 * List active doctors, filterable by departmentId query param
 */
export const getDoctors = async (req, res, next) => {
  try {
    const { departmentId, includeSlotStatus } = req.query;
    const db = assertDbConnected();

    let query = db.collection('doctors');
    if (departmentId) {
      query = query.where('departmentId', '==', departmentId);
    }

    const snapshot = await query.get();

    const rawDoctors = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        status: data.status || 'ACTIVE',
        ...data
      };
    });

    const doctors = assignBatchDoctorDisplayIds(rawDoctors);

    if (includeSlotStatus === 'true') {
      const todayStr = getHospitalTodayStr();
      for (const doc of doctors) {
        const targetId = doc.doctorId || doc.id;
        const slotsSnap = await db.collection('slots')
          .where('doctorId', '==', targetId)
          .where('date', '>=', todayStr)
          .where('status', '==', 'free')
          .limit(1)
          .get();
        doc.hasFutureSlots = !slotsSnap.empty;
      }
    }

    res.status(200).json(formatSuccessResponse(doctors));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Doctor Details by ID (UID or doctorId)
 */
export const getDoctorById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    let docSnap = await db.collection('doctors').doc(id).get();
    if (!docSnap.exists) {
      const qSnap = await db.collection('doctors').where('doctorId', '==', id).limit(1).get();
      if (!qSnap.empty) {
        docSnap = qSnap.docs[0];
      }
    }

    if (!docSnap || !docSnap.exists) {
      throw new AppError('NOT_FOUND', `Doctor '${id}' not found.`, 404);
    }

    const doctorData = {
      id: docSnap.id,
      ...docSnap.data()
    };

    if (!doctorData.displayId && !doctorData.doctorDisplayId) {
      doctorData.displayId = assignDoctorDisplayId(doctorData);
      doctorData.doctorDisplayId = doctorData.displayId;
    }

    if (doctorData.departmentId) {
      const deptSnap = await db.collection('departments').doc(doctorData.departmentId).get();
      if (deptSnap.exists) {
        doctorData.department = deptSnap.data();
      }
    }

    res.status(200).json(formatSuccessResponse(doctorData));
  } catch (error) {
    next(error);
  }
};

/**
 * Get all registered leaves (Admin or Doctor query)
 */
export const getLeaves = async (req, res, next) => {
  try {
    const { doctorId } = req.query;
    const db = assertDbConnected();

    let query = db.collection('leaves');
    if (doctorId) {
      query = query.where('doctorId', '==', doctorId);
    }

    const snap = await query.get();
    const leaves = snap.docs.map((d) => {
      const data = d.data();
      const sDate = data.startDate || data.date || (data.fromAt ? data.fromAt.split('T')[0] : '');
      const eDate = data.endDate || (data.toAt ? data.toAt.split('T')[0] : sDate);
      return {
        id: d.id,
        ...data,
        startDate: sDate,
        endDate: eDate
      };
    });

    // Populate doctorName if missing
    for (const l of leaves) {
      if (!l.doctorName && l.doctorId) {
        try {
          const docSnap = await db.collection('doctors').doc(l.doctorId).get();
          if (docSnap.exists) {
            l.doctorName = docSnap.data().fullName || docSnap.data().name;
          } else {
            const uSnap = await db.collection('users').doc(l.doctorId).get();
            if (uSnap.exists) {
              l.doctorName = uSnap.data().fullName || uSnap.data().name;
            }
          }
        } catch (_) {}
      }
      if (!l.doctorName) l.doctorName = 'Doctor';
    }

    res.status(200).json(formatSuccessResponse(leaves));
  } catch (error) {
    next(error);
  }
};

/**
 * Configure/Update Doctor Working Schedule (Admin or Doctor)
 */
export const saveDoctorSchedule = async (req, res, next) => {
  try {
    const rawId = req.params.id;
    const targetDoctorIdFromParam = (!rawId || rawId === 'schedule') ? (req.user.doctorUid || req.user.uid) : rawId;
    const doctorId = targetDoctorIdFromParam;

    const {
      slotMinutes,
      slotDurationMinutes,
      bufferEverySlots = 6,
      weekly,
      workingDays,
      workingHours,
      lunch,
      breakTimes,
      maxBookedPerSession
    } = req.body;

    const slotMins = Number(slotMinutes || slotDurationMinutes) || 10;
    const bufferEvery = Number(bufferEverySlots) || 6;
    const lunchObj = lunch || (Array.isArray(breakTimes) && breakTimes[0]) || { start: '13:00', end: '14:00' };

    let weeklyConfig = Array.isArray(weekly) && weekly.length > 0 ? weekly : null;

    if (!weeklyConfig && Array.isArray(workingDays) && workingDays.length > 0) {
      const start = workingHours?.start || '09:00';
      const end = workingHours?.end || '17:00';

      let sessions = [];
      if (lunchObj && lunchObj.start && lunchObj.end && lunchObj.start > start && lunchObj.end < end) {
        sessions = [
          { start, end: lunchObj.start },
          { start: lunchObj.end, end }
        ];
      } else {
        sessions = [{ start, end }];
      }

      weeklyConfig = workingDays.map((dNum) => ({
        dayOfWeek: dNum === 7 ? 0 : Number(dNum),
        sessions
      }));
    }

    if (!weeklyConfig) {
      weeklyConfig = [
        { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
        { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
      ];
    }

    const db = assertDbConnected();

    let doctorRef = db.collection('doctors').doc(doctorId);
    let docSnap = await doctorRef.get();
    if (!docSnap.exists) {
      const qSnap = await db.collection('doctors').where('doctorId', '==', doctorId).limit(1).get();
      if (!qSnap.empty) {
        doctorRef = qSnap.docs[0].ref;
        docSnap = qSnap.docs[0];
      }
    }

    // Authorization: Admin can modify any doctor's schedule; Doctor can only modify their own schedule
    if (req.user?.role !== 'admin') {
      const callerUid = req.user?.uid;
      const callerDoctorUid = req.user?.doctorUid;
      const callerDoctorId = req.user?.doctorId;

      let isOwner = false;
      if (docSnap && docSnap.exists) {
        const data = docSnap.data() || {};
        isOwner = Boolean(
          docSnap.id === callerUid ||
          data.uid === callerUid ||
          data.doctorUid === callerUid ||
          data.userId === callerUid ||
          (callerDoctorUid && (docSnap.id === callerDoctorUid || data.doctorUid === callerDoctorUid || data.doctorId === callerDoctorUid)) ||
          (callerDoctorId && (data.doctorId === callerDoctorId || docSnap.id === callerDoctorId)) ||
          doctorId === callerUid ||
          (callerDoctorUid && doctorId === callerDoctorUid) ||
          (callerDoctorId && doctorId === callerDoctorId)
        );
      } else {
        isOwner = Boolean(
          doctorId === callerUid ||
          (callerDoctorUid && doctorId === callerDoctorUid) ||
          (callerDoctorId && doctorId === callerDoctorId)
        );
      }

      if (!isOwner) {
        throw new AppError('FORBIDDEN', 'Access denied: You can only modify your own schedule.', 403);
      }
    }

    if (!docSnap.exists) {
      const userSnap = await db.collection('users').doc(doctorId).get();
      const docName = (userSnap.exists ? (userSnap.data().displayName || userSnap.data().fullName) : null) || doctorId;
      await doctorRef.set({
        id: doctorId,
        doctorId,
        name: docName,
        fullName: docName,
        departmentId: 'dept-gen',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
      docSnap = await doctorRef.get();
    }

    const scheduleObj = {
      slotMinutes: slotMins,
      bufferEverySlots: bufferEvery,
      weekly: weeklyConfig,
      lunch: lunchObj,
      maxBookedPerSession: maxBookedPerSession || null
    };

    await doctorRef.update({
      schedule: scheduleObj,
      updatedAt: new Date()
    });

    const targetDoctorId = docSnap.data().doctorId || docSnap.id;
    const leavesSnap = await db.collection('leaves').where('doctorId', '==', targetDoctorId).get();
    const leaves = leavesSnap.docs.map((d) => d.data());

    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const existingSnap = await db
        .collection('slots')
        .where('doctorId', '==', targetDoctorId)
        .where('date', '==', dateStr)
        .get();

      const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

      const generated = generateSlotsForDoctorDate({
        doctorId: targetDoctorId,
        date: dateStr,
        schedule: scheduleObj,
        leaves,
        existingSlots
      });

      if (generated.length > 0) {
        const batch = db.batch();
        generated.forEach((s) => {
          batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
        });
        await batch.commit();
      }
    }

    res.status(200).json(formatSuccessResponse({
      message: 'Doctor schedule updated and slots regenerated successfully.',
      doctorId: targetDoctorId,
      schedule: scheduleObj
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Doctor Alerts (Patients Needing Attention) (PRD F13)
 */
export const getDoctorAlerts = async (req, res, next) => {
  try {
    const doctorUid = req.user.doctorUid || req.user.uid;
    const db = assertDbConnected();

    // 1. Check canonical 'alerts' collection
    const snapshot = await db
      .collection('alerts')
      .where('doctorId', '==', doctorUid)
      .get();

    let alerts = snapshot.docs.map((d) => d.data());

    // 2. Fallback to legacy 'doctorAlerts' if empty
    if (alerts.length === 0) {
      const legacySnapshot = await db
        .collection('doctorAlerts')
        .where('doctorUid', '==', doctorUid)
        .get();
      alerts = legacySnapshot.docs.map((d) => d.data());
    }

    alerts = alerts.filter((a) => a.status === 'open');

    // Risk sorting: high -> medium -> low
    const riskRank = { high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => (riskRank[a.riskLevel] || 3) - (riskRank[b.riskLevel] || 3));

    const highCount = alerts.filter((a) => a.riskLevel === 'high').length;
    const medCount = alerts.filter((a) => a.riskLevel === 'medium').length;

    res.status(200).json({
      success: true,
      data: alerts,
      alerts,
      caseloadSummary: {
        high: highCount,
        medium: medCount,
        total: alerts.length,
        text: `${highCount} high, ${medCount} medium`
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resolve Doctor Alert
 */
export const resolveDoctorAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolutionNotes = 'Marked as resolved by physician' } = req.body;
    const { uid: doctorUid } = req.user;

    const db = assertDbConnected();
    const updatePayload = {
      id,
      status: 'resolved',
      resolutionNotes,
      resolvedBy: doctorUid,
      resolvedByUid: doctorUid,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.collection('alerts').doc(id).set(updatePayload, { merge: true });
    try { await db.collection('doctorAlerts').doc(id).set(updatePayload, { merge: true }); } catch {}

    res.status(200).json(formatSuccessResponse({ id, status: 'RESOLVED' }));
  } catch (error) {
    next(error);
  }
};

/**
 * Snooze Doctor Alert (3 Days)
 */
export const snoozeDoctorAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const snoozedUntil = new Date(now);
    snoozedUntil.setDate(snoozedUntil.getDate() + 3);

    const db = assertDbConnected();
    const updatePayload = {
      id,
      status: 'snoozed',
      snoozeUntil: snoozedUntil.toISOString(),
      snoozedUntil: snoozedUntil.toISOString(),
      updatedAt: now.toISOString()
    };

    await db.collection('alerts').doc(id).set(updatePayload, { merge: true });
    try { await db.collection('doctorAlerts').doc(id).set(updatePayload, { merge: true }); } catch {}

    res.status(200).json(formatSuccessResponse({ id, status: 'snoozed', snoozeUntil: snoozedUntil.toISOString() }));
  } catch (error) {
    next(error);
  }
};

/**
 * Send Patient Reminder Alert Action
 */
export const sendPatientReminderAlert = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    let doc = await db.collection('alerts').doc(id).get();
    if (!doc.exists) {
      doc = await db.collection('doctorAlerts').doc(id).get();
    }

    if (!doc.exists) {
      throw new AppError('NOT_FOUND', 'Alert record not found', 404);
    }

    const alertData = doc.data();
    const targetUid = alertData.patientUid || alertData.patientHealthId || alertData.healthId;
    const reasonText = Array.isArray(alertData.reasons) ? alertData.reasons.join(', ') : (alertData.message || 'Attention required');

    // Trigger push notification to patient
    await notify({
      uids: [targetUid],
      title: 'Doctor Reminder Notice',
      body: `Your doctor has sent a reminder: ${reasonText}`,
      privacyBody: 'Reminder notice from your physician.',
      type: 'doctor_direct_reminder',
      urgent: true
    });

    res.status(200).json(formatSuccessResponse({ message: 'Direct patient reminder sent successfully.' }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/doctor/dashboard-summary (PRD F6, F7, Task A Requirement 4)
 * Doctor only, own data. Returns total, waiting, in consultation, completed,
 * not arrived, late, and timeFactor using native count() queries.
 * Cached for 60 seconds in memory to stay quota-safe.
 */
export const getDoctorDashboardSummary = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
    }
    const db = assertDbConnected();
    const doctorUid = user.uid;

    let targetDoctorId = user.doctorId;
    if (!targetDoctorId) {
      const docSnap = await db.collection('doctors').doc(doctorUid).get();
      targetDoctorId = docSnap.exists ? docSnap.data().doctorId : doctorUid;
    }

    const date = req.query.date || getHospitalTodayStr(clock.now());
    const cacheKey = `${targetDoctorId}_${date}`;

    if (req.query.nocache !== 'true' && dashboardSummaryCache.has(cacheKey)) {
      const cached = dashboardSummaryCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 60000) {
        return res.status(200).json(formatSuccessResponse({ ...cached.data, cached: true }));
      }
    }

    const now = clock.now();
    const nowMs = now.getTime();

    // Sweep unattended appointments on this date past the 60m threshold to no_show
    try {
      const apptsOnDateSnap = await db.collection('appointments')
        .where('doctorId', '==', targetDoctorId)
        .where('date', '==', date)
        .get();

      const batch = db.batch();
      let sweepCount = 0;
      for (const d of apptsOnDateSnap.docs) {
        const apt = d.data();
        const statusLower = (apt.status || '').toLowerCase();
        if (['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived'].includes(statusLower) && !apt.checkedInAt) {
          const slotTimeStr = apt.timeSlot || apt.bookedStartAt;
          if (slotTimeStr) {
            const apptDateObj = parseSlotTimeToDate(date, slotTimeStr);
            if (apptDateObj && nowMs > apptDateObj.getTime() + 60 * 60 * 1000) {
              batch.update(d.ref, {
                status: 'no_show',
                noShowAt: now,
                updatedAt: now
              });
              const tokRef = db.collection('tokens').doc(`tok-${apt.id}`);
              batch.set(tokRef, { status: 'no_show', noShowAt: now, updatedAt: now }, { merge: true });
              sweepCount++;
            }
          }
        }
      }
      if (sweepCount > 0) {
        await batch.commit();
      }
    } catch (e) {
      console.warn('Dashboard summary unattended sweep warning:', e.message);
    }

    // 1. Total appointments today (using native count())
    const totalSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .count()
      .get();
    const total = totalSnap.data().count;

    // 2. Waiting (checked_in, rejoined)
    const waitingSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .where('status', 'in', ['checked_in', 'rejoined'])
      .count()
      .get();
    const waiting = waitingSnap.data().count;

    // 3. In consultation (called, in_consultation)
    const inConsultSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .where('status', 'in', ['called', 'in_consultation'])
      .count()
      .get();
    const inConsultation = inConsultSnap.data().count;

    // 4. Completed
    const completedSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .where('status', '==', 'completed')
      .count()
      .get();
    const completed = completedSnap.data().count;

    // 5. Not arrived (booked, confirmed, on_the_way, nearby, not_arrived)
    const notArrivedSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .where('status', 'in', ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived'])
      .count()
      .get();
    const notArrived = notArrivedSnap.data().count;

    // 6. Late
    const lateSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '==', date)
      .where('status', '==', 'late')
      .count()
      .get();
    const late = lateSnap.data().count;

    // Queue doc lookup for delay, timeFactor, currentAppointmentId
    const queueSnap = await db.collection('queues').doc(`${targetDoctorId}_${date}`).get();
    const queueData = queueSnap.exists ? queueSnap.data() : {};
    const timeFactor = queueData.timeFactor !== undefined ? Number(queueData.timeFactor) : 1.0;
    const delayMin = queueData.delayMin || 0;
    const currentAppointmentId = queueData.currentAppointmentId || null;

    // Schedule status message adhering strictly to non-blaming wording rule
    let runningLateMsg = 'On schedule';
    if (delayMin > 0) {
      runningLateMsg = `Schedule is running ${delayMin} minutes behind: consultations are taking more time`;
    } else if (timeFactor > 1.15) {
      runningLateMsg = 'Consultations are taking more time';
    }

    const summaryData = {
      doctorId: targetDoctorId,
      date,
      total,
      waiting,
      inConsultation,
      completed,
      notArrived,
      late,
      timeFactor,
      delayMin,
      currentAppointmentId,
      runningLateMsg
    };

    dashboardSummaryCache.set(cacheKey, { data: summaryData, timestamp: Date.now() });

    res.status(200).json(formatSuccessResponse(summaryData));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/doctor/leaves/impact (PRD F2, Task A Requirement 5)
 * Calculates how many booked appointments fall within the requested leave window.
 */
export const getDoctorLeaveImpact = async (req, res, next) => {
  try {
    const fromAt = req.query.fromAt || req.query.startDate;
    const toAt = req.query.toAt || req.query.endDate;
    const doctorId = req.query.doctorId;
    if (!fromAt || !toAt) {
      throw new AppError('VALIDATION_ERROR', 'Start date and end date are required.', 400);
    }
    const db = assertDbConnected();
    const user = req.user;
    let targetDoctorId = doctorId || user.doctorId;
    if (!targetDoctorId) {
      const docSnap = await db.collection('doctors').doc(user.uid).get();
      targetDoctorId = docSnap.exists ? docSnap.data().doctorId : user.uid;
    }

    const fromDateStr = fromAt.split('T')[0];
    const toDateStr = toAt.split('T')[0];

    const countSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('date', '>=', fromDateStr)
      .where('date', '<=', toDateStr)
      .where('status', 'in', ['booked', 'confirmed'])
      .count()
      .get();

    const affectedAppointments = countSnap.data().count;

    res.status(200).json(formatSuccessResponse({
      doctorId: targetDoctorId,
      fromDate: fromDateStr,
      toDate: toDateStr,
      affectedAppointments,
      affectedAppointmentsCount: affectedAppointments
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/doctor/patients/search (PRD Task A Requirement 3)
 * Search by name prefix, Health ID, or token.
 * If two patients share a name, both are returned with their ages.
 */
export const doctorSearchPatients = async (req, res, next) => {
  try {
    const rawQuery = req.query.query || req.query.q;
    if (!rawQuery || !rawQuery.trim()) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }
    const db = assertDbConnected();
    const qTrim = rawQuery.trim();
    const qLower = qTrim.toLowerCase();
    const doctorUid = req.user.uid;

    let patientsFound = [];

    // 1. Direct Health ID check
    const directDoc = await db.collection('patients').doc(qTrim).get();
    if (directDoc.exists) {
      patientsFound.push({ id: directDoc.id, ...directDoc.data() });
    }

    // 2. Token search in appointments
    if (patientsFound.length === 0) {
      const tokenSnap = await db.collection('appointments')
        .where('tokenLabel', '==', qTrim)
        .limit(5)
        .get();
      if (!tokenSnap.empty) {
        for (const apptDoc of tokenSnap.docs) {
          const pId = apptDoc.data().patientHealthId;
          if (pId) {
            const pSnap = await db.collection('patients').doc(pId).get();
            if (pSnap.exists && !patientsFound.some((p) => (p.healthId || p.patientHealthId || p.id) === pId)) {
              patientsFound.push({ id: pSnap.id, ...pSnap.data() });
            }
          }
        }
      }
    }

    // 3. Name prefix search
    if (patientsFound.length === 0) {
      const searchNameSnap = await db.collection('patients')
        .where('searchName', '>=', qLower)
        .where('searchName', '<=', qLower + '\uf8ff')
        .limit(20)
        .get();

      searchNameSnap.docs.forEach((doc) => {
        patientsFound.push({ id: doc.id, ...doc.data() });
      });

      if (patientsFound.length === 0) {
        const nameLowerSnap = await db.collection('patients')
          .where('nameLower', '>=', qLower)
          .where('nameLower', '<=', qLower + '\uf8ff')
          .limit(20)
          .get();

        nameLowerSnap.docs.forEach((doc) => {
          patientsFound.push({ id: doc.id, ...doc.data() });
        });
      }

      if (patientsFound.length === 0) {
        const allPatientsSnap = await db.collection('patients').limit(50).get();
        allPatientsSnap.docs.forEach((doc) => {
          const data = doc.data();
          const fn = (data.fullName || data.name || '').toLowerCase();
          if (fn.includes(qLower) && !patientsFound.some((p) => p.id === doc.id)) {
            patientsFound.push({ id: doc.id, ...data });
          }
        });
      }
    }

    // Deduplicate patients by canonical healthId and exclude migrated pointers
    const seenHealthIds = new Set();
    const uniquePatients = [];
    for (const p of patientsFound) {
      if (p.migratedTo) continue;
      const hid = p.healthId || p.patientHealthId || p.id;
      if (!seenHealthIds.has(hid)) {
        seenHealthIds.add(hid);
        uniquePatients.push(p);
      }
    }

    // Map each patient to formatted response with computed age and last visit date
    const results = await Promise.all(
      uniquePatients.map(async (p) => {
        const healthId = p.healthId || p.patientHealthId || p.id;
        const computedYears = calculateAge(p.dob);
        const age = computedYears !== null ? `${computedYears} years` : (p.age ? `${p.age} years` : 'N/A');

        let lastVisitDate = 'None';
        const lastApptSnap = await db.collection('appointments')
          .where('patientHealthId', '==', healthId)
          .where('status', '==', 'completed')
          .limit(1)
          .get();
        if (!lastApptSnap.empty) {
          lastVisitDate = lastApptSnap.docs[0].data().date || 'Recent';
        }

        return {
          id: p.id || healthId,
          healthId,
          patientHealthId: healthId,
          name: p.fullName || p.name || 'Unknown',
          fullName: p.fullName || p.name || 'Unknown',
          age,
          gender: p.gender || 'other',
          lastVisitDate
        };
      })
    );

    // Audit log this search
    await writeAuditLog({
      actorUid: doctorUid,
      actorRole: req.user?.role || 'doctor',
      action: 'DOCTOR_PATIENT_SEARCH',
      targetType: 'patient_search',
      targetId: qTrim,
      requestId: req.requestId
    });

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/doctor/patients/my-patients (PRD Task A Requirement 3)
 * Patients seen by this doctor in the last 12 months (20 per page).
 */
export const doctorGetMyPatients = async (req, res, next) => {
  try {
    const user = req.user;
    const db = assertDbConnected();
    let targetDoctorId = user.doctorId;
    if (!targetDoctorId) {
      const docSnap = await db.collection('doctors').doc(user.uid).get();
      targetDoctorId = docSnap.exists ? docSnap.data().doctorId : user.uid;
    }

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

    const apptsSnap = await db.collection('appointments')
      .where('doctorId', '==', targetDoctorId)
      .where('status', '==', 'completed')
      .where('date', '>=', oneYearAgoStr)
      .limit(100)
      .get();

    const patientVisits = new Map();
    apptsSnap.docs.forEach((doc) => {
      const data = doc.data();
      const hId = data.patientHealthId;
      if (hId) {
        if (!patientVisits.has(hId) || data.date > patientVisits.get(hId)) {
          patientVisits.set(hId, data.date);
        }
      }
    });

    const uniqueHealthIds = Array.from(patientVisits.keys()).slice(0, 20);

    const patients = await Promise.all(
      uniqueHealthIds.map(async (healthId) => {
        const pSnap = await db.collection('patients').doc(healthId).get();
        const pData = pSnap.exists ? pSnap.data() : { name: 'Patient' };
        const computedYears = calculateAge(pData.dob);
        const age = computedYears !== null ? `${computedYears} years` : (pData.age || 'N/A');

        return {
          healthId,
          patientHealthId: healthId,
          name: pData.name || pData.fullName || 'Patient',
          fullName: pData.name || pData.fullName || 'Patient',
          age,
          gender: pData.gender || 'other',
          lastVisitDate: patientVisits.get(healthId) || 'Recent'
        };
      })
    );

    res.status(200).json(formatSuccessResponse(patients));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/doctor/patients/:healthId/access-check (PRD Task A Requirement 3)
 * Verifies if doctor has appointment in last 90 days or an active share.
 * Writes audit log if access is denied.
 */
export const doctorCheckPatientAccess = async (req, res, next) => {
  try {
    const { healthId } = req.params;
    const user = req.user;
    const db = assertDbConnected();
    const doctorUid = user.uid;

    let targetDoctorId = user.doctorId;
    if (!targetDoctorId) {
      const docSnap = await db.collection('doctors').doc(doctorUid).get();
      targetDoctorId = docSnap.exists ? docSnap.data().doctorId : doctorUid;
    }

    // 1. Check share grant in accessGrants
    const grantSnap = await db.collection('accessGrants')
      .where('granteeUid', '==', doctorUid)
      .where('patientHealthId', '==', healthId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    const hasActiveGrant = !grantSnap.empty && (
      !grantSnap.docs[0].data().expiryDate || new Date(grantSnap.docs[0].data().expiryDate) > new Date()
    );

    if (hasActiveGrant) {
      return res.status(200).json(formatSuccessResponse({ hasAccess: true, reason: 'active_share_grant' }));
    }

    // 2. Check appointment in last 90 days (queried by patientHealthId to avoid un-deployed composite index failure)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];

    const apptSnap = await db.collection('appointments')
      .where('patientHealthId', '==', healthId)
      .limit(50)
      .get();

    const hasTreatingRelationship = apptSnap.docs.some((doc) => {
      const data = doc.data();
      const isDocMatch = data.doctorId === targetDoctorId || data.doctorId === doctorUid || data.doctorUid === doctorUid;
      return isDocMatch && data.date >= ninetyDaysAgoStr;
    });

    if (hasTreatingRelationship) {
      return res.status(200).json(formatSuccessResponse({ hasAccess: true, reason: 'treating_doctor_90days' }));
    }

    // No access: Write audit log
    await writeAuditLog({
      actorUid: doctorUid,
      actorRole: user.role || 'doctor',
      action: 'PATIENT_HISTORY_ACCESS_DENIED',
      targetType: 'patient',
      targetId: healthId,
      healthId,
      requestId: req.requestId
    });

    return res.status(200).json(formatSuccessResponse({
      hasAccess: false,
      message: 'No access. Ask the patient to share their history'
    }));
  } catch (error) {
    next(error);
  }
};

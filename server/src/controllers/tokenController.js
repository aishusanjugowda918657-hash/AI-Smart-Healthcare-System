import { assertDbConnected } from '../config/firebase.js';
import { calculatePriorityScore, sortQueueTokens } from '../services/tokenPriorityEngine.js';
import { calculateWaitingTime, parseFirestoreDate } from '../services/waitingTimeCalculator.js';
import { clock } from '../utils/clock.js';
import { getHospitalTodayStr, parseSlotTimeToDate, formatHospitalTime, formatSlotTimeDisplay } from '../utils/timezoneDate.js';
import { getGlobalSettings } from '../services/settingsService.js';
import { computeQueueSnapshot } from '../services/queueService.js';
import { callNextPatient as queueCallNextPatient, finishConsultation as queueFinishConsultation } from './queueController.js';
import { checkAndDispatchCheckinReminders } from '../services/notificationService.js';

/**
 * Check-in appointment & generate priority token
 */
export const checkinAndGenerateToken = async (req, res, next) => {
  try {
    const { uid: patientUid, role } = req.user;
    const { appointmentId, priorityCategory = 'STANDARD', staffVerified = false } = req.body;

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Appointment ID is required for check-in.'
      });
    }

    const db = assertDbConnected();
    const apptRef = db.collection('appointments').doc(appointmentId);
    const apptDoc = await apptRef.get();

    if (!apptDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Appointment record not found.'
      });
    }

    const apptData = apptDoc.data();
    const date = apptData.date;
    const doctorUid = apptData.doctorUid;

    const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
    if (!isStaff && apptData.patientUid && apptData.patientUid !== patientUid) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only check in for your own appointment.'
      });
    }
    // Fix SEC-Q1: Only authorized healthcare staff can assert staffVerified or override priorityCategory
    const verified = isStaff ? Boolean(staffVerified ?? true) : false;
    const effectivePriorityCategory = isStaff
      ? (priorityCategory || apptData.priorityCategory || 'STANDARD')
      : (apptData.priorityCategory || 'STANDARD');

    const priorityScore = calculatePriorityScore(effectivePriorityCategory, verified);

    const todayTokens = await db
      .collection('tokens')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', date)
      .get();

    const sequenceNumber = todayTokens.size + 1;
    const tokenNumber = `T-${String(sequenceNumber).padStart(3, '0')}`;
    const tokenId = `tok-${appointmentId}`;

    const tokenData = {
      id: tokenId,
      tokenNumber,
      appointmentId,
      patientUid: apptData.patientUid,
      patientHealthId: apptData.patientHealthId,
      doctorUid,
      doctorId: apptData.doctorId,
      departmentId: apptData.departmentId,
      date,
      priorityCategory: effectivePriorityCategory,
      priorityScore,
      staffVerified: verified,
      sequenceNumber,
      status: 'waiting',
      generatedAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('tokens').doc(tokenId).set(tokenData, { merge: true });

    await apptRef.update({
      status: 'CHECKED_IN',
      updatedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: `Checked in successfully. Priority Token ${tokenNumber} generated.`,
      data: tokenData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get ordered queue for a doctor on a date
 */
export const getDoctorQueue = async (req, res, next) => {
  try {
    const { doctorUid } = req.params;
    const date = req.query.date || getHospitalTodayStr();
    const db = assertDbConnected();

    const snapshot = await db
      .collection('tokens')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', date)
      .get();

    const rawTokens = snapshot.docs.map((d) => d.data());
    const sortedQueue = sortQueueTokens(rawTokens);

    res.status(200).json({
      success: true,
      date,
      doctorUid,
      data: sortedQueue
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Doctor calls next patient in queue
 */
export const callNextPatient = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const date = req.body.date || getHospitalTodayStr();
    const { tokenId } = req.body;
    const db = assertDbConnected();

    let nextToken = null;

    if (tokenId) {
      let tokenRef = db.collection('tokens').doc(tokenId);
      let doc = await tokenRef.get();
      if (!doc.exists) {
        const tSnap = await db.collection('tokens').where('appointmentId', '==', tokenId).get();
        if (!tSnap.empty) {
          doc = tSnap.docs[0];
          tokenRef = doc.ref;
        } else {
          const tSnap2 = await db.collection('tokens').where('id', '==', tokenId).get();
          if (!tSnap2.empty) {
            doc = tSnap2.docs[0];
            tokenRef = doc.ref;
          }
        }
      }
      if (doc.exists) {
        nextToken = { id: doc.id, ...doc.data() };
      }
    }

    if (!nextToken) {
      const snapshot = await db
        .collection('tokens')
        .where('doctorUid', '==', doctorUid)
        .where('date', '==', date)
        .where('status', '==', 'waiting')
        .get();

      if (snapshot.empty) {
        return res.status(200).json({
          success: true,
          message: 'No waiting patients in queue.',
          data: null
        });
      }

      const waitingTokens = snapshot.docs.map((d) => d.data());
      const sortedWaiting = sortQueueTokens(waitingTokens);
      nextToken = sortedWaiting[0];
    }

    // Complete any currently serving token for this doctor on this date
    try {
      const servingSnap = await db
        .collection('tokens')
        .where('doctorUid', '==', doctorUid)
        .where('date', '==', date)
        .where('status', '==', 'serving')
        .get();

      for (const sDoc of servingSnap.docs) {
        if (sDoc.id !== (nextToken.id || `tok-${nextToken.appointmentId}`)) {
          await sDoc.ref.update({ status: 'completed', completedAt: new Date(), updatedAt: new Date() });
          const sData = sDoc.data();
          if (sData.appointmentId) {
            try {
              let apptRef = db.collection('appointments').doc(sData.appointmentId);
              let apptDoc = await apptRef.get();
              if (!apptDoc.exists) {
                const aSnap = await db.collection('appointments').where('appointmentId', '==', sData.appointmentId).get();
                if (!aSnap.empty) apptRef = aSnap.docs[0].ref;
              }
              await apptRef.update({ status: 'COMPLETED', updatedAt: new Date() });
            } catch (aErr) {}
          }
        }
      }
    } catch (sErr) {
      console.warn('Error completing previous serving token:', sErr.message);
    }

    const targetTokenId = nextToken.id || `tok-${nextToken.appointmentId}`;
    let tokenRef = db.collection('tokens').doc(targetTokenId);
    let tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
      const tSnap = await db.collection('tokens').where('appointmentId', '==', nextToken.appointmentId).get();
      if (!tSnap.empty) tokenRef = tSnap.docs[0].ref;
    }

    await tokenRef.update({
      status: 'serving',
      calledAt: new Date(),
      updatedAt: new Date()
    });

    if (nextToken.appointmentId) {
      let apptRef = db.collection('appointments').doc(nextToken.appointmentId);
      let apptDoc = await apptRef.get();
      if (!apptDoc.exists) {
        const aSnap = await db.collection('appointments').where('appointmentId', '==', nextToken.appointmentId).get();
        if (!aSnap.empty) apptRef = aSnap.docs[0].ref;
      }
      await apptRef.update({
        status: 'IN_CONSULTATION',
        updatedAt: new Date()
      });
    }

    try {
      await recalculateQueue(doctorUid, date);
    } catch (_) {}

    res.status(200).json({
      success: true,
      message: `Calling patient ${nextToken.patientHealthId} (Token ${nextToken.tokenNumber}).`,
      data: {
        ...nextToken,
        status: 'serving',
        calledAt: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete current consultation & log actual duration in minutes
 */
export const completeCurrentConsultation = async (req, res, next) => {
  try {
    const { tokenId } = req.body;
    const { uid: doctorUid } = req.user;

    if (!tokenId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Token ID is required.'
      });
    }

    const db = assertDbConnected();
    let tokenRef = db.collection('tokens').doc(tokenId);
    let tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
      const tSnap = await db.collection('tokens').where('appointmentId', '==', tokenId).get();
      if (!tSnap.empty) {
        tokenDoc = tSnap.docs[0];
        tokenRef = tokenDoc.ref;
      } else {
        const tSnap2 = await db.collection('tokens').where('id', '==', tokenId).get();
        if (!tSnap2.empty) {
          tokenDoc = tSnap2.docs[0];
          tokenRef = tokenDoc.ref;
        }
      }
    }

    if (!tokenDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Token record not found.'
      });
    }

    const tokenData = tokenDoc.data();
    const calledAt = parseFirestoreDate(tokenData.calledAt) || new Date();
    const completedAt = new Date();

    const durationMs = Math.max(0, completedAt.getTime() - calledAt.getTime());
    const actualDurationMinutes = Math.max(1, Math.round(durationMs / 60000));

    await tokenRef.update({
      status: 'completed',
      completedAt,
      actualDurationMinutes,
      updatedAt: new Date()
    });

    if (tokenData.appointmentId) {
      let apptRef = db.collection('appointments').doc(tokenData.appointmentId);
      let apptDoc = await apptRef.get();
      if (!apptDoc.exists) {
        const aSnap = await db.collection('appointments').where('appointmentId', '==', tokenData.appointmentId).get();
        if (!aSnap.empty) {
          apptRef = aSnap.docs[0].ref;
        }
      }
      await apptRef.update({
        status: 'COMPLETED',
        updatedAt: new Date()
      });
    }

    try {
      const apptDoc = tokenData.appointmentId ? await db.collection('appointments').doc(tokenData.appointmentId).get() : null;
      const targetDocId = apptDoc?.exists ? (apptDoc.data().doctorId || doctorUid) : doctorUid;
      const targetDate = apptDoc?.exists ? (apptDoc.data().date || tokenData.date) : (tokenData.date || getHospitalTodayStr());
      await recalculateQueue(targetDocId, targetDate);
    } catch (_) {}

    res.status(200).json({
      success: true,
      message: `Consultation completed. Logged duration: ${actualDurationMinutes} mins.`,
      data: {
        tokenId,
        actualDurationMinutes
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate multi-variable waiting time estimate for a patient token
 */
export const getWaitingTimeEstimate = async (req, res, next) => {
  try {
    const { doctorUid, tokenId } = req.query;

    if (!doctorUid || !tokenId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: doctorUid and tokenId are required.'
      });
    }

    const db = assertDbConnected();
    const date = getHospitalTodayStr();

    // 1. Fetch Doctor info & schedule
    const docDoc = await db.collection('doctors').doc(doctorUid).get();
    const avgConsultationTimeMinutes = docDoc.exists ? (docDoc.data().avgConsultationTimeMinutes || 15) : 15;

    const schedDoc = await db.collection('doctorSchedules').doc(`sched-${doctorUid}`).get();
    const breakTimes = schedDoc.exists ? (schedDoc.data().breakTimes || []) : [{ start: '13:00', end: '14:00' }];

    // 2. Fetch today's queue tokens
    const snapshot = await db
      .collection('tokens')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', date)
      .get();

    const tokens = snapshot.docs.map((d) => d.data());
    const currentServingToken = tokens.find((t) => t.status === 'serving') || null;

    const waitingTokens = sortQueueTokens(tokens.filter((t) => t.status === 'waiting'));
    const targetIndex = waitingTokens.findIndex((t) => t.id === tokenId);

    const patientsAheadTokens = targetIndex !== -1 ? waitingTokens.slice(0, targetIndex) : waitingTokens;

    // 3. Compute waiting time
    const result = calculateWaitingTime({
      currentServingToken,
      patientsAheadTokens,
      avgConsultationTimeMinutes,
      breakTimes,
      nowDate: new Date()
    });

    res.status(200).json({
      success: true,
      data: {
        tokenId,
        doctorUid,
        ...result
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get real-time queue status dashboard payload for authenticated patient
 */
export const getMyQueueStatus = async (req, res, next) => {
  try {
    const { uid: patientUid } = req.user;
    const db = assertDbConnected();
    const now = clock.now();
    const todayStr = getHospitalTodayStr(now);
    const settings = await getGlobalSettings();
    const graceMin = settings.graceMin || settings.graceMinutes || 5;

    // Get patient record to check patientHealthId for fallback lookups
    let patientHealthId = null;
    try {
      const pDoc = await db.collection('patients').doc(patientUid).get();
      if (pDoc.exists) {
        patientHealthId = pDoc.data().patientHealthId || null;
      }
    } catch (pErr) {
      console.warn('Patient doc lookup warning in queue status:', pErr.message);
    }

    // 1. Fetch patient's appointments (by patientUid primary, fallback to bookedBy & patientHealthId)
    const apptsSnapshot = await db
      .collection('appointments')
      .where('patientUid', '==', patientUid)
      .get();

    let allAppts = apptsSnapshot.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));

    if (allAppts.length === 0) {
      const bookedSnap = await db
        .collection('appointments')
        .where('bookedBy', '==', patientUid)
        .get();
      allAppts = bookedSnap.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));
    }

    if (allAppts.length === 0) {
      const ownerSnap = await db
        .collection('appointments')
        .where('ownerUid', '==', patientUid)
        .get();
      allAppts = ownerSnap.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));
    }

    if (allAppts.length === 0) {
      const pIdSnap = await db
        .collection('appointments')
        .where('patientId', '==', patientUid)
        .get();
      allAppts = pIdSnap.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));
    }

    if (allAppts.length === 0 && patientHealthId) {
      const hidSnap = await db
        .collection('appointments')
        .where('patientHealthId', '==', patientHealthId)
        .get();
      allAppts = hidSnap.docs.map((d) => ({ id: d.id, appointmentId: d.data().appointmentId || d.id, ...d.data() }));
    }

    // Fallback: Check tokens collection — ONLY active (waiting/serving) tokens
    // then load their parent appointment.
    if (allAppts.length === 0) {
      let tokenSnap = await db
        .collection('tokens')
        .where('patientUid', '==', patientUid)
        .where('status', 'in', ['waiting', 'serving'])
        .get();
      if (tokenSnap.empty && patientHealthId) {
        tokenSnap = await db
          .collection('tokens')
          .where('patientHealthId', '==', patientHealthId)
          .where('status', 'in', ['waiting', 'serving'])
          .get();
      }
      if (!tokenSnap.empty) {
        const apptsMap = new Map();
        for (const tDoc of tokenSnap.docs) {
          const tData = tDoc.data();
          if (tData.appointmentId) {
            const aDoc = await db.collection('appointments').doc(tData.appointmentId).get();
            if (aDoc.exists) {
              const aId = aDoc.data().appointmentId || aDoc.id;
              if (!apptsMap.has(aId)) {
                apptsMap.set(aId, true);
                allAppts.push({ id: aDoc.id, appointmentId: aId, ...aDoc.data() });
              }
            }
          }
        }
      }
    }

    if (allAppts.length === 0) {
      return res.status(200).json({
        success: true,
        hasAppointment: false,
        message: 'No active appointment found.'
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTIVE APPOINTMENT SELECTION & AUTHORITATIVE EXPIRY ENFORCEMENT
    // Terminal statuses that MUST NOT appear in the live queue:
    const INACTIVE_STATUSES = new Set([
      'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED', 'REJECTED', 'EXPIRED'
    ]);

    const activeAppts = [];
    for (const a of allAppts) {
      if (!a.status || INACTIVE_STATUSES.has(a.status.toUpperCase())) {
        continue;
      }

      // Check date boundaries in Asia/Kolkata
      const apptDate = a.date || todayStr;
      if (apptDate < todayStr) {
        // Stale appointment from a past day: transition to terminal NO_SHOW
        try {
          await db.collection('appointments').doc(a.id).update({
            status: 'no_show',
            noShowAt: now,
            updatedAt: now
          });
          const targetApptId = a.appointmentId || a.id;
          const tokRef = db.collection('tokens').doc(`tok-${targetApptId}`);
          await tokRef.set({ status: 'no_show', noShowAt: now, updatedAt: now }, { merge: true });
        } catch (e) {
          console.warn('Error transitioning past appointment to no-show:', e.message);
        }
        continue; // Discard from active appointments
      }

      // Preserve active same-day appointment without premature silent cancellation.
      // Silent no-show and grace timeouts are strictly handled by noShowSweepJob (Rule B5 & B8).
      activeAppts.push(a);
    }

    // Sort active appointments newest-first by appointmentId descending.
    if (activeAppts.length > 1) {
      activeAppts.sort((a, b) => {
        const idA = a.appointmentId || a.id || '';
        const idB = b.appointmentId || b.id || '';
        if (idB > idA) return 1;
        if (idA > idB) return -1;
        const tA = a.createdAt?.toDate
          ? a.createdAt.toDate().getTime()
          : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const tB = b.createdAt?.toDate
          ? b.createdAt.toDate().getTime()
          : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return tB - tA;
      });
    }

    // If ALL appointments are terminal, check if any are COMPLETED so we can
    // show the patient their consultation-completed status on the Live Queue.
    // For purely cancelled/rejected appointments, return hasAppointment:false.
    let activeAppt = activeAppts.length > 0 ? activeAppts[0] : null;

    if (!activeAppt) {
      const completedAppts = allAppts.filter(
        (a) => a.status && a.status.toUpperCase() === 'COMPLETED'
      );
      const sessionEndedAppts = allAppts.filter(
        (a) => a.sessionEnded === true || (a.status === 'no_show' && (a.reason === 'Doctor session ended' || a.displayStatus === 'OPD Session Ended'))
      );

      if (completedAppts.length > 0) {
        // Show the most-recently completed appointment
        completedAppts.sort((a, b) => {
          const idA = a.appointmentId || a.id || '';
          const idB = b.appointmentId || b.id || '';
          if (idB > idA) return 1;
          if (idA > idB) return -1;
          return 0;
        });
        activeAppt = completedAppts[0];
      } else if (sessionEndedAppts.length > 0) {
        sessionEndedAppts.sort((a, b) => {
          const idA = a.appointmentId || a.id || '';
          const idB = b.appointmentId || b.id || '';
          if (idB > idA) return 1;
          if (idA > idB) return -1;
          return 0;
        });
        activeAppt = sessionEndedAppts[0];
      } else {
        return res.status(200).json({
          success: true,
          hasAppointment: false,
          hasToken: false,
          message: 'No active appointment found for today.',
          queueStatus: 'NO_APPOINTMENT',
          queuePosition: 0,
          patientsAhead: 0,
          estimatedWaitMinutes: 0,
          estimatedTurnTime: null,
          currentlyServing: null
        });
      }
    }

    const doctorUid = activeAppt.doctorUid || 'doc-uid-001';
    const targetDoctorId = activeAppt.doctorId || activeAppt.doctorUid || doctorUid;
    const apptDate = activeAppt.date || todayStr;
    const targetApptId = activeAppt.appointmentId || activeAppt.id;

    // 2. Fetch Authoritative Queue Snapshot from shared queueService engine
    const snapshot = await computeQueueSnapshot(targetDoctorId, apptDate, { db, now });

    // 3. Fetch doctor and department metadata
    const docDoc = await db.collection('doctors').doc(activeAppt.doctorUid || targetDoctorId).get().catch(() => null);
    let docData = (docDoc && docDoc.exists) ? docDoc.data() : {};
    if (!docData.fullName && !docData.name && targetDoctorId) {
      const docSnap2 = await db.collection('doctors').where('doctorId', '==', targetDoctorId).limit(1).get().catch(() => null);
      if (docSnap2 && !docSnap2.empty) docData = docSnap2.docs[0].data();
    }
    const doctorName = docData.fullName || docData.name || activeAppt.doctorName || 'Doctor';

    let departmentName = 'General OPD';
    if (activeAppt.departmentName) {
      departmentName = activeAppt.departmentName;
    } else if (activeAppt.departmentId) {
      const deptDoc = await db.collection('departments').doc(activeAppt.departmentId).get().catch(() => null);
      departmentName = (deptDoc && deptDoc.exists) ? deptDoc.data().name : 'General OPD';
    }

    // 4. Locate patient's token
    let myToken = null;
    if (targetApptId) {
      const tokenDoc = await db.collection('tokens').doc(`tok-${targetApptId}`).get().catch(() => null);
      if (tokenDoc && tokenDoc.exists) {
        myToken = { id: tokenDoc.id, ...tokenDoc.data() };
      } else if (activeAppt.tokenId) {
        const tokenDoc2 = await db.collection('tokens').doc(activeAppt.tokenId).get().catch(() => null);
        if (tokenDoc2 && tokenDoc2.exists) myToken = { id: tokenDoc2.id, ...tokenDoc2.data() };
      }
      if (!myToken) {
        const tokenQuery = await db.collection('tokens').where('appointmentId', '==', targetApptId).limit(1).get().catch(() => null);
        if (tokenQuery && !tokenQuery.empty) myToken = { id: tokenQuery.docs[0].id, ...tokenQuery.docs[0].data() };
      }
    }

    const tokenNumber = myToken?.tokenNumber || activeAppt.tokenNumber || activeAppt.tokenLabel || 'G-001';

    // 5. Derive canonical lifecycle state
    const apptStatusLower = (activeAppt.status || '').toLowerCase();
    const tokenStatusLower = (myToken?.status || '').toLowerCase();
    const isCancelled = apptStatusLower === 'cancelled' || tokenStatusLower === 'cancelled';
    const isCompleted = apptStatusLower === 'completed' || tokenStatusLower === 'completed';

    const isServing =
      ['in_consultation', 'in_room', 'serving'].includes(apptStatusLower) ||
      ['in_consultation', 'in_room', 'serving'].includes(tokenStatusLower) ||
      (snapshot.currentConsultation?.id === targetApptId && ['in_consultation', 'in_room', 'serving'].includes(String(snapshot.currentConsultation?.status || '').toLowerCase()));

    const isCalled = !isServing && (
      apptStatusLower === 'called' ||
      tokenStatusLower === 'called' ||
      (snapshot.currentConsultation?.id === targetApptId && snapshot.currentConsultation?.status === 'called')
    );

    const isFutureAppointment = !isServing && !isCalled && !isCompleted && apptDate > todayStr;

    // 6. Look up position in authoritative readyCandidates and notCheckedIn
    const readyIdx = snapshot.readyCandidates.findIndex(
      (c) => c.id === targetApptId || (c.appointmentId && c.appointmentId === targetApptId)
    );
    const notCheckedIdx = snapshot.notCheckedIn.findIndex(
      (c) => c.id === targetApptId || (c.appointmentId && c.appointmentId === targetApptId)
    );

    const totalActiveQueue = snapshot.readyCandidates.length + (snapshot.currentConsultation ? 1 : 0);

    let myPositionNum = -1;
    let positionText = 'WAITING';
    let patientsAhead = 0;
    let waitResult = {
      estimatedWaitMinutes: null,
      estimatedTurnTime: 'Calculating...',
      patientsAhead: 0,
      isEstimate: true,
      calculationBasis: 'Calculating...'
    };
    let liveWait = null;

    const rawSlot = activeAppt.timeSlot || activeAppt.bookedStartAt || activeAppt.time || '09:00';
    const scheduledSlotTime = formatSlotTimeDisplay(rawSlot);
    const apptDateObj = parseSlotTimeToDate(apptDate, rawSlot);
    const apptTimeMs = apptDateObj ? apptDateObj.getTime() : now.getTime();
    const isCheckedIn = !!activeAppt.checkedInAt || ['checked_in', 'waiting', 'called', 'in_consultation', 'in_room', 'completed'].includes(apptStatusLower);
    const checkinRequired = !isCheckedIn && ['booked', 'confirmed', 'not_arrived'].includes(apptStatusLower);
    const isOverdue = checkinRequired && now.getTime() > apptTimeMs;
    const overdueMinutes = isOverdue ? Math.max(0, Math.floor((now.getTime() - apptTimeMs) / 60000)) : 0;

    // Dispatches at-time or overdue check-in notification if not already sent
    if (checkinRequired) {
      try {
        await checkAndDispatchCheckinReminders({
          appointment: activeAppt,
          appointmentId: targetApptId,
          userUid: req.user?.uid,
          db,
          now
        });
      } catch (remErr) {
        console.warn('Check-in notification dispatch warning:', remErr.message);
      }
    }

    const isSessionEnded =
      activeAppt.sessionEnded === true ||
      myToken?.sessionEnded === true ||
      snapshot.queueData.sessionEnded === true ||
      snapshot.queueData.status === 'completed' ||
      (activeAppt.status === 'no_show' && (activeAppt.reason === 'Doctor session ended' || activeAppt.displayStatus === 'OPD Session Ended'));

    if (isCompleted) {
      positionText = 'CONSULTATION COMPLETED';
      myPositionNum = 1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: 0,
        estimatedTurnTime: 'Completed',
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        calculationBasis: 'Consultation Completed'
      };
      liveWait = null;
    } else if (isSessionEnded) {
      positionText = 'OPD SESSION CONCLUDED';
      myPositionNum = -1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: 0,
        estimatedTurnTime: 'Session Concluded',
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        calculationBasis: 'Doctor session ended for today'
      };
      liveWait = null;
    } else if (isCancelled) {
      positionText = 'APPOINTMENT CANCELLED';
      myPositionNum = -1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: null,
        estimatedTurnTime: 'Cancelled',
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        calculationBasis: 'Appointment Cancelled'
      };
      liveWait = null;
    } else if (isServing) {
      const isServingExact = myToken?.status === 'serving' || apptStatusLower === 'serving';
      positionText = isServingExact ? 'NOW SERVING' : 'Consultation in progress';
      myPositionNum = 1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: 0,
        estimatedTurnTime: isServingExact ? 'In Room Now' : 'In Consultation Now',
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        calculationBasis: 'Consultation in progress'
      };
      liveWait = {
        waitMinLow: null,
        waitMinHigh: null,
        predictedCallAt: null,
        reasonText: 'Consultation in progress',
        position: 1,
        aheadCount: 0,
        updatedAt: now.toISOString()
      };
    } else if (isCalled) {
      positionText = 'NOW CALLED';
      myPositionNum = 1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: 0,
        estimatedTurnTime: 'Turn Called - Proceed to Room',
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        calculationBasis: 'Called for Consultation'
      };
      liveWait = {
        waitMinLow: null,
        waitMinHigh: null,
        predictedCallAt: null,
        reasonText: 'Turn called - please proceed inside consultation room',
        position: 1,
        aheadCount: 0,
        updatedAt: now.toISOString()
      };
    } else if (isFutureAppointment) {
      positionText = 'SCHEDULED';
      myPositionNum = -1;
      patientsAhead = 0;
      waitResult = {
        estimatedWaitMinutes: null,
        estimatedTurnTime: scheduledSlotTime,
        scheduledSlotTime,
        patientsAhead: 0,
        isEstimate: false,
        isFutureAppointment: true,
        calculationBasis: `Scheduled for ${apptDate} at ${scheduledSlotTime}`
      };
      liveWait = null;
    } else if (readyIdx !== -1) {
      const cand = snapshot.readyCandidates[readyIdx];
      myPositionNum = readyIdx + 1;
      patientsAhead = readyIdx;
      positionText = myPositionNum === 1
        ? 'Next in Line (#1)'
        : `Waiting (${myPositionNum} of ${totalActiveQueue})`;
      liveWait = cand.live || {};
      const waitMinLow = liveWait.waitMinLow != null ? liveWait.waitMinLow : 0;
      const waitMinHigh = liveWait.waitMinHigh != null ? liveWait.waitMinHigh : 5;
      const estWait = Math.round((waitMinLow + waitMinHigh) / 2);

      let estTurn = 'Turn Imminent (In Progress)';
      if (liveWait.predictedCallAt) {
        const predMs = new Date(liveWait.predictedCallAt).getTime();
        if (predMs > now.getTime()) {
          estTurn = formatHospitalTime(liveWait.predictedCallAt);
        } else {
          estTurn = 'Turn Imminent (In Progress)';
        }
      } else if (estWait > 0) {
        const projectedDate = new Date(now.getTime() + estWait * 60 * 1000);
        estTurn = formatHospitalTime(projectedDate);
      }

      waitResult = {
        estimatedWaitMinutes: estWait,
        estimatedTurnTime: estTurn,
        scheduledSlotTime,
        patientsAhead,
        isEstimate: true,
        calculationBasis: liveWait.reasonText || 'Authoritative Live Queue Engine'
      };
    } else if (notCheckedIdx !== -1) {
      const cand = snapshot.notCheckedIn[notCheckedIdx];
      myPositionNum = snapshot.readyCandidates.length + notCheckedIdx + 1;
      patientsAhead = cand.live?.aheadCount ?? (snapshot.readyCandidates.length + notCheckedIdx);
      positionText = isOverdue
        ? `Appointment Time Passed — Check in now (${overdueMinutes}m late)`
        : 'Scheduled (Awaiting Check-in)';
      liveWait = cand.live || {};
      const estWait = (liveWait.waitMinLow != null && liveWait.waitMinHigh != null)
        ? Math.round((liveWait.waitMinLow + liveWait.waitMinHigh) / 2)
        : null;

      let estTurn = isOverdue ? 'Check-in Required to Join Queue' : scheduledSlotTime;
      if (!isOverdue && liveWait.predictedCallAt && new Date(liveWait.predictedCallAt).getTime() > now.getTime()) {
        estTurn = formatHospitalTime(liveWait.predictedCallAt);
      }

      waitResult = {
        estimatedWaitMinutes: estWait,
        estimatedTurnTime: estTurn,
        scheduledSlotTime,
        patientsAhead,
        isEstimate: true,
        calculationBasis: isOverdue ? 'Awaiting Late Check-in' : 'Awaiting Check-in'
      };
    } else {
      myPositionNum = snapshot.readyCandidates.length + 1;
      patientsAhead = snapshot.readyCandidates.length;
      positionText = checkinRequired
        ? (isOverdue ? `Appointment Time Passed — Check in now (${overdueMinutes}m late)` : 'Check-in Required')
        : `Waiting (${myPositionNum} of ${totalActiveQueue || 1})`;

      let estTurn = 'Turn Imminent (In Progress)';
      if (checkinRequired) {
        estTurn = isOverdue ? 'Check-in Required to Join Queue' : scheduledSlotTime;
      } else {
        const projected = new Date(now.getTime() + 10 * 60 * 1000);
        estTurn = formatHospitalTime(projected);
      }

      waitResult = {
        estimatedWaitMinutes: checkinRequired ? null : 10,
        estimatedTurnTime: estTurn,
        scheduledSlotTime,
        patientsAhead,
        isEstimate: true,
        calculationBasis: checkinRequired ? 'Check-in Required' : 'Authoritative Live Queue Engine'
      };
      liveWait = activeAppt.live || null;
    }

    // 7. Format Currently Serving section data
    let currentlyServingData = null;
    if (isServing && targetApptId) {
      const startRef = activeAppt.consultStartAt || myToken?.startedAt || myToken?.consultStartAt;
      const startDate = startRef ? new Date(startRef) : now;
      const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / 60000));
      currentlyServingData = {
        tokenNumber: tokenNumber || 'Active',
        doctorName,
        departmentName,
        status: 'Consultation in progress',
        startedAt: formatHospitalTime(startDate),
        elapsedMinutes
      };
    } else if (snapshot.currentConsultation) {
      const c = snapshot.currentConsultation;
      const startRef = c.consultStartAt || c.calledAt;
      const startDate = startRef ? new Date(startRef) : now;
      const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startDate.getTime()) / 60000));
      currentlyServingData = {
        tokenNumber: c.tokenLabel || c.tokenNumber || 'Active',
        doctorName,
        departmentName,
        status: c.status === 'called'
          ? 'Called - Entering Room'
          : (snapshot.extendMin > 0 ? `In Consultation (+${snapshot.extendMin}m extended)` : 'In Consultation'),
        startedAt: formatHospitalTime(startDate),
        elapsedMinutes,
        extendMin: snapshot.extendMin || 0
      };
    }

    // 8. Construct authoritative queue timeline
    const queueTimeline = [];
    const lastCompleted = (snapshot.completedAppts || []).slice(-2);
    lastCompleted.forEach((a) => {
      queueTimeline.push({
        tokenNumber: a.tokenLabel || a.tokenNumber || 'Done',
        status: 'completed',
        label: 'Completed',
        isMe: a.id === targetApptId
      });
    });

    if (snapshot.currentConsultation) {
      const isCurMe = snapshot.currentConsultation.id === targetApptId;
      queueTimeline.push({
        tokenNumber: snapshot.currentConsultation.tokenLabel || snapshot.currentConsultation.tokenNumber || 'Active',
        status: snapshot.currentConsultation.status === 'called' ? 'called' : 'serving',
        label: isServing ? 'Consultation in progress' : (snapshot.currentConsultation.status === 'called' ? 'Now Called' : 'Currently Serving'),
        isMe: isServing || isCurMe
      });
    }

    snapshot.readyCandidates.forEach((c) => {
      const isMe = c.id === targetApptId;
      queueTimeline.push({
        tokenNumber: c.tokenLabel || c.tokenNumber || 'Waiting',
        status: 'waiting',
        label: isMe ? 'Your Token' : 'Waiting',
        isMe
      });
    });

    res.status(200).json({
      success: true,
      hasAppointment: true,
      hasToken: !!tokenNumber,
      isCancelled,
      isCompleted,
      sessionEnded: isSessionEnded,
      isFutureAppointment: !!isFutureAppointment,
      appointment: {
        id: activeAppt.id || targetApptId,
        appointmentId: targetApptId,
        displayId: activeAppt.displayId || activeAppt.appointmentId || activeAppt.id,
        doctorUid,
        doctorName,
        departmentId: activeAppt.departmentId,
        departmentName,
        date: activeAppt.date,
        timeSlot: activeAppt.timeSlot || activeAppt.bookedStartAt || activeAppt.time || '',
        bookedStartAt: activeAppt.bookedStartAt || activeAppt.timeSlot || activeAppt.time || '',
        scheduledSlotTime,
        priorityCategory: activeAppt.priorityCategory || (activeAppt.clinicalLevel === 3 ? 'EMERGENCY' : activeAppt.clinicalLevel === 2 ? 'HIGH' : 'STANDARD'),
        clinicalLevel: activeAppt.clinicalLevel || 1,
        urgencySuggested: activeAppt.urgencySuggested || activeAppt.urgency || 'routine',
        patientHealthId: activeAppt.patientHealthId,
        reason: activeAppt.reason,
        status: isServing ? 'in_consultation' : activeAppt.status,
        checkinRequired,
        isOverdue,
        overdueMinutes
      },
      token: {
        tokenNumber,
        status: isServing ? 'in_consultation' : (myToken?.status || (isCancelled ? 'cancelled' : isCompleted ? 'completed' : isFutureAppointment ? 'scheduled' : 'waiting')),
        priorityCategory: activeAppt.priorityCategory || (activeAppt.clinicalLevel === 3 ? 'EMERGENCY' : activeAppt.clinicalLevel === 2 ? 'HIGH' : 'STANDARD')
      },
      queueStatus: isSessionEnded ? 'SESSION_ENDED' : (isCompleted ? 'COMPLETED' : isCancelled ? 'CANCELLED' : isServing ? 'SERVING' : isCalled ? 'CALLED' : 'WAITING'),
      queueSummary: {
        queueStatus: isSessionEnded ? 'SESSION_ENDED' : (isCompleted ? 'COMPLETED' : isCancelled ? 'CANCELLED' : isServing ? 'SERVING' : isCalled ? 'CALLED' : 'WAITING'),
        positionText,
        positionNumber: (isServing || isCalled) ? 1 : myPositionNum,
        patientsAhead,
        totalActiveQueue,
        estimatedWaitMinutes: isFutureAppointment ? null : waitResult.estimatedWaitMinutes,
        estimatedTurnTime: waitResult.estimatedTurnTime,
        scheduledSlotTime,
        checkinRequired,
        isOverdue,
        overdueMinutes,
        isEstimate: waitResult.isEstimate || false,
        isFutureAppointment: !!isFutureAppointment,
        calculationBasis: waitResult.calculationBasis || 'Authoritative Live Queue Engine',
        calculatedAt: now.toISOString()
      },
      liveWait,
      leaveHome: null,
      earlyOptIn: activeAppt.earlyOptIn || false,
      currentlyServing: currentlyServingData,
      queueTimeline: queueTimeline.slice(0, 7)
    });
  } catch (error) {
    next(error);
  }
};

import { assertDbConnected } from '../config/firebase.js';
import { calculatePriorityScore, sortQueueTokens } from '../services/tokenPriorityEngine.js';
import { calculateWaitingTime, parseFirestoreDate } from '../services/waitingTimeCalculator.js';

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

    const isStaff = ['doctor', 'admin'].includes(role);
    const verified = staffVerified || isStaff;

    const priorityScore = calculatePriorityScore(priorityCategory, verified);

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
      priorityCategory,
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
    const date = req.query.date || new Date().toISOString().split('T')[0];
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
    const date = req.body.date || new Date().toISOString().split('T')[0];
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
    const date = new Date().toISOString().split('T')[0];

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
    const todayStr = new Date().toISOString().split('T')[0];

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
        for (const tDoc of tokenSnap.docs) {
          const tData = tDoc.data();
          if (tData.appointmentId) {
            const aDoc = await db.collection('appointments').doc(tData.appointmentId).get();
            if (aDoc.exists) {
              const aId = aDoc.data().appointmentId || aDoc.id;
              if (!apptsMap.has(aId)) {
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
    // ACTIVE APPOINTMENT SELECTION
    // Terminal statuses that MUST NOT appear in the live queue:
    const INACTIVE_STATUSES = new Set([
      'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED', 'REJECTED', 'EXPIRED'
    ]);

    const activeAppts = allAppts.filter(
      (a) => a.status && !INACTIVE_STATUSES.has(a.status.toUpperCase())
    );

    // Sort active appointments newest-first by appointmentId descending.
    // APT-2026-00026 > APT-2026-00018, so after cancellation + rebooking the
    // new appointment always wins regardless of Firestore's return ordering.
    // createdAt used as secondary tiebreaker.
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
      } else {
        return res.status(200).json({
          success: true,
          hasAppointment: false,
          message: 'No active appointment found.'
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const doctorUid = activeAppt.doctorUid || 'doc-uid-001';
    const apptDate = activeAppt.date || todayStr;

    // 2. Fetch doctor info & doctor schedule
    const docDoc = await db.collection('doctors').doc(doctorUid).get();
    const docData = docDoc.exists ? docDoc.data() : {};
    const doctorName = docData.fullName || 'Dr. Sarah Smith';

    const deptDoc = await db.collection('departments').doc(activeAppt.departmentId || 'dept-card').get();
    const departmentName = deptDoc.exists ? deptDoc.data().name : 'Cardiology';

    const schedDoc = await db.collection('doctorSchedules').doc(`sched-${doctorUid}`).get();
    const breakTimes = schedDoc.exists ? (schedDoc.data().breakTimes || []) : [{ start: '13:00', end: '14:00' }];
    let avgConsultationTimeMinutes = docData.avgConsultationTimeMinutes || 15;

    // 3. Fetch tokens for this doctor on the appointment's actual date
    // Using apptDate (not forced to todayStr) so future-dated appointments work.
    const apptDateTokensSnap = await db
      .collection('tokens')
      .where('doctorUid', '==', doctorUid)
      .where('date', '==', apptDate)
      .get();

    const apptDateTokens = apptDateTokensSnap.docs.map((d) => d.data());

    // Compute rolling average from completed tokens on appointment date if available
    let isHistoricalDataAvailable = false;
    const completedTokens = apptDateTokens.filter((t) => t.status === 'completed' && t.actualDurationMinutes);
    if (completedTokens.length > 0) {
      const sum = completedTokens.reduce((acc, curr) => acc + curr.actualDurationMinutes, 0);
      avgConsultationTimeMinutes = Math.max(5, Math.round(sum / completedTokens.length));
      isHistoricalDataAvailable = true;
    }

    // 4. Locate patient's token — STRICTLY by appointmentId relationship.
    // The `|| t.patientUid === patientUid` fallback is intentionally removed.
    // That fallback could accidentally match an older cancelled token from a
    // different appointment on the same date (e.g. CARD-T-018 / cancelled).
    let myToken = null;

    // Primary: scan apptDateTokens by appointmentId
    myToken = apptDateTokens.find((t) => t.appointmentId === activeAppt.appointmentId) || null;

    // Secondary: canonical document ID tok-<appointmentId>
    if (!myToken) {
      const tokenDoc = await db.collection('tokens').doc(`tok-${activeAppt.appointmentId}`).get();
      if (tokenDoc.exists) {
        myToken = tokenDoc.data();
      }
    }

    // Tertiary: query by appointmentId field (handles doc-ID mismatch edge case)
    if (!myToken) {
      const tokenQuery = await db
        .collection('tokens')
        .where('appointmentId', '==', activeAppt.appointmentId)
        .limit(1)
        .get();
      if (!tokenQuery.empty) {
        myToken = tokenQuery.docs[0].data();
      }
    }

    // Security check: ensure token belongs to patient, patientHealthId, or active appointment
    const isAuthorizedToken =
      myToken &&
      (myToken.patientUid === patientUid ||
       myToken.patientUid === activeAppt.patientUid ||
       myToken.patientHealthId === patientHealthId ||
       myToken.appointmentId === activeAppt.appointmentId ||
       activeAppt.bookedBy === patientUid);

    if (myToken && !isAuthorizedToken) {
      myToken = null;
    }

    const tokenNumber = myToken?.tokenNumber || activeAppt.tokenNumber || null;

    // isCancelled/isCompleted reflects only the token status — the appointment
    // has already passed the INACTIVE_STATUSES filter above.
    const isCancelled = myToken?.status === 'cancelled';
    const isCompleted = activeAppt.status === 'COMPLETED' || myToken?.status === 'completed';

    // 5. Build queue position & current room metrics
    const currentlyServingToken = apptDateTokens.find((t) => t.status === 'serving') || null;
    const waitingTokens = sortQueueTokens(apptDateTokens.filter((t) => t.status === 'waiting'));
    const totalActiveQueue = waitingTokens.length + (currentlyServingToken ? 1 : 0);

    let myPositionNum = -1;
    let positionText = 'WAITING';
    let patientsAhead = 0;
    let patientsAheadTokens = [];

    if (isCompleted) {
      positionText = 'CONSULTATION COMPLETED';
    } else if (isCancelled) {
      positionText = 'APPOINTMENT CANCELLED';
    } else if (currentlyServingToken && myToken && currentlyServingToken.id === myToken.id) {
      positionText = 'NOW SERVING';
      myPositionNum = 1;
      patientsAhead = 0;
    } else if (myToken) {
      const idx = waitingTokens.findIndex((t) => t.id === myToken.id || t.tokenNumber === myToken.tokenNumber);
      if (idx !== -1) {
        myPositionNum = idx + 1;
        patientsAhead = idx;
        patientsAheadTokens = waitingTokens.slice(0, idx);
        positionText = `Waiting (${idx + 1} of ${totalActiveQueue})`;
      } else {
        patientsAhead = waitingTokens.length;
        patientsAheadTokens = waitingTokens;
      }
    }

    // 6. Calculate waiting time and estimated turn
    const nowDate = new Date();
    let waitResult = {
      estimatedWaitMinutes: null,
      estimatedTurnTime: 'Calculating...',
      patientsAhead,
      isEstimate: true,
      calculationBasis: 'Calculating...'
    };

    if (!isCompleted && !isCancelled) {
      if (currentlyServingToken && myToken && currentlyServingToken.id === myToken.id) {
        waitResult = {
          estimatedWaitMinutes: 0,
          estimatedTurnTime: 'In Room Now',
          patientsAhead: 0,
          isEstimate: false,
          calculationBasis: 'Active Consultation'
        };
      } else if (myToken) {
        waitResult = calculateWaitingTime({
          currentServingToken: currentlyServingToken,
          patientsAheadTokens,
          avgConsultationTimeMinutes,
          breakTimes,
          nowDate,
          isHistoricalDataAvailable
        });
      }
    }

    // 7. Format Currently Serving section data
    let currentlyServingData = null;
    if (currentlyServingToken) {
      const calledAtDate = parseFirestoreDate(currentlyServingToken.calledAt);
      const elapsedMinutes = calledAtDate ? Math.max(0, Math.floor((nowDate.getTime() - calledAtDate.getTime()) / 60000)) : 0;

      const hours = calledAtDate ? calledAtDate.getHours() : 9;
      const mins = calledAtDate ? calledAtDate.getMinutes() : 0;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const startedFormatted = `${String(displayHours).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${ampm}`;

      currentlyServingData = {
        tokenNumber: currentlyServingToken.tokenNumber,
        doctorName,
        departmentName,
        status: 'Consultation in progress',
        startedAt: startedFormatted,
        elapsedMinutes
      };
    }

    // 8. Construct nearby queue timeline
    const queueTimeline = [];
    const lastCompleted = apptDateTokens
      .filter((t) => t.status === 'completed')
      .slice(-2);
    lastCompleted.forEach((t) => {
      queueTimeline.push({
        tokenNumber: t.tokenNumber,
        status: 'completed',
        label: 'Completed',
        isMe: myToken ? t.id === myToken.id : false
      });
    });

    if (currentlyServingToken) {
      queueTimeline.push({
        tokenNumber: currentlyServingToken.tokenNumber,
        status: 'serving',
        label: 'Currently Serving',
        isMe: myToken ? currentlyServingToken.id === myToken.id : false
      });
    }

    waitingTokens.forEach((t) => {
      const isMe = myToken ? (t.id === myToken.id || t.tokenNumber === myToken.tokenNumber) : false;
      queueTimeline.push({
        tokenNumber: t.tokenNumber,
        status: 'waiting',
        label: isMe ? 'YOU ARE HERE' : 'Waiting',
        isMe
      });
    });

    res.status(200).json({
      success: true,
      hasAppointment: true,
      hasToken: !!tokenNumber,
      isCancelled,
      isCompleted,
      appointment: {
        appointmentId: activeAppt.appointmentId || activeAppt.id,
        doctorUid,
        doctorName,
        departmentId: activeAppt.departmentId,
        departmentName,
        date: activeAppt.date,
        timeSlot: activeAppt.timeSlot,
        priorityCategory: activeAppt.priorityCategory || 'STANDARD',
        patientHealthId: activeAppt.patientHealthId,
        reason: activeAppt.reason,
        status: activeAppt.status
      },
      token: {
        tokenNumber,
        status: myToken?.status || (isCancelled ? 'cancelled' : isCompleted ? 'completed' : 'waiting'),
        priorityCategory: activeAppt.priorityCategory || 'STANDARD'
      },
      queueSummary: {
        positionText: isCompleted ? 'CONSULTATION COMPLETED' : isCancelled ? 'APPOINTMENT CANCELLED' : (currentlyServingToken && myToken && currentlyServingToken.id === myToken.id) ? 'NOW SERVING' : `#${myPositionNum > 0 ? myPositionNum : 1} of ${totalActiveQueue}`,
        positionNumber: myPositionNum,
        patientsAhead,
        totalActiveQueue,
        estimatedWaitMinutes: waitResult.estimatedWaitMinutes,
        estimatedTurnTime: waitResult.estimatedTurnTime,
        isEstimate: waitResult.isEstimate || false,
        calculationBasis: waitResult.calculationBasis || 'Calculating...'
      },
      // Live wait-time engine range data (written by recalculateQueue)
      liveWait: activeAppt.live ? {
        waitMinLow: activeAppt.live.waitMinLow,
        waitMinHigh: activeAppt.live.waitMinHigh,
        predictedCallAt: activeAppt.live.predictedCallAt,
        reasonText: activeAppt.live.reasonText,
        timeFactor: activeAppt.live.timeFactor,
        position: activeAppt.live.position,
        aheadCount: activeAppt.live.aheadCount,
        breakRemainingMin: activeAppt.live.breakRemainingMin,
        lateStartDelayMin: activeAppt.live.lateStartDelayMin,
        updatedAt: activeAppt.live.updatedAt
      } : null,
      leaveHome: activeAppt.leaveHome || null,
      earlyOptIn: activeAppt.earlyOptIn || false,
      currentlyServing: currentlyServingData,
      queueTimeline: queueTimeline.slice(0, 7)
    });
  } catch (error) {
    next(error);
  }
};

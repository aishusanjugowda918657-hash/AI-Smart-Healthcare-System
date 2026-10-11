import { assertDbConnected } from '../config/firebase.js';
import { verifyRecordAccess } from './medicalController.js';

/**
 * Schedule a Patient Follow-up Checkup (Doctor/Admin only)
 * PRD F12: importance 'serious' for chronic or high-risk conditions
 */
export const createFollowUp = async (req, res, next) => {
  try {
    const { uid: doctorUid, role, displayName: docName } = req.user;
    const {
      patientUid,
      patientHealthId,
      patientName = 'Patient',
      appointmentId,
      scheduledDate,
      dueDate,
      notes = 'Routine checkup follow-up',
      reason,
      isSerious = false,
      importance
    } = req.body;

    const targetDate = scheduledDate || dueDate;

    if (!patientHealthId || !targetDate) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and Scheduled Date (YYYY-MM-DD) are required.'
      });
    }

    const db = assertDbConnected();

    // Atomic followUp counter
    const counterRef = db.collection('counters').doc('followUpId');
    const counterDoc = await counterRef.get();
    let seq = 1;
    if (counterDoc.exists) {
      seq = (counterDoc.data().currentValue || 0) + 1;
      await counterRef.update({ currentValue: seq });
    } else {
      await counterRef.set({ currentValue: 1 });
    }

    const paddedSeq = String(seq).padStart(5, '0');
    const followUpId = `FLW-2026-${paddedSeq}`;
    const id = `flw-${Date.now().toString(36)}`;
    const now = new Date();
    const finalImportance = importance || (isSerious ? 'serious' : 'routine');

    const followUpData = {
      id,
      followUpId,
      healthId: patientHealthId,
      patientHealthId,
      patientUid: patientUid || '',
      patientName,
      doctorId: doctorUid,
      doctorUid,
      doctorName: docName || 'Doctor',
      appointmentId: appointmentId || '',
      scheduledDate: targetDate,
      dueDate: targetDate,
      reason: reason || notes,
      notes: reason || notes,
      importance: finalImportance,
      isSerious: finalImportance === 'serious',
      source: 'doctor',
      snoozeCount: 0,
      reminderCount: 0,
      status: 'scheduled',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    // Save in canonical 'followups' and mirror in legacy 'followUps'
    await db.collection('followups').doc(id).set(followUpData);
    await db.collection('followUps').doc(id).set(followUpData);

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'SCHEDULE_FOLLOWUP',
      resourceType: 'followup',
      resourceId: followUpId,
      patientHealthId,
      timestamp: now.toISOString()
    });

    res.status(201).json({
      success: true,
      message: `Follow-up checkup ${followUpId} scheduled for ${targetDate}.`,
      data: followUpData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle Follow-up Actions (Book Now, Remind Me Later, Not Needed, Mark Done)
 * PRD F12: PATCH /followups/:id ('book', 'later', 'not_needed', 'done')
 */
export const handleFollowUpAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, appointmentId, reason } = req.body;
    const { uid, role } = req.user;

    const db = assertDbConnected();
    let flwRef = db.collection('followups').doc(id);
    let flwDoc = await flwRef.get();

    let targetId = id;
    if (!flwDoc.exists) {
      flwRef = db.collection('followUps').doc(id);
      flwDoc = await flwRef.get();

      if (!flwDoc.exists) {
        const snap = await db.collection('followups').where('followUpId', '==', id).limit(1).get();
        if (!snap.empty) {
          flwDoc = snap.docs[0];
          targetId = flwDoc.id;
          flwRef = db.collection('followups').doc(targetId);
        }
      }
    }

    if (!flwDoc || !flwDoc.exists) {
      return res.status(404).json({ success: false, message: 'Follow-up record not found.' });
    }

    const flwData = flwDoc.data();
    const now = new Date();

    if (role === 'patient') {
      const targetHealthId = flwData.healthId || flwData.patientHealthId;
      const hasOtherOwner = flwData.patientUid && flwData.patientUid !== uid;
      if (hasOtherOwner) {
        const access = await verifyRecordAccess({ db, uid, role, patientHealthId: targetHealthId });
        if (!access.authorized) {
          return res.status(403).json({
            success: false,
            message: "Forbidden: You can only perform actions on your own or your dependents' follow-ups."
          });
        }
      } else if (!flwData.patientUid && targetHealthId) {
        const patientDoc = await db.collection('patients').doc(targetHealthId).get();
        if (patientDoc.exists) {
          const pData = patientDoc.data();
          const isOwner = pData.ownerUid === uid || pData.uid === uid || pData.primaryAccountUid === uid;
          if (!isOwner) {
            const access = await verifyRecordAccess({ db, uid, role, patientHealthId: targetHealthId });
            if (!access.authorized) {
              return res.status(403).json({
                success: false,
                message: "Forbidden: You can only perform actions on your own or your dependents' follow-ups."
              });
            }
          }
        }
      }
    }

    // 1. Action: Book Now -> Generate Deep Link & mark booked if appointmentId given
    if (action === 'book_now' || action === 'book') {
      if (appointmentId) {
        const updatePayload = {
          status: 'booked',
          bookedAppointmentId: appointmentId,
          updatedAt: now.toISOString()
        };
        await flwRef.update(updatePayload);
        try { await db.collection('followUps').doc(targetId).update(updatePayload); } catch {}
        return res.status(200).json({
          success: true,
          action: 'book',
          status: 'booked',
          bookedAppointmentId: appointmentId,
          message: 'Follow-up linked to booked appointment.'
        });
      }

      const deepLink = `/book-appointment?doctorId=${flwData.doctorId || flwData.doctorUid}&patientHealthId=${flwData.healthId || flwData.patientHealthId}&followupId=${flwData.followUpId || targetId}`;
      return res.status(200).json({
        success: true,
        action: 'book_now',
        deepLink,
        message: 'Redirecting to prefilled appointment booking.'
      });
    }

    // 2. Action: Remind Me Later (+1 day, maximum 2 times)
    if (action === 'remind_later' || action === 'later') {
      const currentSnoozeCount = Number(flwData.snoozeCount) || 0;
      if (currentSnoozeCount >= 2) {
        return res.status(400).json({
          success: false,
          code: 'MAX_SNOOZES_REACHED',
          message: 'Maximum snooze limit reached (max 2 snoozes allowed per follow-up).'
        });
      }

      const currentDue = new Date(flwData.dueDate || flwData.scheduledDate);
      const newDueDate = new Date(currentDue);
      newDueDate.setDate(newDueDate.getDate() + 1);
      const newDueDateStr = newDueDate.toISOString().split('T')[0];

      const updatePayload = {
        dueDate: newDueDateStr,
        scheduledDate: newDueDateStr,
        snoozeCount: currentSnoozeCount + 1,
        status: 'scheduled',
        updatedAt: now.toISOString()
      };

      await flwRef.update(updatePayload);
      try { await db.collection('followUps').doc(targetId).update(updatePayload); } catch {}

      return res.status(200).json({
        success: true,
        action: 'remind_later',
        snoozeCount: currentSnoozeCount + 1,
        newDueDate: newDueDateStr,
        message: `Follow-up reminder snoozed by 1 day until ${newDueDateStr}.`
      });
    }

    // 3. Action: Not Needed -> Mark not_needed. If serious, raise doctor alert.
    if (action === 'not_needed') {
      const updatePayload = {
        status: 'not_needed',
        notNeededReason: reason || 'Patient declined',
        dismissedAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      await flwRef.update(updatePayload);
      try { await db.collection('followUps').doc(targetId).update(updatePayload); } catch {}

      const isSerious = flwData.importance === 'serious' || flwData.isSerious;
      if (isSerious) {
        const alertId = `alert-declined-${targetId}`;
        const alertData = {
          id: alertId,
          doctorId: flwData.doctorId || flwData.doctorUid,
          healthId: flwData.healthId || flwData.patientHealthId,
          patientHealthId: flwData.healthId || flwData.patientHealthId,
          patientName: flwData.patientName || 'Patient',
          kind: 'urgent',
          riskLevel: 'high',
          reasons: [`Patient marked serious follow-up as Not Needed${reason ? `: ${reason}` : ''}`],
          status: 'open',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString()
        };

        await db.collection('alerts').doc(alertId).set(alertData);
        try { await db.collection('doctorAlerts').doc(alertId).set(alertData); } catch {}
      }

      return res.status(200).json({
        success: true,
        action: 'not_needed',
        status: 'DISMISSED',
        data: { id: targetId, status: 'DISMISSED' },
        message: 'Follow-up marked as Not Needed.'
      });
    }

    // 4. Action: Done / Mark Done
    if (action === 'done' || action === 'mark_done') {
      const updatePayload = {
        status: 'done',
        completedAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      await flwRef.update(updatePayload);
      try { await db.collection('followUps').doc(targetId).update(updatePayload); } catch {}

      return res.status(200).json({
        success: true,
        action: 'done',
        status: 'done',
        message: 'Follow-up marked as Done.'
      });
    }

    res.status(400).json({
      success: false,
      message: 'Invalid action. Allowed: [book_now, remind_later, not_needed, done]'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get followups list (PRD: GET /followups)
 */
export const getFollowUpsList = async (req, res, next) => {
  try {
    const { uid, role, doctorUid } = req.user;
    const { status, healthId } = req.query;
    const db = assertDbConnected();

    let query = db.collection('followups');

    if (role === 'doctor') {
      query = query.where('doctorId', '==', doctorUid || uid);
    } else if (role === 'patient') {
      if (healthId) {
        const patientDoc = await db.collection('patients').doc(healthId).get();
        if (patientDoc.exists) {
          const pData = patientDoc.data();
          const isOwner = pData.ownerUid === uid || pData.uid === uid || pData.primaryAccountUid === uid;
          if (!isOwner) {
            const access = await verifyRecordAccess({ db, uid, role, patientHealthId: healthId });
            if (!access.authorized) {
              return res.status(403).json({
                success: false,
                message: 'Forbidden: Access to requested patient follow-ups is unauthorized.'
              });
            }
          }
        }
        query = query.where('healthId', '==', healthId);
      } else {
        query = query.where('patientUid', '==', uid);
      }
    } else if (healthId) {
      query = query.where('healthId', '==', healthId);
    } else {
      query = query.where('patientUid', '==', uid);
    }

    const snap = await query.get();
    let followups = snap.docs.map((d) => d.data());

    if (status) {
      followups = followups.filter((f) => f.status === status);
    }

    res.status(200).json({
      success: true,
      data: followups
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get doctor's upcoming patient follow-ups
 */
export const getDoctorUpcomingFollowUps = async (req, res, next) => {
  try {
    const doctorUid = req.user.doctorUid || req.user.uid;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('followups')
      .where('doctorId', '==', doctorUid)
      .where('status', '==', 'scheduled')
      .get();

    const followUps = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      data: followUps
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient's required follow-up checkups
 */
export const getPatientUpcomingFollowUps = async (req, res, next) => {
  try {
    const { uid: patientUid, patientHealthId } = req.user;
    const db = assertDbConnected();

    let snapshot;
    if (patientHealthId) {
      snapshot = await db
        .collection('followups')
        .where('healthId', '==', patientHealthId)
        .get();
    } else {
      snapshot = await db
        .collection('followups')
        .where('patientUid', '==', patientUid)
        .get();
    }

    const followUps = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      data: followUps
    });
  } catch (error) {
    next(error);
  }
};

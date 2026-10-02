import { assertDbConnected } from '../config/firebase.js';

/**
 * Schedule a Patient Follow-up Checkup (Doctor/Admin only)
 */
export const createFollowUp = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    const {
      patientUid,
      patientHealthId,
      appointmentId,
      scheduledDate,
      dueDate,
      notes = 'Routine checkup follow-up',
      isSerious = false
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

    const followUpData = {
      id,
      followUpId,
      patientUid: patientUid || 'demo-patient-001',
      patientHealthId,
      doctorUid,
      appointmentId: appointmentId || '',
      scheduledDate: targetDate,
      dueDate: targetDate,
      notes,
      isSerious: Boolean(isSerious),
      snoozeCount: 0,
      overdueNoticeCount: 0,
      status: 'scheduled',
      doctorNotified: false,
      createdAt: now,
      updatedAt: now
    };

    await db.collection('followUps').doc(id).set(followUpData);

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'SCHEDULE_FOLLOWUP',
      resourceType: 'followUp',
      resourceId: followUpId,
      patientHealthId,
      timestamp: now
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
 * Handle Follow-up Actions (Book Now, Remind Me Later, Not Needed)
 */
export const handleFollowUpAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const { uid, role } = req.user;

    const db = assertDbConnected();
    const flwRef = db.collection('followUps').doc(id);
    let flwDoc = await flwRef.get();

    let targetId = id;
    if (!flwDoc.exists) {
      const snap = await db.collection('followUps').where('followUpId', '==', id).limit(1).get();
      if (!snap.empty) {
        flwDoc = snap.docs[0];
        targetId = flwDoc.id;
      }
    }

    if (!flwDoc || !flwDoc.exists) {
      return res.status(404).json({ success: false, message: 'Follow-up record not found.' });
    }

    const flwData = flwDoc.data();
    const now = new Date();

    // 1. Action: Book Now -> Generate Deep Link
    if (action === 'book_now') {
      const deepLink = `/book-appointment?doctorId=${flwData.doctorUid}&patientHealthId=${flwData.patientHealthId}&followupId=${flwData.followUpId || targetId}`;
      return res.status(200).json({
        success: true,
        action: 'book_now',
        deepLink,
        message: 'Redirecting to prefilled appointment booking.'
      });
    }

    // 2. Action: Remind Me Later -> Snooze (+3 days, max 2 snoozes)
    if (action === 'remind_later') {
      const currentSnoozeCount = Number(flwData.snoozeCount) || 0;
      if (currentSnoozeCount >= 2) {
        return res.status(400).json({
          success: false,
          code: 'MAX_SNOOZES_REACHED',
          message: 'Maximum snooze limit reached (max 2 snoozes allowed per follow-up).'
        });
      }

      const newDueDate = new Date(flwData.dueDate || flwData.scheduledDate);
      newDueDate.setDate(newDueDate.getDate() + 3);

      await db.collection('followUps').doc(targetId).update({
        dueDate: newDueDate.toISOString().split('T')[0],
        snoozeCount: currentSnoozeCount + 1,
        updatedAt: now
      });

      return res.status(200).json({
        success: true,
        action: 'remind_later',
        snoozeCount: currentSnoozeCount + 1,
        newDueDate: newDueDate.toISOString().split('T')[0],
        message: `Follow-up reminder snoozed by 3 days until ${newDueDate.toISOString().split('T')[0]}.`
      });
    }

    // 3. Action: Not Needed -> Mark DISMISSED. If serious, raise doctor alert.
    if (action === 'not_needed') {
      await db.collection('followUps').doc(targetId).update({
        status: 'DISMISSED',
        dismissedAt: now.toISOString(),
        updatedAt: now
      });

      if (flwData.isSerious || (flwData.notes && flwData.notes.toLowerCase().includes('cardiac'))) {
        await db.collection('doctorAlerts').add({
          id: `alert-${Date.now().toString(36)}`,
          doctorUid: flwData.doctorUid,
          patientUid: flwData.patientUid,
          patientHealthId: flwData.patientHealthId,
          kind: 'FLAG_PATIENT_DECLINED_FOLLOWUP',
          riskLevel: 'high',
          title: 'Patient Declined Recommended Follow-up',
          message: `Patient ${flwData.patientHealthId} marked recommended follow-up (${flwData.followUpId}) as "Not Needed".`,
          status: 'open',
          createdAt: now
        });
      }

      return res.status(200).json({
        success: true,
        action: 'not_needed',
        status: 'DISMISSED',
        message: 'Follow-up marked as Not Needed.'
      });
    }

    res.status(400).json({ success: false, message: 'Invalid action. Allowed: [book_now, remind_later, not_needed]' });
  } catch (error) {
    next(error);
  }
};

/**
 * Get doctor's upcoming patient follow-ups
 */
export const getDoctorUpcomingFollowUps = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('followUps')
      .where('doctorUid', '==', doctorUid)
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
    const { uid: patientUid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('followUps')
      .where('patientUid', '==', patientUid)
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

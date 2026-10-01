import { assertDbConnected } from '../config/firebase.js';

/**
 * Schedule a Patient Follow-up Checkup (Doctor only)
 */
export const createFollowUp = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    const {
      patientUid,
      patientHealthId,
      appointmentId,
      scheduledDate,
      notes = 'Routine checkup follow-up'
    } = req.body;

    if (!patientHealthId || !scheduledDate) {
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

    const followUpData = {
      id,
      followUpId,
      patientUid: patientUid || 'demo-patient-001',
      patientHealthId,
      doctorUid,
      appointmentId: appointmentId || '',
      scheduledDate,
      notes,
      status: 'scheduled',
      doctorNotified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('followUps').doc(id).set(followUpData);

    // Create Audit Log entry
    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'SCHEDULE_FOLLOWUP',
      resourceType: 'followUp',
      resourceId: followUpId,
      patientHealthId,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: `Follow-up checkup ${followUpId} scheduled for ${scheduledDate}.`,
      data: followUpData
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

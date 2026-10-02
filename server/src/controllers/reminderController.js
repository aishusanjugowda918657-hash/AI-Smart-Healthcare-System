import { assertDbConnected } from '../config/firebase.js';
import { calculateAdherenceRate } from '../services/reminderService.js';
import { generateDoseSchedule, verifyActionToken } from '../domain/reminders.js';

/**
 * Sync doctor-confirmed prescription reminder times to patient schedule
 */
export const syncPrescriptionReminders = async (req, res, next) => {
  try {
    const { prescriptionId } = req.body;
    const { uid: patientUid } = req.user;

    if (!prescriptionId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Prescription ID is required.'
      });
    }

    const db = assertDbConnected();

    const rxSnapshot = await db
      .collection('prescriptions')
      .where('prescriptionId', '==', prescriptionId)
      .limit(1)
      .get();

    if (rxSnapshot.empty) {
      return res.status(404).json({
        success: false,
        message: 'Prescription record not found.'
      });
    }

    const rxData = rxSnapshot.docs[0].data();
    const createdReminders = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (const med of rxData.medicines || []) {
      const reminderId = `rem-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
      const startDate = rxData.date || todayStr;
      const endDateObj = new Date(startDate);
      endDateObj.setDate(endDateObj.getDate() + (med.durationDays || 5));
      const endDate = endDateObj.toISOString().split('T')[0];

      const reminderData = {
        id: reminderId,
        patientUid: rxData.patientUid || patientUid,
        patientHealthId: rxData.patientHealthId || '',
        prescriptionId,
        medicineName: med.name,
        dosage: med.dosage,
        frequency: med.frequency || '1-0-1',
        reminderTimes: med.reminderTimes || ['08:00 AM', '08:00 PM'],
        startDate,
        endDate,
        durationDays: med.durationDays || 5,
        timing: med.timing || 'after_food',
        instructions: med.notes || 'As prescribed by doctor',
        status: 'active',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('medicineReminders').doc(reminderId).set(reminderData);
      createdReminders.push(reminderData);
    }

    res.status(201).json({
      success: true,
      message: `Synced ${createdReminders.length} medicine reminders from prescription.`,
      data: createdReminders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient's today active medicine reminders with scheduled doses
 */
export const getTodayReminders = async (req, res, next) => {
  try {
    const { uid: patientUid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('medicineReminders')
      .where('patientUid', '==', patientUid)
      .where('active', '==', true)
      .get();

    const reminders = snapshot.docs.map((d) => d.data());

    // Fetch today's logged doses
    const todayStr = new Date().toISOString().split('T')[0];
    const logsSnapshot = await db
      .collection('medicineLogs')
      .where('patientUid', '==', patientUid)
      .get();

    const logs = logsSnapshot.docs.map((d) => d.data());
    const adherenceRate = calculateAdherenceRate(logs);

    res.status(200).json({
      success: true,
      adherenceRate,
      data: reminders,
      logs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Respond to Medicine Dose Action (Taken, Snooze, Skip) with 10s Undo, First-Responder-Wins & HMAC verification
 */
export const respondToReminder = async (req, res, next) => {
  try {
    const { id } = req.params; // reminderId or doseId
    const {
      action = 'taken',
      actionToken,
      undo = false,
      snoozeMinutes = 15,
      scheduledTime
    } = req.body;

    let responderUid = req.user?.uid;
    let responderRole = req.user?.role || 'patient';

    // Verify HMAC Action Token if provided (e.g. from notification push or email link)
    if (actionToken) {
      const verified = verifyActionToken(actionToken);
      if (!verified || !verified.valid) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_ACTION_TOKEN',
          message: verified?.expired ? 'Action token has expired.' : 'Invalid action token signature.'
        });
      }
      if (verified.payload.patientUid) responderUid = verified.payload.patientUid;
    }

    if (!responderUid) {
      return res.status(401).json({ success: false, message: 'Authentication or actionToken required.' });
    }

    const db = assertDbConnected();
    const doseRef = db.collection('medicineDoses').doc(id);
    let doseDoc = await doseRef.get();

    let targetDocId = id;
    if (!doseDoc.exists) {
      // Check if it's a reminderId, create/find dose doc
      const remDoc = await db.collection('medicineReminders').doc(id).get();
      if (remDoc.exists) {
        targetDocId = `dose-${id}-${new Date().toISOString().split('T')[0]}`;
        doseDoc = await db.collection('medicineDoses').doc(targetDocId).get();
      }
    }

    const now = new Date();
    const nowMs = now.getTime();

    // 1. UNDO logic (within 10 seconds of previous response)
    if (undo) {
      if (doseDoc.exists) {
        const dData = doseDoc.data();
        const prevActionTime = dData.actionTime ? new Date(dData.actionTime).getTime() : 0;

        if (nowMs - prevActionTime > 10000) {
          return res.status(400).json({
            success: false,
            code: 'UNDO_WINDOW_EXPIRED',
            message: '10-second undo window has expired. Action cannot be undone.'
          });
        }

        // Revert to scheduled
        await db.collection('medicineDoses').doc(targetDocId).update({
          status: 'scheduled',
          actionTime: null,
          respondedByUid: null,
          updatedAt: now
        });

        return res.status(200).json({
          success: true,
          message: 'Dose response undone successfully within 10 seconds.',
          data: { id: targetDocId, status: 'scheduled' }
        });
      }
    }

    // 2. First-Responder-Wins & Double-Tick Protection
    if (doseDoc.exists) {
      const dData = doseDoc.data();
      if (dData.status === 'taken' || dData.status === 'skipped') {
        const prevTime = dData.actionTime ? new Date(dData.actionTime).toISOString() : null;
        return res.status(200).json({
          success: true,
          firstResponderWins: true,
          message: `Dose was already marked as '${dData.status}' by ${dData.respondedByUid === responderUid ? 'you' : 'another responder'}.`,
          data: dData
        });
      }
    }

    // 3. Late Catch-Up Logic (20-minute late threshold)
    let finalStatus = action;
    let takenLate = false;

    if (action === 'taken' && scheduledTime) {
      const schedMs = new Date(scheduledTime).getTime();
      if (nowMs - schedMs >= 20 * 60 * 1000) {
        takenLate = true;
        finalStatus = 'taken'; // Logged as taken with takenLate=true flag
      }
    }

    // Handle Snooze
    if (action === 'snooze') {
      const snoozedUntil = new Date(nowMs + Number(snoozeMinutes) * 60 * 1000);
      finalStatus = 'snoozed';

      const updateData = {
        status: 'snoozed',
        snoozedUntil: snoozedUntil.toISOString(),
        respondedByUid: responderUid,
        actionTime: now.toISOString(),
        updatedAt: now
      };

      await db.collection('medicineDoses').doc(targetDocId).set(updateData, { merge: true });

      return res.status(200).json({
        success: true,
        message: `Dose snoozed for ${snoozeMinutes} minutes until ${snoozedUntil.toLocaleTimeString()}.`,
        data: updateData
      });
    }

    // Record Action Response
    const responsePayload = {
      id: targetDocId,
      status: finalStatus,
      takenLate,
      actionTime: now.toISOString(),
      respondedByUid: responderUid,
      respondedByRole: responderRole,
      patientUid: responderUid,
      updatedAt: now
    };

    await db.collection('medicineDoses').doc(targetDocId).set(responsePayload, { merge: true });

    // Also write to medicineLogs for adherence analytics
    const logId = `log-${Date.now().toString(36)}`;
    await db.collection('medicineLogs').doc(logId).set({
      id: logId,
      doseId: targetDocId,
      patientUid: responderUid,
      status: finalStatus,
      takenLate,
      actionTime: now.toISOString(),
      createdAt: now
    });

    res.status(200).json({
      success: true,
      message: `Dose marked as '${finalStatus}'${takenLate ? ' (Late Catch-Up)' : ''}.`,
      data: responsePayload
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Adherence Metrics & Current Streak (PRD F11)
 */
export const getAdherenceMetrics = async (req, res, next) => {
  try {
    const { uid: patientUid } = req.user;
    const db = assertDbConnected();

    const snapshot = await db
      .collection('medicineLogs')
      .where('patientUid', '==', patientUid)
      .get();

    const logs = snapshot.docs.map((d) => d.data());
    logs.sort((a, b) => new Date(b.actionTime || b.createdAt) - new Date(a.actionTime || a.createdAt));

    const totalDue = logs.length;
    const takenCount = logs.filter((l) => l.status === 'taken').length;
    const missedCount = logs.filter((l) => l.status === 'missed').length;
    const skippedCount = logs.filter((l) => l.status === 'skipped').length;

    const adherencePercent = totalDue > 0 ? Math.round((takenCount / totalDue) * 100) : 100;

    // Calculate current daily streak
    let currentStreakDays = 0;
    const dateSet = new Set();
    for (const log of logs) {
      if (log.status === 'taken') {
        const day = new Date(log.actionTime || log.createdAt).toISOString().split('T')[0];
        dateSet.add(day);
      } else if (log.status === 'missed') {
        break; // streak interrupted by missed dose
      }
    }
    currentStreakDays = dateSet.size;

    res.status(200).json({
      success: true,
      data: {
        totalDue,
        takenCount,
        missedCount,
        skippedCount,
        adherencePercent,
        currentStreakDays
      }
    });
  } catch (error) {
    next(error);
  }
};

export const logMedicineAction = async (req, res, next) => {
  try {
    const { reminderId, medicineName, status = 'taken', scheduledTime } = req.body;
    const { uid: patientUid } = req.user;

    const validStatuses = ['taken', 'missed', 'skipped'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Validation Error: Invalid status '${status}'. Allowed: [${validStatuses.join(', ')}]`
      });
    }

    const db = assertDbConnected();
    let patientHealthId = '';
    let prescriptionId = '';
    let dosage = '';
    let resolvedMedicineName = medicineName || 'Prescribed Dose';

    if (reminderId) {
      const reminderDoc = await db.collection('medicineReminders').doc(reminderId).get();
      if (reminderDoc.exists) {
        const rd = reminderDoc.data();
        patientHealthId = rd.patientHealthId || '';
        prescriptionId = rd.prescriptionId || '';
        dosage = rd.dosage || '';
        resolvedMedicineName = rd.medicineName || resolvedMedicineName;
      }
    }

    const logId = `log-${Date.now().toString(36)}`;
    const logData = {
      id: logId,
      reminderId: reminderId || '',
      patientUid,
      patientHealthId,
      prescriptionId,
      medicineName: resolvedMedicineName,
      dosage,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : new Date(),
      actionTime: new Date(),
      status,
      createdAt: new Date()
    };

    await db.collection('medicineLogs').doc(logId).set(logData);

    res.status(201).json({
      success: true,
      message: `Medicine marked as '${status}'.`,
      data: logData
    });
  } catch (error) {
    next(error);
  }
};

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
 * Query medicine reminders for patient (GET /reminders?healthId&date and GET /api/reminders/today)
 */
export const getTodayReminders = async (req, res, next) => {
  try {
    const userUid = req.user?.uid;
    const healthId = req.query.healthId || req.user?.patientHealthId;
    const dateFilter = req.query.date || new Date().toISOString().split('T')[0];
    const db = assertDbConnected();

    let reminders = [];

    // 1. Try canonical 'reminders' collection
    if (healthId) {
      const snap = await db.collection('reminders')
        .where('healthId', '==', healthId)
        .get();
      reminders = snap.docs.map((d) => d.data());
    } else if (userUid) {
      const snap = await db.collection('reminders')
        .where('receiverUids', 'array-contains', userUid)
        .get();
      reminders = snap.docs.map((d) => d.data());
    }

    // Filter by dateStr if available, else by dueAt prefix
    if (reminders.length > 0 && dateFilter) {
      reminders = reminders.filter((r) => {
        const dStr = r.dateStr || r.dueAt?.slice(0, 10);
        return dStr === dateFilter;
      });
    }

    // 2. Fallback to legacy medicineReminders if canonical is empty
    if (reminders.length === 0 && userUid) {
      const legacySnap = await db.collection('medicineReminders')
        .where('patientUid', '==', userUid)
        .where('active', '==', true)
        .get();
      reminders = legacySnap.docs.map((d) => d.data());
    }

    // Fetch today's logged doses for adherence calculation
    const logsSnapshot = await db
      .collection('medicineLogs')
      .where('patientUid', '==', userUid || healthId)
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
 * General Query Endpoint (PRD: GET /reminders?healthId&date)
 */
export const getRemindersByQuery = async (req, res, next) => {
  return getTodayReminders(req, res, next);
};

/**
 * Respond to Medicine Dose Action (Taken, Snooze, Skip) with 10s Undo, First-Responder-Wins & HMAC verification
 * PRD F11: POST /reminders/:id/respond {action, token?}
 */
export const respondToReminder = async (req, res, next) => {
  try {
    const { id } = req.params; // reminderId
    const {
      action = 'taken',
      actionToken: bodyToken,
      token: altToken,
      undo = false,
      snoozeMinutes = 10
    } = req.body;

    const tokenToVerify = bodyToken || altToken || req.query.token;
    let responderUid = req.user?.uid;
    let responderName = req.user?.displayName || req.user?.name || 'User';

    // Verify HMAC Action Token if provided (valid until due time + 24 hours, only for this reminder)
    if (tokenToVerify) {
      const verified = verifyActionToken(tokenToVerify, undefined, id);
      if (!verified || !verified.valid) {
        let msg = 'Invalid action token signature.';
        if (verified?.expired) msg = 'Action token has expired.';
        if (verified?.mismatched) msg = 'Action token cannot be used for a different reminder.';
        return res.status(401).json({
          success: false,
          code: 'INVALID_ACTION_TOKEN',
          message: msg
        });
      }
      if (verified.payload.patientUid) responderUid = verified.payload.patientUid;
      if (verified.payload.healthId && !responderName) responderName = verified.payload.healthId;
    }

    if (!responderUid) {
      return res.status(401).json({
        success: false,
        message: 'Authentication or valid actionToken required.'
      });
    }

    const db = assertDbConnected();
    const now = new Date();
    const nowMs = now.getTime();
    const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Lookup reminder in canonical reminders first, then fallback to legacy
    let remRef = db.collection('reminders').doc(id);
    let remDoc = await remRef.get();
    let isLegacy = false;

    if (!remDoc.exists) {
      remRef = db.collection('medicineDoses').doc(id);
      remDoc = await remRef.get();
      isLegacy = true;

      if (!remDoc.exists) {
        remRef = db.collection('medicineReminders').doc(id);
        remDoc = await remRef.get();
      }
    }

    let remData;
    if (!remDoc.exists) {
      remData = {
        id,
        reminderId: id,
        healthId: req.user?.patientHealthId || '',
        patientUid: responderUid || '',
        patientName: responderName,
        receiverUids: responderUid ? [responderUid] : [],
        dueAt: req.body.scheduledTime || now.toISOString(),
        scheduledTime: req.body.scheduledTime || now.toISOString(),
        status: undo ? 'scheduled' : 'pending',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      await remRef.set(remData);
    } else {
      remData = remDoc.data();
    }

    // 1. UNDO logic (within 10 seconds of previous response)
    if (undo) {
      const prevActionTime = remData.respondedAt
        ? new Date(remData.respondedAt).getTime()
        : (remData.actionTime ? new Date(remData.actionTime).getTime() : 0);

      if (prevActionTime && (nowMs - prevActionTime > 10000)) {
        return res.status(400).json({
          success: false,
          code: 'UNDO_WINDOW_EXPIRED',
          message: '10-second undo window has expired. Action cannot be undone.'
        });
      }

      await remRef.update({
        status: 'scheduled',
        respondedAt: null,
        respondedByUid: null,
        respondedByName: null,
        takenAt: null,
        updatedAt: now.toISOString()
      });

      return res.status(200).json({
        success: true,
        message: 'Dose response undone successfully within 10 seconds.',
        data: { id, status: 'scheduled' }
      });
    }

    // 2. First-Responder-Wins & Double-Tick Protection
    if (remData.status === 'taken' || remData.status === 'skipped') {
      const who = remData.respondedByName || (remData.respondedByUid === responderUid ? 'you' : 'another caregiver');
      return res.status(200).json({
        success: true,
        firstResponderWins: true,
        message: `Already given by ${who} at ${remData.takenAt || 'earlier'}.`,
        data: remData
      });
    }

    // 3. Action: Snooze (10 minutes, maximum 3)
    if (action === 'snooze') {
      const currentSnoozes = Number(remData.snoozeCount) || 0;
      if (currentSnoozes >= 3) {
        return res.status(400).json({
          success: false,
          code: 'MAX_SNOOZES_REACHED',
          message: 'Maximum 3 snoozes allowed per medicine reminder.'
        });
      }

      const snoozeMins = Number(snoozeMinutes) || 10;
      const newDueAt = new Date(nowMs + snoozeMins * 60 * 1000);

      const snoozePayload = {
        status: 'pending',
        dueAt: newDueAt.toISOString(),
        scheduledTime: newDueAt.toISOString(),
        snoozeCount: currentSnoozes + 1,
        respondedByUid: responderUid,
        respondedByName: responderName,
        respondedAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      await remRef.update(snoozePayload);

      return res.status(200).json({
        success: true,
        message: `Reminder snoozed for ${snoozeMins} minutes.`,
        data: { id, snoozeCount: currentSnoozes + 1, newDueAt: newDueAt.toISOString() }
      });
    }

    // 4. Action: Skip
    if (action === 'skip') {
      const skipPayload = {
        status: 'skipped',
        respondedAt: now.toISOString(),
        respondedByUid: responderUid,
        respondedByName: responderName,
        updatedAt: now.toISOString()
      };
      await remRef.update(skipPayload);

      // Log for adherence
      await db.collection('medicineLogs').add({
        id: `log-${Date.now().toString(36)}`,
        reminderId: id,
        patientUid: responderUid,
        healthId: remData.healthId || remData.patientHealthId || '',
        medicineName: remData.medicineName || remData.item?.name || 'Medication',
        status: 'skipped',
        actionTime: now.toISOString(),
        createdAt: now.toISOString()
      });

      return res.status(200).json({
        success: true,
        message: 'Dose marked as skipped.',
        data: { id, status: 'skipped' }
      });
    }

    // 5. Action: Taken
    if (action === 'taken') {
      const takenPayload = {
        status: 'taken',
        respondedAt: now.toISOString(),
        actionTime: now.toISOString(),
        respondedByUid: responderUid,
        respondedByName: responderName,
        takenAt: timeLabel,
        updatedAt: now.toISOString()
      };

      await remRef.update(takenPayload);

      // Cancel pending reminders for other caregivers for this same dose
      if (remData.prescriptionId && remData.dueAt) {
        try {
          const otherSnap = await db.collection('reminders')
            .where('prescriptionId', '==', remData.prescriptionId)
            .where('status', '==', 'pending')
            .get();

          for (const otherDoc of otherSnap.docs) {
            const od = otherDoc.data();
            if (otherDoc.id !== id && od.dueAt === remData.dueAt && od.medicineName === remData.medicineName) {
              await otherDoc.ref.update({
                status: 'taken',
                cancelledByOther: true,
                respondedByUid: responderUid,
                respondedByName: responderName,
                takenAt: timeLabel,
                updatedAt: now.toISOString()
              });
            }
          }
        } catch {
          // Non-critical
        }
      }

      // Record in medicineLogs for adherence analytics
      await db.collection('medicineLogs').add({
        id: `log-${Date.now().toString(36)}`,
        reminderId: id,
        patientUid: responderUid,
        healthId: remData.healthId || remData.patientHealthId || '',
        medicineName: remData.medicineName || remData.item?.name || 'Medication',
        status: 'taken',
        takenAt: timeLabel,
        actionTime: now.toISOString(),
        createdAt: now.toISOString()
      });

      const scheduledTime = req.body.scheduledTime || remData.scheduledTime || remData.dueAt;
      let takenLate = false;
      if (scheduledTime) {
        const diffMs = nowMs - new Date(scheduledTime).getTime();
        if (diffMs >= 20 * 60 * 1000) {
          takenLate = true;
        }
      }

      return res.status(200).json({
        success: true,
        message: `Dose marked as taken at ${timeLabel}.`,
        data: { id, status: 'taken', takenAt: timeLabel, respondedByName: responderName, takenLate }
      });
    }

    return res.status(400).json({
      success: false,
      message: `Invalid action '${action}'. Allowed: taken, snooze, skip.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Adherence Metrics & Current Streak (PRD F11 / GET /patients/:healthId/adherence)
 */
export const getAdherenceMetrics = async (req, res, next) => {
  try {
    const healthId = req.params.healthId || req.query.healthId || req.user?.patientHealthId;
    const patientUid = req.user?.uid;
    const db = assertDbConnected();

    let logs = [];
    if (healthId) {
      const snap = await db.collection('medicineLogs').where('healthId', '==', healthId).get();
      logs = snap.docs.map((d) => d.data());
    }

    if (logs.length === 0 && patientUid) {
      const snap = await db.collection('medicineLogs').where('patientUid', '==', patientUid).get();
      logs = snap.docs.map((d) => d.data());
    }

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
      const reminderDoc = await db.collection('reminders').doc(reminderId).get();
      if (reminderDoc.exists) {
        const rd = reminderDoc.data();
        patientHealthId = rd.healthId || rd.patientHealthId || '';
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
      healthId: patientHealthId,
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

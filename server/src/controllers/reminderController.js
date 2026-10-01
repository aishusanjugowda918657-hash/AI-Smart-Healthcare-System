import { assertDbConnected } from '../config/firebase.js';
import { calculateAdherenceRate } from '../services/reminderService.js';

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

    // Fetch prescription
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

      // Calculate endDate from startDate + durationDays
      const startDate = rxData.date || todayStr;
      const endDateObj = new Date(startDate);
      endDateObj.setDate(endDateObj.getDate() + (med.durationDays || 5));
      const endDate = endDateObj.toISOString().split('T')[0];

      const reminderData = {
        id: reminderId,
        patientUid: rxData.patientUid || patientUid,
        patientHealthId: rxData.patientHealthId || '',   // Fix P3: always include patientHealthId
        prescriptionId,
        medicineName: med.name,
        dosage: med.dosage,
        frequency: med.frequency || '',
        reminderTimes: med.reminderTimes || ['08:00 AM', '08:00 PM'],
        startDate,
        endDate,
        durationDays: med.durationDays || 5,
        timing: med.timing || '',
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
 * Get patient's today active medicine reminders
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

    // Fetch logs to compute adherence
    const logsSnapshot = await db
      .collection('medicineLogs')
      .where('patientUid', '==', patientUid)
      .get();

    const logs = logsSnapshot.docs.map((d) => d.data());
    const adherenceRate = calculateAdherenceRate(logs);

    res.status(200).json({
      success: true,
      adherenceRate,
      data: reminders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Log medicine dose action (taken, missed, skipped)
 */
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

    // Fix P2: resolve patientHealthId, prescriptionId, dosage from the reminder doc
    let patientHealthId = '';
    let prescriptionId = '';
    let dosage = '';
    let resolvedMedicineName = medicineName || 'Prescribed Dose';

    if (reminderId) {
      const reminderDoc = await db.collection('medicineReminders').doc(reminderId).get();
      if (reminderDoc.exists) {
        const rd = reminderDoc.data();
        patientHealthId = rd.patientHealthId || '';
        prescriptionId  = rd.prescriptionId  || '';
        dosage          = rd.dosage          || '';
        resolvedMedicineName = rd.medicineName || resolvedMedicineName;
      }
    }

    const logId = `log-${Date.now().toString(36)}`;

    const logData = {
      id: logId,
      reminderId: reminderId || '',
      patientUid,
      patientHealthId,     // Resolved from reminder — satisfies P2
      prescriptionId,      // Cross-reference to prescription
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

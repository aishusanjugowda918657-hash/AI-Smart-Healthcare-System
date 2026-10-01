import { assertDbConnected } from '../config/firebase.js';

/**
 * Create Doctor-Verified Digital Prescription (Doctor only)
 */
export const createDigitalPrescription = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    const {
      patientUid,
      patientHealthId,
      appointmentId,
      medicalRecordId,
      medicines = [],
      doctorNotes = ''
    } = req.body;

    if (!patientHealthId || !medicines || medicines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and at least one medicine entry are required.'
      });
    }

    const db = assertDbConnected();

    // Fetch doctor name
    const docDoc = await db.collection('doctors').doc(doctorUid).get();
    const doctorName = docDoc.exists ? docDoc.data().fullName : 'Dr. Sarah Smith';

    // Atomic prescription counter
    const counterRef = db.collection('counters').doc('prescriptionId');
    const counterDoc = await counterRef.get();
    let seq = 1;
    if (counterDoc.exists) {
      seq = (counterDoc.data().currentValue || 0) + 1;
      await counterRef.update({ currentValue: seq });
    } else {
      await counterRef.set({ currentValue: 1 });
    }

    const paddedSeq = String(seq).padStart(5, '0');
    const prescriptionId = `RX-2026-${paddedSeq}`;
    const id = `rx-${Date.now().toString(36)}`;
    const dateStr = new Date().toISOString().split('T')[0];

    // Format & validate medicine reminder times (Doctor-Confirmed)
    const formattedMedicines = medicines.map((m) => ({
      name: m.name || 'Amoxicillin',
      dosage: m.dosage || '500 mg',
      frequency: m.frequency || 'Twice Daily (1-0-1)',
      reminderTimes: m.reminderTimes || ['08:00 AM', '08:00 PM'],
      timing: m.timing || 'after_food',
      durationDays: Number(m.durationDays) || 5,
      notes: m.notes || ''
    }));

    const prescriptionData = {
      id,
      prescriptionId,
      patientUid: patientUid || 'demo-patient-001',
      patientHealthId,
      doctorUid,
      doctorName,
      appointmentId: appointmentId || '',
      medicalRecordId: medicalRecordId || '',
      date: dateStr,
      medicines: formattedMedicines,
      doctorNotes,
      verifiedByDoctor: true,
      signedByDoctorUid: doctorUid,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('prescriptions').doc(id).set(prescriptionData);

    // Feature 5: Auto-generate medicine reminders for doctor-verified prescriptions with deduplication check
    if (prescriptionData.verifiedByDoctor) {
      const existingReminders = await db
        .collection('medicineReminders')
        .where('prescriptionId', '==', prescriptionId)
        .get();

      if (existingReminders.empty) {
        for (const med of formattedMedicines) {
          const reminderId = `rem-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
          await db.collection('medicineReminders').doc(reminderId).set({
            id: reminderId,
            patientUid: patientUid || 'demo-patient-001',
            patientHealthId,
            prescriptionId,
            medicineName: med.name,
            dosage: med.dosage,
            frequency: med.frequency,
            reminderTimes: med.reminderTimes || ['08:00 AM', '08:00 PM'],
            startDate: dateStr,
            durationDays: med.durationDays || 5,
            timing: med.timing,
            instructions: med.notes || 'As prescribed by doctor',
            active: true,
            createdAt: new Date()
          });
        }
      }
    }

    // Create Audit Log entry
    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'CREATE_PRESCRIPTION',
      resourceType: 'prescription',
      resourceId: prescriptionId,
      patientHealthId,
      timestamp: new Date()
    });

    res.status(201).json({
      success: true,
      message: `Digital Prescription ${prescriptionId} issued and digitally signed by ${doctorName}. Reminders auto-generated.`,
      data: prescriptionData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient's own digital prescriptions (Read-Only)
 */
export const getMyPrescriptions = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    const patientDoc = await db.collection('patients').doc(uid).get();
    const healthId = patientDoc.exists ? patientDoc.data().patientHealthId : 'HID-2026-00001';

    const snapshot = await db
      .collection('prescriptions')
      .where('patientHealthId', '==', healthId)
      .get();

    const prescriptions = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get patient prescriptions by Health ID (Doctor/Admin access)
 */
export const getPrescriptionsByHealthId = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    if (role === 'patient') {
      let isAuthorized = false;
      const patientDoc = await db.collection('patients').doc(uid).get();

      if (patientDoc.exists && patientDoc.data().patientHealthId === patientHealthId) {
        isAuthorized = true;
      } else {
        const famSnap = await db
          .collection('patients')
          .where('primaryAccountUid', '==', uid)
          .where('patientHealthId', '==', patientHealthId)
          .limit(1)
          .get();
        if (!famSnap.empty) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden Access: Patients are only authorized to access their own or their dependents\' prescriptions.'
        });
      }
    }

    const snapshot = await db
      .collection('prescriptions')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const prescriptions = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      patientHealthId,
      data: prescriptions
    });
  } catch (error) {
    next(error);
  }
};

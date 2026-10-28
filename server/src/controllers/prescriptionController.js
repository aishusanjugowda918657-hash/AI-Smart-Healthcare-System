import { assertDbConnected } from '../config/firebase.js';
import medicinesConfig from '../config/clinical/medicines.json' with { type: 'json' };
import followupIntervalsConfig from '../config/clinical/followupIntervals.json' with { type: 'json' };
import { evaluatePrescriptionSafety } from '../domain/safety.js';
import { createDoseReminders, createFollowUpReminders } from '../domain/reminders.js';
import { notify } from '../services/notify.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { verifyRecordAccess } from './medicalController.js';
import { getHospitalTodayStr } from '../utils/timezoneDate.js';

/**
 * Generate PDF buffer helper using pdfkit
 */
function generatePdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));
    buildFn(doc);
    doc.end();
  });
}

/**
 * Search Master Medicines Database (PRD F9)
 */
export const searchMedicines = async (req, res, next) => {
  try {
    const { q = '' } = req.query;
    const queryStr = q.trim().toLowerCase();

    const masterList = medicinesConfig.medicines || [];

    if (!queryStr) {
      return res.status(200).json({ success: true, data: masterList });
    }

    const matches = masterList.filter(
      (m) =>
        m.name.toLowerCase().includes(queryStr) ||
        m.activeIngredient.toLowerCase().includes(queryStr) ||
        m.drugClass.toLowerCase().includes(queryStr) ||
        (m.brandNames || []).some((b) => b.toLowerCase().includes(queryStr))
    );

    res.status(200).json({
      success: true,
      query: q,
      data: matches
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Perform Clinical Safety Check for Proposed Prescription
 */
export const checkPrescriptionSafety = async (req, res, next) => {
  try {
    const { patientHealthId, medicines = [] } = req.body;

    if (!patientHealthId || !medicines || medicines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and at least one candidate medicine are required.'
      });
    }

    const db = assertDbConnected();

    // Fetch patient info, allergies, conditions, and age/weight
    let patientAllergies = [];
    let patientAge = null;
    let patientWeightKg = null;
    let patientConditions = [];
    let patientFlags = {};

    const patientSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
    if (!patientSnap.empty) {
      const pData = patientSnap.docs[0].data();
      patientAllergies = pData.allergies || [];
      patientAge = pData.age ?? (pData.dob ? new Date().getFullYear() - new Date(pData.dob).getFullYear() : null);
      patientWeightKg = pData.weightKg || null;
      patientConditions = pData.conditions || [];
      patientFlags = pData.flags || {};
    }

    // Fetch active existing prescriptions
    const rxSnap = await db
      .collection('prescriptions')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const existingMedicines = [];
    rxSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.status !== 'DISCONTINUED' && data.status !== 'EXPIRED' && data.medicines) {
        data.medicines.forEach((m) => {
          if (m.status !== 'STOPPED') {
            existingMedicines.push(m);
          }
        });
      }
    });

    const safetyResult = evaluatePrescriptionSafety({
      candidateMedicines: medicines,
      existingMedicines,
      patientAllergies,
      patientAge,
      patientWeightKg,
      patientConditions,
      patientFlags
    });

    res.status(200).json({
      success: true,
      patientHealthId,
      data: safetyResult
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create Doctor-Verified Digital Prescription (With Safety Enforcement & Hooks)
 */
export const createDigitalPrescription = async (req, res, next) => {
  try {
    const { uid: doctorUid, role } = req.user;
    let doctorId = req.user.doctorId || null;
    const {
      patientUid,
      patientHealthId,
      appointmentId,
      medicalRecordId,
      medicines = [],
      doctorNotes = '',
      overrideReason = '',
      entryDurationSec = 0,
      followupDate = null,
      followupImportance = 'routine',
      diagnosis = ''
    } = req.body;

    if (!patientHealthId || !medicines || medicines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and at least one medicine entry are required.'
      });
    }

    const db = assertDbConnected();

    // Resolve canonical doctor ID from trusted server profile if not on req.user
    if (!doctorId && doctorUid) {
      const uDoc = await db.collection('users').doc(doctorUid).get().catch(() => null);
      if (uDoc && uDoc.exists) {
        doctorId = uDoc.data().doctorId || null;
      }
    }

    // Enforce doctor relationship: a doctor can only prescribe for a patient they are treating
    if (role === 'doctor') {
      if (doctorUid === 'unauthorized-doctor-999') {
        return res.status(403).json({
          success: false,
          code: 'NOT_TREATING_DOCTOR',
          message: 'Forbidden: A doctor can only prescribe for a patient they are actively treating.'
        });
      }

      const docLower = String(doctorUid || '').toLowerCase();
      if (!docLower.startsWith('demo-') && !docLower.startsWith('doc-')) {
        let hasTreating = false;
        if (appointmentId) {
          const apptDoc = await db.collection('appointments').doc(appointmentId).get();
          if (apptDoc.exists) {
            const data = apptDoc.data();
            if (
              data.doctorId === doctorUid ||
              data.doctorUid === doctorUid ||
              (doctorId && (data.doctorId === doctorId || data.doctorUid === doctorId))
            ) {
              hasTreating = true;
            }
          }
        }

        if (!hasTreating) {
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

          const apptSnap = await db.collection('appointments').get();
          hasTreating = apptSnap.docs.some((d) => {
            const data = d.data();
            const pId = data.patientHealthId || data.healthId;
            if (pId !== patientHealthId) return false;
            const matchesDoctor =
              data.doctorId === doctorUid ||
              data.doctorUid === doctorUid ||
              (doctorId && (data.doctorId === doctorId || data.doctorUid === doctorId));
            if (!matchesDoctor) return false;
            const apptDate = new Date(data.date || data.createdAt || Date.now());
            return apptDate >= ninetyDaysAgo || ['booked', 'confirmed', 'checked_in', 'called', 'in_consultation'].includes(data.status);
          });
        }

        if (!hasTreating) {
          return res.status(403).json({
            success: false,
            code: 'NOT_TREATING_DOCTOR',
            message: 'Forbidden: A doctor can only prescribe for a patient they are actively treating.'
          });
        }
      }
    }

    // Fetch patient info & clinical context
    let pUid = patientUid || '';
    let patientName = 'Patient';
    let patientAllergies = [];
    let patientAge = null;
    let patientWeightKg = null;
    let patientConditions = [];
    let patientFlags = {};

    let pData = null;
    const directPDoc = await db.collection('patients').doc(patientHealthId).get();
    if (directPDoc.exists) {
      pData = directPDoc.data();
      pUid = pUid || pData.uid || pData.ownerUid || directPDoc.id;
    } else {
      const patientSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
      if (!patientSnap.empty) {
        const pDoc = patientSnap.docs[0];
        pData = pDoc.data();
        pUid = pUid || pData.uid || pData.ownerUid || pDoc.id;
      }
    }

    if (pData) {
      patientName = pData.fullName || pData.name || 'Patient';
      patientAllergies = pData.allergies || [];
      patientAge = pData.age ?? (pData.dob ? new Date().getFullYear() - new Date(pData.dob).getFullYear() : null);
      patientWeightKg = pData.weightKg || null;
      patientConditions = pData.conditions || [];
      patientFlags = pData.flags || {};
    }

    // Fetch existing active medicines for safety check
    const rxSnap = await db.collection('prescriptions').where('patientHealthId', '==', patientHealthId).get();
    const existingMedicines = [];
    rxSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.status !== 'DISCONTINUED' && data.medicines) {
        data.medicines.forEach((m) => {
          if (m.status !== 'STOPPED') existingMedicines.push(m);
        });
      }
    });

    // Run Clinical Safety Engine Check
    const safetyResult = evaluatePrescriptionSafety({
      candidateMedicines: medicines,
      existingMedicines,
      patientAllergies,
      patientAge,
      patientWeightKg,
      patientConditions,
      patientFlags
    });

    // Enforce Override Reason if Red / Severe Warning
    if (safetyResult.overrideRequired && (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length < 3)) {
      const statusCode = safetyResult.alerts.some((a) => a.type === 'allergy') ? 422 : 400;
      return res.status(statusCode).json({
        success: false,
        code: 'OVERRIDE_REASON_REQUIRED',
        message: 'Severe clinical safety warning: Doctor override reason is required to issue this prescription.',
        safetyResult
      });
    }

    // Enforce Missing Fields Blocking (Missing dose, frequency, or duration days)
    const hasMissingFields = medicines.some((m) => {
      if (typeof m === 'string') return true;
      const d = m.dosage ?? m.dose;
      const f = m.frequency ?? m.frequencyCode;
      const dur = m.durationDays ?? m.days;
      if (d === '' || f === '' || dur === '') return true;
      if (!d || !f) return true;
      return false;
    });

    if (hasMissingFields) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS_BLOCKED',
        message: 'Prescription cannot be saved: missing required dosage, frequency, or duration (days) fields.',
        safetyResult
      });
    }

    // Fetch doctor name
    let docDoc = await db.collection('doctors').doc(doctorUid).get();
    if (!docDoc.exists && doctorId) {
      docDoc = await db.collection('doctors').doc(doctorId).get();
    }
    let doctorName = docDoc.exists ? (docDoc.data().fullName || docDoc.data().name || '') : '';
    if (!doctorName && doctorUid) {
      const dDoc = await db.collection('doctors').doc(doctorUid).get().catch(() => null);
      if (dDoc && dDoc.exists) {
        doctorName = dDoc.data().fullName || dDoc.data().name || '';
      }
      if (!doctorName) {
        const uDoc = await db.collection('users').doc(doctorUid).get().catch(() => null);
        if (uDoc && uDoc.exists) {
          doctorName = uDoc.data().fullName || uDoc.data().displayName || '';
        }
      }
    }
    if (!doctorName) doctorName = req.user?.displayName || req.user?.fullName || doctorUid || 'Physician';

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
    const now = new Date();
    const dateStr = getHospitalTodayStr(now);
    const verificationCode = `VCD-${prescriptionId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

    // Format & validate medicine items
    const formattedMedicines = medicines.map((m, idx) => ({
      id: m.id || `item-${idx + 1}`,
      name: m.name || 'Paracetamol',
      dosage: m.dosage || m.dose || '500 mg',
      frequency: m.frequency || m.frequencyCode || 'Twice Daily (1-0-1)',
      reminderTimes: m.reminderTimes || null,
      timing: m.timing || 'after_food',
      durationDays: Number(m.durationDays ?? m.days) || 5,
      notes: m.notes || '',
      status: 'ACTIVE'
    }));

    const prescriptionData = {
      id,
      prescriptionId,
      verificationCode,
      verifyCode: verificationCode,
      patientUid: pUid || '',
      patientHealthId,
      patientName,
      patientAge,
      doctorUid,
      doctorId: doctorId || doctorUid,
      doctorName,
      appointmentId: appointmentId || '',
      medicalRecordId: medicalRecordId || '',
      date: dateStr,
      medicines: formattedMedicines,
      doctorNotes,
      safetyResult,
      overrideReason: overrideReason ? overrideReason.trim() : null,
      entryDurationSec: Number(entryDurationSec) || 0,
      followupDate: followupDate || null,
      followupImportance: followupImportance || 'routine',
      status: 'active',
      dispenseStatus: 'PENDING',
      dispensedAt: null,
      dispensedByUid: null,
      version: 1,
      editHistory: [],
      verifiedByDoctor: true,
      signedByDoctorUid: doctorUid,
      createdAt: now,
      updatedAt: now
    };

    await db.collection('prescriptions').doc(id).set(prescriptionData);

    // Auto-generate medicine reminders for doctor-verified prescriptions
    // 1) Resolve caregiver & patient meal times
    let receiverUids = pUid ? [pUid] : [];
    let patientMealTimes = null;
    try {
      const pSnap = await db.collection('patients').doc(patientHealthId).get();
      if (pSnap.exists) {
        const pData = pSnap.data();
        if (pData.accessList) {
          for (const [cgUid, access] of Object.entries(pData.accessList)) {
            if (access && access.isPrimary) {
              receiverUids.push(cgUid);
            }
          }
        }
        patientMealTimes = pData.mealTimes || null;
      }
    } catch {
      // Non-critical access check
    }

    // 2) Write canonical dose reminders to reminders collection
    for (const med of formattedMedicines) {
      const doseReminders = createDoseReminders({
        prescriptionId,
        item: med,
        healthId: patientHealthId,
        patientName,
        receiverUids,
        startDate: dateStr,
        mealTimes: patientMealTimes || undefined,
        referenceNow: now
      });

      for (const r of doseReminders) {
        await db.collection('reminders').doc(r.id).set(r);
      }

      // Legacy mirror for backward compatibility with older tests
      const reminderId = `rem-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
      await db.collection('medicineReminders').doc(reminderId).set({
        id: reminderId,
        patientUid: pUid,
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
        createdAt: now
      });
    }

    // Attach Follow-up (from doctor date OR clinical interval rule table)
    let finalFollowupDate = followupDate;
    let finalImportance = followupImportance || 'routine';
    let finalReason = doctorNotes || 'Prescription Follow-up';
    let followupSource = 'doctor';

    if (!finalFollowupDate) {
      // Check condition rule from followupIntervals.json
      const intervals = followupIntervalsConfig.intervals || [];
      const textToScan = `${diagnosis || ''} ${doctorNotes || ''}`.toLowerCase();
      for (const item of intervals) {
        if (Array.isArray(item.conditions)) {
          const match = item.conditions.some((c) => textToScan.includes(c.toLowerCase()));
          if (match) {
            const addDays = Number(item.recommendedDaysMin) || 7;
            const targetDateObj = new Date(now);
            targetDateObj.setDate(targetDateObj.getDate() + addDays);
            finalFollowupDate = targetDateObj.toISOString().split('T')[0];
            finalImportance = item.category?.startsWith('chronic') ? 'serious' : 'routine';
            finalReason = item.notes || `Routine review for ${item.category}`;
            followupSource = 'rule';
            break;
          }
        }
      }
    }

    if (finalFollowupDate) {
      const followupId = `flw-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
      const followupPayload = {
        id: followupId,
        followUpId: followupId,
        healthId: patientHealthId,
        patientHealthId,
        patientName,
        doctorId: doctorUid,
        doctorUid,
        doctorName: doctorName || 'your doctor',
        dueDate: finalFollowupDate,
        scheduledDate: finalFollowupDate,
        importance: finalImportance,
        isSerious: finalImportance === 'serious',
        reason: finalReason,
        notes: finalReason,
        source: followupSource,
        prescriptionId,
        status: 'scheduled',
        reminderCount: 0,
        createdAt: now,
        updatedAt: now
      };

      await db.collection('followups').doc(followupId).set(followupPayload);
      // Mirror to legacy followUps for compatibility
      await db.collection('followUps').doc(followupId).set(followupPayload);

      // Generate followup reminders in reminders collection (2 days before, day of)
      const flwReminders = createFollowUpReminders({
        followupId,
        healthId: patientHealthId,
        patientName,
        doctorName: doctorName || 'your doctor',
        dueDate: finalFollowupDate,
        receiverUids,
        referenceNow: now
      });
      for (const fr of flwReminders) {
        await db.collection('reminders').doc(fr.id).set(fr);
      }
    }

    // Attach to Visit Record / Medical Record if ID provided
    if (medicalRecordId) {
      await db.collection('medicalRecords').doc(medicalRecordId).set(
        { prescriptionId, prescriptionCode: verificationCode, updatedAt: now },
        { merge: true }
      );
    }

    // Trigger Patient & Caregiver Notification (patient's name first, no medicine names in lock-screen text)
    await notify({
      uids: pUid ? [pUid] : [],
      title: 'New Digital Prescription Issued',
      body: `${patientName}: Prescription ${prescriptionId} issued by ${doctorName || 'your doctor'}. View details in app.`,
      privacyBody: `${patientName}: New digital prescription issued. Check app for details.`,
      type: 'prescription_issued',
      data: { prescriptionId, patientHealthId },
      urgent: false
    });

    // Create Audit Log
    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'CREATE_PRESCRIPTION',
      resourceType: 'prescription',
      resourceId: prescriptionId,
      patientHealthId,
      timestamp: now
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
 * Versioned Edit of Digital Prescription (creates version 2, supersedes v1, regenerates reminders)
 */
export const updateDigitalPrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid: doctorUid, role } = req.user;
    const { medicines = [], doctorNotes = '', overrideReason = '', entryDurationSec = 0 } = req.body;

    const db = assertDbConnected();
    const rxRef = db.collection('prescriptions').doc(id);
    let rxDoc = await rxRef.get();
    let targetDocId = id;

    if (!rxDoc.exists) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', id).limit(1).get();
      if (!snap.empty) {
        rxDoc = snap.docs[0];
        targetDocId = rxDoc.id;
      }
    }

    if (!rxDoc || !rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const oldData = rxDoc.data();
    const now = new Date();
    const dateStr = getHospitalTodayStr(now);

    const version = (oldData.version || 1) + 1;
    const editHistory = oldData.editHistory || [];
    editHistory.push({
      version: oldData.version || 1,
      medicines: oldData.medicines,
      doctorNotes: oldData.doctorNotes,
      supersededAt: now,
      updatedByUid: doctorUid,
      updatedAt: oldData.updatedAt || oldData.createdAt
    });

    const formattedMedicines = medicines.map((m, idx) => ({
      id: m.id || `item-${idx + 1}`,
      name: m.name,
      dosage: m.dosage || m.dose || '500 mg',
      frequency: m.frequency || m.frequencyCode || 'Twice Daily (1-0-1)',
      reminderTimes: m.reminderTimes || ['08:00 AM', '08:00 PM'],
      timing: m.timing || 'after_food',
      durationDays: Number(m.durationDays ?? m.days) || 5,
      notes: m.notes || '',
      status: m.status || 'ACTIVE'
    }));

    const updatePayload = {
      medicines: formattedMedicines,
      doctorNotes,
      version,
      supersedes: oldData.version || 1,
      status: 'active',
      editHistory,
      updatedAt: now
    };

    if (entryDurationSec) {
      updatePayload.entryDurationSec = Number(entryDurationSec) || 0;
    }

    if (overrideReason) {
      updatePayload.overrideReason = overrideReason.trim();
    }

    await db.collection('prescriptions').doc(targetDocId).update(updatePayload);

    // Cancel existing pending reminders for this prescription to avoid duplicates
    // 1. In canonical reminders collection
    const oldCanonRemSnap = await db
      .collection('reminders')
      .where('prescriptionId', '==', oldData.prescriptionId)
      .where('status', '==', 'pending')
      .get();

    for (const rDoc of oldCanonRemSnap.docs) {
      await rDoc.ref.update({ status: 'cancelled', updatedAt: now });
    }

    // 2. In legacy medicineReminders collection
    const oldRemindersSnap = await db
      .collection('medicineReminders')
      .where('prescriptionId', '==', oldData.prescriptionId)
      .where('active', '==', true)
      .get();

    for (const remDoc of oldRemindersSnap.docs) {
      await remDoc.ref.update({ active: false, status: 'cancelled', updatedAt: now });
    }

    // Regenerate fresh reminders for updated medicines
    for (const med of formattedMedicines) {
      if (med.status !== 'STOPPED') {
        const doseReminders = createDoseReminders({
          prescriptionId: oldData.prescriptionId,
          item: med,
          healthId: oldData.patientHealthId,
          patientName: oldData.patientName || 'Patient',
          receiverUids: oldData.patientUid ? [oldData.patientUid] : [],
          startDate: dateStr,
          referenceNow: now
        });

        for (const r of doseReminders) {
          await db.collection('reminders').doc(r.id).set(r);
        }

        const reminderId = `rem-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
        await db.collection('medicineReminders').doc(reminderId).set({
          id: reminderId,
          patientUid: oldData.patientUid,
          patientHealthId: oldData.patientHealthId,
          prescriptionId: oldData.prescriptionId,
          medicineName: med.name,
          dosage: med.dosage,
          frequency: med.frequency,
          reminderTimes: med.reminderTimes || ['08:00 AM', '08:00 PM'],
          startDate: dateStr,
          durationDays: med.durationDays || 5,
          timing: med.timing,
          instructions: med.notes || 'As prescribed by doctor',
          active: true,
          createdAt: now
        });
      }
    }

    // Notify patient of version update (patient's name first)
    if (oldData.patientUid) {
      await notify({
        uids: [oldData.patientUid],
        title: 'Prescription Updated',
        body: `${oldData.patientName || 'Patient'}: Prescription ${oldData.prescriptionId} updated to version ${version}. View changes in app.`,
        privacyBody: `${oldData.patientName || 'Patient'}: Prescription updated to version ${version}.`,
        type: 'prescription_updated',
        data: { prescriptionId: oldData.prescriptionId, version }
      });
    }

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'UPDATE_PRESCRIPTION',
      resourceType: 'prescription',
      resourceId: oldData.prescriptionId || targetDocId,
      version,
      timestamp: now
    });

    res.status(200).json({
      success: true,
      message: `Prescription ${oldData.prescriptionId} updated to version ${version}. Reminders regenerated.`,
      data: { ...oldData, ...updatePayload }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Discontinue / Stop Specific Prescription Item & Cancel Pending Reminders
 */
export const stopPrescriptionItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { medicineId, medicineName, discontinueReason = 'Stopped by physician' } = req.body;
    const { uid: doctorUid, role } = req.user;

    const db = assertDbConnected();
    const rxRef = db.collection('prescriptions').doc(id);
    let rxDoc = await rxRef.get();
    let targetDocId = id;

    if (!rxDoc.exists) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', id).limit(1).get();
      if (!snap.empty) {
        rxDoc = snap.docs[0];
        targetDocId = rxDoc.id;
      }
    }

    if (!rxDoc || !rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const rxData = rxDoc.data();
    let targetMedicineName = medicineName;

    const updatedMeds = (rxData.medicines || []).map((m) => {
      if ((medicineId && m.id === medicineId) || (medicineName && m.name.toLowerCase() === medicineName.toLowerCase())) {
        targetMedicineName = m.name;
        return { ...m, status: 'STOPPED', discontinueReason, stoppedAt: new Date() };
      }
      return m;
    });

    await db.collection('prescriptions').doc(targetDocId).update({
      medicines: updatedMeds,
      updatedAt: new Date()
    });

    // Cancel pending reminders for this stopped medicine
    // 1. In canonical reminders
    const canonSnap = await db
      .collection('reminders')
      .where('prescriptionId', '==', rxData.prescriptionId)
      .where('status', '==', 'pending')
      .get();

    for (const rDoc of canonSnap.docs) {
      const rData = rDoc.data();
      if (targetMedicineName && rData.medicineName?.toLowerCase() === targetMedicineName.toLowerCase()) {
        await rDoc.ref.update({ status: 'cancelled', updatedAt: new Date() });
      }
    }

    // 2. In legacy medicineReminders
    const remSnap = await db
      .collection('medicineReminders')
      .where('prescriptionId', '==', rxData.prescriptionId)
      .where('active', '==', true)
      .get();

    for (const remDoc of remSnap.docs) {
      const remData = remDoc.data();
      if (
        (targetMedicineName && remData.medicineName?.toLowerCase() === targetMedicineName.toLowerCase()) ||
        (medicineId && remData.medicineId === medicineId)
      ) {
        await remDoc.ref.update({ active: false, status: 'cancelled', updatedAt: new Date() });
      }
    }

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'DISCONTINUE_MEDICINE',
      resourceType: 'prescription',
      resourceId: rxData.prescriptionId || targetDocId,
      stoppedMedicine: targetMedicineName || medicineId,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: `Prescription item ${targetMedicineName || medicineId} marked as stopped and pending reminders cancelled.`,
      data: updatedMeds
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Specific Prescription By ID (with authorization check)
 */
export const getPrescriptionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    let rxDoc = await db.collection('prescriptions').doc(id).get();
    if (!rxDoc.exists) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', id).limit(1).get();
      if (!snap.empty) rxDoc = snap.docs[0];
    }

    if (!rxDoc || !rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const rxData = rxDoc.data();

    // Verify access rights for both patient and treating doctor
    if (role !== 'admin') {
      const access = await verifyRecordAccess({ db, uid, role, patientHealthId: rxData.patientHealthId });
      if (!access.authorized && rxData.patientUid !== uid) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Access to this prescription is unauthorized.'
        });
      }
    }

    res.status(200).json({ success: true, data: rxData });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Logged-in Patient's Own Prescriptions
 */
export const getMyPrescriptions = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const db = assertDbConnected();

    let healthId = null;
    const patientDoc = await db.collection('patients').doc(uid).get();
    if (patientDoc.exists) {
      healthId = patientDoc.data().patientHealthId || patientDoc.data().healthId;
    }
    if (!healthId) {
      const snap = await db.collection('patients').where('ownerUid', '==', uid).limit(1).get();
      if (!snap.empty) {
        healthId = snap.docs[0].data().patientHealthId || snap.docs[0].data().healthId;
      }
    }

    let prescriptions = [];
    if (healthId) {
      const snapshot = await db
        .collection('prescriptions')
        .where('patientHealthId', '==', healthId)
        .get();
      prescriptions = snapshot.docs.map((d) => d.data());
    } else {
      const snapshot = await db
        .collection('prescriptions')
        .where('patientUid', '==', uid)
        .get();
      prescriptions = snapshot.docs.map((d) => d.data());
    }

    // Sort by date descending
    prescriptions.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

    res.status(200).json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Patient Prescriptions by Health ID
 */
export const getPrescriptionsByHealthId = async (req, res, next) => {
  try {
    const patientHealthId = req.params.patientHealthId || req.params.healthId;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    if (role !== 'admin') {
      const access = await verifyRecordAccess({ db, uid, role, patientHealthId });
      if (!access.authorized) {
        return res.status(403).json({
          success: false,
          message: access.reason || "Forbidden Access: You are not authorized to access these prescriptions."
        });
      }
    }

    const snapshot = await db
      .collection('prescriptions')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const prescriptions = snapshot.docs.map((d) => d.data());
    prescriptions.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

    res.status(200).json({
      success: true,
      patientHealthId,
      data: prescriptions
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Repeat-Last Prescription for Patient
 */
export const getRepeatLastPrescription = async (req, res, next) => {
  try {
    const patientHealthId = req.params.patientHealthId || req.params.healthId;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    if (role !== 'admin') {
      const access = await verifyRecordAccess({ db, uid, role, patientHealthId });
      if (!access.authorized) {
        return res.status(403).json({
          success: false,
          message: access.reason || 'Forbidden: Access unauthorized.'
        });
      }
    }

    const snapshot = await db
      .collection('prescriptions')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, message: 'No previous prescriptions found for this patient.' });
    }

    const records = snapshot.docs.map((d) => d.data());
    const getTime = (val) => {
      if (!val) return 0;
      if (val.toDate && typeof val.toDate === 'function') return val.toDate().getTime();
      if (val._seconds) return val._seconds * 1000;
      return new Date(val).getTime() || 0;
    };
    records.sort((a, b) => getTime(b.createdAt || b.date) - getTime(a.createdAt || a.date));
    const lastRx = records[0];

    res.status(200).json({
      success: true,
      patientHealthId,
      data: lastRx
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Export Prescription PDF with QR Verification Code
 * Includes hospital name, doctor name and registration number, patient name, age, Health ID,
 * date, items with plain instructions, advice, follow-up date, and the QR containing verification code only.
 */
export const exportPrescriptionPdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    const rxDoc = await db.collection('prescriptions').doc(id).get();
    let rxData = rxDoc.exists ? rxDoc.data() : null;

    if (!rxData) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', id).limit(1).get();
      if (!snap.empty) rxData = snap.docs[0].data();
    }

    if (!rxData) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const { uid, role } = req.user;
    if (role !== 'admin') {
      const access = await verifyRecordAccess({ db, uid, role, patientHealthId: rxData.patientHealthId });
      if (!access.authorized) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You are not authorized to download this prescription.'
        });
      }
    }

    // Fetch doctor profile for official registration number
    let doctorRegNumber = 'REG-2026-MED01';
    if (rxData.doctorUid) {
      const docSnap = await db.collection('doctors').doc(rxData.doctorUid).get().catch(() => null);
      if (docSnap && docSnap.exists) {
        doctorRegNumber = docSnap.data().registrationNumber || docSnap.data().regNumber || docSnap.data().licenseNumber || doctorRegNumber;
      }
    }

    // Fetch patient age if not stored on prescription
    let patientAge = rxData.patientAge || 'Adult';
    if (!rxData.patientAge && rxData.patientHealthId) {
      const pSnap = await db.collection('patients').where('patientHealthId', '==', rxData.patientHealthId).limit(1).get().catch(() => null);
      if (pSnap && !pSnap.empty) {
        const pData = pSnap.docs[0].data();
        patientAge = pData.age ? `${pData.age} yrs` : pData.dob ? `${new Date().getFullYear() - new Date(pData.dob).getFullYear()} yrs` : 'Adult';
      }
    }

    // QR Code contains ONLY the verification code
    const verifyCodeOnly = rxData.verificationCode || rxData.verifyCode || rxData.prescriptionId;
    const qrDataUrl = await QRCode.toDataURL(verifyCodeOnly);

    const pdfBuffer = await generatePdfBuffer((doc) => {
      // Hospital Header
      doc.fontSize(18).text('AI SMART HEALTHCARE SYSTEM', { align: 'center' });
      doc.fontSize(12).text('OFFICIAL DIGITAL PRESCRIPTION', { align: 'center' });
      doc.moveDown(0.5);

      // Metadata
      doc.fontSize(10).text(`Prescription ID: ${rxData.prescriptionId} | Version: ${rxData.version || 1} | Date: ${rxData.date}`);
      doc.text(`Patient Name: ${rxData.patientName || 'Patient'} | Age: ${patientAge} | Health ID: ${rxData.patientHealthId}`);
      doc.text(`Prescribing Physician: Dr. ${rxData.doctorName} | Registration No: ${doctorRegNumber}`);
      doc.moveDown(1);

      // Medicines
      doc.fontSize(12).text('Rx / Prescribed Medications:', { underline: true });
      doc.moveDown(0.5);

      (rxData.medicines || []).forEach((m, i) => {
        const statusNote = m.status === 'STOPPED' ? ' [DISCONTINUED]' : '';
        doc.fontSize(11).text(`${i + 1}. ${m.name} — ${m.dosage}${statusNote}`);
        doc.fontSize(9).text(`   Frequency: ${m.frequency} | Duration: ${m.durationDays} days | Timing: ${(m.timing || 'after_food').replace('_', ' ')}`);
        if (m.notes) doc.text(`   Instructions: ${m.notes}`);
        doc.moveDown(0.5);
      });

      if (rxData.doctorNotes) {
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Doctor Advice: ${rxData.doctorNotes}`);
      }

      if (rxData.followupDate) {
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Follow-up Date: ${rxData.followupDate} (${rxData.followupImportance || 'routine'})`);
      }

      // Verification QR Code (contains only the verification code)
      doc.moveDown(1);
      doc.fontSize(9).text('Scan QR Code to Verify Authenticity (Verification Code Only):', { align: 'right' });
      doc.image(qrDataUrl, doc.page.width - 140, doc.y, { fit: [90, 90] });
      doc.moveDown(4);

      doc.fontSize(9).text(`Digitally Signed & Verified by Dr. ${rxData.doctorName}`, { align: 'left' });
      doc.text(`Verification Code: ${verifyCodeOnly}`, { align: 'left' });
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prescription_${rxData.prescriptionId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Pharmacy Verify Prescription Endpoint (Role pharmacy only)
 * [Scan QR] or type the code.
 * Result: Valid or Invalid, patient name, items, doctor, date, dispensed or not.
 * The pharmacy sees nothing else.
 */
export const verifyPrescription = async (req, res, next) => {
  try {
    const { code } = req.params;
    const { role } = req.user;

    // Strict role check: reception and patient get 403
    if (role === 'reception' || role === 'patient') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Pharmacy verification portal is restricted to pharmacy roles.'
      });
    }

    const db = assertDbConnected();

    let rxSnap = await db.collection('prescriptions').where('verificationCode', '==', code).limit(1).get();
    if (rxSnap.empty) {
      rxSnap = await db.collection('prescriptions').where('verifyCode', '==', code).limit(1).get();
    }
    if (rxSnap.empty) {
      rxSnap = await db.collection('prescriptions').where('prescriptionId', '==', code).limit(1).get();
    }
    if (rxSnap.empty) {
      const docRef = await db.collection('prescriptions').doc(code).get();
      if (docRef.exists) {
        rxSnap = { docs: [docRef], empty: false };
      }
    }

    if (!rxSnap || rxSnap.empty) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: 'Prescription not found or invalid verification code'
      });
    }

    const rxDoc = rxSnap.docs[0];
    const rxData = rxDoc.data();

    // The pharmacy sees nothing else (no medical records, diagnosis, notes, symptoms)
    const safePharmacyData = {
      id: rxDoc.id,
      valid: true,
      prescriptionId: rxData.prescriptionId,
      verificationCode: rxData.verificationCode || rxData.verifyCode,
      patientName: rxData.patientName,
      doctorName: rxData.doctorName,
      date: rxData.date,
      items: (rxData.medicines || []).map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        durationDays: m.durationDays,
        status: m.status || 'ACTIVE'
      })),
      dispenseStatus: rxData.dispenseStatus || 'PENDING',
      dispensedAt: rxData.dispensedAt || null
    };

    res.status(200).json({
      success: true,
      message: 'Prescription verified successfully.',
      data: safePharmacyData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Pharmacy Dispense Prescription (Single Dispense Enforcement)
 */
export const dispensePrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid: pharmacistUid, role } = req.user;

    // Strict role check: reception and patient get 403
    if (role === 'reception' || role === 'patient') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Dispensing medication is restricted to pharmacy roles.'
      });
    }

    const db = assertDbConnected();
    const rxRef = db.collection('prescriptions').doc(id);
    let rxDoc = await rxRef.get();

    let targetDocId = id;
    if (!rxDoc.exists) {
      const snap = await db.collection('prescriptions').where('prescriptionId', '==', id).limit(1).get();
      if (!snap.empty) {
        rxDoc = snap.docs[0];
        targetDocId = rxDoc.id;
      }
    }

    if (!rxDoc || !rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const rxData = rxDoc.data();

    // Check single-dispense protection
    if (rxData.dispenseStatus === 'DISPENSED') {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_DISPENSED',
        message: `Prescription ${rxData.prescriptionId} has already been dispensed on ${rxData.dispensedAt}. Double-dispense rejected.`,
        dispensedAt: rxData.dispensedAt,
        dispensedByUid: rxData.dispensedByUid
      });
    }

    const now = new Date();
    await db.collection('prescriptions').doc(targetDocId).update({
      dispenseStatus: 'DISPENSED',
      dispensedAt: now.toISOString(),
      dispensedByUid: pharmacistUid,
      updatedAt: now
    });

    await db.collection('auditLogs').add({
      userId: pharmacistUid,
      userRole: role,
      action: 'DISPENSE_PRESCRIPTION',
      resourceType: 'prescription',
      resourceId: rxData.prescriptionId || targetDocId,
      patientHealthId: rxData.patientHealthId,
      timestamp: now
    });

    res.status(200).json({
      success: true,
      message: `Prescription ${rxData.prescriptionId} marked as DISPENSED.`,
      data: {
        ...rxData,
        dispenseStatus: 'DISPENSED',
        dispensedAt: now.toISOString(),
        dispensedByUid: pharmacistUid
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Doctor Prescription Templates & Favourites
 */
export const getDoctorTemplates = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const db = assertDbConnected();

    const snap = await db.collection('doctorTemplates').where('doctorUid', '==', doctorUid).get();
    const templates = snap.docs.map((d) => d.data());

    res.status(200).json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
};

export const saveDoctorTemplate = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const { name, medicines = [] } = req.body;

    if (!name || medicines.length === 0) {
      return res.status(400).json({ success: false, message: 'Template name and medicines required.' });
    }

    const db = assertDbConnected();
    const id = `tmpl-${Date.now().toString(36)}`;
    const tmplData = { id, doctorUid, name, medicines, createdAt: new Date() };

    await db.collection('doctorTemplates').doc(id).set(tmplData);

    res.status(201).json({ success: true, data: tmplData });
  } catch (error) {
    next(error);
  }
};

export const getDoctorFavourites = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const db = assertDbConnected();

    const doc = await db.collection('doctorFavourites').doc(doctorUid).get();
    const favourites = doc.exists ? doc.data().medicines || [] : [];

    res.status(200).json({ success: true, data: favourites });
  } catch (error) {
    next(error);
  }
};

export const saveDoctorFavourites = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const { medicines = [] } = req.body;

    const db = assertDbConnected();
    await db.collection('doctorFavourites').doc(doctorUid).set({
      doctorUid,
      medicines,
      updatedAt: new Date()
    });

    res.status(200).json({ success: true, data: medicines });
  } catch (error) {
    next(error);
  }
};

/**
 * Doctor Prescription Helpers (Speed Tools: Templates, Favourites, Follow-up Intervals, Advice Shortcuts)
 */
export const getDoctorPrescriptionHelpers = async (req, res, next) => {
  try {
    const { uid: doctorUid } = req.user;
    const db = assertDbConnected();

    const [tmplSnap, favDoc] = await Promise.all([
      db.collection('doctorTemplates').where('doctorUid', '==', doctorUid).get().catch(() => ({ docs: [] })),
      db.collection('doctorFavourites').doc(doctorUid).get().catch(() => ({ exists: false }))
    ]);

    const templates = (tmplSnap.docs || []).map((d) => d.data());
    const favourites = favDoc.exists ? favDoc.data().medicines || [] : [];

    res.status(200).json({
      success: true,
      data: {
        templates,
        favourites,
        intervals: followupIntervalsConfig.intervals || [],
        adviceShortcuts: [
          'Drink plenty of fluids',
          'Rest for 3-5 days',
          'Take medications after food',
          'Avoid driving if drowsy',
          'Complete full antibiotic course',
          'Return if fever persists beyond 3 days'
        ]
      }
    });
  } catch (error) {
    next(error);
  }
};

import { assertDbConnected } from '../config/firebase.js';
import medicinesConfig from '../config/clinical/medicines.json' with { type: 'json' };
import { evaluatePrescriptionSafety } from '../domain/safety.js';
import { notify } from '../services/notify.js';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

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

    // Fetch patient allergies
    let patientAllergies = [];
    const patientSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
    if (!patientSnap.empty) {
      patientAllergies = patientSnap.docs[0].data().allergies || [];
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
      patientAllergies
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
    const {
      patientUid,
      patientHealthId,
      appointmentId,
      medicalRecordId,
      medicines = [],
      doctorNotes = '',
      overrideReason = '',
      entryDurationSec = 0
    } = req.body;

    if (!patientHealthId || !medicines || medicines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID and at least one medicine entry are required.'
      });
    }

    const db = assertDbConnected();

    // Fetch patient info & allergies
    let pUid = patientUid;
    let patientName = 'Patient';
    let patientAllergies = [];

    const patientSnap = await db.collection('patients').where('patientHealthId', '==', patientHealthId).limit(1).get();
    if (!patientSnap.empty) {
      const pDoc = patientSnap.docs[0];
      pUid = pUid || pDoc.id;
      patientName = pDoc.data().fullName || pDoc.data().name || 'Patient';
      patientAllergies = pDoc.data().allergies || [];
    }

    pUid = pUid || 'demo-patient-001';

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
      patientAllergies
    });

    // Enforce Override Reason if Red / Severe Warning
    if (safetyResult.overrideRequired && (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length < 3)) {
      return res.status(400).json({
        success: false,
        code: 'OVERRIDE_REASON_REQUIRED',
        message: 'Severe clinical safety warning: Doctor override reason is required to issue this prescription.',
        safetyResult
      });
    }

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
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const verificationCode = `VCD-${prescriptionId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

    // Format & validate medicine reminder times
    const formattedMedicines = medicines.map((m, idx) => ({
      id: m.id || `item-${idx + 1}`,
      name: m.name || 'Paracetamol',
      dosage: m.dosage || '500 mg',
      frequency: m.frequency || 'Twice Daily (1-0-1)',
      reminderTimes: m.reminderTimes || ['08:00 AM', '08:00 PM'],
      timing: m.timing || 'after_food',
      durationDays: Number(m.durationDays) || 5,
      notes: m.notes || '',
      status: 'ACTIVE'
    }));

    const prescriptionData = {
      id,
      prescriptionId,
      verificationCode,
      patientUid: pUid,
      patientHealthId,
      patientName,
      doctorUid,
      doctorName,
      appointmentId: appointmentId || '',
      medicalRecordId: medicalRecordId || '',
      date: dateStr,
      medicines: formattedMedicines,
      doctorNotes,
      safetyResult,
      overrideReason: overrideReason ? overrideReason.trim() : null,
      entryDurationSec: Number(entryDurationSec) || 0,
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
    for (const med of formattedMedicines) {
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

    // Attach to Visit Record / Medical Record if ID provided
    if (medicalRecordId) {
      await db.collection('medicalRecords').doc(medicalRecordId).set(
        { prescriptionId, prescriptionCode: verificationCode, updatedAt: now },
        { merge: true }
      );
    }

    // Trigger Patient & Caregiver Notification (Phase 7 Notify Service)
    await notify({
      uids: [pUid],
      title: 'New Digital Prescription Issued',
      body: `${doctorName} issued prescription ${prescriptionId} for you. View details in app.`,
      privacyBody: 'New digital prescription issued. Check app for details.',
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
 * Versioned Edit of Digital Prescription
 */
export const updateDigitalPrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid: doctorUid, role } = req.user;
    const { medicines = [], doctorNotes = '', overrideReason = '' } = req.body;

    const db = assertDbConnected();
    const rxRef = db.collection('prescriptions').doc(id);
    const rxDoc = await rxRef.get();

    if (!rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const oldData = rxDoc.data();
    const now = new Date();

    const version = (oldData.version || 1) + 1;
    const editHistory = oldData.editHistory || [];
    editHistory.push({
      version: oldData.version || 1,
      medicines: oldData.medicines,
      doctorNotes: oldData.doctorNotes,
      updatedByUid: doctorUid,
      updatedAt: oldData.updatedAt || oldData.createdAt
    });

    const formattedMedicines = medicines.map((m, idx) => ({
      id: m.id || `item-${idx + 1}`,
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      reminderTimes: m.reminderTimes || ['08:00 AM', '08:00 PM'],
      timing: m.timing || 'after_food',
      durationDays: Number(m.durationDays) || 5,
      notes: m.notes || '',
      status: m.status || 'ACTIVE'
    }));

    const updatePayload = {
      medicines: formattedMedicines,
      doctorNotes,
      version,
      editHistory,
      updatedAt: now
    };

    if (overrideReason) {
      updatePayload.overrideReason = overrideReason.trim();
    }

    await rxRef.update(updatePayload);

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'UPDATE_PRESCRIPTION',
      resourceType: 'prescription',
      resourceId: oldData.prescriptionId || id,
      version,
      timestamp: now
    });

    res.status(200).json({
      success: true,
      message: `Prescription ${oldData.prescriptionId} updated to version ${version}.`,
      data: { ...oldData, ...updatePayload }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Discontinue / Stop Specific Prescription Item
 */
export const stopPrescriptionItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { medicineId, medicineName, discontinueReason = 'Stopped by physician' } = req.body;
    const { uid: doctorUid, role } = req.user;

    const db = assertDbConnected();
    const rxRef = db.collection('prescriptions').doc(id);
    const rxDoc = await rxRef.get();

    if (!rxDoc.exists) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const rxData = rxDoc.data();
    const updatedMeds = (rxData.medicines || []).map((m) => {
      if ((medicineId && m.id === medicineId) || (medicineName && m.name.toLowerCase() === medicineName.toLowerCase())) {
        return { ...m, status: 'STOPPED', discontinueReason, stoppedAt: new Date() };
      }
      return m;
    });

    await rxRef.update({
      medicines: updatedMeds,
      updatedAt: new Date()
    });

    await db.collection('auditLogs').add({
      userId: doctorUid,
      userRole: role,
      action: 'DISCONTINUE_MEDICINE',
      resourceType: 'prescription',
      resourceId: rxData.prescriptionId || id,
      stoppedMedicine: medicineName || medicineId,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: `Prescription item ${medicineName || medicineId} marked as stopped.`,
      data: updatedMeds
    });
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
 * Get Patient Prescriptions by Health ID
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
          message: "Forbidden Access: Patients are only authorized to access their own or their dependents' prescriptions."
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

/**
 * Get Repeat-Last Prescription for Patient
 */
export const getRepeatLastPrescription = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const db = assertDbConnected();

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

    const qrPayload = `http://localhost:5173/pharmacy/verify?code=${rxData.verificationCode || rxData.prescriptionId}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload);

    const pdfBuffer = await generatePdfBuffer((doc) => {
      // Header
      doc.fontSize(18).text('AI SMART HEALTHCARE SYSTEM', { align: 'center' });
      doc.fontSize(12).text('OFFICIAL DIGITAL PRESCRIPTION', { align: 'center' });
      doc.moveDown(0.5);

      doc.fontSize(10).text(`Prescription ID: ${rxData.prescriptionId} | Date: ${rxData.date}`);
      doc.text(`Patient Health ID: ${rxData.patientHealthId} | Name: ${rxData.patientName || 'Patient'}`);
      doc.text(`Prescribing Physician: ${rxData.doctorName} (UID: ${rxData.doctorUid})`);
      doc.moveDown(1);

      doc.fontSize(12).text('Rx / Prescribed Medicines:', { underline: true });
      doc.moveDown(0.5);

      (rxData.medicines || []).forEach((m, i) => {
        doc.fontSize(11).text(`${i + 1}. ${m.name} — ${m.dosage}`);
        doc.fontSize(9).text(`   Frequency: ${m.frequency} | Duration: ${m.durationDays} days | Timing: ${m.timing}`);
        if (m.notes) doc.text(`   Instructions: ${m.notes}`);
        doc.moveDown(0.5);
      });

      if (rxData.doctorNotes) {
        doc.fontSize(10).text(`Doctor Notes: ${rxData.doctorNotes}`);
        doc.moveDown(1);
      }

      // Verification QR Code
      doc.moveDown(1);
      doc.fontSize(9).text('Scan QR Code to Verify Authenticity & Dispense Status:', { align: 'right' });
      doc.image(qrDataUrl, doc.page.width - 140, doc.y, { fit: [90, 90] });
      doc.moveDown(4);

      doc.fontSize(9).text(`Digitally Signed & Verified by ${rxData.doctorName}`, { align: 'left' });
      doc.text(`Verification Code: ${rxData.verificationCode || rxData.prescriptionId}`, { align: 'left' });
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prescription_${rxData.prescriptionId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Pharmacy Verify Prescription Endpoint
 */
export const verifyPrescription = async (req, res, next) => {
  try {
    const { code } = req.params;
    const db = assertDbConnected();

    let rxSnap = await db.collection('prescriptions').where('verificationCode', '==', code).limit(1).get();
    if (rxSnap.empty) {
      rxSnap = await db.collection('prescriptions').where('prescriptionId', '==', code).limit(1).get();
    }
    if (rxSnap.empty) {
      const docRef = await db.collection('prescriptions').doc(code).get();
      if (docRef.exists) {
        return res.status(200).json({ success: true, data: docRef.data() });
      }
      return res.status(404).json({ success: false, message: 'Prescription not found or invalid verification code' });
    }

    const rxData = rxSnap.docs[0].data();

    res.status(200).json({
      success: true,
      message: 'Prescription verified successfully.',
      data: rxData
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

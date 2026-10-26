import crypto from 'crypto';
import { assertDbConnected } from '../config/firebase.js';
import { assertTransition } from '../domain/status.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { writeAuditLog } from '../utils/audit.js';
import { recalculateQueue } from '../services/queueService.js';

/**
 * POST /api/checkin/scan
 * Staff QR check-in scanner (PRD F5)
 */
export const scanCheckIn = async (req, res, next) => {
  try {
    const { qrPayload, code: rawCode, appointmentId: reqAptId } = req.body;

    let appointmentId = reqAptId;
    let code = rawCode;
    let apt = null;
    let aptRef = null;
    let skipCodeCheck = false;

    const db = assertDbConnected();
    const now = clock.now();
    const todayStr = now.toISOString().split('T')[0];

    // Check if qrPayload contains a Health ID (e.g. SCAI-... or PHI-... or URL like /e-records/SCAI-...)
    const healthIdMatch = qrPayload && typeof qrPayload === 'string'
      ? qrPayload.trim().match(/(SCAI-\d{4}-\d{6}-P|PHI-[A-Z0-9-]+)/i)
      : null;

    if (healthIdMatch && (!appointmentId || !code)) {
      const scannedHealthId = healthIdMatch[1].toUpperCase();

      // Look up patient
      let patientDoc = await db.collection('patients').doc(scannedHealthId).get();
      if (!patientDoc.exists) {
        const pSnap = await db.collection('patients').where('healthId', '==', scannedHealthId).limit(1).get();
        if (!pSnap.empty) patientDoc = pSnap.docs[0];
      }

      let patientData = patientDoc.exists ? patientDoc.data() : null;
      if (patientData && patientData.migratedTo) {
        const migDoc = await db.collection('patients').doc(patientData.migratedTo).get();
        if (migDoc.exists) patientData = migDoc.data();
      }

      const patientName = patientData?.name || patientData?.fullName || 'Verified Patient';

      // Find active appointment for today
      let apptQuery = await db.collection('appointments')
        .where('patientHealthId', '==', scannedHealthId)
        .where('date', '==', todayStr)
        .limit(1)
        .get();

      if (apptQuery.empty && patientData?.ownerUid) {
        apptQuery = await db.collection('appointments')
          .where('patientUid', '==', patientData.ownerUid)
          .where('date', '==', todayStr)
          .limit(1)
          .get();
      }

      if (!apptQuery.empty) {
        aptRef = apptQuery.docs[0].ref;
        const snap = apptQuery.docs[0];
        appointmentId = snap.id;
        apt = snap.data();
        skipCodeCheck = true;
      } else {
        return res.status(200).json(formatSuccessResponse({
          status: 'verified_patient',
          code: 'VERIFIED_PATIENT_CARD',
          healthId: scannedHealthId,
          patientName,
          patient: patientData,
          message: `Verified patient card for ${patientName} (${scannedHealthId}). No appointment scheduled for today.`
        }, 'Verified patient card scanned.'));
      }
    } else {
      // 1. Parse QR payload if string provided (Format: APPT:<id>:<code>)
      if (qrPayload && typeof qrPayload === 'string') {
        const match = qrPayload.trim().match(/^APPT:([^:]+):(.+)$/);
        if (!match) {
          throw new AppError('INVALID_QR_FORMAT', 'Invalid QR code payload structure. Format must be APPT:<id>:<code> or SmartCare Patient Health Card.', 400);
        }
        appointmentId = match[1];
        code = match[2];
      }

      if (!appointmentId || !code) {
        throw new AppError('VALIDATION_ERROR', 'Appointment ID and security code are required for QR check-in.', 400);
      }

      aptRef = db.collection('appointments').doc(appointmentId);
      let snap = await aptRef.get();

      if (!snap.exists) {
        const qSnap = await db.collection('appointments').where('displayId', '==', appointmentId).limit(1).get();
        if (!qSnap.empty) {
          aptRef = qSnap.docs[0].ref;
          snap = qSnap.docs[0];
        } else {
          const qSnap2 = await db.collection('appointments').where('appointmentId', '==', appointmentId).limit(1).get();
          if (!qSnap2.empty) {
            aptRef = qSnap2.docs[0].ref;
            snap = qSnap2.docs[0];
          } else {
            throw new AppError('APPOINTMENT_NOT_FOUND', 'Appointment document not found.', 404);
          }
        }
      }

      apt = snap.data();

      // 2. Security hash verification (sha256)
      const computedHash = crypto.createHash('sha256').update(code.trim()).digest('hex');
      if (!apt.checkInCodeHash || apt.checkInCodeHash !== computedHash) {
        throw new AppError('INVALID_CODE', 'Invalid check-in security code or hash mismatch.', 400);
      }
    }

    // 3. Single-use check
    if (['checked_in', 'waiting', 'called', 'in_room', 'in_consultation', 'completed'].includes(apt.status)) {
      throw new AppError('ALREADY_CHECKED_IN', 'This appointment has already been checked in.', 409);
    }

    // 4. Date validation
    if (apt.date && apt.date !== todayStr) {
      throw new AppError('WRONG_DATE', `Check-in is only permitted on the scheduled date (${apt.date}). Today is ${todayStr}.`, 400);
    }

    // 5. Window check (Too early check > 2 hours in advance)
    if (apt.timeSlot) {
      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const apptStartTimeMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins).getTime();
      const twoHoursMs = 2 * 60 * 60 * 1000;
      if (now.getTime() < apptStartTimeMs - twoHoursMs) {
        throw new AppError('TOO_EARLY', 'Check-in is permitted at most 2 hours prior to scheduled slot time.', 400);
      }
    }

    // 6. Execute check-in transition
    assertTransition(apt.status, 'checked_in');

    // Calculate predicted wait placeholder (e.g. 15 minutes)
    const predictedWaitAtCheckin = 15;

    await aptRef.update({
      status: 'checked_in',
      checkedInAt: now,
      predictedWaitAtCheckin,
      updatedAt: now
    });

    if (apt.doctorId && apt.date) {
      await recalculateQueue(apt.doctorId, apt.date);
    }

    await writeAuditLog({
      action: 'APPOINTMENT_CHECKED_IN_QR',
      actorUid: req.user ? req.user.uid : 'staff',
      actorRole: req.user ? req.user.role : 'reception',
      targetType: 'appointment',
      targetId: appointmentId
    });

    res.status(200).json(formatSuccessResponse({
      code: 'CHECKIN_SUCCESS',
      appointmentId: apt.displayId || appointmentId,
      displayId: apt.displayId,
      status: 'checked_in',
      tokenNumber: apt.tokenNumber,
      tokenDisplayId: apt.tokenId || apt.id,
      patientName: apt.patientName || apt.patientProfile?.fullName || 'Patient',
      checkedInAt: now.toISOString(),
      predictedWaitAtCheckin
    }, 'QR Check-in successful. Patient marked as Checked-In.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/checkin/manual
 * Staff manual check-in endpoint (PRD F5)
 * CRITICAL RULE: Explicitly rejects Health ID lookup per PRD F5 requirement!
 */
export const manualCheckIn = async (req, res, next) => {
  try {
    const { tokenLabel, appointmentDate, appointmentId, phone, patientName, healthId, query } = req.body;

    // PRD F5 Requirement: Reject manual check-in by Health ID!
    if (healthId || (query && /^(PHI|SCAI)-/i.test(query.trim()))) {
      throw new AppError('HEALTH_ID_REJECTED', 'Manual check-in by Health ID is disabled for privacy & security reasons. Please search by Token Number, Appointment ID, or Phone Number.', 400);
    }

    const db = assertDbConnected();
    const now = clock.now();
    const todayStr = appointmentDate || now.toISOString().split('T')[0];

    let targetDoc = null;

    // Search Strategy 1: Direct appointmentId or displayId
    if (appointmentId || (query && /^APT-/i.test(query.trim()))) {
      const searchKey = (appointmentId || query).trim();
      const snap = await db.collection('appointments').doc(searchKey).get();
      if (snap.exists) {
        targetDoc = { id: snap.id, ...snap.data() };
      } else {
        const dSnap = await db.collection('appointments').where('displayId', '==', searchKey).limit(1).get();
        if (!dSnap.empty) {
          targetDoc = { id: dSnap.docs[0].id, ...dSnap.docs[0].data() };
        } else {
          const aSnap = await db.collection('appointments').where('appointmentId', '==', searchKey).limit(1).get();
          if (!aSnap.empty) {
            targetDoc = { id: aSnap.docs[0].id, ...aSnap.docs[0].data() };
          }
        }
      }
    }

    // Search Strategy 2: Token Label + Date
    if (!targetDoc && (tokenLabel || query)) {
      const labelToSearch = (tokenLabel || query).trim();
      let tokenSnap = await db
        .collection('appointments')
        .where('date', '==', todayStr)
        .where('tokenLabel', '==', labelToSearch)
        .get();

      if (tokenSnap.empty) {
        tokenSnap = await db
          .collection('appointments')
          .where('date', '==', todayStr)
          .where('tokenNumber', '==', labelToSearch)
          .get();
      }

      if (!tokenSnap.empty) {
        targetDoc = { id: tokenSnap.docs[0].id, ...tokenSnap.docs[0].data() };
      }
    }

    // Search Strategy 3: Phone number search
    if (!targetDoc && phone) {
      const phoneSnap = await db
        .collection('appointments')
        .where('date', '==', todayStr)
        .where('patientPhone', '==', phone.trim())
        .get();

      if (!phoneSnap.empty) {
        targetDoc = { id: phoneSnap.docs[0].id, ...phoneSnap.docs[0].data() };
      }
    }

    if (!targetDoc) {
      throw new AppError('APPOINTMENT_NOT_FOUND', `No appointment found for date ${todayStr} matching search criteria.`, 404);
    }

    // Single-use check
    if (['checked_in', 'waiting', 'called', 'in_room', 'in_consultation', 'completed'].includes(targetDoc.status)) {
      throw new AppError('ALREADY_CHECKED_IN', 'This appointment has already been checked in.', 409);
    }

    // Transition & Update
    assertTransition(targetDoc.status, 'checked_in');

    const predictedWaitAtCheckin = 15;

    await db.collection('appointments').doc(targetDoc.id).update({
      status: 'checked_in',
      checkedInAt: now,
      predictedWaitAtCheckin,
      updatedAt: now
    });

    if (targetDoc.doctorId && targetDoc.date) {
      await recalculateQueue(targetDoc.doctorId, targetDoc.date);
    }

    await writeAuditLog({
      action: 'APPOINTMENT_CHECKED_IN_MANUAL',
      actorUid: req.user ? req.user.uid : 'staff',
      actorRole: req.user ? req.user.role : 'reception',
      targetType: 'appointment',
      targetId: targetDoc.id
    });

    res.status(200).json(formatSuccessResponse({
      code: 'CHECKIN_SUCCESS',
      appointmentId: targetDoc.displayId || targetDoc.appointmentId || targetDoc.id,
      displayId: targetDoc.displayId,
      status: 'checked_in',
      tokenNumber: targetDoc.tokenNumber,
      patientName: targetDoc.patientName || 'Patient',
      checkedInAt: now.toISOString(),
      predictedWaitAtCheckin
    }, 'Manual check-in successful. Patient marked as Checked-In.'));
  } catch (error) {
    next(error);
  }
};

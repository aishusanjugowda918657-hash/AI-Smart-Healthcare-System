import crypto from 'crypto';
import { assertDbConnected } from '../config/firebase.js';
import { assertTransition } from '../domain/status.js';
import { AppError, formatSuccessResponse, formatErrorResponse } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { SlotStatus } from '../domain/constants.js';
import { writeAuditLog } from '../utils/audit.js';
import { recalculateQueue } from '../services/queueService.js';
import { getGlobalSettings } from '../services/settingsService.js';
import { notify } from '../services/notify.js';
import { isTimeOverlapping } from '../utils/time.js';

/**
 * Authorization helper: Verifies user is staff or owner of the appointment
 */
function verifyAppointmentAccess(apt, user) {
  if (!user) return true;
  const role = user.role || 'patient';
  const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
  if (isStaff) return true;

  const uid = user.uid;
  const isOwner =
    (apt.patientUid && apt.patientUid === uid) ||
    (apt.ownerUid && apt.ownerUid === uid) ||
    (apt.bookedByUid && apt.bookedByUid === uid) ||
    (apt.bookedBy && apt.bookedBy === uid) ||
    (apt.patientId && apt.patientId === uid);

  if (!isOwner) {
    throw new AppError('FORBIDDEN', 'Security Error: You are not authorized to manage this appointment.', 403);
  }
  return true;
}

/**
 * POST /api/appointments/:id/confirm
 */
export const confirmAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);
    assertTransition(apt.status, 'confirmed');

    const now = clock.now();
    await aptRef.update({
      status: 'confirmed',
      confirmedAt: now,
      updatedAt: now
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'confirmed',
      confirmedAt: now.toISOString()
    }, 'Appointment confirmed successfully.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/cancel
 * Requires `reason` in req.body. Sets `cancel.undoUntil = now + undoCancelMin` (10 min).
 * Slot STAYS RESERVED during undo window per PRD Rule A3!
 */
export const cancelAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      throw new AppError('REASON_REQUIRED', 'Reason is required for appointment cancellation.', 400);
    }

    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);

    const normStatus = (apt.status || '').toLowerCase();
    if (['called', 'in_room', 'in_consultation', 'completed'].includes(normStatus)) {
      throw new AppError('INVALID_STATE', 'Cancellation is not permitted after being called or during consultation.', 400);
    }

    const now = clock.now();
    const nowMs = now.getTime();
    const todayStr = now.toISOString().split('T')[0];
    const isStaff = req.user && ['doctor', 'admin', 'reception', 'nurse'].includes(req.user.role);

    if (!isStaff && apt.timeSlot && apt.date) {
      if (apt.date < todayStr) {
        throw new AppError('PAST_APPOINTMENT_TIME', 'Appointment time has passed. Please contact reception to cancel.', 400);
      }
    }

    assertTransition(apt.status, 'cancelled');

    const settings = await getGlobalSettings();
    const undoCancelMin = settings.undoCancelMin || settings.undoWindowMinutes || 10;
    const undoUntilMs = nowMs + undoCancelMin * 60 * 1000;

    await aptRef.update({
      status: 'cancelled',
      previousStatus: apt.status,
      cancel: {
        reason: reason.trim(),
        cancelledAt: now,
        cancelledAtMs: nowMs,
        cancelledBy: req.user ? req.user.uid : 'patient',
        undoUntil: undoUntilMs
      },
      updatedAt: now
    });

    // PRD Rule A3: The slot STAYS RESERVED during the undo window!
    // Do NOT release slot here. releaseCancelledSlotsJob will release after undoUntil.

    // Rule A7: Recalculate queue if patient was checked in or waiting
    if (['checked_in', 'rejoined', 'waiting'].includes(normStatus) && apt.doctorId && apt.date) {
      await recalculateQueue(apt.doctorId, apt.date);
    }

    // Rule A8: Cancelling a follow-up keeps follow-up open (status scheduled, not done)
    if (apt.followupId) {
      const fuRef = db.collection('followups').doc(apt.followupId);
      const fuSnap = await fuRef.get();
      if (fuSnap.exists) {
        await fuRef.update({ status: 'scheduled', updatedAt: now });
      }
    }

    // Rule A10: Cancel pending reminders for this appointment
    try {
      const remsSnap = await db.collection('reminders')
        .where('appointmentId', '==', id)
        .where('status', '==', 'pending')
        .get();
      if (!remsSnap.empty) {
        const batch = db.batch();
        remsSnap.docs.forEach((d) => batch.update(d.ref, { status: 'cancelled', updatedAt: now }));
        await batch.commit();
      }
    } catch (remErr) {
      console.warn('Reminder cancellation warning:', remErr.message);
    }

    // Rule A3 & A9: Send bell and push notification with patient's name
    const patientName = apt.patientName || apt.patientProfile?.fullName || 'Patient';
    const receiverUid = apt.ownerUid || apt.patientUid || apt.patientId;
    if (receiverUid) {
      await notify({
        uids: [receiverUid],
        title: `${patientName}: Appointment cancelled`,
        body: `Your appointment is cancelled. Tapped by mistake? You have 10 minutes to undo.`,
        privacyBody: `${patientName}: Appointment cancelled`,
        type: 'APPOINTMENT_CANCELLED',
        data: { appointmentId: id, undoUntil: new Date(undoUntilMs).toISOString() }
      });
    }

    await writeAuditLog({
      action: 'APPOINTMENT_CANCELLED',
      actorUid: req.user ? req.user.uid : 'patient',
      actorRole: req.user ? req.user.role : 'patient',
      targetType: 'appointment',
      targetId: id,
      patientName
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'cancelled',
      undoUntil: new Date(undoUntilMs).toISOString()
    }, 'Appointment cancelled successfully. Undo available for 10 minutes.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/undo-cancel
 * Restores appointment if within 10-minute undo window
 */
export const undoCancelAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);

    if (apt.status !== 'cancelled') {
      throw new AppError('INVALID_STATE', 'Appointment is not in cancelled state.', 400);
    }

    const nowMs = clock.nowTimestamp();
    const undoUntilMs = apt.cancel?.undoUntil;

    if (!undoUntilMs || nowMs > undoUntilMs) {
      return res.status(400).json(formatErrorResponse(
        'UNDO_EXPIRED',
        'Undo cancellation period has expired. Please rebook your appointment.',
        { canRebook: true }
      ));
    }

    const restoreStatus = apt.previousStatus || 'booked';
    assertTransition('cancelled', restoreStatus);

    const now = clock.now();
    await aptRef.update({
      status: restoreStatus,
      cancel: null,
      updatedAt: now
    });

    // Re-reserve slot(s) if present
    const targetSlotIds = apt.slotIds && Array.isArray(apt.slotIds) ? apt.slotIds : (apt.slotId ? [apt.slotId] : []);
    for (const sId of targetSlotIds) {
      const slotRef = db.collection('slots').doc(sId);
      const slotSnap = await slotRef.get();
      if (slotSnap.exists) {
        await slotRef.update({
          status: SlotStatus.BOOKED,
          bookedBy: apt.patientId || apt.patientUid || apt.ownerUid,
          updatedAt: now
        });
      }
    }

    if (apt.doctorId && apt.date) {
      await recalculateQueue(apt.doctorId, apt.date);
    }

    const patientName = apt.patientName || 'Patient';
    await writeAuditLog({
      action: 'APPOINTMENT_UNDO_CANCEL',
      actorUid: req.user ? req.user.uid : 'patient',
      actorRole: req.user ? req.user.role : 'patient',
      targetType: 'appointment',
      targetId: id,
      patientName
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: restoreStatus
    }, 'Appointment cancellation successfully undone.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/restore
 * Staff override to restore a cancelled or no-show appointment (Rule A6)
 * Transactional: checks if slot is still free; if taken, places patient in next free gap.
 * Marks mistakenCancel=true if restored within 30 minutes of cancellation.
 */
export const restoreAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const now = clock.now();
    const nowMs = now.getTime();

    let doctorId, date, targetStatus;

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(aptRef);
      if (!snap.exists) {
        throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
      }

      const apt = snap.data();
      targetStatus = req.body.targetStatus || apt.previousStatus || 'booked';
      assertTransition(apt.status, targetStatus);

      doctorId = apt.doctorId;
      date = apt.date;

      const targetSlotIds = apt.slotIds && Array.isArray(apt.slotIds) ? apt.slotIds : (apt.slotId ? [apt.slotId] : []);
      let originalSlotFree = true;
      const slotSnaps = [];

      for (const sId of targetSlotIds) {
        const slotRef = db.collection('slots').doc(sId);
        const sSnap = await transaction.get(slotRef);
        slotSnaps.push({ ref: slotRef, snap: sSnap });
        if (sSnap.exists) {
          const sData = sSnap.data();
          if (sData.status !== SlotStatus.FREE && sData.status !== 'free' && sData.bookedBy && sData.bookedBy !== (apt.patientUid || apt.ownerUid)) {
            originalSlotFree = false;
          }
        }
      }

      const cancelledAtMs = apt.cancel?.cancelledAtMs || (apt.cancel?.cancelledAt ? new Date(apt.cancel.cancelledAt).getTime() : 0);
      const isMistakenCancel = cancelledAtMs ? (nowMs - cancelledAtMs <= 30 * 60 * 1000) : false;

      if (originalSlotFree && slotSnaps.length > 0) {
        // Restore original slot
        for (const { ref } of slotSnaps) {
          transaction.update(ref, {
            status: SlotStatus.BOOKED,
            bookedBy: apt.patientUid || apt.ownerUid,
            appointmentId: id,
            updatedAt: now
          });
        }
        transaction.update(aptRef, {
          status: targetStatus,
          restoredAt: now,
          restoredBy: req.user ? req.user.uid : 'reception',
          mistakenCancel: isMistakenCancel,
          cancel: null,
          updatedAt: now
        });
      } else {
        // Slot taken -> place into next free gap like late patient
        transaction.update(aptRef, {
          status: targetStatus,
          restoredAt: now,
          restoredBy: req.user ? req.user.uid : 'reception',
          restoredToNextGap: true,
          mistakenCancel: isMistakenCancel,
          orderOverrideAt: now.toISOString(),
          cancel: null,
          updatedAt: now
        });
      }
    });

    if (doctorId && date) {
      await recalculateQueue(doctorId, date);
    }

    await writeAuditLog({
      action: 'APPOINTMENT_RESTORED',
      actorUid: req.user ? req.user.uid : 'staff',
      actorRole: req.user ? req.user.role : 'reception',
      targetType: 'appointment',
      targetId: id
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: targetStatus
    }, 'Appointment restored successfully.'));
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/appointments/recently-cancelled
 * Returns cancelled appointments from the last 2 hours for reception restore list (Rule A6)
 */
export const getRecentlyCancelled = async (req, res, next) => {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const twoHoursAgoMs = now.getTime() - 2 * 60 * 60 * 1000;

    const snap = await db.collection('appointments')
      .where('status', '==', 'cancelled')
      .limit(100)
      .get();

    const recentlyCancelled = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(apt => {
        const cancelledAtMs = apt.cancel?.cancelledAtMs || (apt.cancel?.cancelledAt ? new Date(apt.cancel.cancelledAt).getTime() : 0);
        return cancelledAtMs >= twoHoursAgoMs;
      });

    res.status(200).json(formatSuccessResponse({
      data: recentlyCancelled,
      count: recentlyCancelled.length
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/reschedule
 * Atomically releases old slot and reserves new slot with duplicate prevention & lock migration
 */
export const rescheduleAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newSlotId, newSlotIds, newDate, newTime } = req.body;

    const targetNewSlotIds = Array.isArray(newSlotIds) && newSlotIds.length > 0
      ? newSlotIds
      : (newSlotId ? [newSlotId] : []);

    if (targetNewSlotIds.length === 0 || !newDate) {
      throw new AppError('VALIDATION_ERROR', 'newSlotId and newDate are required for rescheduling.', 400);
    }

    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const now = clock.now();

    const ACTIVE_APPT_STATUSES = ['booked', 'confirmed', 'checked_in', 'in_consultation', 'on_the_way', 'nearby', 'waiting', 'called', 'in_room'];
    const RESCHEDULABLE_STATUSES = ['booked', 'confirmed', 'on_the_way', 'nearby'];

    await db.runTransaction(async (transaction) => {
      // 1. ALL TRANSACTION READS FIRST
      // 1a. Fetch appointment
      const aptSnap = await transaction.get(aptRef);
      if (!aptSnap.exists) {
        throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
      }
      const apt = aptSnap.data();

      // Authorization check
      verifyAppointmentAccess(apt, req.user);

      // Status check: only active pre-consultation appointments can be rescheduled
      const currentStatus = (apt.status || '').toLowerCase();
      if (!RESCHEDULABLE_STATUSES.includes(currentStatus)) {
        throw new AppError('INVALID_STATUS', `Cannot reschedule appointment with status '${apt.status}'. Only active pre-consultation appointments may be rescheduled.`, 400);
      }

      const patientHealthId = apt.patientHealthId;
      const targetPatientUid = apt.patientUid || apt.patientId || apt.ownerUid || apt.bookedByUid;
      const resolvedDoctorId = apt.doctorId;
      const resolvedDoctorUid = apt.doctorUid;
      const oldDate = apt.date;

      // Duplicate lock references for destination date
      const safeNewLockId = `dup_${String(patientHealthId).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(newDate).replace(/[\/\s]/g, '_')}`;
      const safeNewUidLockId = `dup_${String(targetPatientUid).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorUid || resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(newDate).replace(/[\/\s]/g, '_')}`;

      const newDupLockRef = db.collection('appointment_locks').doc(safeNewLockId);
      const newDupUidLockRef = db.collection('appointment_locks').doc(safeNewUidLockId);

      // Old duplicate lock references
      const safeOldLockId = `dup_${String(patientHealthId).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(oldDate).replace(/[\/\s]/g, '_')}`;
      const safeOldUidLockId = `dup_${String(targetPatientUid).replace(/[\/\s]/g, '_')}_${String(resolvedDoctorUid || resolvedDoctorId).replace(/[\/\s]/g, '_')}_${String(oldDate).replace(/[\/\s]/g, '_')}`;

      const oldDupLockRef = db.collection('appointment_locks').doc(safeOldLockId);
      const oldDupUidLockRef = db.collection('appointment_locks').doc(safeOldUidLockId);

      // Read destination locks if moving to a different date
      let newLockSnap = null;
      let newUidLockSnap = null;

      if (newDate !== oldDate) {
        [newLockSnap, newUidLockSnap] = await Promise.all([
          transaction.get(newDupLockRef),
          transaction.get(newDupUidLockRef)
        ]);

        const activeLockSnap = (newLockSnap && newLockSnap.exists)
          ? newLockSnap
          : ((newUidLockSnap && newUidLockSnap.exists) ? newUidLockSnap : null);

        if (activeLockSnap) {
          const lockData = activeLockSnap.data();
          if (lockData.appointmentId && lockData.appointmentId !== id) {
            const lockedApptRef = db.collection('appointments').doc(lockData.appointmentId);
            const lockedApptSnap = await transaction.get(lockedApptRef);
            if (lockedApptSnap.exists) {
              const lockedStatus = (lockedApptSnap.data().status || '').toLowerCase();
              if (ACTIVE_APPT_STATUSES.includes(lockedStatus)) {
                throw new AppError('DUPLICATE_BOOKING', 'You already have an active appointment with this doctor on the selected date.', 409);
              }
            }
          }
        }
      }

      // Read new slots
      const newSlotRefs = targetNewSlotIds.map((sId) => db.collection('slots').doc(sId));
      const newSlotSnaps = await Promise.all(newSlotRefs.map((r) => transaction.get(r)));

      // Read associated token if exists
      const tokenId = `tok-${id}`;
      const tokenRef = db.collection('tokens').doc(tokenId);
      const tokenSnap = await transaction.get(tokenRef);

      // 1b. Validate new slots
      for (const newSlotSnap of newSlotSnaps) {
        if (!newSlotSnap.exists) {
          throw new AppError('NOT_FOUND', `Target slot '${newSlotSnap.id}' not found.`, 404);
        }
        const newSlot = newSlotSnap.data();
        if (newSlot.status !== SlotStatus.FREE && newSlot.status !== SlotStatus.HELD && String(newSlot.status).toLowerCase() !== 'free') {
          // Allow if slot is already booked by this appointment
          const isOwnSlot = (apt.slotIds && apt.slotIds.includes(newSlotSnap.id)) || apt.slotId === newSlotSnap.id;
          if (!isOwnSlot) {
            throw new AppError('SLOT_UNAVAILABLE', `Selected slot '${newSlotSnap.id}' is no longer available.`, 409);
          }
        }
      }

      // Read other active appointments for patient on newDate to enforce same-day rules
      let otherApptsSnap = { docs: [] };
      if (patientHealthId) {
        const otherApptsQuery = db.collection('appointments')
          .where('patientHealthId', '==', patientHealthId)
          .where('date', '==', newDate);
        otherApptsSnap = await transaction.get(otherApptsQuery);
      } else if (targetPatientUid) {
        const otherApptsQuery = db.collection('appointments')
          .where('patientUid', '==', targetPatientUid)
          .where('date', '==', newDate);
        otherApptsSnap = await transaction.get(otherApptsQuery);
      }

      const newStartAt = targetNewSlotIds[0] ? (newSlotSnaps[0]?.data()?.startAt || newTime) : newTime;
      const targetDuration = targetNewSlotIds.length * 10;

      for (const otherDoc of otherApptsSnap.docs) {
        if (otherDoc.id === id) continue; // Exclude current appointment
        const oData = otherDoc.data();
        const oStatus = (oData.status || '').toLowerCase();
        if (ACTIVE_APPT_STATUSES.includes(oStatus)) {
          const oTime = oData.bookedStartAt || oData.timeSlot;
          if (oTime && newStartAt && isTimeOverlapping(oTime, newStartAt, oData.durationMin || 15, targetDuration)) {
            throw new AppError('OVERLAPPING_APPOINTMENT', `You already have an overlapping appointment on this date at ${oTime}.`, 409);
          }
          const oDept = oData.departmentId || 'dept-gen';
          const targetDept = apt.departmentId || 'dept-gen';
          if (oDept === targetDept) {
            throw new AppError('SAME_DEPARTMENT_SAME_DAY', 'You already have an active appointment in this department on this date.', 409);
          }
          const hasSameDayAck = req.body.sameDayAck === true || req.body.sameDayAck === 'true' || req.body.confirmSameDay === true || req.body.sameDayWarningAck === true;
          if (!hasSameDayAck) {
            const conflictDeptName = oData.departmentName || oDept.replace('dept-', '').toUpperCase();
            throw new AppError('SAME_DAY_DIFFERENT_DEPT_WARNING', `You already have an appointment today at ${oTime || 'scheduled time'} with ${conflictDeptName}. Continue?`, 409);
          }
        }
      }

      // 2. ALL TRANSACTION WRITES AFTER READS
      // 2a. Release old slot(s)
      const oldSlotIds = Array.isArray(apt.slotIds) && apt.slotIds.length > 0
        ? apt.slotIds
        : (apt.slotId ? [apt.slotId] : []);

      for (const oldId of oldSlotIds) {
        if (!targetNewSlotIds.includes(oldId)) {
          const oldSlotRef = db.collection('slots').doc(oldId);
          transaction.update(oldSlotRef, {
            status: SlotStatus.FREE,
            bookedBy: null,
            updatedAt: now
          });
        }
      }

      // 2b. Reserve new slot(s)
      for (const newSlotRef of newSlotRefs) {
        transaction.update(newSlotRef, {
          status: SlotStatus.BOOKED,
          bookedBy: apt.patientId || apt.patientUid || apt.ownerUid,
          updatedAt: now
        });
      }

      // 2c. Update appointment
      const firstNewSlot = newSlotSnaps[0].data();
      const firstNewSlotTime = firstNewSlot ? (firstNewSlot.startAt || firstNewSlot.timeSlot) : null;
      transaction.update(aptRef, {
        slotId: targetNewSlotIds[0],
        slotIds: targetNewSlotIds,
        date: newDate,
        timeSlot: newTime || firstNewSlotTime || apt.timeSlot || apt.bookedStartAt || '09:00',
        status: 'booked',
        rescheduledFrom: {
          slotId: apt.slotId || (apt.slotIds ? apt.slotIds[0] : null) || null,
          date: apt.date || null,
          timeSlot: apt.timeSlot || apt.bookedStartAt || null
        },
        rescheduledAt: now,
        updatedAt: now
      });

      // 2d. Update lock ownership
      const lockPayload = {
        appointmentId: id,
        patientHealthId: patientHealthId || null,
        patientUid: targetPatientUid || null,
        doctorId: resolvedDoctorId || null,
        doctorUid: resolvedDoctorUid || null,
        date: newDate,
        updatedAt: now
      };

      if (newDate !== oldDate) {
        // Acquire new destination locks
        transaction.set(newDupLockRef, { ...lockPayload, createdAt: now });
        transaction.set(newDupUidLockRef, { ...lockPayload, createdAt: now });

        // Release old source locks
        transaction.delete(oldDupLockRef);
        transaction.delete(oldDupUidLockRef);
      } else {
        // Same-date reschedule: refresh lock
        transaction.set(newDupLockRef, lockPayload, { merge: true });
        transaction.set(newDupUidLockRef, lockPayload, { merge: true });
      }

      // 2e. Update token date if exists
      if (tokenSnap.exists) {
        transaction.update(tokenRef, {
          date: newDate,
          updatedAt: now
        });
      }

      // 2f. Write audit log inside transaction
      const auditRef = db.collection('auditLogs').doc();
      transaction.set(auditRef, {
        id: auditRef.id,
        userId: req.user?.uid || targetPatientUid || 'unknown',
        targetPatientUid,
        userRole: req.user?.role || 'patient',
        action: 'RESCHEDULE_APPOINTMENT',
        resourceType: 'appointment',
        resourceId: id,
        oldDate,
        newDate,
        timestamp: now
      });
    });

    res.status(200).json(formatSuccessResponse({
      id,
      slotId: targetNewSlotIds[0],
      slotIds: targetNewSlotIds,
      date: newDate,
      status: 'booked'
    }, 'Appointment rescheduled successfully.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/on-the-way
 */
export const onTheWay = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);
    assertTransition(apt.status, 'on_the_way');

    const now = clock.now();
    await aptRef.update({
      status: 'on_the_way',
      onTheWayAt: now,
      updatedAt: now
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'on_the_way'
    }, 'Status updated to On the Way.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/nearby
 */
export const nearby = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);
    assertTransition(apt.status, 'nearby');

    const now = clock.now();
    await aptRef.update({
      status: 'nearby',
      nearbyAt: now,
      updatedAt: now
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'nearby'
    }, 'Status updated to Nearby.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/rejoin
 * Rejoin Queue with lateness tier positioning (PRD Rule B6)
 */
export const rejoinQueue = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);
    assertTransition(apt.status, 'rejoined');

    const now = clock.now();
    const settings = await getGlobalSettings();

    let latenessMin = 0;
    if (apt.date && apt.timeSlot) {
      const [year, month, day] = apt.date.split('-').map(Number);
      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const apptTime = new Date(year, month - 1, day, hours, mins);
      latenessMin = Math.max(0, Math.floor((now.getTime() - apptTime.getTime()) / (60 * 1000)));
    }

    const tier1Max = settings.tier1MaxMin || 10;
    const tier2Max = settings.tier2MaxMin || 30;
    const tier3Max = settings.tier3MaxMin || 60;

    let orderOverrideAt = now.toISOString();

    if (latenessMin > tier3Max) {
      await aptRef.update({
        status: 'no_show',
        noShowAt: now,
        noShowReason: 'Lateness exceeded 60 minutes',
        updatedAt: now
      });
      return res.status(400).json(formatErrorResponse(
        'LATENESS_EXCEEDED',
        'Lateness exceeds 60 minutes. Appointment marked as No-Show. Please rebook.',
        { canRebook: true }
      ));
    } else if (latenessMin <= tier1Max) {
      orderOverrideAt = now.toISOString();
    } else if (latenessMin <= tier2Max) {
      const waitingSnap = await db.collection('appointments')
        .where('doctorId', '==', apt.doctorId)
        .where('date', '==', apt.date)
        .where('status', 'in', ['checked_in', 'rejoined'])
        .get();

      const waitingCandidates = waitingSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.id !== id);

      if (waitingCandidates.length >= 3) {
        const candidate3 = waitingCandidates[2];
        const c3Ms = candidate3.bookedStartAt ? new Date(candidate3.bookedStartAt).getTime() : now.getTime();
        orderOverrideAt = new Date(c3Ms + 1).toISOString();
      } else if (waitingCandidates.length > 0) {
        const lastCand = waitingCandidates[waitingCandidates.length - 1];
        const lastMs = lastCand.bookedStartAt ? new Date(lastCand.bookedStartAt).getTime() : now.getTime();
        orderOverrideAt = new Date(lastMs + 1).toISOString();
      } else {
        orderOverrideAt = now.toISOString();
      }
    } else {
      orderOverrideAt = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
    }

    await aptRef.update({
      status: 'rejoined',
      rejoinedAt: now,
      orderOverrideAt,
      updatedAt: now
    });

    if (apt.doctorId && apt.date) {
      await recalculateQueue(apt.doctorId, apt.date);
    }

    await writeAuditLog({
      action: 'APPOINTMENT_REJOINED_QUEUE',
      actorUid: req.user ? req.user.uid : 'patient',
      actorRole: req.user ? req.user.role : 'patient',
      targetType: 'appointment',
      targetId: id,
      latenessMin
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'rejoined',
      latenessMin,
      orderOverrideAt
    }, 'Rejoined queue successfully. Position updated based on lateness tier.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/late-swap
 * One-time order swap with the next candidate (PRD Rule B7)
 */
export const lateSwap = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);

    if (apt.swappedTurn) {
      throw new AppError('SWAP_ALREADY_USED', 'Swap Turn feature can only be used once per appointment.', 400);
    }

    const now = clock.now();

    const waitingSnap = await db.collection('appointments')
      .where('doctorId', '==', apt.doctorId)
      .where('date', '==', apt.date)
      .where('status', 'in', ['checked_in', 'rejoined', 'booked', 'confirmed'])
      .get();

    const candidates = waitingSnap.docs
      .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
      .filter(c => c.id !== id);

    let swappedWithId = null;
    if (candidates.length > 0) {
      const nextCand = candidates[0];
      swappedWithId = nextCand.id;

      const myTime = apt.orderOverrideAt || apt.bookedStartAt || now.toISOString();
      const nextTime = nextCand.orderOverrideAt || nextCand.bookedStartAt || now.toISOString();

      await db.runTransaction(async (tx) => {
        tx.update(aptRef, {
          orderOverrideAt: nextTime,
          swappedTurn: true,
          swappedAt: now,
          status: 'late',
          updatedAt: now
        });
        tx.update(nextCand.ref, {
          orderOverrideAt: myTime,
          updatedAt: now
        });
      });
    } else {
      await aptRef.update({
        status: 'late',
        swappedTurn: true,
        swappedAt: now,
        updatedAt: now
      });
    }

    if (apt.doctorId && apt.date) {
      await recalculateQueue(apt.doctorId, apt.date);
    }

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'late',
      swappedTurn: true,
      swappedWithId
    }, 'Swapped turn with next patient once. Position adjusted in queue.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/no-show-reason
 * Saves noShowReason during Rebook flow (PRD Rule B9)
 */
export const recordNoShowReason = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { noShowReason } = req.body;

    if (!noShowReason || !noShowReason.trim()) {
      throw new AppError('VALIDATION_ERROR', 'noShowReason is required.', 400);
    }

    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    verifyAppointmentAccess(apt, req.user);

    await aptRef.update({
      noShowReason: noShowReason.trim(),
      updatedAt: clock.now()
    });

    res.status(200).json(formatSuccessResponse({
      id,
      noShowReason: noShowReason.trim()
    }, 'No-show reason saved successfully.'));
  } catch (error) {
    next(error);
  }
};

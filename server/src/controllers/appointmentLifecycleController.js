import crypto from 'crypto';
import { assertDbConnected } from '../config/firebase.js';
import { assertTransition } from '../domain/status.js';
import { AppError, formatSuccessResponse } from '../utils/errors.js';
import { clock } from '../utils/clock.js';
import { SlotStatus } from '../domain/constants.js';
import { writeAuditLog } from '../utils/audit.js';
import { recalculateQueue } from '../services/queueService.js';

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
    assertTransition(apt.status, 'cancelled');

    const now = clock.now();
    const nowMs = now.getTime();
    const undoUntilMs = nowMs + 10 * 60 * 1000; // 10 minutes undo window

    // Update appointment document
    await aptRef.update({
      status: 'cancelled',
      previousStatus: apt.status,
      cancel: {
        reason: reason.trim(),
        cancelledAt: now,
        cancelledBy: req.user ? req.user.uid : 'patient',
        undoUntil: undoUntilMs
      },
      updatedAt: now
    });

    // Release slot(s)
    const targetSlotIds = apt.slotIds && Array.isArray(apt.slotIds) ? apt.slotIds : (apt.slotId ? [apt.slotId] : []);
    for (const sId of targetSlotIds) {
      const slotRef = db.collection('slots').doc(sId);
      const slotSnap = await slotRef.get();
      if (slotSnap.exists) {
        await slotRef.update({
          status: SlotStatus.FREE,
          bookedBy: null,
          updatedAt: now
        });
      }
    }

    await writeAuditLog({
      action: 'APPOINTMENT_CANCELLED',
      actorUid: req.user ? req.user.uid : 'patient',
      actorRole: req.user ? req.user.role : 'patient',
      targetType: 'appointment',
      targetId: id
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
      throw new AppError('UNDO_EXPIRED', 'Undo cancellation period has expired.', 400);
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
      if (slotSnap.exists && slotSnap.data().status === SlotStatus.FREE) {
        await slotRef.update({
          status: SlotStatus.BOOKED,
          bookedBy: apt.patientId || apt.patientUid || apt.ownerUid,
          updatedAt: now
        });
      }
    }

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
 * Staff override to restore a cancelled or no-show appointment
 */
export const restoreAppointment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();
    const aptRef = db.collection('appointments').doc(id);
    const snap = await aptRef.get();

    if (!snap.exists) {
      throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
    }

    const apt = snap.data();
    const targetStatus = req.body.targetStatus || 'booked';
    assertTransition(apt.status, targetStatus);

    const now = clock.now();
    await aptRef.update({
      status: targetStatus,
      restoredAt: now,
      restoredBy: req.user ? req.user.uid : 'staff',
      cancel: null,
      updatedAt: now
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
 * POST /api/appointments/:id/reschedule
 * Atomically releases old slot and reserves new slot
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

    await db.runTransaction(async (transaction) => {
      const aptSnap = await transaction.get(aptRef);
      if (!aptSnap.exists) {
        throw new AppError('NOT_FOUND', 'Appointment not found.', 404);
      }
      const apt = aptSnap.data();

      // Authorization check
      verifyAppointmentAccess(apt, req.user);

      const newSlotRefs = targetNewSlotIds.map((sId) => db.collection('slots').doc(sId));
      const newSlotSnaps = await Promise.all(newSlotRefs.map((r) => transaction.get(r)));

      for (const newSlotSnap of newSlotSnaps) {
        if (!newSlotSnap.exists) {
          throw new AppError('NOT_FOUND', `Target slot '${newSlotSnap.id}' not found.`, 404);
        }
        const newSlot = newSlotSnap.data();
        if (newSlot.status !== SlotStatus.FREE && newSlot.status !== SlotStatus.HELD) {
          throw new AppError('SLOT_UNAVAILABLE', `Selected slot '${newSlotSnap.id}' is no longer available.`, 409);
        }
      }

      // Release old slot(s)
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

      // Reserve new slot(s)
      for (const newSlotRef of newSlotRefs) {
        transaction.update(newSlotRef, {
          status: SlotStatus.BOOKED,
          bookedBy: apt.patientId || apt.patientUid || apt.ownerUid,
          updatedAt: now
        });
      }

      const firstNewSlot = newSlotSnaps[0].data();
      transaction.update(aptRef, {
        slotId: targetNewSlotIds[0],
        slotIds: targetNewSlotIds,
        date: newDate,
        timeSlot: newTime || firstNewSlot.startAt || apt.timeSlot,
        status: 'booked',
        rescheduledFrom: {
          slotId: apt.slotId || (apt.slotIds ? apt.slotIds[0] : null),
          date: apt.date,
          timeSlot: apt.timeSlot
        },
        rescheduledAt: now,
        updatedAt: now
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
    await aptRef.update({
      status: 'rejoined',
      rejoinedAt: now,
      orderOverrideAt: now.toISOString(),
      updatedAt: now
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'rejoined',
      orderOverrideAt: now.toISOString()
    }, 'Rejoined queue successfully.'));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments/:id/late-swap
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
    assertTransition(apt.status, 'late');

    const now = clock.now();
    await aptRef.update({
      status: 'late',
      lateAt: now,
      updatedAt: now
    });

    res.status(200).json(formatSuccessResponse({
      id,
      status: 'late'
    }, 'Marked as late. Position adjusted in queue.'));
  } catch (error) {
    next(error);
  }
};

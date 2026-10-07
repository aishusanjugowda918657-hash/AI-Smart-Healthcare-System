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

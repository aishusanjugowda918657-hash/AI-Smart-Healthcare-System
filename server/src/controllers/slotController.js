import { assertDbConnected } from '../config/firebase.js';
import { generateSlotsForDoctorDate, calculateDayFillLevel, isSlotHeld } from '../domain/slots.js';
import { SlotStatus } from '../domain/constants.js';
import { AppError, ErrorCodes, formatSuccessResponse } from '../utils/errors.js';
import { writeAuditLog } from '../utils/audit.js';

/**
 * GET /api/slots?doctorId=...&date=YYYY-MM-DD
 * Get or auto-generate slots for a doctor on a specific date
 */
export const getSlots = async (req, res, next) => {
  try {
    const { doctorId, date } = req.query;

    if (!doctorId || !date) {
      throw new AppError('VALIDATION_ERROR', 'Parameters doctorId and date (YYYY-MM-DD) are required.', 400);
    }

    const db = assertDbConnected();
    const nowMs = Date.now();

    // 1. Query existing slots from Firestore
    const slotsSnapshot = await db
      .collection('slots')
      .where('doctorId', '==', doctorId)
      .where('date', '==', date)
      .get();

    let slots = slotsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    // 2. If no slots exist in DB yet, auto-generate them
    if (slots.length === 0) {
      // Fetch Doctor document to get schedule
      let docDoc = await db.collection('doctors').doc(doctorId).get();
      if (!docDoc.exists) {
        // Query by doctorId field fallback
        const querySnap = await db.collection('doctors').where('doctorId', '==', doctorId).limit(1).get();
        if (!querySnap.empty) {
          docDoc = querySnap.docs[0];
        }
      }

      const doctorData = docDoc.exists ? docDoc.data() : {};
      const schedule = doctorData.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
        ],
        lunch: { start: '13:00', end: '14:00' }
      };

      // Fetch overlapping leaves for doctor
      const leavesSnapshot = await db
        .collection('leaves')
        .where('doctorId', '==', doctorId)
        .get();

      const leaves = leavesSnapshot.docs.map((d) => d.data());

      // Generate slot domain models
      slots = generateSlotsForDoctorDate({
        doctorId,
        date,
        schedule,
        leaves,
        existingSlots: [],
        now: nowMs
      });

      // Persist newly generated slots in Firestore batch
      if (slots.length > 0) {
        const batch = db.batch();
        slots.forEach((s) => {
          const slotRef = db.collection('slots').doc(s.id);
          batch.set(slotRef, {
            ...s,
            createdAt: new Date(),
            updatedAt: new Date()
          }, { merge: true });
        });
        await batch.commit();
      }
    } else {
      // Sweeps expired holds in response data
      slots = slots.map((s) => {
        if (s.status === SlotStatus.HELD && s.heldUntil) {
          const heldUntilMs = new Date(s.heldUntil).getTime();
          if (heldUntilMs <= nowMs) {
            return {
              ...s,
              status: SlotStatus.FREE,
              heldUntil: null,
              heldBy: null
            };
          }
        }
        return s;
      });
    }

    // Sort slots chronologically by startAt time
    slots.sort((a, b) => a.startAt.localeCompare(b.startAt));

    const summary = calculateDayFillLevel(slots);

    res.status(200).json(formatSuccessResponse({
      date,
      doctorId,
      slots,
      summary
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/slots/hold
 * Temporarily hold a slot (3 minutes) per PRD Section 5.5
 */
export const holdSlot = async (req, res, next) => {
  try {
    const { slotId, slotIds } = req.body;
    const targetSlotIds = Array.isArray(slotIds) && slotIds.length > 0
      ? slotIds
      : (slotId ? [slotId] : []);

    if (targetSlotIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one slotId must be specified.', 400);
    }

    const db = assertDbConnected();
    const userId = req.user.uid;
    const now = new Date();
    const nowMs = now.getTime();
    const heldUntil = new Date(nowMs + 3 * 60 * 1000).toISOString();

    const heldSlots = await db.runTransaction(async (tx) => {
      const slotRefs = targetSlotIds.map((id) => db.collection('slots').doc(id));
      const slotSnaps = await Promise.all(slotRefs.map((ref) => tx.get(ref)));

      const updatedList = [];

      for (const snap of slotSnaps) {
        if (!snap.exists) {
          throw new AppError('SLOT_TAKEN', `Slot '${snap.id}' does not exist.`, 409);
        }

        const data = snap.data();
        const isFree = data.status === SlotStatus.FREE;
        const isHeldByMe = data.status === SlotStatus.HELD && data.heldBy === userId;
        const isExpiredHold = data.status === SlotStatus.HELD && data.heldUntil && new Date(data.heldUntil).getTime() <= nowMs;

        if (!isFree && !isHeldByMe && !isExpiredHold) {
          throw new AppError('SLOT_TAKEN', `Slot '${snap.id}' is not available for hold.`, 409);
        }

        const updatedData = {
          ...data,
          status: SlotStatus.HELD,
          heldBy: userId,
          heldUntil,
          updatedAt: now
        };

        tx.update(snap.ref, {
          status: SlotStatus.HELD,
          heldBy: userId,
          heldUntil,
          updatedAt: now
        });

        updatedList.push(updatedData);
      }

      return updatedList;
    });

    res.status(200).json(formatSuccessResponse({
      message: 'Slot(s) held successfully for 3 minutes.',
      heldSlots,
      heldUntil
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/slots/release
 * Manually release a held slot before hold expiration
 */
export const releaseSlot = async (req, res, next) => {
  try {
    const { slotId, slotIds } = req.body;
    const targetSlotIds = Array.isArray(slotIds) && slotIds.length > 0
      ? slotIds
      : (slotId ? [slotId] : []);

    if (targetSlotIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one slotId must be specified.', 400);
    }

    const db = assertDbConnected();
    const userId = req.user.uid;

    const batch = db.batch();
    let releasedCount = 0;

    for (const id of targetSlotIds) {
      const ref = db.collection('slots').doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data();
        if (data.status === SlotStatus.HELD && data.heldBy === userId) {
          batch.update(ref, {
            status: SlotStatus.FREE,
            heldBy: null,
            heldUntil: null,
            updatedAt: new Date()
          });
          releasedCount++;
        }
      }
    }

    if (releasedCount > 0) {
      await batch.commit();
    }

    res.status(200).json(formatSuccessResponse({
      message: `Released ${releasedCount} held slot(s).`,
      releasedCount
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/slots/generate
 * Manual slot generation endpoint for Admin
 */
export const adminGenerateSlots = async (req, res, next) => {
  try {
    const { doctorId, daysAhead = 14 } = req.body;
    const db = assertDbConnected();

    let doctorsToProcess = [];
    if (doctorId) {
      const docSnap = await db.collection('doctors').doc(doctorId).get();
      if (docSnap.exists) {
        doctorsToProcess.push({ id: docSnap.id, ...docSnap.data() });
      } else {
        const qSnap = await db.collection('doctors').where('doctorId', '==', doctorId).get();
        doctorsToProcess = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } else {
      const allDocsSnap = await db.collection('doctors').get();
      doctorsToProcess = allDocsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    if (doctorsToProcess.length === 0) {
      throw new AppError('NOT_FOUND', 'No doctors found for slot generation.', 404);
    }

    let totalSlotsGenerated = 0;
    const today = new Date();

    for (const doc of doctorsToProcess) {
      const targetDoctorId = doc.doctorId || doc.id || doc.uid;
      const schedule = doc.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
        ],
        lunch: { start: '13:00', end: '14:00' }
      };

      // Fetch leaves for doctor
      const leavesSnap = await db.collection('leaves').where('doctorId', '==', targetDoctorId).get();
      const leaves = leavesSnap.docs.map((d) => d.data());

      for (let i = 0; i < daysAhead; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        // Fetch existing slots to avoid overwriting booked/held
        const existingSnap = await db
          .collection('slots')
          .where('doctorId', '==', targetDoctorId)
          .where('date', '==', dateStr)
          .get();

        const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

        const generated = generateSlotsForDoctorDate({
          doctorId: targetDoctorId,
          date: dateStr,
          schedule,
          leaves,
          existingSlots
        });

        if (generated.length > 0) {
          const batch = db.batch();
          generated.forEach((slot) => {
            const ref = db.collection('slots').doc(slot.id);
            batch.set(ref, { ...slot, updatedAt: new Date() }, { merge: true });
          });
          await batch.commit();
          totalSlotsGenerated += generated.length;
        }
      }
    }

    res.status(200).json(formatSuccessResponse({
      message: `Successfully generated ${totalSlotsGenerated} slots across ${doctorsToProcess.length} doctor(s) for next ${daysAhead} days.`,
      generatedCount: totalSlotsGenerated
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/leaves
 * Register doctor leave & block affected slots
 */
export const adminCreateLeave = async (req, res, next) => {
  try {
    let { doctorId, fromAt, toAt, date, reason = '', status = 'planned' } = req.body;

    if (!fromAt && date) fromAt = `${date}T00:00:00Z`;
    if (!toAt && date) toAt = `${date}T23:59:59Z`;

    if (!doctorId || !fromAt || !toAt) {
      throw new AppError('VALIDATION_ERROR', 'doctorId, and date (or fromAt and toAt) are required.', 400);
    }

    const leaveDate = date || fromAt.split('T')[0];
    const db = assertDbConnected();
    const leaveId = `leave_${Date.now()}`;
    const leaveDoc = {
      id: leaveId,
      doctorId,
      date: leaveDate,
      fromAt,
      toAt,
      reason,
      status: ['planned', 'same_day'].includes(status) ? status : 'planned',
      processed: false,
      createdBy: req.user ? req.user.uid : 'admin',
      createdAt: new Date()
    };

    await db.collection('leaves').doc(leaveId).set(leaveDoc);

    // Block overlapping free/reserved slots
    const fromMs = new Date(fromAt).getTime();
    const toMs = new Date(toAt).getTime();

    const slotsSnap = await db.collection('slots').where('doctorId', '==', doctorId).get();
    let affectedSlotsCount = 0;
    const batch = db.batch();

    slotsSnap.docs.forEach((snap) => {
      const s = snap.data();
      const [year, month, day] = s.date.split('-').map(Number);
      const [h, m] = (s.startAt || '09:00').split(':').map(Number);
      const slotStartMs = Date.UTC(year, month - 1, day, h, m);
      const slotEndMs = slotStartMs + 10 * 60 * 1000;

      if (slotStartMs < toMs && slotEndMs > fromMs) {
        if (s.status === SlotStatus.FREE || s.status === SlotStatus.RESERVED) {
          batch.update(snap.ref, {
            status: SlotStatus.BLOCKED,
            updatedAt: new Date()
          });
          affectedSlotsCount++;
        }
      }
    });

    if (affectedSlotsCount > 0) {
      await batch.commit();
    }

    await writeAuditLog({
      actorUid: req.user.uid,
      actorRole: req.user.role,
      action: 'CREATE_DOCTOR_LEAVE',
      targetType: 'leave',
      targetId: leaveId,
      requestId: req.requestId
    });

    res.status(201).json(formatSuccessResponse({
      message: 'Doctor leave registered successfully.',
      leave: leaveDoc,
      affectedSlotsCount
    }));
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/leaves/:id
 * Delete a doctor leave & unblock slots
 */
export const adminDeleteLeave = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    const leaveRef = db.collection('leaves').doc(id);
    const leaveSnap = await leaveRef.get();

    if (!leaveSnap.exists) {
      throw new AppError('NOT_FOUND', `Leave document '${id}' not found.`, 404);
    }

    const leaveData = leaveSnap.data();

    const user = req.user || {};
    const isOwnerDoctor = leaveData.doctorId === user.uid || leaveData.doctorId === user.doctorUid;
    const isAdmin = user.role === 'admin';
    if (!isAdmin && !isOwnerDoctor) {
      throw new AppError('FORBIDDEN', 'Security Error: You are only authorized to delete your own leave records.', 403);
    }

    await leaveRef.delete();

    // Re-generate slots for affected doctor date range to unblock free/reserved slots
    if (leaveData.doctorId && leaveData.fromAt) {
      const fromDate = leaveData.fromAt.split('T')[0];
      const toDate = (leaveData.toAt || leaveData.fromAt).split('T')[0];

      let docDoc = await db.collection('doctors').doc(leaveData.doctorId).get();
      const doctorData = docDoc.exists ? docDoc.data() : {};
      const schedule = doctorData.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
        ]
      };

      // Remaining active leaves
      const remainingLeavesSnap = await db.collection('leaves').where('doctorId', '==', leaveData.doctorId).get();
      const remainingLeaves = remainingLeavesSnap.docs.map((d) => d.data());

      const targetDates = [fromDate];
      if (toDate !== fromDate) targetDates.push(toDate);

      for (const dStr of targetDates) {
        const existingSnap = await db
          .collection('slots')
          .where('doctorId', '==', leaveData.doctorId)
          .where('date', '==', dStr)
          .get();

        const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

        const regenerated = generateSlotsForDoctorDate({
          doctorId: leaveData.doctorId,
          date: dStr,
          schedule,
          leaves: remainingLeaves,
          existingSlots
        });

        if (regenerated.length > 0) {
          const batch = db.batch();
          regenerated.forEach((s) => {
            batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
          });
          await batch.commit();
        }
      }
    }

    await writeAuditLog({
      actorUid: req.user.uid,
      actorRole: req.user.role,
      action: 'DELETE_DOCTOR_LEAVE',
      targetType: 'leave',
      targetId: id,
      requestId: req.requestId
    });

    res.status(200).json(formatSuccessResponse({
      message: `Leave '${id}' deleted successfully.`
    }));
  } catch (error) {
    next(error);
  }
};

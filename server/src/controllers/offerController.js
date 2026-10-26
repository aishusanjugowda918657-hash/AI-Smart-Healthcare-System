/**
 * Offers Controller (PRD F16)
 * Handles atomic offer acceptance, decline, and retrieval.
 * Uses Firestore transactions with strict read-before-write sequence.
 */
import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { verifyRecordAccess } from './medicalController.js';
import { getAppointmentDateCompact, formatAppointmentDisplayId } from '../services/appointmentIdService.js';

/**
 * POST /api/offers/:id/accept { optionIndex }
 * Atomic offer acceptance via Firestore transaction
 */
export const acceptOffer = async (req, res, next) => {
  try {
    const { id: offerId } = req.params;
    const { optionIndex = 0 } = req.body;
    const userId = req.user?.uid || req.user?.id || 'unknown-user';
    const db = assertDbConnected();
    const nowIso = clock.now().toISOString();

    const result = await db.runTransaction(async (transaction) => {
      // 1. READ offer document
      const offerRef = db.collection('offers').doc(offerId);
      const offerDoc = await transaction.get(offerRef);

      if (!offerDoc.exists) {
        throw { statusCode: 404, message: 'Offer not found.' };
      }

      const offer = offerDoc.data();

      if (req.user?.role === 'patient') {
        let isOwner = offer.userId === userId || (req.user?.patientHealthId && offer.patientHealthId === req.user?.patientHealthId);
        if (!isOwner && offer.patientHealthId) {
          const access = await verifyRecordAccess({ db, uid: userId, role: 'patient', patientHealthId: offer.patientHealthId });
          if (access.authorized) isOwner = true;
        }
        if (!isOwner) {
          throw { statusCode: 403, message: 'Forbidden: You cannot accept another patient\'s offer.' };
        }
      }

      if (offer.status !== 'open') {
        throw { statusCode: 409, message: `Offer is no longer open (current status: ${offer.status}).` };
      }

      if (new Date(offer.expiresAt) < clock.now()) {
        transaction.set(offerRef, { status: 'expired' }, { merge: true });
        throw { statusCode: 410, message: 'Offer has expired.' };
      }

      // -------------------------------------------------------------
      // CASE 1: Leave Reschedule Offer
      // -------------------------------------------------------------
      if (offer.kind === 'leave_reschedule') {
        const options = offer.options || [];
        const selectedOption = options[optionIndex] || options[0];

        if (!selectedOption) {
          throw { statusCode: 400, message: 'Invalid optionIndex.' };
        }

        if (selectedOption.type === 'join_waitlist') {
          // Join waitlist option (no slot read required)
          const wlRef = db.collection('waitlist').doc();
          transaction.set(wlRef, {
            healthId: offer.patientHealthId || userId,
            patientName: offer.patientName || 'Patient',
            userId: offer.userId || userId,
            departmentId: selectedOption.departmentId || 'dept-gen',
            dateFrom: selectedOption.dateFrom || offer.leaveDate || nowIso.split('T')[0],
            dateTo: selectedOption.dateTo || offer.leaveDate || nowIso.split('T')[0],
            clinicalLevel: 1,
            joinedAt: nowIso,
            status: 'waiting'
          });

          transaction.set(offerRef, {
            status: 'accepted',
            acceptedOptionIndex: optionIndex,
            acceptedAt: nowIso
          }, { merge: true });

          return { acceptedOption: selectedOption, joinedWaitlist: true };
        }

        const slotId = selectedOption.slotId;
        if (!slotId) throw { statusCode: 400, message: 'Slot ID missing in selected option.' };

        // READ target slot and existing appointment BEFORE any writes!
        const targetSlotRef = db.collection('slots').doc(slotId);
        const targetSlotDoc = await transaction.get(targetSlotRef);

        if (!targetSlotDoc.exists) {
          throw { statusCode: 409, message: 'Target slot no longer exists.' };
        }

        const slotData = targetSlotDoc.data();
        if (slotData.available === false && slotData.bookedBy && slotData.bookedBy !== userId) {
          throw { statusCode: 409, message: 'Target slot has already been booked by another patient.' };
        }

        const apptRef = db.collection('appointments').doc(offer.appointmentId);
        const apptDoc = await transaction.get(apptRef);

        // READ phase finished. NOW EXECUTE ALL WRITES:
        transaction.set(targetSlotRef, {
          available: false,
          status: 'booked',
          bookedBy: userId,
          heldUntil: null,
          heldByOfferId: null
        }, { merge: true });

        if (apptDoc.exists && apptDoc.data().slotId) {
          const oldSlotRef = db.collection('slots').doc(apptDoc.data().slotId);
          transaction.set(oldSlotRef, { available: true, status: 'free' }, { merge: true });
        }

        transaction.set(apptRef, {
          doctorId: selectedOption.doctorId,
          doctorName: selectedOption.doctorName || 'Doctor',
          date: selectedOption.date,
          timeSlot: selectedOption.timeSlot,
          slotId,
          status: 'booked',
          rescheduled: true,
          updatedAt: nowIso
        }, { merge: true });

        (offer.heldSlots || []).forEach(hId => {
          if (hId !== slotId) {
            transaction.set(db.collection('slots').doc(hId), { heldUntil: null, heldByOfferId: null }, { merge: true });
          }
        });

        transaction.set(offerRef, {
          status: 'accepted',
          acceptedOptionIndex: optionIndex,
          acceptedAt: nowIso
        }, { merge: true });

        return { acceptedOption: selectedOption, appointmentId: offer.appointmentId };
      }

      // -------------------------------------------------------------
      // CASE 2: Waitlist Offer
      // -------------------------------------------------------------
      if (offer.kind === 'waitlist') {
        const slotDetails = offer.slotDetails;
        if (!slotDetails || !slotDetails.slotId) {
          throw { statusCode: 400, message: 'Invalid waitlist offer slot details.' };
        }

        // READ slot doc and appointment display counter before writes
        const slotRef = db.collection('slots').doc(slotDetails.slotId);
        const apptDateStr = slotDetails.date || nowIso.split('T')[0];
        const dateCompact = getAppointmentDateCompact(apptDateStr);
        const apptDisplayCounterRef = db.collection('counters').doc(`apptDisplay_${dateCompact}`);

        const [slotDoc, apptDisplaySnap] = await Promise.all([
          transaction.get(slotRef),
          transaction.get(apptDisplayCounterRef)
        ]);

        if (!slotDoc.exists) {
          throw { statusCode: 409, message: 'Freed slot no longer exists.' };
        }

        const slotData = slotDoc.data();
        if (slotData.available === false && slotData.bookedBy && slotData.bookedBy !== userId) {
          throw { statusCode: 409, message: 'This slot was already accepted by another candidate.' };
        }

        const apptSeq = (apptDisplaySnap.exists ? apptDisplaySnap.data().value || 0 : 0) + 1;
        const displayId = formatAppointmentDisplayId(dateCompact, apptSeq);

        // READ phase finished. NOW EXECUTE ALL WRITES:
        transaction.set(slotRef, {
          available: false,
          status: 'booked',
          bookedBy: userId
        }, { merge: true });

        transaction.set(apptDisplayCounterRef, {
          value: apptSeq,
          dateCompact,
          updatedAt: new Date()
        }, { merge: true });

        const apptRef = db.collection('appointments').doc();
        const apptData = {
          id: apptRef.id,
          appointmentId: apptRef.id,
          displayId,
          userId,
          patientHealthId: offer.patientHealthId || userId,
          patientName: offer.patientName || 'Patient',
          doctorId: slotDetails.doctorId || 'doc-1',
          doctorName: slotDetails.doctorName || 'Doctor',
          date: apptDateStr,
          timeSlot: slotDetails.timeSlot || '10:00',
          slotId: slotDetails.slotId,
          status: 'booked',
          bookedFromWaitlist: true,
          disclaimerAccepted: true,
          createdAt: nowIso
        };
        transaction.set(apptRef, apptData);

        if (offer.waitlistId) {
          transaction.set(db.collection('waitlist').doc(offer.waitlistId), {
            status: 'booked',
            bookedAppointmentId: apptRef.id,
            bookedAt: nowIso
          }, { merge: true });
        }

        transaction.set(offerRef, {
          status: 'accepted',
          acceptedAt: nowIso
        }, { merge: true });

        return { appointment: apptData };
      }

      throw { statusCode: 400, message: 'Unsupported offer kind.' };
    });

    res.status(200).json({
      success: true,
      message: 'Offer accepted successfully.',
      result
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * POST /api/offers/:id/decline
 */
export const declineOffer = async (req, res, next) => {
  try {
    const { id: offerId } = req.params;
    const db = assertDbConnected();

    const offerRef = db.collection('offers').doc(offerId);
    const offerDoc = await offerRef.get();

    if (!offerDoc.exists) {
      return res.status(404).json({ success: false, message: 'Offer not found.' });
    }

    const offer = offerDoc.data();
    const userId = req.user?.uid || req.user?.id;
    const role = req.user?.role;
    const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
    if (!isStaff && role === 'patient') {
      let isOwner = offer.userId === userId || (req.user?.patientHealthId && offer.patientHealthId === req.user?.patientHealthId);
      if (!isOwner && offer.patientHealthId) {
        const access = await verifyRecordAccess({ db, uid: userId, role: 'patient', patientHealthId: offer.patientHealthId });
        if (access.authorized) isOwner = true;
      }
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Forbidden: You cannot decline another patient\'s offer.' });
      }
    }

    await offerRef.set({
      status: 'declined',
      declinedAt: clock.now().toISOString()
    }, { merge: true });

    if (offer.heldSlots && offer.heldSlots.length > 0) {
      const batch = db.batch();
      offer.heldSlots.forEach(sId => {
        batch.set(db.collection('slots').doc(sId), { heldUntil: null, heldByOfferId: null }, { merge: true });
      });
      await batch.commit();
    }

    res.status(200).json({
      success: true,
      message: 'Offer declined.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/offers/my-offers
 */
export const getUserOffers = async (req, res, next) => {
  try {
    const userId = req.user?.uid || req.user?.id;
    const db = assertDbConnected();

    const snap = await db.collection('offers')
      .where('status', '==', 'open')
      .get();

    const offers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => o.userId === userId || o.patientHealthId === req.user?.patientHealthId);

    res.status(200).json({
      success: true,
      offers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/offers/:id
 */
export const getOfferById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = assertDbConnected();

    const doc = await db.collection('offers').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Offer not found.' });
    }

    const offerData = doc.data();
    const userId = req.user?.uid || req.user?.id;
    const role = req.user?.role;
    const isStaff = ['doctor', 'admin', 'reception', 'nurse'].includes(role);
    if (!isStaff && role === 'patient') {
      let isOwner = offerData.userId === userId || (req.user?.patientHealthId && offerData.patientHealthId === req.user?.patientHealthId);
      if (!isOwner && offerData.patientHealthId) {
        const access = await verifyRecordAccess({ db, uid: userId, role: 'patient', patientHealthId: offerData.patientHealthId });
        if (access.authorized) isOwner = true;
      }
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Forbidden: You cannot access another patient\'s offer.' });
      }
    }

    res.status(200).json({
      success: true,
      offer: { id: doc.id, ...offerData }
    });
  } catch (error) {
    next(error);
  }
};

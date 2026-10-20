/**
 * Doctor Leave Auto-Rescheduling Job (PRD F16 & Section 10)
 * Processes doctor leaves, creates 3-option reschedule offers, holds slots,
 * handles 2-hour reminders, auto-books at deadlines, and tracks progress.
 */
import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { notify } from '../services/notify.js';

export async function leaveRescheduleJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const nowIso = now.toISOString();

    let processedLeaves = 0;
    let affectedAppointmentsCount = 0;
    let autoBookedCount = 0;

    // -------------------------------------------------------------
    // STEP 1: Process unprocessed doctor leaves
    // -------------------------------------------------------------
    const leavesSnap = await db.collection('leaves').get();
    const unprocessedLeaves = leavesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(l => l.processed === false);

    for (const leave of unprocessedLeaves) {
      const { doctorId, date: leaveDate, reason = 'Doctor on leave' } = leave;
      if (!doctorId || !leaveDate) continue;

      // Fetch doctor details
      let doctorName = 'Doctor';
      const docRef = await db.collection('users').doc(doctorId).get();
      if (docRef.exists) doctorName = docRef.data().fullName || docRef.data().name || doctorName;

      // Find affected active appointments
      const apptSnap = await db.collection('appointments')
        .where('doctorId', '==', doctorId)
        .where('date', '==', leaveDate)
        .get();

      const activeAppts = apptSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => ['booked', 'confirmed', 'scheduled', 'checked_in'].includes(a.status));

      // Order affected appointments: 1. Clinical level (desc), 2. Serious follow-up, 3. Booked time (asc)
      activeAppts.sort((a, b) => {
        const levelA = a.clinicalLevel || (a.urgencySuggested === 'urgent' ? 2 : 1);
        const levelB = b.clinicalLevel || (b.urgencySuggested === 'urgent' ? 2 : 1);
        if (levelB !== levelA) return levelB - levelA;

        const followA = a.isFollowUp ? 1 : 0;
        const followB = b.isFollowUp ? 1 : 0;
        if (followB !== followA) return followB - followA;

        return (a.timeSlot || '00:00').localeCompare(b.timeSlot || '00:00');
      });

      // Find alternative open slots for options
      const freeSlotsSnap = await db.collection('slots')
        .where('available', '==', true)
        .limit(50)
        .get();

      const freeSlots = freeSlotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      for (const appt of activeAppts) {
        affectedAppointmentsCount++;

        // Option 1: Same doctor next free slot after leaveDate
        const sameDocNextSlot = freeSlots.find(s => s.doctorId === doctorId && s.date > leaveDate);

        // Option 2: Another doctor in same department earlier
        const apptDeptId = appt.departmentId || 'dept-gen';
        const otherDocSlot = freeSlots.find(s => s.doctorId !== doctorId && (s.departmentId === apptDeptId || !s.departmentId));

        // Option 3: Join Waiting List
        const option3 = {
          type: 'join_waitlist',
          departmentId: apptDeptId,
          dateFrom: leaveDate,
          dateTo: new Date(new Date(leaveDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        };

        const options = [];
        const heldSlots = [];

        if (sameDocNextSlot) {
          options.push({
            type: 'same_doctor_next',
            doctorId: sameDocNextSlot.doctorId,
            doctorName,
            date: sameDocNextSlot.date,
            timeSlot: sameDocNextSlot.timeSlot,
            slotId: sameDocNextSlot.id
          });
          heldSlots.push(sameDocNextSlot.id);
        }

        if (otherDocSlot) {
          options.push({
            type: 'other_doctor_earlier',
            doctorId: otherDocSlot.doctorId,
            doctorName: otherDocSlot.doctorName || 'Alternative Doctor',
            date: otherDocSlot.date,
            timeSlot: otherDocSlot.timeSlot,
            slotId: otherDocSlot.id,
            expectedWaitMin: 15
          });
          heldSlots.push(otherDocSlot.id);
        }

        options.push(option3);

        const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
        const apptTimestamp = new Date(`${leaveDate}T${appt.timeSlot || '09:00'}:00`).getTime();
        const minDeadline = now.getTime() + 15 * 60 * 1000;
        const targetDeadline = Math.min(
          now.getTime() + 6 * 60 * 60 * 1000,
          apptTimestamp - 2 * 60 * 60 * 1000
        );
        const autoBookDeadline = new Date(Math.max(minDeadline, targetDeadline)).toISOString();

        // Create offers document
        const offerRef = db.collection('offers').doc();
        await offerRef.set({
          kind: 'leave_reschedule',
          leaveId: leave.id,
          appointmentId: appt.id,
          patientHealthId: appt.patientHealthId,
          patientName: appt.patientName || 'Patient',
          userId: appt.userId || appt.patientUid || appt.ownerUid || appt.patientHealthId,
          doctorId,
          doctorName,
          leaveDate,
          leaveReason: reason,
          options,
          heldSlots,
          expiresAt,
          remindedAt: null,
          autoBookDeadline,
          autoBooked: false,
          status: 'open',
          createdAt: nowIso
        });

        // Hold slots for 2 hours
        const batch = db.batch();
        for (const slotId of heldSlots) {
          batch.set(db.collection('slots').doc(slotId), {
            heldUntil: expiresAt,
            heldByOfferId: offerRef.id
          }, { merge: true });
        }
        await batch.commit();

        // Send patient notification
        const userId = appt.userId || appt.patientUid || appt.ownerUid || appt.patientHealthId;
        if (userId) {
          await notify({
            uids: [userId],
            title: 'Appointment Reschedule Notice',
            body: `Dr. ${doctorName} is on leave on ${leaveDate}. Please choose a reschedule option in your app.`,
            privacyBody: 'An update is available regarding your upcoming appointment.',
            type: 'leave_reschedule',
            data: { offerId: offerRef.id, appointmentId: appt.id }
          });
        }
      }

      // Mark leave processed
      await db.collection('leaves').doc(leave.id).set({
        processed: true,
        processedAt: nowIso,
        affectedCount: activeAppts.length
      }, { merge: true });

      processedLeaves++;
    }

    // -------------------------------------------------------------
    // STEP 2: Reminders (2 hours) & Auto-Booking at Deadline
    // -------------------------------------------------------------
    const openOffersSnap = await db.collection('offers')
      .where('kind', '==', 'leave_reschedule')
      .where('status', '==', 'open')
      .get();

    for (const offerDoc of openOffersSnap.docs) {
      const offer = { id: offerDoc.id, ...offerDoc.data() };
      const deadlineTime = new Date(offer.autoBookDeadline).getTime();

      // Check 2-hour reminder
      if (!offer.remindedAt && (now.getTime() - new Date(offer.createdAt).getTime() >= 2 * 60 * 60 * 1000)) {
        await offerDoc.ref.set({ remindedAt: nowIso }, { merge: true });
        if (offer.userId) {
          await notify({
            uids: [offer.userId],
            title: 'Reminder: Action Required for Appointment Reschedule',
            body: `Please select an option for your appointment affected by Dr. ${offer.doctorName}'s leave.`,
            type: 'leave_reschedule_reminder'
          });
        }
      }

      // Check auto-book deadline
      if (now.getTime() >= deadlineTime && !offer.autoBooked) {
        const bestOption = (offer.options || []).find(o => o.type === 'same_doctor_next' || o.type === 'other_doctor_earlier');

        if (bestOption && bestOption.slotId) {
          await db.runTransaction(async (transaction) => {
            const slotRef = db.collection('slots').doc(bestOption.slotId);
            const slotDoc = await transaction.get(slotRef);

            const apptRef = db.collection('appointments').doc(offer.appointmentId);
            const apptDoc = await transaction.get(apptRef);

            transaction.set(slotRef, { available: false, bookedBy: offer.userId }, { merge: true });
            if (apptDoc.exists && apptDoc.data().slotId) {
              const oldSlotRef = db.collection('slots').doc(apptDoc.data().slotId);
              transaction.set(oldSlotRef, { available: true }, { merge: true });
            }

            transaction.set(apptRef, {
              doctorId: bestOption.doctorId,
              doctorName: bestOption.doctorName,
              date: bestOption.date,
              timeSlot: bestOption.timeSlot,
              slotId: bestOption.slotId,
              status: 'booked',
              autoRescheduled: true,
              updatedAt: nowIso
            }, { merge: true });

            transaction.set(offerDoc.ref, {
              status: 'accepted',
              acceptedOptionIndex: 0,
              autoBooked: true,
              acceptedAt: nowIso
            }, { merge: true });
          });

          autoBookedCount++;

          if (offer.userId) {
            await notify({
              uids: [offer.userId],
              title: 'Appointment Auto-Rescheduled',
              body: `Your appointment has been automatically rescheduled to ${bestOption.date} at ${bestOption.timeSlot} with Dr. ${bestOption.doctorName}.`,
              type: 'leave_reschedule_autobook'
            });
          }
        } else {
          await offerDoc.ref.set({
            needsCall: true,
            status: 'needs_staff_call'
          }, { merge: true });
        }
      }
    }

    return {
      success: true,
      processedLeaves,
      affectedAppointmentsCount,
      autoBookedCount
    };

  } catch (error) {
    console.error('❌ leaveRescheduleJob error:', error.message);
    return { success: false, error: error.message };
  }
}

export async function getLeaveRescheduleProgress(leaveId) {
  const db = assertDbConnected();
  const leaveDoc = await db.collection('leaves').doc(leaveId).get();
  if (!leaveDoc.exists) {
    return { affected: 0, accepted: 0, pending: 0, needsCall: 0 };
  }

  const offersSnap = await db.collection('offers')
    .where('leaveId', '==', leaveId)
    .get();

  let affected = offersSnap.docs.length;
  let accepted = 0;
  let pending = 0;
  let needsCall = 0;

  offersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.status === 'accepted') accepted++;
    else if (data.status === 'open') pending++;
    if (data.needsCall || data.status === 'needs_staff_call') needsCall++;
  });

  return {
    leaveId,
    affected,
    accepted,
    pending,
    needsCall
  };
}

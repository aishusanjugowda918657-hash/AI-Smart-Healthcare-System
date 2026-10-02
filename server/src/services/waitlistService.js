/**
 * Waiting List & Auto-Fill Service (PRD F16 & Section 10)
 * Manages waitlist registration, candidate ordering by clinical level & join time,
 * slot offer creation, expiry chains, and atomic accepts.
 */
import { assertDbConnected } from '../config/firebase.js';
import { clock } from '../utils/clock.js';
import { notify } from '../services/notify.js';

/**
 * Register interest on waiting list
 */
export async function joinWaitlist({ healthId, patientName, userId, doctorId, departmentId, dateFrom, dateTo, timeWindow, clinicalLevel = 1 }) {
  const db = assertDbConnected();
  const nowIso = clock.now().toISOString();

  const docRef = db.collection('waitlist').doc();
  const entry = {
    id: docRef.id,
    healthId,
    patientName: patientName || 'Patient',
    userId: userId || healthId,
    doctorId: doctorId || null,
    departmentId: departmentId || 'dept-gen',
    dateFrom,
    dateTo,
    timeWindow: timeWindow || 'any',
    clinicalLevel: Number(clinicalLevel) || 1,
    joinedAt: nowIso,
    status: 'waiting'
  };

  await docRef.set(entry);
  return entry;
}

/**
 * Leave waiting list
 */
export async function leaveWaitlist(waitlistId, userId) {
  const db = assertDbConnected();
  const docRef = db.collection('waitlist').doc(waitlistId);
  const doc = await docRef.get();

  if (!doc.exists) return { success: false, message: 'Waitlist entry not found.' };

  await docRef.set({ status: 'cancelled', cancelledAt: clock.now().toISOString() }, { merge: true });
  return { success: true, message: 'Removed from waitlist.' };
}

/**
 * Called when a slot is freed (cancellation after 10m undo window, no-show, leave release)
 * Finds highest priority candidate and creates a 10-minute open offer.
 */
export async function offerFreedSlot(slot) {
  if (!slot || !slot.id || !slot.date) return { offered: false, reason: 'Invalid slot' };

  const db = assertDbConnected();
  const now = clock.now();
  const nowIso = now.toISOString();

  // Reachability check: slot start must be at least 20 minutes in the future
  const [hours, mins] = (slot.timeSlot || '10:00').split(':').map(Number);
  const slotDateParts = slot.date.split('-').map(Number);
  const slotStartMs = new Date(slotDateParts[0], slotDateParts[1] - 1, slotDateParts[2], hours, mins).getTime();

  if (slotStartMs - now.getTime() < 20 * 60 * 1000) {
    return { offered: false, reason: 'Slot start time is too soon for waitlist offer.' };
  }

  // Query waiting candidates
  const waitlistSnap = await db.collection('waitlist')
    .where('status', '==', 'waiting')
    .get();

  if (waitlistSnap.empty) return { offered: false, reason: 'No candidates on waitlist.' };

  const slotDept = slot.departmentId || 'dept-gen';

  const candidates = waitlistSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => {
      // Date range check
      const dateMatch = c.dateFrom <= slot.date && slot.date <= c.dateTo;
      // Doctor/Dept match
      const docMatch = !c.doctorId || c.doctorId === slot.doctorId;
      const deptMatch = !c.departmentId || c.departmentId === slotDept || !slot.departmentId;
      return dateMatch && docMatch && deptMatch;
    });

  if (candidates.length === 0) return { offered: false, reason: 'No matching candidate for date and department.' };

  // Order candidates: 1. Clinical level (desc 3->2->1), 2. Joined time (asc)
  candidates.sort((a, b) => {
    const levelA = Number(a.clinicalLevel) || 1;
    const levelB = Number(b.clinicalLevel) || 1;
    if (levelB !== levelA) return levelB - levelA;
    return (a.joinedAt || '').localeCompare(b.joinedAt || '');
  });

  // Check which candidate doesn't already have an open offer (one open offer per patient)
  for (const candidate of candidates) {
    const activeOffersSnap = await db.collection('offers')
      .where('patientHealthId', '==', candidate.healthId)
      .where('status', '==', 'open')
      .get();

    if (!activeOffersSnap.empty) continue; // Patient already has an open offer

    const msToExpiry = Math.min(10 * 60 * 1000, slotStartMs - now.getTime() - 20 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + Math.max(msToExpiry, 2 * 60 * 1000)).toISOString();

    // Create waitlist offer
    const offerRef = db.collection('offers').doc();
    const offerData = {
      id: offerRef.id,
      kind: 'waitlist',
      waitlistId: candidate.id,
      patientHealthId: candidate.healthId,
      patientName: candidate.patientName || 'Patient',
      userId: candidate.userId || candidate.healthId,
      slotIds: [slot.id],
      slotDetails: {
        slotId: slot.id,
        doctorId: slot.doctorId,
        doctorName: slot.doctorName || 'Doctor',
        departmentId: slotDept,
        date: slot.date,
        timeSlot: slot.timeSlot
      },
      expiresAt,
      status: 'open',
      createdAt: nowIso
    };

    await offerRef.set(offerData);

    // Update waitlist candidate status
    await db.collection('waitlist').doc(candidate.id).set({
      status: 'offered',
      activeOfferId: offerRef.id,
      offeredAt: nowIso
    }, { merge: true });

    // Send push notification
    if (candidate.userId) {
      await notify({
        uids: [candidate.userId],
        title: 'Waitlist Slot Available!',
        body: `${candidate.patientName}: A slot opened on ${slot.date} at ${slot.timeSlot} with Dr. ${slot.doctorName || 'Doctor'}. Accept within 10 minutes?`,
        privacyBody: 'A waitlist slot has opened for your appointment.',
        type: 'waitlist_offer',
        data: { offerId: offerRef.id }
      });
    }

    return { offered: true, candidate, offer: offerData };
  }

  return { offered: false, reason: 'All matching candidates already have open offers.' };
}

/**
 * Expire Waitlist Offers & Move to Next Candidate (PRD F16)
 */
export async function expireWaitlistOffersJob() {
  const db = assertDbConnected();
  const now = clock.now();
  const nowIso = now.toISOString();

  const expiredOffersSnap = await db.collection('offers')
    .where('kind', '==', 'waitlist')
    .where('status', '==', 'open')
    .get();

  let expiredCount = 0;

  for (const doc of expiredOffersSnap.docs) {
    const offer = { id: doc.id, ...doc.data() };
    if (new Date(offer.expiresAt) <= now) {
      // Mark offer expired
      await doc.ref.set({ status: 'expired', expiredAt: nowIso }, { merge: true });
      expiredCount++;

      // Return waitlist entry to waiting or expired
      if (offer.waitlistId) {
        await db.collection('waitlist').doc(offer.waitlistId).set({
          status: 'waiting',
          activeOfferId: null
        }, { merge: true });
      }

      // Immediately pass slot to next candidate in line
      if (offer.slotDetails) {
        await offerFreedSlot({
          id: offer.slotDetails.slotId,
          doctorId: offer.slotDetails.doctorId,
          doctorName: offer.slotDetails.doctorName,
          date: offer.slotDetails.date,
          timeSlot: offer.slotDetails.timeSlot
        });
      }
    }
  }

  return { success: true, expiredCount };
}

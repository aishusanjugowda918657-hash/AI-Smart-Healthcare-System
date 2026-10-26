import { assertDbConnected } from '../config/firebase.js';
import { formatScaiPatientHealthId, isValidHealthId } from '../domain/healthId.js';

/**
 * Atomically generates a guaranteed unique Patient Health ID using Firestore transactions.
 * Format: SCAI-YYYY-NNNNNN-P (e.g. SCAI-2026-000001-P)
 * - YYYY: registration year
 * - NNNNNN: unique 6-digit zero-padded sequence
 * - P: identifies a patient
 * Guaranteed unique across concurrent registrations via transactional sequence allocation.
 */
export const generateAtomicPatientHealthId = async (year = new Date().getFullYear()) => {
  const db = assertDbConnected();
  const counterRef = db.collection('counters').doc(`healthId_${year}`);

  const candidateId = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    let nextVal = 1;
    if (counterSnap.exists) {
      const data = counterSnap.data();
      nextVal = (data.currentValue || data.lastSequence || 0) + 1;
    }

    let generated = formatScaiPatientHealthId(year, nextVal);

    // Verify against existing patient record to prevent collision
    let patientSnap = await tx.get(db.collection('patients').doc(generated));
    while (patientSnap.exists) {
      nextVal += 1;
      generated = formatScaiPatientHealthId(year, nextVal);
      patientSnap = await tx.get(db.collection('patients').doc(generated));
    }

    tx.set(counterRef, {
      currentValue: nextVal,
      lastSequence: nextVal,
      year,
      updatedAt: new Date()
    }, { merge: true });

    return generated;
  });

  return candidateId;
};

export const isValidHealthIdFormat = (healthId) => {
  return isValidHealthId(healthId);
};

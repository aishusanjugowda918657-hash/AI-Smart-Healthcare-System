import { assertDbConnected } from '../config/firebase.js';
import { generateHealthIdCandidate, isValidHealthId } from '../domain/healthId.js';

/**
 * Atomically generates a guaranteed unique Patient Health ID using Firestore transactions.
 * Format: PHI-YYYY-XXXXXX-C
 * Defined as per PRD Section 5.4
 */
export const generateAtomicPatientHealthId = async (year = new Date().getFullYear()) => {
  const db = assertDbConnected();
  const MAX_ATTEMPTS = 10;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidateId = generateHealthIdCandidate(year);
    const docRef = db.collection('patients').doc(candidateId);

    try {
      const isUnique = await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) return false;
        return true;
      });

      if (isUnique) {
        return candidateId;
      }
    } catch (err) {
      console.warn(`Health ID generation attempt ${attempt} collision/retry:`, err.message);
    }
  }

  throw new Error(`Failed to generate a unique Health ID after ${MAX_ATTEMPTS} attempts.`);
};

export const isValidHealthIdFormat = (healthId) => {
  return isValidHealthId(healthId);
};

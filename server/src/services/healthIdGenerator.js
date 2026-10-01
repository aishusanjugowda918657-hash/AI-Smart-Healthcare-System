import { assertDbConnected } from '../config/firebase.js';

/**
 * Atomically generates a guaranteed unique Patient Health ID using a Firestore transaction.
 * Format: HID-YYYY-XXXXX (e.g. HID-2026-00001)
 *
 * Uses a retry loop (max 3 attempts) on transaction failure.
 * NEVER falls back to a random ID — throws on persistent failure to prevent
 * duplicate or malformed Health IDs from entering the database.
 */
export const generateAtomicPatientHealthId = async () => {
  const db = assertDbConnected();
  const year = new Date().getFullYear();
  const counterRef = db.collection('counters').doc('patientHealthId');

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let seqNumber = 1;

    try {
      await db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        if (!counterDoc.exists) {
          transaction.set(counterRef, { currentValue: 1 });
          seqNumber = 1;
        } else {
          const current = counterDoc.data().currentValue || 0;
          seqNumber = current + 1;
          transaction.update(counterRef, { currentValue: seqNumber });
        }
      });

      // Transaction succeeded — build and return the Health ID
      const paddedSeq = String(seqNumber).padStart(5, '0');
      return `HID-${year}-${paddedSeq}`;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Health ID counter transaction failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message);

      if (attempt < MAX_RETRIES) {
        // Short exponential back-off before retry (50ms, 100ms)
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
      }
    }
  }

  // All retries exhausted — throw rather than generate a random/unsafe ID
  const error = new Error(
    `Health ID Generator Error: Failed to atomically generate a unique Patient Health ID after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`
  );
  error.statusCode = 500;
  throw error;
};

/**
 * Validates a Health ID string against the expected format.
 * Format: HID-YYYY-XXXXX (4-digit year, 5-digit zero-padded sequence)
 * @param {string} healthId
 * @returns {boolean}
 */
export const isValidHealthIdFormat = (healthId) => {
  return /^HID-\d{4}-\d{5}$/.test(healthId);
};

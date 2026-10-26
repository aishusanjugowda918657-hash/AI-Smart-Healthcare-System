/**
 * Health ID Generation and Checksum Validation Domain Module
 * Format: PHI-YYYY-XXXXXX-C
 * Defined as per PRD Section 5.4
 */

export const HEALTH_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // Length 31 (excludes 0, O, 1, I, L)
const ALPHABET_LENGTH = HEALTH_ID_ALPHABET.length;

/**
 * Computes mod-31 checksum character for a given payload string
 */
export const computeMod31Checksum = (payload) => {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload[i].toUpperCase();
    const idx = HEALTH_ID_ALPHABET.indexOf(char);
    if (idx !== -1) {
      sum += idx;
    } else {
      sum += char.charCodeAt(0);
    }
  }
  const checkIdx = sum % ALPHABET_LENGTH;
  return HEALTH_ID_ALPHABET[checkIdx];
};

/**
 * Generates candidate Health ID for a given year (defaults to current year)
 */
export const generateHealthIdCandidate = (year = new Date().getFullYear()) => {
  let randomPayload = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * ALPHABET_LENGTH);
    randomPayload += HEALTH_ID_ALPHABET[randomIndex];
  }
  const rawPayload = `${year}${randomPayload}`;
  const checksumChar = computeMod31Checksum(rawPayload);
  return `PHI-${year}-${randomPayload}-${checksumChar}`;
};

/**
 * Formats a Patient Health ID according to the SmartCare AI specification.
 * Format: SCAI-YYYY-NNNNNN-P (e.g., SCAI-2026-000001-P)
 * - YYYY: registration year
 * - NNNNNN: 6-digit zero-padded sequence
 * - P: identifies a patient
 */
export const formatScaiPatientHealthId = (year = new Date().getFullYear(), sequence = 1) => {
  const paddedSeq = String(sequence).padStart(6, '0');
  return `SCAI-${year}-${paddedSeq}-P`;
};

/**
 * Validates Health ID format:
 * - SmartCare AI format: SCAI-YYYY-NNNNNN-P
 * - Legacy format: PHI-YYYY-XXXXXX-C (with mod-31 checksum)
 */
export const isValidHealthId = (healthId) => {
  if (!healthId || typeof healthId !== 'string') return false;
  const trimmed = healthId.trim();

  // SmartCare AI format: SCAI-YYYY-NNNNNN-P
  const scaiPattern = /^SCAI-\d{4}-\d{6}-P$/i;
  if (scaiPattern.test(trimmed)) {
    return true;
  }

  // Legacy format: PHI-YYYY-XXXXXX-C
  const legacyPattern = new RegExp(`^PHI-\\d{4}-[${HEALTH_ID_ALPHABET}]{6}-[${HEALTH_ID_ALPHABET}]$`);
  if (!legacyPattern.test(trimmed)) return false;

  const parts = trimmed.split('-');
  const year = parts[1];
  const randomPayload = parts[2];
  const checksumChar = parts[3];

  const expectedChecksum = computeMod31Checksum(`${year}${randomPayload}`);
  return checksumChar === expectedChecksum;
};

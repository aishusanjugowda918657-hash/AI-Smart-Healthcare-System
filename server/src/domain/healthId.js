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
 * Validates Health ID format and mod-31 checksum
 */
export const isValidHealthId = (healthId) => {
  if (!healthId || typeof healthId !== 'string') return false;
  
  const pattern = new RegExp(`^PHI-\\d{4}-[${HEALTH_ID_ALPHABET}]{6}-[${HEALTH_ID_ALPHABET}]$`);
  if (!pattern.test(healthId)) return false;

  const parts = healthId.split('-');
  const year = parts[1];
  const randomPayload = parts[2];
  const checksumChar = parts[3];

  const expectedChecksum = computeMod31Checksum(`${year}${randomPayload}`);
  return checksumChar === expectedChecksum;
};

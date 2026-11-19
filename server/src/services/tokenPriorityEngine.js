/**
 * Rule-Based Token Priority Engine.
 * Canonical priority mappings:
 *   Level 3 = EMERGENCY (Score: 300, requires staff verification)
 *   Level 2 = HIGH (Score: 200, backward-compatible with URGENT / SENIOR)
 *   Level 1 = STANDARD (Score: 100, backward-compatible with ROUTINE)
 */
export const PRIORITY_SCORES = {
  EMERGENCY: 300,
  HIGH: 200,
  URGENT: 200,
  SENIOR: 200,
  STANDARD: 100,
  ROUTINE: 100
};

/**
 * Normalizes any category string or level number to canonical category: 'STANDARD' | 'HIGH' | 'EMERGENCY'.
 */
export const normalizePriorityCategory = (categoryOrLevel) => {
  if (categoryOrLevel === null || categoryOrLevel === undefined) {
    return 'STANDARD';
  }
  if (typeof categoryOrLevel === 'number') {
    if (categoryOrLevel >= 3) return 'EMERGENCY';
    if (categoryOrLevel === 2) return 'HIGH';
    return 'STANDARD';
  }
  const str = String(categoryOrLevel).trim().toUpperCase();
  if (str === '3' || str === 'EMERGENCY') return 'EMERGENCY';
  if (str === '2' || str === 'HIGH' || str === 'URGENT' || str === 'SENIOR') return 'HIGH';
  return 'STANDARD';
};

/**
 * Maps priority category or numeric level to canonical integer clinical level (1, 2, 3).
 */
export const priorityCategoryToLevel = (categoryOrLevel) => {
  if (typeof categoryOrLevel === 'number') {
    if (categoryOrLevel >= 3) return 3;
    if (categoryOrLevel === 2) return 2;
    return 1;
  }
  const str = String(categoryOrLevel || '').trim().toUpperCase();
  if (str === '3' || str === 'EMERGENCY') return 3;
  if (str === '2' || str === 'HIGH' || str === 'URGENT' || str === 'SENIOR') return 2;
  return 1;
};

/**
 * Calculates numeric priority score for queue ordering.
 * Enforces staff verification constraint for emergency status.
 */
export const calculatePriorityScore = (category = 'STANDARD', staffVerified = false) => {
  const norm = normalizePriorityCategory(category);

  if (norm === 'EMERGENCY') {
    // Only grant emergency score 300 if verified by staff; otherwise fallback to standard
    return staffVerified ? PRIORITY_SCORES.EMERGENCY : PRIORITY_SCORES.STANDARD;
  }

  if (norm === 'HIGH') {
    return PRIORITY_SCORES.HIGH; // 200
  }

  return PRIORITY_SCORES.STANDARD; // 100
};

/**
 * Sorts queue tokens deterministically:
 * 1. Primary: Emergency always comes first (FIFO among emergencies)
 * 2. Secondary: Priority and Fairness-protected Normal preserve FIFO sequence
 * 3. Priority preempts un-protected Normal
 */
export const sortQueueTokens = (tokens = []) => {
  return [...tokens].sort((a, b) => {
    const isEmergA = a.priorityScore >= 300 || normalizePriorityCategory(a.category || a.priorityCategory) === 'EMERGENCY';
    const isEmergB = b.priorityScore >= 300 || normalizePriorityCategory(b.category || b.priorityCategory) === 'EMERGENCY';

    if (isEmergA && !isEmergB) return -1;
    if (!isEmergA && isEmergB) return 1;

    const extractNum = (val) => {
      if (typeof val === 'number') return val;
      const match = String(val || '').match(/\d+/);
      return match ? parseInt(match[0], 10) : 999;
    };
    const seqA = a.sequenceNumber !== undefined ? a.sequenceNumber : extractNum(a.tokenNumber || a.tokenLabel || a.id);
    const seqB = b.sequenceNumber !== undefined ? b.sequenceNumber : extractNum(b.tokenNumber || b.tokenLabel || b.id);

    if (isEmergA && isEmergB) return seqA - seqB;

    const isPrioA = a.priorityScore === 200 || normalizePriorityCategory(a.category || a.priorityCategory) === 'HIGH';
    const isPrioB = b.priorityScore === 200 || normalizePriorityCategory(b.category || b.priorityCategory) === 'HIGH';

    if (isPrioA && isPrioB) return seqA - seqB;
    if (!isPrioA && !isPrioB) return seqA - seqB;

    const isProtA = a.fairnessProtected === true;
    const isProtB = b.fairnessProtected === true;

    if (isPrioA && isProtB) return seqA - seqB;
    if (isProtA && isPrioB) return seqA - seqB;

    return isPrioA ? -1 : 1;
  });
};

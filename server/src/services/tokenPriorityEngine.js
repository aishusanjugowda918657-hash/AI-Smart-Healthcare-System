/**
 * Rule-Based Token Priority Engine.
 * Configured priority scores: EMERGENCY=300, SENIOR=200, STANDARD=100.
 */
export const PRIORITY_SCORES = {
  EMERGENCY: 300,
  SENIOR: 200,
  STANDARD: 100
};

/**
 * Calculates numeric priority score for queue ordering.
 * Enforces staff verification constraint for emergency status.
 */
export const calculatePriorityScore = (category = 'STANDARD', staffVerified = false) => {
  const cat = String(category).toUpperCase();

  if (cat === 'EMERGENCY') {
    // Only grant emergency score 300 if verified by staff; otherwise fallback to standard
    return staffVerified ? PRIORITY_SCORES.EMERGENCY : PRIORITY_SCORES.STANDARD;
  }

  if (cat === 'SENIOR') {
    return PRIORITY_SCORES.SENIOR;
  }

  return PRIORITY_SCORES.STANDARD;
};

/**
 * Sorts queue tokens deterministically:
 * 1. Primary: priorityScore (descending)
 * 2. Secondary: sequenceNumber (ascending)
 */
export const sortQueueTokens = (tokens = []) => {
  return [...tokens].sort((a, b) => {
    const scoreA = typeof a.priorityScore === 'number' ? a.priorityScore : 100;
    const scoreB = typeof b.priorityScore === 'number' ? b.priorityScore : 100;
    if (scoreB !== scoreA) {
      return scoreB - scoreA; // Higher score first
    }
    const extractNum = (val) => {
      if (typeof val === 'number') return val;
      const match = String(val || '').match(/\d+/);
      return match ? parseInt(match[0], 10) : 999;
    };
    const seqA = a.sequenceNumber !== undefined ? a.sequenceNumber : extractNum(a.tokenNumber || a.tokenLabel || a.id);
    const seqB = b.sequenceNumber !== undefined ? b.sequenceNumber : extractNum(b.tokenNumber || b.tokenLabel || b.id);
    return seqA - seqB; // Earlier sequence first
  });
};

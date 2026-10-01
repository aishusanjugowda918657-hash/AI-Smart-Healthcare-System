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
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore; // Higher score first
    }
    return a.sequenceNumber - b.sequenceNumber; // Earlier sequence first
  });
};

/**
 * Pure Business Domain Logic for Waiting Time Engine (PRD Section 5.2 & F7)
 */

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function roundTo5(num) {
  if (num <= 0) return 0;
  return Math.max(5, Math.round(num / 5) * 5);
}

/**
 * Expected duration lookup chain (PRD Section 5.2)
 * 1. consultationStats for doctor + department + visitType + complexity (if count >= 3)
 * 2. department.defaultDurationsMin
 * 3. Fallback defaults
 */
export function getExpectedDuration({ consultationStats, department, visitType = 'new', complexity = 'moderate', extraProcedureMin = 0 }) {
  let baseMin = 15;

  if (consultationStats && consultationStats.count >= 3 && consultationStats.avgMin) {
    baseMin = Math.round(consultationStats.avgMin);
  } else if (department && department.defaultDurationsMin) {
    const vType = department.defaultDurationsMin[visitType];
    if (vType) {
      if (typeof vType === 'number') {
        baseMin = vType;
      } else if (typeof vType === 'object') {
        baseMin = vType[complexity] || vType['moderate'] || vType['simple'] || 15;
      }
    }
  } else {
    // Standard defaults
    if (visitType === 'followup') baseMin = 10;
    else if (visitType === 'report_review') baseMin = 5;
    else if (visitType === 'procedure') baseMin = 20;
    else if (visitType === 'emergency') baseMin = 20;
    else baseMin = 15;
  }

  return baseMin + (extraProcedureMin || 0);
}

/**
 * Time factor calculation for today per doctor (PRD Section 5.2)
 * timeFactor = completed.length >= 3 ? clamp(sumActual / sumExpected, 0.7, 1.6) : 1.0
 */
export function calculateTimeFactor(completedConsultations = []) {
  if (!Array.isArray(completedConsultations) || completedConsultations.length < 3) {
    return 1.0;
  }

  const sumActual = completedConsultations.reduce((acc, c) => acc + (c.actualDurationMinutes || c.durationMin || 15), 0);
  const sumExpected = completedConsultations.reduce((acc, c) => acc + (c.expectedDurationMin || 15), 0);

  if (sumExpected === 0) return 1.0;

  const rawFactor = sumActual / sumExpected;
  return Number(clamp(rawFactor, 0.7, 1.6).toFixed(2));
}

/**
 * Remaining time of current ongoing consultation (PRD Section 5.2)
 * Auto-extends in 5-minute steps if elapsed > expected (never shows 0 while running)
 */
export function calculateRemainingCurrentTime(currentConsultation, now) {
  if (!currentConsultation || !currentConsultation.consultStartAt) {
    return 0;
  }

  const startTime = typeof currentConsultation.consultStartAt === 'string'
    ? new Date(currentConsultation.consultStartAt).getTime()
    : (currentConsultation.consultStartAt?.toMillis ? currentConsultation.consultStartAt.toMillis() : new Date(currentConsultation.consultStartAt).getTime());

  const nowTime = typeof now === 'string'
    ? new Date(now).getTime()
    : (now?.toMillis ? now.toMillis() : new Date(now).getTime());

  const elapsedMin = Math.max(0, Math.floor((nowTime - startTime) / (60 * 1000)));
  const expectedMin = currentConsultation.expectedDurationMin || 15;

  if (elapsedMin < expectedMin) {
    return expectedMin - elapsedMin;
  }

  // Auto-extend logic in 5-minute steps
  const overMin = elapsedMin - expectedMin;
  const extendSteps = Math.floor(overMin / 5) + 1;
  const newTarget = expectedMin + extendSteps * 5;
  return Math.max(1, newTarget - elapsedMin);
}

/**
 * Calculate coefficient of variation v = clamp(stdMin / avgMin, 0.1, 0.4)
 */
export function calculateCoefficientOfVariation(stats) {
  if (stats && stats.stdMin && stats.avgMin && stats.avgMin > 0) {
    return clamp(stats.stdMin / stats.avgMin, 0.1, 0.4);
  }
  return 0.2; // Default 20% variance
}

/**
 * Calculate wait for patient P (PRD Section 5.2)
 */
export function calculateWaitForPatient({
  aheadCandidates = [],
  notYetHereCandidates = [],
  remainingCurrentMin = 0,
  timeFactor = 1.0,
  breakRemainingMin = 0,
  lateStartDelayMin = 0,
  stats = null,
  now
}) {
  const sumAheadExpected = aheadCandidates.reduce((acc, c) => acc + (c.expectedDurationMin || 15), 0);
  const sumNotYetHereExpected = notYetHereCandidates.reduce((acc, c) => acc + (c.expectedDurationMin || 15), 0);

  const baseWait = remainingCurrentMin + sumAheadExpected + sumNotYetHereExpected;
  const waitMinutes = (baseWait * timeFactor) + breakRemainingMin + lateStartDelayMin;

  const v = calculateCoefficientOfVariation(stats);
  const rawLow = waitMinutes * (1 - v);
  const rawHigh = waitMinutes * (1 + v);

  let low = roundTo5(rawLow);
  let high = roundTo5(rawHigh);

  if (high <= low) {
    high = low + 5;
  }

  const nowMs = typeof now === 'string'
    ? new Date(now).getTime()
    : (now?.toMillis ? now.toMillis() : new Date(now).getTime());

  const predictedCallAt = new Date(nowMs + Math.round(waitMinutes) * 60 * 1000).toISOString();

  return {
    waitMinutes: Math.round(waitMinutes),
    waitMinLow: low,
    waitMinHigh: high,
    predictedCallAt
  };
}

/**
 * Leave Home Now calculation (PRD Section 5.2)
 */
export function calculateLeaveAt({ predictedCallAt, travelMinutes = 0, checkinBufferMin = 10, safetyBufferMin = 5 }) {
  if (!predictedCallAt) return null;

  const callTimeMs = new Date(predictedCallAt).getTime();
  const totalOffsetMin = (checkinBufferMin || 10) + (travelMinutes || 0) + (safetyBufferMin || 5);
  const leaveTimeMs = callTimeMs - totalOffsetMin * 60 * 1000;

  return new Date(leaveTimeMs).toISOString();
}

/**
 * Reason text selection logic (PRD Section 5.2)
 */
export function selectReasonText(flags = {}) {
  if (flags.hasEmergencyAdded) return 'An emergency case was prioritized ahead of you.';
  if (flags.hasDoctorBreak) return 'Doctor is currently taking a scheduled break.';
  if (flags.hasLateStart) return 'Clinic started slightly later than scheduled today.';
  if (flags.consultationsRunningLong) return 'Consultations before you are taking slightly longer today.';
  if (flags.consultationsRunningShort) return 'Queue is moving faster than estimated today.';
  if (flags.hasNoShowRemoved) return 'An earlier appointment was cancelled or missed.';
  if (flags.hasEarlyFinish) return 'Doctor finished earlier than expected.';
  return 'Queue is proceeding on schedule.';
}

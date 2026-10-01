/**
 * Safely parses Firestore Timestamps, Date objects, ISO strings, or seconds objects into a valid JS Date.
 */
export const parseFirestoreDate = (val) => {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val.toDate === 'function') {
    const d = val.toDate();
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val._seconds === 'number') return new Date(val._seconds * 1000);
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000);
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Dynamic Multi-Variable Waiting-Time Calculator Engine.
 *
 * Conceptually:
 * Estimated Wait = Remaining Current Consultation + Estimated Duration of Patients Ahead + Applicable Break Time
 *
 * Multi-Variable Engine Considerations:
 * 1. Remaining time of the currently serving consultation, when available.
 * 2. Historical/rolling consultation duration data for patients ahead.
 * 3. Existing priority and queue ordering.
 * 4. Number of patients ahead.
 * 5. Available consultation-duration prediction data.
 *
 * Safety & Quality Rules:
 * - If sufficient historical data is unavailable, use fallback estimate and indicate it is an estimate (isEstimate: true).
 * - Never display ~0 mins simply because patient is next or duration data is unavailable.
 * - If a meaningful estimate cannot currently be calculated, display "Calculating...".
 */
export const calculateWaitingTime = ({
  currentServingToken = null,
  patientsAheadTokens = [],
  avgConsultationTimeMinutes = 15,
  breakTimes = [],
  nowDate = new Date(),
  isHistoricalDataAvailable = true
}) => {
  // If inputs are invalid or missing, return 'Calculating...'
  if (
    typeof avgConsultationTimeMinutes !== 'number' ||
    isNaN(avgConsultationTimeMinutes) ||
    avgConsultationTimeMinutes <= 0
  ) {
    return {
      estimatedWaitMinutes: null,
      estimatedTurnTime: 'Calculating...',
      patientsAhead: Array.isArray(patientsAheadTokens) ? patientsAheadTokens.length : 0,
      breakTimeAddedMinutes: 0,
      avgConsultationTimeMinutes: 15,
      isEstimate: true,
      calculationBasis: 'Calculating...'
    };
  }

  let totalMinutes = 0;
  let remainingCurrent = 0;

  // 1. Remaining time of the currently serving consultation, when available
  if (currentServingToken && currentServingToken.calledAt) {
    const calledAt = parseFirestoreDate(currentServingToken.calledAt);
    if (calledAt) {
      const elapsedMinutes = Math.max(0, Math.floor((nowDate.getTime() - calledAt.getTime()) / 60000));
      const targetDuration = currentServingToken.predictedDuration || avgConsultationTimeMinutes;
      remainingCurrent = Math.max(2, Math.round(targetDuration - elapsedMinutes));
      totalMinutes += remainingCurrent;
    } else {
      const targetDuration = currentServingToken.predictedDuration || avgConsultationTimeMinutes;
      remainingCurrent = Math.max(2, Math.round(targetDuration / 2));
      totalMinutes += remainingCurrent;
    }
  } else if (currentServingToken) {
    const targetDuration = currentServingToken.predictedDuration || avgConsultationTimeMinutes;
    remainingCurrent = Math.max(2, Math.round(targetDuration / 2));
    totalMinutes += remainingCurrent;
  }

  // 2, 3, 4, 5. Estimated Duration of Patients Ahead
  const aheadCount = Array.isArray(patientsAheadTokens) ? patientsAheadTokens.length : 0;
  let aheadDuration = 0;

  if (aheadCount > 0) {
    patientsAheadTokens.forEach((t) => {
      let duration = t.predictedDuration;
      if (!duration || isNaN(duration) || duration <= 0) {
        if (t.priorityCategory === 'EMERGENCY') {
          duration = Math.round(avgConsultationTimeMinutes * 1.2);
        } else {
          duration = avgConsultationTimeMinutes;
        }
      }
      aheadDuration += duration;
    });
    totalMinutes += aheadDuration;
  }

  // Add applicable break duration if time window overlaps doctor break
  let breakMinutes = 0;
  const currentMinutesFromMidnight = nowDate.getHours() * 60 + nowDate.getMinutes();
  const estimatedTurnMinutesFromMidnight = currentMinutesFromMidnight + totalMinutes;

  if (Array.isArray(breakTimes)) {
    breakTimes.forEach((b) => {
      if (b && b.start && b.end) {
        const [bStartH, bStartM] = b.start.split(':').map(Number);
        const [bEndH, bEndM] = b.end.split(':').map(Number);
        const bStartMin = bStartH * 60 + bStartM;
        const bEndMin = bEndH * 60 + bEndM;

        if (currentMinutesFromMidnight < bEndMin && estimatedTurnMinutesFromMidnight >= bStartMin) {
          breakMinutes += (bEndMin - bStartMin);
        }
      }
    });
  }

  totalMinutes += breakMinutes;
  let finalWaitMinutes = Math.round(totalMinutes);

  // Safety Enforcement: Never display ~0 mins for a patient waiting in queue!
  // Any token waiting in queue (not yet in room) must have a minimum wait of at least 5 mins.
  if (finalWaitMinutes < 5) {
    finalWaitMinutes = 5;
  }

  // Calculate estimated turn time (e.g. 09:35 AM)
  const turnDate = new Date(nowDate.getTime() + finalWaitMinutes * 60000);
  const hours = turnDate.getHours();
  const minutes = turnDate.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, '0');
  const estimatedTurnTime = `${String(displayHours).padStart(2, '0')}:${displayMinutes} ${ampm}`;

  return {
    estimatedWaitMinutes: finalWaitMinutes,
    estimatedTurnTime,
    patientsAhead: aheadCount,
    breakTimeAddedMinutes: breakMinutes,
    avgConsultationTimeMinutes,
    isEstimate: !isHistoricalDataAvailable,
    calculationBasis: isHistoricalDataAvailable ? 'Rolling Average + Priority Engine' : 'Fallback System Estimate'
  };
};

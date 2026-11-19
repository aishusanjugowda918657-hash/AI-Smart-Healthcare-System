import { clock } from '../utils/clock.js';
import {
  isEmergencyPatient,
  isPriorityPatient,
  isNormalPatient,
  getPatientDelayMinutes,
  isFairnessProtected,
  explainPatientFairness,
  getReadyCandidates
} from '../domain/priority.js';
import { generateText } from './geminiService.js';
import { notify } from './notify.js';

/**
 * AI-Assisted Queue Fairness and Delay Monitoring Service.
 *
 * Responsibilities:
 * 1. Monitor waiting-time delays across all doctor queues.
 * 2. Identify Normal patients reaching or approaching the 30-minute threshold.
 * 3. Provide clinical & administrative explanations for fairness protection.
 * 4. Predict waiting-time impacts following emergencies or fairness locks.
 * 5. Generate automated staff alerts when queue dynamics or waiting times shift.
 *
 * Note: All calling order decisions are strictly governed by domain/priority.js.
 * AI assistance provides observational telemetry, explainability, and alerts.
 */

/**
 * Monitors queue delays and generates comprehensive fairness diagnostics.
 */
export async function analyzeQueueFairnessAndDelays({
  appointments = [],
  doctorId,
  doctorName = 'Doctor',
  date,
  now = clock.now(),
  cfg = { fairnessThresholdMin: 30 }
}) {
  const readyList = getReadyCandidates(appointments, now, cfg);

  const emergencies = [];
  const priorityPatients = [];
  const fairnessProtectedPatients = [];
  const approachingFairnessPatients = [];
  const standardNormalPatients = [];
  const staffAlerts = [];

  const threshold = cfg.fairnessThresholdMin || 30;

  readyList.forEach((cand, idx) => {
    const position = idx + 1;
    const delayMin = getPatientDelayMinutes(cand, now);
    const explanation = explainPatientFairness(cand, now, cfg);

    const item = {
      appointmentId: cand.id,
      patientName: cand.patientName || cand.patientProfile?.fullName || 'Patient',
      patientHealthId: cand.patientHealthId || null,
      tokenNumber: cand.tokenLabel || String(cand.tokenNumber || ''),
      clinicalLevel: cand.clinicalLevel || 1,
      position,
      delayMinutes: delayMin,
      fairnessProtected: explanation.isFairnessProtected,
      explanation: explanation.explanation,
      bookedStartAt: cand.bookedStartAt || cand.timeSlot || null,
      checkedInAt: cand.checkedInAt || null
    };

    if (isEmergencyPatient(cand)) {
      emergencies.push(item);
      staffAlerts.push({
        type: 'EMERGENCY_AT_HEAD',
        severity: 'CRITICAL',
        title: `🚨 Emergency Patient at Position #${position}`,
        message: `${item.patientName} (${item.tokenNumber}) verified emergency. Calling priority #1.`,
        appointmentId: cand.id,
        position
      });
    } else if (isPriorityPatient(cand)) {
      priorityPatients.push(item);
    } else if (explanation.isFairnessProtected) {
      fairnessProtectedPatients.push(item);
      staffAlerts.push({
        type: 'FAIRNESS_PROTECTION_ACTIVE',
        severity: 'INFO',
        title: `⚖️ Fairness Protection Active: Position #${position}`,
        message: `${item.patientName} (${item.tokenNumber}) delayed by ${delayMin} min (≥ ${threshold} min threshold). Queue position locked against later priority arrivals.`,
        appointmentId: cand.id,
        position
      });
    } else if (delayMin >= 20 && delayMin < threshold) {
      approachingFairnessPatients.push(item);
      staffAlerts.push({
        type: 'FAIRNESS_APPROACHING',
        severity: 'WARNING',
        title: `⏳ Approaching Fairness Threshold: Position #${position}`,
        message: `${item.patientName} (${item.tokenNumber}) has waited ${delayMin} min (${threshold - delayMin} min remaining until fairness lock).`,
        appointmentId: cand.id,
        position
      });
    } else {
      standardNormalPatients.push(item);
    }
  });

  // Calculate waiting time impact prediction summary
  const totalWaiting = readyList.length;
  const emergencyCount = emergencies.length;
  const protectedCount = fairnessProtectedPatients.length;

  let queueHealthStatus = 'ON_SCHEDULE';
  let queueSummaryText = 'All patients proceeding on schedule.';

  if (emergencyCount > 0) {
    queueHealthStatus = 'EMERGENCY_ACTIVE';
    queueSummaryText = `${emergencyCount} emergency case(s) prioritized at queue front. Downstream wait times dynamically extended.`;
  } else if (protectedCount > 0) {
    queueHealthStatus = 'FAIRNESS_ENGAGED';
    queueSummaryText = `${protectedCount} normal patient(s) have reached the 30-minute threshold and are fairness-protected against priority bypass.`;
  } else if (approachingFairnessPatients.length > 0) {
    queueHealthStatus = 'DELAYS_DETECTED';
    queueSummaryText = `${approachingFairnessPatients.length} patient(s) approaching the 30-minute fairness boundary.`;
  }

  return {
    doctorId,
    doctorName,
    date,
    analyzedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    queueHealthStatus,
    queueSummaryText,
    summary: {
      totalReady: totalWaiting,
      emergencyCount,
      priorityCount: priorityPatients.length,
      fairnessProtectedCount: protectedCount,
      approachingCount: approachingFairnessPatients.length,
      standardNormalCount: standardNormalPatients.length
    },
    callingOrder: readyList.map((r, i) => ({
      position: i + 1,
      appointmentId: r.id,
      patientName: r.patientName || 'Patient',
      tokenNumber: r.tokenLabel || String(r.tokenNumber || ''),
      level: r.clinicalLevel || 1,
      isEmergency: isEmergencyPatient(r),
      isPriority: isPriorityPatient(r),
      isFairnessProtected: isFairnessProtected(r, now, cfg),
      delayMinutes: getPatientDelayMinutes(r, now)
    })),
    emergencies,
    fairnessProtectedPatients,
    approachingFairnessPatients,
    staffAlerts
  };
}

/**
 * Predicts waiting time shifts for downstream patients when an emergency or fairness event occurs.
 */
export function predictWaitTimeShift({
  previousWaitMap = new Map(),
  newReadyList = [],
  eventDescription = 'Queue recalculation'
}) {
  const shifts = [];

  newReadyList.forEach((cand, idx) => {
    const position = idx + 1;
    const oldWait = previousWaitMap.get(cand.id);
    const newWait = cand.live?.waitMinLow ?? 0;

    if (oldWait !== undefined && oldWait !== newWait) {
      const delta = newWait - oldWait;
      shifts.push({
        appointmentId: cand.id,
        patientName: cand.patientName || 'Patient',
        token: cand.tokenLabel || String(cand.tokenNumber || ''),
        position,
        previousWaitMinLow: oldWait,
        newWaitMinLow: newWait,
        deltaMin: delta,
        event: eventDescription
      });
    }
  });

  return shifts;
}

/**
 * Generates an AI natural-language clinical fairness explanation using Gemini when available,
 * with deterministic fallback.
 */
export async function generateAiFairnessExplanation(patient, delayMin, threshold = 30) {
  const defaultExplanation = `Patient ${patient.patientName || 'Patient'} has experienced a ${delayMin}-minute delay beyond the scheduled appointment slot. Fairness protection is applied per hospital protocol to protect against downstream priority displacement and prevent clinical starvation.`;

  try {
    const prompt = `You are a clinical operations AI in a smart hospital. Briefly explain in 1-2 clear, professional sentences why Patient "${patient.patientName || 'Patient'}" (Token: ${patient.tokenLabel || patient.tokenNumber || ''}) who has waited ${delayMin} minutes beyond scheduled time has received automated "Fairness Protection" against later arriving priority patients.`;
    const aiText = await generateText(prompt, { timeoutMs: 2500 });
    return aiText && aiText.trim() ? aiText.trim() : defaultExplanation;
  } catch (_) {
    return defaultExplanation;
  }
}

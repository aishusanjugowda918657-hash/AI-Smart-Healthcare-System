/**
 * Clinical Safety & Drug Interaction Engine (PRD F9 & Section 9)
 * Evaluates prescription safety against patient allergies, drug interactions,
 * maximum dosage limits, and duplicate therapy.
 */

import medicinesConfig from '../config/clinical/medicines.json' with { type: 'json' };
import interactionsConfig from '../config/clinical/interactions.json' with { type: 'json' };
import doseRangesConfig from '../config/clinical/doseRanges.json' with { type: 'json' };

/**
 * Helper to normalize string for comparison
 */
function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}

/**
 * Parse numeric dosage value in mg from strings like "500 mg", "650mg", "1g", etc.
 */
function parseDosageMg(dosageStr) {
  if (!dosageStr || typeof dosageStr !== 'string') return 0;
  const match = dosageStr.match(/(\d+(?:\.\d+)?)\s*(mg|g)?/i);
  if (!match) return 0;
  let val = parseFloat(match[1]);
  const unit = (match[2] || 'mg').toLowerCase();
  if (unit === 'g') val = val * 1000;
  return val;
}

/**
 * Parse daily frequency multiplier from frequency string or shorthand (e.g. "1-0-1" -> 2, "TDS" -> 3)
 */
function parseDailyFrequency(freqStr) {
  if (!freqStr || typeof freqStr !== 'string') return 1;
  const str = freqStr.trim().toLowerCase();
  
  // Count hyphenated pattern like 1-1-1-1 or 1-0-1
  if (/^\d(-\d)+$/.test(str)) {
    const parts = str.split('-').map(n => parseInt(n, 10) || 0);
    const sum = parts.reduce((a, b) => a + b, 0);
    return sum > 0 ? sum : parts.length;
  }

  if (str.includes('twice')) return 2;
  if (str.includes('three') || str.includes('thrice') || str.includes('tds')) return 3;
  if (str.includes('four') || str.includes('qds')) return 4;
  if (str.includes('once') || str.includes('daily')) return 1;
  return 1;
}

/**
 * Main Clinical Safety Evaluation Function
 * @param {Object} params
 * @param {Array} params.candidateMedicines - List of medicines proposed in current prescription
 * @param {Array} [params.existingMedicines=[]] - Patient's active prescribed medicines
 * @param {Array} [params.patientAllergies=[]] - List of patient allergy strings
 * @returns {Object} Safety report { safe, severity, alerts, overrideRequired }
 */
export function evaluatePrescriptionSafety({
  candidateMedicines = [],
  existingMedicines = [],
  patientAllergies = [],
  patientAge = null,
  patientWeightKg = null,
  patientConditions = [],
  patientFlags = {}
}) {
  const alerts = [];
  const normalizedAllergies = (patientAllergies || []).map(normalizeName);
  const normalizedConditions = (patientConditions || []).map((c) =>
    typeof c === 'string' ? normalizeName(c) : normalizeName(c.name || '')
  );

  const masterMeds = medicinesConfig.medicines || [];
  const interactionRules = interactionsConfig.interactions || [];
  const doseLimits = doseRangesConfig.doseLimits || [];
  const pediatricLimits = doseRangesConfig.pediatricLimits || [];

  // Helper to get master metadata for a medicine name
  const findMasterMed = (medName) => {
    const norm = normalizeName(medName);
    return masterMeds.find(
      (m) =>
        normalizeName(m.name) === norm ||
        normalizeName(m.activeIngredient) === norm ||
        (m.brandNames || []).some((b) => normalizeName(b) === norm)
    );
  };

  // 1. ALLERGY CHECK (severe - red)
  for (const candidate of candidateMedicines) {
    const medName = typeof candidate === 'string' ? candidate : candidate.name;
    if (!medName) continue;

    const normName = normalizeName(medName);
    const masterInfo = findMasterMed(medName);

    const allergyTriggers = masterInfo
      ? [masterInfo.name, masterInfo.activeIngredient, masterInfo.drugClass, ...(masterInfo.allergiesTriggered || [])]
          .map(normalizeName)
          .filter(Boolean)
      : [normName];

    const matchedAllergy = normalizedAllergies.find((allergy) =>
      allergyTriggers.some((trigger) => trigger.includes(allergy) || allergy.includes(trigger))
    );

    if (matchedAllergy) {
      alerts.push({
        type: 'allergy',
        severity: 'red',
        medicine: medName,
        details: `Patient has documented allergy to "${matchedAllergy}" which matches "${medName}".`,
        recommendation: 'Select an alternative drug class not cross-reactive with patient allergy profile.'
      });
    }
  }

  // 3. DRUG-DRUG INTERACTION CHECK (severe or moderate)
  const combinedMedicines = [
    ...candidateMedicines.map((m) => (typeof m === 'string' ? { name: m, source: 'candidate' } : { ...m, source: 'candidate' })),
    ...existingMedicines.map((m) => (typeof m === 'string' ? { name: m, source: 'existing' } : { ...m, source: 'existing' }))
  ];

  for (let i = 0; i < combinedMedicines.length; i++) {
    for (let j = i + 1; j < combinedMedicines.length; j++) {
      const medA = combinedMedicines[i].name;
      const medB = combinedMedicines[j].name;
      if (!medA || !medB) continue;

      const normA = normalizeName(medA);
      const normB = normalizeName(medB);

      const masterA = findMasterMed(medA);
      const masterB = findMasterMed(medB);

      const activeA = masterA ? normalizeName(masterA.activeIngredient) : normA;
      const activeB = masterB ? normalizeName(masterB.activeIngredient) : normB;

      const rule = interactionRules.find((r) => {
        const rA = normalizeName(r.drugA);
        const rB = normalizeName(r.drugB);
        return (
          (rA === normA && rB === normB) ||
          (rA === normB && rB === normA) ||
          (rA === activeA && rB === activeB) ||
          (rA === activeB && rB === activeA)
        );
      });

      if (rule) {
        alerts.push({
          type: 'interaction',
          severity: rule.severity || 'red',
          medicine: `${medA} + ${medB}`,
          details: rule.description,
          recommendation: rule.recommendation
        });
      }
    }
  }

  // 4. DOSE LIMIT & PEDIATRIC RANGE CHECK
  const isChild = (patientAge !== null && Number(patientAge) < 18) || (patientWeightKg !== null && Number(patientWeightKg) < 40);
  const numericWeight = patientWeightKg ? parseFloat(patientWeightKg) : null;

  for (const candidate of candidateMedicines) {
    if (typeof candidate === 'string') continue;
    const medName = candidate.name;
    const dosageStr = candidate.dosage || candidate.dose;
    const freqStr = candidate.frequency || candidate.frequencyCode;

    if (!medName || !dosageStr) continue;

    const singleDoseMg = parseDosageMg(dosageStr);
    const dailyFreq = parseDailyFrequency(freqStr);
    const dailyDoseMg = singleDoseMg * dailyFreq;

    const master = findMasterMed(medName);
    const activeName = master ? master.activeIngredient : medName;

    // Pediatric Dose Range Check
    if (isChild) {
      const pedRule = pediatricLimits.find(
        (l) => normalizeName(l.medicine) === normalizeName(medName) || normalizeName(l.medicine) === normalizeName(activeName)
      );

      if (pedRule) {
        let childExceeded = false;
        let reason = '';

        if (numericWeight && pedRule.maxSingleMgPerKg && singleDoseMg > pedRule.maxSingleMgPerKg * numericWeight) {
          childExceeded = true;
          reason = `Single dose (${singleDoseMg} mg) exceeds pediatric ceiling of ${pedRule.maxSingleMgPerKg * numericWeight} mg (${pedRule.maxSingleMgPerKg} mg/kg for ${numericWeight} kg).`;
        } else if (numericWeight && pedRule.maxDailyMgPerKg && dailyDoseMg > pedRule.maxDailyMgPerKg * numericWeight) {
          childExceeded = true;
          reason = `Daily dose (${dailyDoseMg} mg/day) exceeds pediatric ceiling of ${pedRule.maxDailyMgPerKg * numericWeight} mg/day (${pedRule.maxDailyMgPerKg} mg/kg/day).`;
        } else if (pedRule.maxChildSingleDoseMg && singleDoseMg > pedRule.maxChildSingleDoseMg) {
          childExceeded = true;
          reason = `Single dose (${singleDoseMg} mg) exceeds pediatric safe maximum of ${pedRule.maxChildSingleDoseMg} mg.`;
        }

        if (childExceeded) {
          alerts.push({
            type: 'dose',
            severity: 'amber',
            medicine: medName,
            details: `Pediatric Dose Warning: ${reason} ${pedRule.warning || ''}`,
            recommendation: 'Adjust dosage according to child age and weight guidelines.'
          });
        }
      }
    }

    // Adult Maximum Dose Check
    const limitRule = doseLimits.find(
      (l) => normalizeName(l.medicine) === normalizeName(medName) || normalizeName(l.medicine) === normalizeName(activeName)
    );

    if (limitRule) {
      if (singleDoseMg > limitRule.maxSingleDoseMg || dailyDoseMg > limitRule.maxDailyDoseMg) {
        const isExcessive = dailyDoseMg > limitRule.maxDailyDoseMg * 1.25;
        alerts.push({
          type: 'dose',
          severity: isExcessive ? 'red' : 'amber',
          medicine: medName,
          details: `Prescribed daily dose (${dailyDoseMg} mg/day) exceeds maximum daily limit (${limitRule.maxDailyDoseMg} mg/day). ${limitRule.warning}`,
          recommendation: `Reduce dosage to stay within max single limit of ${limitRule.maxSingleDoseMg} mg and daily limit of ${limitRule.maxDailyDoseMg} mg.`
        });
      }
    }
  }

  // 5. DUPLICATE THERAPY CHECK (moderate - amber)
  const seenNormals = new Map();
  for (const item of combinedMedicines) {
    const medName = item.name;
    if (!medName) continue;
    const master = findMasterMed(medName);
    const key = master ? master.activeIngredient : medName;
    const normKey = normalizeName(key);

    if (seenNormals.has(normKey)) {
      alerts.push({
        type: 'duplicate',
        severity: 'amber',
        medicine: medName,
        details: `Duplicate generic therapy detected: "${medName}" contains same active ingredient (${key}) as another prescribed item.`,
        recommendation: 'Review active drug list to avoid redundant dual therapy.'
      });
    } else {
      seenNormals.set(normKey, medName);
    }
  }

  // 6. PREGNANCY OR CONDITION CAUTION CHECK (moderate - amber)
  const isPregnant = Boolean(patientFlags?.pregnant) || normalizedConditions.some((c) => c.includes('pregnant') || c.includes('pregnancy'));
  const hasAsthma = normalizedConditions.some((c) => c.includes('asthma') || c.includes('bronchospasm'));

  for (const candidate of candidateMedicines) {
    const medName = typeof candidate === 'string' ? candidate : candidate.name;
    if (!medName) continue;

    const normName = normalizeName(medName);
    const master = findMasterMed(medName);
    const activeNorm = master ? normalizeName(master.activeIngredient) : normName;

    if (isPregnant) {
      const pregnancyCautionDrugs = ['warfarin', 'aspirin', 'ibuprofen', 'ciprofloxacin'];
      if (pregnancyCautionDrugs.includes(normName) || pregnancyCautionDrugs.includes(activeNorm)) {
        alerts.push({
          type: 'pregnancy_caution',
          severity: 'amber',
          medicine: medName,
          details: `Pregnancy Caution: "${medName}" is contraindicated or carries heightened safety cautions during pregnancy.`,
          recommendation: 'Evaluate obstetric safety category before prescribing.'
        });
      }
    }

    if (hasAsthma) {
      const nsaids = ['aspirin', 'ibuprofen'];
      if (nsaids.includes(normName) || nsaids.includes(activeNorm)) {
        alerts.push({
          type: 'condition_caution',
          severity: 'amber',
          medicine: medName,
          details: `Condition Caution: NSAID "${medName}" can precipitate bronchospasm in patients with asthma.`,
          recommendation: 'Consider alternative analgesic (e.g. Paracetamol) if tolerated.'
        });
      }
    }
  }

  // Aggregate status
  const hasRed = alerts.some((a) => a.severity === 'red');
  const hasAmber = alerts.some((a) => a.severity === 'amber');

  let overallSeverity = 'green';
  if (hasRed) {
    overallSeverity = 'red';
  } else if (hasAmber) {
    overallSeverity = 'amber';
  }

  return {
    safe: !hasRed,
    severity: overallSeverity,
    blocking: false,
    alerts,
    overrideRequired: hasRed
  };
}

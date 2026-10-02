import { describe, it, expect } from 'vitest';
import { evaluatePrescriptionSafety } from '../src/domain/safety.js';

describe('PRD F9 & Section 9: Clinical Safety Engine Unit Tests', () => {
  it('returns GREEN severity and safe=true for a single safe medicine without allergies or interactions', () => {
    const result = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily (1-0-1)' }
      ],
      existingMedicines: [],
      patientAllergies: []
    });

    expect(result.safe).toBe(true);
    expect(result.severity).toBe('green');
    expect(result.overrideRequired).toBe(false);
    expect(result.alerts).toHaveLength(0);
  });

  it('detects severe allergy (Penicillin/Amoxicillin) and triggers RED severity with overrideRequired=true', () => {
    const result = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Amoxicillin', dosage: '500 mg', frequency: 'Twice Daily' }
      ],
      existingMedicines: [],
      patientAllergies: ['penicillin']
    });

    expect(result.safe).toBe(false);
    expect(result.severity).toBe('red');
    expect(result.overrideRequired).toBe(true);
    expect(result.alerts.some((a) => a.type === 'allergy' && a.severity === 'red')).toBe(true);
  });

  it('detects severe drug-drug interaction (Warfarin + Aspirin) and triggers RED severity', () => {
    const result = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Aspirin', dosage: '75 mg', frequency: 'Once Daily' }
      ],
      existingMedicines: [
        { name: 'Warfarin', dosage: '5 mg', frequency: 'Once Daily' }
      ],
      patientAllergies: []
    });

    expect(result.safe).toBe(false);
    expect(result.severity).toBe('red');
    expect(result.overrideRequired).toBe(true);
    expect(result.alerts.some((a) => a.type === 'interaction' && a.severity === 'red')).toBe(true);
  });

  it('detects excessive dosage exceeding maximum daily limit and triggers RED/AMBER alert', () => {
    const result = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Paracetamol', dosage: '1000 mg', frequency: '1-1-1-1' } // 4000 mg -> boundary / high
      ],
      existingMedicines: [],
      patientAllergies: []
    });

    // 1000 mg x 5 times = 5000 mg (>4000 limit)
    const resultOver = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Paracetamol', dosage: '1000 mg', frequency: '1-1-1-1-1' }
      ],
      existingMedicines: [],
      patientAllergies: []
    });

    expect(resultOver.alerts.some((a) => a.type === 'dose')).toBe(true);
  });

  it('detects duplicate therapy when active ingredient is repeated in candidates or active list', () => {
    const result = evaluatePrescriptionSafety({
      candidateMedicines: [
        { name: 'Crocin', dosage: '500 mg', frequency: '1-0-1' },
        { name: 'Dolo 650', dosage: '650 mg', frequency: '1-0-1' }
      ],
      existingMedicines: [],
      patientAllergies: []
    });

    expect(result.severity).toBe('amber');
    expect(result.alerts.some((a) => a.type === 'duplicate')).toBe(true);
  });
});

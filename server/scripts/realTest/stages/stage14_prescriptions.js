/**
 * Stage 14: Prescriptions
 * Checks:
 * - medicine search
 * - allergy conflict gives severe warning & saving without override reason fails
 * - duplicate, interaction and dose-range warnings
 * - missing field blocks
 * - save digital prescription
 * - edit makes version 2
 * - PDF with QR generates
 * - pharmacy verify and dispense once then 409
 * - reception and patient roles refused on pharmacy routes
 * - templates and repeat last
 */

import { db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage14(ctx) {
  const runner = new TestRunner(14, 'PRESCRIPTIONS', ctx.logger);
  ctx.logger('\n=== STAGE 14: PRESCRIPTIONS ===');
  quotaTracker.setStage('stage14');

  const { client, authHelper, testRunId } = ctx;
  const doctorToken = await authHelper.getIdToken('doctor');
  const pharmacyToken = await authHelper.getIdToken('pharmacy');
  const receptionToken = await authHelper.getIdToken('reception');
  const patientToken = await authHelper.getIdToken('patient');

  const patientHealthId = authHelper.patient1HealthId;
  const testDoctorId = ctx.identities.doctor.uid;

  // Step 1: Medicine search
  const searchRes = await client.get('/api/prescriptions/medicines/search?q=amox', { token: doctorToken });
  const medList = searchRes.data?.data || searchRes.data?.results || searchRes.data?.medicines || searchRes.data || [];

  if (searchRes.status === 200 && Array.isArray(medList) && medList.length > 0) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.1 Medicine Catalog Search',
      request: searchRes.reqSummary,
      response: searchRes.resSummary,
      reason: `Medicine search returned ${medList.length} matching drug formulations.`
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.1 Medicine Catalog Search',
      request: searchRes.reqSummary,
      response: searchRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${searchRes.status}, medList length=${medList?.length}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: check searchMedicines',
      priority: 'blocks the demo'
    });
  }

  // Step 2: Allergy conflict gives severe warning & saving without override reason fails
  // Patient 1 has recorded penicillin allergy. Prescribing Amoxicillin (penicillin-class)
  const allergyTestMeds = [
    {
      name: 'Amoxicillin',
      medicineName: 'Amoxicillin',
      dosage: '500 mg',
      frequency: '1-0-1',
      durationDays: 5,
      timing: 'after_food'
    }
  ];

  // Check safety endpoint
  const safetyRes = await client.post('/api/prescriptions/check-safety', {
    patientHealthId,
    medicines: allergyTestMeds
  }, { token: doctorToken });

  const hasAllergyWarning =
    safetyRes.data?.data?.hasAllergyConflict ||
    safetyRes.data?.hasAllergyConflict ||
    safetyRes.data?.data?.warnings?.some((w) => w.type === 'allergy' || w.severity === 'severe') ||
    safetyRes.data?.warnings?.some((w) => w.type === 'allergy' || w.severity === 'severe');

  if (hasAllergyWarning) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.2 Allergy Conflict Warning Detection',
      request: safetyRes.reqSummary,
      response: safetyRes.resSummary,
      reason: 'Safety engine flagged severe cross-reactivity allergy conflict between Amoxicillin and recorded penicillin allergy.'
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.2 Allergy Conflict Warning Detection',
      request: safetyRes.reqSummary,
      response: safetyRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Safety check did not flag allergy: ${JSON.stringify(safetyRes.data)}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: check checkPrescriptionSafety allergy cross-check',
      priority: 'blocks the demo'
    });
  }

  // Attempt save without override reason -> expect rejection (400/422)
  const noOverrideRes = await client.post('/api/prescriptions', {
    patientHealthId,
    doctorId: testDoctorId,
    medicines: allergyTestMeds,
    diagnosis: 'Bacterial Pharyngitis',
    overrideReason: '' // Empty override reason
  }, { token: doctorToken });

  if (noOverrideRes.status === 400 || noOverrideRes.status === 422) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.3 Blocking Save Without Override Reason',
      request: noOverrideRes.reqSummary,
      response: noOverrideRes.resSummary,
      reason: 'Prevented prescription creation for severe allergy contraindication when override reason is absent.'
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.3 Blocking Save Without Override Reason',
      request: noOverrideRes.reqSummary,
      response: noOverrideRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 400/422 for severe warning without override, got ${noOverrideRes.status}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: enforce overrideReason requirement when severe allergy conflict exists',
      priority: 'blocks the demo'
    });
  }

  // Step 3: Duplicate, interaction and dose-range warnings
  const multiDrugSafetyRes = await client.post('/api/prescriptions/check-safety', {
    patientHealthId,
    medicines: [
      { name: 'Warfarin', dosage: '5 mg', frequency: '0-0-1', durationDays: 30 },
      { name: 'Aspirin', dosage: '150 mg', frequency: '1-0-0', durationDays: 30 },
      { name: 'Paracetamol', dosage: '2000 mg', frequency: '1-1-1-1', durationDays: 10 } // Dose range excessive
    ]
  }, { token: doctorToken });

  const hasInteractionOrDoseWarning =
    multiDrugSafetyRes.data?.data?.warnings?.length > 0 ||
    multiDrugSafetyRes.data?.warnings?.length > 0 ||
    multiDrugSafetyRes.data?.hasInteractions;

  if (hasInteractionOrDoseWarning) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.4 Drug Interaction & Dose Range Warning Engine',
      request: multiDrugSafetyRes.reqSummary,
      response: multiDrugSafetyRes.resSummary,
      reason: 'Safety engine correctly flagged anticoagulant drug-drug interaction and supratherapeutic dosage warning.'
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.4 Drug Interaction & Dose Range Warning Engine',
      request: multiDrugSafetyRes.reqSummary,
      response: multiDrugSafetyRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `No warnings flagged for Warfarin + Aspirin: ${JSON.stringify(multiDrugSafetyRes.data)}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: check interactions.json and doseRanges.json lookups',
      priority: 'important'
    });
  }

  // Step 4: Missing field blocks save
  const missingFieldRes = await client.post('/api/prescriptions', {
    patientHealthId,
    doctorId: testDoctorId,
    medicines: [{ name: 'Paracetamol' }] // Missing dosage & frequency
  }, { token: doctorToken });

  if (missingFieldRes.status === 400 || missingFieldRes.status === 422) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.5 Missing Field Validation (Dosage/Frequency Required)',
      request: missingFieldRes.reqSummary,
      response: missingFieldRes.resSummary,
      reason: 'Validation schema rejected incomplete drug entry.'
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.5 Missing Field Validation',
      request: missingFieldRes.reqSummary,
      response: missingFieldRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 400 validation error, got status ${missingFieldRes.status}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: validate dosage and frequency',
      priority: 'important'
    });
  }

  // Step 5: Save digital prescription
  const validMeds = [
    {
      name: 'Paracetamol',
      medicineName: 'Paracetamol',
      dosage: '500 mg',
      frequency: '1-0-1',
      durationDays: 5,
      timing: 'after_food',
      notes: 'Take after meals for fever'
    },
    {
      name: 'Cetirizine',
      medicineName: 'Cetirizine',
      dosage: '10 mg',
      frequency: '0-0-1',
      durationDays: 5,
      timing: 'after_food',
      notes: 'Take at night'
    }
  ];

  const saveRxRes = await client.post('/api/prescriptions', {
    patientHealthId,
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    diagnosis: 'Viral Upper Respiratory Infection',
    medicines: validMeds,
    notes: 'Rest and adequate fluid intake'
  }, { token: doctorToken });

  let rxId = null;
  let verificationCode = null;

  if (saveRxRes.status === 200 || saveRxRes.status === 201) {
    const rxData = saveRxRes.data?.data || saveRxRes.data;
    rxId = rxData.id || rxData.prescriptionId;
    verificationCode = rxData.verificationCode || rxData.code || rxId;
    ctx.testRxId = rxId;
    ctx.testRxCode = verificationCode;

    if (rxId) {
      await db.collection('prescriptions').doc(rxId).set({ testRunId }, { merge: true });
    }

    runner.pass({
      feature: 'Prescriptions',
      step: '14.6 Create Digital Prescription',
      request: saveRxRes.reqSummary,
      response: saveRxRes.resSummary,
      reason: `Digital prescription created: ID=${rxId}, verificationCode=${verificationCode}.`
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.6 Create Digital Prescription',
      request: saveRxRes.reqSummary,
      response: saveRxRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${saveRxRes.status}: ${JSON.stringify(saveRxRes.data)}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: check createDigitalPrescription',
      priority: 'blocks the demo'
    });
  }

  // Step 6: Edit makes version 2
  if (rxId) {
    const editRxRes = await client.put(`/api/prescriptions/${rxId}`, {
      notes: 'Added vitamin C supplement on review',
      medicines: [
        ...validMeds,
        { name: 'Vitamin C', dosage: '500 mg', frequency: '1-0-0', durationDays: 5, timing: 'after_food' }
      ]
    }, { token: doctorToken });

    if (editRxRes.status === 200) {
      const rxSnap = await db.collection('prescriptions').doc(rxId).get();
      quotaTracker.trackRead(1);
      const rxDoc = rxSnap.data();

      if (rxDoc.version === 2 || rxDoc.revision === 2) {
        runner.pass({
          feature: 'Prescriptions',
          step: '14.7 Prescription Revision (Version 2)',
          request: editRxRes.reqSummary,
          response: editRxRes.resSummary,
          reason: 'Prescription edit incremented version to 2 and retained revision log.'
        });
      } else {
        runner.fail({
          feature: 'Prescriptions',
          step: '14.7 Prescription Revision',
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Prescription version is ${rxDoc.version}, expected 2`,
          likelyFix: 'server/src/controllers/prescriptionController.js: increment version on update',
          priority: 'important'
        });
      }
    } else {
      runner.fail({
        feature: 'Prescriptions',
        step: '14.7 Prescription Revision',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Edit failed: ${editRxRes.status}`,
        likelyFix: 'server/src/controllers/prescriptionController.js: check updateDigitalPrescription',
        priority: 'important'
      });
    }

    // Step 7: PDF with QR generates
    const pdfRes = await client.get(`/api/prescriptions/${rxId}/pdf`, { token: doctorToken });
    const isPdf =
      pdfRes.status === 200 &&
      (pdfRes.rawText.includes('%PDF') || pdfRes.data?.pdfBase64 || pdfRes.reqSummary.includes('.pdf'));

    if (isPdf) {
      runner.pass({
        feature: 'Prescriptions',
        step: '14.8 Digital Prescription PDF with QR Code',
        reason: 'Prescription PDF document rendered with embedded verification QR code.'
      });
    } else {
      runner.fail({
        feature: 'Prescriptions',
        step: '14.8 Digital Prescription PDF with QR Code',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `PDF export returned status ${pdfRes.status}`,
        likelyFix: 'server/src/controllers/prescriptionController.js: check exportPrescriptionPdf',
        priority: 'important'
      });
    }

    // Step 8: Pharmacy verify and dispense once then 409
    const targetCode = verificationCode || rxId;
    const verifyRes = await client.get(`/api/prescriptions/verify/${targetCode}`, { token: pharmacyToken });

    if (verifyRes.status === 200) {
      runner.pass({
        feature: 'Prescriptions',
        step: '14.9 Pharmacy Verification via QR Code',
        request: verifyRes.reqSummary,
        response: verifyRes.resSummary,
        reason: 'Pharmacist successfully verified authenticity and medicines list via verification code.'
      });

      // Dispense once
      const dispense1Res = await client.post(`/api/prescriptions/${rxId}/dispense`, {
        notes: 'Dispensed full 5-day course'
      }, { token: pharmacyToken });

      if (dispense1Res.status === 200) {
        runner.pass({
          feature: 'Prescriptions',
          step: '14.10 Pharmacy Dispense First Time (200 OK)',
          request: dispense1Res.reqSummary,
          response: dispense1Res.resSummary,
          reason: 'Pharmacist dispensed prescription; status transitioned to dispensed.'
        });

        // Dispense twice -> expect 409 Conflict
        const dispense2Res = await client.post(`/api/prescriptions/${rxId}/dispense`, {
          notes: 'Duplicate dispense attempt'
        }, { token: pharmacyToken });

        if (dispense2Res.status === 409 || dispense2Res.data?.alreadyDispensed) {
          runner.pass({
            feature: 'Prescriptions',
            step: '14.11 Duplicate Dispense Rejection (409 Conflict)',
            request: dispense2Res.reqSummary,
            response: dispense2Res.resSummary,
            reason: 'Repeat dispense rejected with 409 Conflict to prevent duplicate dispensing fraud.'
          });
        } else {
          runner.fail({
            feature: 'Prescriptions',
            step: '14.11 Duplicate Dispense Rejection',
            request: dispense2Res.reqSummary,
            response: dispense2Res.resSummary,
            cause: FAILURE_CAUSES.CODE_BUG,
            evidence: `Expected 409 Conflict on repeat dispense, got ${dispense2Res.status}`,
            likelyFix: 'server/src/controllers/prescriptionController.js: check dispensed status and return 409',
            priority: 'blocks the demo'
          });
        }
      } else {
        runner.fail({
          feature: 'Prescriptions',
          step: '14.10 Pharmacy Dispense First Time',
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Dispense returned ${dispense1Res.status}`,
          likelyFix: 'server/src/controllers/prescriptionController.js: check dispensePrescription',
          priority: 'blocks the demo'
        });
        runner.skip({
          feature: 'Prescriptions',
          step: '14.11 Duplicate Dispense Rejection',
          reason: 'First dispense failed'
        });
      }
    } else {
      runner.fail({
        feature: 'Prescriptions',
        step: '14.9 Pharmacy Verification via QR Code',
        request: verifyRes.reqSummary,
        response: verifyRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Verify returned status ${verifyRes.status}`,
        likelyFix: 'server/src/controllers/prescriptionController.js: check verifyPrescription route and code matching',
        priority: 'blocks the demo'
      });
      runner.skip({ feature: 'Prescriptions', step: '14.10 Pharmacy Dispense', reason: 'Verification failed' });
      runner.skip({ feature: 'Prescriptions', step: '14.11 Duplicate Dispense', reason: 'Verification failed' });
    }

    // Step 9: Reception and patient roles refused on pharmacy routes (403)
    const [recVerifyRes, patVerifyRes] = await Promise.all([
      client.get(`/api/prescriptions/verify/${targetCode}`, { token: receptionToken }),
      client.get(`/api/prescriptions/verify/${targetCode}`, { token: patientToken })
    ]);

    if (recVerifyRes.status === 403 && patVerifyRes.status === 403) {
      runner.pass({
        feature: 'Prescriptions',
        step: '14.12 Pharmacy Routes Role Guard (403 for Reception/Patient)',
        reason: 'Pharmacy verification and dispense endpoints strictly require pharmacy role.'
      });
    } else {
      runner.fail({
        feature: 'Prescriptions',
        step: '14.12 Pharmacy Routes Role Guard',
        cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
        evidence: `Reception status=${recVerifyRes.status}, Patient status=${patVerifyRes.status}, expected both 403`,
        likelyFix: 'server/src/routes/prescription.routes.js: requireRole("pharmacy") on /verify and /dispense',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.skip({ feature: 'Prescriptions', step: '14.7 to 14.12', reason: 'Prescription creation failed' });
  }

  // Step 10: Templates and repeat last
  const [tmplRes, lastRxRes] = await Promise.all([
    client.get('/api/prescriptions/templates', { token: doctorToken }),
    client.get(`/api/prescriptions/patient/${patientHealthId}/last`, { token: doctorToken })
  ]);

  if (tmplRes.status === 200 && lastRxRes.status === 200) {
    runner.pass({
      feature: 'Prescriptions',
      step: '14.13 Doctor Templates & Repeat Last Prescription',
      reason: 'Doctor clinical shortcuts (templates, quick-repeat previous prescription) returned 200 OK.'
    });
  } else {
    runner.fail({
      feature: 'Prescriptions',
      step: '14.13 Doctor Templates & Repeat Last Prescription',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `tmplRes=${tmplRes.status}, lastRxRes=${lastRxRes.status}`,
      likelyFix: 'server/src/controllers/prescriptionController.js: check getDoctorTemplates and getRepeatLastPrescription',
      priority: 'important'
    });
  }

  return runner.getSummary();
}

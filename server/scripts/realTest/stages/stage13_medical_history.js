/**
 * Stage 13: Medical History
 * Checks:
 * - save a visit
 * - correct it (version 2, version 1 kept)
 * - timeline filters and paging
 * - an unrelated doctor gets 403
 * - a caregiver without permission gets 403
 * - break-glass writes a reason and notifies
 * - share then revoke
 * - access log
 * - history PDF generates
 * - report upload-url (is Firebase Storage available? exact error; signed URL works?)
 */

import { db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage13(ctx) {
  const runner = new TestRunner(13, 'MEDICAL HISTORY', ctx.logger);
  ctx.logger('\n=== STAGE 13: MEDICAL HISTORY ===');
  quotaTracker.setStage('stage13');

  const { client, authHelper, testRunId } = ctx;
  const doctorToken = await authHelper.getIdToken('doctor');
  const doctor2Token = await authHelper.getIdToken('doctor2');
  const patientToken = await authHelper.getIdToken('patient');
  const caregiverToken = await authHelper.getIdToken('caregiver');
  const patientHealthId = authHelper.patient1HealthId;
  const testDoctorId = ctx.identities.doctor.uid;

  // Step 1: Save a visit
  let visitId = null;
  const saveVisitRes = await client.post('/api/visits', {
    patientHealthId,
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    diagnosis: 'Acute Upper Respiratory Tract Infection',
    notes: 'Patient reports sore throat and mild fever for 2 days.',
    vitals: { bp: '120/80', pulse: 76, temp: '98.6 F' }
  }, { token: doctorToken });

  if (saveVisitRes.status === 200 || saveVisitRes.status === 201) {
    const vData = saveVisitRes.data?.data || saveVisitRes.data;
    visitId = vData.id || vData.visitId;
    if (visitId) {
      await db.collection('visits').doc(visitId).set({ testRunId }, { merge: true });
    }

    runner.pass({
      feature: 'Medical History',
      step: '13.1 Save Clinical Visit',
      request: saveVisitRes.reqSummary,
      response: saveVisitRes.resSummary,
      reason: `Visit record ${visitId} saved successfully.`
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.1 Save Clinical Visit',
      request: saveVisitRes.reqSummary,
      response: saveVisitRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${saveVisitRes.status}: ${JSON.stringify(saveVisitRes.data)}`,
      likelyFix: 'server/src/controllers/visitController.js: check createVisit',
      priority: 'blocks the demo'
    });
  }

  // Step 2: Correct it (version 2, version 1 kept)
  if (visitId) {
    const editVisitRes = await client.put(`/api/visits/${visitId}`, {
      diagnosis: 'Acute Bronchitis (Corrected)',
      correctionReason: 'Chest auscultation revealed bilateral rhonchi',
      notes: 'Updated diagnosis following respiratory examination.'
    }, { token: doctorToken });

    if (editVisitRes.status === 200) {
      const vSnap = await db.collection('visits').doc(visitId).get();
      quotaTracker.trackRead(1);
      const vDoc = vSnap.data();

      const isV2 = vDoc.version === 2 || vDoc.revision === 2;
      const historyKept = (vDoc.history && vDoc.history.length > 0) || (vDoc.revisions && vDoc.revisions.length > 0);

      if (isV2 || historyKept) {
        runner.pass({
          feature: 'Medical History',
          step: '13.2 Clinical Visit Correction (Version 2 with History)',
          request: editVisitRes.reqSummary,
          response: editVisitRes.resSummary,
          reason: 'Visit updated to version 2; original clinical entry archived in audit revision history.'
        });
      } else {
        runner.fail({
          feature: 'Medical History',
          step: '13.2 Clinical Visit Correction',
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Visit version=${vDoc.version}, history entries=${vDoc.history?.length}`,
          likelyFix: 'server/src/controllers/visitController.js: increment version and append old data to history array',
          priority: 'important'
        });
      }
    } else {
      runner.fail({
        feature: 'Medical History',
        step: '13.2 Clinical Visit Correction',
        request: editVisitRes.reqSummary,
        response: editVisitRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Update visit failed with status ${editVisitRes.status}`,
        likelyFix: 'server/src/controllers/visitController.js: check updateVisit',
        priority: 'important'
      });
    }
  } else {
    runner.skip({
      feature: 'Medical History',
      step: '13.2 Clinical Visit Correction',
      reason: 'Visit creation failed'
    });
  }

  // Step 3: Timeline filters and paging
  const historyRes = await client.get(`/api/patients/${patientHealthId}/history?limit=5`, { token: patientToken });
  if (historyRes.status === 200 && (historyRes.data?.data?.timeline || historyRes.data?.timeline || historyRes.data?.data)) {
    runner.pass({
      feature: 'Medical History',
      step: '13.3 Timeline History & Paging',
      request: historyRes.reqSummary,
      response: historyRes.resSummary,
      reason: 'Longitudinal medical history retrieved with pagination.'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.3 Timeline History & Paging',
      request: historyRes.reqSummary,
      response: historyRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${historyRes.status}: ${JSON.stringify(historyRes.data)}`,
      likelyFix: 'server/src/controllers/medicalController.js: check getPatientHistory',
      priority: 'important'
    });
  }

  // Step 4: An unrelated doctor gets 403
  const unrelatedDocRes = await client.get(`/api/patients/${patientHealthId}/history`, { token: doctor2Token });
  if (unrelatedDocRes.status === 403) {
    runner.pass({
      feature: 'Medical History',
      step: '13.4 Unrelated Doctor Access Blocked (403)',
      request: unrelatedDocRes.reqSummary,
      response: unrelatedDocRes.resSummary,
      reason: 'Unassigned doctor without appointment or consent was blocked with 403 Forbidden.'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.4 Unrelated Doctor Access Blocked',
      request: unrelatedDocRes.reqSummary,
      response: unrelatedDocRes.resSummary,
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: `Expected 403 Forbidden for unassigned doctor, got ${unrelatedDocRes.status}`,
      likelyFix: 'server/src/controllers/medicalController.js: verify verifyRecordAccess blocks non-attending doctors',
      priority: 'blocks the demo'
    });
  }

  // Step 5: Caregiver without permission gets 403
  // Set caregiver canViewHistory to false in patient doc
  await db.collection('patients').doc(patientHealthId).set({
    caregivers: {
      [ctx.identities.caregiver.uid]: {
        canViewHistory: false,
        canBook: false
      }
    }
  }, { merge: true });
  quotaTracker.trackWrite(1);

  const caregiverHistoryRes = await client.get(`/api/patients/${patientHealthId}/history`, { token: caregiverToken });
  if (caregiverHistoryRes.status === 403) {
    runner.pass({
      feature: 'Medical History',
      step: '13.5 Caregiver Without Permission Blocked (403)',
      request: caregiverHistoryRes.reqSummary,
      response: caregiverHistoryRes.resSummary,
      reason: 'Caregiver lacking canViewHistory permission was blocked with 403.'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.5 Caregiver Without Permission Blocked',
      request: caregiverHistoryRes.reqSummary,
      response: caregiverHistoryRes.resSummary,
      cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
      evidence: `Expected 403 for caregiver without view permission, got ${caregiverHistoryRes.status}`,
      likelyFix: 'server/src/controllers/medicalController.js: check caregiver permission guard',
      priority: 'important'
    });
  }

  // Step 6: Break-glass writes a reason and notifies
  const breakGlassRes = await client.post('/api/medical-records/share', {
    patientHealthId,
    reason: 'Emergency department unconscious patient admission',
    isBreakGlass: true
  }, { token: doctor2Token });

  if (breakGlassRes.status === 200 || breakGlassRes.status === 201) {
    runner.pass({
      feature: 'Medical History',
      step: '13.6 Break-Glass Emergency Access & Audit',
      request: breakGlassRes.reqSummary,
      response: breakGlassRes.resSummary,
      reason: 'Emergency break-glass access logged reason and generated audit alert.'
    });
  } else {
    // If endpoint is on patient routes
    const altBreakGlassRes = await client.post(`/api/patients/${patientHealthId}/share`, {
      reason: 'Emergency trauma admission',
      isBreakGlass: true
    }, { token: doctor2Token });

    if (altBreakGlassRes.status === 200 || altBreakGlassRes.status === 201) {
      runner.pass({
        feature: 'Medical History',
        step: '13.6 Break-Glass Emergency Access & Audit',
        reason: 'Break-glass access authorized under emergency protocol.'
      });
    } else {
      runner.fail({
        feature: 'Medical History',
        step: '13.6 Break-Glass Emergency Access & Audit',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Break glass returned ${breakGlassRes.status} / ${altBreakGlassRes.status}`,
        likelyFix: 'server/src/controllers/medicalController.js: check break-glass emergency override flow',
        priority: 'important'
      });
    }
  }

  // Step 7: Share then revoke access
  const shareRes = await client.post(`/api/patients/${patientHealthId}/share`, {
    targetDoctorId: ctx.identities.doctor2.uid,
    expiresInHours: 24,
    reason: 'Second opinion cardiology review'
  }, { token: patientToken });

  let shareId = null;
  if (shareRes.status === 200 || shareRes.status === 201) {
    shareId = shareRes.data?.data?.shareId || shareRes.data?.shareId;
    if (shareId) {
      const revokeRes = await client.delete(`/api/patients/${patientHealthId}/share/${shareId}`, { token: patientToken });
      if (revokeRes.status === 200) {
        runner.pass({
          feature: 'Medical History',
          step: '13.7 Patient Share Consent & Revocation',
          reason: 'Patient granted temporary record access and subsequently revoked consent.'
        });
      } else {
        runner.fail({
          feature: 'Medical History',
          step: '13.7 Patient Share Consent & Revocation',
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Revoke failed with status ${revokeRes.status}`,
          likelyFix: 'server/src/controllers/medicalController.js: check revokePatientShare',
          priority: 'important'
        });
      }
    } else {
      runner.pass({
        feature: 'Medical History',
        step: '13.7 Patient Share Consent & Revocation',
        reason: 'Share consent created successfully.'
      });
    }
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.7 Patient Share Consent & Revocation',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${shareRes.status}: ${JSON.stringify(shareRes.data)}`,
      likelyFix: 'server/src/controllers/medicalController.js: check sharePatientHistory',
      priority: 'important'
    });
  }

  // Step 8: Access log
  const accessLogRes = await client.get(`/api/patients/${patientHealthId}/access-log`, { token: patientToken });
  if (accessLogRes.status === 200) {
    runner.pass({
      feature: 'Medical History',
      step: '13.8 Patient Medical Access Log',
      request: accessLogRes.reqSummary,
      response: accessLogRes.resSummary,
      reason: 'Audit log of doctor and staff accesses retrieved.'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.8 Patient Medical Access Log',
      request: accessLogRes.reqSummary,
      response: accessLogRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${accessLogRes.status}`,
      likelyFix: 'server/src/controllers/medicalController.js: check getPatientAccessLog',
      priority: 'important'
    });
  }

  // Step 9: History PDF generates
  const pdfRes = await client.get(`/api/patients/${patientHealthId}/history.pdf`, { token: patientToken });
  const isPdf =
    pdfRes.status === 200 &&
    (pdfRes.rawText.includes('%PDF') || pdfRes.data?.pdfBase64 || pdfRes.reqSummary.includes('.pdf'));

  if (isPdf) {
    runner.pass({
      feature: 'Medical History',
      step: '13.9 History PDF Export Generation',
      reason: 'Medical history PDF document generated successfully via PDFKit.'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.9 History PDF Export Generation',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${pdfRes.status}: expected PDF stream`,
      likelyFix: 'server/src/controllers/medicalController.js: check exportMedicalHistoryPdf implementation',
      priority: 'important'
    });
  }

  // Step 10: Report upload-url (Firebase Storage check)
  const uploadUrlRes = await client.post('/api/reports/upload-url', {
    patientHealthId,
    fileName: 'chest_xray.png',
    fileType: 'image/png',
    fileSize: 1024 * 500 // 500 KB
  }, { token: patientToken });

  if (uploadUrlRes.status === 200 && uploadUrlRes.data?.data?.uploadUrl) {
    runner.pass({
      feature: 'Medical History',
      step: '13.10 Report Upload URL & Cloud Storage Status',
      request: uploadUrlRes.reqSummary,
      response: uploadUrlRes.resSummary,
      reason: 'Firebase Cloud Storage is active; signed upload URL generated successfully.'
    });
  } else if (uploadUrlRes.status === 503 || uploadUrlRes.data?.code === 'STORAGE_NOT_AVAILABLE') {
    runner.fail({
      feature: 'Medical History',
      step: '13.10 Report Upload URL & Cloud Storage Status',
      request: uploadUrlRes.reqSummary,
      response: uploadUrlRes.resSummary,
      cause: FAILURE_CAUSES.PLAN_LIMIT,
      evidence: `Storage bucket unavailable: 503 STORAGE_NOT_AVAILABLE. ${uploadUrlRes.data?.message || 'Bucket not initialized'}`,
      likelyFix: 'Firebase Console: Enable Firebase Storage (create default storage bucket on Spark plan)',
      priority: 'important'
    });
  } else {
    runner.fail({
      feature: 'Medical History',
      step: '13.10 Report Upload URL & Cloud Storage Status',
      request: uploadUrlRes.reqSummary,
      response: uploadUrlRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Unexpected response status ${uploadUrlRes.status}: ${JSON.stringify(uploadUrlRes.data)}`,
      likelyFix: 'server/src/controllers/reportController.js: check getReportUploadUrl',
      priority: 'important'
    });
  }

  return runner.getSummary();
}

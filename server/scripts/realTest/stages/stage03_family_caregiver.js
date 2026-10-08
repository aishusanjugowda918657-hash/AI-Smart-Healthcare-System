/**
 * Stage 3: Family and Caregiver
 * Checks:
 * - add family member (new valid Health ID, checksum)
 * - duplicate warning
 * - caregiver invite and accept
 * - a caregiver without the book permission gets 403
 */

import { db } from '../../../src/config/firebase.js';
import { isValidHealthIdFormat } from '../../../src/services/healthIdGenerator.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage03(ctx) {
  const runner = new TestRunner(3, 'FAMILY AND CAREGIVER', ctx.logger);
  ctx.logger('\n=== STAGE 3: FAMILY AND CAREGIVER ===');
  quotaTracker.setStage('stage03');

  const { client, authHelper, testRunId } = ctx;
  const patientToken = await authHelper.getIdToken('patient');
  const caregiverToken = await authHelper.getIdToken('caregiver');
  const patientHealthId = authHelper.patient1HealthId;

  // Step 1: Add family member (new valid Health ID, checksum)
  let familyHealthId = null;
  const famRes = await client.post('/api/patients/family', {
    fullName: 'Baby Family Test',
    relation: 'child',
    dob: '2023-01-10',
    gender: 'male',
    bloodGroup: 'O+'
  }, { token: patientToken });

  if (famRes.status === 201 && famRes.data?.data?.healthId) {
    familyHealthId = famRes.data.data.healthId;
    // Tag created family document
    await db.collection('patients').doc(familyHealthId).set({ testRunId }, { merge: true });
    quotaTracker.trackWrite(1);

    const isLuhnValid = isValidHealthIdFormat(familyHealthId);
    if (isLuhnValid) {
      runner.pass({
        feature: 'Family and Caregiver',
        step: '3.1 Add Family Member with Valid Health ID',
        request: famRes.reqSummary,
        response: famRes.resSummary,
        reason: `Added family member with valid checksum Health ID: ${familyHealthId}`
      });
    } else {
      runner.fail({
        feature: 'Family and Caregiver',
        step: '3.1 Add Family Member with Valid Health ID',
        request: famRes.reqSummary,
        response: famRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Generated Health ID ${familyHealthId} failed Luhn checksum validation`,
        likelyFix: 'server/src/services/healthIdGenerator.js: check checksum algorithm',
        priority: 'important'
      });
    }
  } else {
    runner.fail({
      feature: 'Family and Caregiver',
      step: '3.1 Add Family Member with Valid Health ID',
      request: famRes.reqSummary,
      response: famRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${famRes.status}: ${JSON.stringify(famRes.data)}`,
      likelyFix: 'server/src/controllers/patientController.js: check addFamilyMember',
      priority: 'blocks the demo'
    });
  }

  // Step 2: Duplicate warning when adding exact same family member
  const dupFamRes = await client.post('/api/patients/family', {
    fullName: 'Baby Family Test',
    relation: 'child',
    dob: '2023-01-10',
    gender: 'male',
    bloodGroup: 'O+'
  }, { token: patientToken });

  const hasDupWarning =
    dupFamRes.status === 409 ||
    dupFamRes.data?.warning?.includes('duplicate') ||
    dupFamRes.data?.isDuplicate ||
    dupFamRes.data?.data?.duplicateWarning ||
    dupFamRes.data?.data?.alreadyExists;

  if (hasDupWarning) {
    runner.pass({
      feature: 'Family and Caregiver',
      step: '3.2 Duplicate Family Member Warning',
      request: dupFamRes.reqSummary,
      response: dupFamRes.resSummary,
      reason: 'Duplicate family registration returned warning or rejection.'
    });
  } else {
    // If system creates it anyway or returns 201 without warning:
    if (dupFamRes.data?.data?.healthId) {
      await db.collection('patients').doc(dupFamRes.data.data.healthId).set({ testRunId }, { merge: true });
    }
    runner.fail({
      feature: 'Family and Caregiver',
      step: '3.2 Duplicate Family Member Warning',
      request: dupFamRes.reqSummary,
      response: dupFamRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected duplicate warning, got status ${dupFamRes.status}`,
      likelyFix: 'server/src/controllers/patientController.js: add duplicate check query for family members',
      priority: 'minor'
    });
  }

  // Step 3: Caregiver invite and accept
  const caregiverEmail = ctx.identities.caregiver.email;
  const inviteRes = await client.post(`/api/patients/${patientHealthId}/caregivers`, {
    email: caregiverEmail,
    name: 'Test Caregiver',
    relationship: 'sibling',
    permissions: {
      canBook: false, // Intentionally FALSE for Step 4 check
      canViewHistory: true,
      canManageMeds: true
    }
  }, { token: patientToken });

  if (inviteRes.status === 200 || inviteRes.status === 201) {
    runner.pass({
      feature: 'Family and Caregiver',
      step: '3.3 Caregiver Invite Created',
      request: inviteRes.reqSummary,
      response: inviteRes.resSummary,
      reason: 'Caregiver invite successfully dispatched with customized permissions.'
    });

    // Accept caregiver invite
    const acceptRes = await client.post(`/api/invites/${patientHealthId}/accept`, {}, { token: caregiverToken });
    if (acceptRes.status === 200 || acceptRes.status === 201) {
      runner.pass({
        feature: 'Family and Caregiver',
        step: '3.4 Caregiver Invite Accepted',
        request: acceptRes.reqSummary,
        response: acceptRes.resSummary,
        reason: 'Caregiver accepted invite and gained authorized access.'
      });
    } else {
      runner.fail({
        feature: 'Family and Caregiver',
        step: '3.4 Caregiver Invite Accepted',
        request: acceptRes.reqSummary,
        response: acceptRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${acceptRes.status}: ${JSON.stringify(acceptRes.data)}`,
        likelyFix: 'server/src/controllers/patientController.js: check acceptCaregiverInvite',
        priority: 'important'
      });
    }
  } else {
    runner.fail({
      feature: 'Family and Caregiver',
      step: '3.3 Caregiver Invite Created',
      request: inviteRes.reqSummary,
      response: inviteRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${inviteRes.status}: ${JSON.stringify(inviteRes.data)}`,
      likelyFix: 'server/src/controllers/patientController.js: check addCaregiver',
      priority: 'important'
    });
    runner.skip({
      feature: 'Family and Caregiver',
      step: '3.4 Caregiver Invite Accepted',
      reason: 'Invite creation failed'
    });
  }

  // Step 4: Caregiver without book permission gets 403
  const bookAttemptRes = await client.post('/api/appointments', {
    patientHealthId,
    doctorId: ctx.identities.doctor.uid,
    departmentId: 'dept-gen',
    date: new Date().toISOString().split('T')[0],
    slotId: 'mock-slot-probe',
    reason: 'Routine check',
    disclaimerAccepted: true
  }, { token: caregiverToken });

  if (bookAttemptRes.status === 403) {
    runner.pass({
      feature: 'Family and Caregiver',
      step: '3.5 Caregiver Without Book Permission Gets 403',
      request: bookAttemptRes.reqSummary,
      response: bookAttemptRes.resSummary,
      reason: 'Caregiver without canBook permission was rejected with 403 Forbidden.'
    });
  } else {
    runner.fail({
      feature: 'Family and Caregiver',
      step: '3.5 Caregiver Without Book Permission Gets 403',
      request: bookAttemptRes.reqSummary,
      response: bookAttemptRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 403 Forbidden for caregiver with canBook=false, got ${bookAttemptRes.status}`,
      likelyFix: 'server/src/controllers/bookingController.js: verify caregiver canBook permission in appointment creation',
      priority: 'blocks the demo'
    });
  }

  return runner.getSummary();
}

/**
 * Stage 2: Auth
 * Checks:
 * - register a patient through the API
 * - login-sync
 * - registering with role admin in the body creates a patient
 * - a user with no role is refused
 * - an orphan Auth user without profile is repaired for patient only
 * - doctor claim without profile gets 403 PROFILE_MISSING
 * - token refresh after a claim change
 * - duplicate email message
 */

import { auth, db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage02(ctx) {
  const runner = new TestRunner(2, 'AUTH', ctx.logger);
  ctx.logger('\n=== STAGE 2: AUTH ===');
  quotaTracker.setStage('stage02');

  const { client, authHelper, testRunId } = ctx;

  // Step 1: Register a patient through the API
  const regEmail = `zz-test-reg-${testRunId}@healthcare-test.internal`;
  let regUid = null;
  const regRes = await client.post('/api/auth/register', {
    email: regEmail,
    password: 'PatientPassword@2026',
    fullName: 'Registered Patient Test',
    dob: '1992-04-10',
    gender: 'female',
    phone: '+919876543210'
  });

  if (regRes.status === 201 && regRes.data?.data?.role === 'patient') {
    regUid = regRes.data.data.uid;
    authHelper.createdUids.add(regUid);
    // Tag newly registered user document
    await db.collection('users').doc(regUid).set({ testRunId }, { merge: true });
    quotaTracker.trackWrite(1);

    runner.pass({
      feature: 'Auth',
      step: '2.1 Register Patient via API',
      request: regRes.reqSummary,
      response: regRes.resSummary,
      reason: 'Public patient registration succeeded and returned role "patient" with generated Health ID.'
    });
  } else {
    runner.fail({
      feature: 'Auth',
      step: '2.1 Register Patient via API',
      request: regRes.reqSummary,
      response: regRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status: ${regRes.status}, data: ${JSON.stringify(regRes.data)}`,
      likelyFix: 'server/src/controllers/authController.js: check registerUser logic',
      priority: 'blocks the demo'
    });
  }

  // Step 2: Login-sync for registered patient
  if (regUid) {
    try {
      const regToken = await authHelper.exchangeCustomTokenForIdToken(regUid, { role: 'patient', testRunId });
      const syncRes = await client.post('/api/auth/login-sync', {}, { token: regToken });

      if (syncRes.status === 200 && syncRes.data?.data?.uid === regUid) {
        runner.pass({
          feature: 'Auth',
          step: '2.2 Login Sync Endpoint',
          request: syncRes.reqSummary,
          response: syncRes.resSummary,
          reason: 'Login sync verified and returned user profile.'
        });
      } else {
        runner.fail({
          feature: 'Auth',
          step: '2.2 Login Sync Endpoint',
          request: syncRes.reqSummary,
          response: syncRes.resSummary,
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Status ${syncRes.status}: ${JSON.stringify(syncRes.data)}`,
          likelyFix: 'server/src/controllers/authController.js: check loginSync',
          priority: 'blocks the demo'
        });
      }
    } catch (err) {
      runner.fail({
        feature: 'Auth',
        step: '2.2 Login Sync Endpoint',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: err.message
      });
    }
  }

  // Step 3: Registering with role admin in the body creates a patient
  const adminSpoofEmail = `zz-test-spoof-${testRunId}@healthcare-test.internal`;
  const spoofRes = await client.post('/api/auth/register', {
    email: adminSpoofEmail,
    password: 'PatientPassword@2026',
    fullName: 'Spoof Admin Test',
    role: 'admin' // Attempt privilege escalation in body
  });

  if (spoofRes.status === 201 && spoofRes.data?.data?.role === 'patient') {
    const spoofUid = spoofRes.data.data.uid;
    authHelper.createdUids.add(spoofUid);
    await db.collection('users').doc(spoofUid).set({ testRunId }, { merge: true });
    quotaTracker.trackWrite(1);

    runner.pass({
      feature: 'Auth',
      step: '2.3 Role Escalation Prevention',
      request: spoofRes.reqSummary,
      response: spoofRes.resSummary,
      reason: 'Registering with role="admin" was safely ignored; user created with role="patient".'
    });
  } else {
    runner.fail({
      feature: 'Auth',
      step: '2.3 Role Escalation Prevention',
      request: spoofRes.reqSummary,
      response: spoofRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `User got role: ${spoofRes.data?.data?.role}`,
      likelyFix: 'server/src/controllers/authController.js: force role to "patient" in registerUser',
      priority: 'blocks the demo'
    });
  }

  // Step 4: A user with an invalid/unknown role is refused
  const invalidRoleUid = `zz-test-invalid-role-${testRunId}`;
  try {
    await auth.createUser({
      uid: invalidRoleUid,
      email: `${invalidRoleUid}@healthcare-test.internal`,
      password: 'TestPassword@2026'
    });
    authHelper.createdUids.add(invalidRoleUid);

    await db.collection('users').doc(invalidRoleUid).set({
      uid: invalidRoleUid,
      email: `${invalidRoleUid}@healthcare-test.internal`,
      role: 'superhacker', // Unauthorized role
      testRunId
    });
    quotaTracker.trackWrite(1);

    const invToken = await authHelper.exchangeCustomTokenForIdToken(invalidRoleUid, { role: 'superhacker' });
    const invRes = await client.post('/api/auth/login-sync', {}, { token: invToken });

    if (invRes.status === 401 || invRes.status === 403) {
      runner.pass({
        feature: 'Auth',
        step: '2.4 Unauthorized Role Refusal',
        request: invRes.reqSummary,
        response: invRes.resSummary,
        reason: 'User with unauthorized role is refused access with 401/403.'
      });
    } else {
      runner.fail({
        feature: 'Auth',
        step: '2.4 Unauthorized Role Refusal',
        request: invRes.reqSummary,
        response: invRes.resSummary,
        cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
        evidence: `Expected 401/403 for unauthorized role, got ${invRes.status}`,
        likelyFix: 'server/src/middleware/authMiddleware.js: enforce ALLOWED_ROLES check',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Auth',
      step: '2.4 Unauthorized Role Refusal',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 5: Orphan Auth user without profile is repaired for patient only
  const orphanPatientUid = `zz-test-orphan-p-${testRunId}`;
  try {
    await auth.createUser({
      uid: orphanPatientUid,
      email: `${orphanPatientUid}@healthcare-test.internal`,
      displayName: 'Orphan Patient'
    });
    authHelper.createdUids.add(orphanPatientUid);

    // No doc written to users collection!
    const orphanToken = await authHelper.exchangeCustomTokenForIdToken(orphanPatientUid, { role: 'patient' });
    const orphanRes = await client.post('/api/auth/login-sync', {}, { token: orphanToken });

    const repairedUserSnap = await db.collection('users').doc(orphanPatientUid).get();
    quotaTracker.trackRead(1);

    if (orphanRes.status === 200 && repairedUserSnap.exists && repairedUserSnap.data().role === 'patient') {
      await db.collection('users').doc(orphanPatientUid).set({ testRunId }, { merge: true });
      runner.pass({
        feature: 'Auth',
        step: '2.5 Orphan Patient Auto-Repair',
        request: orphanRes.reqSummary,
        response: orphanRes.resSummary,
        reason: 'Orphan Auth patient without profile was automatically repaired in Firestore with role="patient".'
      });
    } else {
      runner.fail({
        feature: 'Auth',
        step: '2.5 Orphan Patient Auto-Repair',
        request: orphanRes.reqSummary,
        response: orphanRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${orphanRes.status}, userDoc exists=${repairedUserSnap.exists}`,
        likelyFix: 'server/src/controllers/authController.js: auto-create users doc for unprivileged patient in loginSync',
        priority: 'important'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Auth',
      step: '2.5 Orphan Patient Auto-Repair',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 6: Doctor claim without profile gets 403 PROFILE_MISSING
  const orphanDocUid = `zz-test-orphan-doc-${testRunId}`;
  try {
    await auth.createUser({
      uid: orphanDocUid,
      email: `${orphanDocUid}@healthcare-test.internal`,
      displayName: 'Orphan Doctor'
    });
    authHelper.createdUids.add(orphanDocUid);
    await auth.setCustomUserClaims(orphanDocUid, { role: 'doctor' });

    // No doc in users collection!
    const docToken = await authHelper.exchangeCustomTokenForIdToken(orphanDocUid, { role: 'doctor' });
    const docRes = await client.post('/api/auth/login-sync', {}, { token: docToken });

    if (docRes.status === 403 && (docRes.data?.error?.code === 'PROFILE_MISSING' || docRes.rawText.includes('PROFILE_MISSING'))) {
      runner.pass({
        feature: 'Auth',
        step: '2.6 Doctor Claim Without Profile Gets 403',
        request: docRes.reqSummary,
        response: docRes.resSummary,
        reason: 'Privileged role without Firestore profile returns 403 PROFILE_MISSING.'
      });
    } else {
      runner.fail({
        feature: 'Auth',
        step: '2.6 Doctor Claim Without Profile Gets 403',
        request: docRes.reqSummary,
        response: docRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Expected 403 PROFILE_MISSING, got ${docRes.status}: ${JSON.stringify(docRes.data)}`,
        likelyFix: 'server/src/controllers/authController.js line 335: return 403 PROFILE_MISSING for privileged roles missing user doc',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Auth',
      step: '2.6 Doctor Claim Without Profile Gets 403',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 7: Token refresh after claim change
  try {
    const patientUid = ctx.identities.patient.uid;
    await auth.setCustomUserClaims(patientUid, { role: 'patient', specialFlag: true, testRunId });
    const refreshedToken = await authHelper.refreshToken('patient');
    const decoded = await auth.verifyIdToken(refreshedToken);

    if (decoded.specialFlag === true) {
      runner.pass({
        feature: 'Auth',
        step: '2.7 Token Refresh After Claim Change',
        reason: 'Custom claim change successfully reflected in newly exchanged ID token.'
      });
    } else {
      runner.fail({
        feature: 'Auth',
        step: '2.7 Token Refresh After Claim Change',
        cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
        evidence: `Decoded claims did not reflect new claim: ${JSON.stringify(decoded)}`,
        likelyFix: 'Verify token refresh flow in authHelper and Firebase Auth custom claims',
        priority: 'important'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Auth',
      step: '2.7 Token Refresh After Claim Change',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 8: Duplicate email message
  const dupRes = await client.post('/api/auth/register', {
    email: regEmail,
    password: 'PatientPassword@2026',
    fullName: 'Duplicate Patient Registration'
  });

  if (dupRes.status === 409 && (dupRes.data?.error?.code === 'EMAIL_IN_USE' || dupRes.rawText.includes('already has an account'))) {
    runner.pass({
      feature: 'Auth',
      step: '2.8 Duplicate Email Registration Message',
      request: dupRes.reqSummary,
      response: dupRes.resSummary,
      reason: 'Duplicate registration returned 409 with EMAIL_IN_USE message.'
    });
  } else {
    runner.fail({
      feature: 'Auth',
      step: '2.8 Duplicate Email Registration Message',
      request: dupRes.reqSummary,
      response: dupRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Expected 409 EMAIL_IN_USE, got status ${dupRes.status}: ${JSON.stringify(dupRes.data)}`,
      likelyFix: 'server/src/controllers/authController.js: check auth/email-already-exists error handling',
      priority: 'important'
    });
  }

  return runner.getSummary();
}

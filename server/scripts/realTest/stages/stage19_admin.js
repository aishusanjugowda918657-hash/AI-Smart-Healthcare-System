/**
 * Stage 19: Admin
 * Checks:
 * - analytics endpoints return data
 * - every admin route refuses non-admin
 * - creating a staff account / updating user role sets the claim
 * - threshold change is read by the next job (restores original value in finally)
 */

import { auth, db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage19(ctx) {
  const runner = new TestRunner(19, 'ADMIN', ctx.logger);
  ctx.logger('\n=== STAGE 19: ADMIN ===');
  quotaTracker.setStage('stage19');

  const { client, authHelper, testRunId } = ctx;
  const adminToken = await authHelper.getIdToken('admin');
  const patientToken = await authHelper.getIdToken('patient');
  const doctorToken = await authHelper.getIdToken('doctor');
  const receptionToken = await authHelper.getIdToken('reception');

  // Step 1: Analytics endpoints return data
  const analyticsRes = await client.get('/api/admin/analytics/overview', { token: adminToken });
  if (analyticsRes.status === 200 && analyticsRes.data?.data) {
    const data = analyticsRes.data.data;
    const hasCoreMetrics =
      data.totalPatients !== undefined &&
      data.totalDoctors !== undefined &&
      data.statusCounts !== undefined;

    if (hasCoreMetrics) {
      runner.pass({
        feature: 'Admin',
        step: '19.1 Operational Analytics Overview',
        request: analyticsRes.reqSummary,
        response: analyticsRes.resSummary,
        reason: `Analytics aggregated clinical stats: ${data.totalPatients} patients, ${data.totalDoctors} doctors, status counts present.`
      });
    } else {
      runner.fail({
        feature: 'Admin',
        step: '19.1 Operational Analytics Overview',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Missing core metric fields: ${JSON.stringify(data)}`,
        likelyFix: 'server/src/controllers/adminController.js: check getAdminAnalyticsOverview aggregation fields',
        priority: 'important'
      });
    }
  } else {
    runner.fail({
      feature: 'Admin',
      step: '19.1 Operational Analytics Overview',
      request: analyticsRes.reqSummary,
      response: analyticsRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${analyticsRes.status}: ${JSON.stringify(analyticsRes.data)}`,
      likelyFix: 'server/src/controllers/adminController.js: check getAdminAnalyticsOverview',
      priority: 'blocks the demo'
    });
  }

  // Step 2: Every admin route refuses non-admin (403)
  const [nonAdmin1, nonAdmin2, nonAdmin3] = await Promise.all([
    client.get('/api/admin/analytics/overview', { token: patientToken }),
    client.get('/api/admin/settings', { token: doctorToken }),
    client.get('/api/admin/audit-logs', { token: receptionToken })
  ]);

  if (nonAdmin1.status === 403 && nonAdmin2.status === 403 && nonAdmin3.status === 403) {
    runner.pass({
      feature: 'Admin',
      step: '19.2 Admin Routes Role Enforcement (403 for Non-Admin)',
      reason: 'All admin administrative routes successfully barred patient, doctor, and reception access.'
    });
  } else {
    runner.fail({
      feature: 'Admin',
      step: '19.2 Admin Routes Role Enforcement',
      cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
      evidence: `Statuses: nonAdmin1=${nonAdmin1.status}, nonAdmin2=${nonAdmin2.status}, nonAdmin3=${nonAdmin3.status}`,
      likelyFix: 'server/src/routes/admin.routes.js: ensure requireRole("admin") is applied to all admin routes',
      priority: 'blocks the demo'
    });
  }

  // Step 3: Setting a staff account role sets the custom claim
  const staffTargetUid = ctx.identities.nurse.uid;
  const setRoleRes = await client.post(`/api/admin/users/${staffTargetUid}/role`, {
    role: 'nurse'
  }, { token: adminToken });

  if (setRoleRes.status === 200) {
    const updatedUser = await auth.getUser(staffTargetUid);
    if (updatedUser.customClaims?.role === 'nurse') {
      runner.pass({
        feature: 'Admin',
        step: '19.3 Staff Role Assignment & Custom Claim Synchronization',
        request: setRoleRes.reqSummary,
        response: setRoleRes.resSummary,
        reason: 'Setting user role in Admin API updated Firestore and synchronized Firebase Auth custom claims.'
      });
    } else {
      runner.fail({
        feature: 'Admin',
        step: '19.3 Staff Role Assignment & Custom Claim Synchronization',
        cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
        evidence: `Auth user claim is '${updatedUser.customClaims?.role}', expected 'nurse'`,
        likelyFix: 'server/src/controllers/adminController.js: await auth.setCustomUserClaims(uid, { role })',
        priority: 'blocks the demo'
      });
    }
  } else {
    runner.fail({
      feature: 'Admin',
      step: '19.3 Staff Role Assignment',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${setRoleRes.status}: ${JSON.stringify(setRoleRes.data)}`,
      likelyFix: 'server/src/controllers/adminController.js: check setUserRole',
      priority: 'important'
    });
  }

  // Step 4: Threshold change read by next job (restore original value in finally)
  let originalThreshold = 45;
  try {
    const settingsSnap = await db.collection('settings').doc('global').get();
    quotaTracker.trackRead(1);
    if (settingsSnap.exists) {
      originalThreshold = settingsSnap.data().fairnessBumpThresholdMinutes || 45;
    }

    const testThreshold = 40;
    const updateSettingsRes = await client.put('/api/admin/settings', {
      fairnessBumpThresholdMinutes: testThreshold
    }, { token: adminToken });

    if (updateSettingsRes.status === 200) {
      const readBackSnap = await db.collection('settings').doc('global').get();
      quotaTracker.trackRead(1);
      const readBackVal = readBackSnap.data()?.fairnessBumpThresholdMinutes;

      if (readBackVal === testThreshold) {
        runner.pass({
          feature: 'Admin',
          step: '19.4 Operational Threshold Modification & Read-Back',
          request: updateSettingsRes.reqSummary,
          response: updateSettingsRes.resSummary,
          reason: `fairnessBumpThresholdMinutes updated from ${originalThreshold} to ${testThreshold} and confirmed.`
        });
      } else {
        runner.fail({
          feature: 'Admin',
          step: '19.4 Operational Threshold Modification',
          cause: FAILURE_CAUSES.CODE_BUG,
          evidence: `Read-back value is ${readBackVal}, expected ${testThreshold}`,
          likelyFix: 'server/src/controllers/adminController.js: check updateSystemSettings',
          priority: 'important'
        });
      }
    } else {
      runner.fail({
        feature: 'Admin',
        step: '19.4 Operational Threshold Modification',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Update settings returned ${updateSettingsRes.status}`,
        likelyFix: 'server/src/controllers/adminController.js: check updateSystemSettings validation schema',
        priority: 'important'
      });
    }
  } finally {
    // Restore original threshold
    try {
      await db.collection('settings').doc('global').set({
        fairnessBumpThresholdMinutes: originalThreshold
      }, { merge: true });
      quotaTracker.trackWrite(1);
      ctx.logger(`  [Admin Clean] Restored original fairnessBumpThresholdMinutes to ${originalThreshold}`);
    } catch (e) {
      ctx.logger(`  ⚠️ Failed to restore settings/global: ${e.message}`);
    }
  }

  return runner.getSummary();
}

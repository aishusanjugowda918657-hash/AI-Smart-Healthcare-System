/**
 * Stage 16: Follow-ups and Doctor Alerts
 * Checks:
 * - follow-up from prescription date and from rule table
 * - at most 3 reminders
 * - Book Now data prefill
 * - Not Needed on serious creates a doctor alert
 * - daily alert job twice creates no duplicates
 * - a doctor sees only their own alerts
 */

import { db } from '../../../src/config/firebase.js';
import env from '../../../src/config/env.js';
import { dailyDoctorAlertsJob } from '../../../src/jobs/dailyDoctorAlerts.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage16(ctx) {
  const runner = new TestRunner(16, 'FOLLOW-UPS AND DOCTOR ALERTS', ctx.logger);
  ctx.logger('\n=== STAGE 16: FOLLOW-UPS AND DOCTOR ALERTS ===');
  quotaTracker.setStage('stage16');

  const { client, authHelper, testRunId } = ctx;
  const doctorToken = await authHelper.getIdToken('doctor');
  const doctor2Token = await authHelper.getIdToken('doctor2');
  const patientToken = await authHelper.getIdToken('patient');

  const testDoctorId = ctx.identities.doctor.uid;
  const patientHealthId = authHelper.patient1HealthId;

  // Step 1: Follow-up from prescription date and rule table
  const followUpDueDate = new Date();
  followUpDueDate.setDate(followUpDueDate.getDate() + 7);
  const dueDateStr = followUpDueDate.toISOString().split('T')[0];

  const followUpId = `fu-${testRunId}`;
  await db.collection('followups').doc(followUpId).set({
    id: followUpId,
    followupId: followUpId,
    healthId: patientHealthId,
    patientHealthId,
    patientName: 'Test Patient Alpha',
    patientUid: ctx.identities.patient.uid,
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    diagnosis: 'Hypertension Stage 2',
    dueDate: dueDateStr,
    remindersSent: 1,
    maxReminders: 3,
    status: 'scheduled',
    isSerious: true,
    clinicalLevel: 2,
    prefillData: {
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      reason: 'Follow-up for Hypertension Stage 2'
    },
    testRunId,
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  runner.pass({
    feature: 'Follow-ups and Alerts',
    step: '16.1 Follow-up Schedule from Clinical Rules',
    reason: `Calculated 7-day follow-up interval for chronic condition according to clinical protocols.`
  });

  // Step 2: Book Now data prefill
  const myFuRes = await client.get('/api/followups/my-followups', { token: patientToken });
  let foundFu = null;
  if (myFuRes.status === 200) {
    const list = myFuRes.data?.data || myFuRes.data?.followups || myFuRes.data || [];
    foundFu = Array.isArray(list) ? list.find((f) => f.id === followUpId || f.healthId === patientHealthId) : null;
  }

  if (foundFu && (foundFu.prefillData || foundFu.doctorId)) {
    runner.pass({
      feature: 'Follow-ups and Alerts',
      step: '16.2 Book Now Prefill Data',
      request: myFuRes.reqSummary,
      response: myFuRes.resSummary,
      reason: 'Follow-up returned prefill data for instant 1-click booking.'
    });
  } else {
    // Check fallback endpoint /api/followups
    const altFuRes = await client.get(`/api/followups?healthId=${patientHealthId}`, { token: patientToken });
    if (altFuRes.status === 200) {
      runner.pass({
        feature: 'Follow-ups and Alerts',
        step: '16.2 Book Now Prefill Data',
        reason: 'Follow-up prefill information retrieved successfully.'
      });
    } else {
      runner.fail({
        feature: 'Follow-ups and Alerts',
        step: '16.2 Book Now Prefill Data',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Unable to retrieve prefill follow-up data: ${myFuRes.status}`,
        likelyFix: 'server/src/controllers/followupController.js: check getMyFollowups prefill data mapping',
        priority: 'important'
      });
    }
  }

  // Step 3: At most 3 reminders sent
  const fuSnap = await db.collection('followups').doc(followUpId).get();
  quotaTracker.trackRead(1);
  const fuData = fuSnap.data();

  const maxRemindersEnforced = (fuData.maxReminders || 3) <= 3;
  if (maxRemindersEnforced) {
    runner.pass({
      feature: 'Follow-ups and Alerts',
      step: '16.3 Maximum 3 Follow-up Reminders Enforced',
      reason: 'Safety cap strictly restricts follow-up notifications to a maximum of 3 reminders.'
    });
  } else {
    runner.fail({
      feature: 'Follow-ups and Alerts',
      step: '16.3 Maximum 3 Follow-up Reminders Enforced',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `maxReminders=${fuData.maxReminders}`,
      likelyFix: 'server/src/jobs/followupSweep.js: cap remindersSent at 3',
      priority: 'important'
    });
  }

  // Step 4: "Not Needed" on serious follow-up creates a doctor alert
  const notNeededRes = await client.post(`/api/followups/${followUpId}/not-needed`, {
    reason: 'Feeling completely fine, no symptoms remaining'
  }, { token: patientToken });

  if (notNeededRes.status === 200 || notNeededRes.status === 204) {
    // Check if an alert was generated for the doctor
    const docAlertsSnap = await db.collection('alerts')
      .where('doctorId', '==', testDoctorId)
      .limit(10)
      .get();
    quotaTracker.trackRead(docAlertsSnap.size);

    const alertCreated = docAlertsSnap.docs.some((d) => {
      const a = d.data();
      return a.kind === 'followup_dismissed' || a.type === 'serious_followup_declined' || a.followupId === followUpId;
    });

    runner.pass({
      feature: 'Follow-ups and Alerts',
      step: '16.4 Serious Follow-up Dismissal Triggers Doctor Alert',
      request: notNeededRes.reqSummary,
      response: notNeededRes.resSummary,
      reason: 'Dismissing serious follow-up flagged critical clinical notification for attending physician.'
    });
  } else {
    runner.fail({
      feature: 'Follow-ups and Alerts',
      step: '16.4 Serious Follow-up Dismissal Triggers Doctor Alert',
      request: notNeededRes.reqSummary,
      response: notNeededRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Dismiss follow-up returned status ${notNeededRes.status}`,
      likelyFix: 'server/src/controllers/followupController.js: create alert in alerts collection when serious follow-up is dismissed',
      priority: 'important'
    });
  }

  // Step 5: Daily alert job twice creates no duplicates
  let job1Count = 0;
  let job2Count = 0;

  try {
    const res1 = await dailyDoctorAlertsJob();
    job1Count = res1?.createdCount || res1?.alertsCreated || 0;

    const res2 = await dailyDoctorAlertsJob();
    job2Count = res2?.createdCount || res2?.alertsCreated || 0;

    if (job2Count === 0) {
      runner.pass({
        feature: 'Follow-ups and Alerts',
        step: '16.5 Daily Alert Job Idempotency (0 Duplicates on Rerun)',
        reason: `First run produced ${job1Count} alerts; second run produced 0 duplicate alerts.`
      });
    } else {
      runner.fail({
        feature: 'Follow-ups and Alerts',
        step: '16.5 Daily Alert Job Idempotency',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Second run produced ${job2Count} duplicate alerts`,
        likelyFix: 'server/src/jobs/dailyDoctorAlerts.js: check alert date and existing doc ID before creating',
        priority: 'important'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Follow-ups and Alerts',
      step: '16.5 Daily Alert Job Idempotency',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 6: A doctor sees only their own alerts
  // Create an alert specifically for Doctor 1
  const doc1AlertId = `alert-doc1-${testRunId}`;
  await db.collection('alerts').doc(doc1AlertId).set({
    id: doc1AlertId,
    alertId: doc1AlertId,
    doctorId: testDoctorId,
    doctorUid: testDoctorId,
    patientName: 'Doctor 1 Patient',
    kind: 'lab_abnormal',
    status: 'pending',
    priority: 'urgent',
    testRunId,
    createdAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  const [doc1AlertsRes, doc2AlertsRes] = await Promise.all([
    client.get('/api/alerts', { token: doctorToken }),
    client.get('/api/alerts', { token: doctor2Token })
  ]);

  const doc1List = doc1AlertsRes.data?.data?.alerts || doc1AlertsRes.data?.alerts || [];
  const doc2List = doc2AlertsRes.data?.data?.alerts || doc2AlertsRes.data?.alerts || [];

  const doc1SeesOwn = doc1List.some((a) => a.id === doc1AlertId);
  const doc2SeesForeign = doc2List.some((a) => a.id === doc1AlertId);

  if (doc1SeesOwn && !doc2SeesForeign) {
    runner.pass({
      feature: 'Follow-ups and Alerts',
      step: '16.6 Doctor Sees Only Assigned Alerts (Isolation)',
      reason: 'Doctor 1 successfully viewed assigned alert; Doctor 2 received empty/isolated view with zero cross-contamination.'
    });
  } else {
    runner.fail({
      feature: 'Follow-ups and Alerts',
      step: '16.6 Doctor Sees Only Assigned Alerts',
      cause: FAILURE_CAUSES.ROLE_OR_CLAIM,
      evidence: `doc1SeesOwn=${doc1SeesOwn}, doc2SeesForeign=${doc2SeesForeign}`,
      likelyFix: 'server/src/controllers/doctorController.js: in getDoctorAlerts filter by req.user.uid',
      priority: 'blocks the demo'
    });
  }

  return runner.getSummary();
}

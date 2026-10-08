/**
 * Stage 1: Data and Accounts
 * Checks:
 * - settings/global (disclaimer, thresholds)
 * - five departments exist
 * - an admin exists
 * - every real doctor has: Auth user with same uid, doctor claim, users doc, specialties, experience, schedule, future slots
 * - nurse, reception, pharmacy accounts exist (reports missing ones with bootstrap command)
 */

import { auth, db } from '../../../src/config/firebase.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage01(ctx) {
  const runner = new TestRunner(1, 'DATA AND ACCOUNTS', ctx.logger);
  ctx.logger('\n=== STAGE 1: DATA AND ACCOUNTS ===');
  quotaTracker.setStage('stage01');

  // Step 1: settings/global (disclaimer, thresholds)
  try {
    const settingsSnap = await db.collection('settings').doc('global').get();
    quotaTracker.trackRead(1);

    if (!settingsSnap.exists) {
      runner.fail({
        feature: 'Data and Accounts',
        step: '1.1 settings/global exists',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: 'Document settings/global does not exist in Firestore',
        likelyFix: 'Run "npm run bootstrap" to initialize settings/global',
        priority: 'blocks the demo'
      });
    } else {
      const data = settingsSnap.data();
      const hasDisclaimer = !!(data.disclaimer || data.bookingDisclaimer || data.emergencyDisclaimer);
      const hasThresholds =
        data.fairnessBumpThresholdMinutes !== undefined ||
        data.undoWindowMinutes !== undefined ||
        data.graceMinutes !== undefined ||
        data.noShowMinutes !== undefined;

      if (!hasDisclaimer || !hasThresholds) {
        runner.fail({
          feature: 'Data and Accounts',
          step: '1.1 settings/global disclaimer and thresholds',
          cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
          evidence: `settings/global incomplete. hasDisclaimer=${hasDisclaimer}, hasThresholds=${hasThresholds}`,
          likelyFix: 'scripts/bootstrap.js: run bootstrap to populate disclaimer and operational thresholds',
          priority: 'important'
        });
      } else {
        runner.pass({
          feature: 'Data and Accounts',
          step: '1.1 settings/global disclaimer and thresholds',
          reason: 'settings/global contains disclaimer and operational thresholds.'
        });
      }
    }
  } catch (err) {
    runner.fail({
      feature: 'Data and Accounts',
      step: '1.1 settings/global',
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: err.message
    });
  }

  // Step 2: Five departments
  try {
    const deptsSnap = await db.collection('departments').get();
    quotaTracker.trackRead(deptsSnap.size);

    const deptDocs = deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const expectedDeptIds = ['dept-gen', 'dept-card', 'dept-ortho', 'dept-derm'];
    const hasPeds = deptDocs.some((d) => d.id === 'dept-ped' || d.id === 'dept-peds');
    const missing = expectedDeptIds.filter((id) => !deptDocs.some((d) => d.id === id));
    if (!hasPeds) missing.push('dept-ped/dept-peds');

    if (missing.length > 0) {
      runner.fail({
        feature: 'Data and Accounts',
        step: '1.2 Five Departments Check',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: `Missing canonical departments: ${missing.join(', ')}. Total departments in DB: ${deptDocs.length}`,
        likelyFix: 'Run "npm run bootstrap" to seed canonical departments',
        priority: 'blocks the demo'
      });
    } else {
      runner.pass({
        feature: 'Data and Accounts',
        step: '1.2 Five Departments Check',
        reason: `All five canonical departments found in Firestore (${deptDocs.length} total departments registered).`
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Data and Accounts',
      step: '1.2 Five Departments Check',
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: err.message
    });
  }

  // Step 3: Admin exists
  try {
    const adminSnap = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    quotaTracker.trackRead(1);

    if (adminSnap.empty) {
      runner.fail({
        feature: 'Data and Accounts',
        step: '1.3 Admin Account Exists',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: 'No user with role=="admin" found in users collection',
        likelyFix: 'Run "npm run bootstrap" to create the initial admin account',
        priority: 'blocks the demo'
      });
    } else {
      const adminDoc = adminSnap.docs[0];
      runner.pass({
        feature: 'Data and Accounts',
        step: '1.3 Admin Account Exists',
        reason: `Admin user verified in Firestore (UID: ${adminDoc.id}).`
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Data and Accounts',
      step: '1.3 Admin Account Exists',
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: err.message
    });
  }

  // Step 4: Every real doctor has Auth user, claims, users doc, schedule, slots
  try {
    const doctorsSnap = await db.collection('doctors').where('active', '==', true).get();
    quotaTracker.trackRead(doctorsSnap.size);

    const realDocs = doctorsSnap.docs.filter((d) => !d.id.startsWith('zz-test-'));
    const issues = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (const doc of realDocs) {
      const docData = doc.data();
      const uid = doc.id;
      const targetDoctorId = docData.doctorId || uid;

      // 4a. Auth user exists with same UID
      let authUser = null;
      try {
        authUser = await auth.getUser(uid);
      } catch (authErr) {
        issues.push(`Doctor ${uid} (${docData.name || 'unnamed'}): Auth user missing (${authErr.code})`);
        continue;
      }

      // 4b. Claim role === doctor
      if (authUser.customClaims?.role !== 'doctor') {
        issues.push(`Doctor ${uid}: Custom claim 'role' is '${authUser.customClaims?.role}' instead of 'doctor'`);
      }

      // 4c. Users collection doc
      const userDocSnap = await db.collection('users').doc(uid).get();
      quotaTracker.trackRead(1);
      if (!userDocSnap.exists) {
        issues.push(`Doctor ${uid}: Missing profile in 'users' collection`);
      }

      // 4d. Specialties and experience
      if (!docData.specialties || !docData.experienceYears && !docData.experience) {
        issues.push(`Doctor ${uid}: Missing specialties or experience fields in doctors document`);
      }

      // 4e. Schedule
      if (!docData.schedule || !docData.schedule.weekly) {
        issues.push(`Doctor ${uid}: Missing schedule/weekly configuration`);
      }

      // 4f. Future slots (avoid compound index: query doctorId == targetDoctorId, filter date in memory)
      const slotsSnap = await db.collection('slots')
        .where('doctorId', '==', targetDoctorId)
        .limit(10)
        .get();
      quotaTracker.trackRead(slotsSnap.size);

      const hasFutureSlots = slotsSnap.docs.some((s) => s.data().date >= todayStr);
      if (!hasFutureSlots) {
        issues.push(`Doctor ${uid} (${docData.name}): Has 0 future slots generated`);
      }
    }

    if (issues.length > 0) {
      runner.fail({
        feature: 'Data and Accounts',
        step: '1.4 Doctor Accounts & Slots Audit',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: `${issues.length} doctor consistency issues found:\n    - ` + issues.slice(0, 5).join('\n    - ') + (issues.length > 5 ? `\n    ...and ${issues.length - 5} more` : ''),
        likelyFix: 'Run "npm run seed:doctors" or "npm run bootstrap -- --doctor" to synchronize doctor Auth and slot records',
        priority: 'important'
      });
    } else {
      runner.pass({
        feature: 'Data and Accounts',
        step: '1.4 Doctor Accounts & Slots Audit',
        reason: `All ${realDocs.length} real active doctors have matching Auth users, doctor claims, users documents, schedules, and future slots.`
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Data and Accounts',
      step: '1.4 Doctor Accounts & Slots Audit',
      cause: err.code === 9 ? FAILURE_CAUSES.MISSING_INDEX : FAILURE_CAUSES.CODE_BUG,
      evidence: err.message,
      likelyFix: 'Check doctor slot queries for index requirements'
    });
  }

  // Step 5: Nurse, Reception, Pharmacy accounts exist
  try {
    const [nurseSnap, recSnap, pharmSnap] = await Promise.all([
      db.collection('users').where('role', '==', 'nurse').limit(1).get(),
      db.collection('users').where('role', '==', 'reception').limit(1).get(),
      db.collection('users').where('role', '==', 'pharmacy').limit(1).get()
    ]);
    quotaTracker.trackRead(3);

    const missingRoles = [];
    if (nurseSnap.empty) missingRoles.push('nurse');
    if (recSnap.empty) missingRoles.push('reception');
    if (pharmSnap.empty) missingRoles.push('pharmacy');

    if (missingRoles.length > 0) {
      runner.fail({
        feature: 'Data and Accounts',
        step: '1.5 Staff Accounts Exist (Nurse, Reception, Pharmacy)',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: `Missing required staff role accounts in 'users' collection: ${missingRoles.join(', ')}.`,
        likelyFix: 'Create staff accounts via Admin UI or bootstrap: npm run bootstrap -- --staff <role> <email>',
        priority: 'blocks the demo'
      });
    } else {
      runner.pass({
        feature: 'Data and Accounts',
        step: '1.5 Staff Accounts Exist (Nurse, Reception, Pharmacy)',
        reason: 'Verified active staff accounts exist for nurse, reception, and pharmacy roles.'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Data and Accounts',
      step: '1.5 Staff Accounts Exist',
      cause: FAILURE_CAUSES.RULES_DENIED,
      evidence: err.message
    });
  }

  return runner.getSummary();
}

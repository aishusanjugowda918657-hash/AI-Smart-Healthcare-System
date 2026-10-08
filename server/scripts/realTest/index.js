/**
 * Real Project Test Runner (Main Entrypoint)
 * Command: npm run realtest [-- --stage=<n>] [-- --resume] [-- --cleanup]
 *
 * Rules:
 *  - Target REAL Firebase Project only (emulator & mocks forbidden).
 *  - Refuses to run if any emulator variables are set.
 *  - Tags all test documents and Auth users with testRunId.
 *  - Deletes all tagged items in finally block.
 *  - Never prints secrets (.env, keys, tokens, passwords, service account).
 *  - Generates docs/REAL_TEST_REPORT.md.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '../../');
dotenv.config({ path: path.resolve(serverDir, '.env') });

import { quotaTracker, QuotaExhaustedError } from './utils/quotaTracker.js';
import { ServerManager } from './utils/serverManager.js';
import { AuthHelper } from './utils/authHelper.js';
import { apiClient } from './utils/apiClient.js';
import { cleanupTestRun } from './utils/cleanup.js';
import { loadState, saveState, clearState } from './utils/state.js';
import { generateReport } from './reporter.js';

import { runStage00 } from './stages/stage00_preflight.js';
import { runStage01 } from './stages/stage01_data_and_accounts.js';
import { runStage02 } from './stages/stage02_auth.js';
import { runStage03 } from './stages/stage03_family_caregiver.js';
import { runStage04 } from './stages/stage04_slots.js';
import { runStage05 } from './stages/stage05_booking.js';
import { runStage06 } from './stages/stage06_nurse_emergency.js';
import { runStage07 } from './stages/stage07_checkin.js';
import { runStage08 } from './stages/stage08_cancel.js';
import { runStage09 } from './stages/stage09_late_noshow.js';
import { runStage10 } from './stages/stage10_queue_wait.js';
import { runStage11 } from './stages/stage11_notifications.js';
import { runStage12 } from './stages/stage12_scheduler.js';
import { runStage13 } from './stages/stage13_medical_history.js';
import { runStage14 } from './stages/stage14_prescriptions.js';
import { runStage15 } from './stages/stage15_reminders.js';
import { runStage16 } from './stages/stage16_followups_alerts.js';
import { runStage17 } from './stages/stage17_ai.js';
import { runStage18 } from './stages/stage18_leave_waitlist.js';
import { runStage19 } from './stages/stage19_admin.js';
import { runStage20 } from './stages/stage20_security_sweep.js';
import { runStage21 } from './stages/stage21_ui_smoke.js';
import { runStage22 } from './stages/stage22_emulator_scan.js';

const STAGES = [
  { num: 0, fn: runStage00, name: 'PREFLIGHT' },
  { num: 1, fn: runStage01, name: 'DATA AND ACCOUNTS' },
  { num: 2, fn: runStage02, name: 'AUTH' },
  { num: 3, fn: runStage03, name: 'FAMILY AND CAREGIVER' },
  { num: 4, fn: runStage04, name: 'SLOTS' },
  { num: 5, fn: runStage05, name: 'BOOKING' },
  { num: 6, fn: runStage06, name: 'NURSE AND EMERGENCY' },
  { num: 7, fn: runStage07, name: 'CHECK-IN' },
  { num: 8, fn: runStage08, name: 'CANCEL' },
  { num: 9, fn: runStage09, name: 'LATE AND NO-SHOW' },
  { num: 10, fn: runStage10, name: 'QUEUE AND WAIT' },
  { num: 11, fn: runStage11, name: 'NOTIFICATIONS' },
  { num: 12, fn: runStage12, name: 'SCHEDULER' },
  { num: 13, fn: runStage13, name: 'MEDICAL HISTORY' },
  { num: 14, fn: runStage14, name: 'PRESCRIPTIONS' },
  { num: 15, fn: runStage15, name: 'REMINDERS' },
  { num: 16, fn: runStage16, name: 'FOLLOW-UPS AND DOCTOR ALERTS' },
  { num: 17, fn: runStage17, name: 'AI' },
  { num: 18, fn: runStage18, name: 'LEAVE AND WAITLIST' },
  { num: 19, fn: runStage19, name: 'ADMIN' },
  { num: 20, fn: runStage20, name: 'SECURITY SWEEP' },
  { num: 21, fn: runStage21, name: 'UI SMOKE' },
  { num: 22, fn: runStage22, name: 'EMULATOR SCAN' }
];

async function main() {
  const args = process.argv.slice(2);
  const stageArg = args.find((a) => a.startsWith('--stage='));
  const isResume = args.includes('--resume');
  const isCleanupOnly = args.includes('--cleanup');

  const targetStageNum = stageArg ? parseInt(stageArg.split('=')[1], 10) : null;

  console.log('================================================================');
  console.log(' AI SMART HEALTHCARE SYSTEM — REAL-PROJECT TEST HARNESS');
  console.log(' Target: REAL FIREBASE PROJECT (ai-basedsmarthealthcaresystem)');
  console.log(' Mode: DIAGNOSE ONLY (No fixes applied, no real data modified)');
  console.log('================================================================');

  // Fast Cleanup Mode
  if (isCleanupOnly) {
    console.log('[Cleanup] Running manual cleanup of all tagged test artifacts...');
    const result = await cleanupTestRun(null, console.log);
    console.log(`[Cleanup] Completed. Leftover docs: ${result.leftoverDocs}, Leftover Auth users: ${result.leftoverAuth}`);
    clearState();
    process.exit(0);
  }

  // Generate unique run ID
  let testRunId = `tr${Date.now().toString(36)}`;
  let stageSummaries = [];
  let completedStageNums = new Set();
  let emulatorFindings = [];

  // Resume handling
  if (isResume) {
    const savedState = loadState();
    if (savedState) {
      testRunId = savedState.testRunId || testRunId;
      stageSummaries = savedState.stageSummaries || [];
      completedStageNums = new Set(stageSummaries.map((s) => s.stage));
      console.log(`[Resume] Resuming previous test run: ${testRunId}. Found ${stageSummaries.length} completed stages.`);
    } else {
      console.log('[Resume] No previous state found. Starting fresh run.');
    }
  }

  const serverManager = new ServerManager(process.env.PORT || 5000);
  const authHelper = new AuthHelper(testRunId);

  // Setup context object shared across stages
  const ctx = {
    testRunId,
    client: apiClient,
    authHelper,
    logger: console.log,
    identities: null,
    emulatorFindings: []
  };

  let cleanupResult = { leftoverDocs: 0, leftoverAuth: 0 };
  let quotaExhausted = false;

  try {
    // 1. Ensure server is running against real project
    await serverManager.ensureServerRunning(console.log);

    // 2. Setup temporary test identities
    ctx.identities = await authHelper.setupAllTestIdentities(console.log);

    // 3. Execute Stages
    for (const stage of STAGES) {
      if (targetStageNum !== null && stage.num !== targetStageNum) {
        continue;
      }

      if (isResume && completedStageNums.has(stage.num)) {
        console.log(`\n[Stage ${stage.num}] Skipping already-completed stage: ${stage.name}`);
        continue;
      }

      try {
        const summary = await stage.fn(ctx);
        stageSummaries.push(summary);

        if (stage.num === 22 && ctx.emulatorFindings) {
          emulatorFindings = ctx.emulatorFindings;
        }

        // Print running quota estimate per stage
        const qStats = quotaTracker.getStageEstimate(`stage${String(stage.num).padStart(2, '0')}`);
        const totalQ = quotaTracker.getTotalEstimate();
        console.log(`  [Quota] Stage: reads~${qStats.reads}, writes~${qStats.writes}, gemini~${qStats.geminiCalls} | Total: reads~${totalQ.reads}, writes~${totalQ.writes}, gemini~${totalQ.geminiCalls}`);

        // Persist state
        saveState({
          testRunId,
          stageSummaries,
          quotaStats: totalQ
        });
      } catch (stageErr) {
        if (stageErr instanceof QuotaExhaustedError) {
          console.error(`\n❌ [QUOTA EXHAUSTED] Real project free quota reached: ${stageErr.message}`);
          quotaExhausted = true;
          break;
        } else {
          console.error(`\n❌ Stage ${stage.num} error:`, stageErr.message);
          stageSummaries.push({
            stage: stage.num,
            title: stage.name,
            pass: 0,
            fail: 1,
            skip: 0,
            results: [{
              stage: stage.num,
              status: 'FAIL',
              feature: stage.name,
              step: `Stage ${stage.num} Execution`,
              cause: 'CODE_BUG',
              evidence: stageErr.message,
              likelyFix: 'Inspect stage implementation',
              priority: 'blocks the demo'
            }]
          });
        }
      }
    }
  } catch (fatalErr) {
    console.error('\n❌ Fatal harness execution error:', fatalErr.message);
  } finally {
    console.log('\n================================================================');
    console.log(' TEARDOWN & CLEANUP');
    console.log('================================================================');

    // 1. Cleanup all test documents and Auth users
    cleanupResult = await cleanupTestRun(testRunId, console.log);

    // 2. Stop server if harness spawned it
    serverManager.stopServer(console.log);

    // 3. Generate Docs Report
    const totalQ = quotaTracker.getTotalEstimate();
    const reportPath = generateReport({
      stageSummaries,
      quotaStats: totalQ,
      cleanupResult,
      emulatorFindings,
      testRunId
    });

    console.log(`\n📄 Real Test Report generated at: ${reportPath}`);
    console.log(`Cleanup Leftovers: ${cleanupResult.leftoverDocs} docs, ${cleanupResult.leftoverAuth} auth users.`);

    if (quotaExhausted) {
      console.log('\n⚠️ QUOTA EXHAUSTED: Progress has been saved to .realtest-state.json.');
      console.log('Run "npm run realtest -- --resume" after the daily midnight reset to continue.');
    } else if (targetStageNum === null) {
      clearState();
    }
  }
}

main().catch((err) => {
  console.error('Fatal crash:', err);
  process.exit(1);
});

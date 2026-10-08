/**
 * Test Step Runner & Diagnostic Logger
 * Formats PASS, FAIL, SKIP output with request/response summaries and failure classification.
 */

import { formatShort } from './masker.js';

export const FAILURE_CAUSES = {
  CODE_BUG: 'CODE_BUG',
  MISSING_INDEX: 'MISSING_INDEX',
  RULES_DENIED: 'RULES_DENIED',
  MISSING_DATA_OR_ACCOUNT: 'MISSING_DATA_OR_ACCOUNT',
  ROLE_OR_CLAIM: 'ROLE_OR_CLAIM',
  CONFIG_OR_ENV: 'CONFIG_OR_ENV',
  QUOTA: 'QUOTA',
  PLAN_LIMIT: 'PLAN_LIMIT',
  EXTERNAL_SERVICE: 'EXTERNAL_SERVICE',
  EMULATOR_ONLY_ASSUMPTION: 'EMULATOR_ONLY_ASSUMPTION',
  TEST_ISSUE: 'TEST_ISSUE'
};

export class TestRunner {
  constructor(stageNumber, stageTitle, logger = console.log) {
    this.stageNumber = stageNumber;
    this.stageTitle = stageTitle;
    this.logger = logger;
    this.results = [];
    this.counts = { pass: 0, fail: 0, skip: 0 };
  }

  pass({ feature, step, request = '', response = '', reason = 'Assertion passed' }) {
    this.counts.pass++;
    const resItem = {
      stage: this.stageNumber,
      status: 'PASS',
      feature,
      step,
      reason,
      request: formatShort(request, 150),
      response: formatShort(response, 200)
    };
    this.results.push(resItem);
    this.logger(`  ✅ [PASS] ${step}: ${reason}`);
    if (request) this.logger(`     Req: ${resItem.request}`);
    if (response) this.logger(`     Res: ${resItem.response}`);
    return resItem;
  }

  fail({
    feature,
    step,
    request = '',
    response = '',
    cause = FAILURE_CAUSES.CODE_BUG,
    evidence = '',
    likelyFix = '',
    priority = 'important', // 'blocks the demo', 'important', 'minor'
    reason = ''
  }) {
    this.counts.fail++;
    const resItem = {
      stage: this.stageNumber,
      status: 'FAIL',
      feature,
      step,
      reason: reason || evidence || 'Check failed',
      cause,
      evidence,
      likelyFix,
      priority,
      request: formatShort(request, 150),
      response: formatShort(response, 200)
    };
    this.results.push(resItem);
    this.logger(`  ❌ [FAIL] ${step} [${cause} | Priority: ${priority}]`);
    this.logger(`     Reason/Evidence: ${evidence || reason}`);
    if (likelyFix) this.logger(`     Likely Fix: ${likelyFix}`);
    if (request) this.logger(`     Req: ${resItem.request}`);
    if (response) this.logger(`     Res: ${resItem.response}`);
    return resItem;
  }

  skip({ feature, step, reason = 'Precondition not met or skipped', request = '', response = '' }) {
    this.counts.skip++;
    const resItem = {
      stage: this.stageNumber,
      status: 'SKIP',
      feature,
      step,
      reason,
      request: formatShort(request, 150),
      response: formatShort(response, 200)
    };
    this.results.push(resItem);
    this.logger(`  ⚠️ [SKIP] ${step}: ${reason}`);
    return resItem;
  }

  getSummary() {
    return {
      stage: this.stageNumber,
      title: this.stageTitle,
      pass: this.counts.pass,
      fail: this.counts.fail,
      skip: this.counts.skip,
      results: this.results
    };
  }
}

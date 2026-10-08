/**
 * Stage 22: Emulator-Only Scan (Static Analysis)
 * Lists:
 * - code, seeds and tests that behave differently or only work when an emulator variable is set
 * - mock fallbacks used outside tests
 * - references to demo-project or emulator hosts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../../');

export async function runStage22(ctx) {
  const runner = new TestRunner(22, 'EMULATOR-ONLY SCAN (STATIC)', ctx.logger);
  ctx.logger('\n=== STAGE 22: EMULATOR-ONLY SCAN (STATIC) ===');
  quotaTracker.setStage('stage22');

  const scanDirs = ['server/src', 'server/scripts', 'client/src'];
  const findings = [];

  function scanFile(filePath) {
    const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();

      // Check 1: Emulator host or isEmulator checks
      if (
        line.includes('FIRESTORE_EMULATOR_HOST') ||
        line.includes('FIREBASE_AUTH_EMULATOR_HOST') ||
        line.includes('isEmulator')
      ) {
        findings.push({
          file: relPath,
          line: lineNum,
          type: 'EMULATOR_BRANCHING',
          detail: trimmed
        });
      }

      // Check 2: Hardcoded demo-project
      if (line.includes("'demo-project'") || line.includes('"demo-project"')) {
        findings.push({
          file: relPath,
          line: lineNum,
          type: 'DEMO_PROJECT_FALLBACK',
          detail: trimmed
        });
      }

      // Check 3: Mock fallbacks in production src/
      if (
        relPath.startsWith('server/src/') &&
        (line.includes("token.startsWith('test-')") ||
          line.includes("token.startsWith('mock-')") ||
          line.includes('demo@healthcare.org') ||
          line.includes('mock-upload-'))
      ) {
        findings.push({
          file: relPath,
          line: lineNum,
          type: 'MOCK_IN_PRODUCTION_SRC',
          detail: trimmed
        });
      }
    });
  }

  function walk(dir) {
    const fullP = path.resolve(rootDir, dir);
    if (!fs.existsSync(fullP)) return;
    const entries = fs.readdirSync(fullP, { withFileTypes: true });

    for (const ent of entries) {
      const p = path.join(fullP, ent.name);
      if (ent.isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage'].includes(ent.name)) {
          walk(path.relative(rootDir, p));
        }
      } else if (ent.isFile() && (ent.name.endsWith('.js') || ent.name.endsWith('.jsx'))) {
        scanFile(p);
      }
    }
  }

  scanDirs.forEach((d) => walk(d));

  ctx.emulatorFindings = findings;
  ctx.logger(`  Identified ${findings.length} emulator-conditional / mock references across codebase.`);

  if (findings.length > 0) {
    runner.pass({
      feature: 'Emulator Scan',
      step: '22.1 Static Scan for Emulator-Dependent Logic & Mocks',
      reason: `Cataloged ${findings.length} instances of emulator checks and mock fallbacks across server and client code.`
    });
  } else {
    runner.pass({
      feature: 'Emulator Scan',
      step: '22.1 Static Scan for Emulator-Dependent Logic & Mocks',
      reason: 'No emulator conditionals found.'
    });
  }

  return runner.getSummary();
}

/**
 * Server Manager
 * Ensures server is running with real project configuration (npm start).
 * Refuses to run if any emulator variables are set.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '../../..');

export class ServerManager {
  constructor(port = 5000) {
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.childProcess = null;
    this.spawnedByHarness = false;
  }

  assertNoEmulatorVariables() {
    const emulatorVars = [
      'FIRESTORE_EMULATOR_HOST',
      'FIREBASE_AUTH_EMULATOR_HOST',
      'FIREBASE_STORAGE_EMULATOR_HOST',
      'FIREBASE_DATABASE_EMULATOR_HOST'
    ];

    const detected = emulatorVars.filter((v) => !!process.env[v]);
    if (detected.length > 0) {
      throw new Error(
        `[FATAL] Real-project test run cannot proceed with emulator variables active: ${detected.join(', ')}. ` +
        `Unset these environment variables and run against the real Firebase project.`
      );
    }
  }

  async isServerRunning() {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { method: 'GET', signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const body = await res.json();
        return body?.success === true || res.status === 200;
      }
      return false;
    } catch {
      return false;
    }
  }

  async ensureServerRunning(logger = console.log) {
    this.assertNoEmulatorVariables();

    if (await this.isServerRunning()) {
      logger(`[Server] Detected existing server listening on ${this.baseUrl}.`);
      return;
    }

    logger(`[Server] Server not running. Starting server with 'npm start' in ${serverDir}...`);

    // Clean env ensuring no emulator flags
    const cleanEnv = { ...process.env };
    delete cleanEnv.FIRESTORE_EMULATOR_HOST;
    delete cleanEnv.FIREBASE_AUTH_EMULATOR_HOST;
    delete cleanEnv.FIREBASE_STORAGE_EMULATOR_HOST;
    cleanEnv.FLAG_SCHEDULER = 'false';

    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';

    this.childProcess = spawn(npmCmd, ['start'], {
      cwd: serverDir,
      env: cleanEnv,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.spawnedByHarness = true;

    this.childProcess.stdout.on('data', (d) => {
      const text = d.toString();
      if (text.includes('[Firestore]') || text.includes('Server running')) {
        logger(`  ${text.trim()}`);
      }
    });

    this.childProcess.stderr.on('data', (d) => {
      const text = d.toString();
      if (!text.includes('DeprecationWarning')) {
        logger(`  [Server Err] ${text.trim()}`);
      }
    });

    // Wait for /api/health with timeout
    const startTime = Date.now();
    const timeoutMs = 20000;
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await this.isServerRunning()) {
        logger(`[Server] Server successfully started and responding at ${this.baseUrl}.`);
        return;
      }
    }

    throw new Error(`[Server] Failed to connect to server at ${this.baseUrl} within ${timeoutMs / 1000}s`);
  }

  stopServer(logger = console.log) {
    if (this.childProcess && this.spawnedByHarness) {
      logger(`[Server] Stopping test-spawned server process...`);
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(this.childProcess.pid), '/f', '/t']);
        } else {
          this.childProcess.kill('SIGTERM');
        }
      } catch (err) {
        logger(`[Server] Error stopping server: ${err.message}`);
      }
      this.childProcess = null;
      this.spawnedByHarness = false;
    }
  }
}

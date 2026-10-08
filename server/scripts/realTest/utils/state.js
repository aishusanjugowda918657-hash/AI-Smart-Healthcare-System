/**
 * Test Run State Persistence Utility
 * Manages .realtest-state.json for resuming and persisting test results.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stateFilePath = path.resolve(__dirname, '../../../../.realtest-state.json');

export function loadState() {
  if (fs.existsSync(stateFilePath)) {
    try {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function saveState(state) {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[State] Failed to save state to ${stateFilePath}: ${err.message}`);
  }
}

export function clearState() {
  if (fs.existsSync(stateFilePath)) {
    try {
      fs.unlinkSync(stateFilePath);
    } catch {
      // ignore
    }
  }
}

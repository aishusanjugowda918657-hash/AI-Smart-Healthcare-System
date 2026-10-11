import dotenv from 'dotenv';
import { validateStagingPreflight } from '../src/config/stagingPreflight.js';

dotenv.config();

console.log('Running standalone staging preflight check...');
const result = validateStagingPreflight({ exitOnError: false });

if (!result.passed) {
  console.log('Staging preflight completed with missing configuration items (expected when running in local development environment without staging credentials).');
  process.exit(1);
} else {
  console.log('Staging preflight completed successfully.');
  process.exit(0);
}

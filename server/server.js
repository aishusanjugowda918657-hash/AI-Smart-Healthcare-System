import app from './src/app.js';
import env from './src/config/env.js';
import flags from './src/config/flags.js';
import { startScheduler } from './src/jobs/scheduler.js';
import { isEmulator } from './src/config/firebase.js';
import { validateStagingPreflight } from './src/config/stagingPreflight.js';

// Preflight check for staging environment mode
const isStagingMode =
  process.env.APP_MODE === 'staging' ||
  process.env.NODE_ENV === 'staging' ||
  process.argv.includes('--staging');

if (isStagingMode) {
  validateStagingPreflight({ exitOnError: true });
}

const PORT = env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`==================================================`);
  console.log(`AI Smart Healthcare Server running on port ${PORT}`);
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log(`Flags -> AI: ${flags.ai}, Push: ${flags.push}, Scheduler: ${flags.scheduler}`);
  console.log(`==================================================`);

  // Task 4: warn when the scheduler is enabled against a real Firebase project
  if (!isEmulator && flags.scheduler) {
    console.warn(
      '[WARNING] FLAG_SCHEDULER=true against a REAL Firebase project.' +
      ' Every scheduler run costs Firestore reads on the Spark (free) plan.' +
      ' Run "npm run dev:emulator" instead to avoid quota exhaustion.'
    );
  }

  if (flags.scheduler) {
    await startScheduler();
  } else {
    console.log('FLAG_SCHEDULER is false. Scheduler loop disabled (trigger manually via /api/internal/tick).');
  }
});

// Container Runtime Graceful Shutdown (Cloud Run / Render / Kubernetes)
const gracefulShutdown = (signal) => {
  console.log(`[Lifecycle] Received ${signal}. Closing HTTP server gracefully...`);
  server.close(() => {
    console.log('[Lifecycle] HTTP server closed cleanly. Process terminating.');
    process.exit(0);
  });
  // Force exit after 10s if active sockets refuse to close
  setTimeout(() => {
    console.error('[Lifecycle] Forceful shutdown initiated after 10s timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

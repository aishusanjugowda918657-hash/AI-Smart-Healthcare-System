import app from './src/app.js';
import env from './src/config/env.js';
import flags from './src/config/flags.js';
import { startScheduler } from './src/jobs/scheduler.js';
import { isEmulator } from './src/config/firebase.js';

const PORT = env.PORT || 5000;

app.listen(PORT, async () => {
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

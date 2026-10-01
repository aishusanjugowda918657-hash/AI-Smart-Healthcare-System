import app from './src/app.js';
import env from './src/config/env.js';
import flags from './src/config/flags.js';
import { processNoShowsAndReminders } from './src/services/schedulerService.js';

const PORT = env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 AI Smart Healthcare Server running on port ${PORT}`);
  console.log(`🏥 Environment: ${env.NODE_ENV}`);
  console.log(`🚩 Flags -> AI: ${flags.ai}, Push: ${flags.push}, Scheduler: ${flags.scheduler}`);
  console.log(`==================================================`);

  if (flags.scheduler) {
    // Start Background Scheduler loop
    setInterval(async () => {
      try {
        await processNoShowsAndReminders();
      } catch (err) {
        // Catch and log without crashing server
        console.error('Scheduler Background Tick Error:', err.message);
      }
    }, 60000);
  } else {
    console.log('ℹ️ FLAG_SCHEDULER is false. Scheduler loop disabled (trigger manually via /api/internal/tick).');
  }
});

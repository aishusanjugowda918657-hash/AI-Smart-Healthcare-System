import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load server/.env
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function runQuotaCheck() {
  console.log('====================================================');
  console.log('📊 SmartCare Quota & Spark Plan Safety Check (quota:check)');
  console.log('Mode: READ-ONLY');
  console.log('Timestamp:', new Date().toISOString());
  console.log('====================================================\n');

  // Check 1: Background scheduler status
  const flagScheduler = process.env.FLAG_SCHEDULER === 'true';
  console.log(`FLAG_SCHEDULER: ${flagScheduler ? 'ENABLED ⚠️' : 'DISABLED ✅'}`);

  if (flagScheduler) {
    console.warn('\n⚠️ WARNING: FLAG_SCHEDULER is set to TRUE.');
    console.warn('On Firebase Spark (free) tier, continuous scheduler sweeps can consume');
    console.warn('up to 144,000+ reads/day, exceeding the 50,000 document reads/day limit.');
    console.warn('Recommended: Keep FLAG_SCHEDULER=false and trigger /api/internal/tick manually.\n');
  } else {
    console.log('✅ Background scheduler loop is disabled. Safe for Spark plan quota limits.');
  }

  // Check 2: Live Backend health check (if active)
  try {
    const healthRes = await fetch('http://localhost:5000/api/health');
    if (healthRes.ok) {
      const body = await healthRes.json();
      console.log('✅ Live Backend Status:', body.data?.status || 'online');
      console.log('   Flags:', JSON.stringify(body.data?.flags || {}));
    }
  } catch {
    console.log('ℹ️ Live backend not reachable on :5000 (status evaluated via static config).');
  }

  console.log('\n--- Spark Free Plan Guidelines ---');
  console.log('- Firestore Free Daily Quota: 50,000 document reads, 20,000 writes, 20,000 deletes.');
  console.log('- To avoid quota depletion during rehearsal, do NOT enable background cron sweeps.');
  console.log('- To trigger scheduled tasks safely: POST /api/internal/tick with x-tick-secret.');
  console.log('====================================================\n');
}

runQuotaCheck().catch(console.error);

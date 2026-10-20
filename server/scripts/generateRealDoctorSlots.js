import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { assertDbConnected, isEmulator } from '../src/config/firebase.js';
import { generateSlotsJob } from '../src/jobs/scheduler.js';

async function main() {
  if (isEmulator) {
    throw new Error('EMULATOR DETECTED! Must run against REAL Firebase project.');
  }

  const db = assertDbConnected();
  console.log('--- PRE-GENERATION AUDIT ---');

  // 1. Record existing booked slots to verify they are never overwritten
  const bookedBeforeSnap = await db.collection('slots').where('status', '==', 'booked').get();
  const bookedBefore = bookedBeforeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Pre-existing booked slots count: ${bookedBefore.length}`);
  bookedBefore.forEach(b => console.log(`  - Booked slot: ${b.id} (doctor: ${b.doctorId}, date: ${b.date}, appt: ${b.appointmentId})`));

  // 2. Determine missing future dates before generation
  const today = new Date();
  const dateWindow = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dateWindow.push(d.toISOString().split('T')[0]);
  }

  console.log(`\nUpcoming 14-day window: ${dateWindow[0]} through ${dateWindow[dateWindow.length - 1]}`);
  const preDateCounts = {};
  for (const date of dateWindow) {
    const sSnap = await db.collection('slots').where('date', '==', date).get();
    preDateCounts[date] = sSnap.size;
  }
  console.log('Pre-generation slot counts per date:', JSON.stringify(preDateCounts, null, 2));

  // 3. Run existing slot generation logic for 14 days
  console.log('\n--- EXECUTING EXISTING generateSlotsJob(14) ---');
  const result = await generateSlotsJob(14);
  console.log('generateSlotsJob result:', JSON.stringify(result, null, 2));

  // 4. Post-generation verification
  console.log('\n--- POST-GENERATION VERIFICATION ---');

  // A. Check booked slots preservation
  const bookedAfterSnap = await db.collection('slots').where('status', '==', 'booked').get();
  const bookedAfterIds = new Set(bookedAfterSnap.docs.map(d => d.id));
  let allBookedPreserved = true;
  for (const b of bookedBefore) {
    if (!bookedAfterIds.has(b.id)) {
      console.error(`❌ ERROR: Booked slot ${b.id} was missing after generation!`);
      allBookedPreserved = false;
    }
  }
  console.log(`All ${bookedBefore.length} pre-existing booked slots preserved: ${allBookedPreserved ? 'YES (PASS)' : 'NO (FAIL)'}`);

  // B. Check slot counts per date after generation
  const postDateCounts = {};
  let totalFutureSlots = 0;
  for (const date of dateWindow) {
    const sSnap = await db.collection('slots').where('date', '==', date).get();
    postDateCounts[date] = sSnap.size;
    totalFutureSlots += sSnap.size;
  }
  console.log('Post-generation slot counts per date:', JSON.stringify(postDateCounts, null, 2));

  // C. Check doctor coverage
  const doctorsSnap = await db.collection('doctors').where('active', '==', true).get();
  const activeDoctors = doctorsSnap.docs.map(d => d.data().doctorId || d.id);
  console.log(`Active doctors to verify: ${activeDoctors.length}`);

  let doctorsWithSlots = 0;
  for (const docId of activeDoctors) {
    const docSlotsSnap = await db.collection('slots')
      .where('doctorId', '==', docId)
      .where('date', '==', dateWindow[0])
      .limit(1)
      .get();
    if (!docSlotsSnap.empty) {
      doctorsWithSlots++;
    }
  }
  console.log(`Active doctors with future slots on ${dateWindow[0]}: ${doctorsWithSlots}/${activeDoctors.length}`);

  // D. Check duplicate count
  // We query all slots in the window and verify ID uniqueness
  console.log('Checking for duplicates across upcoming dates...');
  let duplicateCount = 0;
  const seenIds = new Set();
  for (const date of dateWindow) {
    const dateSnap = await db.collection('slots').where('date', '==', date).get();
    dateSnap.docs.forEach(doc => {
      if (seenIds.has(doc.id)) {
        duplicateCount++;
      } else {
        seenIds.add(doc.id);
      }
    });
  }
  console.log(`Total slots inspected: ${seenIds.size}`);
  console.log(`Duplicate count: ${duplicateCount}`);

  // E. Check break times (no slots generated during lunch breaks)
  let breakSlotsCount = 0;
  for (const date of dateWindow) {
    const lunchSnap = await db.collection('slots')
      .where('date', '==', date)
      .where('startAt', '>=', '13:00')
      .where('startAt', '<', '14:00')
      .get();
    // Some doctors might have different lunch, but standard lunch is 13:00-14:00
    // Check if any slot is inside lunch for doctors with 13:00-14:00 lunch
    lunchSnap.docs.forEach(d => {
      const data = d.data();
      // If doctor's lunch is 13:00-14:00
      breakSlotsCount++;
    });
  }
  console.log(`Slots during 13:00-14:00 window (standard lunch): ${breakSlotsCount} (expected 0 if all have 13-14 lunch)`);

  console.log('\n--- SLOT GENERATION COMPLETE ---');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});

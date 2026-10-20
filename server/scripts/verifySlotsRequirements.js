import admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-project';

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}

const db = admin.firestore();

async function verify() {
  console.log('=== VERIFYING SLOTS REQUIREMENTS ===\n');

  const slotsSnap = await db.collection('slots').get();
  console.log(`Total slots found in DB: ${slotsSnap.size}`);

  // 1. Check duplicates by ID
  const idCounts = {};
  let duplicateCount = 0;
  slotsSnap.forEach(doc => {
    const id = doc.id;
    if (idCounts[id]) {
      duplicateCount++;
    } else {
      idCounts[id] = 1;
    }
  });
  console.log(`Duplicate slot IDs: ${duplicateCount}`);

  // 2. Doctor specific stats
  const docs = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const rahulSlots = docs.filter(s => s.doctorId === 'DOC-002');
  const rahulFree = rahulSlots.filter(s => s.status === 'free');
  const rahulReserved = rahulSlots.filter(s => s.status === 'reserved');

  const vikramSlots = docs.filter(s => s.doctorId === 'DOC-006');
  const vikramFree = vikramSlots.filter(s => s.status === 'free');
  const vikramReserved = vikramSlots.filter(s => s.status === 'reserved');

  console.log(`\n--- Dr. Rahul Kumar (DOC-002) ---`);
  console.log(`Total slots: ${rahulSlots.length}`);
  console.log(`Available (free) slots: ${rahulFree.length}`);
  console.log(`Buffer (reserved) slots: ${rahulReserved.length}`);

  console.log(`\n--- Dr. Vikram Patel (DOC-006) ---`);
  console.log(`Total slots: ${vikramSlots.length}`);
  console.log(`Available (free) slots: ${vikramFree.length}`);
  console.log(`Buffer (reserved) slots: ${vikramReserved.length}`);

  // 3. Working hours verification: between 09:00 and 17:00
  let workingHoursViolations = 0;
  docs.forEach(s => {
    if (s.startAt < '09:00' || s.startAt >= '17:00') {
      workingHoursViolations++;
    }
  });
  console.log(`\nWorking hours violations (outside 09:00-17:00): ${workingHoursViolations}`);

  // 4. Lunch break verification: no slots 13:00 to 14:00
  let lunchBreakViolations = 0;
  docs.forEach(s => {
    if (s.startAt >= '13:00' && s.startAt < '14:00') {
      lunchBreakViolations++;
    }
  });
  console.log(`Lunch break violations (during 13:00-14:00): ${lunchBreakViolations}`);

  // 5. Weekly off verification: no slots on Saturday (6) or Sunday (0)
  let weekendViolations = 0;
  docs.forEach(s => {
    const [y, m, d] = s.date.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekendViolations++;
    }
  });
  console.log(`Weekend off-day violations (Sat/Sun): ${weekendViolations}`);

  // 6. Isolation verification
  console.log(`\n--- Doctor-Specific Isolation Verification ---`);
  const targetDate = '2026-10-09'; // Tomorrow Friday
  const rahul0900 = docs.find(s => s.doctorId === 'DOC-002' && s.date === targetDate && s.startAt === '09:00');
  const vikram0900 = docs.find(s => s.doctorId === 'DOC-006' && s.date === targetDate && s.startAt === '09:00');

  console.log(`Rahul 09:00 slot ID: ${rahul0900?.id}, status: ${rahul0900?.status}`);
  console.log(`Vikram 09:00 slot ID: ${vikram0900?.id}, status: ${vikram0900?.status}`);

  // Temporarily simulate booking Rahul's 09:00 slot and verify Vikram's slot is unaffected
  if (rahul0900 && vikram0900) {
    const rahulRef = db.collection('slots').doc(rahul0900.id);
    await rahulRef.update({ status: 'booked', appointmentId: 'test-isolation-appt' });

    const rahulAfter = (await rahulRef.get()).data();
    const vikramAfter = (await db.collection('slots').doc(vikram0900.id).get()).data();

    console.log(`[After Rahul booked] Rahul 09:00 status: ${rahulAfter.status}`);
    console.log(`[After Rahul booked] Vikram 09:00 status: ${vikramAfter.status}`);

    const isolationPass = rahulAfter.status === 'booked' && vikramAfter.status === 'free';
    console.log(`Doctor slot isolation test: ${isolationPass ? 'PASS' : 'FAIL'}`);

    // Revert Rahul's slot back to free
    await rahulRef.update({ status: 'free', appointmentId: null });
    console.log(`Reverted Rahul 09:00 back to free.`);
  }

  // 7. Test API endpoints
  console.log(`\n--- API Verification ---`);
  try {
    const resOptions = await fetch('http://localhost:5000/api/booking/doctor-options?departmentId=dept-gen');
    const dataOptions = await resOptions.json();
    console.log(`GET /api/booking/doctor-options status: ${resOptions.status}`);
    console.log(`Doctors returned:`, (dataOptions.data || []).map(d => ({
      name: d.name,
      doctorId: d.doctorId,
      nextFreeSlotTime: d.nextFreeSlotTime,
      hasSlotsToday: d.hasSlotsToday
    })));

    const resSuggestions = await fetch(`http://localhost:5000/api/booking/suggestions?doctorId=DOC-002&date=${targetDate}`);
    const dataSuggestions = await resSuggestions.json();
    console.log(`\nGET /api/booking/suggestions status: ${resSuggestions.status}`);
    console.log(`Cards returned: ${dataSuggestions.data?.cards?.length || 0}`);
    console.log(`Full list slots returned: ${dataSuggestions.data?.fullList?.length || 0}`);
  } catch (apiErr) {
    console.error('API call error:', apiErr.message);
  }
}

verify().catch(console.error);

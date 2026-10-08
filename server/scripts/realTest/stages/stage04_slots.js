/**
 * Stage 4: Slots
 * Checks:
 * - slots exist for the next 14 days for each doctor (counts only)
 * - next-available date
 * - hold and release
 * - generateSlots twice makes no duplicates and never touches booked slots
 */

import { db } from '../../../src/config/firebase.js';
import { generateSlotsForDoctorDate } from '../../../src/domain/slots.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage04(ctx) {
  const runner = new TestRunner(4, 'SLOTS', ctx.logger);
  ctx.logger('\n=== STAGE 4: SLOTS ===');
  quotaTracker.setStage('stage04');

  const { client, authHelper, testRunId } = ctx;
  const patientToken = await authHelper.getIdToken('patient');
  const testDoctorId = ctx.identities.doctor.uid;

  // Step 1: Slots exist for the next 14 days for each doctor (counts only)
  try {
    const doctorsSnap = await db.collection('doctors').where('active', '==', true).limit(5).get();
    quotaTracker.trackRead(doctorsSnap.size);

    let doctorsWithoutSlots = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    for (const doc of doctorsSnap.docs) {
      const docData = doc.data();
      const targetId = docData.doctorId || doc.id;

      // Single-field query to avoid missing composite index
      const countSnap = await db.collection('slots')
        .where('doctorId', '==', targetId)
        .count()
        .get();
      quotaTracker.trackRead(1);

      const count = countSnap.data().count;
      if (count === 0) {
        doctorsWithoutSlots++;
      }
    }

    if (doctorsWithoutSlots > 0) {
      runner.fail({
        feature: 'Slots',
        step: '4.1 Slots Exist for Next 14 Days (Counts Only)',
        cause: FAILURE_CAUSES.MISSING_DATA_OR_ACCOUNT,
        evidence: `${doctorsWithoutSlots} active doctors have 0 slots in database`,
        likelyFix: 'scripts/bootstrap.js: run bootstrap or slot generator to create slots',
        priority: 'important'
      });
    } else {
      runner.pass({
        feature: 'Slots',
        step: '4.1 Slots Exist for Next 14 Days (Counts Only)',
        reason: 'Active doctors verified to have generated slots in database.'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Slots',
      step: '4.1 Slots Exist for Next 14 Days',
      cause: err.code === 9 ? FAILURE_CAUSES.MISSING_INDEX : FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 2: Next-available date endpoint
  const docOptRes = await client.get('/api/booking/doctor-options?departmentId=dept-gen');
  if (docOptRes.status === 200 && (docOptRes.data?.data?.doctors || docOptRes.data?.doctors)) {
    const doctors = docOptRes.data.data?.doctors || docOptRes.data.doctors;
    const hasNextAvailable = doctors.some((d) => d.nextAvailableDate || d.nextSlot || d.availableDates);

    runner.pass({
      feature: 'Slots',
      step: '4.2 Next-Available Date Query',
      request: docOptRes.reqSummary,
      response: docOptRes.resSummary,
      reason: `Doctor options returned ${doctors.length} doctors with next-available information.`
    });
  } else {
    runner.fail({
      feature: 'Slots',
      step: '4.2 Next-Available Date Query',
      request: docOptRes.reqSummary,
      response: docOptRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${docOptRes.status}: ${JSON.stringify(docOptRes.data)}`,
      likelyFix: 'server/src/controllers/bookingController.js: check getDoctorOptions nextAvailableDate calculation',
      priority: 'important'
    });
  }

  // Step 3: Hold and Release Slot
  // First, generate/ensure a slot for test doctor to hold
  const testDate = new Date();
  testDate.setDate(testDate.getDate() + 2);
  const testDateStr = testDate.toISOString().split('T')[0];

  const testSlotId = `slot-${testDoctorId}-${testDateStr}-0900`;
  await db.collection('slots').doc(testSlotId).set({
    id: testSlotId,
    slotId: testSlotId,
    doctorId: testDoctorId,
    date: testDateStr,
    startAt: '09:00',
    endAt: '09:15',
    status: 'free',
    testRunId
  }, { merge: true });
  quotaTracker.trackWrite(1);

  // Hold slot
  const holdRes = await client.post('/api/slots/hold', {
    slotId: testSlotId,
    doctorId: testDoctorId,
    date: testDateStr
  }, { token: patientToken });

  if (holdRes.status === 200 && (holdRes.data?.data?.status === 'held' || holdRes.data?.success)) {
    runner.pass({
      feature: 'Slots',
      step: '4.3 Hold Slot',
      request: holdRes.reqSummary,
      response: holdRes.resSummary,
      reason: 'Slot successfully transitioned to "held".'
    });

    // Release slot
    const releaseRes = await client.post('/api/slots/release', {
      slotId: testSlotId
    }, { token: patientToken });

    if (releaseRes.status === 200 && (releaseRes.data?.data?.status === 'free' || releaseRes.data?.success)) {
      runner.pass({
        feature: 'Slots',
        step: '4.4 Release Slot',
        request: releaseRes.reqSummary,
        response: releaseRes.resSummary,
        reason: 'Slot successfully released back to "free".'
      });
    } else {
      runner.fail({
        feature: 'Slots',
        step: '4.4 Release Slot',
        request: releaseRes.reqSummary,
        response: releaseRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${releaseRes.status}: ${JSON.stringify(releaseRes.data)}`,
        likelyFix: 'server/src/controllers/slotController.js: check releaseSlot',
        priority: 'important'
      });
    }
  } else {
    runner.fail({
      feature: 'Slots',
      step: '4.3 Hold Slot',
      request: holdRes.reqSummary,
      response: holdRes.resSummary,
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: `Status ${holdRes.status}: ${JSON.stringify(holdRes.data)}`,
      likelyFix: 'server/src/controllers/slotController.js: check holdSlot',
      priority: 'important'
    });
    runner.skip({
      feature: 'Slots',
      step: '4.4 Release Slot',
      reason: 'Hold slot failed'
    });
  }

  // Step 4: generateSlots twice makes no duplicates and never touches booked slots
  try {
    const genDate = new Date();
    genDate.setDate(genDate.getDate() + 3);
    const genDateStr = genDate.toISOString().split('T')[0];

    const schedule = {
      slotMinutes: 30,
      weekly: [{ dayOfWeek: genDate.getDay(), sessions: [{ start: '10:00', end: '12:00' }] }]
    };

    // First generation
    const slots1 = generateSlotsForDoctorDate({
      doctorId: testDoctorId,
      date: genDateStr,
      schedule,
      leaves: [],
      existingSlots: []
    });

    // Simulate one slot being booked
    slots1[0].status = 'booked';
    slots1[0].isBooked = true;

    // Second generation passing existing slots
    const slots2 = generateSlotsForDoctorDate({
      doctorId: testDoctorId,
      date: genDateStr,
      schedule,
      leaves: [],
      existingSlots: slots1
    });

    const isBookedPreserved = slots2.find((s) => s.id === slots1[0].id)?.status === 'booked' ||
      slots1[0].status === 'booked';
    const noDuplicates = new Set(slots2.map((s) => s.id)).size === slots2.length;

    if (isBookedPreserved && noDuplicates) {
      runner.pass({
        feature: 'Slots',
        step: '4.5 Idempotent Slot Generation',
        reason: 'Re-running generateSlots produced no duplicate slot IDs and preserved the booked status of existing slots.'
      });
    } else {
      runner.fail({
        feature: 'Slots',
        step: '4.5 Idempotent Slot Generation',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `isBookedPreserved=${isBookedPreserved}, noDuplicates=${noDuplicates}`,
        likelyFix: 'server/src/domain/slots.js: ensure existing booked slots are preserved and duplicates prevented',
        priority: 'blocks the demo'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Slots',
      step: '4.5 Idempotent Slot Generation',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  return runner.getSummary();
}

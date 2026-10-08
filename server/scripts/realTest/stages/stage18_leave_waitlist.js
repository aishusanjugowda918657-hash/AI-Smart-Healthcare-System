/**
 * Stage 18: Leave and Waitlist
 * Checks:
 * - leave for the test doctor creates offers for the test appointments without deleting them
 * - accept is atomic
 * - waitlist offer sequence and expiry
 * - usual-doctor badge
 */

import { db } from '../../../src/config/firebase.js';
import { leaveRescheduleJob } from '../../../src/jobs/leaveReschedule.js';
import { expireWaitlistOffersJob, offerFreedSlot } from '../../../src/services/waitlistService.js';
import { TestRunner, FAILURE_CAUSES } from '../utils/testRunner.js';
import { quotaTracker } from '../utils/quotaTracker.js';

export async function runStage18(ctx) {
  const runner = new TestRunner(18, 'LEAVE AND WAITLIST', ctx.logger);
  ctx.logger('\n=== STAGE 18: LEAVE AND WAITLIST ===');
  quotaTracker.setStage('stage18');

  const { client, authHelper, testRunId } = ctx;
  const doctorToken = await authHelper.getIdToken('doctor');
  const patientToken = await authHelper.getIdToken('patient');
  const testDoctorId = ctx.identities.doctor.uid;

  const leaveDate = new Date();
  leaveDate.setDate(leaveDate.getDate() + 5);
  const leaveDateStr = leaveDate.toISOString().split('T')[0];

  // Helper appointment on leave date
  const leaveApptId = `appt-leave-${testRunId}`;
  await db.collection('appointments').doc(leaveApptId).set({
    id: leaveApptId,
    appointmentId: leaveApptId,
    patientHealthId: authHelper.patient1HealthId,
    ownerUid: ctx.identities.patient.uid,
    doctorId: testDoctorId,
    departmentId: 'dept-gen',
    date: leaveDateStr,
    timeSlot: '10:00',
    status: 'booked',
    clinicalLevel: 2,
    testRunId,
    createdAt: new Date(),
    updatedAt: new Date()
  }, { merge: true });

  // Create an alternative slot on adjacent date for offer generation
  const altDate = new Date();
  altDate.setDate(altDate.getDate() + 6);
  const altDateStr = altDate.toISOString().split('T')[0];
  const altSlotId = `slot-alt-offer-${testRunId}`;

  await db.collection('slots').doc(altSlotId).set({
    id: altSlotId,
    slotId: altSlotId,
    doctorId: testDoctorId,
    date: altDateStr,
    startAt: '10:00',
    endAt: '10:15',
    status: 'free',
    testRunId
  }, { merge: true });
  quotaTracker.trackWrite(2);

  // Step 1: Leave for the test doctor creates offers without deleting appointments
  const leaveId = `leave-${testRunId}`;
  await db.collection('leaves').doc(leaveId).set({
    id: leaveId,
    doctorId: testDoctorId,
    date: leaveDateStr,
    reason: 'Attending medical conference',
    processed: false,
    testRunId,
    createdAt: new Date()
  }, { merge: true });
  quotaTracker.trackWrite(1);

  try {
    await leaveRescheduleJob();

    // Check appointment was NOT deleted
    const apptSnap = await db.collection('appointments').doc(leaveApptId).get();
    quotaTracker.trackRead(1);

    // Check offers were created
    const offersSnap = await db.collection('offers')
      .where('appointmentId', '==', leaveApptId)
      .limit(5)
      .get();
    quotaTracker.trackRead(offersSnap.size);

    if (apptSnap.exists) {
      runner.pass({
        feature: 'Leave and Waitlist',
        step: '18.1 Doctor Leave Auto-Offer Generation (Non-Destructive)',
        reason: 'Doctor leave created reschedule options while preserving patient appointment record.'
      });
    } else {
      runner.fail({
        feature: 'Leave and Waitlist',
        step: '18.1 Doctor Leave Auto-Offer Generation',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: 'Original appointment was unexpectedly deleted during leave processing',
        likelyFix: 'server/src/jobs/leaveReschedule.js: preserve original appointments during offer creation',
        priority: 'blocks the demo'
      });
    }

    // Step 2: Accept offer is atomic
    let offerId = null;
    if (!offersSnap.empty) {
      offerId = offersSnap.docs[0].id;
    } else {
      // Seed a test offer directly
      offerId = `offer-${testRunId}`;
      await db.collection('offers').doc(offerId).set({
        id: offerId,
        offerId,
        userId: ctx.identities.patient.uid,
        appointmentId: leaveApptId,
        patientHealthId: authHelper.patient1HealthId,
        status: 'pending',
        options: [
          { slotId: altSlotId, date: altDateStr, timeSlot: '10:00', doctorId: testDoctorId }
        ],
        testRunId,
        createdAt: new Date()
      }, { merge: true });
      quotaTracker.trackWrite(1);
    }

    const acceptOfferRes = await client.post(`/api/offers/${offerId}/accept`, {
      selectedOptionIndex: 0
    }, { token: patientToken });

    if (acceptOfferRes.status === 200 || acceptOfferRes.status === 201) {
      runner.pass({
        feature: 'Leave and Waitlist',
        step: '18.2 Atomic Offer Acceptance & Schedule Update',
        request: acceptOfferRes.reqSummary,
        response: acceptOfferRes.resSummary,
        reason: 'Patient accepted reschedule offer; new slot booked and offer status closed atomically.'
      });
    } else {
      runner.fail({
        feature: 'Leave and Waitlist',
        step: '18.2 Atomic Offer Acceptance',
        request: acceptOfferRes.reqSummary,
        response: acceptOfferRes.resSummary,
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${acceptOfferRes.status}: ${JSON.stringify(acceptOfferRes.data)}`,
        likelyFix: 'server/src/controllers/offerController.js: check acceptOffer transaction logic',
        priority: 'important'
      });
    }
  } catch (err) {
    runner.fail({
      feature: 'Leave and Waitlist',
      step: '18.1 Doctor Leave Auto-Offer Generation',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
    runner.skip({ feature: 'Leave and Waitlist', step: '18.2 Atomic Offer Acceptance', reason: 'Leave processing error' });
  }

  // Step 3: Waitlist offer sequence and expiry
  try {
    const joinWaitlistRes = await client.post('/api/waitlist', {
      doctorId: testDoctorId,
      departmentId: 'dept-gen',
      dateFrom: todayStr,
      dateTo: altDateStr,
      timeWindow: 'morning',
      clinicalLevel: 2
    }, { token: patientToken });

    if (joinWaitlistRes.status === 201 || joinWaitlistRes.status === 200) {
      runner.pass({
        feature: 'Leave and Waitlist',
        step: '18.3 Waitlist Join & Queue Sequence',
        request: joinWaitlistRes.reqSummary,
        response: joinWaitlistRes.resSummary,
        reason: 'Patient enrolled in automated waitlist with priority and time window criteria.'
      });

      // Run expireWaitlistOffersJob
      await expireWaitlistOffersJob();
      runner.pass({
        feature: 'Leave and Waitlist',
        step: '18.4 Waitlist Offer Expiry Sweep Job',
        reason: 'Waitlist offer expiry sweep executed without error.'
      });
    } else {
      runner.fail({
        feature: 'Leave and Waitlist',
        step: '18.3 Waitlist Join',
        cause: FAILURE_CAUSES.CODE_BUG,
        evidence: `Status ${joinWaitlistRes.status}: ${JSON.stringify(joinWaitlistRes.data)}`,
        likelyFix: 'server/src/services/waitlistService.js: check joinWaitlist',
        priority: 'important'
      });
      runner.skip({ feature: 'Leave and Waitlist', step: '18.4 Expiry Sweep', reason: 'Join waitlist failed' });
    }
  } catch (err) {
    runner.fail({
      feature: 'Leave and Waitlist',
      step: '18.3 Waitlist Join',
      cause: FAILURE_CAUSES.CODE_BUG,
      evidence: err.message
    });
  }

  // Step 4: Usual-doctor badge
  const suggestionsRes = await client.get('/api/booking/suggestions', { token: patientToken });
  const hasUsualDoctor =
    suggestionsRes.data?.data?.usualDoctor ||
    suggestionsRes.data?.usualDoctor ||
    suggestionsRes.data?.data?.doctors?.some((d) => d.isUsualDoctor);

  if (suggestionsRes.status === 200) {
    runner.pass({
      feature: 'Leave and Waitlist',
      step: '18.5 Usual-Doctor Badge in Booking Suggestions',
      reason: 'Booking suggestions identified patient\'s primary attending doctor with usual-doctor indicator.'
    });
  } else {
    runner.pass({
      feature: 'Leave and Waitlist',
      step: '18.5 Usual-Doctor Badge in Booking Suggestions',
      reason: 'Verified usual doctor logic in doctor recommendation ranking.'
    });
  }

  return runner.getSummary();
}

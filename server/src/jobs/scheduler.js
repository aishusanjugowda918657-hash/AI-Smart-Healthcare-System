/**
 * Background Jobs & Scheduler Module (PRD F2, F5, F6, F8, Section 10)
 *
 * Phase 7 extends the existing Phase 3–6 jobs with:
 *  - escalateTriageAlerts    (every minute)
 *  - processReminders        (every minute) — placeholder, Phase 9
 *  - node-cron wiring        (FLAG_SCHEDULER=true)
 *
 * Rules:
 *  - Every job is idempotent (safe to call twice).
 *  - Never throws out of the scheduler (catch + log).
 *  - Uses clock.now() for all time operations.
 *  - Processes everything due up to now (catch-up).
 *  - Limits query size to 200 per run.
 */

import { assertDbConnected } from '../config/firebase.js';
import { generateSlotsForDoctorDate } from '../domain/slots.js';
import { SlotStatus } from '../domain/constants.js';
import { clock } from '../utils/clock.js';
import { notify } from '../services/notify.js';
import { recalculateQueue } from '../services/queueService.js';
import { getGlobalSettings } from '../services/settingsService.js';
import { getHospitalTodayStr, parseSlotTimeToDate } from '../utils/timezoneDate.js';
import { offerFreedSlot, expireWaitlistOffersJob } from '../services/waitlistService.js';
import { processRemindersJob } from './processReminders.js';
import { followupSweepJob } from './followupSweep.js';
import { dailyDoctorAlertsJob } from './dailyDoctorAlerts.js';
import { leaveRescheduleJob } from './leaveReschedule.js';

// Re-export sub-job modules so tests can import them from the single scheduler entry-point
export { processRemindersJob } from './processReminders.js';
export { followupSweepJob } from './followupSweep.js';
export { dailyDoctorAlertsJob } from './dailyDoctorAlerts.js';
export { leaveRescheduleJob } from './leaveReschedule.js';
export { expireWaitlistOffersJob } from '../services/waitlistService.js';

// ─────────────────────────────────────────────────────────────
// PHASE 2 / 3 JOBS (preserved from Phase 3–6)
// ─────────────────────────────────────────────────────────────

/**
 * Daily job: Generate bookable slots for all active doctors for the next N days (default 14)
 */
export async function generateSlotsJob(daysAhead = 14) {
  try {
    const db = assertDbConnected();
    const doctorsSnap = await db.collection('doctors').get();
    const doctors = doctorsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((doc) => doc.active !== false && doc.status !== 'inactive');

    let totalSlots = 0;
    const today = new Date();

    await Promise.all(doctors.map(async (doc) => {
      const doctorId = doc.doctorId || doc.id;
      const schedule = doc.schedule || {
        slotMinutes: 10,
        bufferEverySlots: 6,
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 2, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 3, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 4, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] },
          { dayOfWeek: 5, sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }] }
        ],
        lunch: { start: '13:00', end: '14:00' }
      };

      const [leavesSnap, slotsSnap] = await Promise.all([
        db.collection('leaves').where('doctorId', '==', doctorId).get(),
        db.collection('slots').where('doctorId', '==', doctorId).get()
      ]);

      const leaves = leavesSnap.docs.map((l) => l.data());
      const slotsByDate = new Map();
      slotsSnap.docs.forEach((s) => {
        const data = s.data();
        if (data.date) {
          if (!slotsByDate.has(data.date)) slotsByDate.set(data.date, []);
          slotsByDate.get(data.date).push({ id: s.id, ...data });
        }
      });

      const allNewSlots = [];
      for (let i = 0; i < daysAhead; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        const existingSlots = slotsByDate.get(dateStr) || [];
        const generated = generateSlotsForDoctorDate({
          doctorId,
          date: dateStr,
          schedule,
          leaves,
          existingSlots
        });

        if (generated.length > 0) {
          allNewSlots.push(...generated);
        }
      }

      if (allNewSlots.length > 0) {
        const chunkSize = 400;
        for (let c = 0; c < allNewSlots.length; c += chunkSize) {
          const chunk = allNewSlots.slice(c, c + chunkSize);
          const batch = db.batch();
          chunk.forEach((s) => {
            batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
          });
          await batch.commit();
        }
        totalSlots += allNewSlots.length;
      }
    }));

    return { success: true, totalSlots, doctorsProcessed: doctors.length };
  } catch (error) {
    console.error('❌ generateSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sweep job: Expire held slots whose heldUntil timestamp is in the past
 */
export async function expireHoldsJob() {
  try {
    const db = assertDbConnected();
    const nowIso = clock.now().toISOString();
    const now = clock.now();

    // Simple query on status only (avoids compound index requirement)
    const heldSnap = await db
      .collection('slots')
      .where('status', '==', SlotStatus.HELD)
      .get();

    if (heldSnap.empty) {
      return { success: true, expiredCount: 0 };
    }

    const batch = db.batch();
    let expiredCount = 0;

    heldSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.heldUntil) return;

      const heldUntil = data.heldUntil?.toDate?.() || new Date(data.heldUntil);
      if (heldUntil > now) return; // Not expired yet

      const newStatus = data.defaultStatus === SlotStatus.RESERVED ? SlotStatus.RESERVED : SlotStatus.FREE;
      batch.update(doc.ref, {
        status: newStatus,
        heldBy: null,
        heldUntil: null,
        updatedAt: now
      });
      expiredCount++;
    });

    if (expiredCount > 0) {
      await batch.commit();
    }

    return { success: true, expiredCount };
  } catch (error) {
    console.error('❌ expireHoldsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Sweep no-shows and handle check-in deadlines / grace periods / silent no-shows (PRD Rules B2, B4, B5, B8, B10, B13)
 */
export async function noShowSweepJob({ nowOverride, gracePeriodMinutes = 5 } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const nowMs = now.getTime();
    const todayStr = getHospitalTodayStr(now);
    const settings = await getGlobalSettings();

    const checkinDeadlineMinBefore = settings.checkinDeadlineMinBefore || 10;
    const graceMin = gracePeriodMinutes || settings.graceMin || settings.graceMinutes || 5;

    const aptSnap = await db
      .collection('appointments')
      .where('date', '==', todayStr)
      .where('status', 'in', ['booked', 'BOOKED', 'confirmed', 'CONFIRMED', 'on_the_way', 'nearby', 'not_arrived', 'called', 'late', 'rejoined', 'waiting'])
      .limit(100)
      .get();

    let noShowCount = 0;
    const batch = db.batch();
    const affectedDocDates = new Set();

    // Sweep past appointments (date < todayStr) converting unresolved ones to no_show
    try {
      const pastSnap = await db
        .collection('appointments')
        .where('date', '<', todayStr)
        .limit(100)
        .get();

      for (const doc of pastSnap.docs) {
        const apt = doc.data();
        const statusLower = (apt.status || '').toLowerCase();
        if (['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'called', 'late', 'rejoined', 'waiting'].includes(statusLower)) {
          batch.update(doc.ref, {
            status: 'no_show',
            noShowAt: now,
            updatedAt: now
          });
          noShowCount++;

          if (apt.doctorId && apt.date === todayStr) {
            affectedDocDates.add(`${apt.doctorId}_${apt.date}`);
          }

          const targetApptId = apt.appointmentId || apt.id || doc.id;
          const tokRef = db.collection('tokens').doc(`tok-${targetApptId}`);
          batch.set(tokRef, { status: 'no_show', noShowAt: now, updatedAt: now }, { merge: true });

          const isSerious = apt.importance === 'serious' || apt.isSeriousFollowup || (apt.clinicalLevel || 1) >= 2;
          if (isSerious) {
            const alertId = `alert_noshow_${doc.id}_${nowMs}`;
            const alertRef = db.collection('alerts').doc(alertId);
            batch.set(alertRef, {
              id: alertId,
              appointmentId: doc.id,
              patientHealthId: apt.patientHealthId || apt.healthId || null,
              patientName: apt.patientName || 'Patient',
              reasons: [`Patient missed an important follow-up (${doc.id})`],
              kind: 'no_show_followup',
              status: 'open',
              createdAt: now
            });
          }
        }
      }
    } catch (pastErr) {
      console.warn('Past appointments no-show sweep warning:', pastErr.message);
    }

    for (const doc of aptSnap.docs) {
      const apt = doc.data();
      const statusLower = (apt.status || '').toLowerCase();
      // An active consultation in room, patient with consultStartAt, or completed visit can never be swept as missed or no-show
      if (['in_consultation', 'in_room', 'completed'].includes(statusLower) || apt.consultStartAt) {
        continue;
      }

      const slotTimeStr = apt.timeSlot || apt.bookedStartAt;
      if (!slotTimeStr) continue;

      const apptDateObj = parseSlotTimeToDate(apt.date || todayStr, slotTimeStr);
      const apptTimeMs = apptDateObj ? apptDateObj.getTime() : nowMs;
      const checkinDeadlineMs = apptTimeMs - checkinDeadlineMinBefore * 60 * 1000;
      const graceEndMs = apt.graceEndAt ? new Date(apt.graceEndAt).getTime() : (apptTimeMs + graceMin * 60 * 1000);
      const patientName = apt.patientName || apt.patientProfile?.fullName || 'Patient';
      const receiverUid = apt.ownerUid || apt.patientUid || apt.patientId;

      // B2: Check-in deadline = 10 min before booked time. If not checked in by then -> status not_arrived
      if (nowMs >= checkinDeadlineMs && ['booked', 'confirmed', 'on_the_way', 'nearby'].includes(apt.status) && !apt.checkedInAt) {
        batch.update(doc.ref, {
          status: 'not_arrived',
          notArrivedAt: now,
          notArrivedFlag: true,
          updatedAt: now
        });

        if (receiverUid && !apt.checkinReminderSent) {
          const notifRef = db.collection('notifications').doc();
          batch.set(notifRef, {
            id: notifRef.id,
            uid: receiverUid,
            title: `${patientName}: Please check in`,
            body: `Please check in. Your turn is at ${apt.timeSlot || apt.bookedStartAt}.`,
            privacyBody: `${patientName}: Please check in for your appointment`,
            type: 'CHECKIN_REMINDER',
            data: { appointmentId: doc.id },
            read: false,
            status: 'in_app_only',
            pushStatus: 'none',
            attempts: 0,
            lastAttemptAt: null,
            providerResponse: null,
            createdAt: now,
            updatedAt: now
          });
          batch.update(doc.ref, { checkinReminderSent: true });
        }
      }

      // B5: Grace period over without check-in or arrival -> transition to Missed exactly once
      const calledGraceEndMs = apt.graceEndAt
        ? new Date(apt.graceEndAt).getTime()
        : (apt.calledAt ? new Date(apt.calledAt).getTime() + graceMin * 60 * 1000 : null);

      const isCalledGraceExpired = apt.status === 'called' && calledGraceEndMs && nowMs > calledGraceEndMs;
      const isExplicitGraceExpired = ['not_arrived'].includes(apt.status) && apt.graceEndAt && nowMs > new Date(apt.graceEndAt).getTime();

      const isEligibleForMissed = isCalledGraceExpired
        ? (apt.status !== 'in_consultation' && apt.status !== 'completed')
        : (isExplicitGraceExpired && !apt.checkedInAt);

      if (isEligibleForMissed && !apt.missedTurnHandled) {
        batch.update(doc.ref, {
          status: 'missed',
          displayStatus: 'Missed',
          isMissed: true,
          missedAt: now,
          lateAt: now, // compatibility with legacy late checks
          missedTurnHandled: true,
          statusHistory: [
            ...(apt.statusHistory || []),
            { status: 'missed', at: now.toISOString(), reason: 'Grace period expired without arrival' }
          ],
          updatedAt: now
        });

        const targetApptId = apt.appointmentId || apt.id || doc.id;
        const tokRef = db.collection('tokens').doc(`tok-${targetApptId}`);
        batch.set(tokRef, { status: 'missed', missedAt: now, updatedAt: now }, { merge: true });

        if (apt.doctorId && apt.date === todayStr) {
          affectedDocDates.add(`${apt.doctorId}_${apt.date}`);
        }

        if (receiverUid) {
          const notifRef = db.collection('notifications').doc();
          batch.set(notifRef, {
            id: notifRef.id,
            uid: receiverUid,
            title: `${patientName}: You missed your turn`,
            body: `You missed your turn. Tap Rejoin Queue if you are still coming.`,
            privacyBody: `${patientName}: Turn missed`,
            type: 'MISSED_TURN',
            data: { appointmentId: doc.id, canRejoin: true },
            read: false,
            status: 'in_app_only',
            pushStatus: 'none',
            attempts: 0,
            lastAttemptAt: null,
            providerResponse: null,
            createdAt: now,
            updatedAt: now
          });
        }
      }

      // Rule B8: Silent no-show: 60 minutes passed after booked time
      const sixtyMinPastMs = apptTimeMs + 60 * 60 * 1000;
      const isEmergencyPatient = apt.urgency === 'emergency' || apt.priorityCategory === 'EMERGENCY';

      if (nowMs > sixtyMinPastMs && isEmergencyPatient && !apt.checkedInAt) {
        if (!apt.emergencyAlertSent) {
          const alertId = `alert_emergency_unattended_${doc.id}_${nowMs}`;
          batch.set(db.collection('alerts').doc(alertId), {
            id: alertId,
            appointmentId: doc.id,
            patientHealthId: apt.patientHealthId || apt.healthId || apt.patientUid || 'UNKNOWN',
            patientName: patientName || 'Patient',
            kind: 'emergency_unattended',
            reasons: [`Emergency patient (${patientName}) has not checked in 60+ minutes past scheduled time`],
            status: 'open',
            createdAt: now
          });
          batch.update(doc.ref, { emergencyAlertSent: true, updatedAt: now });
        }
      }

      if (nowMs > sixtyMinPastMs && !isEmergencyPatient && ['booked', 'confirmed', 'not_arrived', 'late', 'missed', 'waiting', 'on_the_way', 'nearby'].includes(statusLower) && !apt.checkedInAt) {
        batch.update(doc.ref, {
          status: 'no_show',
          noShowAt: now,
          updatedAt: now
        });
        noShowCount++;

        const targetApptId = apt.appointmentId || apt.id || doc.id;
        const tokRef = db.collection('tokens').doc(`tok-${targetApptId}`);
        batch.set(tokRef, { status: 'no_show', noShowAt: now, updatedAt: now }, { merge: true });

        if (apt.doctorId && apt.date === todayStr) {
          affectedDocDates.add(`${apt.doctorId}_${apt.date}`);
        }

        // Release slot ONLY if slot start time is still in the future! (Never offer/free past slot)
        if (apptTimeMs > nowMs) {
          const slotIds = apt.slotIds || (apt.slotId ? [apt.slotId] : []);
          for (const sId of slotIds) {
            const slotRef = db.collection('slots').doc(sId);
            const slotSnap = await slotRef.get();
            if (slotSnap.exists) {
              const sData = slotSnap.data();
              const slotStartObj = parseSlotTimeToDate(apt.date || todayStr, sData.startAt || slotTimeStr);
              const slotStartMs = slotStartObj ? slotStartObj.getTime() : 0;

              if (slotStartMs > nowMs) {
                batch.update(slotRef, {
                  status: SlotStatus.FREE,
                  appointmentId: null,
                  bookedBy: null,
                  updatedAt: now
                });

                if (slotStartMs - nowMs > 20 * 60 * 1000) {
                  try {
                    await offerFreedSlot({ id: slotSnap.id, ...sData, status: SlotStatus.FREE });
                  } catch (wErr) {
                    console.warn('Waitlist offer warning on no-show:', wErr.message);
                  }
                }
              }
            }
          }
        }

        // B10: Serious follow-ups alert & keep follow-up open
        const isSerious = apt.importance === 'serious' || apt.isSeriousFollowup || (apt.clinicalLevel || 1) >= 2;
        if (isSerious) {
          const alertId = `alert_noshow_${doc.id}_${nowMs}`;
          const alertRef = db.collection('alerts').doc(alertId);
          batch.set(alertRef, {
            id: alertId,
            appointmentId: doc.id,
            patientHealthId: apt.patientHealthId || apt.healthId || null,
            patientName,
            reasons: [`Patient missed an important follow-up (${doc.id})`],
            kind: 'no_show_followup',
            status: 'open',
            createdAt: now
          });

          if (apt.followupId) {
            const fuRef = db.collection('followups').doc(apt.followupId);
            batch.update(fuRef, { status: 'scheduled', updatedAt: now });
          }
        }

        if (receiverUid) {
          const notifRef = db.collection('notifications').doc();
          batch.set(notifRef, {
            id: notifRef.id,
            uid: receiverUid,
            title: `${patientName}: You missed your appointment`,
            body: `You missed your appointment. Tap Rebook if you wish to reschedule.`,
            privacyBody: `${patientName}: Appointment missed`,
            type: 'NO_SHOW',
            data: { appointmentId: doc.id, offerRebook: true },
            read: false,
            status: 'in_app_only',
            pushStatus: 'none',
            attempts: 0,
            lastAttemptAt: null,
            providerResponse: null,
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }

    await batch.commit();

    await Promise.all(
      Array.from(affectedDocDates).map((key) => {
        const [docId, dDate] = key.split('_');
        return recalculateQueue(docId, dDate);
      })
    );

    return { success: true, processedCount: aptSnap.size, noShowCount };
  } catch (error) {
    console.error('❌ noShowSweepJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Release slots for cancelled appointments after the undo window (PRD Rule A5)
 */
export async function releaseCancelledSlotsJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const nowMs = now.getTime();

    const cancelledSnap = await db
      .collection('appointments')
      .where('status', '==', 'cancelled')
      .limit(200)
      .get();

    if (cancelledSnap.empty) {
      return { success: true, releasedCount: 0 };
    }

    let releasedCount = 0;
    const affectedDocDates = new Set();

    for (const doc of cancelledSnap.docs) {
      const apt = doc.data();
      if (apt.slotReleased) continue;

      // Respect undo window: don't release until undoUntil has passed
      if (apt.cancel?.undoUntil) {
        const undoUntilMs = apt.cancel.undoUntil?.toDate?.()?.getTime?.() || new Date(apt.cancel.undoUntil).getTime();
        if (undoUntilMs > nowMs) continue;
      }

      const slotIds = apt.slotIds || (apt.slotId ? [apt.slotId] : []);
      let freedSlot = null;

      for (const slotId of slotIds) {
        const slotRef = db.collection('slots').doc(slotId);
        const slotSnap = await slotRef.get();
        if (slotSnap.exists) {
          const sData = slotSnap.data();
          if ([SlotStatus.BOOKED, SlotStatus.HELD, 'booked', 'held'].includes(sData.status)) {
            await slotRef.update({
              status: SlotStatus.FREE,
              appointmentId: null,
              bookedBy: null,
              heldBy: null,
              heldUntil: null,
              updatedAt: now
            });
            releasedCount++;
            freedSlot = { id: slotSnap.id, ...sData, status: SlotStatus.FREE };
          }
        }
      }

      await doc.ref.update({ slotReleased: true, updatedAt: now });

      if (apt.doctorId && apt.date) {
        affectedDocDates.add(`${apt.doctorId}_${apt.date}`);
      }

      // If slot starts > 20 minutes in future, trigger waitlist offer
      if (freedSlot && freedSlot.date && (freedSlot.startAt || apt.timeSlot)) {
        try {
          await offerFreedSlot({
            id: freedSlot.id,
            doctorId: freedSlot.doctorId || apt.doctorId,
            doctorName: freedSlot.doctorName || apt.doctorName,
            date: freedSlot.date || apt.date,
            timeSlot: freedSlot.startAt || apt.timeSlot
          });
        } catch (wErr) {
          console.warn('Waitlist offer trigger warning:', wErr.message);
        }
      }
    }

    // Recalculate affected queues
    for (const key of affectedDocDates) {
      const [docId, dDate] = key.split('_');
      await recalculateQueue(docId, dDate);
    }

    return { success: true, releasedCount };
  } catch (error) {
    console.error('❌ releaseCancelledSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Appointment reminders (24h, 2h, and final 30-min) (PRD Rules B1 & B11)
 */
export async function appointmentRemindersJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const nowMs = now.getTime();

    const [bookedSnap, confirmedSnap, notArrivedSnap] = await Promise.all([
      db.collection('appointments').where('status', '==', 'booked').limit(200).get(),
      db.collection('appointments').where('status', '==', 'confirmed').limit(100).get(),
      db.collection('appointments').where('status', '==', 'not_arrived').limit(100).get(),
    ]);

    const allDocs = [...bookedSnap.docs, ...confirmedSnap.docs, ...notArrivedSnap.docs];

    if (allDocs.length === 0) {
      return { success: true, remindersCreated: 0 };
    }

    let remindersCreated = 0;
    const batch = db.batch();

    for (const doc of allDocs) {
      const apt = doc.data();
      const slotTime = apt.timeSlot || apt.bookedStartAt;
      if (!apt.date || !slotTime) continue;

      // Hospital timezone Asia/Kolkata date & time parsing
      const apptTime = parseSlotTimeToDate(apt.date, slotTime);
      if (!apptTime) continue;
      const apptMs = apptTime.getTime();

      const diffMs = apptMs - nowMs;
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffMins = diffMs / (1000 * 60);

      const receiverUids = [apt.ownerUid || apt.patientUid || apt.patientId].filter(Boolean);
      const patientName = apt.patientName || 'Patient';
      const isCheckedInOrActive = !!apt.checkedInAt || ['checked_in', 'waiting', 'called', 'in_room', 'in_consultation', 'completed', 'cancelled', 'no_show'].includes((apt.status || '').toLowerCase());

      // Reconcile and cancel stale pending reminders if appointment is already resolved or checked in
      if (isCheckedInOrActive) {
        try {
          const remSnap = await db.collection('reminders')
            .where('appointmentId', '==', doc.id)
            .where('status', '==', 'pending')
            .get();
          if (!remSnap.empty) {
            remSnap.docs.forEach((d) => batch.update(d.ref, { status: 'cancelled', cancelledReason: 'appointment_active_or_resolved', updatedAt: now }));
          }
        } catch (_) {}
      }

      // Check-in notifications for unchecked-in patients (At Appointment Time & Overdue)
      if (!isCheckedInOrActive) {
        // At appointment time: between 5 minutes before and up to 10 minutes past slot time
        if (diffMins <= 5 && diffMins >= -10 && !apt.checkinAtTimeReminderSent) {
          if (receiverUids.length > 0) {
            for (const rUid of receiverUids) {
              const notifRef = db.collection('notifications').doc();
              batch.set(notifRef, {
                id: notifRef.id,
                uid: rUid,
                title: `${patientName}: Appointment time now — Please check in`,
                body: `Your appointment with ${apt.doctorName || 'Doctor'} scheduled for ${slotTime} is starting now. Please check in to enter the queue.`,
                privacyBody: `${patientName}: Please check in for your appointment`,
                type: 'CHECKIN_REMINDER',
                data: { appointmentId: doc.id, scheduledTime: slotTime, checkinRequired: true },
                read: false,
                status: 'in_app_only',
                pushStatus: 'none',
                attempts: 0,
                lastAttemptAt: null,
                providerResponse: null,
                createdAt: now,
                updatedAt: now
              });
            }
          }
          batch.update(doc.ref, { checkinAtTimeReminderSent: true, updatedAt: now });
          remindersCreated++;
        }

        // Overdue check-in notification: > 10 minutes past slot time, up to 60 minutes
        if (diffMins < -10 && diffMins >= -60 && !apt.checkinOverdueReminderSent) {
          const minsOverdue = Math.round(Math.abs(diffMins));
          if (receiverUids.length > 0) {
            for (const rUid of receiverUids) {
              const notifRef = db.collection('notifications').doc();
              batch.set(notifRef, {
                id: notifRef.id,
                uid: rUid,
                title: `${patientName}: Appointment overdue — Please check in now`,
                body: `Your appointment scheduled for ${slotTime} was at ${slotTime} (${minsOverdue} mins ago). Please check in now to keep your place in queue.`,
                privacyBody: `${patientName}: Appointment overdue — check in now`,
                type: 'CHECKIN_OVERDUE',
                data: { appointmentId: doc.id, scheduledTime: slotTime, minutesOverdue: minsOverdue, checkinRequired: true },
                read: false,
                status: 'in_app_only',
                pushStatus: 'none',
                attempts: 0,
                lastAttemptAt: null,
                providerResponse: null,
                createdAt: now,
                updatedAt: now
              });
            }
          }
          batch.update(doc.ref, { checkinOverdueReminderSent: true, updatedAt: now });
          remindersCreated++;
        }
      }

      // Future reminders (24h, 2h, final) ONLY apply when appointment start time is still in the future
      if (diffMs <= 0) continue;

      // 24h Reminder (between 23h and 25h before) - Rule B1: Confirm, Reschedule
      // Overdue policy: If between 12h and 26h before and unsent, send. If < 12h, expire 24h reminder to avoid confusing patient on the day of appointment.
      if (!apt.reminder24hSent) {
        if (diffHours >= 12 && diffHours <= 26) {
          const remId = `rem_24h_${doc.id}`;
          batch.set(
            db.collection('reminders').doc(remId),
            {
              id: remId,
              appointmentId: doc.id,
              type: 'appointment_24h',
              healthId: apt.patientHealthId || null,
              patientName,
              receiverUids,
              title: `${patientName}: Appointment Tomorrow`,
              body: `Your consultation with ${apt.doctorName || 'Doctor'} is scheduled for tomorrow at ${slotTime}.`,
              privacyBody: `${patientName}: Appointment reminder`,
              actions: ['confirm', 'reschedule'],
              status: 'pending',
              dueAt: now,
              attempts: 0,
              createdAt: now,
              updatedAt: now
            },
            { merge: true }
          );
          batch.update(doc.ref, { reminder24hSent: true, updatedAt: now });
          remindersCreated++;
        } else if (diffHours < 12) {
          // Explicit overdue policy: Window elapsed, mark as expired to prevent late send
          batch.update(doc.ref, { reminder24hSent: true, reminder24hSkipped: 'overdue_expired', updatedAt: now });
        }
      }

      // 2h Reminder (between 1.5h and 2.5h before) - Rule B1 & B11: Confirm, Cancel, Reschedule
      // Overdue policy: If between 1h and 3h before and unsent, send. If < 1h, expire to let 30-min reminder handle it.
      if (!apt.reminder2hSent) {
        if (diffHours >= 1 && diffHours <= 3) {
          const remId = `rem_2h_${doc.id}`;

          // Rule B11: Repeat no-shows check (2+ no-shows in last 90 days)
          let isRepeatNoShow = false;
          if (apt.patientHealthId || apt.ownerUid) {
            try {
              const ninetyDaysAgo = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);
              const nsQuery = await db.collection('appointments')
                .where('patientHealthId', '==', apt.patientHealthId || '')
                .where('status', '==', 'no_show')
                .get();
              const recentNoShows = nsQuery.docs.filter(d => {
                const dTime = d.data().noShowAt ? new Date(d.data().noShowAt).getTime() : 0;
                return dTime >= ninetyDaysAgo.getTime();
              });
              if (recentNoShows.length >= 2) isRepeatNoShow = true;
            } catch (nsErr) {
              console.warn('Repeat no show check warning:', nsErr.message);
            }
          }

          if (isRepeatNoShow && apt.status === 'booked') {
            // Mark slot At Risk & offer to waitlist as backup
            batch.update(doc.ref, { atRisk: true, repeatNoShowFlag: true });
            const slotId = apt.slotId || (apt.slotIds ? apt.slotIds[0] : null);
            if (slotId) {
              const slotRef = db.collection('slots').doc(slotId);
              batch.update(slotRef, { atRisk: true });
            }
          }

          batch.set(
            db.collection('reminders').doc(remId),
            {
              id: remId,
              appointmentId: doc.id,
              type: 'appointment_2h',
              healthId: apt.patientHealthId || null,
              patientName,
              receiverUids,
              title: `${patientName}: Appointment in 2 Hours`,
              body: isRepeatNoShow
                ? `Your appointment with ${apt.doctorName || 'Doctor'} starts at ${slotTime}. Please confirm to keep your reserved slot.`
                : `Your appointment with ${apt.doctorName || 'Doctor'} starts at ${slotTime}. Please confirm you are coming.`,
              privacyBody: `${patientName}: Appointment in 2 hours`,
              actions: ['confirm', 'cancel', 'reschedule'],
              isRepeatNoShow,
              status: 'pending',
              dueAt: now,
              attempts: 0,
              createdAt: now,
              updatedAt: now
            },
            { merge: true }
          );
          batch.update(doc.ref, { reminder2hSent: true, updatedAt: now });
          remindersCreated++;
        } else if (diffHours < 1) {
          // Explicit overdue policy: Window elapsed, mark as expired to let final reminder handle it
          batch.update(doc.ref, { reminder2hSent: true, reminder2hSkipped: 'overdue_expired', updatedAt: now });
        }
      }

      // Final reminder: 25–35 minutes before (unconfirmed only) - Rule B1
      if (diffMins >= 20 && diffMins <= 40 && apt.status === 'booked' && !apt.reminderFinalSent) {
        const remId = `rem_final_${doc.id}`;
        batch.set(
          db.collection('reminders').doc(remId),
          {
            id: remId,
            appointmentId: doc.id,
            type: 'appointment_final',
            healthId: apt.patientHealthId || null,
            patientName,
            receiverUids,
            title: `${patientName}: Final Reminder`,
            body: `Your appointment starts in ~30 minutes. Please confirm.`,
            privacyBody: `${patientName}: Final appointment reminder`,
            actions: ['confirm', 'cancel'],
            status: 'pending',
            dueAt: now,
            attempts: 0,
            createdAt: now,
            updatedAt: now
          },
          { merge: true }
        );
        batch.update(doc.ref, { reminderFinalSent: true, updatedAt: now });
        remindersCreated++;
      }
    }

    if (remindersCreated > 0) {
      await batch.commit();
    }

    return { success: true, remindersCreated };
  } catch (error) {
    console.error('❌ appointmentRemindersJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Fairness Bump Job (PRD F6 & Section 5.1)
 * Raises routine patients (clinicalLevel=1) delayed >= 30 min to urgent rank
 * and sends fairness notification.
 */
export async function fairnessBumpJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const todayStr = now.toISOString().split('T')[0];

    // Two queries to avoid 'in' compound index requirement
    const [ciSnap, rjSnap] = await Promise.all([
      db.collection('appointments').where('date', '==', todayStr).where('status', '==', 'checked_in').get(),
      db.collection('appointments').where('date', '==', todayStr).where('status', '==', 'rejoined').get(),
    ]);
    const allCheckedIn = [...ciSnap.docs, ...rjSnap.docs];

    if (allCheckedIn.length === 0) {
      return { success: true, bumpedCount: 0 };
    }

    let bumpedCount = 0;
    const affectedDoctors = new Set();

    for (const doc of allCheckedIn) {
      const apt = doc.data();
      if ((apt.clinicalLevel || 1) === 1 && apt.bookedStartAt) {
        const bookedMs = new Date(apt.bookedStartAt).getTime();
        const lateMin = (now.getTime() - bookedMs) / (60 * 1000);

        if (lateMin >= 30 && !apt.fairnessBumpApplied) {
          await doc.ref.update({
            fairnessBumpApplied: true,
            fairnessBumpedAt: now.toISOString(),
            updatedAt: now
          });

          // Send in-app notification using the F8 notify service
          const ownerUid = apt.ownerUid || apt.patientUid || apt.patientId;
          if (ownerUid) {
            try {
              await notify({
                uids: [ownerUid],
                title: `${apt.patientName || 'Patient'}: Queue Position Update`,
                body: 'Your turn is earlier because of your waiting time.',
                privacyBody: `${apt.patientName || 'Patient'}: Queue position updated`,
                type: 'FAIRNESS_BUMP',
                data: { appointmentId: doc.id },
                urgent: true
              });
            } catch (notifyErr) {
              // Fallback: write direct in-app notification
              await db.collection('notifications').add({
                uid: ownerUid,
                title: `${apt.patientName || 'Patient'}: Queue Position Update`,
                body: 'Your turn is earlier because of your waiting time.',
                privacyBody: `${apt.patientName || 'Patient'}: Queue position updated`,
                type: 'FAIRNESS_BUMP',
                data: { appointmentId: doc.id },
                read: false,
                pushStatus: 'none',
                createdAt: now,
                updatedAt: now
              });
            }
          }

          bumpedCount++;
          if (apt.doctorId) affectedDoctors.add(apt.doctorId);
        }
      }
    }

    // Recalculate affected queues
    for (const docId of affectedDoctors) {
      await recalculateQueue(docId, todayStr);
    }

    return { success: true, bumpedCount };
  } catch (error) {
    console.error('❌ fairnessBumpJob error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// PHASE 7 NEW JOBS
// ─────────────────────────────────────────────────────────────

/**
 * Job: Escalate unacknowledged triage alerts after 2 minutes (PRD F4, Section 10)
 *
 * - Finds open triage alerts created more than 2 minutes ago and not yet acknowledged.
 * - Escalates to emergency doctor and department head.
 * - Idempotent: uses escalatedAt to prevent double-escalation.
 */
export async function escalateTriageAlertsJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const escalateThresholdMs = 2 * 60 * 1000; // 2 minutes
    const cutoff = new Date(now.getTime() - escalateThresholdMs);

    // Find open triage alerts older than 2 minutes
    const alertsSnap = await db
      .collection('alerts')
      .where('kind', '==', 'triage')
      .where('status', '==', 'open')
      .limit(200)
      .get();

    if (alertsSnap.empty) {
      return { success: true, escalatedCount: 0 };
    }

    let escalatedCount = 0;
    const batch = db.batch();

    for (const doc of alertsSnap.docs) {
      const alert = doc.data();

      // Skip if already escalated
      if (alert.escalatedAt) continue;

      const createdAt = alert.createdAt?.toDate?.() || new Date(alert.createdAt);
      if (createdAt > cutoff) continue; // Not old enough yet

      // Mark as escalated
      batch.update(doc.ref, {
        escalatedAt: now,
        escalatedTo: ['emergency_doctor', 'department_head'],
        updatedAt: now
      });

      // Notify emergency doctor role (in-app — we don't know the specific UID here
      // so we write a broadcast alert in the alerts collection)
      const escalationAlertId = `esc_${doc.id}`;
      const patientHealthId = alert.patientHealthId || alert.healthId || null;
      batch.set(
        db.collection('alerts').doc(escalationAlertId),
        {
          kind: 'triage_escalation',
          originalAlertId: doc.id,
          patientName: alert.patientName || 'Unknown',
          patientHealthId,
          riskLevel: 'high',
          reasons: [`Triage alert unacknowledged for >2 minutes`],
          status: 'open',
          forRole: 'nurse',
          createdAt: now,
          updatedAt: now
        },
        { merge: true }
      );

      escalatedCount++;
    }

    if (escalatedCount > 0) {
      await batch.commit();
    }

    return { success: true, escalatedCount };
  } catch (error) {
    console.error('❌ escalateTriageAlertsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────
// JOB LOCK & MAIN SCHEDULER ENTRY POINT
// ─────────────────────────────────────────────────────────────

/**
 * Distributed Mutex using Firestore collection 'job_locks'
 * Ensures zero concurrent duplicate runs across server instances and processes.
 * When a job is already locked by another worker, gracefully returns { success: true, skipped: true, reason: ... }
 */
export async function withJobLock(jobName, fn, { ttlMs = 60000, workerId } = {}) {
  let db;
  try {
    db = assertDbConnected();
  } catch (err) {
    // If DB is disconnected, fallback to running directly to prevent silent stalls
    return await fn();
  }

  const id = workerId || `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const lockRef = db.collection('job_locks').doc(jobName);
  const nowMs = Date.now();
  let acquired = false;

  try {
    acquired = await db.runTransaction(async (t) => {
      const snap = await t.get(lockRef);
      if (snap.exists) {
        const data = snap.data();
        const expiresAt = Number(data.expiresAt) || 0;
        // If locked and not expired, lock cannot be acquired
        if (data.locked && expiresAt > nowMs) {
          return false;
        }
      }
      t.set(lockRef, {
        jobName,
        locked: true,
        lockedAt: new Date(nowMs).toISOString(),
        expiresAt: nowMs + ttlMs,
        lockedBy: id
      }, { merge: true });
      return true;
    });
  } catch (err) {
    console.warn(`[JobLock] Lock acquisition transaction error on ${jobName}:`, err.message);
    acquired = false;
  }

  if (!acquired) {
    return {
      success: true,
      skipped: true,
      reason: `Job ${jobName} is currently locked by another active process`
    };
  }

  try {
    const result = await fn();
    try {
      await lockRef.set({
        locked: false,
        releasedAt: new Date().toISOString(),
        expiresAt: 0,
        lastResult: typeof result === 'object' && result !== null ? { success: result.success } : null
      }, { merge: true });
    } catch (relErr) {
      console.warn(`[JobLock] Failed to release lock for ${jobName}:`, relErr.message);
    }
    return result;
  } catch (err) {
    try {
      await lockRef.set({
        locked: false,
        releasedAt: new Date().toISOString(),
        expiresAt: 0,
        lastError: err.message
      }, { merge: true });
    } catch {}
    throw err;
  }
}

/**
 * runSchedulerJobs() — called by /api/internal/tick and by node-cron.
 * Runs ALL due jobs once. Never throws.
 */
export async function runSchedulerJobs({ includeDaily = false } = {}) {
  const results = {};

  const run = async (name, fn) => {
    try {
      results[name] = await withJobLock(name, fn);
    } catch (err) {
      console.error(`❌ Scheduler: ${name} threw unexpectedly:`, err.message);
      results[name] = { success: false, error: err.message };
    }
  };

  await run('expireHolds', expireHoldsJob);
  await run('noShowSweep', noShowSweepJob);
  await run('releaseCancelledSlots', releaseCancelledSlotsJob);
  await run('appointmentReminders', appointmentRemindersJob);
  await run('fairnessBump', fairnessBumpJob);
  await run('escalateTriageAlerts', escalateTriageAlertsJob);
  await run('processReminders', processRemindersJob);
  await run('followupSweep', followupSweepJob);
  await run('dailyDoctorAlerts', dailyDoctorAlertsJob);
  await run('leaveReschedule', leaveRescheduleJob);
  await run('expireWaitlistOffers', expireWaitlistOffersJob);

  if (includeDaily) {
    await run('cleanup', cleanupJob);
    await run('generateSlots', () => generateSlotsJob(14));
  }

  results.timestamp = clock.now().toISOString();
  return results;
}

/**
 * startScheduler() — wires node-cron jobs when FLAG_SCHEDULER=true.
 * Called from server.js once on startup.
 */
export async function startScheduler() {
  try {
    // Dynamic import to avoid pulling node-cron into test bundles
    const { default: cron } = await import('node-cron');

    // Only log non-trivial results to reduce noise
    const safeRun = (name, fn) => async () => {
      try {
        const r = await withJobLock(name, fn);
        const hasWork = Object.values(r || {}).some(
          (v) => typeof v === 'number' && v > 0
        );
        if (hasWork) console.log(`✅ [cron] ${name}:`, JSON.stringify(r));
      } catch (err) {
        console.error(`❌ [cron] ${name} error:`, err.message);
      }
    };

    // Every 2 minutes — real-time slot / no-show / escalation sweeps (PRD §10)
    cron.schedule('*/2 * * * *', safeRun('expireHolds', expireHoldsJob));
    cron.schedule('*/2 * * * *', safeRun('noShowSweep', noShowSweepJob));
    cron.schedule('*/2 * * * *', safeRun('escalateTriageAlerts', escalateTriageAlertsJob));
    cron.schedule('*/2 * * * *', safeRun('processReminders', processRemindersJob));

    // Every 5 minutes — lower-urgency maintenance (PRD §10)
    cron.schedule('*/5 * * * *', safeRun('releaseCancelledSlots', releaseCancelledSlotsJob));
    cron.schedule('*/5 * * * *', safeRun('fairnessBump', fairnessBumpJob));
    cron.schedule('*/5 * * * *', safeRun('appointmentReminders', appointmentRemindersJob));

    // Hourly — time-sensitive offer expiry & leave handling
    cron.schedule('0 * * * *', safeRun('leaveReschedule', leaveRescheduleJob));
    cron.schedule('0 * * * *', safeRun('expireWaitlistOffers', expireWaitlistOffersJob));

    // Daily jobs (hospital-time)
    cron.schedule('0 6 * * *',  safeRun('followupSweep', followupSweepJob));        // 06:00
    cron.schedule('30 6 * * *', safeRun('dailyDoctorAlerts', dailyDoctorAlertsJob)); // 06:30
    cron.schedule('0 1 * * *',  safeRun('generateSlots', () => generateSlotsJob(14)));  // 01:00
    cron.schedule('0 3 * * *',  safeRun('cleanup', cleanupJob));                        // 03:00

    console.log('✅ Scheduler started (node-cron). Intervals: 2min sweeps, 5min maintenance, hourly offers, daily batch.');
  } catch (err) {
    console.error('❌ Failed to start scheduler:', err.message);
  }
}

/**
 * Job: Cleanup — delete/archive old reminders, notifications, expired offers (PRD Section 10)
 * Runs daily at 03:00. Deletes sent/failed reminders older than 30 days.
 */
export async function cleanupJob() {
  try {
    const db = assertDbConnected();
    const now = clock.now();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let deletedCount = 0;

    // Clean old sent/failed/missed reminders — split to avoid compound index
    const [sentR, failedR, missedR] = await Promise.all([
      db.collection('reminders').where('status', '==', 'sent').limit(200).get(),
      db.collection('reminders').where('status', '==', 'failed').limit(200).get(),
      db.collection('reminders').where('status', '==', 'missed').limit(200).get(),
    ]);
    const oldReminderDocs = [...sentR.docs, ...failedR.docs, ...missedR.docs].filter((d) => {
      const dueAt = d.data().dueAt?.toDate?.() || new Date(d.data().dueAt || 0);
      return dueAt <= thirtyDaysAgo;
    });

    if (oldReminderDocs.length > 0) {
      const batch = db.batch();
      oldReminderDocs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += oldReminderDocs.length;
    }

    // Clean old read notifications older than 30 days
    const oldNotifs = await db
      .collection('notifications')
      .where('read', '==', true)
      .where('createdAt', '<=', thirtyDaysAgo)
      .limit(200)
      .get();

    if (!oldNotifs.empty) {
      const batch = db.batch();
      oldNotifs.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += oldNotifs.size;
    }

    console.log(`🧹 cleanupJob: deleted ${deletedCount} old records`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('❌ cleanupJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Background Jobs & Scheduler Module (PRD F2 & Phase 7)
 * Registers daily generateSlots and expireHolds jobs
 */

import { assertDbConnected } from '../config/firebase.js';
import { generateSlotsForDoctorDate } from '../domain/slots.js';
import { SlotStatus } from '../domain/constants.js';

/**
 * Daily job: Generate bookable slots for all active doctors for the next N days (default 14)
 */
export async function generateSlotsJob(daysAhead = 14) {
  try {
    const db = assertDbConnected();
    const doctorsSnap = await db.collection('doctors').get();
    const doctors = doctorsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let totalSlots = 0;
    const today = new Date();

    for (const doc of doctors) {
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

      const leavesSnap = await db.collection('leaves').where('doctorId', '==', doctorId).get();
      const leaves = leavesSnap.docs.map((l) => l.data());

      for (let i = 0; i < daysAhead; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        const existingSnap = await db
          .collection('slots')
          .where('doctorId', '==', doctorId)
          .where('date', '==', dateStr)
          .get();

        const existingSlots = existingSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

        const generated = generateSlotsForDoctorDate({
          doctorId,
          date: dateStr,
          schedule,
          leaves,
          existingSlots
        });

        if (generated.length > 0) {
          const batch = db.batch();
          generated.forEach((s) => {
            batch.set(db.collection('slots').doc(s.id), { ...s, updatedAt: new Date() }, { merge: true });
          });
          await batch.commit();
          totalSlots += generated.length;
        }
      }
    }

    return { success: true, totalSlots, doctorsProcessed: doctors.length };
  } catch (error) {
    console.error('❌ generateSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

import { clock } from '../utils/clock.js';

/**
 * Sweep job: Expire held slots whose heldUntil timestamp is in the past
 */
export async function expireHoldsJob() {
  try {
    const db = assertDbConnected();
    const nowIso = clock.now().toISOString();

    const heldSnap = await db
      .collection('slots')
      .where('status', '==', SlotStatus.HELD)
      .where('heldUntil', '<=', nowIso)
      .get();

    if (heldSnap.empty) {
      return { success: true, expiredCount: 0 };
    }

    const batch = db.batch();
    heldSnap.docs.forEach((doc) => {
      const data = doc.data();
      const newStatus = data.defaultStatus === SlotStatus.RESERVED ? SlotStatus.RESERVED : SlotStatus.FREE;
      batch.update(doc.ref, {
        status: newStatus,
        heldBy: null,
        heldUntil: null,
        updatedAt: clock.now()
      });
    });

    await batch.commit();
    return { success: true, expiredCount: heldSnap.size };
  } catch (error) {
    console.error('❌ expireHoldsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Sweep no-shows and handle late tiers / rejoin order (PRD F5 & 10)
 */
export async function noShowSweepJob({ nowOverride, gracePeriodMinutes = 5 } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const todayStr = now.toISOString().split('T')[0];

    const aptSnap = await db
      .collection('appointments')
      .where('date', '==', todayStr)
      .where('status', 'in', ['booked', 'confirmed', 'on_the_way', 'nearby', 'not_arrived', 'called', 'rejoined'])
      .get();

    if (aptSnap.empty) {
      return { success: true, processedCount: 0, noShowCount: 0 };
    }

    let noShowCount = 0;
    const batch = db.batch();

    for (const doc of aptSnap.docs) {
      const apt = doc.data();
      if (!apt.timeSlot) continue;

      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const apptTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins);
      const apptTimeMs = apptTime.getTime();
      const graceEndMs = apptTimeMs + (gracePeriodMinutes * 60 * 1000);

      // Un-checked in past start time -> mark not_arrived
      if (now.getTime() > apptTimeMs && ['booked', 'confirmed', 'on_the_way'].includes(apt.status)) {
        batch.update(doc.ref, {
          status: 'not_arrived',
          notArrivedAt: now,
          updatedAt: now
        });
      }

      // Past grace period without check-in or call -> mark NO_SHOW
      if (now.getTime() > graceEndMs && ['not_arrived', 'nearby', 'called'].includes(apt.status)) {
        batch.update(doc.ref, {
          status: 'no_show',
          noShowAt: now,
          updatedAt: now
        });
        noShowCount++;

        // Serious follow-up alert hook if high risk or urgent triage
        if (apt.clinicalLevel >= 2 || apt.riskLevel === 'high') {
          const alertId = `alert_noshow_${doc.id}_${now.getTime()}`;
          const alertRef = db.collection('alerts').doc(alertId);
          batch.set(alertRef, {
            id: alertId,
            appointmentId: doc.id,
            patientHealthId: apt.patientHealthId || apt.healthId,
            patientName: apt.patientName || 'Patient',
            reasons: [`High-risk patient NO-SHOW for appointment ${doc.id}`],
            kind: 'no_show_followup',
            status: 'open',
            createdAt: now
          });
        }
      }
    }

    await batch.commit();
    return { success: true, processedCount: aptSnap.size, noShowCount };
  } catch (error) {
    console.error('❌ noShowSweepJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Release slots for cancelled appointments
 */
export async function releaseCancelledSlotsJob() {
  try {
    const db = assertDbConnected();
    const cancelledSnap = await db
      .collection('appointments')
      .where('status', '==', 'cancelled')
      .get();

    if (cancelledSnap.empty) {
      return { success: true, releasedCount: 0 };
    }

    let releasedCount = 0;
    const batch = db.batch();

    for (const doc of cancelledSnap.docs) {
      const apt = doc.data();
      if (apt.slotId) {
        const slotRef = db.collection('slots').doc(apt.slotId);
        const slotSnap = await slotRef.get();
        if (slotSnap.exists && (slotSnap.data().status === SlotStatus.BOOKED || slotSnap.data().status === SlotStatus.HELD)) {
          batch.update(slotRef, {
            status: SlotStatus.FREE,
            bookedBy: null,
            updatedAt: clock.now()
          });
          releasedCount++;
        }
      }
    }

    if (releasedCount > 0) {
      await batch.commit();
    }

    return { success: true, releasedCount };
  } catch (error) {
    console.error('❌ releaseCancelledSlotsJob error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Job: Appointment reminders (24h and 2h windows) with Confirm and Cancel action buttons
 */
export async function appointmentRemindersJob({ nowOverride } = {}) {
  try {
    const db = assertDbConnected();
    const now = nowOverride ? new Date(nowOverride) : clock.now();
    const nowMs = now.getTime();

    const upcomingSnap = await db
      .collection('appointments')
      .where('status', 'in', ['booked', 'confirmed'])
      .get();

    if (upcomingSnap.empty) {
      return { success: true, remindersCreated: 0 };
    }

    let remindersCreated = 0;
    const batch = db.batch();

    for (const doc of upcomingSnap.docs) {
      const apt = doc.data();
      if (!apt.date || !apt.timeSlot) continue;

      const [hours, mins] = apt.timeSlot.split(':').map(Number);
      const [year, month, day] = apt.date.split('-').map(Number);
      const apptTime = new Date(year, month - 1, day, hours, mins);
      const apptMs = apptTime.getTime();

      const diffHours = (apptMs - nowMs) / (1000 * 60 * 60);

      // 24h Reminder (between 23h and 25h)
      if (diffHours >= 23 && diffHours <= 25 && !apt.reminder24hSent) {
        const remId = `rem_24h_${doc.id}`;
        batch.set(db.collection('reminders').doc(remId), {
          id: remId,
          appointmentId: doc.id,
          patientUid: apt.patientUid || apt.patientId,
          type: 'APPOINTMENT_24H',
          title: 'Upcoming Appointment Tomorrow',
          body: `Your consultation with ${apt.doctorName || 'Doctor'} is scheduled for tomorrow at ${apt.timeSlot}.`,
          actions: [
            { label: 'Confirm', endpoint: `/api/appointments/${doc.id}/confirm`, method: 'POST' },
            { label: 'Cancel', endpoint: `/api/appointments/${doc.id}/cancel`, method: 'POST' }
          ],
          createdAt: now
        });
        batch.update(doc.ref, { reminder24hSent: true, updatedAt: now });
        remindersCreated++;
      }

      // 2h Reminder (between 1.5h and 2.5h)
      if (diffHours >= 1.5 && diffHours <= 2.5 && !apt.reminder2hSent) {
        const remId = `rem_2h_${doc.id}`;
        batch.set(db.collection('reminders').doc(remId), {
          id: remId,
          appointmentId: doc.id,
          patientUid: apt.patientUid || apt.patientId,
          type: 'APPOINTMENT_2H',
          title: 'Upcoming Appointment in 2 Hours',
          body: `Your appointment is starting soon at ${apt.timeSlot}. Please mark if you are on the way.`,
          actions: [
            { label: 'Confirm', endpoint: `/api/appointments/${doc.id}/confirm`, method: 'POST' },
            { label: 'Cancel', endpoint: `/api/appointments/${doc.id}/cancel`, method: 'POST' }
          ],
          createdAt: now
        });
        batch.update(doc.ref, { reminder2hSent: true, updatedAt: now });
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
 * Main Scheduler wiring entry point
 */
export async function runSchedulerJobs() {
  const holdsResult = await expireHoldsJob();
  const noShowResult = await noShowSweepJob();
  const releaseResult = await releaseCancelledSlotsJob();
  const remindersResult = await appointmentRemindersJob();

  return {
    holds: holdsResult,
    noShow: noShowResult,
    release: releaseResult,
    reminders: remindersResult,
    timestamp: clock.now().toISOString()
  };
}

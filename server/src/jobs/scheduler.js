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

/**
 * Sweep job: Expire held slots whose heldUntil timestamp is in the past
 */
export async function expireHoldsJob() {
  try {
    const db = assertDbConnected();
    const nowIso = new Date().toISOString();

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
        updatedAt: new Date()
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
 * Main Scheduler wiring entry point
 */
export async function runSchedulerJobs() {
  const holdsResult = await expireHoldsJob();
  return {
    holds: holdsResult,
    timestamp: new Date().toISOString()
  };
}

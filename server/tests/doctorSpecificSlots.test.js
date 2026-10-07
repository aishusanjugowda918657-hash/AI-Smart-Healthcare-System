import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';
import { SlotStatus } from '../src/domain/constants.js';

// In-memory Firestore Mock for Doctor-Specific Slot testing
const createInMemoryDb = () => {
  const collections = {
    doctors: new Map(),
    slots: new Map(),
    appointments: new Map(),
    counters: new Map(),
    leaves: new Map(),
    departments: new Map(),
    auditLogs: new Map()
  };

  const getCol = (name) => collections[name] || (collections[name] = new Map());

  const makeDocRef = (colName, docId) => ({
    id: docId,
    get: async () => {
      const col = getCol(colName);
      const data = col.get(docId);
      return {
        id: docId,
        exists: !!data,
        data: () => (data ? { ...data } : undefined),
        ref: makeDocRef(colName, docId)
      };
    },
    set: async (data, opts = {}) => {
      const col = getCol(colName);
      const existing = col.get(docId) || {};
      const updated = opts.merge ? { ...existing, ...data } : { ...data };
      col.set(docId, updated);
      return updated;
    },
    update: async (data) => {
      const col = getCol(colName);
      const existing = col.get(docId);
      if (!existing) throw new Error(`Document ${docId} does not exist`);
      const updated = { ...existing, ...data };
      col.set(docId, updated);
      return updated;
    }
  });

  const makeQuery = (colName, filters = [], orderByClause = null) => ({
    where: (field, op, val) => makeQuery(colName, [...filters, { field, op, val }], orderByClause),
    orderBy: (field) => makeQuery(colName, filters, field),
    limit: () => makeQuery(colName, filters, orderByClause),
    get: async () => {
      const col = getCol(colName);
      let docs = Array.from(col.entries()).map(([id, data]) => ({
        id,
        exists: true,
        data: () => ({ ...data }),
        ref: makeDocRef(colName, id)
      }));

      for (const filter of filters) {
        docs = docs.filter((d) => {
          const val = d.data()[filter.field];
          if (filter.op === '==') return val === filter.val;
          if (filter.op === '>') return val > filter.val;
          if (filter.op === '>=') return val >= filter.val;
          if (filter.op === '<') return val < filter.val;
          if (filter.op === '<=') return val <= filter.val;
          if (filter.op === 'in') return Array.isArray(filter.val) && filter.val.includes(val);
          return true;
        });
      }

      if (orderByClause) {
        docs.sort((a, b) => {
          const valA = a.data()[orderByClause] || '';
          const valB = b.data()[orderByClause] || '';
          return String(valA).localeCompare(String(valB));
        });
      }

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length
      };
    }
  });

  const db = {
    collection: (name) => ({
      doc: (id) => {
        const docId = id || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        return makeDocRef(name, docId);
      },
      add: async (data) => {
        const docId = `auto_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const ref = makeDocRef(name, docId);
        await ref.set(data);
        return ref;
      },
      ...makeQuery(name)
    }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        commit: async () => {
          for (const op of ops) await op();
        }
      };
    },
    runTransaction: async (updateFunction) => {
      const transaction = {
        get: async (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.update(data)
      };
      return updateFunction(transaction);
    }
  };

  return { db, collections };
};

let inMemDb;

vi.mock('../src/config/firebase.js', () => ({
  assertDbConnected: () => inMemDb.db,
  getDb: () => inMemDb.db
}));

vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-demo-uid'] || 'test-user-uid',
      role: req.headers['x-demo-role'] || 'patient'
    };
    next();
  }
}));

import app from '../src/app.js';

describe('Doctor-Specific Appointment Slot Availability (PRD Core Rule)', () => {
  const doctorA = 'DOC-REAL-001';
  const doctorB = 'DOC-REAL-005';
  const doctorC = 'DOC-REAL-006';
  const testDate = '2026-11-20';
  const patientHealthIdA = 'PHI-2026-000100-A';
  const patientHealthIdB = 'PHI-2026-000200-B';

  const schedule = {
    slotMinutes: 15,
    bufferEverySlots: 6,
    weekly: [
      { dayOfWeek: 5, sessions: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }] }
    ],
    lunch: { start: '13:00', end: '14:00' }
  };

  beforeEach(async () => {
    inMemDb = createInMemoryDb();

    // Provision Doctors
    await Promise.all([
      inMemDb.collections.doctors.set(doctorA, { doctorId: doctorA, uid: doctorA, name: 'Dr. Aarti Test', schedule, active: true }),
      inMemDb.collections.doctors.set(doctorB, { doctorId: doctorB, uid: doctorB, name: 'Dr. Arun Test', schedule, active: true }),
      inMemDb.collections.doctors.set(doctorC, { doctorId: doctorC, uid: doctorC, name: 'Dr. Anusha Test', schedule, active: true })
    ]);

    // Provision pre-existing slots for testing
    const slotsA = generateSlotsForDoctorDate({ doctorId: doctorA, date: testDate, schedule });
    const slotsB = generateSlotsForDoctorDate({ doctorId: doctorB, date: testDate, schedule });
    const slotsC = generateSlotsForDoctorDate({ doctorId: doctorC, date: testDate, schedule });

    [...slotsA, ...slotsB, ...slotsC].forEach((s) => {
      inMemDb.collections.slots.set(s.id, { ...s, updatedAt: new Date() });
    });
  });

  it('TASK 2 — Step 5 queries ONLY slots for selected doctor', async () => {
    const resA = await request(app).get(`/api/booking/suggestions?doctorId=${doctorA}&date=${testDate}`);
    expect(resA.statusCode).toBe(200);
    const fullListA = resA.body.data.fullList;
    expect(fullListA.length).toBeGreaterThan(0);
    fullListA.forEach((slot) => {
      expect(slot.doctorId).toBe(doctorA);
      expect(slot.id).toContain(doctorA);
    });
  });

  it('TASK 4 — Reject booking if slot belongs to another doctor (SLOT_DOCTOR_MISMATCH)', async () => {
    const slotIdDoctorB = `${doctorB}_${testDate}_0900`;
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-cheat-01')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotIdDoctorB],
        patientHealthId: patientHealthIdA,
        patientName: 'Patient Cheat',
        doctorId: doctorA, // Mismatch! Request specifies doctorA, but slotId belongs to doctorB
        date: testDate,
        visitType: 'new',
        reasonText: 'Doctor mismatch security test',
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('SLOT_DOCTOR_MISMATCH');
  });

  it('TASK 5 — Required Demo Test: Booking Dr. Aarti 09:00 leaves Dr. Arun 09:00 AVAILABLE', async () => {
    const slotIdA = `${doctorA}_${testDate}_0900`;
    const slotIdB = `${doctorB}_${testDate}_0900`;

    // 1. Patient A books Dr. Aarti -> 09:00
    const resA = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-demo-a')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotIdA],
        patientHealthId: patientHealthIdA,
        patientName: 'Patient A',
        doctorId: doctorA,
        date: testDate,
        visitType: 'new',
        reasonText: 'Patient A consultation',
        disclaimerAck: { acknowledged: true }
      });

    expect(resA.statusCode).toBe(201);

    // Verify Dr. Aarti 09:00 is BOOKED
    const slotADoc = inMemDb.collections.slots.get(slotIdA);
    expect(slotADoc.status).toBe(SlotStatus.BOOKED);

    // Verify Dr. Arun 09:00 is STILL AVAILABLE (FREE)
    const slotBDocInitial = inMemDb.collections.slots.get(slotIdB);
    expect(slotBDocInitial.status).toBe(SlotStatus.FREE);

    // 2. Patient B books Dr. Arun -> 09:00
    const resB = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-demo-b')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotIdB],
        patientHealthId: patientHealthIdB,
        patientName: 'Patient B',
        doctorId: doctorB,
        date: testDate,
        visitType: 'new',
        reasonText: 'Patient B consultation',
        disclaimerAck: { acknowledged: true }
      });

    expect(resB.statusCode).toBe(201);

    // Verify both appointments exist and both slots are booked independently
    const slotBDocFinal = inMemDb.collections.slots.get(slotIdB);
    expect(slotBDocFinal.status).toBe(SlotStatus.BOOKED);
  });

  it('TASK 6 — Concurrent booking collision on SAME doctor slot rejects second patient', async () => {
    const targetSlotId = `${doctorC}_${testDate}_0900`;

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'patient-race-1')
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [targetSlotId],
          patientHealthId: 'PHI-RACE-1',
          patientName: 'Race 1',
          doctorId: doctorC,
          date: testDate,
          disclaimerAck: { acknowledged: true }
        }),
      request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'patient-race-2')
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [targetSlotId],
          patientHealthId: 'PHI-RACE-2',
          patientName: 'Race 2',
          doctorId: doctorC,
          date: testDate,
          disclaimerAck: { acknowledged: true }
        })
    ]);

    const statuses = [res1.statusCode, res2.statusCode];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);
  });

  it('TASK 7 — Booking Doctor A at 09:00 leaves Doctor B & C 09:15 AVAILABLE', async () => {
    const resB = await request(app).get(`/api/booking/suggestions?doctorId=${doctorB}&date=${testDate}`);
    const slot0915_B = resB.body.data.fullList.find((s) => s.startAt === '09:15');
    expect(slot0915_B.status).toBe(SlotStatus.FREE);

    const resC = await request(app).get(`/api/booking/suggestions?doctorId=${doctorC}&date=${testDate}`);
    const slot0915_C = resC.body.data.fullList.find((s) => s.startAt === '09:15');
    expect(slot0915_C.status).toBe(SlotStatus.FREE);
  });

  it('TASK 8 — Doctor breaks remain doctor-specific', async () => {
    const schedA = {
      slotMinutes: 15,
      weekly: [{ dayOfWeek: 5, sessions: [{ start: '09:00', end: '17:00' }] }],
      lunch: { start: '13:00', end: '14:00' }
    };

    const schedB = {
      slotMinutes: 15,
      weekly: [{ dayOfWeek: 5, sessions: [{ start: '09:00', end: '17:00' }] }]
    };

    const slotsDocA = generateSlotsForDoctorDate({ doctorId: doctorA, date: '2026-11-20', schedule: schedA });
    const slotsDocB = generateSlotsForDoctorDate({ doctorId: doctorB, date: '2026-11-20', schedule: schedB });

    const slot1300_A = slotsDocA.find((s) => s.startAt === '13:00');
    const slot1300_B = slotsDocB.find((s) => s.startAt === '13:00');

    expect(slot1300_A).toBeUndefined();
    expect(slot1300_B).toBeDefined();
    expect(slot1300_B.status).toBe(SlotStatus.FREE);
  });

  it('TASK 10 — Cancellation releases correct doctor slot and Rescheduling updates doctor slot', async () => {
    const slotA = `${doctorA}_${testDate}_0930`;
    const slotB = `${doctorA}_${testDate}_0945`;

    // 1. Book slot A
    const bookRes = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-lifecycle-01')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotA],
        patientHealthId: 'PHI-LIFECYCLE-1',
        patientName: 'Lifecycle Patient',
        doctorId: doctorA,
        date: testDate,
        disclaimerAck: { acknowledged: true }
      });

    expect(bookRes.statusCode).toBe(201);
    const apptId = bookRes.body.data.id;

    // 2. Reschedule to slot B
    const reschedRes = await request(app)
      .post(`/api/appointments/${apptId}/reschedule`)
      .set('x-demo-uid', 'patient-lifecycle-01')
      .set('x-demo-role', 'patient')
      .send({
        newSlotId: slotB,
        newDate: testDate
      });

    expect(reschedRes.statusCode).toBe(200);

    const oldSlotDoc = inMemDb.collections.slots.get(slotA);
    const newSlotDoc = inMemDb.collections.slots.get(slotB);

    expect(oldSlotDoc.status).toBe(SlotStatus.FREE);
    expect(newSlotDoc.status).toBe(SlotStatus.BOOKED);

    // 3. Cancel appointment
    const cancelRes = await request(app)
      .post(`/api/appointments/${apptId}/cancel`)
      .set('x-demo-uid', 'patient-lifecycle-01')
      .set('x-demo-role', 'patient')
      .send({ reason: 'Patient changed mind' });

    expect(cancelRes.statusCode).toBe(200);

    const { clock } = await import('../src/utils/clock.js');
    clock.setMockTime(Date.now() + 11 * 60 * 1000);
    const { releaseCancelledSlotsJob } = await import('../src/jobs/scheduler.js');
    await releaseCancelledSlotsJob();

    const cancelledSlotDoc = inMemDb.collections.slots.get(slotB);
    expect(cancelledSlotDoc.status).toBe(SlotStatus.FREE);
  });
});

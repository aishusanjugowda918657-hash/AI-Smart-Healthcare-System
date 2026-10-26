import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { generateSlotsForDoctorDate, getSmartSlotSuggestions } from '../src/domain/slots.js';
import { SlotStatus } from '../src/domain/constants.js';
import clock from '../src/utils/clock.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOSPITAL_TZ = 'Asia/Kolkata';

// In-memory Firestore Mock for deterministic testing
const createInMemoryDb = () => {
  const collections = {
    doctors: new Map(),
    slots: new Map(),
    appointments: new Map(),
    appointment_locks: new Map(),
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
      where: (field, op, val) => makeQuery(name, [{ field, op, val }]),
      get: async () => makeQuery(name).get()
    }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete && ref.delete()),
        commit: async () => {
          for (const op of ops) await op();
        }
      };
    },
    runTransaction: async (updateFunction) => {
      const transaction = {
        get: async (docRefOrQuery) => docRefOrQuery.get(),
        set: (docRef, data, opts) => docRef.set(data, opts),
        update: (docRef, data) => docRef.update(data),
        delete: (docRef) => docRef.delete && docRef.delete()
      };
      return updateFunction(transaction);
    }
  };

  return { db, collections };
};

let inMemDb;

vi.mock('../src/config/firebase.js', () => ({
  assertDbConnected: () => inMemDb.db,
  getDb: () => inMemDb.db,
  isEmulator: true,
  getActiveProjectId: () => 'demo-project'
}));

vi.mock('../src/middleware/authMiddleware.js', () => ({
  requireAuth: (req, res, next) => {
    req.user = {
      uid: req.headers['x-demo-uid'] || 'test-patient-uid',
      role: req.headers['x-demo-role'] || 'patient'
    };
    next();
  }
}));

import app from '../src/app.js';

// Import frontend logic replicated for regression verification
const isSlotExpiredClient = (appointmentDate, startAt, customNow = new Date()) => {
  if (!appointmentDate) return true;
  const cleanDate = String(appointmentDate).trim();
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: HOSPITAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(customNow);

  if (cleanDate < todayStr) return true;
  if (cleanDate > todayStr) return false;

  if (!startAt) return true;
  const currentTimeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: HOSPITAL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(customNow);

  return String(startAt).trim() <= currentTimeStr;
};

describe('Slot Expiration Regression Test Suite (Bug Fix Validation)', () => {
  const doctorId = 'DOC-REAL-002';
  const todayDateStr = '2026-10-22'; // Thursday
  const pastDateStr = '2026-10-21';  // Wednesday
  const futureDateStr = '2026-10-23'; // Friday

  const schedule = {
    slotMinutes: 15,
    bufferEverySlots: 6,
    weekly: [
      {
        dayOfWeek: 3, // Wednesday
        sessions: [{ start: '09:00', end: '13:00' }]
      },
      {
        dayOfWeek: 4, // Thursday
        sessions: [{ start: '09:00', end: '13:00' }]
      },
      {
        dayOfWeek: 5, // Friday
        sessions: [{ start: '09:00', end: '13:00' }]
      }
    ]
  };

  beforeEach(async () => {
    inMemDb = createInMemoryDb();

    // Setup doctor
    inMemDb.collections.doctors.set(doctorId, {
      doctorId,
      uid: doctorId,
      name: 'Dr. Rahul Kumar',
      departmentId: 'dept-gen',
      schedule,
      active: true
    });

    // Generate and seed slots for yesterday, today, and tomorrow
    [pastDateStr, todayDateStr, futureDateStr].forEach((date) => {
      const slots = generateSlotsForDoctorDate({ doctorId, date, schedule });
      slots.forEach((s) => {
        inMemDb.collections.slots.set(s.id, { ...s, updatedAt: new Date() });
      });
    });
  });

  afterEach(() => {
    clock.reset();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------------------
  // 1. Booking at 9:35 AM with a 9:00 AM slot -> MUST BE REJECTED (409 SLOT_EXPIRED)
  // -------------------------------------------------------------------------------------
  it('1. Booking at 9:35 AM with a 9:00 AM slot: Backend rejects with 409 SLOT_EXPIRED', async () => {
    // 9:35 AM IST on 2026-10-22 is 04:05 UTC
    const mockTimeAt935AM = new Date('2026-10-22T04:05:00Z');
    clock.setMockTime(mockTimeAt935AM);

    const slot0900 = `${doctorId}_${todayDateStr}_0900`;

    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-001')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slot0900],
        patientHealthId: 'PHI-2026-0001',
        patientName: 'Test Patient',
        doctorId,
        date: todayDateStr,
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.code || res.body.error?.code).toBe('SLOT_EXPIRED');
    expect(res.body.message || res.body.error?.message).toContain('is in the past and has expired');

    // Also verify frontend evaluation marks it expired
    expect(isSlotExpiredClient(todayDateStr, '09:00', mockTimeAt935AM)).toBe(true);
  });

  // -------------------------------------------------------------------------------------
  // 2. A future 9:45 AM slot at 9:35 AM -> SUCSEEDS (201)
  // -------------------------------------------------------------------------------------
  it('2. A future 9:45 AM slot: At 9:35 AM, booking a 9:45 AM slot succeeds (201)', async () => {
    const mockTimeAt935AM = new Date('2026-10-22T04:05:00Z');
    clock.setMockTime(mockTimeAt935AM);

    const slot0945 = `${doctorId}_${todayDateStr}_0945`;

    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-002')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slot0945],
        patientHealthId: 'PHI-2026-0002',
        patientName: 'Future Patient',
        doctorId,
        date: todayDateStr,
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBeDefined();

    // Verify slot marked booked
    const slotDoc = inMemDb.collections.slots.get(slot0945);
    expect(slotDoc.status).toBe(SlotStatus.BOOKED);

    // Frontend evaluation: not expired
    expect(isSlotExpiredClient(todayDateStr, '09:45', mockTimeAt935AM)).toBe(false);
  });

  // -------------------------------------------------------------------------------------
  // 3. Past appointment dates: no bookable slots, all rejected (409 SLOT_EXPIRED)
  // -------------------------------------------------------------------------------------
  it('3. Past appointment dates: Booking yesterday slot rejected (409 SLOT_EXPIRED) and marked expired', async () => {
    const mockTimeAt935AM = new Date('2026-10-22T04:05:00Z');
    clock.setMockTime(mockTimeAt935AM);

    const pastSlot = `${doctorId}_${pastDateStr}_0900`;

    // Attempt booking past date slot
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-003')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [pastSlot],
        patientHealthId: 'PHI-2026-0003',
        patientName: 'Past Date Patient',
        doctorId,
        date: pastDateStr,
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.code || res.body.error?.code).toBe('SLOT_EXPIRED');
    expect(res.body.message || res.body.error?.message).toContain('is in the past and has expired');

    // Suggestions API on past date: no cards, all fullList slots flagged isExpired: true
    const suggestionsRes = await request(app)
      .get(`/api/booking/suggestions?doctorId=${doctorId}&date=${pastDateStr}`);

    expect(suggestionsRes.statusCode).toBe(200);
    expect(suggestionsRes.body.data.cards).toEqual([]);
    expect(suggestionsRes.body.data.fullList.length).toBeGreaterThan(0);
    suggestionsRes.body.data.fullList.forEach((s) => {
      expect(s.isExpired).toBe(true);
      expect(isSlotExpiredClient(pastDateStr, s.startAt, mockTimeAt935AM)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------------------
  // 4. Future appointment dates: show eligible slots normally and succeed (201)
  // -------------------------------------------------------------------------------------
  it('4. Future appointment dates: 9:00 AM slot tomorrow is NOT expired even if 09:00 < 09:35', async () => {
    const mockTimeAt935AM = new Date('2026-10-22T04:05:00Z');
    clock.setMockTime(mockTimeAt935AM);

    const tomorrowSlot0900 = `${doctorId}_${futureDateStr}_0900`;

    // Frontend check: should NOT be expired because date is tomorrow
    expect(isSlotExpiredClient(futureDateStr, '09:00', mockTimeAt935AM)).toBe(false);

    // Suggestions API on future date returns available cards and isExpired: false
    const suggestionsRes = await request(app)
      .get(`/api/booking/suggestions?doctorId=${doctorId}&date=${futureDateStr}`);

    expect(suggestionsRes.statusCode).toBe(200);
    expect(suggestionsRes.body.data.cards.length).toBeGreaterThan(0);
    const tomorrow0900InList = suggestionsRes.body.data.fullList.find((s) => s.startAt === '09:00');
    expect(tomorrow0900InList.isExpired).toBe(false);

    // Booking succeeds
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-004')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [tomorrowSlot0900],
        patientHealthId: 'PHI-2026-0004',
        patientName: 'Future Date Patient',
        doctorId,
        date: futureDateStr,
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(201);
  });

  // -------------------------------------------------------------------------------------
  // 5. A slot becoming expired while Step 5 remains open
  // -------------------------------------------------------------------------------------
  it('5. A slot becoming expired while Step 5 remains open: Transitions from available to expired', () => {
    // At 9:14 AM IST (03:44 UTC), 9:15 AM slot is NOT expired
    const timeAt914AM = new Date('2026-10-22T03:44:00Z');
    expect(isSlotExpiredClient(todayDateStr, '09:15', timeAt914AM)).toBe(false);

    // 2 minutes later at 9:16 AM IST (03:46 UTC), 9:15 AM slot is now EXPIRED
    const timeAt916AM = new Date('2026-10-22T03:46:00Z');
    expect(isSlotExpiredClient(todayDateStr, '09:15', timeAt916AM)).toBe(true);

    // Verify domain suggestions engine reflects this transition
    const allSlots = generateSlotsForDoctorDate({ doctorId, date: todayDateStr, schedule });
    const suggestionsAt914 = getSmartSlotSuggestions({
      slots: allSlots,
      dateStr: todayDateStr,
      nowMs: timeAt914AM.getTime()
    });
    const slot0915At914 = suggestionsAt914.fullList.find((s) => s.startAt === '09:15');
    expect(slot0915At914.isExpired).toBe(false);

    const suggestionsAt916 = getSmartSlotSuggestions({
      slots: allSlots,
      dateStr: todayDateStr,
      nowMs: timeAt916AM.getTime()
    });
    const slot0915At916 = suggestionsAt916.fullList.find((s) => s.startAt === '09:15');
    expect(slot0915At916.isExpired).toBe(true);
  });

  // -------------------------------------------------------------------------------------
  // 6. A slot expiring between Step 5 and Step 6
  // -------------------------------------------------------------------------------------
  it('6. A slot expiring between Step 5 and Step 6: Step 6 validation rejects confirmation', async () => {
    // Patient chooses 09:30 AM slot on Step 5 at 09:28 AM
    const timeAt928AM = new Date('2026-10-22T03:58:00Z');
    clock.setMockTime(timeAt928AM);

    const slot0930 = `${doctorId}_${todayDateStr}_0930`;
    expect(isSlotExpiredClient(todayDateStr, '09:30', timeAt928AM)).toBe(false);

    // Patient takes 3 minutes reading disclaimer on Step 6. Time is now 09:31 AM IST
    const timeAt931AM = new Date('2026-10-22T04:01:00Z');
    clock.setMockTime(timeAt931AM);

    // Step 6 client check prevents confirmation
    expect(isSlotExpiredClient(todayDateStr, '09:30', timeAt931AM)).toBe(true);

    // Even if frontend submission is attempted, backend revalidation rejects it
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-slow')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slot0930],
        patientHealthId: 'PHI-2026-SLOW',
        patientName: 'Slow Patient',
        doctorId,
        date: todayDateStr,
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.code || res.body.error?.code).toBe('SLOT_EXPIRED');
    expect(res.body.message || res.body.error?.message).toContain('is in the past and has expired');
  });

  // -------------------------------------------------------------------------------------
  // 7. Two patients attempting to book the same slot: Exactly one succeeds, one gets 409
  // -------------------------------------------------------------------------------------
  it('7. Two patients attempting to book the same valid slot: 1 succeeds (201), 1 fails (409 SLOT_TAKEN)', async () => {
    const mockTime = new Date('2026-10-22T04:00:00Z'); // 09:30 AM IST
    clock.setMockTime(mockTime);

    const targetSlotId = `${doctorId}_${futureDateStr}_1000`; // future date slot

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'race-patient-1')
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [targetSlotId],
          patientHealthId: 'PHI-RACE-001',
          patientName: 'Race Patient 1',
          doctorId,
          date: futureDateStr,
          disclaimerAck: { acknowledged: true }
        }),
      request(app)
        .post('/api/appointments')
        .set('x-demo-uid', 'race-patient-2')
        .set('x-demo-role', 'patient')
        .send({
          slotIds: [targetSlotId],
          patientHealthId: 'PHI-RACE-002',
          patientName: 'Race Patient 2',
          doctorId,
          date: futureDateStr,
          disclaimerAck: { acknowledged: true }
        })
    ]);

    const statuses = [res1.statusCode, res2.statusCode];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    const failedRes = res1.statusCode === 409 ? res1 : res2;
    expect(failedRes.body.code || failedRes.body.error?.code).toBe('SLOT_TAKEN');
  });

  // -------------------------------------------------------------------------------------
  // 8. Timezone and date-boundary cases
  // -------------------------------------------------------------------------------------
  it('8. Timezone and date-boundary cases: 1:00 AM IST on Oct 23 is 19:30 UTC on Oct 22', async () => {
    // 19:30 UTC on Oct 22 is 01:00 AM IST on Oct 23
    const lateNightUTC = new Date('2026-10-22T19:30:00Z');
    clock.setMockTime(lateNightUTC);

    // In UTC, date is 2026-10-22. But in clinic timezone (Asia/Kolkata), today is 2026-10-23!
    const istToday = dayjs(lateNightUTC).tz(HOSPITAL_TZ).format('YYYY-MM-DD');
    expect(istToday).toBe('2026-10-23');

    // 2026-10-22 slots are now in the PAST in IST!
    const slotFromYesterdayInIST = `${doctorId}_2026-10-22_1200`;
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'patient-boundary')
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotFromYesterdayInIST],
        patientHealthId: 'PHI-2026-BOUNDARY',
        patientName: 'Boundary Patient',
        doctorId,
        date: '2026-10-22',
        disclaimerAck: { acknowledged: true }
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.code || res.body.error?.code).toBe('SLOT_EXPIRED');

    // 2026-10-23 09:00 slot is in the FUTURE in IST (it is 1:00 AM IST)
    expect(isSlotExpiredClient('2026-10-23', '09:00', lateNightUTC)).toBe(false);

    // 2026-10-22 12:00 slot is in the PAST in IST
    expect(isSlotExpiredClient('2026-10-22', '12:00', lateNightUTC)).toBe(true);
  });
});

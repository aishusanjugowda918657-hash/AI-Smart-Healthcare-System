import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import clock from '../src/utils/clock.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { getHospitalTodayStr, getHospitalTimeStr, parseSlotTimeToDate, isSlotInPast, isGracePeriodExpired } from '../src/utils/timezoneDate.js';
import { noShowSweepJob } from '../src/jobs/scheduler.js';
import { getMyQueueStatus } from '../src/controllers/tokenController.js';
import { recalculateQueue, calculateQueueReadOnly } from '../src/services/queueService.js';
import fs from 'fs';
import path from 'path';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOSPITAL_TZ = 'Asia/Kolkata';

// In-memory Firestore Mock for clean, isolated regression testing
const createInMemoryDb = () => {
  const collections = {
    doctors: new Map(),
    slots: new Map(),
    appointments: new Map(),
    tokens: new Map(),
    queues: new Map(),
    counters: new Map(),
    patients: new Map(),
    departments: new Map(),
    settings: new Map(),
    alerts: new Map(),
    reminders: new Map(),
    consultationStats: new Map(),
    doctorSchedules: new Map()
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
      if (!existing) throw new Error(`Document ${docId} does not exist in ${colName}`);
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
    runTransaction: async (fn) => fn({
      get: async (ref) => ref.get(),
      set: (ref, data, opts) => ref.set(data, opts),
      update: (ref, data) => ref.update(data)
    })
  };

  return { db, collections };
};

const hoisted = vi.hoisted(() => {
  return { current: null };
});

vi.mock('../src/config/firebase.js', () => ({
  assertDbConnected: () => hoisted.current.db,
  getDb: () => hoisted.current.db,
  isEmulator: true
}));

describe('Queue Stale Appointment Lifecycle & Leave Home Removal Regression Tests', () => {
  let mockEnv;

  beforeEach(() => {
    mockEnv = createInMemoryDb();
    hoisted.current = mockEnv;
  });

  afterEach(() => {
    clock.reset();
    vi.restoreAllMocks();
  });

  // 1. A past-day WAITING appointment with no check-in
  it('1. A past-day WAITING appointment with no check-in is transitioned to NO_SHOW and excluded from active queue', async () => {
    // Current time: Oct 22, 2026, 17:17 IST (matching user screenshot)
    const currentMockTime = dayjs.tz('2026-10-22 17:17', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    // Stale appointment from yesterday: Oct 21, 2026
    const apptId = 'APT-PAST-001';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-1',
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-21',
      timeSlot: '11:30',
      bookedStartAt: '11:30',
      status: 'WAITING', // Status as captured in user screenshot
      checkedInAt: null
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-21',
      tokenNumber: 'G-001',
      status: 'waiting',
      patientUid: 'PAT-USER-1'
    });

    // Run no-show sweep
    await noShowSweepJob();

    // Verify appointment was marked NO_SHOW
    const updatedAppt = mockEnv.collections.appointments.get(apptId);
    expect(updatedAppt.status).toBe('no_show');

    // Verify token was marked no_show
    const updatedToken = mockEnv.collections.tokens.get(`tok-${apptId}`);
    expect(updatedToken.status).toBe('no_show');

    // Verify getMyQueueStatus rejects past appointment and returns hasAppointment: false
    const req = { user: { uid: 'PAT-USER-1' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(false);
  });

  // 2. A same-day appointment whose grace period has expired
  it('2. A same-day appointment whose grace period has expired without check-in is transitioned and removed', async () => {
    // Current time: 11:05 AM IST (65 mins past 10:00 AM slot -> silent no-show window expired)
    const currentMockTime = dayjs.tz('2026-10-22 11:05', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptId = 'APT-TODAY-EXPIRED';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-2',
      doctorId: 'DOC-001',
      date: '2026-10-22',
      timeSlot: '10:00',
      bookedStartAt: '10:00',
      status: 'booked',
      checkedInAt: null
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      tokenNumber: 'G-002',
      status: 'waiting',
      patientUid: 'PAT-USER-2'
    });

    // Under getMyQueueStatus, grace period expired (10:15 >= 10:00 + 5m) -> marks no_show
    const req = { user: { uid: 'PAT-USER-2' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(false);
    expect(mockEnv.collections.appointments.get(apptId).status).toBe('no_show');
    expect(mockEnv.collections.tokens.get(`tok-${apptId}`).status).toBe('no_show');
  });

  // 3. An appointment still within its grace period
  it('3. An appointment still within its grace period remains active', async () => {
    // Current time: 10:03 AM IST (within 5 min grace of 10:00 AM slot)
    const currentMockTime = dayjs.tz('2026-10-22 10:03', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptId = 'APT-GRACE-VALID';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-3',
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      timeSlot: '10:00',
      bookedStartAt: '10:00',
      status: 'booked',
      checkedInAt: null
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      tokenNumber: 'G-003',
      status: 'waiting',
      patientUid: 'PAT-USER-3'
    });

    const req = { user: { uid: 'PAT-USER-3' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(true);
    expect(mockEnv.collections.appointments.get(apptId).status).toBe('booked');
  });

  // 4. A patient who has checked in
  it('4. A patient who has checked in is NOT cancelled or expired even if time has passed', async () => {
    // Current time: 11:30 AM IST (well after 09:30 slot)
    const currentMockTime = dayjs.tz('2026-10-22 11:30', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptId = 'APT-CHECKED-IN';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-4',
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      timeSlot: '09:30',
      bookedStartAt: '09:30',
      status: 'checked_in',
      checkedInAt: dayjs.tz('2026-10-22 09:20', HOSPITAL_TZ).toISOString()
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      tokenNumber: 'G-004',
      status: 'waiting',
      patientUid: 'PAT-USER-4'
    });

    const req = { user: { uid: 'PAT-USER-4' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(true);
    expect(mockEnv.collections.appointments.get(apptId).status).toBe('checked_in');
  });

  // 5. An appointment already called or being served
  it('5. An appointment called or in consultation is never marked no-show', async () => {
    const currentMockTime = dayjs.tz('2026-10-22 11:45', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptId = 'APT-IN-CONSULT';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-5',
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      timeSlot: '11:00',
      status: 'in_consultation',
      consultStartAt: dayjs.tz('2026-10-22 11:20', HOSPITAL_TZ).toISOString()
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      tokenNumber: 'G-005',
      status: 'serving',
      patientUid: 'PAT-USER-5'
    });

    await noShowSweepJob();

    expect(mockEnv.collections.appointments.get(apptId).status).toBe('in_consultation');
    expect(mockEnv.collections.tokens.get(`tok-${apptId}`).status).toBe('serving');
  });

  // 6. A completed appointment
  it('6. A completed appointment reflects completed status without rejoining waiting queue', async () => {
    const currentMockTime = dayjs.tz('2026-10-22 12:30', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptId = 'APT-COMPLETED';
    mockEnv.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid: 'PAT-USER-6',
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      timeSlot: '11:30',
      status: 'completed',
      completedAt: dayjs.tz('2026-10-22 12:15', HOSPITAL_TZ).toISOString()
    });

    mockEnv.collections.tokens.set(`tok-${apptId}`, {
      id: `tok-${apptId}`,
      appointmentId: apptId,
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      tokenNumber: 'G-006',
      status: 'completed',
      patientUid: 'PAT-USER-6'
    });

    const req = { user: { uid: 'PAT-USER-6' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(true);
    expect(jsonResult.isCompleted).toBe(true);
    expect(jsonResult.queueSummary.positionText).toBe('CONSULTATION COMPLETED');
  });

  // 7. Removal of expired appointments from queue positions and counts
  it('7. Expired unattended appointments are excluded from queue positions and counts', async () => {
    // Current time: 10:30 AM IST
    const currentMockTime = dayjs.tz('2026-10-22 10:30', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    // Patient 1: 09:00 AM (expired, no check-in)
    const appt1 = 'APT-EXPIRED-P1';
    mockEnv.collections.appointments.set(appt1, {
      id: appt1,
      doctorId: 'DOC-001',
      date: '2026-10-22',
      bookedStartAt: '09:00',
      timeSlot: '09:00',
      status: 'not_arrived'
    });

    // Patient 2: 10:00 AM (checked in, ready)
    const appt2 = 'APT-VALID-P2';
    mockEnv.collections.appointments.set(appt2, {
      id: appt2,
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      bookedStartAt: '10:00',
      timeSlot: '10:00',
      status: 'checked_in',
      checkinTime: dayjs.tz('2026-10-22 09:55', HOSPITAL_TZ).toISOString()
    });

    // Patient 3: 10:15 AM (checked in, ready)
    const appt3 = 'APT-VALID-P3';
    mockEnv.collections.appointments.set(appt3, {
      id: appt3,
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      date: '2026-10-22',
      bookedStartAt: '10:15',
      timeSlot: '10:15',
      status: 'checked_in',
      checkinTime: dayjs.tz('2026-10-22 10:05', HOSPITAL_TZ).toISOString()
    });

    const snapshot = await calculateQueueReadOnly('DOC-001', '2026-10-22');

    // Only Patient 2 and Patient 3 are in the active queue
    expect(snapshot.readyCandidates.length).toBe(2);
    expect(snapshot.readyCandidates[0].id).toBe(appt2);
    expect(snapshot.readyCandidates[1].id).toBe(appt3);

    // Patient 1 (expired) is NOT in notYetHereList
    const notYetHere = snapshot.readyCandidates[0].notYetHere || [];
    expect(notYetHere.some(c => c.id === appt1)).toBe(false);
  });

  // 8. Correct behavior across Asia/Kolkata date boundaries
  it('8. Correct behavior across Asia/Kolkata date boundaries (UTC 19:30 Oct 22 is IST 01:00 Oct 23)', () => {
    // 19:30 UTC on Oct 22 is 01:00 AM IST on Oct 23
    const utcDate = new Date('2026-10-22T19:30:00.000Z');

    const todayIST = getHospitalTodayStr(utcDate);
    expect(todayIST).toBe('2026-10-23');

    const timeIST = getHospitalTimeStr(utcDate);
    expect(timeIST).toBe('01:00');

    // Slot on Oct 22 is in past relative to Oct 23 IST
    expect(isSlotInPast('2026-10-22', '11:00', utcDate)).toBe(true);
    expect(isGracePeriodExpired('2026-10-22', '11:00', 5, utcDate)).toBe(true);

    // Slot on Oct 23 at 09:00 AM is in future relative to 01:00 AM IST
    expect(isSlotInPast('2026-10-23', '09:00', utcDate)).toBe(false);
  });

  // 9. Removal of the "Leave Home Now Estimate" UI and backend features
  it('9. "Leave Home Now Estimate" feature and travel time controls are completely removed from source code', () => {
    const liveTrackerPath = path.resolve(__dirname, '../../client/src/components/patient/LiveQueueTracker.jsx');
    const liveTrackerCode = fs.readFileSync(liveTrackerPath, 'utf8');

    expect(liveTrackerCode).not.toContain('LEAVE HOME NOW ESTIMATE');
    expect(liveTrackerCode).not.toContain('Your Travel Time');
    expect(liveTrackerCode).not.toContain('travelMinutes');

    const queueCardPath = path.resolve(__dirname, '../../client/src/components/patient/PatientLiveQueueCard.jsx');
    const queueCardCode = fs.readFileSync(queueCardPath, 'utf8');

    expect(queueCardCode).not.toContain('LEAVE HOME NOW ESTIMATE');
    expect(queueCardCode).not.toContain('handleUpdateTravelMinutes');
    expect(queueCardCode).not.toContain('travelMinutes');

    const bookingFormPath = path.resolve(__dirname, '../../client/src/components/patient/AppointmentBookingForm.jsx');
    const bookingFormCode = fs.readFileSync(bookingFormPath, 'utf8');

    expect(bookingFormCode).not.toContain('Travel Time (Minutes - Optional)');
    expect(bookingFormCode).not.toContain('travelMinutes');
  });

  // 10. Future appointment displays scheduled turn time and isFutureAppointment flag
  it('10. Future appointment returns isFutureAppointment: true and scheduled turn time without real-time wait estimation', async () => {
    // Current time: 07:38 PM on Oct 25
    const currentMockTime = dayjs.tz('2026-10-25 19:38', HOSPITAL_TZ).toDate();
    clock.setMockTime(currentMockTime);

    const apptFuture = 'APT-FUTURE-OCT26';
    mockEnv.collections.appointments.set(apptFuture, {
      id: apptFuture,
      appointmentId: apptFuture,
      doctorId: 'DOC-001',
      doctorUid: 'DOC-001',
      patientUid: 'PAT-FUTURE-1',
      date: '2026-10-26',
      bookedStartAt: '09:00',
      timeSlot: '09:00',
      status: 'booked'
    });

    const req = { user: { uid: 'PAT-FUTURE-1' } };
    let jsonResult = null;
    const res = {
      status: () => ({
        json: (data) => { jsonResult = data; }
      })
    };
    await getMyQueueStatus(req, res, () => {});

    expect(jsonResult.hasAppointment).toBe(true);
    expect(jsonResult.isFutureAppointment).toBe(true);
    expect(jsonResult.queueSummary.isFutureAppointment).toBe(true);
    expect(jsonResult.queueSummary.estimatedWaitMinutes).toBeNull();
    expect(jsonResult.queueSummary.estimatedTurnTime).toBe('09:00 AM');
    expect(jsonResult.appointment.timeSlot).toBe('09:00');
    expect(jsonResult.liveWait).toBeNull();
  });
});

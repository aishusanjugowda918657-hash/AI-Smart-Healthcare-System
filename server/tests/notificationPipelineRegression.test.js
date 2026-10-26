import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import clock from '../src/utils/clock.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { parseSlotTimeToDate } from '../src/utils/timezoneDate.js';
import flags from '../src/config/flags.js';
import admin from 'firebase-admin';

dayjs.extend(utc);
dayjs.extend(timezone);

const HOSPITAL_TZ = 'Asia/Kolkata';

// In-Memory Firestore Mock for deterministic testing
const createInMemoryDb = () => {
  const collections = {
    doctors: new Map(),
    slots: new Map(),
    appointments: new Map(),
    appointment_locks: new Map(),
    counters: new Map(),
    leaves: new Map(),
    departments: new Map(),
    auditLogs: new Map(),
    notifications: new Map(),
    reminders: new Map(),
    users: new Map(),
    queues: new Map(),
    alerts: new Map(),
    waitPredictions: new Map(),
    followups: new Map(),
    consultationStats: new Map(),
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
      if (opts.merge && col.has(docId)) {
        col.set(docId, { ...col.get(docId), ...data });
      } else {
        col.set(docId, { ...data });
      }
    },
    update: async (data) => {
      const col = getCol(colName);
      const existing = col.get(docId) || {};
      col.set(docId, { ...existing, ...data });
    },
    delete: async () => {
      const col = getCol(colName);
      col.delete(docId);
    }
  });

  const makeQuery = (colName, filters = [], orderByClause = null, limitVal = null) => ({
    where: (field, op, val) => makeQuery(colName, [...filters, { field, op, val }], orderByClause, limitVal),
    orderBy: (field, direction = 'asc') => makeQuery(colName, filters, { field, direction }, limitVal),
    limit: (n) => makeQuery(colName, filters, orderByClause, n),
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
          const valA = a.data()[orderByClause.field];
          const valB = b.data()[orderByClause.field];
          if (valA < valB) return orderByClause.direction === 'desc' ? 1 : -1;
          if (valA > valB) return orderByClause.direction === 'desc' ? -1 : 1;
          return 0;
        });
      }

      if (typeof limitVal === 'number') {
        docs = docs.slice(0, limitVal);
      }

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length
      };
    }
  });

  const db = {
    collection: (name) => {
      const q = makeQuery(name);
      return {
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
        where: (field, op, val) => q.where(field, op, val),
        orderBy: (field, direction) => q.orderBy(field, direction),
        limit: (n) => q.limit(n),
        get: async () => q.get()
      };
    },
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

let inMemDb = createInMemoryDb();

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
import { notify } from '../src/services/notify.js';
import { appointmentRemindersJob } from '../src/jobs/scheduler.js';
import { recalculateQueue } from '../src/services/queueService.js';

describe('Notification Pipeline Comprehensive Regression Test Suite', () => {
  beforeEach(() => {
    inMemDb = createInMemoryDb();
    clock.reset();
  });

  afterEach(() => {
    clock.reset();
    vi.restoreAllMocks();
  });

  it('1. Appointment Booking triggers APPOINTMENT_CONFIRMED and pre-schedules 24h & 2h reminders', async () => {
    // Current hospital time: 2026-10-23 09:00:00 IST
    const simTime = dayjs.tz('2026-10-23 09:00:00', HOSPITAL_TZ).toDate();
    clock.set(simTime);

    const doctorId = 'DOC-NOTIF-01';
    const doctorUid = 'uid-doc-01';
    const patientUid = 'patient-uid-100';

    inMemDb.collections.doctors.set(doctorId, {
      doctorId,
      uid: doctorUid,
      fullName: 'Dr. Notification Test',
      departmentId: 'dept-gen',
      active: true
    });

    const slotId = `${doctorId}_2026-10-24_1100`;
    inMemDb.collections.slots.set(slotId, {
      id: slotId,
      doctorId,
      date: '2026-10-24',
      startAt: '11:00',
      status: 'free'
    });

    inMemDb.collections.users.set(patientUid, {
      uid: patientUid,
      name: 'Aarav Patel',
      role: 'patient',
      fcmTokens: [{ token: 'valid-fcm-token-123', device: 'web' }]
    });

    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({
        slotIds: [slotId],
        patientHealthId: 'HEALTH-NOTIF-01',
        patientName: 'Aarav Patel',
        doctorId,
        date: '2026-10-24',
        reasonText: 'Regular health consultation',
        disclaimerAck: { acknowledged: true }
      });

    expect(res.status).toBe(201);
    const apptId = res.body.data.id;

    // Check notifications collection for APPOINTMENT_CONFIRMED
    const notifs = Array.from(inMemDb.collections.notifications.values());
    const confirmNotif = notifs.find(n => n.type === 'APPOINTMENT_CONFIRMED');
    expect(confirmNotif).toBeDefined();
    expect(confirmNotif.uid).toBe(patientUid);
    expect(confirmNotif.title).toContain('Aarav Patel: Appointment confirmed');
    expect(confirmNotif.status).toBe('in_app_only');

    // Check reminders collection for scheduled 24h and 2h reminders
    const reminders = Array.from(inMemDb.collections.reminders.values());
    const rem24h = reminders.find(r => r.appointmentId === apptId && r.type === 'appointment_24h');
    const rem2h = reminders.find(r => r.appointmentId === apptId && r.type === 'appointment_2h');

    expect(rem24h).toBeDefined();
    expect(rem24h.status).toBe('pending');
    const expected24h = dayjs.tz('2026-10-23 11:00:00', HOSPITAL_TZ).valueOf();
    expect(new Date(rem24h.dueAt).getTime()).toBe(expected24h);

    expect(rem2h).toBeDefined();
    expect(rem2h.status).toBe('pending');
    const expected2h = dayjs.tz('2026-10-24 09:00:00', HOSPITAL_TZ).valueOf();
    expect(new Date(rem2h.dueAt).getTime()).toBe(expected2h);
  });

  it('2. Timezone accuracy: parseSlotTimeToDate parses Asia/Kolkata correctly without UTC skew', () => {
    const parsed = parseSlotTimeToDate('2026-10-24', '09:00');
    // In IST (UTC+5:30), 09:00 IST is 03:30 UTC
    expect(parsed.toISOString()).toBe('2026-10-24T03:30:00.000Z');
  });

  it('3. Cancellation reconciliation: cancelling appointment marks pending reminders as cancelled', async () => {
    const patientUid = 'patient-cancel-01';
    const apptId = 'appt-cancel-123';

    inMemDb.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid,
      patientName: 'Dev Sharma',
      status: 'booked',
      date: '2026-10-24',
      timeSlot: '14:00',
      doctorId: 'DOC-01'
    });

    inMemDb.collections.reminders.set(`rem_24h_${apptId}`, {
      id: `rem_24h_${apptId}`,
      appointmentId: apptId,
      status: 'pending',
      type: 'appointment_24h'
    });

    inMemDb.collections.reminders.set(`rem_2h_${apptId}`, {
      id: `rem_2h_${apptId}`,
      appointmentId: apptId,
      status: 'pending',
      type: 'appointment_2h'
    });

    const res = await request(app)
      .post(`/api/appointments/${apptId}/cancel`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({ reason: 'Feeling better' });

    expect(res.status).toBe(200);

    const rem24h = inMemDb.collections.reminders.get(`rem_24h_${apptId}`);
    const rem2h = inMemDb.collections.reminders.get(`rem_2h_${apptId}`);
    expect(rem24h.status).toBe('cancelled');
    expect(rem2h.status).toBe('cancelled');

    const notifs = Array.from(inMemDb.collections.notifications.values());
    const cancelNotif = notifs.find(n => n.type === 'APPOINTMENT_CANCELLED');
    expect(cancelNotif).toBeDefined();
    expect(cancelNotif.uid).toBe(patientUid);
  });

  it('4. Rescheduling reconciliation: cancels old reminders, schedules new ones, and sends notification', async () => {
    const patientUid = 'patient-resched-01';
    const apptId = 'appt-resched-456';
    const doctorId = 'DOC-01';
    const oldSlotId = `${doctorId}_2026-10-24_1000`;
    const newSlotId = `${doctorId}_2026-10-25_1500`;

    clock.set(dayjs.tz('2026-10-23 09:00:00', HOSPITAL_TZ).toDate());

    inMemDb.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid,
      patientHealthId: 'HEALTH-R-01',
      patientName: 'Priya Verma',
      status: 'booked',
      date: '2026-10-24',
      timeSlot: '10:00',
      slotId: oldSlotId,
      doctorId,
      doctorName: 'Dr. Smith'
    });

    inMemDb.collections.slots.set(newSlotId, {
      id: newSlotId,
      doctorId,
      date: '2026-10-25',
      startAt: '15:00',
      status: 'free'
    });

    inMemDb.collections.reminders.set(`rem_24h_${apptId}`, {
      id: `rem_24h_${apptId}`,
      appointmentId: apptId,
      status: 'pending',
      type: 'appointment_24h'
    });

    const res = await request(app)
      .post(`/api/appointments/${apptId}/reschedule`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send({
        newSlotId,
        newDate: '2026-10-25',
        newTime: '15:00'
      });

    expect(res.status).toBe(200);

    expect(inMemDb.collections.reminders.get(`rem_24h_${apptId}`).status).toBe('cancelled');

    const reminders = Array.from(inMemDb.collections.reminders.values());
    const newReminders = reminders.filter(r => r.appointmentId === apptId && r.status === 'pending');
    expect(newReminders.length).toBeGreaterThanOrEqual(1);

    const notifs = Array.from(inMemDb.collections.notifications.values());
    const reschedNotif = notifs.find(n => n.type === 'APPOINTMENT_RESCHEDULED');
    expect(reschedNotif).toBeDefined();
    expect(reschedNotif.body).toContain('2026-10-25');
  });

  it('5. Turn Called Notification: calling a patient dispatches TURN_CALLED notification', async () => {
    const doctorUid = 'doc-caller-01';
    const doctorId = 'DOC-CALL-01';
    const patientUid = 'patient-turn-01';
    const apptId = 'appt-turn-789';

    inMemDb.collections.doctors.set(doctorUid, {
      doctorId,
      uid: doctorUid,
      fullName: 'Dr. Caller'
    });

    inMemDb.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      doctorId,
      date: '2026-10-23',
      patientUid,
      patientName: 'Rohan Gupta',
      status: 'checked_in',
      tokenLabel: 'G-005',
      tokenNumber: 5
    });

    const res = await request(app)
      .post(`/api/queue/call/${apptId}`)
      .set('x-demo-uid', doctorUid)
      .set('x-demo-role', 'doctor')
      .send({ reason: 'Patient is waiting and ready' });

    expect(res.status).toBe(200);

    const notifs = Array.from(inMemDb.collections.notifications.values());
    const turnNotif = notifs.find(n => n.type === 'TURN_CALLED');
    expect(turnNotif).toBeDefined();
    expect(turnNotif.uid).toBe(patientUid);
    expect(turnNotif.title).toContain('Rohan Gupta: It is your turn!');
  });

  it('6. Queue Rejoin Notification: late patient rejoining queue receives QUEUE_REJOINED alert', async () => {
    const patientUid = 'patient-rejoin-01';
    const apptId = 'appt-rejoin-101';
    const doctorId = 'DOC-01';

    clock.set(dayjs.tz('2026-10-23 10:15:00', HOSPITAL_TZ).toDate());

    inMemDb.collections.appointments.set(apptId, {
      id: apptId,
      appointmentId: apptId,
      patientUid,
      patientName: 'Sneha Rao',
      doctorId,
      date: '2026-10-23',
      bookedStartAt: '10:00',
      timeSlot: '10:00',
      status: 'late'
    });

    const res = await request(app)
      .post(`/api/appointments/${apptId}/rejoin`)
      .set('x-demo-uid', patientUid)
      .set('x-demo-role', 'patient')
      .send();

    expect(res.status).toBe(200);

    const notifs = Array.from(inMemDb.collections.notifications.values());
    const rejoinNotif = notifs.find(n => n.type === 'QUEUE_REJOINED');
    expect(rejoinNotif).toBeDefined();
    expect(rejoinNotif.uid).toBe(patientUid);
    expect(rejoinNotif.title).toContain('Sneha Rao: Rejoined the Queue');
  });

  it('7. Upcoming-Turn Notification: recalculateQueue dispatches alert when patient is within 3 turns', async () => {
    const doctorId = 'DOC-QUEUE-01';
    const date = '2026-10-23';
    const patientUid = 'patient-upcoming-01';

    clock.set(dayjs.tz('2026-10-23 09:30:00', HOSPITAL_TZ).toDate());

    inMemDb.collections.appointments.set('appt-q-01', {
      id: 'appt-q-01',
      doctorId,
      date,
      patientUid: 'patient-other',
      status: 'checked_in',
      bookedStartAt: '09:10',
      live: { position: 1, waitMinLow: 0, waitMinHigh: 10 }
    });

    inMemDb.collections.appointments.set('appt-q-02', {
      id: 'appt-q-02',
      doctorId,
      date,
      patientUid,
      patientName: 'Kavita Mehta',
      status: 'checked_in',
      bookedStartAt: '09:20',
      tokenLabel: 'G-002',
      live: { position: 5, waitMinLow: 40, waitMinHigh: 50 }
    });

    const recalc = await recalculateQueue(doctorId, date);
    expect(recalc.pushes.length).toBeGreaterThanOrEqual(1);

    const notifs = Array.from(inMemDb.collections.notifications.values());
    const upcomingNotif = notifs.find(n => n.type === 'QUEUE_UPCOMING_TURN');
    expect(upcomingNotif).toBeDefined();
    expect(upcomingNotif.uid).toBe(patientUid);
    expect(upcomingNotif.title).toContain('Kavita Mehta: Your turn is coming up soon!');
  });

  it('8. Overdue reminders policy: scheduler expires old 24h reminders instead of sending late on appointment day', async () => {
    // Current time is 2 hours before the appointment
    const nowTime = dayjs.tz('2026-10-23 12:00:00', HOSPITAL_TZ).toDate();
    clock.set(nowTime);

    const apptId = 'appt-overdue-999';
    inMemDb.collections.appointments.set(apptId, {
      id: apptId,
      date: '2026-10-23',
      timeSlot: '14:00',
      status: 'booked',
      reminder24hSent: false,
      reminder2hSent: false
    });

    const result = await appointmentRemindersJob({ nowOverride: nowTime });
    expect(result.success).toBe(true);

    const apptAfter = inMemDb.collections.appointments.get(apptId);
    expect(apptAfter.reminder24hSkipped).toBe('overdue_expired');
    expect(apptAfter.reminder24hSent).toBe(true);

    // 2h reminder is scheduled because diffHours is 2
    expect(apptAfter.reminder2hSent).toBe(true);
    const rem2h = inMemDb.collections.reminders.get(`rem_2h_${apptId}`);
    expect(rem2h).toBeDefined();
  });

  it('9. FCM Invalid token removal: notify cleans permanently unregistered tokens', async () => {
    const testUid = 'user-fcm-cleanup-01';
    const badToken = 'unregistered-device-token-xyz';
    const goodToken = 'valid-active-device-token-abc';

    inMemDb.collections.users.set(testUid, {
      uid: testUid,
      fcmTokens: [
        { token: badToken, device: 'web' },
        { token: goodToken, device: 'web' }
      ]
    });

    const mockMessaging = {
      sendEachForMulticast: vi.fn().mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: false, error: { code: 'messaging/registration-token-not-registered' } },
          { success: true }
        ]
      })
    };

    vi.spyOn(admin, 'apps', 'get').mockReturnValue([{ name: '[DEFAULT]' }]);
    vi.spyOn(admin, 'messaging').mockReturnValue(mockMessaging);

    const pushSpy = vi.spyOn(flags, 'push', 'get').mockReturnValue(true);
    const res = await notify({
      uids: [testUid],
      title: 'FCM Test',
      body: 'Testing token cleanup',
      type: 'system'
    });
    pushSpy.mockRestore();

    expect(res.written).toBe(1);
    expect(res.pushed).toBe(1);

    const userDoc = inMemDb.collections.users.get(testUid);
    expect(userDoc.fcmTokens.some(t => t.token === badToken)).toBe(false);
    expect(userDoc.fcmTokens.some(t => t.token === goodToken)).toBe(true);
  });

  it('10. Admin diagnostics endpoint and safe test-send workflow', async () => {
    const adminUid = 'admin-user-001';

    inMemDb.collections.users.set(adminUid, {
      uid: adminUid,
      role: 'admin'
    });

    inMemDb.collections.notifications.set('notif-1', {
      id: 'notif-1',
      uid: adminUid,
      type: 'APPOINTMENT_CONFIRMED',
      status: 'sent_to_provider',
      pushStatus: 'sent',
      attempts: 1,
      createdAt: new Date()
    });

    // 1. GET /api/admin/notifications/diagnostics
    const diagRes = await request(app)
      .get('/api/admin/notifications/diagnostics')
      .set('x-demo-uid', adminUid)
      .set('x-demo-role', 'admin');

    expect(diagRes.status).toBe(200);
    expect(diagRes.body.data.channels.inApp.configured).toBe(true);
    expect(diagRes.body.data.channels.sms.configured).toBe(false);
    expect(diagRes.body.data.channels.email.configured).toBe(false);
    expect(diagRes.body.data.scheduler.timezone).toBe('Asia/Kolkata');
    expect(diagRes.body.data.metrics.notifications.sentToProvider).toBe(1);

    // 2. Safe test-send: Sends only to caller
    const testSendRes = await request(app)
      .post('/api/admin/notifications/test-send')
      .set('x-demo-uid', adminUid)
      .set('x-demo-role', 'admin')
      .send();

    expect(testSendRes.status).toBe(200);
    expect(testSendRes.body.data.recipientUid).toBe(adminUid);
    expect(testSendRes.body.data.result.written).toBe(1);
  });
});

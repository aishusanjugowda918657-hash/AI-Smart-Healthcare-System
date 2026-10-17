import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as firebaseConfig from '../src/config/firebase.js';
import { calculateQueueReadOnly, recalculateQueue } from '../src/services/queueService.js';
import { clock } from '../src/utils/clock.js';

describe('Phase 92 — Safe Read-Only Doctor Queue Mode Suite', () => {
  const doctorId = 'DOC-001';
  const doctorUid = 'HaquKenPyG2V6TTm3oNzwTWsWfev'; // Dr. Sarah Smith
  const otherDoctorId = 'DOC-002';
  const otherDoctorUid = 'smWmj6KUJXwMPPTzXtu4GORVugh3'; // Dr. Rahul Kumar
  const date = '2026-10-16';

  let mockDb;
  let writeCallCount;
  let writesHistory;

  beforeEach(() => {
    clock.reset();
    clock.setMockTime('2026-10-16T10:00:00Z');
    writeCallCount = 0;
    writesHistory = [];

    // Track every single write method across mock database
    const recordWrite = (collectionName, method, docId, data) => {
      writeCallCount++;
      writesHistory.push({ collectionName, method, docId, data });
    };

    // Construct an isolated mock Firestore DB
    const mockAppointments = [
      {
        id: 'appt-1',
        doctorId: 'DOC-001',
        doctorUid,
        date: '2026-10-16',
        status: 'in_consultation',
        patientName: 'Active Patient',
        patientHealthId: 'HID-001',
        calledAt: '2026-10-16T09:50:00Z',
        expectedDurationMin: 15,
        bookedStartAt: '2026-10-16T09:45:00Z'
      },
      {
        id: 'appt-2',
        doctorId: 'DOC-001',
        doctorUid,
        date: '2026-10-16',
        status: 'checked_in',
        priorityScore: 80,
        clinicalLevel: 2,
        urgencyLevel: 'urgent',
        patientName: 'Ready Patient 1',
        patientHealthId: 'HID-002',
        tokenLabel: 'T-001',
        arrivalTime: '2026-10-16T09:40:00Z',
        bookedStartAt: '2026-10-16T10:00:00Z'
      },
      {
        id: 'appt-3',
        doctorId: 'DOC-001',
        doctorUid,
        date: '2026-10-16',
        status: 'checked_in',
        priorityScore: 50,
        clinicalLevel: 1,
        urgencyLevel: 'routine',
        patientName: 'Ready Patient 2',
        patientHealthId: 'HID-003',
        tokenLabel: 'T-002',
        arrivalTime: '2026-10-16T09:45:00Z',
        bookedStartAt: '2026-10-16T10:15:00Z'
      },
      {
        id: 'appt-4',
        doctorId: 'DOC-001',
        doctorUid,
        date: '2026-10-16',
        status: 'booked',
        patientName: 'Not Arrived Yet',
        patientHealthId: 'HID-004',
        bookedStartAt: '2026-10-16T10:30:00Z',
        timeSlot: '10:30'
      },
      {
        id: 'appt-completed-1',
        doctorId: 'DOC-001',
        doctorUid,
        date: '2026-10-16',
        status: 'completed',
        actualDurationMinutes: 14,
        expectedDurationMin: 15
      }
    ];

    const mockQueues = {
      [`${doctorId}_${date}`]: {
        doctorId,
        date,
        delayMin: 0,
        breakUntil: null,
        currentAppointmentId: 'appt-1'
      }
    };

    const mockDoctors = {
      [doctorUid]: { doctorId: 'DOC-001', uid: doctorUid, role: 'doctor' },
      [doctorId]: { doctorId: 'DOC-001', uid: doctorUid, role: 'doctor' },
      [otherDoctorUid]: { doctorId: 'DOC-002', uid: otherDoctorUid, role: 'doctor' },
      [otherDoctorId]: { doctorId: 'DOC-002', uid: otherDoctorUid, role: 'doctor' }
    };

    mockDb = {
      collection: (colName) => ({
        doc: (docId) => ({
          get: async () => {
            if (colName === 'queues') {
              const data = mockQueues[docId];
              return { exists: !!data, data: () => data || {} };
            }
            if (colName === 'doctors') {
              const data = mockDoctors[docId];
              return { exists: !!data, data: () => data || {} };
            }
            if (colName === 'appointments') {
              const found = mockAppointments.find((a) => a.id === docId);
              return { exists: !!found, id: docId, data: () => found || {} };
            }
            if (colName === 'consultationStats') {
              return { exists: false, data: () => ({}) };
            }
            return { exists: false, data: () => ({}) };
          },
          set: async (data, opts) => {
            recordWrite(colName, 'doc.set', docId, data);
            if (colName === 'queues') mockQueues[docId] = { ...(mockQueues[docId] || {}), ...data };
            return Promise.resolve();
          },
          update: async (data) => {
            recordWrite(colName, 'doc.update', docId, data);
            return Promise.resolve();
          }
        }),
        where: (field, op, val) => ({
          where: (f2, op2, v2) => ({
            get: async () => {
              if (colName === 'appointments') {
                const filtered = mockAppointments.filter((a) => {
                  const match1 = op === '==' ? a[field] === val : true;
                  const match2 = op2 === '==' ? a[f2] === v2 : true;
                  return match1 && match2;
                });
                return {
                  docs: filtered.map((d) => ({
                    id: d.id,
                    data: () => ({ ...d }),
                    ref: {
                      update: async (data) => recordWrite('appointments', 'ref.update', d.id, data)
                    }
                  }))
                };
              }
              return { docs: [] };
            }
          }),
          get: async () => {
            if (colName === 'appointments') {
              const filtered = mockAppointments.filter((a) => a[field] === val);
              return {
                docs: filtered.map((d) => ({
                  id: d.id,
                  data: () => ({ ...d }),
                  ref: {
                    update: async (data) => recordWrite('appointments', 'ref.update', d.id, data)
                  }
                }))
              };
            }
            return { docs: [] };
          }
        }),
        add: async (data) => {
          recordWrite(colName, 'collection.add', 'auto-id', data);
          return { id: 'auto-id' };
        }
      }),
      batch: () => ({
        update: (ref, data) => recordWrite('batch', 'batch.update', 'batch-ref', data),
        set: (ref, data) => recordWrite('batch', 'batch.set', 'batch-ref', data),
        commit: async () => {
          recordWrite('batch', 'batch.commit', 'batch', {});
          return Promise.resolve();
        }
      }),
      runTransaction: async (fn) => fn({
        get: async (ref) => ({ exists: true, data: () => ({}) }),
        set: (ref, data) => recordWrite('tx', 'tx.set', 'tx-ref', data),
        update: (ref, data) => recordWrite('tx', 'tx.update', 'tx-ref', data)
      })
    };

    // Spy assertDbConnected to return isolated mockDb
    vi.spyOn(firebaseConfig, 'assertDbConnected').mockReturnValue(mockDb);
  });

  describe('1. Dedicated Read-Only Endpoint Contract & Memory Calculation', () => {
    it('returns 200 with queueData, readyCandidates, notCheckedIn, and isReadOnly flag', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toHaveProperty('queue');
      expect(data).toHaveProperty('currentConsultation');
      expect(data).toHaveProperty('readyCandidates');
      expect(data).toHaveProperty('notCheckedIn');
      expect(data).toHaveProperty('totalActive');
      expect(data.isReadOnly).toBe(true);
      expect(data.queue.isReadOnly).toBe(true);

      // Verify ready candidates order and wait times calculated in memory
      expect(data.readyCandidates.length).toBe(2);
      expect(data.readyCandidates[0].id).toBe('appt-2'); // higher priority score (80 vs 50)
      expect(data.readyCandidates[0].live).toBeDefined();
      expect(data.readyCandidates[0].live.position).toBe(1);
      expect(typeof data.readyCandidates[0].live.waitMinLow).toBe('number');
      expect(typeof data.readyCandidates[0].live.waitMinHigh).toBe('number');

      // Verify notCheckedIn contains the future booked appointment
      expect(data.notCheckedIn.length).toBe(1);
      expect(data.notCheckedIn[0].id).toBe('appt-4');
      expect(data.notCheckedIn[0].live).toBeDefined();
    });

    it('alias endpoint /today/readonly behaves identically', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/today/readonly?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isReadOnly).toBe(true);
      expect(res.body.data.readyCandidates.length).toBe(2);
    });
  });

  describe('2. Absolute Zero Writes Guarantee', () => {
    it('executes 0 database writes to queues, appointments, waitPredictions, or auditLogs', async () => {
      expect(writeCallCount).toBe(0);

      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify strictly 0 writes occurred
      expect(writeCallCount).toBe(0);
      expect(writesHistory).toEqual([]);
    });

    it('repeated requests execute 0 writes and do not trigger a cascading loop', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
          .set('x-demo-uid', doctorUid)
          .set('x-demo-role', 'doctor');

        expect(res.status).toBe(200);
      }

      // Even across 5 rapid consecutive reads, zero writes occur
      expect(writeCallCount).toBe(0);
      expect(writesHistory).toHaveLength(0);
    });

    it('calling service calculateQueueReadOnly directly produces 0 writes', async () => {
      const result = await calculateQueueReadOnly(doctorId, date);

      expect(result).toBeDefined();
      expect(result.isReadOnly).toBe(true);
      expect(result.readyCandidates.length).toBe(2);
      expect(writeCallCount).toBe(0);
    });
  });

  describe('3. Contrast with Operational Recalculate Path', () => {
    it('operational recalculateQueue DOES perform writes (batch commit, queue set)', async () => {
      const result = await recalculateQueue(doctorId, date);

      expect(result).toBeDefined();
      // Operational path commits batch updates and writes queue doc
      expect(writeCallCount).toBeGreaterThan(0);
      const writeMethods = writesHistory.map((w) => w.method);
      expect(writeMethods).toContain('doc.set'); // queueRef.set
    });
  });

  describe('4. Authorization & Role Protection', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(writeCallCount).toBe(0);
    });

    it('rejects patient role with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', 'patient-uid-123')
        .set('x-demo-role', 'patient');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(writeCallCount).toBe(0);
    });

    it('CROSS-DOCTOR DENIAL: Dr. Rahul (DOC-002) is forbidden from reading Dr. Sarah (DOC-001) queue', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', otherDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/cannot access or modify another doctor's queue/i);
      expect(writeCallCount).toBe(0);
    });

    it('allows Admin staff override to inspect doctor queue', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', 'admin-uid-999')
        .set('x-demo-role', 'admin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isReadOnly).toBe(true);
      expect(writeCallCount).toBe(0);
    });

    it('allows Receptionist staff override to inspect doctor queue', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', 'reception-uid-888')
        .set('x-demo-role', 'reception');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(writeCallCount).toBe(0);
    });
  });

  describe('5. Operational Path Call-Next Separation', () => {
    it('POST /api/queue/call-next invokes operational transaction path with role protection', async () => {
      // Unauthenticated call-next is rejected
      const unauthRes = await request(app)
        .post('/api/queue/call-next')
        .send({ doctorId, date });
      expect(unauthRes.status).toBe(401);

      // Patient is forbidden from call-next
      const patientRes = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', 'patient-uid-123')
        .set('x-demo-role', 'patient')
        .send({ doctorId, date });
      expect(patientRes.status).toBe(403);

      // Authorized doctor reaches operational transaction path
      const docRes = await request(app)
        .post('/api/queue/call-next')
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor')
        .send({ doctorId, date });

      expect(docRes.status).toBeLessThan(500);
    });
  });

  describe('6. Phase 94 — GET /today Now Read-Only Verification', () => {
    it('GET /today returns 200 with expected response shape and zero writes', async () => {
      expect(writeCallCount).toBe(0);

      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/today?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toHaveProperty('queue');
      expect(data).toHaveProperty('currentConsultation');
      expect(data).toHaveProperty('readyCandidates');
      expect(data).toHaveProperty('notCheckedIn');
      expect(data).toHaveProperty('totalActive');

      // Phase 94: /today now delegates to calculateQueueReadOnly — zero writes
      expect(writeCallCount).toBe(0);
      expect(writesHistory).toEqual([]);
    });

    it('GET /today response matches GET /readonly response exactly', async () => {
      const readonlyRes = await request(app)
        .get(`/api/queue/doctor/${doctorId}/readonly?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      const todayRes = await request(app)
        .get(`/api/queue/doctor/${doctorId}/today?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');

      expect(readonlyRes.status).toBe(200);
      expect(todayRes.status).toBe(200);

      // Both endpoints should return identical data
      expect(todayRes.body.data.queue).toEqual(readonlyRes.body.data.queue);
      expect(todayRes.body.data.readyCandidates.length).toBe(readonlyRes.body.data.readyCandidates.length);
      expect(todayRes.body.data.notCheckedIn.length).toBe(readonlyRes.body.data.notCheckedIn.length);
      expect(todayRes.body.data.totalActive).toBe(readonlyRes.body.data.totalActive);

      // Zero writes across both calls
      expect(writeCallCount).toBe(0);
    });

    it('GET /today enforces ownership — cross-doctor denial with zero writes', async () => {
      const res = await request(app)
        .get(`/api/queue/doctor/${doctorId}/today?date=${date}`)
        .set('x-demo-uid', otherDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.status).toBe(403);
      expect(writeCallCount).toBe(0);
    });

    it('5 consecutive GET /today requests produce exactly 0 cumulative writes', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .get(`/api/queue/doctor/${doctorId}/today?date=${date}`)
          .set('x-demo-uid', doctorUid)
          .set('x-demo-role', 'doctor');
        expect(res.status).toBe(200);
      }

      expect(writeCallCount).toBe(0);
      expect(writesHistory).toHaveLength(0);
    });

    it('operational recalculateQueue() still writes when called directly (POST path unaffected)', async () => {
      // First: confirm /today is clean
      const readRes = await request(app)
        .get(`/api/queue/doctor/${doctorId}/today?date=${date}`)
        .set('x-demo-uid', doctorUid)
        .set('x-demo-role', 'doctor');
      expect(readRes.status).toBe(200);
      expect(writeCallCount).toBe(0);

      // Now: directly invoke recalculateQueue (simulates POST action path)
      await recalculateQueue(doctorId, date);

      // Operational path DOES write
      expect(writeCallCount).toBeGreaterThan(0);
      const writeMethods = writesHistory.map((w) => w.method);
      expect(writeMethods).toContain('doc.set');
    });
  });
});

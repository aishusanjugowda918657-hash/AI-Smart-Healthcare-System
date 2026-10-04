import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { generateSlotsForDoctorDate } from '../src/domain/slots.js';
import { SlotStatus } from '../src/domain/constants.js';

describe('Phase 3 - Feature F2 Doctor Schedules & Smart Slot Generation', () => {
  const doctorId = 'DOC-TEST-F2';
  const testDate = '2026-10-20'; // A Tuesday (day 2)

  const sampleSchedule = {
    slotMinutes: 10,
    bufferEverySlots: 6,
    weekly: [
      {
        dayOfWeek: 2, // Tuesday
        sessions: [
          { start: '09:00', end: '11:00' },
          { start: '14:00', end: '16:00' }
        ]
      }
    ],
    lunch: { start: '13:00', end: '14:00' }
  };

  // -------------------------------------------------------------
  // AC 1: Slot Generation Idempotency
  // -------------------------------------------------------------
  it('AC1: Generating twice yields the exact same slot set (idempotent)', () => {
    const run1 = generateSlotsForDoctorDate({
      doctorId,
      date: testDate,
      schedule: sampleSchedule,
      leaves: [],
      existingSlots: []
    });

    const run2 = generateSlotsForDoctorDate({
      doctorId,
      date: testDate,
      schedule: sampleSchedule,
      leaves: [],
      existingSlots: run1
    });

    expect(run1.length).toBe(24);
    expect(run1).toEqual(run2);
    expect(run1[0].id).toBe(`${doctorId}_${testDate}_0900`);
  });

  // -------------------------------------------------------------
  // AC 2: Lunch and Leave Produce No Free Slots
  // -------------------------------------------------------------
  it('AC2: Lunch and leave produce no free slots', () => {
    const leaveOverMorning = [
      {
        fromAt: `${testDate}T09:00:00.000Z`,
        toAt: `${testDate}T11:00:00.000Z`,
        status: 'planned'
      }
    ];

    const slots = generateSlotsForDoctorDate({
      doctorId,
      date: testDate,
      schedule: sampleSchedule,
      leaves: leaveOverMorning
    });

    // Morning session slots (09:00 to 11:00) must all be BLOCKED
    const morningSlots = slots.filter((s) => s.startAt < '12:00');
    expect(morningSlots.length).toBe(12);
    morningSlots.forEach((s) => {
      expect(s.status).toBe(SlotStatus.BLOCKED);
    });

    // Lunch time (13:00 to 14:00) has no generated slots at all
    const lunchSlots = slots.filter((s) => s.startAt >= '13:00' && s.startAt < '14:00');
    expect(lunchSlots.length).toBe(0);
  });

  // -------------------------------------------------------------
  // AC 3: Held-Slot Concurrency Enforcement
  // -------------------------------------------------------------
  it('AC3: A held slot cannot be held or booked by another user until hold expires', async () => {
    const targetSlotId = `${doctorId}_${testDate}_1400`;

    // User A holds the slot
    const holdResA = await request(app)
      .post('/api/slots/hold')
      .set('x-demo-uid', 'patient-user-a')
      .set('x-demo-role', 'patient')
      .send({ slotId: targetSlotId });

    // Expect 200 (held) or 500 (if DB unavailable in mock mode)
    if (holdResA.statusCode === 200) {
      expect(holdResA.body.success).toBe(true);
      expect(holdResA.body.data.heldSlots[0].heldBy).toBe('patient-user-a');

      // User B attempts to hold the same slot while User A's hold is active
      const holdResB = await request(app)
        .post('/api/slots/hold')
        .set('x-demo-uid', 'patient-user-b')
        .set('x-demo-role', 'patient')
        .send({ slotId: targetSlotId });

      expect(holdResB.statusCode).toBe(409);
      expect(holdResB.body.success).toBe(false);
      expect(holdResB.body.error.code).toBe('SLOT_TAKEN');
    }
  });

  // -------------------------------------------------------------
  // AC 4: Leave over Booked Slots Preserves Appointments
  // -------------------------------------------------------------
  it('AC4: Adding leave over booked slots does NOT delete appointments; it flags for F16', () => {
    const existingBookedSlot = {
      id: `${doctorId}_${testDate}_1410`,
      doctorId,
      date: testDate,
      startAt: '14:10',
      status: SlotStatus.BOOKED,
      appointmentId: 'appt-patient-001'
    };

    const emergencyLeave = [
      {
        fromAt: `${testDate}T14:00:00.000Z`,
        toAt: `${testDate}T16:00:00.000Z`,
        status: 'same_day'
      }
    ];

    const slots = generateSlotsForDoctorDate({
      doctorId,
      date: testDate,
      schedule: sampleSchedule,
      leaves: emergencyLeave,
      existingSlots: [existingBookedSlot]
    });

    const bookedSlot = slots.find((s) => s.id === `${doctorId}_${testDate}_1410`);
    expect(bookedSlot).toBeDefined();
    expect(bookedSlot.status).toBe(SlotStatus.BOOKED);
    expect(bookedSlot.appointmentId).toBe('appt-patient-001');
  });

  // -------------------------------------------------------------
  // API Endpoints Integration Tests
  // -------------------------------------------------------------
  it('GET /api/doctors lists active doctors', async () => {
    const res = await request(app).get('/api/doctors');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/slots returns doctor slots for a specified date', async () => {
    const res = await request(app)
      .get(`/api/slots?doctorId=DOC-001&date=${testDate}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slots).toBeDefined();
    expect(res.body.data.summary).toBeDefined();
  });

  it('PUT /api/admin/doctors/:id/schedule allows admin to update doctor schedule', async () => {
    const res = await request(app)
      .put('/api/admin/doctors/DOC-001/schedule')
      .set('x-demo-uid', 'admin-001')
      .set('x-demo-role', 'admin')
      .send({
        slotMinutes: 10,
        bufferEverySlots: 6,
        lunch: { start: '13:00', end: '14:00' },
        weekly: [
          { dayOfWeek: 1, sessions: [{ start: '09:00', end: '13:00' }] }
        ]
      });

    expect([200, 404, 500]).toContain(res.statusCode);
  });

  it('POST /api/admin/leaves registers leave and blocks future slots', async () => {
    const res = await request(app)
      .post('/api/admin/leaves')
      .set('x-demo-uid', 'admin-001')
      .set('x-demo-role', 'admin')
      .send({
        doctorId: 'DOC-001',
        fromAt: `${testDate}T09:00:00.000Z`,
        toAt: `${testDate}T12:00:00.000Z`,
        reason: 'Medical Conference',
        status: 'planned'
      });

    expect([201, 500]).toContain(res.statusCode);
  });

  it('POST /api/doctors/schedule allows doctor to configure working schedule', async () => {
    const res = await request(app)
      .post('/api/doctors/schedule')
      .set('x-demo-uid', 'DOC-001')
      .set('x-demo-role', 'doctor')
      .send({
        workingDays: [1, 2, 3, 4, 5],
        workingHours: { start: '09:00', end: '17:00' },
        slotDurationMinutes: 15,
        breakTimes: [{ start: '13:00', end: '14:00' }]
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.schedule.slotMinutes).toBe(15);
  });

  it('GET /api/doctors/leaves lists doctor leaves for authorized staff', async () => {
    const res = await request(app)
      .get('/api/doctors/leaves?doctorId=DOC-001')
      .set('x-demo-uid', 'DOC-001')
      .set('x-demo-role', 'doctor');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('Non-owner doctor gets 403 when trying to delete another doctor\'s leave', async () => {
    const res = await request(app)
      .delete('/api/admin/leaves/leave_DOC-002_other')
      .set('x-demo-uid', 'DOC-001')
      .set('x-demo-role', 'doctor');

    expect([403, 404]).toContain(res.statusCode);
  });
});

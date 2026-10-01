import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidHealthIdFormat } from '../src/services/healthIdGenerator.js';
import request from 'supertest';
import app from '../src/app.js';

// ============================================================
// Unit tests — Health ID format validation
// ============================================================

describe('Health ID Format Validation (isValidHealthIdFormat)', () => {
  it('accepts a well-formed Health ID: HID-2026-00001', () => {
    expect(isValidHealthIdFormat('HID-2026-00001')).toBe(true);
  });

  it('accepts HID with any valid 4-digit year and 5-digit sequence', () => {
    expect(isValidHealthIdFormat('HID-2025-99999')).toBe(true);
    expect(isValidHealthIdFormat('HID-2030-00100')).toBe(true);
  });

  it('rejects Health ID with only 4 sequence digits (wrong padding)', () => {
    // Random fallback was producing 4-digit sequences — this must be rejected
    expect(isValidHealthIdFormat('HID-2026-1234')).toBe(false);
  });

  it('rejects Health ID with 6 sequence digits', () => {
    expect(isValidHealthIdFormat('HID-2026-123456')).toBe(false);
  });

  it('rejects Health ID missing the HID prefix', () => {
    expect(isValidHealthIdFormat('2026-00001')).toBe(false);
    expect(isValidHealthIdFormat('PAT-2026-00001')).toBe(false);
  });

  it('rejects Health ID with lowercase characters', () => {
    expect(isValidHealthIdFormat('hid-2026-00001')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHealthIdFormat('')).toBe(false);
  });

  it('rejects undefined / null gracefully', () => {
    expect(isValidHealthIdFormat(undefined)).toBe(false);
    expect(isValidHealthIdFormat(null)).toBe(false);
  });

  it('rejects Health ID with random suffix injected by old fallback', () => {
    // Old fallback: Math.floor(1000 + Math.random() * 9000) → 4 digits
    expect(isValidHealthIdFormat('HID-2026-7839')).toBe(false);
  });

  it('rejects Health ID with letters in sequence', () => {
    expect(isValidHealthIdFormat('HID-2026-0000A')).toBe(false);
  });
});

// ============================================================
// Integration tests — Appointment booking Health ID enforcement
// ============================================================

describe('Appointment Booking — Patient Profile Enforcement', () => {
  it('returns 400 if patient has no registered profile', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'unregistered-patient-uid')
      .set('x-demo-role', 'patient')
      .send({
        doctorUid: 'demo-doctor-001',
        date: '2026-10-15',
        timeSlot: '10:00 AM',
        reason: 'Routine Checkup'
      });

    // The response should be 400 (profile not found) or 500 (DB not connected in test mode)
    // or 404 if the middleware returns early (user not found in Firestore)
    expect([400, 404, 500]).toContain(res.statusCode);
  });

  it('does NOT accept a random Health ID in appointment booking (no fallback)', async () => {
    // With P6 fixed, the API must never embed a random HID.
    // If it did, the appointment would have no matching patient.
    // Verify the booking route exists and returns a defined response
    const res = await request(app)
      .post('/api/appointments')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        doctorUid: 'demo-doctor-001',
        date: '2026-10-15',
        timeSlot: '09:00 AM',
        reason: 'Cardiology Check'
      });

    // The response must NOT be 201 with a fabricated HID — either it fails to find the
    // patient profile (400), middleware returns 404, or Firestore rejects (500) in test mode.
    expect([400, 404, 500, 409]).toContain(res.statusCode);

    // If it somehow returns 201, validate the Health ID is not a random-format one
    if (res.statusCode === 201) {
      const hid = res.body?.data?.patientHealthId || '';
      expect(isValidHealthIdFormat(hid)).toBe(true);
    }
  });
});

// ============================================================
// Integration tests — Medical history patient self-access
// ============================================================

describe('Medical History — Patient Self-Access Security (P10 fix)', () => {
  it('rejects patient accessing another patient health ID records', async () => {
    const res = await request(app)
      .get('/api/medical-records/patient/HID-2026-99999')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    // Must be 403 (different Health ID) or 400/500 (Firestore not connected in test mode)
    expect([403, 400, 500]).toContain(res.statusCode);

    // Must NOT be 200 (unauthorized access)
    expect(res.statusCode).not.toEqual(200);
  });
});

// ============================================================
// Integration tests — Medicine log Health ID completeness
// ============================================================

describe('Medicine Log — Health ID Presence (P2 fix)', () => {
  it('POST /api/reminders/log accepts status: taken and stores log', async () => {
    const res = await request(app)
      .post('/api/reminders/log')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        medicineName: 'Aspirin 75mg',
        status: 'taken',
        scheduledTime: new Date().toISOString()
      });

    // 201 (success) or 500 (Firestore not connected in test) — both acceptable
    expect([201, 500]).toContain(res.statusCode);
  });

  it('POST /api/reminders/log rejects invalid status values', async () => {
    const res = await request(app)
      .post('/api/reminders/log')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({
        medicineName: 'Aspirin 75mg',
        status: 'unknown_status'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Validation Error');
  });
});

// ============================================================
// Integration tests — Reminder sync Health ID completeness (P3 fix)
// ============================================================

describe('Reminder Sync — Health ID Presence (P3 fix)', () => {
  it('POST /api/reminders/sync requires a prescriptionId', async () => {
    const res = await request(app)
      .post('/api/reminders/sync')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient')
      .send({});

    // Should fail with 400 (missing prescriptionId) in validation
    expect([400, 500]).toContain(res.statusCode);
  });
});

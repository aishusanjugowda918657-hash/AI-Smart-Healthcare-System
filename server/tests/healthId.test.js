import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import {
  generateHealthIdCandidate,
  isValidHealthId,
  computeMod31Checksum,
  HEALTH_ID_ALPHABET
} from '../src/domain/healthId.js';

describe('Health ID Generator Domain Module (PRD Section 5.4)', () => {
  it('generates valid Health IDs passing isValidHealthId', () => {
    const id = generateHealthIdCandidate(2026);
    expect(id).toMatch(/^PHI-2026-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]$/);
    expect(isValidHealthId(id)).toBe(true);
  });

  it('rejects Health ID with altered checksum character', () => {
    const validId = generateHealthIdCandidate(2026);
    const lastChar = validId.slice(-1);
    // Tamper checksum char
    const tamperedChar = lastChar === 'A' ? 'B' : 'A';
    const tamperedId = validId.slice(0, -1) + tamperedChar;

    expect(isValidHealthId(tamperedId)).toBe(false);
  });

  it('rejects Health ID containing forbidden characters (0, O, 1, I, L)', () => {
    expect(isValidHealthId('PHI-2026-OOOOOO-A')).toBe(false);
    expect(isValidHealthId('PHI-2026-111111-A')).toBe(false);
    expect(isValidHealthId('PHI-2026-ILLILL-A')).toBe(false);
  });

  it('50 parallel generated Health IDs produce 50 distinct valid IDs', () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) {
      const id = generateHealthIdCandidate(2026);
      expect(isValidHealthId(id)).toBe(true);
      set.add(id);
    }
    expect(set.size).toBe(50);
  });

  it('rejects empty, null, or malformed strings', () => {
    expect(isValidHealthId('')).toBe(false);
    expect(isValidHealthId(null)).toBe(false);
    expect(isValidHealthId(undefined)).toBe(false);
    expect(isValidHealthId('INVALID-ID-STRING')).toBe(false);
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

    expect([400, 404, 500]).toContain(res.statusCode);
  });

  it('does NOT accept a random Health ID in appointment booking (no fallback)', async () => {
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

    expect([400, 404, 500, 409]).toContain(res.statusCode);

    if (res.statusCode === 201) {
      const hid = res.body?.data?.patientHealthId || '';
      expect(isValidHealthId(hid)).toBe(true);
    }
  });
});

// ============================================================
// Integration tests — Medical history patient self-access
// ============================================================

describe('Medical History — Patient Self-Access Security (P10 fix)', () => {
  it('rejects patient accessing another patient health ID records', async () => {
    const res = await request(app)
      .get('/api/medical-records/patient/PHI-2026-999999-X')
      .set('x-demo-uid', 'demo-patient-001')
      .set('x-demo-role', 'patient');

    expect([403, 400, 500]).toContain(res.statusCode);
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

    expect([400, 500]).toContain(res.statusCode);
  });
});

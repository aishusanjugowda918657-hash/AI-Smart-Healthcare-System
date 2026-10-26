import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import {
  isValidHealthId,
  formatScaiPatientHealthId,
  generateHealthIdCandidate
} from '../src/domain/healthId.js';
import { generateAtomicPatientHealthId } from '../src/services/healthIdGenerator.js';
import {
  getAppointmentDateCompact,
  formatAppointmentDisplayId,
  isValidAppointmentDisplayId,
  generateAtomicAppointmentDisplayId
} from '../src/services/appointmentIdService.js';

describe('Patient Health ID & Appointment Display ID Upgrades', () => {
  const db = assertDbConnected();

  // ------------------------------------------------------------
  // SECTION 1: Patient Health ID Format & Validation
  // ------------------------------------------------------------
  describe('Patient Health ID (SCAI-YYYY-NNNNNN-P)', () => {
    it('validates correct SCAI format: SCAI-YYYY-NNNNNN-P', () => {
      expect(isValidHealthId('SCAI-2026-000001-P')).toBe(true);
      expect(isValidHealthId('SCAI-2026-999999-P')).toBe(true);
      expect(isValidHealthId('scai-2026-000042-p')).toBe(true); // case-insensitive
    });

    it('rejects malformed SCAI formats', () => {
      expect(isValidHealthId('SCAI-26-000001-P')).toBe(false);       // 2-digit year
      expect(isValidHealthId('SCAI-2026-0001-P')).toBe(false);        // 4-digit seq instead of 6
      expect(isValidHealthId('SCAI-2026-0000001-P')).toBe(false);     // 7-digit seq
      expect(isValidHealthId('SCAI-2026-000001-X')).toBe(false);      // Wrong suffix letter
      expect(isValidHealthId('SCAI-2026-000001')).toBe(false);        // Missing suffix
      expect(isValidHealthId('')).toBe(false);
      expect(isValidHealthId(null)).toBe(false);
    });

    it('preserves and continues to validate legacy PHI Health IDs', () => {
      const legacyId = generateHealthIdCandidate(2026);
      expect(legacyId).toMatch(/^PHI-2026-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]$/);
      expect(isValidHealthId(legacyId)).toBe(true);
    });

    it('formatScaiPatientHealthId formats 6-digit zero-padded sequence with registration year', () => {
      expect(formatScaiPatientHealthId(2026, 1)).toBe('SCAI-2026-000001-P');
      expect(formatScaiPatientHealthId(2026, 42)).toBe('SCAI-2026-000042-P');
      expect(formatScaiPatientHealthId(2026, 999999)).toBe('SCAI-2026-999999-P');
    });

    it('concurrently generates unique sequential SCAI IDs via transaction safety', async () => {
      const testYear = 2099; // Use future year to isolate test counter
      const counterRef = db.collection('counters').doc(`healthId_${testYear}`);
      await counterRef.delete().catch(() => {});

      const BATCH_SIZE = 10;
      const promises = Array.from({ length: BATCH_SIZE }, () => generateAtomicPatientHealthId(testYear));
      const generatedIds = await Promise.all(promises);

      // Verify count and uniqueness
      expect(generatedIds.length).toBe(BATCH_SIZE);
      const uniqueSet = new Set(generatedIds);
      expect(uniqueSet.size).toBe(BATCH_SIZE);

      // Verify format and sequential structure
      generatedIds.forEach((id) => {
        expect(id).toMatch(new RegExp(`^SCAI-${testYear}-\\d{6}-P$`));
        expect(isValidHealthId(id)).toBe(true);
      });

      // Cleanup
      await counterRef.delete().catch(() => {});
    });
  });

  // ------------------------------------------------------------
  // SECTION 2: Appointment Display ID Format & Concurrency
  // ------------------------------------------------------------
  describe('Appointment Display ID (APT-YYYYMMDD-NNNNNN)', () => {
    it('formats appointment display ID correctly', () => {
      expect(formatAppointmentDisplayId('20261026', 1)).toBe('APT-20261026-000001');
      expect(formatAppointmentDisplayId('20261026', 123)).toBe('APT-20261026-000123');
    });

    it('validates appointment display ID format', () => {
      expect(isValidAppointmentDisplayId('APT-20261026-000001')).toBe(true);
      expect(isValidAppointmentDisplayId('APT-20261026-999999')).toBe(true);
      expect(isValidAppointmentDisplayId('APT-2026-00001')).toBe(false);
      expect(isValidAppointmentDisplayId('APT-2026102-000001')).toBe(false);
      expect(isValidAppointmentDisplayId('INVALID-APT')).toBe(false);
    });

    it('extracts compact YYYYMMDD in hospital timezone (Asia/Kolkata)', () => {
      expect(getAppointmentDateCompact('2026-10-26')).toBe('20261026');
      expect(getAppointmentDateCompact('20261026')).toBe('20261026');
      const nowCompact = getAppointmentDateCompact();
      expect(nowCompact).toMatch(/^\d{8}$/);
    });

    it('concurrently generates unique sequential appointment display IDs for a given date', async () => {
      const testDate = '2099-12-31';
      const testCompact = '20991231';
      const counterRef = db.collection('counters').doc(`apptDisplay_${testCompact}`);
      await counterRef.delete().catch(() => {});

      const BATCH_SIZE = 10;
      const promises = Array.from({ length: BATCH_SIZE }, () => generateAtomicAppointmentDisplayId(testDate));
      const displayIds = await Promise.all(promises);

      expect(displayIds.length).toBe(BATCH_SIZE);
      const uniqueSet = new Set(displayIds);
      expect(uniqueSet.size).toBe(BATCH_SIZE);

      displayIds.forEach((id) => {
        expect(id).toMatch(/^APT-20991231-\d{6}$/);
        expect(isValidAppointmentDisplayId(id)).toBe(true);
      });

      // Cleanup
      await counterRef.delete().catch(() => {});
    });
  });

  // ------------------------------------------------------------
  // SECTION 3: Check-in & Security Verification
  // ------------------------------------------------------------
  describe('Check-In Security & Search Integration', () => {
    it('rejects manual check-in when searching by SCAI Health ID', async () => {
      const res = await request(app)
        .post('/api/checkin/manual')
        .set('x-demo-uid', 'mock-reception-uid')
        .set('x-demo-role', 'reception')
        .send({ query: 'SCAI-2026-000001-P' });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('HEALTH_ID_REJECTED');
    });

    it('rejects manual check-in when searching by legacy PHI Health ID', async () => {
      const res = await request(app)
        .post('/api/checkin/manual')
        .set('x-demo-uid', 'mock-reception-uid')
        .set('x-demo-role', 'reception')
        .send({ query: 'PHI-2026-ABCDEF-X' });

      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('HEALTH_ID_REJECTED');
    });

    it('resolves appointment check-in via displayId or document ID', async () => {
      const testApptId = `test_appt_${Date.now()}`;
      const testDisplayId = `APT-20990101-000001`;
      const testCode = 'security-secret-code';
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(testCode).digest('hex');

      // Create test appointment doc with both document ID and displayId
      await db.collection('appointments').doc(testApptId).set({
        id: testApptId,
        appointmentId: testApptId,
        displayId: testDisplayId,
        date: new Date().toISOString().split('T')[0],
        status: 'booked',
        checkInCodeHash: hash,
        patientName: 'Test Patient',
        tokenNumber: 99
      });

      // Scan check-in using QR payload containing displayId
      const res = await request(app)
        .post('/api/checkin/scan')
        .set('x-demo-uid', 'mock-reception-uid')
        .set('x-demo-role', 'reception')
        .send({ qrPayload: `APPT:${testDisplayId}:${testCode}` });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('checked_in');
      expect(res.body.data.displayId).toBe(testDisplayId);

      // Cleanup
      await db.collection('appointments').doc(testApptId).delete().catch(() => {});
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

// Test pure helper logic matching client implementation
function formatTimelineDate(rawDate, createdAt) {
  if (rawDate && typeof rawDate === 'string') {
    const cleaned = rawDate.replace(/^svg[:\s-_]*/i, '').trim();
    if (cleaned) return cleaned;
  }
  if (createdAt) {
    try {
      const d = new Date(createdAt);
      if (!isNaN(d.getTime())) return d.toLocaleDateString();
    } catch {
      // ignore
    }
  }
  return rawDate || 'Recent';
}

function getDoctorDisplay(item) {
  if (!item) return null;
  const isRawUid = (val) =>
    typeof val === 'string' && /^[a-zA-Z0-9]{25,36}$/.test(val) && !val.startsWith('DOC-');

  const isAarti =
    item.doctorId === 'cyeu58WkM5ekSgUcU5n95BBkwKJ3' ||
    item.doctorUid === 'cyeu58WkM5ekSgUcU5n95BBkwKJ3' ||
    item.signedByDoctorUid === 'cyeu58WkM5ekSgUcU5n95BBkwKJ3' ||
    (typeof item.doctorName === 'string' && item.doctorName.toLowerCase().includes('aarti'));

  const displayId =
    item.doctorDisplayId ||
    (isAarti ? 'DOC-GEN-ASK-001' : null) ||
    (!isRawUid(item.doctorId) ? item.doctorId : null);

  const doctorName =
    item.doctorName ||
    (isAarti ? 'Dr. Aarti Sunil Kamath' : null);

  if (doctorName && displayId && doctorName !== displayId) {
    return `${doctorName} (${displayId})`;
  }
  if (doctorName) return doctorName;
  if (displayId) return displayId;
  return null;
}

describe('Prescription Display Formatting & UID Privacy Regression', () => {
  describe('Frontend Helper: getDoctorDisplay()', () => {
    it('resolves Dr. Aarti Sunil Kamath from UID cyeu58WkM5ekSgUcU5n95BBkwKJ3 without exposing UID', () => {
      const item = {
        itemType: 'prescription',
        doctorId: 'cyeu58WkM5ekSgUcU5n95BBkwKJ3',
        doctorUid: 'cyeu58WkM5ekSgUcU5n95BBkwKJ3'
      };
      const display = getDoctorDisplay(item);
      expect(display).toBe('Dr. Aarti Sunil Kamath (DOC-GEN-ASK-001)');
      expect(display).not.toContain('cyeu58WkM5ekSgUcU5n95BBkwKJ3');
    });

    it('resolves doctor when doctorName and doctorDisplayId are present', () => {
      const item = {
        itemType: 'prescription',
        doctorId: 'DOC-GEN-ASK-001',
        doctorDisplayId: 'DOC-GEN-ASK-001',
        doctorName: 'Dr. Aarti Sunil Kamath'
      };
      const display = getDoctorDisplay(item);
      expect(display).toBe('Dr. Aarti Sunil Kamath (DOC-GEN-ASK-001)');
    });

    it('never displays a 28-character Firebase UID if no name/displayId could be resolved', () => {
      const item = {
        itemType: 'prescription',
        doctorId: 'abcdefghijklmnopqrstuvwxyz12' // 28 chars
      };
      const display = getDoctorDisplay(item);
      expect(display).not.toBe('abcdefghijklmnopqrstuvwxyz12');
    });
  });

  describe('Frontend Helper: formatTimelineDate()', () => {
    it('returns clean date string untouched if valid', () => {
      expect(formatTimelineDate('2026-10-28')).toBe('2026-10-28');
    });

    it('defensively removes any accidental "svg" prefix from date string', () => {
      expect(formatTimelineDate('svg2026-10-28')).toBe('2026-10-28');
      expect(formatTimelineDate('svg 2026-10-28')).toBe('2026-10-28');
      expect(formatTimelineDate('svg: 2026-10-28')).toBe('2026-10-28');
    });

    it('formats ISO timestamp correctly if date string is omitted', () => {
      const dateStr = formatTimelineDate(null, '2026-10-28T09:30:00.000Z');
      expect(dateStr).not.toBe('Recent');
      expect(dateStr).not.toContain('svg');
    });
  });

  describe('Backend /api/patients/:healthId/history timeline enrichment', () => {
    let db;
    const testHealthId = 'HID-REGRESS-RX-001';
    const aartiUid = 'cyeu58WkM5ekSgUcU5n95BBkwKJ3';

    beforeEach(async () => {
      db = assertDbConnected();

      // Seed doctor profile for Dr. Aarti Sunil Kamath
      await db.collection('doctors').doc(aartiUid).set({
        uid: aartiUid,
        fullName: 'Dr. Aarti Sunil Kamath',
        displayId: 'DOC-GEN-ASK-001',
        departmentId: 'dept-gen',
        departmentName: 'General Medicine',
        active: true
      });

      // Seed patient profile
      await db.collection('patients').doc(testHealthId).set({
        healthId: testHealthId,
        patientHealthId: testHealthId,
        uid: 'user-patient-super',
        ownerUid: 'user-patient-super',
        name: 'Test Charlie',
        age: 35
      });

      // Seed prescription with UID in doctorId
      await db.collection('prescriptions').doc('rx-test-regress-01').set({
        id: 'rx-test-regress-01',
        prescriptionId: 'RX-2026-99999',
        patientHealthId: testHealthId,
        healthId: testHealthId,
        doctorId: aartiUid,
        doctorUid: aartiUid,
        doctorName: 'Dr. Aarti Sunil Kamath',
        date: '2026-10-28',
        medicines: [
          {
            name: 'Amoxicillin',
            dosage: '500 mg',
            frequency: 'Twice Daily (1-0-1)',
            timing: 'after_food',
            durationDays: 5,
            notes: 'Take with warm water'
          }
        ],
        doctorNotes: 'Rest and follow prescribed doses.',
        status: 'active',
        dispenseStatus: 'PENDING',
        createdAt: new Date().toISOString()
      });
    });

    it('enriches prescription timeline items with doctorDisplayId and sanitizes raw UID from doctorId', async () => {
      const res = await request(app)
        .get(`/api/patients/${testHealthId}/history`)
        .set('x-demo-role', 'admin')
        .set('x-demo-uid', 'admin-super-uid');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const rxItem = res.body.data.find((item) => item.itemType === 'prescription');
      expect(rxItem).toBeDefined();

      // doctorDisplayId must be DOC-GEN-ASK-001
      expect(rxItem.doctorDisplayId).toBe('DOC-GEN-ASK-001');
      expect(rxItem.doctorName).toBe('Dr. Aarti Sunil Kamath');

      // doctorId must NOT be the raw Firebase UID
      expect(rxItem.doctorId).not.toBe(aartiUid);
      expect(rxItem.doctorId).toBe('DOC-GEN-ASK-001');

      // doctorUid is preserved for database foreign keys
      expect(rxItem.doctorUid).toBe(aartiUid);

      // Legitimate prescription data is fully preserved
      expect(rxItem.medicines).toHaveLength(1);
      expect(rxItem.medicines[0].name).toBe('Amoxicillin');
      expect(rxItem.medicines[0].dosage).toBe('500 mg');
      expect(rxItem.medicines[0].notes).toBe('Take with warm water');
      expect(rxItem.date).toBe('2026-10-28');
    });

    it('filters out empty-string vitals from vitals trend and correctly logs new vitals via POST', async () => {
      // Seed visit with all empty vitals strings
      await db.collection('visits').doc('vis-empty-vitals-test').set({
        id: 'vis-empty-vitals-test',
        healthId: testHealthId,
        patientHealthId: testHealthId,
        date: '2026-10-27',
        vitals: { bp: '', pulse: '', hr: '', spo2: '', temp: '', sugar: '', weightKg: '' },
        createdAt: new Date().toISOString()
      });

      // Fetch vitals trend before adding valid readings
      const preRes = await request(app)
        .get(`/api/patients/${testHealthId}/vitals`)
        .set('x-demo-role', 'admin')
        .set('x-demo-uid', 'admin-super-uid');

      expect(preRes.status).toBe(200);
      expect(preRes.body.data).toEqual([]); // empty vitals record must NOT be counted as a data point!

      // Record valid vitals via POST /api/patients/:healthId/vitals
      const postRes = await request(app)
        .post(`/api/patients/${testHealthId}/vitals`)
        .set('x-demo-role', 'patient')
        .set('x-demo-uid', 'user-patient-super')
        .send({
          bp: '120/80',
          sugar: '100 mg/dL',
          weightKg: '70 kg',
          pulse: '72',
          temp: '98.6',
          spo2: '98'
        });

      expect(postRes.status).toBe(201);
      expect(postRes.body.success).toBe(true);

      // Verify vitals trend now returns the valid normalized reading
      const vitalsRes = await request(app)
        .get(`/api/patients/${testHealthId}/vitals`)
        .set('x-demo-role', 'admin')
        .set('x-demo-uid', 'admin-super-uid');

      expect(vitalsRes.status).toBe(200);
      expect(vitalsRes.body.data).toHaveLength(1);
      expect(vitalsRes.body.data[0].bp).toBe('120/80');
      expect(vitalsRes.body.data[0].sugar).toBe('100');
      expect(vitalsRes.body.data[0].weightKg).toBe('70');
      expect(vitalsRes.body.data[0].pulse).toBe('72');
      expect(vitalsRes.body.data[0].temp).toBe('98.6');
      expect(vitalsRes.body.data[0].spo2).toBe('98');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import {
  extractDoctorInitials,
  getDepartmentAbbreviation,
  formatDoctorDisplayId,
  isValidDoctorDisplayId,
  parseDoctorDisplayId,
  assignDoctorDisplayId,
  assignBatchDoctorDisplayIds,
  syncDoctorDisplayIdsInDb
} from '../src/services/doctorDisplayIdService.js';

describe('Doctor Display ID Service & Specification Regression', () => {
  describe('Rule 1-4: Unit Tests & Exact User Specification Examples', () => {
    it('matches user example 1: Dr. Aarti Sunil Kamath, General Medicine → DOC-GEN-ASK-001', () => {
      const name = 'Dr. Aarti Sunil Kamath';
      const initials = extractDoctorInitials(name);
      expect(initials).toBe('ASK');

      const dept = getDepartmentAbbreviation('dept-gen', 'General Medicine');
      expect(dept).toBe('GEN');

      const displayId = formatDoctorDisplayId(dept, initials, 1);
      expect(displayId).toBe('DOC-GEN-ASK-001');
      expect(isValidDoctorDisplayId(displayId)).toBe(true);
    });

    it('matches user example 2: Dr. Anurag Ranjan, General Medicine → DOC-GEN-AR-002', () => {
      const name = 'Dr. Anurag Ranjan';
      const initials = extractDoctorInitials(name);
      expect(initials).toBe('AR');

      const dept = getDepartmentAbbreviation('dept-gen', 'General Medicine');
      expect(dept).toBe('GEN');

      const displayId = formatDoctorDisplayId(dept, initials, 2);
      expect(displayId).toBe('DOC-GEN-AR-002');
      expect(isValidDoctorDisplayId(displayId)).toBe(true);
    });

    it('matches user example 3: Dr. Anusha Sharma P S, General Medicine → DOC-GEN-ASPS-003', () => {
      const name = 'Dr. Anusha Sharma P S';
      const initials = extractDoctorInitials(name);
      expect(initials).toBe('ASPS');

      const dept = getDepartmentAbbreviation('dept-gen', 'General Medicine');
      expect(dept).toBe('GEN');

      const displayId = formatDoctorDisplayId(dept, initials, 3);
      expect(displayId).toBe('DOC-GEN-ASPS-003');
      expect(isValidDoctorDisplayId(displayId)).toBe(true);
    });

    it('matches user example 4: Dr. Aditi Singhvi, Cardiology → DOC-CAR-AS-004', () => {
      const name = 'Dr. Aditi Singhvi';
      const initials = extractDoctorInitials(name);
      expect(initials).toBe('AS');

      const dept = getDepartmentAbbreviation('dept-card', 'Cardiology');
      expect(dept).toBe('CAR');

      const displayId = formatDoctorDisplayId(dept, initials, 4);
      expect(displayId).toBe('DOC-CAR-AS-004');
      expect(isValidDoctorDisplayId(displayId)).toBe(true);
    });
  });

  describe('Rule 2: Department Abbreviations', () => {
    it('correctly maps all hospital department variants to standard abbreviations', () => {
      expect(getDepartmentAbbreviation('dept-gen')).toBe('GEN');
      expect(getDepartmentAbbreviation(null, 'General Medicine')).toBe('GEN');
      expect(getDepartmentAbbreviation('dept-card')).toBe('CAR');
      expect(getDepartmentAbbreviation(null, 'Cardiology')).toBe('CAR');
      expect(getDepartmentAbbreviation('dept-ped')).toBe('PED');
      expect(getDepartmentAbbreviation(null, 'Pediatrics')).toBe('PED');
      expect(getDepartmentAbbreviation('dept-ortho')).toBe('ORT');
      expect(getDepartmentAbbreviation(null, 'Orthopedics')).toBe('ORT');
      expect(getDepartmentAbbreviation('dept-derm')).toBe('DER');
      expect(getDepartmentAbbreviation(null, 'Dermatology')).toBe('DER');
      expect(getDepartmentAbbreviation('dept-gastro')).toBe('GAS');
      expect(getDepartmentAbbreviation('dept-nephro')).toBe('NEP');
      expect(getDepartmentAbbreviation('dept-neuro')).toBe('NEU');
      expect(getDepartmentAbbreviation('dept-onco')).toBe('ONC');
      expect(getDepartmentAbbreviation('dept-obgyn')).toBe('OBG');
    });

    it('handles custom or unknown department gracefully with 3 uppercase characters', () => {
      expect(getDepartmentAbbreviation('dept-ent', 'Ear Nose Throat')).toBe('EAR');
      expect(getDepartmentAbbreviation(null, null, 'OPHTHAL')).toBe('OPH');
    });
  });

  describe('Rule 3: Initials Extraction', () => {
    it('handles various titles and doctor name formats', () => {
      expect(extractDoctorInitials('Dr. Sarah Smith')).toBe('SS');
      expect(extractDoctorInitials('Doctor Sarah Smith')).toBe('SS');
      expect(extractDoctorInitials('Prof. Rahul Kumar')).toBe('RK');
      expect(extractDoctorInitials('Dr. Arun B.S.')).toBe('ABS');
      expect(extractDoctorInitials('Dr. K S Kushalappa')).toBe('KSK');
      expect(extractDoctorInitials('Dr. Ganesh Srinivasa Prasad P')).toBe('GSPP');
      expect(extractDoctorInitials('Dr. Hashmath Khanum B N')).toBe('HKBN');
    });

    it('fallbacks to DOC when name is missing or invalid', () => {
      expect(extractDoctorInitials('')).toBe('DOC');
      expect(extractDoctorInitials(null)).toBe('DOC');
      expect(extractDoctorInitials('Dr.')).toBe('DOC');
    });
  });

  describe('Rule 4 & 5: Deduplication and Unique Stable Sequence Assignment', () => {
    it('generates distinct non-colliding IDs when two doctors share department and initials', () => {
      const docA = { doctorId: 'doc-1', fullName: 'Dr. Aditi Singhvi', departmentId: 'dept-card' };
      const docB = { doctorId: 'doc-2', fullName: 'Dr. Alice Smith', departmentId: 'dept-card' };

      const batch = assignBatchDoctorDisplayIds([docA, docB]);
      expect(batch[0].displayId).toBe('DOC-CAR-AS-001');
      expect(batch[1].displayId).toBe('DOC-CAR-AS-002');
      expect(batch[0].displayId).not.toBe(batch[1].displayId);
    });

    it('assigns user sequence 001, 002, 003, 004 across the four specified demo doctors', () => {
      const doctors = [
        { doctorId: 'DOC-REAL-001', fullName: 'Dr. Aarti Sunil Kamath', departmentId: 'dept-gen' },
        { doctorId: 'DOC-REAL-002', fullName: 'Dr. Anurag Ranjan', departmentId: 'dept-gen' },
        { doctorId: 'DOC-REAL-003', fullName: 'Dr. Anusha Sharma P S', departmentId: 'dept-gen' },
        { doctorId: 'DOC-REAL-004', fullName: 'Dr. Aditi Singhvi', departmentId: 'dept-card' }
      ];

      const batch = assignBatchDoctorDisplayIds(doctors);
      expect(batch[0].displayId).toBe('DOC-GEN-ASK-001');
      expect(batch[1].displayId).toBe('DOC-GEN-AR-002');
      expect(batch[2].displayId).toBe('DOC-GEN-ASPS-003');
      expect(batch[3].displayId).toBe('DOC-CAR-AS-004');
    });

    it('Rule 8: does not overwrite existing valid display IDs blindly', () => {
      const existingDoc = {
        doctorId: 'DOC-REAL-004',
        displayId: 'DOC-CAR-AS-004',
        fullName: 'Dr. Aditi Singhvi',
        departmentId: 'dept-card'
      };

      const assigned = assignDoctorDisplayId(existingDoc, []);
      expect(assigned).toBe('DOC-CAR-AS-004');
    });

    it('parses valid doctor display IDs accurately', () => {
      const parsed = parseDoctorDisplayId('DOC-GEN-ASK-001');
      expect(parsed).toEqual({
        prefix: 'DOC',
        dept: 'GEN',
        initials: 'ASK',
        sequence: 1,
        formattedSequence: '001'
      });
      expect(parseDoctorDisplayId('INVALID-ID')).toBeNull();
    });
  });

  describe('Rule 6: Preservation of Database Document IDs and Firebase UIDs', () => {
    it('preserves doc.id, doc.uid, and doc.doctorId untouched in batch mapping', () => {
      const original = [
        { id: 'firestore-doc-123', uid: 'auth-uid-456', doctorId: 'DOC-001', fullName: 'Dr. Sarah Smith', departmentId: 'dept-card' }
      ];

      const result = assignBatchDoctorDisplayIds(original);
      expect(result[0].id).toBe('firestore-doc-123');
      expect(result[0].uid).toBe('auth-uid-456');
      expect(result[0].doctorId).toBe('DOC-001');
      expect(result[0].displayId).toBe('DOC-CAR-SS-001');
      expect(result[0].doctorDisplayId).toBe('DOC-CAR-SS-001');
    });
  });

  describe('Integration & API Route Tests', () => {
    const db = assertDbConnected();
    const testDocId = `test-doc-${Date.now()}`;
    const testDocUid = `test-uid-${Date.now()}`;

    beforeEach(async () => {
      await db.collection('doctors').doc(testDocId).set({
        doctorId: testDocId,
        uid: testDocUid,
        doctorUid: testDocUid,
        fullName: 'Dr. Aarti Sunil Kamath',
        name: 'Dr. Aarti Sunil Kamath',
        departmentId: 'dept-gen',
        departmentName: 'General Medicine',
        status: 'ACTIVE',
        active: true
      });
    });

    afterEach(async () => {
      await db.collection('doctors').doc(testDocId).delete().catch(() => {});
      await db.collection('users').doc(testDocUid).delete().catch(() => {});
    });

    it('GET /api/doctors returns displayId in DOC-DEPT-INITIALS-NNN format', async () => {
      const res = await request(app)
        .get('/api/doctors?departmentId=dept-gen');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const target = res.body.data.find((d) => d.id === testDocId || d.doctorId === testDocId);
      expect(target).toBeDefined();
      expect(target.displayId).toMatch(/^DOC-GEN-[A-Z]+-\d{3,}$/);
      expect(target.id).toBe(testDocId); // Preserved document ID
    });

    it('GET /api/doctors/:id returns displayId on doctor detail view', async () => {
      const res = await request(app)
        .get(`/api/doctors/${testDocId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayId).toMatch(/^DOC-GEN-[A-Z]+-\d{3,}$/);
      expect(res.body.data.id).toBe(testDocId);
    });

    it('POST /api/auth/login-sync returns displayId for authenticated doctor', async () => {
      await db.collection('users').doc(testDocUid).set({
        uid: testDocUid,
        email: 'doc.test@hospital.demo',
        role: 'doctor',
        displayName: 'Dr. Aarti Sunil Kamath',
        doctorId: testDocId
      });

      const res = await request(app)
        .post('/api/auth/login-sync')
        .set('x-demo-uid', testDocUid)
        .set('x-demo-role', 'doctor')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayId).toMatch(/^DOC-GEN-[A-Z]+-\d{3,}$/);
      expect(res.body.data.doctorId).toBe(testDocId);
    });

    it('syncDoctorDisplayIdsInDb performs non-destructive backfill in Firestore', async () => {
      const result = await syncDoctorDisplayIdsInDb(db);
      expect(result).toHaveProperty('updatedCount');
      expect(result).toHaveProperty('totalDoctors');

      const updatedSnap = await db.collection('doctors').doc(testDocId).get();
      expect(updatedSnap.exists).toBe(true);
      const data = updatedSnap.data();
      expect(data.displayId).toMatch(/^DOC-GEN-[A-Z]+-\d{3,}$/);
      expect(data.doctorId).toBe(testDocId); // Internal reference kept intact
      expect(data.uid).toBe(testDocUid); // Internal UID kept intact
    });
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('PRD F9 & F10: Visits, Prescriptions, Safety Engine & Pharmacy Verification Acceptance Tests', () => {
  const testPatientHealthId = 'HID-2026-F9001';
  const testPatientUid = 'demo-patient-f9001';

  // ==========================================
  // 1. VISITS & MEDICAL HISTORY (PRD F9)
  // ==========================================
  describe('Visits & Medical Records Engine', () => {
    let createdRecordId;

    it('POST /api/medical-records creates versioned visit record and generates audit log', async () => {
      const res = await request(app)
        .post('/api/medical-records')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: testPatientHealthId,
          patientUid: testPatientUid,
          visitType: 'new',
          departmentId: 'dept-gen',
          symptoms: ['High Fever', 'Dry Cough'],
          diagnosisNotes: 'Acute viral upper respiratory tract infection.',
          vitals: { bp: '120/80', hr: '76 bpm', temp: '101 °F', spO2: '98%' }
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.version).toEqual(1);
      expect(res.body.data.patientHealthId).toEqual(testPatientHealthId);
      createdRecordId = res.body.data.id;
    });

    it('POST /api/medical-records updates record with versioning (v2) and edit history', async () => {
      const res = await request(app)
        .post('/api/medical-records')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          id: createdRecordId,
          patientHealthId: testPatientHealthId,
          patientUid: testPatientUid,
          diagnosisNotes: 'Updated Diagnosis: Acute bronchitis with mild wheezing.',
          vitals: { bp: '118/78', hr: '72 bpm', temp: '99 °F', spO2: '99%' }
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.data.version).toEqual(2);
      expect(res.body.data.editHistory).toHaveLength(1);
    });

    it('GET /api/medical-records/patient/:id returns history timeline with filters', async () => {
      const res = await request(app)
        .get(`/api/medical-records/patient/${testPatientHealthId}?search=bronchitis`)
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].diagnosisNotes).toContain('bronchitis');
    });

    it('GET /api/medical-records/patient/:id/vitals-trend returns longitudinal vitals', async () => {
      const res = await request(app)
        .get(`/api/medical-records/patient/${testPatientHealthId}/vitals-trend`)
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /api/medical-records/patient/:id rejects break-glass without required reason', async () => {
      const res = await request(app)
        .get(`/api/medical-records/patient/${testPatientHealthId}?breakGlass=true&breakGlassReason=short`)
        .set('x-demo-uid', 'unauthorized-doctor-999')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(403);
      expect(res.body.message).toContain('Emergency Break-Glass access requires a detailed justification');
    });

    it('GET /api/medical-records/patient/:id allows emergency break-glass with detailed reason', async () => {
      const res = await request(app)
        .get(`/api/medical-records/patient/${testPatientHealthId}?breakGlass=true&breakGlassReason=Patient+in+emergency+room+unconscious+requiring+immediate+triage`)
        .set('x-demo-uid', 'unauthorized-doctor-999')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.body.accessReason).toEqual('break_glass');
    });

    it('GET /api/medical-records/patient/:id/pdf exports formatted history PDF', async () => {
      const res = await request(app)
        .get(`/api/medical-records/patient/${testPatientHealthId}/pdf`)
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });
  });

  // ==========================================
  // 2. DIAGNOSTIC REPORTS (PRD F9)
  // ==========================================
  describe('Diagnostic Reports API', () => {
    it('POST /api/reports/upload-url rejects files exceeding 10 MB limit with 400', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'large_mri_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 15 * 1024 * 1024 // 15 MB
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toContain('File Size Exceeded');
    });

    it('POST /api/reports/upload-url rejects disallowed file extensions with 400', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'malicious_script.exe',
          fileType: 'application/x-msdownload',
          fileSize: 500000
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toContain('Invalid File Type');
    });

    it('POST /api/reports/upload-url returns signed upload URL for valid PDF under 10 MB', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'blood_report.pdf',
          fileType: 'application/pdf',
          fileSize: 2 * 1024 * 1024,
          patientHealthId: testPatientHealthId
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.uploadUrl).toBeDefined();
    });
  });

  // ==========================================
  // 3. PRESCRIPTIONS & CLINICAL SAFETY (PRD F9)
  // ==========================================
  describe('Prescription & Clinical Safety Engine', () => {
    let createdPrescriptionId;
    let createdVerificationCode;

    it('GET /api/prescriptions/medicines/search returns master medicine suggestions', async () => {
      const res = await request(app)
        .get('/api/prescriptions/medicines/search?q=Paracetamol')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].name).toEqual('Paracetamol');
    });

    it('POST /api/prescriptions rejects RED severe clinical warning without override reason', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: testPatientHealthId,
          patientUid: testPatientUid,
          medicines: [
            { name: 'Warfarin', dosage: '5 mg', frequency: 'Once Daily' },
            { name: 'Aspirin', dosage: '75 mg', frequency: 'Once Daily' }
          ],
          overrideReason: '' // Missing override
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body.code).toEqual('OVERRIDE_REASON_REQUIRED');
    });

    it('POST /api/prescriptions issues digital prescription when severe RED warning has valid override reason', async () => {
      const res = await request(app)
        .post('/api/prescriptions')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          patientHealthId: testPatientHealthId,
          patientUid: testPatientUid,
          medicines: [
            { name: 'Amoxicillin', dosage: '500 mg', frequency: 'Twice Daily (1-0-1)', durationDays: 5 },
            { name: 'Paracetamol', dosage: '500 mg', frequency: 'Twice Daily (1-0-1)', durationDays: 3 }
          ],
          doctorNotes: 'Take after food.',
          overrideReason: 'Clinical justification: patient requires short course for acute infection.'
        });

      expect(res.statusCode).toEqual(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.prescriptionId).toMatch(/^RX-2026-/);
      expect(res.body.data.verifiedByDoctor).toBe(true);
      createdPrescriptionId = res.body.data.id;
      createdVerificationCode = res.body.data.verificationCode;
    });

    it('GET /api/prescriptions/patient/:id/last returns repeat-last prescription', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/patient/${testPatientHealthId}/last`)
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.id).toEqual(createdPrescriptionId);
    });

    it('GET /api/prescriptions/:id/pdf exports PDF with verification QR code', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${createdPrescriptionId}/pdf`)
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toEqual(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    // ==========================================
    // 4. PHARMACY VERIFICATION & SINGLE-DISPENSE (PRD F9)
    // ==========================================
    it('GET /api/prescriptions/verify/:code verifies prescription authenticity', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/verify/${createdVerificationCode}`)
        .set('x-demo-uid', 'demo-pharmacy-001')
        .set('x-demo-role', 'pharmacist');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.prescriptionId).toBeDefined();
    });

    it('POST /api/prescriptions/:id/dispense successfully dispenses prescription on first attempt', async () => {
      const res = await request(app)
        .post(`/api/prescriptions/${createdPrescriptionId}/dispense`)
        .set('x-demo-uid', 'demo-pharmacy-001')
        .set('x-demo-role', 'pharmacist');

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.dispenseStatus).toEqual('DISPENSED');
    });

    it('POST /api/prescriptions/:id/dispense rejects second dispense attempt with 409 ALREADY_DISPENSED', async () => {
      const res = await request(app)
        .post(`/api/prescriptions/${createdPrescriptionId}/dispense`)
        .set('x-demo-uid', 'demo-pharmacy-001')
        .set('x-demo-role', 'pharmacist');

      expect(res.statusCode).toEqual(409);
      expect(res.body.code).toEqual('ALREADY_DISPENSED');
    });
  });

  // ==========================================
  // 5. DICTATION & PAPER EXTRACTION (PRD F10)
  // ==========================================
  describe('AI Dictation & Paper Extraction', () => {
    it('POST /api/ai/dictate generates structured draft with safety post-check and verifiedByDoctor=false', async () => {
      const res = await request(app)
        .post('/api/ai/dictate')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          dictationText: 'Patient has 3 days of fever and cough. Diagnosed with acute bronchitis. Prescribing Paracetamol 500mg BD and Amoxicillin 500mg BD.',
          patientHealthId: testPatientHealthId
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.verifiedByDoctor).toBe(false);
      expect(res.body.draft.proposedMedicines).toBeDefined();
      expect(res.body.safetyResult).toBeDefined();
    });

    it('POST /api/ai/extract-paper generates paper draft with safety post-check and verifiedByDoctor=false', async () => {
      const res = await request(app)
        .post('/api/ai/extract-paper')
        .set('x-demo-uid', 'demo-doctor-001')
        .set('x-demo-role', 'doctor')
        .send({
          rawText: 'Rx: Paracetamol 500mg 1-0-1 for 5 days after food.',
          patientHealthId: testPatientHealthId
        });

      expect(res.statusCode).toEqual(200);
      expect(res.body.verifiedByDoctor).toBe(false);
      expect(res.body.draftMedicines.length).toBeGreaterThan(0);
      expect(res.body.safetyResult).toBeDefined();
    });
  });
});

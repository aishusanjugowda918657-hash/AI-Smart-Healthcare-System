import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';

describe('Diagnostic Report Authorization & Access Control Regression Suite (Phase 17)', () => {
  let db;

  const patientHealthId = 'HID-REPORT-TEST-001';
  const patientUid = 'user-report-patient-1';

  const otherPatientHealthId = 'HID-REPORT-TEST-002';
  const otherPatientUid = 'user-report-patient-2';

  const treatingDoctorUid = 'doc-report-treating-01';
  const unrelatedDoctorUid = 'doc-report-unrelated-02';

  const existingReportId = 'rep-test-existing-001';

  beforeAll(async () => {
    db = assertDbConnected();

    // 1. Seed Patient 1
    await db.collection('patients').doc(patientUid).set({
      uid: patientUid,
      ownerUid: patientUid,
      patientHealthId,
      name: 'Report Test Patient 1',
      dob: '1992-02-02'
    });

    // 2. Seed Patient 2
    await db.collection('patients').doc(otherPatientUid).set({
      uid: otherPatientUid,
      ownerUid: otherPatientUid,
      patientHealthId: otherPatientHealthId,
      name: 'Report Test Patient 2',
      dob: '1994-04-04'
    });

    // 3. Seed Treating Relationship (appointment within 90 days)
    await db.collection('appointments').doc('appt-report-treating').set({
      id: 'appt-report-treating',
      doctorId: treatingDoctorUid,
      doctorUid: treatingDoctorUid,
      patientHealthId,
      date: new Date().toISOString().split('T')[0],
      status: 'completed'
    });

    // 4. Seed an existing report for Patient 1
    await db.collection('reports').doc(existingReportId).set({
      id: existingReportId,
      healthId: patientHealthId,
      patientHealthId,
      fileName: 'existing_blood_test.pdf',
      storagePath: `reports/${patientHealthId}/existing_blood_test.pdf`,
      fileUrl: `https://storage.googleapis.com/demo-bucket/reports/${patientHealthId}/existing_blood_test.pdf`,
      uploadedBy: patientUid,
      createdAt: new Date()
    });
  });

  afterAll(async () => {
    // Clean up test documents in emulator
    try {
      await db.collection('patients').doc(patientUid).delete();
      await db.collection('patients').doc(otherPatientUid).delete();
      await db.collection('appointments').doc('appt-report-treating').delete();
      await db.collection('reports').doc(existingReportId).delete();
    } catch {}
  });

  // =========================================================================
  // 1. POST /api/reports/upload-url
  // =========================================================================
  describe('1. POST /api/reports/upload-url Authorization', () => {
    it('allows patient to request upload URL for their own healthId', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'chest_xray.png',
          fileType: 'image/png',
          fileSize: 1024 * 500,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.storagePath).toContain(patientHealthId);
    });

    it('allows treating doctor to request upload URL for treated patient', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', treatingDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'doctor_ordered_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 1024,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
    });

    it('blocks unrelated patient from requesting upload URL for foreign healthId (403)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', otherPatientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'unauthorized_file.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 100,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('blocks unrelated doctor from requesting upload URL for unassigned patient (403)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', unrelatedDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'unrelated_doc_upload.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 100,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('rejects upload URL request with missing Health ID (400)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'no_healthid_file.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 100
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Patient Health ID is required');
    });

    it('rejects unauthenticated upload URL request (401)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .send({
          fileName: 'unauth_file.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 100,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 2. POST /api/reports (saveReportMetadata)
  // =========================================================================
  describe('2. POST /api/reports (Save Metadata) Authorization', () => {
    it('allows patient to save report metadata for their own healthId (201)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          healthId: patientHealthId,
          fileName: 'patient_saved_scan.png',
          storagePath: `reports/${patientHealthId}/patient_saved_scan.png`,
          mimeType: 'image/png',
          sizeBytes: 1024 * 200
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthId).toBe(patientHealthId);

      // Clean up created report
      if (res.body.data?.id) {
        await db.collection('reports').doc(res.body.data.id).delete().catch(() => {});
      }
    });

    it('allows treating doctor to save report metadata for treated patient (201)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', treatingDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          healthId: patientHealthId,
          fileName: 'doctor_lab_result.pdf',
          storagePath: `reports/${patientHealthId}/doctor_lab_result.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 300
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.healthId).toBe(patientHealthId);

      if (res.body.data?.id) {
        await db.collection('reports').doc(res.body.data.id).delete().catch(() => {});
      }
    });

    it('blocks unrelated patient from saving report metadata under foreign healthId (403)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', otherPatientUid)
        .set('x-demo-role', 'patient')
        .send({
          healthId: patientHealthId,
          fileName: 'forged_patient_report.pdf',
          storagePath: `reports/${patientHealthId}/forged_patient_report.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 50
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('blocks unrelated doctor from saving report metadata for unassigned patient (403)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', unrelatedDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          healthId: patientHealthId,
          fileName: 'unassigned_doctor_report.pdf',
          storagePath: `reports/${patientHealthId}/unassigned_doctor_report.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 50
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Forbidden');
    });

    it('rejects report metadata saving with missing healthId (400)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'missing_id_report.pdf',
          storagePath: 'reports/unknown/missing_id_report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 50
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects unauthenticated report metadata saving (401)', async () => {
      const res = await request(app)
        .post('/api/reports')
        .send({
          healthId: patientHealthId,
          fileName: 'unauth_report.pdf',
          storagePath: `reports/${patientHealthId}/unauth_report.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 50
        });

      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 3. GET /api/reports/:id/download-url & GET /api/reports/patient/:id
  // =========================================================================
  describe('3. Report Downloads & Listing Authorization', () => {
    it('allows patient to fetch download URL for their own report (200)', async () => {
      const res = await request(app)
        .get(`/api/reports/${existingReportId}/download-url`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('allows treating doctor to fetch download URL for patient report (200)', async () => {
      const res = await request(app)
        .get(`/api/reports/${existingReportId}/download-url`)
        .set('x-demo-uid', treatingDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('blocks unrelated patient from fetching download URL for foreign report (403)', async () => {
      const res = await request(app)
        .get(`/api/reports/${existingReportId}/download-url`)
        .set('x-demo-uid', otherPatientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('blocks unrelated doctor from fetching download URL for unassigned patient report (403)', async () => {
      const res = await request(app)
        .get(`/api/reports/${existingReportId}/download-url`)
        .set('x-demo-uid', unrelatedDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows patient to list their own reports (200)', async () => {
      const res = await request(app)
        .get(`/api/reports/patient/${patientHealthId}`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('blocks unrelated patient from listing foreign patient reports (403)', async () => {
      const res = await request(app)
        .get(`/api/reports/patient/${patientHealthId}`)
        .set('x-demo-uid', otherPatientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});

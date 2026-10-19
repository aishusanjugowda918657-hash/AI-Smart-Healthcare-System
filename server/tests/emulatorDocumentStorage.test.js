import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { assertDbConnected } from '../src/config/firebase.js';
import {
  saveEmulatorFile,
  getEmulatorFile,
  deleteEmulatorFile,
  getLocalStorageDir,
  resolveSafeLocalPath
} from '../src/services/storageAdapter.js';

describe('Phase 125 — Complete Private Medical Document Storage (Emulator Workflow)', () => {
  let db;

  const patientHealthId = 'HID-STORAGE-PATIENT-001';
  const patientUid = 'user-storage-patient-001';

  const otherPatientHealthId = 'HID-STORAGE-PATIENT-002';
  const otherPatientUid = 'user-storage-patient-002';

  const treatingDoctorUid = 'doc-storage-treating-001';
  const unrelatedDoctorUid = 'doc-storage-unrelated-002';

  const testReportId = 'rep-emulator-test-001';
  const testPrescriptionId = 'RX-EMULATOR-TEST-999';

  // Synthetic PDF document fixture (%PDF-1.4 header)
  const syntheticPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n0000000102 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n173\n%%EOF'
  );

  // Synthetic PNG image fixture (\x89PNG header)
  const syntheticPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length & type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, color, crc
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82 // IEND
  ]);

  beforeAll(async () => {
    db = assertDbConnected();
    process.env.LOCAL_STORAGE_EMULATOR = 'true';

    // 1. Seed Patients
    await db.collection('patients').doc(patientUid).set({
      uid: patientUid,
      ownerUid: patientUid,
      patientHealthId,
      name: 'Storage Test Patient One',
      dob: '1990-01-01',
      age: '36 yrs'
    });

    await db.collection('patients').doc(otherPatientUid).set({
      uid: otherPatientUid,
      ownerUid: otherPatientUid,
      patientHealthId: otherPatientHealthId,
      name: 'Storage Test Patient Two',
      dob: '1995-05-05'
    });

    // 2. Seed Doctor Profiles
    await db.collection('doctors').doc(treatingDoctorUid).set({
      uid: treatingDoctorUid,
      name: 'Sarah Smith',
      specialty: 'Pathology',
      registrationNumber: 'MED-REG-INDIA-2026-99'
    });

    await db.collection('doctors').doc(unrelatedDoctorUid).set({
      uid: unrelatedDoctorUid,
      name: 'Unrelated Doctor',
      specialty: 'Dermatology',
      registrationNumber: 'MED-REG-INDIA-2026-00'
    });

    // 3. Seed Treating Relationship (Active appointment)
    await db.collection('appointments').doc('appt-storage-treating').set({
      id: 'appt-storage-treating',
      doctorId: treatingDoctorUid,
      doctorUid: treatingDoctorUid,
      patientHealthId,
      date: new Date().toISOString().split('T')[0],
      status: 'confirmed'
    });

    // 4. Seed Prescription
    await db.collection('prescriptions').doc(testPrescriptionId).set({
      prescriptionId: testPrescriptionId,
      patientHealthId,
      patientName: 'Storage Test Patient One',
      patientUid,
      doctorUid: treatingDoctorUid,
      doctorName: 'Sarah Smith',
      date: new Date().toISOString().split('T')[0],
      verificationCode: 'VERIFY-RX-SECURE-2026',
      medicines: [
        {
          name: 'Amoxicillin',
          dosage: '500mg',
          frequency: '1-0-1',
          durationDays: 5,
          timing: 'after_food',
          notes: 'Complete entire course'
        }
      ],
      doctorNotes: 'Maintain hydration and rest',
      followupDate: '2026-11-01',
      createdAt: new Date()
    });
  });

  afterAll(async () => {
    try {
      await db.collection('patients').doc(patientUid).delete();
      await db.collection('patients').doc(otherPatientUid).delete();
      await db.collection('doctors').doc(treatingDoctorUid).delete();
      await db.collection('doctors').doc(unrelatedDoctorUid).delete();
      await db.collection('appointments').doc('appt-storage-treating').delete();
      await db.collection('prescriptions').doc(testPrescriptionId).delete();
      await db.collection('reports').doc(testReportId).delete();
    } catch {}
  });

  describe('1. Storage Security, Validation & Directory Traversal Prevention', () => {
    it('enforces maximum file size limit (rejects > 10 MB in upload-url request)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'oversized_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 10 * 1024 * 1024 + 1024, // 10MB + 1KB
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('10 MB');
    });

    it('rejects disallowed file MIME types (.exe, .zip)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'malicious_script.exe',
          fileType: 'application/x-msdownload',
          fileSize: 1024 * 10,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Only PDF, JPG, and PNG');
    });

    it('prevents path traversal attempts in local storage path resolution', () => {
      expect(() => {
        resolveSafeLocalPath('../../../../windows/system32/cmd.exe');
      }).not.toThrow();
      // Safe resolution replaces .. with _ and keeps path within baseDir
      const resolved = resolveSafeLocalPath('../../../../windows/system32/cmd.exe');
      const baseDir = getLocalStorageDir();
      expect(resolved.startsWith(baseDir)).toBe(true);
    });
  });

  describe('2. Working Synthetic-Data Storage: Upload, Download, Cleanup & Overwrite', () => {
    let generatedUploadUrl = '';
    let generatedStoragePath = '';

    it('generates working local emulator upload URL for authorized patient', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'synthetic_blood_work.pdf',
          fileType: 'application/pdf',
          fileSize: syntheticPdfBuffer.length,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.uploadUrl).toContain('/api/reports/emulator-storage/');
      expect(res.body.data.storagePath).toContain(patientHealthId);

      generatedUploadUrl = res.body.data.uploadUrl;
      generatedStoragePath = res.body.data.storagePath;
    });

    it('successfully stores synthetic binary PDF via PUT to emulator storage route', async () => {
      const res = await request(app)
        .put(generatedUploadUrl)
        .set('Content-Type', 'application/pdf')
        .send(syntheticPdfBuffer);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Synthetic diagnostic document stored');
      expect(res.body.data.sizeBytes).toBe(syntheticPdfBuffer.length);

      // Verify physical existence on disk
      const fileOnDisk = getEmulatorFile({ storagePath: generatedStoragePath });
      expect(fileOnDisk.exists).toBe(true);
      expect(fileOnDisk.sizeBytes).toBe(syntheticPdfBuffer.length);
      expect(fileOnDisk.data.toString()).toBe(syntheticPdfBuffer.toString());
    });

    it('persists report metadata in Firestore reports collection', async () => {
      const res = await request(app)
        .post('/api/reports')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          id: testReportId,
          patientHealthId,
          title: 'Complete Blood Count (Synthetic)',
          category: 'Hematology',
          storagePath: generatedStoragePath,
          fileType: 'application/pdf',
          fileSize: syntheticPdfBuffer.length
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testReportId);

      // Verify Firestore document
      const doc = await db.collection('reports').doc(testReportId).get();
      expect(doc.exists).toBe(true);
      expect(doc.data().storagePath).toBe(generatedStoragePath);
    });

    it('generates authorized download URL and retrieves exact original PDF bytes', async () => {
      const urlRes = await request(app)
        .get(`/api/reports/${testReportId}/download-url`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(urlRes.statusCode).toBe(200);
      expect(urlRes.body.success).toBe(true);
      const downloadUrl = urlRes.body.data.downloadUrl;
      expect(downloadUrl).toBeDefined();

      // Retrieve binary content from the download URL
      const downloadRes = await request(app)
        .get(downloadUrl.replace(/\?.*$/, '')); // Test route directly

      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('application/pdf');
      expect(downloadRes.body.length).toBe(syntheticPdfBuffer.length);
      expect(Buffer.compare(downloadRes.body, syntheticPdfBuffer)).toBe(0);
    });

    it('supports repeat upload overwriting the existing storage object cleanly', async () => {
      const updatedPdfBuffer = Buffer.from('%PDF-1.4 Updated synthetic document version 2 %%EOF');

      const putRes = await request(app)
        .put(generatedUploadUrl)
        .set('Content-Type', 'application/pdf')
        .send(updatedPdfBuffer);

      expect(putRes.statusCode).toBe(200);
      expect(putRes.body.data.sizeBytes).toBe(updatedPdfBuffer.length);

      const fileCheck = getEmulatorFile({ storagePath: generatedStoragePath });
      expect(fileCheck.exists).toBe(true);
      expect(fileCheck.sizeBytes).toBe(updatedPdfBuffer.length);
      expect(fileCheck.data.toString()).toBe(updatedPdfBuffer.toString());
    });

    it('returns 404 OBJECT_NOT_FOUND when requesting non-existent storage object', async () => {
      const res = await request(app)
        .get('/api/reports/emulator-storage/reports/HID-UNKNOWN/missing-scan-file.pdf');

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('OBJECT_NOT_FOUND');
    });

    it('cleans up physical file on disk and removes metadata upon report deletion', async () => {
      const delRes = await request(app)
        .delete(`/api/reports/${testReportId}`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(delRes.statusCode).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify Firestore metadata deleted
      const doc = await db.collection('reports').doc(testReportId).get();
      expect(doc.exists).toBe(false);

      // Verify physical disk file deleted
      const fileCheck = getEmulatorFile({ storagePath: generatedStoragePath });
      expect(fileCheck.exists).toBe(false);
    });
  });

  describe('3. Cross-Patient and Doctor RBAC Authorization', () => {
    it('blocks Patient A from requesting upload URL for Patient B (cross-patient breach)', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient')
        .send({
          fileName: 'snoop_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 50,
          healthId: otherPatientHealthId // target is other patient
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('blocks unrelated doctor from requesting upload URL without active appointment', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', unrelatedDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'unauthorized_scan.png',
          fileType: 'image/png',
          fileSize: 1024 * 50,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows treating doctor with active appointment to request upload URL', async () => {
      const res = await request(app)
        .post('/api/reports/upload-url')
        .set('x-demo-uid', treatingDoctorUid)
        .set('x-demo-role', 'doctor')
        .send({
          fileName: 'dr_ordered_biopsy.pdf',
          fileType: 'application/pdf',
          fileSize: 1024 * 200,
          healthId: patientHealthId
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
    });
  });

  describe('4. Prescription Document Handling & Authorized PDF Generation', () => {
    it('allows authorized patient to export prescription PDF with verification code and doctor reg number', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${testPrescriptionId}/pdf`)
        .set('x-demo-uid', patientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(`prescription_${testPrescriptionId}.pdf`);

      // Verify PDF binary header
      const buffer = res.body;
      expect(buffer.slice(0, 4).toString()).toBe('%PDF');
    });

    it('allows treating doctor to export prescription PDF', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${testPrescriptionId}/pdf`)
        .set('x-demo-uid', treatingDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('blocks other unauthorized patient from downloading prescription PDF', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${testPrescriptionId}/pdf`)
        .set('x-demo-uid', otherPatientUid)
        .set('x-demo-role', 'patient');

      expect(res.statusCode).toBe(403);
    });

    it('blocks unrelated doctor from downloading prescription PDF', async () => {
      const res = await request(app)
        .get(`/api/prescriptions/${testPrescriptionId}/pdf`)
        .set('x-demo-uid', unrelatedDoctorUid)
        .set('x-demo-role', 'doctor');

      expect(res.statusCode).toBe(403);
    });
  });
});

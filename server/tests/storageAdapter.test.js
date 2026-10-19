import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateFile,
  buildStoragePath,
  checkStorageAvailability,
  generateSignedUploadUrl,
  generateSignedDownloadUrl,
  deleteStoredFile,
  getStorageProvider,
  resetStorageCache
} from '../src/services/storageAdapter.js';

describe('Storage Adapter Unit & Integration Tests', () => {
  beforeEach(() => {
    resetStorageCache();
    delete process.env.STORAGE_PROVIDER;
    delete process.env.TEST_STORAGE_MOCK;
    delete process.env.TEST_STORAGE_UNAVAILABLE;
  });

  describe('File Validation (validateFile)', () => {
    it('accepts valid PDF file under 10 MB', () => {
      const result = validateFile({
        fileName: 'blood_test_report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024 * 1024 * 2 // 2 MB
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid PNG / JPG image file under 10 MB', () => {
      const result1 = validateFile({
        fileName: 'skin_rash.jpg',
        fileType: 'image/jpeg',
        fileSize: 1024 * 500
      });
      expect(result1.valid).toBe(true);

      const result2 = validateFile({
        fileName: 'xray_scan.png',
        mimeType: 'image/png',
        sizeBytes: 1024 * 1024 * 8 // 8 MB
      });
      expect(result2.valid).toBe(true);
    });

    it('accepts valid DICOM medical imaging file', () => {
      const result = validateFile({
        fileName: 'mri_scan.dcm',
        mimeType: 'application/dicom',
        sizeBytes: 1024 * 1024 * 5 // 5 MB
      });
      expect(result.valid).toBe(true);
    });

    it('rejects file without fileName', () => {
      const result = validateFile({
        fileName: '',
        mimeType: 'application/pdf',
        sizeBytes: 1024
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_FILE_NAME');
    });

    it('rejects unsupported file MIME type (e.g. .exe, .zip)', () => {
      const result = validateFile({
        fileName: 'malicious.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_FILE_TYPE');
    });

    it('rejects files exceeding the 10 MB limit', () => {
      const result = validateFile({
        fileName: 'huge_scan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10 * 1024 * 1024 + 1 // 10 MB + 1 byte
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('FILE_SIZE_EXCEEDED');
      expect(result.error).toContain('10 MB limit');
    });

    it('rejects 0 byte or negative byte files', () => {
      const result = validateFile({
        fileName: 'empty.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0
      });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_FILE_SIZE');
    });
  });

  describe('Storage Path Generation (buildStoragePath)', () => {
    it('creates correct and safe non-public object paths', () => {
      const path = buildStoragePath({
        healthId: 'PHI-2026-AB12CD-3',
        reportId: 'rep-test-123',
        fileName: 'Blood Test (Final).pdf'
      });
      expect(path).toBe('reports/PHI-2026-AB12CD-3/rep-test-123_Blood_Test__Final_.pdf');
    });

    it('sanitizes dangerous traversal characters in path', () => {
      const path = buildStoragePath({
        healthId: '../../etc',
        reportId: 'id/hack',
        fileName: '../../../malicious.pdf'
      });
      expect(path).not.toContain('..');
      expect(path.startsWith('reports/')).toBe(true);
    });
  });

  describe('Storage Availability Checking (checkStorageAvailability)', () => {
    it('returns available: false when TEST_STORAGE_UNAVAILABLE is set', async () => {
      process.env.TEST_STORAGE_UNAVAILABLE = 'true';
      const status = await checkStorageAvailability();
      expect(status.available).toBe(false);
      expect(status.message).toContain('disabled');
    });

    it('returns available: true when TEST_STORAGE_MOCK is set', async () => {
      process.env.TEST_STORAGE_MOCK = 'true';
      const status = await checkStorageAvailability();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('mock');
    });

    it('detects missing R2 credentials when provider is r2', async () => {
      process.env.STORAGE_PROVIDER = 'r2';
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      const status = await checkStorageAvailability();
      expect(status.available).toBe(false);
      expect(status.message).toContain('Cloudflare R2 requires');
    });

    it('detects complete R2 credentials when provider is r2', async () => {
      process.env.STORAGE_PROVIDER = 'r2';
      process.env.R2_ACCOUNT_ID = 'cf_account_123';
      process.env.R2_ACCESS_KEY_ID = 'cf_key_abc';
      process.env.R2_SECRET_ACCESS_KEY = 'cf_secret_xyz';
      process.env.R2_BUCKET_NAME = 'healthcare-reports';

      const status = await checkStorageAvailability();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('r2');
      expect(status.message).toContain('Cloudflare R2 storage is configured');

      // Cleanup
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_BUCKET_NAME;
    });
  });

  describe('Signed Upload and Download URLs', () => {
    it('generates signed upload URL with 15-minute expiration in mock/test mode', async () => {
      process.env.TEST_STORAGE_MOCK = 'true';
      const result = await generateSignedUploadUrl({
        storagePath: 'reports/HID-001/rep-123_lab.pdf',
        contentType: 'application/pdf',
        expiresInSec: 900
      });

      expect(result.uploadUrl).toBeDefined();
      expect(result.storagePath).toBe('reports/HID-001/rep-123_lab.pdf');
      expect(result.expiresInSec).toBe(900);
    });

    it('generates signed download URL with 15-minute expiration in mock/test mode', async () => {
      process.env.TEST_STORAGE_MOCK = 'true';
      const result = await generateSignedDownloadUrl({
        storagePath: 'reports/HID-001/rep-123_lab.pdf',
        expiresInSec: 900
      });

      expect(result.downloadUrl).toBeDefined();
      expect(result.downloadUrl).toContain('reports/HID-001/rep-123_lab.pdf');
      expect(result.expiresInSec).toBe(900);
    });

    it('generates Cloudflare R2 presigned PUT and GET URLs with AWS SigV4 signatures', async () => {
      process.env.STORAGE_PROVIDER = 'r2';
      process.env.R2_ACCOUNT_ID = 'test_acc_987';
      process.env.R2_ACCESS_KEY_ID = 'test_key_456';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret_321';
      process.env.R2_BUCKET_NAME = 'test-medical-vault';

      // Temporarily unset NODE_ENV so it evaluates the R2 branch
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const upload = await generateSignedUploadUrl({
          storagePath: 'reports/HID-TEST/rep-001_scan.pdf',
          contentType: 'application/pdf',
          expiresInSec: 900
        });

        expect(upload.provider).toBe('r2');
        expect(upload.uploadUrl).toContain('https://test_acc_987.r2.cloudflarestorage.com/test-medical-vault/reports/HID-TEST/rep-001_scan.pdf');
        expect(upload.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
        expect(upload.uploadUrl).toContain('X-Amz-Credential=test_key_456');
        expect(upload.uploadUrl).toContain('X-Amz-Expires=900');
        expect(upload.uploadUrl).toContain('X-Amz-Signature=');

        const download = await generateSignedDownloadUrl({
          storagePath: 'reports/HID-TEST/rep-001_scan.pdf',
          expiresInSec: 900
        });

        expect(download.provider).toBe('r2');
        expect(download.downloadUrl).toContain('https://test_acc_987.r2.cloudflarestorage.com/test-medical-vault/reports/HID-TEST/rep-001_scan.pdf');
        expect(download.downloadUrl).toContain('X-Amz-Signature=');
      } finally {
        process.env.NODE_ENV = origEnv;
        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
      }
    });

    it('deletes stored file cleanly without throwing', async () => {
      process.env.TEST_STORAGE_MOCK = 'true';
      const res = await deleteStoredFile({ storagePath: 'reports/HID-001/rep-123.pdf' });
      expect(res.deleted).toBe(true);
    });
  });
});

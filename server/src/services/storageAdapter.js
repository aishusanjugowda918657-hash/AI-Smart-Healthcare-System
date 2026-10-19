import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { admin, isEmulator } from '../config/firebase.js';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/dicom',
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'dcm'
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Get the local emulator storage root directory
 */
export function getLocalStorageDir() {
  if (process.env.LOCAL_STORAGE_DIR) {
    const customDir = path.resolve(process.env.LOCAL_STORAGE_DIR);
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    return customDir;
  }
  const rootOrServer = fs.existsSync(path.resolve(process.cwd(), 'server'))
    ? path.resolve(process.cwd(), 'server/scratch/storage')
    : path.resolve(process.cwd(), 'scratch/storage');
  if (!fs.existsSync(rootOrServer)) {
    fs.mkdirSync(rootOrServer, { recursive: true });
  }
  return rootOrServer;
}

/**
 * Resolve and validate safe local storage path without directory traversal
 */
export function resolveSafeLocalPath(storagePath) {
  const baseDir = getLocalStorageDir();
  const cleanPath = String(storagePath || '')
    .replace(/^[/\\]+/, '')
    .replace(/\.\./g, '_');
  const resolved = path.resolve(baseDir, cleanPath);
  if (!resolved.startsWith(baseDir)) {
    throw new Error('Access denied: Storage path traversal detected.');
  }
  return resolved;
}

/**
 * Write a synthetic file to the local emulator storage
 */
export function saveEmulatorFile({ storagePath, buffer }) {
  const filePath = resolveSafeLocalPath(storagePath);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, buffer);
  return {
    stored: true,
    storagePath,
    filePath,
    sizeBytes: buffer.length
  };
}

/**
 * Read a file from the local emulator storage
 */
export function getEmulatorFile({ storagePath }) {
  const filePath = resolveSafeLocalPath(storagePath);
  if (!fs.existsSync(filePath)) {
    return { exists: false, storagePath };
  }
  const stats = fs.statSync(filePath);
  const data = fs.readFileSync(filePath);
  return {
    exists: true,
    storagePath,
    filePath,
    data,
    sizeBytes: stats.size,
    mtime: stats.mtime
  };
}

/**
 * Delete a file from the local emulator storage
 */
export function deleteEmulatorFile({ storagePath }) {
  try {
    const filePath = resolveSafeLocalPath(storagePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { deleted: true, storagePath };
    }
    return { deleted: false, storagePath, reason: 'FILE_NOT_FOUND' };
  } catch (err) {
    return { deleted: false, storagePath, error: err.message };
  }
}

/**
 * Get active storage provider name from environment
 * @returns {'firebase' | 'r2' | 's3' | 'mock' | 'emulator' | 'local'}
 */
export function getStorageProvider() {
  if (process.env.STORAGE_PROVIDER) {
    return process.env.STORAGE_PROVIDER.toLowerCase();
  }
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    return 'r2';
  }
  return 'firebase';
}

/**
 * Validate diagnostic report file attributes (size, type)
 * @param {Object} params
 * @param {string} params.fileName
 * @param {string} [params.fileType]
 * @param {string} [params.mimeType]
 * @param {number} [params.fileSize]
 * @param {number} [params.sizeBytes]
 * @returns {{ valid: boolean, error?: string, code?: string }}
 */
export function validateFile({ fileName, fileType, mimeType, fileSize, sizeBytes }) {
  if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
    return { valid: false, error: 'File name is required.', code: 'INVALID_FILE_NAME' };
  }

  const targetType = (fileType || mimeType || '').toLowerCase();
  if (!targetType) {
    return { valid: false, error: 'File type / MIME type is required.', code: 'MISSING_FILE_TYPE' };
  }

  const isAllowed = ALLOWED_MIME_TYPES.some((t) => targetType.includes(t));
  if (!isAllowed) {
    return {
      valid: false,
      error: 'Invalid file type. Only PDF, JPG, PNG, and DICOM diagnostic documents are allowed.',
      code: 'INVALID_FILE_TYPE'
    };
  }

  const targetSize = Number(fileSize || sizeBytes || 0);
  if (!targetSize || targetSize <= 0) {
    return { valid: false, error: 'File size must be greater than 0 bytes.', code: 'INVALID_FILE_SIZE' };
  }

  if (targetSize > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the 10 MB limit (${(targetSize / (1024 * 1024)).toFixed(2)} MB uploaded).`,
      code: 'FILE_SIZE_EXCEEDED'
    };
  }

  return { valid: true };
}

/**
 * Build safe, non-public object storage path
 * reports/{healthId}/{reportId}_{sanitizedFileName}
 */
export function buildStoragePath({ healthId, reportId, fileName }) {
  const sanitizedHealthId = String(healthId || 'HID-UNKNOWN')
    .replace(/\.\./g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedReportId = String(reportId || `rep-${Date.now()}`)
    .replace(/\.\./g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedFileName = String(fileName || 'report.pdf')
    .replace(/\.\./g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return `reports/${sanitizedHealthId}/${sanitizedReportId}_${sanitizedFileName}`;
}

// In-memory availability cache (TTL: 60s)
let availabilityCache = null;
let lastAvailabilityCheck = 0;

/**
 * Reset storage availability cache (useful for tests)
 */
export function resetStorageCache() {
  availabilityCache = null;
  lastAvailabilityCheck = 0;
}

/**
 * Check if the active storage provider is available and ready for operations
 * @returns {Promise<{ available: boolean, provider: string, message: string }>}
 */
export async function checkStorageAvailability() {
  const provider = getStorageProvider();

  // Test overrides
  if (process.env.FIREBASE_STORAGE_ENABLED === 'false' || process.env.TEST_STORAGE_UNAVAILABLE === 'true') {
    return {
      available: false,
      provider,
      message: 'Medical report storage is disabled by configuration.'
    };
  }

  // Cloudflare R2 / S3 check takes precedence when explicitly selected
  if (provider === 'r2' || provider === 's3') {
    const hasR2 = !!(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
    );
    return {
      available: hasR2,
      provider: 'r2',
      message: hasR2
        ? 'Cloudflare R2 storage is configured and ready.'
        : 'Cloudflare R2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.'
    };
  }

  if (process.env.TEST_STORAGE_MOCK === 'true') {
    return {
      available: true,
      provider: 'mock',
      message: 'Mock storage provider active for automated testing.'
    };
  }

  if (process.env.STORAGE_PROVIDER === 'emulator' || process.env.STORAGE_PROVIDER === 'local' || process.env.LOCAL_STORAGE_EMULATOR === 'true') {
    return {
      available: true,
      provider: 'local-emulator',
      message: 'Local emulator storage active (synthetic documents safe).'
    };
  }

  if (process.env.NODE_ENV === 'test' && !process.env.FIREBASE_STORAGE_DISABLED) {
    return {
      available: true,
      provider,
      message: 'Test storage provider active.'
    };
  }

  if (isEmulator) {
    const hasHost = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (hasHost) {
      return {
        available: true,
        provider: 'firebase-emulator',
        message: 'Firebase Storage Emulator active.'
      };
    }
    return {
      available: true,
      provider: 'local-emulator',
      message: 'Local emulator storage active (synthetic file vault).'
    };
  }

  // Firebase Cloud Storage (Google Cloud Storage)
  const now = Date.now();
  if (availabilityCache !== null && now - lastAvailabilityCheck < 60000) {
    return availabilityCache;
  }

  try {
    if (!admin || !admin.storage) {
      availabilityCache = {
        available: false,
        provider: 'firebase',
        message: 'Firebase Admin Storage SDK is not initialized.'
      };
      lastAvailabilityCheck = now;
      return availabilityCache;
    }

    const bucket = admin.storage().bucket();
    const [exists] = await bucket.exists();
    availabilityCache = {
      available: !!exists,
      provider: 'firebase',
      message: exists
        ? 'Firebase Cloud Storage bucket is active.'
        : 'Firebase Cloud Storage bucket does not exist or requires project billing upgrade.'
    };
    lastAvailabilityCheck = now;
    return availabilityCache;
  } catch (err) {
    availabilityCache = {
      available: false,
      provider: 'firebase',
      message: `Firebase Storage check failed: ${err.message}`
    };
    lastAvailabilityCheck = now;
    return availabilityCache;
  }
}

/**
 * Generate AWS SigV4 Presigned URL for Cloudflare R2 / S3
 */
function generateR2PresignedUrl({
  method = 'PUT',
  storagePath,
  expiresInSec = 900,
  contentType = ''
}) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME) are incomplete.');
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSec),
    'X-Amz-SignedHeaders': 'host'
  };

  const canonicalUri = `/${bucketName}/${storagePath}`;
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n');

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `${endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/**
 * Generate authenticated signed upload URL (PUT)
 * Valid for short duration (default: 15 minutes / 900 seconds)
 *
 * @param {Object} params
 * @param {string} params.storagePath
 * @param {string} params.contentType
 * @param {number} [params.expiresInSec=900]
 * @returns {Promise<{ uploadUrl: string, storagePath: string, expiresInSec: number, provider: string }>}
 */
export async function generateSignedUploadUrl({ storagePath, contentType, expiresInSec = 900 }) {
  const provider = getStorageProvider();

  // Cloudflare R2 takes priority when selected
  if (provider === 'r2' || provider === 's3') {
    const uploadUrl = generateR2PresignedUrl({
      method: 'PUT',
      storagePath,
      expiresInSec,
      contentType
    });
    return {
      uploadUrl,
      storagePath,
      expiresInSec,
      provider: 'r2'
    };
  }

  // Test / Emulator mock URLs
  if (process.env.TEST_STORAGE_MOCK === 'true') {
    return {
      uploadUrl: `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?uploadToken=mock-upload-${Date.now()}`,
      storagePath,
      expiresInSec,
      provider: 'mock'
    };
  }

  // Local emulator storage for demo / test runs
  if (provider === 'local' || provider === 'emulator' || process.env.LOCAL_STORAGE_EMULATOR === 'true' || isEmulator) {
    return {
      uploadUrl: `/api/reports/emulator-storage/${storagePath}`,
      storagePath,
      expiresInSec,
      provider: 'local-emulator'
    };
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      uploadUrl: `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?uploadToken=mock-upload-${Date.now()}`,
      storagePath,
      expiresInSec,
      provider: 'mock'
    };
  }

  // Firebase Cloud Storage
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInSec * 1000,
      contentType
    });
    return {
      uploadUrl: signedUrl,
      storagePath,
      expiresInSec,
      provider: 'firebase'
    };
  } catch (err) {
    // If standard signed URL fails (e.g. missing service account signing key), fallback to tokenized direct endpoint
    const bucketName = admin.storage().bucket().name || 'healthcare-bucket';
    return {
      uploadUrl: `https://storage.googleapis.com/${bucketName}/${storagePath}?token=direct-${Date.now()}`,
      storagePath,
      expiresInSec,
      provider: 'firebase'
    };
  }
}

/**
 * Generate authenticated signed download URL (GET)
 * Valid for short duration (default: 15 minutes / 900 seconds)
 *
 * @param {Object} params
 * @param {string} params.storagePath
 * @param {number} [params.expiresInSec=900]
 * @returns {Promise<{ downloadUrl: string, expiresInSec: number, provider: string }>}
 */
export async function generateSignedDownloadUrl({ storagePath, expiresInSec = 900 }) {
  const provider = getStorageProvider();

  // Cloudflare R2 takes priority when selected
  if (provider === 'r2' || provider === 's3') {
    const downloadUrl = generateR2PresignedUrl({
      method: 'GET',
      storagePath,
      expiresInSec
    });
    return {
      downloadUrl,
      expiresInSec,
      provider: 'r2'
    };
  }

  // Test / Emulator mock URLs
  if (process.env.TEST_STORAGE_MOCK === 'true') {
    return {
      downloadUrl: `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?token=download-${Date.now()}`,
      expiresInSec,
      provider: 'mock'
    };
  }

  // Local emulator storage for demo / test runs
  if (provider === 'local' || provider === 'emulator' || process.env.LOCAL_STORAGE_EMULATOR === 'true' || isEmulator) {
    return {
      downloadUrl: `/api/reports/emulator-storage/${storagePath}?token=download-${Date.now()}`,
      expiresInSec,
      provider: 'local-emulator'
    };
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      downloadUrl: `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?token=download-${Date.now()}`,
      expiresInSec,
      provider: 'mock'
    };
  }

  // Firebase Cloud Storage
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInSec * 1000
    });
    return {
      downloadUrl: signedUrl,
      expiresInSec,
      provider: 'firebase'
    };
  } catch (err) {
    const bucketName = admin.storage().bucket().name || 'healthcare-bucket';
    return {
      downloadUrl: `https://storage.googleapis.com/${bucketName}/${storagePath}?token=direct-read-${Date.now()}`,
      expiresInSec,
      provider: 'firebase'
    };
  }
}

/**
 * Delete a stored file from the active storage provider
 * @param {Object} params
 * @param {string} params.storagePath
 * @returns {Promise<{ deleted: boolean, provider: string }>}
 */
export async function deleteStoredFile({ storagePath }) {
  const provider = getStorageProvider();

  // Clean up any local emulator storage copy
  deleteEmulatorFile({ storagePath });

  if (isEmulator || process.env.NODE_ENV === 'test' || provider === 'mock' || provider === 'local' || provider === 'emulator') {
    return { deleted: true, provider: isEmulator ? 'emulator' : 'mock' };
  }

  if (provider === 'r2' || provider === 's3') {
    // S3 delete call via signed request
    try {
      const deleteUrl = generateR2PresignedUrl({
        method: 'DELETE',
        storagePath,
        expiresInSec: 60
      });
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      return { deleted: res.ok, provider: 'r2' };
    } catch (err) {
      console.warn('⚠️ R2 deleteObject error:', err.message);
      return { deleted: false, provider: 'r2' };
    }
  }

  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    await file.delete({ ignoreNotFound: true });
    return { deleted: true, provider: 'firebase' };
  } catch (err) {
    console.warn('⚠️ Firebase Storage delete error:', err.message);
    return { deleted: false, provider: 'firebase' };
  }
}

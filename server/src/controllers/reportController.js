import { assertDbConnected, isEmulator, admin } from '../config/firebase.js';
import { verifyRecordAccess } from './medicalController.js';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'pdf',
  'jpg',
  'png',
  'jpeg'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes

// In-memory cache for storage bucket availability check
let storageAvailableCache = null;
let lastStorageCheck = 0;

/**
 * Check if Firebase Cloud Storage is available
 */
export async function checkStorageAvailable() {
  if (process.env.FIREBASE_STORAGE_ENABLED === 'false') {
    return false;
  }
  if (process.env.TEST_STORAGE_UNAVAILABLE === 'true') {
    return false;
  }
  if (process.env.NODE_ENV === 'test' && !process.env.FIREBASE_STORAGE_DISABLED) {
    return true;
  }
  if (isEmulator) {
    return !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  }
  const now = Date.now();
  if (storageAvailableCache !== null && now - lastStorageCheck < 60000) {
    return storageAvailableCache;
  }
  try {
    if (!admin || !admin.storage) {
      storageAvailableCache = false;
      lastStorageCheck = now;
      return false;
    }
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.exists();
    storageAvailableCache = !!exists;
    lastStorageCheck = now;
    return storageAvailableCache;
  } catch (err) {
    storageAvailableCache = false;
    lastStorageCheck = now;
    return false;
  }
}

/**
 * GET /api/reports/status
 * Return Storage availability status and operational message
 */
export const getReportStorageStatus = async (req, res, next) => {
  try {
    const storageAvailable = await checkStorageAvailable();
    res.status(200).json({
      success: true,
      data: {
        storageAvailable,
        message: storageAvailable
          ? 'Firebase Cloud Storage is active.'
          : 'Medical report uploads are temporarily unavailable. Other healthcare features remain accessible.'
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reports/upload-url
 * Generate Signed Upload URL for Diagnostic Report
 * PRD F9: checks file type (PDF, JPG, PNG) and size up to 10 MB.
 */
export const getReportUploadUrl = async (req, res, next) => {
  try {
    const { fileName, fileType, mimeType, fileSize, sizeBytes, patientHealthId, healthId } = req.body;
    const targetHealthId = healthId || patientHealthId;
    const targetType = (fileType || mimeType || '').toLowerCase();
    const targetSize = Number(fileSize || sizeBytes || 0);

    if (!fileName || !targetType || !targetSize) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: fileName, fileType, and fileSize are required.'
      });
    }

    const isAllowedType = ALLOWED_TYPES.some((t) => targetType.includes(t));
    if (!isAllowedType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid File Type: Only PDF, JPG, and PNG files are allowed.'
      });
    }

    if (targetSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File Size Exceeded: Maximum allowed file size for diagnostic reports is 10 MB.'
      });
    }

    if (!targetHealthId) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: Patient Health ID is required.'
      });
    }

    const { uid, role } = req.user;
    const db = assertDbConnected();

    // Verify authenticated user's access to target patient
    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: targetHealthId,
      reqQuery: req.query,
      reqBody: req.body
    });

    if (!access.authorized) {
      return res.status(403).json({
        success: false,
        message: access.message || access.reason || 'Forbidden: You are not authorized to upload reports for this patient.'
      });
    }

    // Check whether Firebase Storage is available on the project
    const storageReady = await checkStorageAvailable();
    if (!storageReady) {
      return res.status(503).json({
        success: false,
        code: 'STORAGE_NOT_AVAILABLE',
        message: 'Medical report uploads are temporarily unavailable. Other healthcare features remain accessible.'
      });
    }

    const reportId = `rep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const sanitizedFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `reports/${targetHealthId}/${reportId}_${sanitizedFileName}`;

    let uploadUrl;
    if (isEmulator || process.env.NODE_ENV === 'test') {
      uploadUrl = `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?uploadToken=mock-upload-${Date.now()}`;
    } else {
      try {
        const bucket = admin.storage().bucket();
        const file = bucket.file(storagePath);
        const [signedUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + 15 * 60 * 1000, // 15 minutes
          contentType: targetType
        });
        uploadUrl = signedUrl;
      } catch (signErr) {
        uploadUrl = `https://storage.googleapis.com/${admin.storage().bucket().name}/${storagePath}?token=direct-${Date.now()}`;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        reportId,
        uploadUrl,
        storagePath,
        expiresInSec: 900
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reports
 * Save Diagnostic Report Metadata
 * PRD 4.2: healthId, visitId?, fileName, storagePath, mimeType, sizeBytes, uploadedBy, flagged?
 */
export const saveReportMetadata = async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const {
      id: customId,
      patientHealthId,
      healthId,
      visitId = null,
      fileName,
      title,
      category = 'Diagnostic Report',
      storagePath,
      fileUrl,
      fileType,
      mimeType,
      fileSize,
      sizeBytes,
      flagged = false
    } = req.body;

    const targetHealthId = healthId || patientHealthId;
    const targetFileName = fileName || title;
    const targetMime = mimeType || fileType || 'application/pdf';
    const targetSize = Number(sizeBytes || fileSize || 1024);

    if (!targetHealthId || !targetFileName || (!storagePath && !fileUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: healthId, fileName, and storagePath/fileUrl are required.'
      });
    }

    const db = assertDbConnected();

    // Verify authenticated user's access to target patient
    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: targetHealthId,
      reqQuery: req.query,
      reqBody: req.body
    });

    if (!access.authorized) {
      return res.status(403).json({
        success: false,
        message: access.message || access.reason || 'Forbidden: You are not authorized to save reports for this patient.'
      });
    }

    const id = customId || `rep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();

    const reportData = {
      id,
      healthId: targetHealthId,
      patientHealthId: targetHealthId,
      visitId: visitId || null,
      fileName: targetFileName,
      title: targetFileName,
      category,
      storagePath: storagePath || '',
      fileUrl: fileUrl || (storagePath ? `https://storage.googleapis.com/demo-bucket/${storagePath}` : ''),
      mimeType: targetMime,
      fileType: targetMime,
      sizeBytes: targetSize,
      fileSize: targetSize,
      uploadedBy: uid,
      uploadedByUid: uid,
      uploadedByRole: role,
      flagged: Boolean(flagged),
      createdAt: now,
      updatedAt: now
    };

    await db.collection('reports').doc(id).set(reportData);

    const requestId = req?.requestId || req?.headers?.['x-request-id'] || `req-${Date.now()}`;
    await db.collection('auditLogs').add({
      actorUid: uid,
      actorRole: role,
      userId: uid,
      userRole: role,
      action: 'UPLOAD_REPORT',
      targetType: 'report',
      targetId: id,
      healthId: targetHealthId,
      patientHealthId: targetHealthId,
      details: { fileName: targetFileName, sizeBytes: targetSize },
      at: now,
      timestamp: now,
      requestId
    });

    res.status(201).json({
      success: true,
      message: 'Diagnostic report saved successfully.',
      data: reportData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reports/:id/url or GET /api/reports/:id/download-url
 * Get Signed Download URL for Report
 */
export const getReportDownloadUrl = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { uid, role } = req.user;

    const db = assertDbConnected();
    const reportDoc = await db.collection('reports').doc(id).get();

    if (!reportDoc.exists) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const reportData = reportDoc.data();
    const targetHealthId = reportData.healthId || reportData.patientHealthId;

    // Access control check
    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: targetHealthId,
      reqQuery: req.query
    });

    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    let downloadUrl = reportData.fileUrl;
    if (reportData.storagePath && !isEmulator && process.env.NODE_ENV !== 'test') {
      try {
        const bucket = admin.storage().bucket();
        const file = bucket.file(reportData.storagePath);
        const [signedUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 15 * 60 * 1000 // 15 minutes
        });
        downloadUrl = signedUrl;
      } catch (e) {
        downloadUrl = reportData.fileUrl || `https://storage.googleapis.com/${reportData.storagePath}`;
      }
    } else if (!downloadUrl) {
      downloadUrl = `https://storage.googleapis.com/demo-healthcare-bucket/${reportData.storagePath}?token=download-${Date.now()}`;
    }

    res.status(200).json({
      success: true,
      data: {
        id,
        downloadUrl,
        expiresInSec: 900
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reports/patient/:patientHealthId
 * List Reports for Patient
 */
export const getPatientReports = async (req, res, next) => {
  try {
    const targetHealthId = req.params.patientHealthId || req.params.healthId;
    const { uid, role } = req.user;
    const db = assertDbConnected();

    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: targetHealthId,
      reqQuery: req.query
    });

    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const snap = await db
      .collection('reports')
      .where('healthId', '==', targetHealthId)
      .get();

    const snap2 = await db
      .collection('reports')
      .where('patientHealthId', '==', targetHealthId)
      .get();

    const map = new Map();
    [...snap.docs, ...snap2.docs].forEach((d) => map.set(d.id, d.data()));

    const reports = Array.from(map.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.status(200).json({
      success: true,
      healthId: targetHealthId,
      data: reports
    });
  } catch (error) {
    next(error);
  }
};

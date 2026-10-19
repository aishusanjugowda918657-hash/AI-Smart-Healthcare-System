import path from 'path';
import { assertDbConnected, isEmulator, admin } from '../config/firebase.js';
import { verifyRecordAccess } from './medicalController.js';
import {
  validateFile,
  buildStoragePath,
  checkStorageAvailability,
  generateSignedUploadUrl,
  generateSignedDownloadUrl,
  deleteStoredFile,
  saveEmulatorFile,
  getEmulatorFile,
  deleteEmulatorFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES
} from '../services/storageAdapter.js';

const ALLOWED_TYPES = ALLOWED_MIME_TYPES;
const MAX_FILE_SIZE = MAX_FILE_SIZE_BYTES;

/**
 * Check if storage provider is available
 */
export async function checkStorageAvailable() {
  const result = await checkStorageAvailability();
  return result.available;
}

/**
 * GET /api/reports/status
 * Return Storage availability status and operational message
 */
export const getReportStorageStatus = async (req, res, next) => {
  try {
    const status = await checkStorageAvailability();
    res.status(200).json({
      success: true,
      data: {
        storageAvailable: status.available,
        provider: status.provider,
        message: status.available
          ? `${status.provider.toUpperCase()} Cloud Storage is active.`
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

    const validation = validateFile({
      fileName,
      fileType: targetType,
      fileSize: targetSize
    });

    if (!validation.valid) {
      if (validation.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          success: false,
          message: 'Invalid File Type: Only PDF, JPG, and PNG files are allowed.'
        });
      }
      if (validation.code === 'FILE_SIZE_EXCEEDED') {
        return res.status(400).json({
          success: false,
          message: 'File Size Exceeded: Maximum allowed file size for diagnostic reports is 10 MB.'
        });
      }
      return res.status(400).json({
        success: false,
        message: validation.error || 'Validation Error: Invalid file attributes.'
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

    // Check whether Storage is available on the project
    const storageStatus = await checkStorageAvailability();
    if (!storageStatus.available) {
      return res.status(503).json({
        success: false,
        code: 'STORAGE_NOT_AVAILABLE',
        message: 'Medical report uploads are temporarily unavailable. Other healthcare features remain accessible.'
      });
    }

    const reportId = `rep-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const storagePath = buildStoragePath({ healthId: targetHealthId, reportId, fileName });

    const signedUpload = await generateSignedUploadUrl({
      storagePath,
      contentType: targetType,
      expiresInSec: 900
    });

    res.status(200).json({
      success: true,
      data: {
        reportId,
        uploadUrl: signedUpload.uploadUrl,
        storagePath: signedUpload.storagePath,
        expiresInSec: signedUpload.expiresInSec,
        provider: signedUpload.provider
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
    if (reportData.storagePath) {
      const signedDownload = await generateSignedDownloadUrl({
        storagePath: reportData.storagePath,
        expiresInSec: 900
      });
      downloadUrl = signedDownload.downloadUrl;
    } else if (!downloadUrl) {
      downloadUrl = `https://storage.googleapis.com/demo-healthcare-bucket/reports/${targetHealthId}/${id}?token=download-${Date.now()}`;
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
 * DELETE /api/reports/:id
 * Delete diagnostic report and remove from private storage
 */
export const deleteReport = async (req, res, next) => {
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

    // Clean up physical file from storage provider
    if (reportData.storagePath) {
      await deleteStoredFile({ storagePath: reportData.storagePath });
    }

    // Delete Firestore metadata record
    await db.collection('reports').doc(id).delete();

    // Log deletion event in audit logs
    const requestId = req?.requestId || req?.headers?.['x-request-id'] || `req-${Date.now()}`;
    await db.collection('auditLogs').add({
      actorUid: uid,
      actorRole: role,
      userId: uid,
      userRole: role,
      action: 'DELETE_REPORT',
      targetType: 'report',
      targetId: id,
      healthId: targetHealthId,
      patientHealthId: targetHealthId,
      details: { fileName: reportData.fileName, storagePath: reportData.storagePath },
      at: new Date(),
      timestamp: new Date(),
      requestId
    });

    res.status(200).json({
      success: true,
      message: 'Diagnostic report deleted successfully.',
      data: { id }
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

/**
 * PUT /api/reports/emulator-storage/*
 * Handle binary upload into local emulator storage
 */
export const uploadEmulatorStorageFile = async (req, res, next) => {
  try {
    const rawPath = req.params[0] || req.params.filePath;
    if (!rawPath) {
      return res.status(400).json({ success: false, message: 'Storage path is required.' });
    }
    const storagePath = rawPath.replace(/^\/+/, '');

    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.alloc(0);

    if (buffer.length === 0) {
      return res.status(400).json({ success: false, message: 'Upload body is empty. Binary file data required.' });
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        code: 'FILE_SIZE_EXCEEDED',
        message: `File size exceeds 10 MB limit (${(buffer.length / (1024 * 1024)).toFixed(2)} MB uploaded).`
      });
    }

    const result = saveEmulatorFile({ storagePath, buffer });
    res.status(200).json({
      success: true,
      message: 'Synthetic diagnostic document stored in local emulator storage.',
      data: {
        storagePath: result.storagePath,
        sizeBytes: result.sizeBytes
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reports/emulator-storage/*
 * Serve binary file from local emulator storage
 */
export const downloadEmulatorStorageFile = async (req, res, next) => {
  try {
    const rawPath = req.params[0] || req.params.filePath;
    if (!rawPath) {
      return res.status(400).json({ success: false, message: 'Storage path is required.' });
    }
    const storagePath = rawPath.replace(/^\/+/, '');

    const file = getEmulatorFile({ storagePath });
    if (!file.exists) {
      return res.status(404).json({
        success: false,
        code: 'OBJECT_NOT_FOUND',
        message: 'Document object not found in storage.'
      });
    }

    const ext = path.extname(storagePath).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.dcm': 'application/dicom',
      '.txt': 'text/plain'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', file.sizeBytes);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(storagePath)}"`);
    res.send(file.data);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/reports/emulator-storage/*
 * Delete binary file from local emulator storage
 */
export const deleteEmulatorStorageFile = async (req, res, next) => {
  try {
    const rawPath = req.params[0] || req.params.filePath;
    if (!rawPath) {
      return res.status(400).json({ success: false, message: 'Storage path is required.' });
    }
    const storagePath = rawPath.replace(/^\/+/, '');

    const result = deleteEmulatorFile({ storagePath });
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};


import { assertDbConnected } from '../config/firebase.js';
import { verifyRecordAccess } from './medicalController.js';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'pdf',
  'jpg',
  'png'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes

/**
 * Generate Signed Upload URL for Diagnostic Report
 */
export const getReportUploadUrl = async (req, res, next) => {
  try {
    const { fileName, fileType, fileSize, patientHealthId } = req.body;

    if (!fileName || !fileType || !fileSize) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: fileName, fileType, and fileSize are required.'
      });
    }

    const normType = fileType.toLowerCase();
    const isAllowedType = ALLOWED_TYPES.some((t) => normType.includes(t));
    if (!isAllowedType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid File Type: Only PDF, JPG, and PNG files are allowed.'
      });
    }

    if (Number(fileSize) > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File Size Exceeded: Maximum allowed file size for diagnostic reports is 10 MB.'
      });
    }

    const reportId = `rep-${Date.now().toString(36)}`;
    const storagePath = `reports/${patientHealthId || 'gen'}/${reportId}_${fileName}`;

    // Generate mock/signed upload URL safely
    const uploadUrl = `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}?uploadToken=mock-upload-${Date.now()}`;

    res.status(200).json({
      success: true,
      data: {
        reportId,
        uploadUrl,
        storagePath,
        expiresInSec: 3600
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Save Diagnostic Report Metadata
 */
export const saveReportMetadata = async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const {
      id: customId,
      patientHealthId,
      title,
      category = 'Lab Report',
      fileUrl,
      storagePath,
      fileType,
      fileSize
    } = req.body;

    if (!patientHealthId || !title || (!fileUrl && !storagePath)) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error: patientHealthId, title, and fileUrl/storagePath are required.'
      });
    }

    const db = assertDbConnected();
    const id = customId || `rep-${Date.now().toString(36)}`;
    const now = new Date();

    const reportData = {
      id,
      patientHealthId,
      uploadedByUid: uid,
      uploadedByRole: role,
      title,
      category,
      fileUrl: fileUrl || `https://storage.googleapis.com/demo-healthcare-bucket/${storagePath}`,
      storagePath: storagePath || '',
      fileType: fileType || 'application/pdf',
      fileSize: fileSize || 1024,
      createdAt: now
    };

    await db.collection('reports').doc(id).set(reportData);

    await db.collection('auditLogs').add({
      userId: uid,
      userRole: role,
      action: 'UPLOAD_REPORT',
      resourceType: 'report',
      resourceId: id,
      patientHealthId,
      timestamp: now
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

    // Access control check
    const access = await verifyRecordAccess({
      db,
      uid,
      role,
      patientHealthId: reportData.patientHealthId,
      reqQuery: req.query
    });

    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const downloadUrl = reportData.fileUrl || `https://storage.googleapis.com/demo-healthcare-bucket/${reportData.storagePath}?token=mock-download-${Date.now()}`;

    res.status(200).json({
      success: true,
      data: {
        id,
        downloadUrl,
        expiresInSec: 3600
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List Diagnostic Reports for Patient
 */
export const getPatientReports = async (req, res, next) => {
  try {
    const { patientHealthId } = req.params;
    const { uid, role } = req.user;

    const db = assertDbConnected();

    const access = await verifyRecordAccess({ db, uid, role, patientHealthId, reqQuery: req.query });
    if (!access.authorized) {
      return res.status(403).json({ success: false, message: access.message || access.reason });
    }

    const snapshot = await db
      .collection('reports')
      .where('patientHealthId', '==', patientHealthId)
      .get();

    const reports = snapshot.docs.map((d) => d.data());

    res.status(200).json({
      success: true,
      patientHealthId,
      data: reports
    });
  } catch (error) {
    next(error);
  }
};

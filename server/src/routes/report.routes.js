import express from 'express';
import {
  getReportUploadUrl,
  saveReportMetadata,
  getReportDownloadUrl,
  getPatientReports,
  getReportStorageStatus,
  deleteReport,
  uploadEmulatorStorageFile,
  downloadEmulatorStorageFile,
  deleteEmulatorStorageFile
} from '../controllers/reportController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Raw body parser for synthetic document binary payloads (up to 12 MB)
const rawBodyParser = express.raw({ type: '*/*', limit: '12mb' });

router.get('/status', getReportStorageStatus);
router.post('/upload-url', requireAuth, getReportUploadUrl);
router.post('/', requireAuth, saveReportMetadata);
router.get('/:id/download-url', requireAuth, getReportDownloadUrl);
router.get('/:id/url', requireAuth, getReportDownloadUrl);
router.delete('/:id', requireAuth, deleteReport);
router.get('/patient/:patientHealthId', requireAuth, getPatientReports);

// Local Emulator Storage Endpoints (Binary synthetic document vault)
router.put('/emulator-storage/*', rawBodyParser, uploadEmulatorStorageFile);
router.get('/emulator-storage/*', downloadEmulatorStorageFile);
router.delete('/emulator-storage/*', deleteEmulatorStorageFile);

export default router;

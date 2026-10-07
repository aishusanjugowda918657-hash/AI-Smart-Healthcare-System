import express from 'express';
import {
  getReportUploadUrl,
  saveReportMetadata,
  getReportDownloadUrl,
  getPatientReports
} from '../controllers/reportController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/upload-url', requireAuth, getReportUploadUrl);
router.post('/', requireAuth, saveReportMetadata);
router.get('/:id/download-url', requireAuth, getReportDownloadUrl);
router.get('/:id/url', requireAuth, getReportDownloadUrl);
router.get('/patient/:patientHealthId', requireAuth, getPatientReports);

export default router;

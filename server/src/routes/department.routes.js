import express from 'express';
import { getDepartments, createDepartment } from '../controllers/doctorController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getDepartments);
router.post('/', requireAuth, requireRole('admin'), createDepartment);

export default router;

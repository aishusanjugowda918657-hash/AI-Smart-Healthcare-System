import express from 'express';
import { getAdminAnalyticsOverview, setUserRole } from '../controllers/adminController.js';
import { adminMergePatients } from '../controllers/patientController.js';
import { saveDoctorSchedule } from '../controllers/doctorController.js';
import { adminGenerateSlots, adminCreateLeave, adminDeleteLeave } from '../controllers/slotController.js';
import { getLeaveRescheduleProgress } from '../jobs/leaveReschedule.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/analytics/overview', requireAuth, requireRole('admin'), getAdminAnalyticsOverview);
router.post('/users/:uid/role', requireAuth, requireRole('admin'), setUserRole);
router.post('/patients/merge', requireAuth, requireRole('admin'), adminMergePatients);

// Doctor Schedule & Leave Management (PRD F2 & F16)
router.put('/doctors/:id/schedule', requireAuth, requireRole('admin'), saveDoctorSchedule);
router.post('/leaves', requireAuth, requireRole('admin', 'doctor'), adminCreateLeave);
router.delete('/leaves/:id', requireAuth, requireRole('admin'), adminDeleteLeave);
router.get('/leaves/:id/progress', requireAuth, requireRole('admin', 'doctor'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const progress = await getLeaveRescheduleProgress(id);
    res.status(200).json({ success: true, progress });
  } catch (error) {
    next(error);
  }
});
router.post('/slots/generate', requireAuth, requireRole('admin'), adminGenerateSlots);

export default router;

import express from 'express';
import {
  registerUser,
  loginSync,
  getMe,
  updatePreferences,
  addDeviceToken,
  removeDeviceToken,
  changeDoctorPassword
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login-sync', requireAuth, loginSync);
router.get('/me', requireAuth, getMe);
router.patch('/me/preferences', requireAuth, updatePreferences);
router.post('/me/devices', requireAuth, addDeviceToken);
router.delete('/me/devices', requireAuth, removeDeviceToken);
router.post('/change-password', requireAuth, changeDoctorPassword);

export default router;

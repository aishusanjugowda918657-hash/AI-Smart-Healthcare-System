import express from 'express';
import { registerUser, loginSync, getMe, changeDoctorPassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login-sync', requireAuth, loginSync);
router.get('/me', requireAuth, getMe);
router.post('/change-password', requireAuth, changeDoctorPassword);

export default router;


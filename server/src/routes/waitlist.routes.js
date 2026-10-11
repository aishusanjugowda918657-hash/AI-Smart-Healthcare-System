import express from 'express';
import {
  joinWaitlist,
  leaveWaitlist
} from '../services/waitlistService.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { assertDbConnected } from '../config/firebase.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { doctorId, departmentId, dateFrom, dateTo, timeWindow, clinicalLevel, healthId, patientName } = req.body;
    const userId = req.user?.uid || req.user?.id;
    const targetHealthId = healthId || req.user?.patientHealthId || userId;

    const entry = await joinWaitlist({
      healthId: targetHealthId,
      patientName: patientName || req.user?.fullName || 'Patient',
      userId,
      doctorId,
      departmentId,
      dateFrom,
      dateTo,
      timeWindow,
      clinicalLevel
    });

    res.status(201).json({
      success: true,
      message: 'Joined waiting list successfully.',
      waitlist: entry
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.uid || req.user?.id;
    const role = req.user?.role;
    const result = await leaveWaitlist(id, userId, role);
    if (!result.success && result.message?.includes('Forbidden')) {
      return res.status(403).json(result);
    }
    if (!result.success && result.message?.includes('not found')) {
      return res.status(404).json(result);
    }
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/my-entries', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.uid || req.user?.id;
    const db = assertDbConnected();

    const snap = await db.collection('waitlist')
      .where('userId', '==', userId)
      .where('status', 'in', ['waiting', 'offered'])
      .get();

    const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.status(200).json({
      success: true,
      entries
    });
  } catch (error) {
    next(error);
  }
});

export default router;

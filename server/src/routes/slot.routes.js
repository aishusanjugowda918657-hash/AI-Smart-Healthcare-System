import express from 'express';
import { getSlots, holdSlot, releaseSlot } from '../controllers/slotController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', getSlots);
router.post('/hold', requireAuth, holdSlot);
router.post('/release', requireAuth, releaseSlot);

export default router;

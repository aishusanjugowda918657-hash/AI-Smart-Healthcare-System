import express from 'express';
import {
  acceptOffer,
  declineOffer,
  getUserOffers,
  getOfferById
} from '../controllers/offerController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/my-offers', requireAuth, getUserOffers);
router.get('/:id', requireAuth, getOfferById);
router.post('/:id/accept', requireAuth, acceptOffer);
router.post('/:id/decline', requireAuth, declineOffer);

export default router;

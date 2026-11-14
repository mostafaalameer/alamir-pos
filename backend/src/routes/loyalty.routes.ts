import { Router } from 'express';
import { Role } from '@prisma/client';
import { LoyaltyController } from '../controllers/loyalty.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// Both ADMIN and CASHIER can read active loyalty settings
router.get('/settings', authenticate, LoyaltyController.getSettings);

// Only ADMIN can update loyalty rules
router.put(
  '/settings',
  authenticate,
  authorizeRoles(Role.ADMIN),
  LoyaltyController.updateSettings
);

export default router;


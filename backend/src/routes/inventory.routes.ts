import { Router } from 'express';
import { Role } from '@prisma/client';
import { ProductController } from '../controllers/product.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// GET /api/inventory/expiring?days=30
router.get(
  '/expiring',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ProductController.getExpiryAlerts
);

export default router;


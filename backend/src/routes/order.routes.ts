import { Router } from 'express';
import { Role } from '@prisma/client';
import { OrderController } from '../controllers/order.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', authenticate, authorizeRoles(Role.ADMIN), OrderController.listOrders);
router.get('/next-number', authenticate, OrderController.getNextOrderNumber);
router.post('/', authenticate, OrderController.createOrder);
router.get('/number/:orderNumber', authenticate, OrderController.getOrderByNumber);
router.post('/:id/return', authenticate, OrderController.returnOrder);

export default router;


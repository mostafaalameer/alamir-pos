import { Router } from 'express';
import { Role } from '@prisma/client';
import { AuthController } from '../controllers/auth.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

router.post('/login', AuthController.login);
router.get('/me', authenticate, AuthController.getMe);
router.post('/verify-pin', authenticate, AuthController.verifyManagerPin);
router.get('/audit-logs', authenticate, authorizeRoles(Role.ADMIN), AuthController.getAuditLogs);
router.post('/users', authenticate, authorizeRoles(Role.ADMIN), AuthController.registerUser);
router.get('/users', authenticate, authorizeRoles(Role.ADMIN), AuthController.listUsers);
router.patch('/users/:id', authenticate, authorizeRoles(Role.ADMIN), AuthController.updateUser);

export default router;


import { Router } from 'express';
import { Role } from '@prisma/client';
import { BackupController } from '../controllers/backup.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

router.get('/export', authenticate, authorizeRoles(Role.ADMIN), BackupController.exportBackup);
router.post('/restore', authenticate, authorizeRoles(Role.ADMIN), BackupController.restoreBackup);

export default router;


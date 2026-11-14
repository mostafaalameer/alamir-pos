import { Router } from 'express';
import { Role } from '@prisma/client';
import { SyncAndPrinterController } from '../controllers/sync.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

router.get('/pull', authenticate, SyncAndPrinterController.pullCatalog);
router.post('/push', authenticate, SyncAndPrinterController.pushOfflineOrders);
router.get('/backup', authenticate, authorizeRoles(Role.ADMIN), SyncAndPrinterController.exportBackup);
router.post('/telemetry', authenticate, SyncAndPrinterController.recordTelemetry);
router.get('/telemetry', authenticate, authorizeRoles(Role.ADMIN), SyncAndPrinterController.listTelemetry);
router.post('/hardware/receipt', authenticate, SyncAndPrinterController.formatThermalReceipt);
router.post('/hardware/return-receipt', authenticate, SyncAndPrinterController.formatReturnReceipt);
router.post('/hardware/z-report', authenticate, SyncAndPrinterController.formatZReport);
router.post('/hardware/drawer-kick', authenticate, SyncAndPrinterController.kickCashDrawer);
router.post('/hardware/test-print', authenticate, SyncAndPrinterController.testThermalPrinter);

export default router;

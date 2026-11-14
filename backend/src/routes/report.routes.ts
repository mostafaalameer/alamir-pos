import { Router } from 'express';
import { Role } from '@prisma/client';
import { ReportController } from '../controllers/report.controller';
import { authenticate, authorizeRoles } from '../middlewares/auth.middleware';

const router = Router();

// Strictly restricted to ADMIN role (contains cost prices, margins, valuation, and shift audits)
router.get(
  '/overview',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ReportController.getDashboardOverview
);
router.get('/pnl', authenticate, authorizeRoles(Role.ADMIN), ReportController.getProfitAndLoss);
router.get(
  '/sales/excel',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ReportController.exportSalesExcel
);
router.get(
  '/inventory/excel',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ReportController.exportInventoryExcel
);
router.get(
  '/shifts/excel',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ReportController.exportShiftsExcel
);
router.get(
  '/excel',
  authenticate,
  authorizeRoles(Role.ADMIN),
  ReportController.exportExcelReport
);

export default router;

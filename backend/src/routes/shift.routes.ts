import { Router } from 'express';
import { ShiftController } from '../controllers/shift.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.post('/open', authenticate, ShiftController.openShift);
router.get('/active', authenticate, ShiftController.getActiveShift);
router.get('/current', authenticate, ShiftController.getActiveShift);
router.post('/cash-movement', authenticate, ShiftController.recordCashMovement);
router.get('/:id/movements', authenticate, ShiftController.getShiftCashMovements);
router.post('/close', authenticate, ShiftController.closeShift);
router.post('/:id/close', authenticate, ShiftController.closeShift);

export default router;

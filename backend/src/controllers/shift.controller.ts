import { Request, Response } from 'express';
import { z } from 'zod';
import { ShiftService } from '../services/shift.service';

const openShiftSchema = z.object({
  startingCash: z.number().nonnegative('عهدة بداية الوردية يجب أن تكون صفر أو أكثر'),
});

const closeShiftSchema = z.object({
  shiftId: z.string().optional(),
  actualEndCash: z.number().nonnegative('النقدية الفعلية في الدرج يجب أن تكون صفر أو أكثر'),
});

const cashMovementSchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: z.number().positive('المبلغ يجب أن يكون أكبر من صفر'),
  reason: z.string().min(2, 'سبب حركة النقدية مطلوب'),
  shiftId: z.string().optional(),
});

export class ShiftController {
  static async openShift(req: Request, res: Response): Promise<void> {
    const parsed = openShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات فتح الوردية غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const shift = await ShiftService.openShift({
        cashierId: req.user!.userId,
        startingCash: parsed.data.startingCash,
      });

      res.status(201).json({
        success: true,
        message: 'تم فتح الوردية بنجاح',
        data: shift,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'ACTIVE_SHIFT_EXISTS') {
        res.status(409).json({
          success: false,
          message: 'يوجد وردية مفتوحة بالفعل لهذا الكاشير',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء فتح الوردية',
      });
    }
  }

  static async getActiveShift(req: Request, res: Response): Promise<void> {
    try {
      const shift = await ShiftService.getActiveShift(req.user!.userId);
      res.status(200).json({
        success: true,
        data: shift,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب بيانات الوردية الحالية',
      });
    }
  }

  static async closeShift(req: Request, res: Response): Promise<void> {
    const parsed = closeShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'يرجى إدخال النقدية الفعلية في الدرج بشكل صحيح',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const shiftId = req.params.id ? String(req.params.id) : parsed.data.shiftId;

    try {
      const zReport = await ShiftService.closeShift({
        shiftId,
        cashierId: req.user!.userId,
        actualEndCash: parsed.data.actualEndCash,
      });

      res.status(200).json({
        success: true,
        message: 'تم إغلاق الوردية وإصدار تقرير Z بنجاح',
        data: zReport,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'SHIFT_NOT_FOUND') {
          res.status(404).json({
            success: false,
            message: 'لا توجد وردية مفتوحة لإغلاقها',
          });
          return;
        }
        if (error.message === 'SHIFT_ALREADY_CLOSED') {
          res.status(409).json({
            success: false,
            message: 'تم إغلاق هذه الوردية مسبقاً',
          });
          return;
        }
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء إغلاق الوردية',
      });
    }
  }

  static async recordCashMovement(req: Request, res: Response): Promise<void> {
    const parsed = cashMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات حركة الصندوق غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const movement = await ShiftService.recordCashMovement({
        cashierId: req.user!.userId,
        shiftId: parsed.data.shiftId,
        type: parsed.data.type,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
      });

      res.status(201).json({
        success: true,
        message:
          parsed.data.type === 'CASH_IN'
            ? `تم تسجيل توريد نقدي للدرج بمبلغ ${parsed.data.amount} ج.م بنجاح`
            : `تم تسجيل سحب مصروفات نقدية من الدرج بمبلغ ${parsed.data.amount} ج.م بنجاح`,
        data: movement,
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'NO_ACTIVE_SHIFT') {
        res.status(400).json({
          success: false,
          message: 'لا توجد وردية مفتوحة لتسجيل حركة نقدية عليها',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تسجيل حركة النقدية',
      });
    }
  }

  static async getShiftCashMovements(req: Request, res: Response): Promise<void> {
    try {
      const shiftId = String(req.params.id);
      const movements = await ShiftService.getShiftCashMovements(shiftId);
      res.status(200).json({
        success: true,
        data: movements,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب حركات النقدية للوردية',
      });
    }
  }
}

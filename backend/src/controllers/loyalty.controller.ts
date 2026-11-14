import { Request, Response } from 'express';
import { z } from 'zod';
import { LoyaltyService } from '../services/loyalty.service';

const updateLoyaltySettingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  spendAmountPerPoint: z.number().positive('قيمة الإنفاق لكل نقطة يجب أن تكون أكبر من صفر').optional(),
  redemptionPointsBlock: z
    .number()
    .int()
    .positive('عدد نقاط شريحة الاستبدال يجب أن يكون رقماً صحيحاً موجباً')
    .optional(),
  redemptionDiscountAmount: z
    .number()
    .positive('قيمة الخصم لشريحة النقاط يجب أن تكون أكبر من صفر')
    .optional(),
  minPointsToRedeem: z
    .number()
    .int()
    .nonnegative('الحد الأدنى للاستبدال يجب أن يكون صفراً أو أكثر')
    .optional(),
  maxDiscountCapPercent: z
    .number()
    .int()
    .min(1, 'الحد الأقصى لنسبة الخصم لا يقل عن 1%')
    .max(100, 'الحد الأقصى لنسبة الخصم لا يتجاوز 100%')
    .optional(),
});

const createCustomerSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().min(6, 'رقم هاتف العميل غير صالح'),
});

const updateCreditLimitSchema = z.object({
  creditLimit: z.number().nonnegative('حد الائتمان يجب أن يكون صفراً أو أكثر'),
});

const settleDebtSchema = z.object({
  amount: z.number().positive('مبلغ السداد يجب أن يكون أكبر من صفر'),
  notes: z.string().optional(),
  shiftId: z.string().optional(),
});

export class LoyaltyController {
  static async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await LoyaltyService.getSettings();
      res.status(200).json({
        success: true,
        data: settings,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب إعدادات نقاط الولاء',
      });
    }
  }

  static async updateSettings(req: Request, res: Response): Promise<void> {
    const parsed = updateLoyaltySettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات إعدادات الولاء غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const updated = await LoyaltyService.updateSettings(parsed.data);
      res.status(200).json({
        success: true,
        message: 'تم حفظ إعدادات نظام نقاط الولاء بنجاح',
        data: updated,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تحديث إعدادات نقاط الولاء',
      });
    }
  }

  static async listCustomers(req: Request, res: Response): Promise<void> {
    try {
      const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
      const customerCode =
        typeof req.query.customerCode === 'string' ? req.query.customerCode : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const customers = await LoyaltyService.listCustomers({
        phone,
        customerCode,
        search,
      });
      res.status(200).json({
        success: true,
        count: customers.length,
        data: customers,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب قائمة العملاء وسجل نقاط الولاء',
      });
    }
  }

  static async createCustomer(req: Request, res: Response): Promise<void> {
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات العميل غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const customer = await LoyaltyService.createOrGetCustomer(parsed.data);
      res.status(201).json({
        success: true,
        message: 'تم تسجيل بيانات العميل بنجاح',
        data: customer,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تسجيل العميل',
      });
    }
  }

  static async updateCreditLimit(req: Request, res: Response): Promise<void> {
    const parsed = updateCreditLimitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات حد الائتمان غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const customer = await LoyaltyService.updateCustomerCreditLimit(
        String(req.params.id),
        parsed.data.creditLimit
      );
      res.status(200).json({
        success: true,
        message: 'تم تحديث الحد الائتماني للعميل بنجاح',
        data: customer,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تحديث الحد الائتماني',
      });
    }
  }

  static async settleDebt(req: Request, res: Response): Promise<void> {
    const parsed = settleDebtSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات سداد الحساب الآجل غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const result = await LoyaltyService.settleCustomerDebt({
        customerId: String(req.params.id),
        amount: parsed.data.amount,
        notes: parsed.data.notes,
        cashierId: req.user?.userId,
        shiftId: parsed.data.shiftId,
      });

      res.status(200).json({
        success: true,
        message: `تم سداد مبلغ ${parsed.data.amount} ج.م من حساب العميل بنجاح`,
        data: result,
      });
    } catch (error: any) {
      if (error instanceof Error) {
        if (error.message === 'CUSTOMER_NOT_FOUND') {
          res.status(404).json({ success: false, message: 'العميل غير موجود' });
          return;
        }
        if (error.message === 'NO_OUTSTANDING_DEBT') {
          res.status(400).json({ success: false, message: 'لا يوجد رصيد آجل مستحق على هذا العميل' });
          return;
        }
        if (error.message.startsWith('SETTLEMENT_EXCEEDS_DEBT:')) {
          const debt = error.message.split(':')[1];
          res.status(400).json({
            success: false,
            message: `مبلغ السداد يتجاوز إجمالي الدين المستحق (${debt} ج.م)`,
          });
          return;
        }
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تسجيل سداد الحساب الآجل',
      });
    }
  }

  static async getCustomerStatement(req: Request, res: Response): Promise<void> {
    try {
      const statement = await LoyaltyService.getCustomerStatement(String(req.params.id));
      res.status(200).json({
        success: true,
        data: statement,
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
        res.status(404).json({ success: false, message: 'العميل غير موجود' });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'تعذر جلب كشف حساب العميل',
      });
    }
  }
}

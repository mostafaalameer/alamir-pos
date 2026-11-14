import { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod, Role } from '@prisma/client';
import { OrderService } from '../services/order.service';

const createOrderSchema = z.object({
  shiftId: z.string().min(1).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
  orderNumber: z.string().optional(),
  customerId: z.string().min(1).optional(),
  customerCode: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  customerPhone: z.string().min(3).optional(),
  customerName: z.string().optional().nullable(),
  redeemPoints: z.union([z.boolean(), z.number().int().nonnegative()]).optional(),
  paidAmount: z.number().nonnegative().optional(),
  changeGiven: z.number().nonnegative().optional(),
  changeDepositedToWallet: z.number().nonnegative().optional(),
  walletAmountUsed: z.number().nonnegative().optional(),
  useWallet: z.boolean().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'معرف الصنف مطلوب'),
        quantity: z.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
      })
    )
    .min(1, 'يجب أن تحتوي الفاتورة على صنف واحد على الأقل'),
});

const returnOrderSchema = z.object({
  refundMethod: z.enum(['CASH', 'WALLET']).optional(),
  refundAmount: z.number().nonnegative().optional(),
  returnedItems: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .optional(),
});

export class OrderController {
  static async createOrder(req: Request, res: Response): Promise<void> {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات الفاتورة غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const role = req.user?.role ?? Role.CASHIER;
      const order = await OrderService.createOrderFIFO(
        {
          shiftId: parsed.data.shiftId,
          cashierId: req.user!.userId,
          paymentMethod: parsed.data.paymentMethod,
          orderNumber: parsed.data.orderNumber,
          customerId: parsed.data.customerId,
          customerCode: parsed.data.customerCode,
          customerPhone: parsed.data.customerPhone,
          customerName: parsed.data.customerName,
          redeemPoints: parsed.data.redeemPoints,
          paidAmount: parsed.data.paidAmount,
          changeGiven: parsed.data.changeGiven,
          changeDepositedToWallet: parsed.data.changeDepositedToWallet,
          walletAmountUsed: parsed.data.walletAmountUsed,
          useWallet: parsed.data.useWallet,
          items: parsed.data.items,
        },
        role
      );

      res.status(201).json({
        success: true,
        message: 'تم إصدار الفاتورة وخصم المخزون بنظام الأقدم صلاحية (FIFO) بنجاح',
        data: order,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'SHIFT_CLOSED_OR_INVALID') {
          res.status(400).json({
            success: false,
            message: 'لا يمكن إصدار فاتورة بدون وردية مفتوحة',
          });
          return;
        }
        if (error.message === 'CUSTOMER_NOT_FOUND') {
          res.status(404).json({
            success: false,
            message: 'بيانات العميل غير موجودة',
          });
          return;
        }
        if (error.message === 'CUSTOMER_REQUIRED_FOR_CREDIT') {
          res.status(400).json({
            success: false,
            message: 'يجب تحديد حساب العميل أولاً لإتمام البيع بالآجل (الشكك)',
          });
          return;
        }
        if (error.message === 'NO_CREDIT_FACILITY') {
          res.status(400).json({
            success: false,
            message: 'هذا العميل غير مفعّل له حد ائتمان للبيع بالآجل',
          });
          return;
        }
        if (error.message.startsWith('CREDIT_LIMIT_EXCEEDED:')) {
          const available = error.message.split(':')[1];
          res.status(409).json({
            success: false,
            message: `تجاوز الحد الائتماني للعميل. الرصيد المتبقي المتاح: ${available} ج.م`,
          });
          return;
        }
        if (error.message === 'INSUFFICIENT_LOYALTY_POINTS') {
          res.status(409).json({
            success: false,
            message: 'رصيد نقاط العميل غير كافٍ للاستبدال',
          });
          return;
        }
        if (error.message === 'INSUFFICIENT_WALLET_BALANCE') {
          res.status(409).json({
            success: false,
            message: 'رصيد محفظة الفكة للعميل غير كافٍ لإتمام الخصم',
          });
          return;
        }
        if (error.message.startsWith('PRODUCT_NOT_FOUND:')) {
          res.status(404).json({
            success: false,
            message: 'أحد الأصناف غير موجود في النظام',
          });
          return;
        }
        if (error.message.startsWith('INSUFFICIENT_STOCK:')) {
          const productName = error.message.split(':')[1];
          res.status(409).json({
            success: false,
            message: `الكمية المتاحة في المخزون غير كافية للصنف: ${productName}`,
          });
          return;
        }
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء إصدار الفاتورة',
      });
    }
  }

  static async returnOrder(req: Request, res: Response): Promise<void> {
    try {
      const parsed = returnOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: 'بيانات الاسترجاع غير صحيحة',
          errors: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      const role = req.user?.role ?? Role.CASHIER;
      const order = await OrderService.returnOrder(
        String(req.params.id),
        role,
        req.user?.userId,
        {
          refundMethod: parsed.data.refundMethod,
          refundAmount: parsed.data.refundAmount,
          returnedItems: parsed.data.returnedItems,
        }
      );
      res.status(200).json({
        success: true,
        message: 'تم إرجاع الفاتورة وإعادة الكميات للمخزون بنجاح',
        data: order,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'ORDER_NOT_FOUND') {
          res.status(404).json({
            success: false,
            message: 'الفاتورة غير موجودة',
          });
          return;
        }
        if (error.message === 'ORDER_ALREADY_RETURNED') {
          res.status(409).json({
            success: false,
            message: 'تم استرجاع هذه الفاتورة مسبقاً',
          });
          return;
        }
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء استرجاع الفاتورة',
      });
    }
  }

  static async getOrderByNumber(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.CASHIER;
      const order = await OrderService.getOrderByNumber(
        String(req.params.orderNumber),
        role
      );
      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الفاتورة غير موجودة بهذا الرقم',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء البحث عن الفاتورة',
      });
    }
  }

  static async listOrders(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.ADMIN;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const paymentMethod =
        typeof req.query.paymentMethod === 'string' ? req.query.paymentMethod : undefined;
      const returnedParam =
        typeof req.query.isReturned === 'string' ? req.query.isReturned : undefined;
      const isReturned =
        returnedParam === 'true' ? true : returnedParam === 'false' ? false : undefined;
      const limit =
        typeof req.query.limit === 'string' && !Number.isNaN(Number(req.query.limit))
          ? Number(req.query.limit)
          : 150;

      const orders = await OrderService.listOrders(role, {
        search,
        paymentMethod,
        isReturned,
        limit,
      });

      res.status(200).json({
        success: true,
        count: orders.length,
        data: orders,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب قائمة الفواتير من قاعدة البيانات',
      });
    }
  }

  /**
   * GET /api/orders/next-number
   * Returns the next sequential invoice number (e.g. ALM-000001).
   */
  static async getNextOrderNumber(_req: Request, res: Response): Promise<void> {
    try {
      const orderNumber = await OrderService.getNextOrderNumber();
      res.status(200).json({
        success: true,
        data: { orderNumber },
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر توليد رقم الفاتورة التسلسلي التالي',
      });
    }
  }
}

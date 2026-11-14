import { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod, Role } from '@prisma/client';
import { SyncService } from '../services/sync.service';
import { ThermalPrinterService } from '../services/printer.service';
import { ErrorMonitorService } from '../middlewares/errorMonitor.middleware';

const pushSyncSchema = z.object({
  idempotencyKey: z.string().min(4).optional(),
  orders: z
    .array(
      z.object({
        clientOrderId: z.string().optional(),
        idempotencyKey: z.string().optional(),
        orderNumber: z.string().min(3),
        shiftId: z.string().min(1),
        paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
        customerCode: z.number().int().positive().optional(),
        customerPhone: z.string().optional(),
        customerName: z.string().optional().nullable(),
        pointsEarned: z.number().int().nonnegative().optional(),
        pointsRedeemed: z.number().int().nonnegative().optional(),
        discountFromPoints: z.number().nonnegative().optional(),
        paidAmount: z.number().nonnegative().optional(),
        changeGiven: z.number().nonnegative().optional(),
        changeDepositedToWallet: z.number().nonnegative().optional(),
        walletAmountUsed: z.number().nonnegative().optional(),
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z.number().int().positive(),
              unitPrice: z.number().positive().optional(),
            })
          )
          .min(1),
        createdAt: z.string().optional(),
      })
    )
    .default([]),
  closedShifts: z
    .array(
      z.object({
        shiftId: z.string().min(1),
        actualEndCash: z.number().nonnegative(),
        closedAt: z.string().optional(),
      })
    )
    .default([]),
  customers: z
    .array(
      z.object({
        name: z.string().optional().nullable(),
        phone: z.string().min(4),
        customerCode: z.number().int().positive().optional(),
      })
    )
    .default([]),
});

const telemetrySchema = z.object({
  source: z.enum(['FRONTEND_POS', 'SYNC_ENGINE', 'BACKEND']).default('FRONTEND_POS'),
  severity: z.enum(['ERROR', 'WARN', 'INFO']).default('ERROR'),
  message: z.string().min(1),
  code: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const printReceiptSchema = z.object({
  orderNumber: z.string().min(1),
  cashierName: z.string().default('كاشير الأمير'),
  paymentMethod: z.string().default('CASH'),
  createdAt: z.string().optional(),
  paperWidth: z.enum(['80mm', '58mm']).default('80mm'),
  openCashDrawer: z.boolean().default(true),
  totalAmount: z.number().nonnegative(),
  paidAmount: z.number().nonnegative().optional(),
  changeGiven: z.number().nonnegative().default(0),
  changeDepositedToWallet: z.number().nonnegative().optional(),
  walletAmountUsed: z.number().nonnegative().optional(),
  customerCode: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  customerName: z.string().optional().nullable(),
  customerPhone: z.string().optional(),
  pointsEarned: z.number().int().nonnegative().optional(),
  pointsRedeemed: z.number().int().nonnegative().optional(),
  discountFromPoints: z.number().nonnegative().optional(),
  customerPointsBalance: z.number().int().optional(),
  customerWalletBalance: z.number().nonnegative().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      lineTotal: z.number().nonnegative(),
    })
  ),
});

const printZReportSchema = z.object({
  shiftId: z.string().min(1),
  cashierName: z.string().default('كاشير الأمير'),
  openedAt: z.string().optional(),
  closedAt: z.string().optional(),
  paperWidth: z.enum(['80mm', '58mm']).default('80mm'),
  startingCash: z.number().nonnegative(),
  totalCashSales: z.number().nonnegative(),
  totalCardSales: z.number().nonnegative(),
  totalReturns: z.number().nonnegative().default(0),
  totalChangeCreditedToWallets: z.number().nonnegative().optional(),
  totalWalletRedemptions: z.number().nonnegative().optional(),
  expectedCash: z.number(),
  actualEndCash: z.number().nonnegative(),
  discrepancy: z.number(),
});

const printReturnReceiptSchema = z.object({
  returnNumber: z.string().min(1),
  originalOrderNumber: z.string().min(1),
  cashierName: z.string().default('كاشير الأمير'),
  refundMethod: z.enum(['CASH', 'WALLET']).default('CASH'),
  refundAmount: z.number().nonnegative(),
  createdAt: z.string().optional(),
  paperWidth: z.enum(['80mm', '58mm']).default('80mm'),
  customerCode: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  customerName: z.string().optional().nullable(),
  customerPhone: z.string().optional(),
  customerWalletBalance: z.number().nonnegative().optional(),
  returnedItems: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      lineTotal: z.number().nonnegative(),
    })
  ),
});

export class SyncAndPrinterController {
  static async pullCatalog(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.CASHIER;
      const updatedSince =
        typeof req.query.updatedSince === 'string'
          ? req.query.updatedSince
          : undefined;
      const snapshot = await SyncService.pullCatalogSnapshot(role, updatedSince);
      res.status(200).json({
        success: true,
        data: snapshot,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر مزامنة كتالوج الأصناف المحلي',
      });
    }
  }

  static async pushOfflineOrders(req: Request, res: Response): Promise<void> {
    const parsed = pushSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات مزامنة الفواتير والورديات غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const role = req.user?.role ?? Role.CASHIER;
      const headerIdempotencyKey = req.header('X-Idempotency-Key') || undefined;
      const effectiveBatchKey = parsed.data.idempotencyKey || headerIdempotencyKey;

      const result = await SyncService.pushOfflineBatch(
        req.user!.userId,
        role,
        parsed.data.orders,
        parsed.data.closedShifts,
        parsed.data.customers,
        effectiveBatchKey
      );

      res.status(200).json({
        success: true,
        message: 'تمت مزامنة الفواتير والورديات المحلية بنجاح',
        data: result,
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : 'خطأ أثناء مزامنة الفواتير';
      ErrorMonitorService.capture({
        source: 'SYNC_ENGINE',
        severity: 'ERROR',
        message: errMsg,
        path: req.originalUrl,
        method: req.method,
        userId: req.user?.userId,
        metadata: {
          ordersCount: parsed.data.orders.length,
          shiftsCount: parsed.data.closedShifts.length,
        },
      });

      const isDbUnreachable =
        errMsg.includes("Can't reach database server") ||
        errMsg.includes('connection refused') ||
        errMsg.includes('P1001');

      res.status(409).json({
        success: false,
        message: isDbUnreachable
          ? 'تعذر الاتصال بقاعدة البيانات السحابية (PostgreSQL). يرجى التأكد من تشغيل السيرفر وصحة رابط DATABASE_URL في ملف backend/.env'
          : `تعذر إتمام المزامنة: ${errMsg}`,
      });
    }
  }

  static async formatThermalReceipt(req: Request, res: Response): Promise<void> {
    const parsed = printReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات طباعة الإيصال غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const receipt = ThermalPrinterService.generateEscPosReceipt({
      ...parsed.data,
      createdAt: parsed.data.createdAt || new Date().toISOString(),
    });

    const physicalResult = await ThermalPrinterService.printToPhysicalThermalPrinter({
      printableText: receipt.structuredLayoutText || receipt.printableText,
      paperWidth: parsed.data.paperWidth,
      cutPaper: true,
      openCashDrawer: parsed.data.openCashDrawer,
    });

    res.status(200).json({
      success: true,
      data: {
        ...receipt,
        printedPhysically: physicalResult.printed,
        printerName: physicalResult.printerName,
        bytesSent: physicalResult.bytesSent,
        printError: physicalResult.error,
      },
    });
  }

  static async formatZReport(req: Request, res: Response): Promise<void> {
    const parsed = printZReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات طباعة تقرير الوردية (Z-Report) غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const zReport = ThermalPrinterService.generateZReportEscPos({
      ...parsed.data,
      openedAt: parsed.data.openedAt || new Date().toISOString(),
      closedAt: parsed.data.closedAt || new Date().toISOString(),
    });

    const physicalResult = await ThermalPrinterService.printToPhysicalThermalPrinter({
      printableText: zReport.printableText,
      paperWidth: parsed.data.paperWidth,
      cutPaper: true,
      openCashDrawer: false,
    });

    res.status(200).json({
      success: true,
      data: {
        ...zReport,
        printedPhysically: physicalResult.printed,
        printerName: physicalResult.printerName,
        bytesSent: physicalResult.bytesSent,
        printError: physicalResult.error,
      },
    });
  }

  static async formatReturnReceipt(req: Request, res: Response): Promise<void> {
    const parsed = printReturnReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات طباعة إيصال المرتجع غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const returnReceipt = ThermalPrinterService.generateReturnReceipt({
      ...parsed.data,
      createdAt: parsed.data.createdAt || new Date().toISOString(),
    });

    const physicalResult = await ThermalPrinterService.printToPhysicalThermalPrinter({
      printableText: returnReceipt.printableText,
      paperWidth: parsed.data.paperWidth,
      cutPaper: true,
      openCashDrawer: parsed.data.refundMethod === 'CASH',
    });

    res.status(200).json({
      success: true,
      data: {
        ...returnReceipt,
        printedPhysically: physicalResult.printed,
        printerName: physicalResult.printerName,
        bytesSent: physicalResult.bytesSent,
        printError: physicalResult.error,
      },
    });
  }

  static async kickCashDrawer(_req: Request, res: Response): Promise<void> {
    const payload = ThermalPrinterService.generateCashDrawerKickPayload();
    const physicalResult = await ThermalPrinterService.printToPhysicalThermalPrinter({
      printableText: '',
      cutPaper: false,
      openCashDrawer: true,
    });
    res.status(200).json({
      success: true,
      message: 'تم إرسال إشارة فتح درج النقدية (RJ11)',
      data: {
        ...payload,
        printedPhysically: physicalResult.printed,
        printerName: physicalResult.printerName,
      },
    });
  }

  static async testThermalPrinter(req: Request, res: Response): Promise<void> {
    const paperWidth = req.body?.paperWidth === '58mm' ? '58mm' : '80mm';
    const cashierName =
      typeof req.body?.cashierName === 'string' && req.body.cashierName.trim()
        ? req.body.cashierName.trim()
        : 'كاشير الأمير';

    const testReceipt = ThermalPrinterService.generateEscPosReceipt({
      orderNumber: `TEST-${Date.now().toString().slice(-6)}`,
      cashierName,
      paymentMethod: 'CASH',
      createdAt: new Date().toLocaleString('ar-EG'),
      paperWidth,
      openCashDrawer: false,
      totalAmount: 125.0,
      paidAmount: 150.0,
      changeGiven: 25.0,
      items: [
        {
          name: 'بن تركي محوج مخصوص 250 جرام (اختبار طباعة)',
          quantity: 1,
          unitPrice: 75.0,
          lineTotal: 75.0,
        },
        {
          name: 'مكسرات مشكلة سوبر 200 جرام (اختبار طباعة)',
          quantity: 1,
          unitPrice: 50.0,
          lineTotal: 50.0,
        },
      ],
    });

    const physicalResult = await ThermalPrinterService.printToPhysicalThermalPrinter({
      printableText: testReceipt.structuredLayoutText || testReceipt.printableText,
      paperWidth,
      cutPaper: true,
      openCashDrawer: false,
    });

    res.status(200).json({
      success: true,
      message: physicalResult.printed
        ? `تمت الطباعة التجريبية بنجاح على الطابعة (${physicalResult.printerName})`
        : 'تم تجهيز بيانات الطباعة التجريبية ولكن تعذر الوصول للطابعة الحرارية',
      data: {
        ...testReceipt,
        printedPhysically: physicalResult.printed,
        printerName: physicalResult.printerName,
        bytesSent: physicalResult.bytesSent,
        printError: physicalResult.error,
      },
    });
  }

  static async exportBackup(req: Request, res: Response): Promise<void> {
    try {
      const persist = req.query.persist !== 'false';
      const snapshot = await SyncService.generateCloudBackupSnapshot(persist);
      res.status(200).json({
        success: true,
        message: 'تم إنشاء نسخة احتياطية كاملة لقاعدة البيانات بنجاح',
        data: snapshot,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية';
      ErrorMonitorService.capture({
        source: 'BACKEND',
        severity: 'ERROR',
        message: msg,
        path: req.originalUrl,
        method: req.method,
        userId: req.user?.userId,
      });
      res.status(500).json({
        success: false,
        message: 'تعذر إنشاء النسخة الاحتياطية لقاعدة البيانات',
      });
    }
  }

  static async recordTelemetry(req: Request, res: Response): Promise<void> {
    const parsed = telemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات سجل الأخطاء غير صالحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const entry = ErrorMonitorService.capture({
      ...parsed.data,
      path: req.originalUrl,
      method: req.method,
      userId: req.user?.userId,
    });

    res.status(201).json({
      success: true,
      data: entry,
    });
  }

  static async listTelemetry(_req: Request, res: Response): Promise<void> {
    const events = ErrorMonitorService.getRecentEvents(50);
    res.status(200).json({
      success: true,
      data: events,
    });
  }
}

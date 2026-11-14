import { Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { ProductService } from '../services/product.service';

const createProductSchema = z.object({
  barcode: z.string().min(3, 'الباركود مطلوب'),
  name: z.string().min(2, 'اسم الصنف مطلوب'),
  category: z.string().optional(),
  description: z.string().optional(),
  weightUnit: z.string().optional(),
  retailPrice: z.number().positive('سعر البيع يجب أن يكون أكبر من صفر'),
  isAvailableOnline: z.boolean().optional(),
  imageUrls: z.string().optional(),
  minStockAlert: z.number().int().nonnegative().optional(),
});

const updateProductSchema = createProductSchema.partial();

const updatePriceSchema = z.object({
  retailPrice: z.number().positive('سعر البيع الجديد يجب أن يكون أكبر من صفر'),
});

const addBatchSchema = z.object({
  batchNumber: z.string().min(1, 'رقم التشغيلة مطلوب'),
  costPrice: z.number().positive('سعر التكلفة يجب أن يكون أكبر من صفر'),
  quantity: z.number().int().positive('الكمية يجب أن تكون أكبر من صفر'),
  expiryDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: 'تاريخ الصلاحية غير صالح',
  }),
});

const adjustStockSchema = z.object({
  mode: z.enum(['ADD_BATCH', 'RECONCILE']).default('RECONCILE'),
  batchNumber: z.string().optional(),
  costPrice: z.number().positive().optional(),
  quantity: z.number().int().positive().optional(),
  expiryDate: z.string().optional(),
  quantityToDeduct: z.number().int().positive().optional(),
  reason: z.string().optional(),
  batchId: z.string().optional(),
  notes: z.string().optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'يرجى تحديد صنف واحد على الأقل للحذف'),
});

export class ProductController {
  static async createProduct(req: Request, res: Response): Promise<void> {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات الصنف غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const product = await ProductService.createProduct(parsed.data);
      res.status(201).json({
        success: true,
        message: 'تم إضافة الصنف بنجاح',
        data: product,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'BARCODE_EXISTS') {
        res.status(409).json({
          success: false,
          message: 'الباركود مسجل لصنف آخر بالفعل',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء إضافة الصنف',
      });
    }
  }

  static async updateProduct(req: Request, res: Response): Promise<void> {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات التعديل غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const product = await ProductService.updateProduct(String(req.params.id), parsed.data);
      res.status(200).json({
        success: true,
        message: 'تم تحديث بيانات الصنف بنجاح',
        data: product,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الصنف غير موجود',
        });
        return;
      }
      if (error instanceof Error && error.message === 'BARCODE_EXISTS') {
        res.status(409).json({
          success: false,
          message: 'الباركود مسجل لصنف آخر بالفعل',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تحديث الصنف',
      });
    }
  }

  static async updatePrice(req: Request, res: Response): Promise<void> {
    const parsed = updatePriceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'سعر البيع غير صالح',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const product = await ProductService.updateProductPrice(
        String(req.params.id),
        parsed.data.retailPrice
      );
      res.status(200).json({
        success: true,
        message: 'تم تحديث سعر البيع بنجاح',
        data: product,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الصنف غير موجود',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تحديث سعر البيع',
      });
    }
  }

  static async addBatch(req: Request, res: Response): Promise<void> {
    const parsed = addBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات الدفعة / التشغيلة غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const batch = await ProductService.addBatch(String(req.params.id), parsed.data);
      res.status(201).json({
        success: true,
        message: 'تم إضافة دفعة المخزون بنجاح',
        data: batch,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الصنف غير موجود',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء إضافة الدفعة',
      });
    }
  }

  static async adjustStock(req: Request, res: Response): Promise<void> {
    const parsed = adjustStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'بيانات ضبط المخزون غير صحيحة',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const result = await ProductService.adjustProductStock(
        String(req.params.id),
        parsed.data
      );
      res.status(200).json({
        success: true,
        message:
          result.mode === 'ADD_BATCH'
            ? 'تمت إضافة شحنة المخزون بنجاح'
            : 'تمت تسوية الرصيد وتحديث المخزون بنجاح',
        data: result,
      });
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === 'PRODUCT_NOT_FOUND' || error.message === 'BATCH_NOT_FOUND') {
          res.status(404).json({
            success: false,
            message: 'الصنف أو التشغيلة غير موجودة',
          });
          return;
        }
        if (error.message.startsWith('INSUFFICIENT_STOCK')) {
          res.status(409).json({
            success: false,
            message: 'الكمية المراد خصمها أكبر من الرصيد المتاح',
          });
          return;
        }
        if (
          error.message === 'INVALID_QUANTITY' ||
          error.message === 'INVALID_BATCH_INPUT'
        ) {
          res.status(400).json({
            success: false,
            message: 'يرجى التحقق من الكمية وبيانات التسوية',
          });
          return;
        }
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء تعديل رصيد المخزون',
      });
    }
  }

  static async downloadBulkTemplate(_req: Request, res: Response): Promise<void> {
    try {
      const buffer = await ProductService.generateBulkTemplateBuffer();
      const fileName = `alamir-products-template-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.status(200).send(buffer);
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر توليد قالب استيراد الأصناف',
      });
    }
  }

  static async bulkImport(req: Request, res: Response): Promise<void> {
    try {
      const dryRun =
        req.query.dryRun === 'true' ||
        req.body?.dryRun === true ||
        req.body?.dryRun === 'true';

      const uploadedFile = (req as Request & { file?: { buffer: Buffer; originalname: string } })
        .file;

      let rawRows: any[] = [];
      if (uploadedFile && uploadedFile.buffer) {
        rawRows = await ProductService.parseBulkImportFile(
          uploadedFile.buffer,
          uploadedFile.originalname
        );
      } else if (Array.isArray(req.body?.rows)) {
        rawRows = req.body.rows;
      } else {
        res.status(400).json({
          success: false,
          message: 'يرجى رفع ملف إكسيل (.xlsx أو .csv) أو إرسال مصفوفة الأصناف',
        });
        return;
      }

      if (rawRows.length === 0) {
        res.status(400).json({
          success: false,
          message: 'الملف المرفوع فارغ أو لا يحتوي على صفوف صالحة',
        });
        return;
      }

      const summary = await ProductService.bulkImportProducts(rawRows, dryRun);
      res.status(200).json({
        success: true,
        message: dryRun
          ? `تم فحص الملف: ${summary.validCount} صف صالح، ${summary.invalidCount} صف به أخطاء`
          : `تم استيراد ${summary.createdCount} صنف جديد وتحديث ${summary.updatedCount} صنف بنجاح`,
        data: summary,
      });
    } catch (error: unknown) {
      res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? `تعذر معالجة ملف الإكسيل: ${error.message}`
            : 'حدث خطأ أثناء استيراد ملف الإكسيل',
      });
    }
  }

  static async searchProducts(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.CASHIER;
      const barcode =
        typeof req.query.barcode === 'string' ? req.query.barcode : undefined;
      const q =
        typeof req.query.q === 'string'
          ? req.query.q
          : typeof req.query.search === 'string'
          ? req.query.search
          : undefined;

      const results = await ProductService.searchProducts({ barcode, q }, role);
      res.status(200).json({
        success: true,
        count: results.length,
        data: results,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء البحث عن الأصناف',
      });
    }
  }

  static async getByBarcode(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.CASHIER;
      const product = await ProductService.getProductByBarcode(
        String(req.params.barcode),
        role
      );
      res.status(200).json({
        success: true,
        data: product,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الصنف غير موجود بهذا الباركود',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء البحث بالباركود',
      });
    }
  }

  static async listProducts(req: Request, res: Response): Promise<void> {
    try {
      const role = req.user?.role ?? Role.CASHIER;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const products = await ProductService.listProducts(role, search);
      res.status(200).json({
        success: true,
        data: products,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب قائمة الأصناف',
      });
    }
  }

  static async getExpiryAlerts(req: Request, res: Response): Promise<void> {
    const rawDays = Number(req.query.days) || 30;
    const allowedDays = rawDays > 0 ? rawDays : 30;

    try {
      const alerts = await ProductService.getExpiringBatches(allowedDays);
      res.status(200).json({
        success: true,
        windowDays: allowedDays,
        count: alerts.length,
        data: alerts,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب تنبيهات الصلاحية',
      });
    }
  }

  static async getOnlineCatalog(_req: Request, res: Response): Promise<void> {
    try {
      const catalog = await ProductService.getOnlineCatalog();
      res.status(200).json({
        success: true,
        currency: 'ج.م',
        data: catalog,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'تعذر جلب كتالوج الأونلاين',
      });
    }
  }

  static async deleteProduct(req: Request, res: Response): Promise<void> {
    try {
      const deleted = await ProductService.deleteProduct(String(req.params.id));
      res.status(200).json({
        success: true,
        message: `تم حذف الصنف "${deleted.name}" نهائياً من قاعدة البيانات`,
        data: deleted,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') {
        res.status(404).json({
          success: false,
          message: 'الصنف غير موجود في قاعدة البيانات',
        });
        return;
      }
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء حذف الصنف من قاعدة البيانات',
      });
    }
  }

  static async bulkDeleteProducts(req: Request, res: Response): Promise<void> {
    const rawIds = Array.isArray(req.body?.ids)
      ? req.body.ids
      : Array.isArray(req.body?.productIds)
      ? req.body.productIds
      : undefined;
    const parsed = bulkDeleteSchema.safeParse({ ids: rawIds });
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: 'يرجى تحديد صنف واحد على الأقل للحذف',
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const result = await ProductService.deleteProductsBulk(parsed.data.ids);
      res.status(200).json({
        success: true,
        message: `تم حذف ${result.deletedCount} صنف نهائياً من قاعدة البيانات`,
        data: result,
      });
    } catch {
      res.status(500).json({
        success: false,
        message: 'حدث خطأ أثناء حذف الأصناف المحددة من قاعدة البيانات',
      });
    }
  }
}

import ExcelJS from 'exceljs';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/db';

export interface CreateProductInput {
  barcode: string;
  name: string;
  category?: string;
  description?: string;
  weightUnit?: string;
  retailPrice: number;
  isAvailableOnline?: boolean;
  imageUrls?: string;
  minStockAlert?: number;
}

export interface UpdateProductInput {
  barcode?: string;
  name?: string;
  category?: string;
  description?: string;
  weightUnit?: string;
  retailPrice?: number;
  isAvailableOnline?: boolean;
  imageUrls?: string;
  minStockAlert?: number;
}

export interface AddBatchInput {
  batchNumber: string;
  costPrice: number;
  quantity: number;
  expiryDate: string | Date;
}

export interface StockAdjustmentInput {
  mode: 'ADD_BATCH' | 'RECONCILE';
  // For ADD_BATCH:
  batchNumber?: string;
  costPrice?: number;
  quantity?: number;
  expiryDate?: string | Date;
  // For RECONCILE (تسوية جرد / عجز وتلف):
  quantityToDeduct?: number;
  reason?: string;
  batchId?: string;
  notes?: string;
}

export interface BulkImportRowInput {
  rowNumber?: number;
  barcode?: string;
  name?: string;
  category?: string;
  weightUnit?: string;
  description?: string;
  retailPrice?: number | string;
  costPrice?: number | string;
  quantity?: number | string;
  expiryDate?: string | Date;
  batchNumber?: string;
  minStockAlert?: number | string;
  isAvailableOnline?: boolean | string | number;
}

export interface BulkValidatedRow {
  rowNumber: number;
  barcode: string;
  name: string;
  category: string;
  weightUnit: string;
  description?: string;
  retailPrice: number;
  costPrice: number;
  quantity: number;
  expiryDate: string;
  batchNumber: string;
  minStockAlert: number;
  isAvailableOnline: boolean;
  action: 'CREATE' | 'UPDATE';
  valid: boolean;
  errors: string[];
}

export interface FifoDeductionAllocation {
  batchId: string;
  batchNumber: string;
  deductedQuantity: number;
  remainingBatchQuantity: number;
  costPrice: Prisma.Decimal;
  expiryDate: Date;
}

export interface FifoDeductionResult {
  productId: string;
  totalDeducted: number;
  remainingTotalStock: number;
  allocations: FifoDeductionAllocation[];
}

export class ProductService {
  private static sanitizeForRole(product: any, role: Role) {
    const batches = product.batches || [];
    const totalStock = batches.reduce((sum: number, b: any) => sum + b.quantity, 0);

    const sanitizedBatches = batches.map((b: any) => {
      if (role === Role.CASHIER) {
        const { costPrice, ...rest } = b;
        return rest;
      }
      return {
        ...b,
        costPrice: Number(b.costPrice),
      };
    });

    return {
      ...product,
      category: product.category ?? 'عام',
      retailPrice: Number(product.retailPrice),
      totalStock,
      isLowStock: totalStock <= product.minStockAlert,
      batches: sanitizedBatches,
    };
  }

  static async createProduct(input: CreateProductInput) {
    const existing = await prisma.product.findUnique({
      where: { barcode: input.barcode },
    });

    if (existing) {
      throw new Error('BARCODE_EXISTS');
    }

    const created = await prisma.$transaction(async (tx) => {
      return tx.product.create({
        data: {
          barcode: input.barcode,
          name: input.name,
          category: input.category?.trim() || 'عام',
          description: input.description,
          weightUnit: input.weightUnit ?? 'قطعة',
          retailPrice: new Prisma.Decimal(input.retailPrice),
          isAvailableOnline: input.isAvailableOnline ?? false,
          imageUrls: input.imageUrls,
          minStockAlert: input.minStockAlert ?? 5,
        },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });
    });

    return this.sanitizeForRole(created, Role.ADMIN);
  }

  static async updateProduct(productId: string, input: UpdateProductInput) {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: productId } });
      if (!existing) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      if (input.barcode !== undefined && input.barcode !== existing.barcode) {
        const duplicate = await tx.product.findUnique({
          where: { barcode: input.barcode },
        });
        if (duplicate) {
          throw new Error('BARCODE_EXISTS');
        }
      }

      return tx.product.update({
        where: { id: productId },
        data: {
          ...(input.barcode !== undefined && { barcode: input.barcode }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.category !== undefined && { category: input.category.trim() || 'عام' }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.weightUnit !== undefined && { weightUnit: input.weightUnit }),
          ...(input.retailPrice !== undefined && {
            retailPrice: new Prisma.Decimal(input.retailPrice),
          }),
          ...(input.isAvailableOnline !== undefined && {
            isAvailableOnline: input.isAvailableOnline,
          }),
          ...(input.imageUrls !== undefined && { imageUrls: input.imageUrls }),
          ...(input.minStockAlert !== undefined && { minStockAlert: input.minStockAlert }),
        },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });
    });

    return this.sanitizeForRole(updated, Role.ADMIN);
  }

  static async updateProductPrice(productId: string, retailPrice: number) {
    return this.updateProduct(productId, { retailPrice });
  }

  static async deleteProduct(productId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: productId } });
      if (!existing) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      if (typeof (tx.orderItem as any)?.deleteMany === 'function') {
        await tx.orderItem.deleteMany({ where: { productId } });
      }
      if (typeof (tx.productBatch as any)?.deleteMany === 'function') {
        await tx.productBatch.deleteMany({ where: { productId } });
      }
      await tx.product.delete({ where: { id: productId } });

      return {
        deletedId: productId,
        barcode: existing.barcode,
        name: existing.name,
      };
    });
  }

  static async deleteProductsBulk(productIds: string[]) {
    const cleanIds = Array.from(
      new Set((productIds || []).map((id) => String(id).trim()).filter(Boolean))
    );
    if (cleanIds.length === 0) {
      throw new Error('NO_PRODUCTS_SELECTED');
    }

    return prisma.$transaction(async (tx) => {
      if (typeof (tx.orderItem as any)?.deleteMany === 'function') {
        await tx.orderItem.deleteMany({ where: { productId: { in: cleanIds } } });
      }
      if (typeof (tx.productBatch as any)?.deleteMany === 'function') {
        await tx.productBatch.deleteMany({ where: { productId: { in: cleanIds } } });
      }
      const deleted =
        typeof (tx.product as any)?.deleteMany === 'function'
          ? await tx.product.deleteMany({ where: { id: { in: cleanIds } } })
          : { count: cleanIds.length };

      return {
        deletedCount: deleted.count ?? cleanIds.length,
        deletedIds: cleanIds,
      };
    });
  }

  /**
   * Smart Multi-Expiry Batch Engine:
   * - If the incoming stock has the EXACT same expiryDate (YYYY-MM-DD) AND costPrice as an existing batch,
   *   it merges (increments) the quantity into that batch to avoid duplicate batch rows.
   * - If the incoming stock has a DIFFERENT expiryDate (or different costPrice),
   *   it creates a new independent ProductBatch record so FIFO/FEFO sells the oldest expiry date first!
   */
  private static async upsertOrAppendBatchInTx(
    tx: Prisma.TransactionClient,
    productId: string,
    input: AddBatchInput
  ) {
    const incomingDateObj = new Date(input.expiryDate);
    const incomingDateKey = incomingDateObj.toISOString().slice(0, 10);
    const incomingCost = Number(Number(input.costPrice).toFixed(2));

    if (
      typeof (tx.productBatch as any).findMany === 'function' &&
      typeof (tx.productBatch as any).update === 'function'
    ) {
      const existingBatches = await tx.productBatch.findMany({
        where: { productId },
      });

      if (Array.isArray(existingBatches)) {
        const matchingBatch = existingBatches.find((b: any) => {
          const bDateKey = new Date(b.expiryDate).toISOString().slice(0, 10);
          const bCost = Number(Number(b.costPrice).toFixed(2));
          return bDateKey === incomingDateKey && bCost === incomingCost;
        });

        if (matchingBatch) {
          const merged = await tx.productBatch.update({
            where: { id: matchingBatch.id },
            data: {
              quantity: matchingBatch.quantity + input.quantity,
            },
          });
          return (
            merged ?? {
              ...matchingBatch,
              quantity: matchingBatch.quantity + input.quantity,
            }
          );
        }
      }
    }

    return tx.productBatch.create({
      data: {
        productId,
        batchNumber: input.batchNumber,
        costPrice: new Prisma.Decimal(input.costPrice),
        quantity: input.quantity,
        expiryDate: incomingDateObj,
      },
    });
  }

  static async addBatch(productId: string, input: AddBatchInput) {
    const batch = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      return this.upsertOrAppendBatchInTx(tx, productId, input);
    });

    return {
      ...batch,
      costPrice: Number(batch.costPrice),
    };
  }

  /**
   * Direct Stock Adjustment (تعديل الرصيد / ضبط المخزون):
   * Supports either:
   * - ADD_BATCH: Appends a new batch with batchNumber, costPrice, quantity, expiryDate (or merges if same expiryDate + costPrice)
   * - RECONCILE: Deducts damaged/expired/audit-discrepancy units (from a specific batchId or FIFO) inside prisma.$transaction
   */
  static async adjustProductStock(productId: string, input: StockAdjustmentInput) {
    if (input.mode === 'ADD_BATCH') {
      if (
        !input.batchNumber ||
        !(Number(input.costPrice) > 0) ||
        !(Number(input.quantity) > 0) ||
        !input.expiryDate
      ) {
        throw new Error('INVALID_BATCH_INPUT');
      }
      const batch = await this.addBatch(productId, {
        batchNumber: input.batchNumber,
        costPrice: Number(input.costPrice),
        quantity: Number(input.quantity),
        expiryDate: input.expiryDate,
      });

      const refreshed = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });

      return {
        mode: 'ADD_BATCH' as const,
        batch,
        product: refreshed ? this.sanitizeForRole(refreshed, Role.ADMIN) : null,
      };
    }

    const quantityToDeduct = Number(input.quantityToDeduct);
    if (!Number.isInteger(quantityToDeduct) || quantityToDeduct <= 0) {
      throw new Error('INVALID_QUANTITY');
    }
    const reason = (input.reason || 'تسوية جرد').trim();

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      if (input.batchId) {
        const targetBatch = await (tx.productBatch as any).findUnique
          ? await tx.productBatch.findUnique({ where: { id: input.batchId } })
          : (
              await tx.productBatch.findMany({
                where: { productId, quantity: { gt: 0 } },
              })
            ).find((b) => b.id === input.batchId);

        if (!targetBatch || targetBatch.productId !== productId) {
          throw new Error('BATCH_NOT_FOUND');
        }
        if (targetBatch.quantity < quantityToDeduct) {
          throw new Error(`INSUFFICIENT_STOCK:${productId}`);
        }
        await tx.productBatch.update({
          where: { id: targetBatch.id },
          data: { quantity: targetBatch.quantity - quantityToDeduct },
        });
      } else {
        await this.deductProductStockFIFO(productId, quantityToDeduct, tx);
      }

      const updatedProduct = await tx.product.findUnique({
        where: { id: productId },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });

      return updatedProduct;
    });

    return {
      mode: 'RECONCILE' as const,
      adjustment: {
        productId,
        batchId: input.batchId,
        quantityDeducted: quantityToDeduct,
        reason,
        notes: input.notes,
        adjustedAt: new Date().toISOString(),
      },
      product: result ? this.sanitizeForRole(result, Role.ADMIN) : null,
    };
  }

  /**
   * Generates an Excel (.xlsx) template pre-populated with all currently registered products
   * so the Admin can update prices/names/categories or add incoming stock quantities without duplicating products.
   */
  static async generateBulkTemplateBuffer(): Promise<Buffer> {
    const existingProducts = await prisma.product.findMany({
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alamir Market POS & ERP';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('كتالوج الأصناف والاستيراد', {
      views: [{ rightToLeft: true }],
    });

    sheet.columns = [
      { header: 'الباركود (Barcode)', key: 'barcode', width: 22 },
      { header: 'اسم الصنف (Name)', key: 'name', width: 34 },
      { header: 'القسم / التصنيف (Category)', key: 'category', width: 22 },
      { header: 'الوحدة (Weight Unit)', key: 'weightUnit', width: 16 },
      { header: 'سعر البيع (Retail Price)', key: 'retailPrice', width: 20 },
      { header: 'سعر الشراء (Cost Price)', key: 'costPrice', width: 20 },
      { header: 'الكمية المضافة (Quantity)', key: 'quantity', width: 22 },
      { header: 'تاريخ الصلاحية (Expiry Date)', key: 'expiryDate', width: 24 },
      { header: 'رقم التشغيلة (Batch Number)', key: 'batchNumber', width: 24 },
      { header: 'حد الطلب (Min Stock)', key: 'minStockAlert', width: 18 },
      { header: 'متاح أونلاين (Online Status)', key: 'isAvailableOnline', width: 22 },
      { header: 'الوصف (Description)', key: 'description', width: 26 },
      { header: 'الرصيد الحالي بالنظام (للعلم فقط)', key: 'currentStock', width: 26 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };

    if (existingProducts.length > 0) {
      for (const p of existingProducts) {
        const fifoBatch = p.batches[0];
        const totalStock = p.batches.reduce((sum, b) => sum + b.quantity, 0);
        const defaultCost = fifoBatch
          ? Number(fifoBatch.costPrice)
          : Number((Number(p.retailPrice) * 0.8).toFixed(2));
        const defaultExpiry = fifoBatch
          ? new Date(fifoBatch.expiryDate).toISOString().slice(0, 10)
          : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        sheet.addRow({
          barcode: p.barcode,
          name: p.name,
          category: (p as any).category || 'عام',
          weightUnit: p.weightUnit || 'قطعة',
          retailPrice: Number(p.retailPrice),
          costPrice: defaultCost,
          // 0 means update product info/price without adding a duplicate batch unless Admin enters > 0
          quantity: 0,
          expiryDate: defaultExpiry,
          batchNumber: fifoBatch?.batchNumber || `B-${new Date().getFullYear()}-01`,
          minStockAlert: p.minStockAlert,
          isAvailableOnline: p.isAvailableOnline ? 'نعم' : 'لا',
          description: p.description || '',
          currentStock: totalStock,
        });
      }
    } else {
      sheet.addRow({
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        category: 'ألبان وأجبان',
        weightUnit: 'لتر',
        retailPrice: 45.0,
        costPrice: 38.0,
        quantity: 20,
        expiryDate: '2027-03-01',
        batchNumber: 'B-2026-101',
        minStockAlert: 10,
        isAvailableOnline: 'نعم',
        description: 'حليب طبيعي كامل الدسم',
        currentStock: 0,
      });
      sheet.addRow({
        barcode: '6221000002',
        name: 'أرز الضحى مصري فاخر 1 كجم',
        category: 'بقالة جافة',
        weightUnit: 'كجم',
        retailPrice: 36.0,
        costPrice: 29.0,
        quantity: 50,
        expiryDate: '2027-06-01',
        batchNumber: 'B-RICE-01',
        minStockAlert: 15,
        isAvailableOnline: 'نعم',
        description: 'أرز مصري درجة أولى',
        currentStock: 0,
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  private static normalizeHeaderKey(header: string): keyof BulkImportRowInput | null {
    const clean = header
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fullLower = header.toLowerCase().trim();

    if (
      clean === 'barcode' ||
      clean === 'الباركود' ||
      clean === 'باركود' ||
      clean === 'كود الصنف' ||
      fullLower.includes('barcode') ||
      fullLower.includes('باركود')
    ) {
      return 'barcode';
    }
    if (
      clean === 'name' ||
      clean === 'product name' ||
      clean === 'اسم الصنف' ||
      clean === 'اسم المنتج' ||
      clean === 'الصنف' ||
      fullLower.includes('اسم الصنف') ||
      fullLower.includes('product name')
    ) {
      return 'name';
    }
    if (
      clean === 'category' ||
      clean === 'القسم' ||
      clean === 'التصنيف' ||
      clean === 'الفئة' ||
      clean === 'القسم / التصنيف' ||
      fullLower.includes('category') ||
      fullLower.includes('القسم') ||
      fullLower.includes('التصنيف')
    ) {
      return 'category';
    }
    if (
      clean === 'weight unit' ||
      clean === 'weightunit' ||
      clean === 'unit' ||
      clean === 'الوحدة' ||
      clean === 'وحدة القياس' ||
      fullLower.includes('weight unit') ||
      fullLower.includes('الوحدة')
    ) {
      return 'weightUnit';
    }
    if (
      clean === 'retail price' ||
      clean === 'retailprice' ||
      clean === 'سعر البيع' ||
      clean === 'السعر' ||
      fullLower.includes('retail price') ||
      fullLower.includes('سعر البيع')
    ) {
      return 'retailPrice';
    }
    if (
      clean === 'cost price' ||
      clean === 'costprice' ||
      clean === 'سعر الشراء' ||
      clean === 'سعر التكلفة' ||
      clean === 'التكلفة' ||
      fullLower.includes('cost price') ||
      fullLower.includes('سعر الشراء') ||
      fullLower.includes('سعر التكلفة')
    ) {
      return 'costPrice';
    }
    if (
      clean === 'quantity' ||
      clean === 'qty' ||
      clean === 'الكمية' ||
      clean === 'الكمية المضافة' ||
      clean === 'العدد' ||
      fullLower.includes('quantity') ||
      fullLower.includes('الكمية')
    ) {
      return 'quantity';
    }
    if (
      clean === 'expiry date' ||
      clean === 'expirydate' ||
      clean === 'تاريخ الصلاحية' ||
      clean === 'تاريخ الانتهاء' ||
      clean === 'الصلاحية' ||
      fullLower.includes('expiry') ||
      fullLower.includes('الصلاحية')
    ) {
      return 'expiryDate';
    }
    if (
      clean === 'batch number' ||
      clean === 'batchnumber' ||
      clean === 'batch' ||
      clean === 'رقم التشغيلة' ||
      clean === 'التشغيلة' ||
      fullLower.includes('batch') ||
      fullLower.includes('التشغيلة')
    ) {
      return 'batchNumber';
    }
    if (
      clean === 'min stock' ||
      clean === 'minstock' ||
      clean === 'minstockalert' ||
      clean === 'حد الطلب' ||
      clean === 'حد الطلب الأدنى' ||
      fullLower.includes('min stock') ||
      fullLower.includes('حد الطلب')
    ) {
      return 'minStockAlert';
    }
    if (
      clean === 'online status' ||
      clean === 'isavailableonline' ||
      clean === 'online' ||
      clean === 'متاح أونلاين' ||
      clean === 'أونلاين' ||
      fullLower.includes('online') ||
      fullLower.includes('أونلاين')
    ) {
      return 'isAvailableOnline';
    }
    if (
      clean === 'description' ||
      clean === 'الوصف' ||
      fullLower.includes('description') ||
      fullLower.includes('الوصف')
    ) {
      return 'description';
    }
    return null;
  }

  private static extractCellValue(val: any): any {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (typeof val === 'object') {
      if ('result' in val && val.result !== undefined) return val.result;
      if ('text' in val && val.text !== undefined) return val.text;
      if ('richText' in val && Array.isArray(val.richText)) {
        return val.richText.map((rt: any) => rt.text).join('');
      }
    }
    return val;
  }

  /**
   * Parses an uploaded .xlsx or .csv file buffer into BulkImportRowInput[] using ExcelJS / CSV parser.
   */
  static async parseBulkImportFile(
    buffer: Buffer,
    originalName = 'import.xlsx'
  ): Promise<BulkImportRowInput[]> {
    const isCsv = originalName.toLowerCase().endsWith('.csv');
    if (isCsv) {
      const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length < 2) return [];

      const splitCsvLine = (line: string): string[] => {
        const res: string[] = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            res.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        res.push(cur.trim());
        return res;
      };

      const headers = splitCsvLine(lines[0]).map((h) => this.normalizeHeaderKey(h));
      const rows: BulkImportRowInput[] = [];
      for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLine(lines[i]);
        const rowObj: BulkImportRowInput = { rowNumber: i + 1 };
        headers.forEach((key, idx) => {
          if (key && values[idx] !== undefined) {
            (rowObj as any)[key] = values[idx];
          }
        });
        rows.push(rowObj);
      }
      return rows;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    const headerMap = new Map<number, keyof BulkImportRowInput>();
    const firstRow = worksheet.getRow(1);
    firstRow.eachCell((cell, colNumber) => {
      const rawHeader = String(this.extractCellValue(cell.value) || '').trim();
      const mapped = this.normalizeHeaderKey(rawHeader);
      if (mapped) {
        headerMap.set(colNumber, mapped);
      }
    });

    const rows: BulkImportRowInput[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowObj: BulkImportRowInput = { rowNumber };
      let hasAnyValue = false;
      headerMap.forEach((key, colNumber) => {
        const val = this.extractCellValue(row.getCell(colNumber).value);
        if (val !== '' && val !== null && val !== undefined) {
          hasAnyValue = true;
        }
        (rowObj as any)[key] = val;
      });
      if (hasAnyValue) {
        rows.push(rowObj);
      }
    });

    return rows;
  }

  private static parseOnlineFlag(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    const str = String(val ?? '')
      .trim()
      .toLowerCase();
    return (
      str === 'true' ||
      str === '1' ||
      str === 'yes' ||
      str === 'y' ||
      str === 'نعم' ||
      str === 'متاح'
    );
  }

  private static parseExcelDate(val: unknown): string | null {
    if (!val && val !== 0) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
      return val.toISOString().slice(0, 10);
    }
    if (typeof val === 'number' && val > 20000 && val < 100000) {
      // Excel serial date number
      const utcDays = Math.floor(val - 25569);
      const d = new Date(utcDays * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    const str = String(val).trim();
    if (!str) return null;
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * Validates and optionally executes bulk import inside a single Prisma transaction.
   * - If barcode exists: updates retailPrice/name/category/minStockAlert/isAvailableOnline and appends/merges ProductBatch (when quantity > 0).
   * - If barcode is new: inserts Product and immediately creates initial ProductBatch (when quantity > 0).
   */
  static async bulkImportProducts(rawRows: BulkImportRowInput[], dryRun = false) {
    const existingProducts = await prisma.product.findMany({
      select: { id: true, barcode: true },
    });
    const existingBarcodes = new Set(existingProducts.map((p) => p.barcode));

    const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const validatedRows: BulkValidatedRow[] = rawRows.map((raw, idx) => {
      const rowNumber = raw.rowNumber ?? idx + 2;
      const errors: string[] = [];

      const barcode = String(raw.barcode ?? '').trim();
      const name = String(raw.name ?? '').trim();
      const category = String(raw.category ?? 'عام').trim() || 'عام';
      const weightUnit = String(raw.weightUnit ?? 'قطعة').trim() || 'قطعة';
      const description = raw.description ? String(raw.description).trim() : undefined;
      const retailPrice = Number(raw.retailPrice);
      const costPrice = Number(raw.costPrice);
      const quantity =
        raw.quantity === '' || raw.quantity === undefined || raw.quantity === null
          ? NaN
          : Number(raw.quantity);
      const parsedExpiry = this.parseExcelDate(raw.expiryDate);
      const batchNumber =
        String(raw.batchNumber ?? '').trim() || `B-${dateTag}-${String(idx + 1).padStart(3, '0')}`;
      const minStockAlert =
        raw.minStockAlert !== undefined && raw.minStockAlert !== ''
          ? Number(raw.minStockAlert)
          : 5;
      const isAvailableOnline = this.parseOnlineFlag(raw.isAvailableOnline);

      const isExisting = existingBarcodes.has(barcode);
      const action: 'CREATE' | 'UPDATE' = isExisting ? 'UPDATE' : 'CREATE';

      if (!barcode || barcode.length < 3) {
        errors.push('الباركود مطلوب (3 أحرف/أرقام على الأقل)');
      }
      if (!name || name.length < 2) {
        errors.push('اسم الصنف مطلوب');
      }
      if (isNaN(retailPrice) || retailPrice <= 0) {
        errors.push('سعر البيع يجب أن يكون أكبر من صفر');
      }
      if (isNaN(quantity) || !Number.isInteger(quantity) || quantity < 0) {
        errors.push('الكمية يجب أن تكون عدداً صحيحاً (0 أو أكثر)');
      } else if (!isExisting && quantity <= 0) {
        errors.push('الكمية للصنف الجديد يجب أن تكون أكبر من صفر');
      }

      // When adding stock (quantity > 0) or creating a new product, costPrice and expiryDate must be valid
      if (quantity > 0 || !isExisting) {
        if (isNaN(costPrice) || costPrice <= 0) {
          errors.push('سعر الشراء مطلوب ويجب أن يكون أكبر من صفر');
        }
        if (!parsedExpiry) {
          errors.push('تاريخ الصلاحية غير صالح (الصيغة المطلوبة YYYY-MM-DD)');
        }
      }

      if (isNaN(minStockAlert) || minStockAlert < 0) {
        errors.push('حد الطلب الأدنى غير صالح');
      }

      return {
        rowNumber,
        barcode,
        name,
        category,
        weightUnit,
        description,
        retailPrice: isNaN(retailPrice) ? 0 : retailPrice,
        costPrice: isNaN(costPrice) || costPrice <= 0 ? 0 : costPrice,
        quantity: isNaN(quantity) ? 0 : quantity,
        expiryDate: parsedExpiry || '',
        batchNumber,
        minStockAlert: isNaN(minStockAlert) ? 5 : minStockAlert,
        isAvailableOnline,
        action,
        valid: errors.length === 0,
        errors,
      };
    });

    const validRows = validatedRows.filter((r) => r.valid);
    const invalidRows = validatedRows.filter((r) => !r.valid);

    if (dryRun || validRows.length === 0) {
      return {
        dryRun,
        totalRows: validatedRows.length,
        validCount: validRows.length,
        invalidCount: invalidRows.length,
        createdCount: 0,
        updatedCount: 0,
        rows: validatedRows,
        products: [],
      };
    }

    let createdCount = 0;
    let updatedCount = 0;

    const upsertedProducts = await prisma.$transaction(async (tx) => {
      const results: any[] = [];

      for (const row of validRows) {
        const existing = await tx.product.findUnique({
          where: { barcode: row.barcode },
        });

        if (existing) {
          updatedCount++;
          await tx.product.update({
            where: { id: existing.id },
            data: {
              name: row.name,
              category: row.category,
              weightUnit: row.weightUnit,
              ...(row.description !== undefined && { description: row.description }),
              retailPrice: new Prisma.Decimal(row.retailPrice),
              minStockAlert: row.minStockAlert,
              isAvailableOnline: row.isAvailableOnline,
            },
          });

          if (row.quantity > 0) {
            await this.upsertOrAppendBatchInTx(tx, existing.id, {
              batchNumber: row.batchNumber,
              costPrice: row.costPrice,
              quantity: row.quantity,
              expiryDate: row.expiryDate,
            });
          }

          const refreshed = await tx.product.findUnique({
            where: { id: existing.id },
            include: {
              batches: {
                where: { quantity: { gt: 0 } },
                orderBy: { expiryDate: 'asc' },
              },
            },
          });
          if (refreshed) results.push(refreshed);
        } else {
          createdCount++;
          const created = await tx.product.create({
            data: {
              barcode: row.barcode,
              name: row.name,
              category: row.category,
              weightUnit: row.weightUnit,
              description: row.description,
              retailPrice: new Prisma.Decimal(row.retailPrice),
              minStockAlert: row.minStockAlert,
              isAvailableOnline: row.isAvailableOnline,
              ...(row.quantity > 0
                ? {
                    batches: {
                      create: [
                        {
                          batchNumber: row.batchNumber,
                          costPrice: new Prisma.Decimal(row.costPrice),
                          quantity: row.quantity,
                          expiryDate: new Date(row.expiryDate),
                        },
                      ],
                    },
                  }
                : {}),
            },
            include: {
              batches: {
                where: { quantity: { gt: 0 } },
                orderBy: { expiryDate: 'asc' },
              },
            },
          });
          results.push(created);
        }
      }

      return results;
    });

    return {
      dryRun: false,
      totalRows: validatedRows.length,
      validCount: validRows.length,
      invalidCount: invalidRows.length,
      createdCount,
      updatedCount,
      rows: validatedRows,
      products: upsertedProducts.map((p) => this.sanitizeForRole(p, Role.ADMIN)),
    };
  }

  /**
   * Core FIFO Engine:
   * Deducts sold units from active batches ordered by earliest `expiryDate` first (FIFO)
   * within an explicit Prisma transaction context (`tx`).
   */
  static async deductProductStockFIFO(
    productId: string,
    quantityToDeduct: number,
    tx: Prisma.TransactionClient
  ): Promise<FifoDeductionResult> {
    if (quantityToDeduct <= 0) {
      throw new Error('INVALID_QUANTITY');
    }

    const availableBatches = await tx.productBatch.findMany({
      where: {
        productId,
        quantity: { gt: 0 },
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
    });

    const totalAvailable = availableBatches.reduce((sum, b) => sum + b.quantity, 0);
    if (totalAvailable < quantityToDeduct) {
      throw new Error(`INSUFFICIENT_STOCK:${productId}`);
    }

    let remainingToDeduct = quantityToDeduct;
    const allocations: FifoDeductionAllocation[] = [];

    for (const batch of availableBatches) {
      if (remainingToDeduct <= 0) break;

      const deductQty = Math.min(batch.quantity, remainingToDeduct);
      const updatedBatchQuantity = batch.quantity - deductQty;

      await tx.productBatch.update({
        where: { id: batch.id },
        data: {
          quantity: updatedBatchQuantity,
        },
      });

      remainingToDeduct -= deductQty;

      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        deductedQuantity: deductQty,
        remainingBatchQuantity: updatedBatchQuantity,
        costPrice: batch.costPrice,
        expiryDate: batch.expiryDate,
      });
    }

    return {
      productId,
      totalDeducted: quantityToDeduct,
      remainingTotalStock: totalAvailable - quantityToDeduct,
      allocations,
    };
  }

  static async searchProducts(
    params: { barcode?: string; q?: string },
    role: Role
  ) {
    if (params.barcode) {
      const product = await prisma.product.findUnique({
        where: { barcode: params.barcode.trim() },
        include: {
          batches: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: 'asc' },
          },
        },
      });

      if (!product) {
        return [];
      }
      return [this.sanitizeForRole(product, role)];
    }

    return this.listProducts(role, params.q);
  }

  static async getProductByBarcode(barcode: string, role: Role) {
    const product = await prisma.product.findUnique({
      where: { barcode },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
      },
    });

    if (!product) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    return this.sanitizeForRole(product, role);
  }

  static async listProducts(role: Role, search?: string, updatedSince?: Date) {
    const where: Prisma.ProductWhereInput = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { barcode: { contains: search } },
              { category: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(updatedSince ? { updatedAt: { gte: updatedSince } } : {}),
    };

    const products = await prisma.product.findMany({
      where,
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return products.map((p) => this.sanitizeForRole(p, role));
  }

  static async getExpiringBatches(days: number) {
    const now = new Date();
    const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const batches = await prisma.productBatch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: {
          lte: targetDate,
        },
      },
      include: {
        product: {
          include: {
            batches: {
              where: { quantity: { gt: 0 } },
              select: { quantity: true },
            },
          },
        },
      },
      orderBy: {
        expiryDate: 'asc',
      },
    });

    return batches.map((b) => {
      const diffMs = new Date(b.expiryDate).getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const productBatches = (b.product as any)?.batches || [];
      const calculatedProductRemainingStock =
        productBatches.length > 0
          ? productBatches.reduce((sum: number, pb: any) => sum + pb.quantity, 0)
          : b.quantity;

      return {
        id: b.id,
        batchNumber: b.batchNumber,
        quantity: b.quantity,
        remainingBatchStock: b.quantity,
        calculatedRemainingStock: calculatedProductRemainingStock,
        costPrice: Number(b.costPrice),
        expiryDate: b.expiryDate,
        daysRemaining,
        isExpired: daysRemaining <= 0,
        alertBucket:
          daysRemaining <= 30 ? '30_DAYS' : daysRemaining <= 60 ? '60_DAYS' : '90_DAYS',
        product: {
          id: b.product.id,
          barcode: b.product.barcode,
          name: b.product.name,
          category: (b.product as any).category ?? 'عام',
          retailPrice: Number(b.product.retailPrice),
          weightUnit: b.product.weightUnit,
        },
      };
    });
  }

  static async getOnlineCatalog() {
    const products = await prisma.product.findMany({
      where: { isAvailableOnline: true },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          select: { quantity: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return products.map((p) => {
      const availableQuantity = p.batches.reduce((sum, b) => sum + b.quantity, 0);
      return {
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        category: (p as any).category ?? 'عام',
        description: p.description,
        weightUnit: p.weightUnit,
        retailPrice: Number(p.retailPrice),
        imageUrls:
          p.imageUrls ||
          `https://pub-alamir-media.r2.dev/products/${p.barcode}.webp`,
        minStockAlert: p.minStockAlert ?? 5,
        availableStock: availableQuantity,
        availableQuantity,
        inStock: availableQuantity > 0,
      };
    });
  }
}

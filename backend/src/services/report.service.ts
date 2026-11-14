import ExcelJS from 'exceljs';
import { prisma } from '../config/db';
import { env } from '../config/env';

export interface DateRangeInput {
  startDate?: string;
  endDate?: string;
}

export class ReportService {
  private static buildDateFilter(range?: DateRangeInput) {
    if (!range?.startDate && !range?.endDate) {
      return undefined;
    }
    const filter: { gte?: Date; lte?: Date } = {};
    if (range.startDate) {
      filter.gte = new Date(range.startDate);
    }
    if (range.endDate) {
      filter.lte = new Date(range.endDate);
    }
    return filter;
  }

  static async getDashboardOverview() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayOrders, activeShifts] = await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: startOfToday },
          isReturned: false,
        },
        include: { items: true },
      }),
      prisma.shift.findMany({
        where: { closedAt: null },
        include: {
          cashier: { select: { id: true, name: true, username: true } },
        },
      }),
    ]);

    let todayRevenue = 0;
    let todayProfit = 0;
    for (const order of todayOrders) {
      const rev = Number(order.totalAmount);
      const cost = order.items.reduce(
        (sum, i) => sum + Number(i.costPrice) * i.quantity,
        0
      );
      todayRevenue += rev;
      todayProfit += rev - cost;
    }

    return {
      storeName: 'ماركت الأمير (Alamir Market)',
      currency: env.CURRENCY,
      todayOrdersCount: todayOrders.length,
      todayRevenue: Number(todayRevenue.toFixed(2)),
      todayNetProfit: Number(todayProfit.toFixed(2)),
      activeShiftsCount: activeShifts.length,
      activeShifts: activeShifts.map((s) => ({
        id: s.id,
        cashierName: s.cashier?.name || '-',
        startingCash: Number(s.startingCash),
        openedAt: s.openedAt,
      })),
    };
  }

  static async getProfitAndLossSummary(range?: DateRangeInput) {
    const createdAtFilter = this.buildDateFilter(range);

    const orders = await prisma.order.findMany({
      where: {
        ...(createdAtFilter && { createdAt: createdAtFilter }),
      },
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let grossRevenue = 0;
    let totalCostOfGoodsSold = 0;
    let returnedOrdersValue = 0;
    let validOrdersCount = 0;
    let returnedOrdersCount = 0;

    for (const order of orders) {
      if (order.isReturned) {
        returnedOrdersCount++;
        returnedOrdersValue += Number(order.totalAmount);
        continue;
      }

      validOrdersCount++;
      grossRevenue += Number(order.totalAmount);

      for (const item of order.items) {
        totalCostOfGoodsSold += Number(item.costPrice) * item.quantity;
      }
    }

    const netProfit = Number((grossRevenue - totalCostOfGoodsSold).toFixed(2));
    const profitMarginPercent =
      grossRevenue > 0 ? Number(((netProfit / grossRevenue) * 100).toFixed(2)) : 0;

    return {
      storeName: 'ماركت الأمير (Alamir Market)',
      currency: env.CURRENCY,
      validOrdersCount,
      returnedOrdersCount,
      grossRevenue: Number(grossRevenue.toFixed(2)),
      totalCostOfGoodsSold: Number(totalCostOfGoodsSold.toFixed(2)),
      netProfit,
      profitMarginPercent,
      returnedOrdersValue: Number(returnedOrdersValue.toFixed(2)),
    };
  }

  static async generateSalesExcelBuffer(range?: DateRangeInput): Promise<Buffer> {
    const createdAtFilter = this.buildDateFilter(range);
    const orders = await prisma.order.findMany({
      where: {
        ...(createdAtFilter && { createdAt: createdAtFilter }),
      },
      include: {
        cashier: { select: { name: true, username: true } },
        items: {
          include: {
            product: { select: { name: true, barcode: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alamir Market POS & ERP';
    workbook.created = new Date();

    const salesSheet = workbook.addWorksheet('المبيعات والأرباح', {
      views: [{ rightToLeft: true }],
    });
    salesSheet.columns = [
      { header: 'رقم الفاتورة', key: 'orderNumber', width: 22 },
      { header: 'التاريخ', key: 'createdAt', width: 22 },
      { header: 'الكاشير', key: 'cashierName', width: 20 },
      { header: 'طريقة الدفع', key: 'paymentMethod', width: 15 },
      { header: 'الحالة', key: 'status', width: 15 },
      { header: `الإجمالي (${env.CURRENCY})`, key: 'totalAmount', width: 18 },
      { header: `التكلفة (${env.CURRENCY})`, key: 'totalCost', width: 18 },
      { header: `صافي الربح (${env.CURRENCY})`, key: 'netProfit', width: 18 },
    ];

    for (const order of orders) {
      const revenue = Number(order.totalAmount);
      const cost = order.items.reduce(
        (sum, item) => sum + Number(item.costPrice) * item.quantity,
        0
      );
      const profit = order.isReturned ? 0 : Number((revenue - cost).toFixed(2));

      salesSheet.addRow({
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        cashierName: order.cashier?.name || '-',
        paymentMethod: order.paymentMethod,
        status: order.isReturned ? 'مرتجع' : 'مكتمل',
        totalAmount: revenue,
        totalCost: Number(cost.toFixed(2)),
        netProfit: profit,
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  static async generateInventoryExcelBuffer(expiryDays = 90): Promise<Buffer> {
    const now = new Date();
    const expiryTargetDate = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const products = await prisma.product.findMany({
      include: {
        batches: {
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alamir Market POS & ERP';
    workbook.created = now;

    const stockSheet = workbook.addWorksheet('تقييم المخزون والتشغيلات', {
      views: [{ rightToLeft: true }],
    });
    stockSheet.columns = [
      { header: 'الباركود', key: 'barcode', width: 20 },
      { header: 'اسم الصنف', key: 'productName', width: 30 },
      { header: 'رقم التشغيلة', key: 'batchNumber', width: 18 },
      { header: 'الكمية المتاحة', key: 'quantity', width: 16 },
      { header: `سعر التكلفة (${env.CURRENCY})`, key: 'costPrice', width: 18 },
      { header: `إجمالي قيمة التكلفة (${env.CURRENCY})`, key: 'costValuation', width: 22 },
      { header: `سعر البيع (${env.CURRENCY})`, key: 'retailPrice', width: 18 },
      { header: `إجمالي القيمة البيعية (${env.CURRENCY})`, key: 'retailValuation', width: 22 },
      { header: 'تاريخ الصلاحية', key: 'expiryDate', width: 20 },
    ];

    const expirySheet = workbook.addWorksheet('تنبيهات الصلاحية', {
      views: [{ rightToLeft: true }],
    });
    expirySheet.columns = [
      { header: 'الباركود', key: 'barcode', width: 20 },
      { header: 'اسم الصنف', key: 'productName', width: 30 },
      { header: 'رقم التشغيلة', key: 'batchNumber', width: 18 },
      { header: 'الكمية المتبقية', key: 'quantity', width: 16 },
      { header: 'تاريخ الانتهاء', key: 'expiryDate', width: 20 },
      { header: 'الأيام المتبقية', key: 'daysRemaining', width: 16 },
      { header: 'تصنيف التنبيه', key: 'alertBucket', width: 18 },
    ];

    for (const product of products) {
      for (const batch of product.batches) {
        const costPrice = Number(batch.costPrice);
        const retailPrice = Number(product.retailPrice);
        stockSheet.addRow({
          barcode: product.barcode,
          productName: product.name,
          batchNumber: batch.batchNumber,
          quantity: batch.quantity,
          costPrice,
          costValuation: Number((costPrice * batch.quantity).toFixed(2)),
          retailPrice,
          retailValuation: Number((retailPrice * batch.quantity).toFixed(2)),
          expiryDate: batch.expiryDate.toISOString().split('T')[0],
        });

        if (batch.quantity > 0 && batch.expiryDate <= expiryTargetDate) {
          const diffDays = Math.ceil(
            (batch.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          expirySheet.addRow({
            barcode: product.barcode,
            productName: product.name,
            batchNumber: batch.batchNumber,
            quantity: batch.quantity,
            expiryDate: batch.expiryDate.toISOString().split('T')[0],
            daysRemaining: diffDays,
            alertBucket:
              diffDays <= 0
                ? 'منتهي الصلاحية'
                : diffDays <= 30
                ? 'خلال 30 يوم'
                : diffDays <= 60
                ? 'خلال 60 يوم'
                : 'خلال 90 يوم',
          });
        }
      }
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  static async generateShiftsExcelBuffer(range?: DateRangeInput): Promise<Buffer> {
    const openedAtFilter = this.buildDateFilter(range);
    const shifts = await prisma.shift.findMany({
      where: {
        ...(openedAtFilter && { openedAt: openedAtFilter }),
      },
      include: {
        cashier: { select: { name: true, username: true } },
      },
      orderBy: { openedAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alamir Market POS & ERP';
    workbook.created = new Date();

    const shiftSheet = workbook.addWorksheet('سجل الورديات ومطابقة العجز', {
      views: [{ rightToLeft: true }],
    });
    shiftSheet.columns = [
      { header: 'رقم الوردية', key: 'shiftId', width: 24 },
      { header: 'الكاشير', key: 'cashierName', width: 20 },
      { header: 'وقت الفتح', key: 'openedAt', width: 22 },
      { header: 'وقت الإغلاق', key: 'closedAt', width: 22 },
      { header: `عهدة البداية (${env.CURRENCY})`, key: 'startingCash', width: 18 },
      { header: `النقدية المتوقعة (${env.CURRENCY})`, key: 'expectedCash', width: 20 },
      { header: `النقدية الفعلية (${env.CURRENCY})`, key: 'actualEndCash', width: 20 },
      { header: `العجز / الفائض (${env.CURRENCY})`, key: 'discrepancy', width: 20 },
      { header: 'حالة المطابقة', key: 'auditStatus', width: 18 },
    ];

    for (const shift of shifts) {
      const disc = shift.discrepancy !== null ? Number(shift.discrepancy) : null;
      const auditStatus =
        disc === null
          ? 'مفتوحة'
          : disc === 0
          ? 'مطابق'
          : disc > 0
          ? 'فائض في الدرج'
          : 'عجز في الدرج';

      shiftSheet.addRow({
        shiftId: shift.id,
        cashierName: shift.cashier?.name || '-',
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : 'مفتوحة',
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash !== null ? Number(shift.expectedCash) : '-',
        actualEndCash: shift.actualEndCash !== null ? Number(shift.actualEndCash) : '-',
        discrepancy: disc !== null ? disc : '-',
        auditStatus,
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  static async generateExcelWorkbook(range?: DateRangeInput, expiryDays = 90): Promise<Buffer> {
    const createdAtFilter = this.buildDateFilter(range);
    const now = new Date();
    const expiryTargetDate = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const [orders, products, shifts] = await Promise.all([
      prisma.order.findMany({
        where: {
          ...(createdAtFilter && { createdAt: createdAtFilter }),
        },
        include: {
          cashier: { select: { name: true, username: true } },
          items: {
            include: {
              product: { select: { name: true, barcode: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({
        include: {
          batches: {
            orderBy: { expiryDate: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.shift.findMany({
        where: {
          ...(createdAtFilter && { openedAt: createdAtFilter }),
        },
        include: {
          cashier: { select: { name: true, username: true } },
        },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alamir Market POS & ERP';
    workbook.created = now;

    const salesSheet = workbook.addWorksheet('المبيعات والأرباح', {
      views: [{ rightToLeft: true }],
    });
    salesSheet.columns = [
      { header: 'رقم الفاتورة', key: 'orderNumber', width: 22 },
      { header: 'التاريخ', key: 'createdAt', width: 22 },
      { header: 'الكاشير', key: 'cashierName', width: 20 },
      { header: 'طريقة الدفع', key: 'paymentMethod', width: 15 },
      { header: 'الحالة', key: 'status', width: 15 },
      { header: `الإجمالي (${env.CURRENCY})`, key: 'totalAmount', width: 18 },
      { header: `التكلفة (${env.CURRENCY})`, key: 'totalCost', width: 18 },
      { header: `صافي الربح (${env.CURRENCY})`, key: 'netProfit', width: 18 },
    ];

    for (const order of orders) {
      const revenue = Number(order.totalAmount);
      const cost = order.items.reduce(
        (sum, item) => sum + Number(item.costPrice) * item.quantity,
        0
      );
      const profit = order.isReturned ? 0 : Number((revenue - cost).toFixed(2));

      salesSheet.addRow({
        orderNumber: order.orderNumber,
        createdAt: order.createdAt.toISOString(),
        cashierName: order.cashier?.name || '-',
        paymentMethod: order.paymentMethod,
        status: order.isReturned ? 'مرتجع' : 'مكتمل',
        totalAmount: revenue,
        totalCost: Number(cost.toFixed(2)),
        netProfit: profit,
      });
    }

    const stockSheet = workbook.addWorksheet('حركة المخزون والتشغيلات', {
      views: [{ rightToLeft: true }],
    });
    stockSheet.columns = [
      { header: 'الباركود', key: 'barcode', width: 20 },
      { header: 'اسم الصنف', key: 'productName', width: 30 },
      { header: 'رقم التشغيلة', key: 'batchNumber', width: 18 },
      { header: 'الكمية المتاحة', key: 'quantity', width: 16 },
      { header: `سعر التكلفة (${env.CURRENCY})`, key: 'costPrice', width: 18 },
      { header: `سعر البيع (${env.CURRENCY})`, key: 'retailPrice', width: 18 },
      { header: 'تاريخ الصلاحية', key: 'expiryDate', width: 20 },
    ];

    const expirySheet = workbook.addWorksheet('تنبيهات الصلاحية', {
      views: [{ rightToLeft: true }],
    });
    expirySheet.columns = [
      { header: 'الباركود', key: 'barcode', width: 20 },
      { header: 'اسم الصنف', key: 'productName', width: 30 },
      { header: 'رقم التشغيلة', key: 'batchNumber', width: 18 },
      { header: 'الكمية', key: 'quantity', width: 14 },
      { header: 'تاريخ الانتهاء', key: 'expiryDate', width: 20 },
      { header: 'الأيام المتبقية', key: 'daysRemaining', width: 16 },
      { header: 'تصنيف التنبيه', key: 'alertBucket', width: 18 },
    ];

    for (const product of products) {
      for (const batch of product.batches) {
        stockSheet.addRow({
          barcode: product.barcode,
          productName: product.name,
          batchNumber: batch.batchNumber,
          quantity: batch.quantity,
          costPrice: Number(batch.costPrice),
          retailPrice: Number(product.retailPrice),
          expiryDate: batch.expiryDate.toISOString().split('T')[0],
        });

        if (batch.quantity > 0 && batch.expiryDate <= expiryTargetDate) {
          const diffDays = Math.ceil(
            (batch.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          expirySheet.addRow({
            barcode: product.barcode,
            productName: product.name,
            batchNumber: batch.batchNumber,
            quantity: batch.quantity,
            expiryDate: batch.expiryDate.toISOString().split('T')[0],
            daysRemaining: diffDays,
            alertBucket:
              diffDays <= 0
                ? 'منتهي الصلاحية'
                : diffDays <= 30
                ? 'خلال 30 يوم'
                : diffDays <= 60
                ? 'خلال 60 يوم'
                : 'خلال 90 يوم',
          });
        }
      }
    }

    const shiftSheet = workbook.addWorksheet('سجل الورديات', {
      views: [{ rightToLeft: true }],
    });
    shiftSheet.columns = [
      { header: 'رقم الوردية', key: 'shiftId', width: 24 },
      { header: 'الكاشير', key: 'cashierName', width: 20 },
      { header: 'وقت الفتح', key: 'openedAt', width: 22 },
      { header: 'وقت الإغلاق', key: 'closedAt', width: 22 },
      { header: `عهدة البداية (${env.CURRENCY})`, key: 'startingCash', width: 18 },
      { header: `النقدية المتوقعة (${env.CURRENCY})`, key: 'expectedCash', width: 20 },
      { header: `النقدية الفعلية (${env.CURRENCY})`, key: 'actualEndCash', width: 20 },
      { header: `العجز / الفائض (${env.CURRENCY})`, key: 'discrepancy', width: 20 },
    ];

    for (const shift of shifts) {
      shiftSheet.addRow({
        shiftId: shift.id,
        cashierName: shift.cashier?.name || '-',
        openedAt: shift.openedAt.toISOString(),
        closedAt: shift.closedAt ? shift.closedAt.toISOString() : 'مفتوحة',
        startingCash: Number(shift.startingCash),
        expectedCash: shift.expectedCash !== null ? Number(shift.expectedCash) : '-',
        actualEndCash: shift.actualEndCash !== null ? Number(shift.actualEndCash) : '-',
        discrepancy: shift.discrepancy !== null ? Number(shift.discrepancy) : '-',
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}

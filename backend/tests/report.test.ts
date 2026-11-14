import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { Prisma, PaymentMethod, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  return {
    prisma: {
      order: {
        findMany: vi.fn(),
      },
      product: {
        findMany: vi.fn(),
      },
      shift: {
        findMany: vi.fn(),
      },
    },
  };
});

const binaryParser = (res: any, callback: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Alamir Market POS - Task 5: ExcelJS Export Endpoints & Admin P&L', () => {
  const adminToken = jwt.sign(
    { userId: 'u-admin-1', username: 'admin', role: Role.ADMIN },
    env.JWT_SECRET
  );
  const cashierToken = jwt.sign(
    { userId: 'u-cashier-1', username: 'cashier1', role: Role.CASHIER },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/reports/pnl blocks CASHIER role (403 Forbidden) and computes accurate P&L for ADMIN', async () => {
    const cashierRes = await request(app)
      .get('/api/reports/pnl')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
      {
        id: 'ord-1',
        orderNumber: 'ALM-1001',
        totalAmount: new Prisma.Decimal(200.0),
        isReturned: false,
        items: [
          {
            quantity: 4,
            unitPrice: new Prisma.Decimal(50.0),
            costPrice: new Prisma.Decimal(35.0),
          },
        ],
      },
      {
        id: 'ord-2',
        orderNumber: 'ALM-1002',
        totalAmount: new Prisma.Decimal(100.0),
        isReturned: true,
        items: [
          {
            quantity: 2,
            unitPrice: new Prisma.Decimal(50.0),
            costPrice: new Prisma.Decimal(35.0),
          },
        ],
      },
    ] as any);

    const adminRes = await request(app)
      .get('/api/reports/pnl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.currency).toBe('ج.م');
    expect(adminRes.body.data.grossRevenue).toBe(200);
    expect(adminRes.body.data.totalCostOfGoodsSold).toBe(140);
    expect(adminRes.body.data.netProfit).toBe(60);
    expect(adminRes.body.data.profitMarginPercent).toBe(30);
    expect(adminRes.body.data.returnedOrdersCount).toBe(1);
  });

  it('GET /api/reports/sales/excel, /inventory/excel, and /shifts/excel enforce ADMIN role and return valid .xlsx buffers', async () => {
    // 1. Cashier forbidden from sales excel export
    const forbiddenSales = await request(app)
      .get('/api/reports/sales/excel')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(forbiddenSales.status).toBe(403);

    // 2. GET /api/reports/sales/excel (Date-range filterable)
    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
      {
        id: 'ord-1',
        orderNumber: 'ALM-1001',
        totalAmount: new Prisma.Decimal(90.0),
        paymentMethod: PaymentMethod.CASH,
        isReturned: false,
        createdAt: new Date('2026-11-01T10:00:00Z'),
        cashier: { name: 'محمد كاشير', username: 'cashier1' },
        items: [
          {
            quantity: 2,
            unitPrice: new Prisma.Decimal(45.0),
            costPrice: new Prisma.Decimal(36.0),
            product: { name: 'جهينة حليب 1 لتر', barcode: '6221000001' },
          },
        ],
      },
    ] as any);

    const salesRes = await request(app)
      .get('/api/reports/sales/excel?startDate=2026-11-01&endDate=2026-11-30')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

    expect(salesRes.status).toBe(200);
    const salesWb = new ExcelJS.Workbook();
    await salesWb.xlsx.load(salesRes.body);
    expect(salesWb.worksheets[0].name).toBe('المبيعات والأرباح');

    // 3. GET /api/reports/inventory/excel (Stock levels, valuation & near-expiry)
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      {
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب 1 لتر',
        retailPrice: new Prisma.Decimal(45.0),
        batches: [
          {
            id: 'batch-1',
            batchNumber: 'B-2026-11',
            quantity: 25,
            costPrice: new Prisma.Decimal(36.0),
            expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          },
        ],
      },
    ] as any);

    const invRes = await request(app)
      .get('/api/reports/inventory/excel?expiryDays=60')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

    expect(invRes.status).toBe(200);
    const invWb = new ExcelJS.Workbook();
    await invWb.xlsx.load(invRes.body);
    expect(invWb.worksheets.map((w) => w.name)).toEqual([
      'تقييم المخزون والتشغيلات',
      'تنبيهات الصلاحية',
    ]);

    // 4. GET /api/reports/shifts/excel (Shift closing logs & discrepancy audit)
    vi.mocked(prisma.shift.findMany).mockResolvedValueOnce([
      {
        id: 'shift-1',
        cashier: { name: 'محمد كاشير', username: 'cashier1' },
        openedAt: new Date('2026-11-01T08:00:00Z'),
        closedAt: new Date('2026-11-01T16:00:00Z'),
        startingCash: new Prisma.Decimal(500.0),
        expectedCash: new Prisma.Decimal(590.0),
        actualEndCash: new Prisma.Decimal(575.0),
        discrepancy: new Prisma.Decimal(-15.0),
      },
    ] as any);

    const shiftRes = await request(app)
      .get('/api/reports/shifts/excel')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse(binaryParser);

    expect(shiftRes.status).toBe(200);
    const shiftWb = new ExcelJS.Workbook();
    await shiftWb.xlsx.load(shiftRes.body);
    expect(shiftWb.worksheets[0].name).toBe('سجل الورديات ومطابقة العجز');
  });
});

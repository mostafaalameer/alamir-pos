import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { Prisma, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockProduct = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const mockProductBatch = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  };
  const mockOrderItem = {
    deleteMany: vi.fn(),
  };
  return {
    prisma: {
      product: mockProduct,
      productBatch: mockProductBatch,
      orderItem: mockOrderItem,
      $transaction: vi.fn((cb) =>
        cb({
          product: mockProduct,
          productBatch: mockProductBatch,
          orderItem: mockOrderItem,
        })
      ),
    },
  };
});

describe('Admin product management: edit, stock adjustments & Excel bulk import', () => {
  const sign = (role: Role) =>
    jwt.sign({ userId: 'u1', username: 'u', role }, env.JWT_SECRET);

  beforeEach(() => vi.clearAllMocks());

  it('CASHIER gets 403 on PATCH /api/products/:id, POST /batches, POST /adjust-stock, and POST /bulk-import', async () => {
    const cashierAuth = `Bearer ${sign(Role.CASHIER)}`;

    const patch = await request(app)
      .patch('/api/products/p1')
      .set('Authorization', cashierAuth)
      .send({ name: 'x1' });
    expect(patch.status).toBe(403);

    const batch = await request(app)
      .post('/api/products/p1/batches')
      .set('Authorization', cashierAuth)
      .send({ batchNumber: 'B', costPrice: 1, quantity: 1, expiryDate: '2027-01-01' });
    expect(batch.status).toBe(403);

    const adjust = await request(app)
      .post('/api/products/p1/adjust-stock')
      .set('Authorization', cashierAuth)
      .send({ mode: 'RECONCILE', quantityToDeduct: 2, reason: 'تالف' });
    expect(adjust.status).toBe(403);

    const bulk = await request(app)
      .post('/api/products/bulk-import')
      .set('Authorization', cashierAuth)
      .send({ rows: [] });
    expect(bulk.status).toBe(403);
  });

  it('ADMIN can change barcode; duplicate barcode returns 409', async () => {
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'p1', barcode: 'OLD123' } as any)
      .mockResolvedValueOnce({ id: 'p2', barcode: 'TAKEN1' } as any);

    const dup = await request(app)
      .patch('/api/products/p1')
      .set('Authorization', `Bearer ${sign(Role.ADMIN)}`)
      .send({ barcode: 'TAKEN1' });
    expect(dup.status).toBe(409);

    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'p1', barcode: 'OLD123' } as any)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.product.update).mockResolvedValueOnce({
      id: 'p1',
      barcode: 'NEW456',
      name: 'منتج',
      retailPrice: new Prisma.Decimal(10),
      minStockAlert: 5,
      batches: [],
    } as any);

    const ok = await request(app)
      .patch('/api/products/p1')
      .set('Authorization', `Bearer ${sign(Role.ADMIN)}`)
      .send({ barcode: 'NEW456', isAvailableOnline: true });
    expect(ok.status).toBe(200);
    expect(ok.body.data.barcode).toBe('NEW456');
  });

  it('POST /api/products/:id/adjust-stock reconciles damaged/expired stock via FIFO and records audit reason', async () => {
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'prod-1', barcode: '6221000001', name: 'جهينة حليب' } as any)
      .mockResolvedValueOnce({
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب',
        retailPrice: new Prisma.Decimal(45),
        minStockAlert: 5,
        batches: [
          {
            id: 'b-101',
            batchNumber: 'B-2026-11A',
            costPrice: new Prisma.Decimal(36.5),
            quantity: 5,
            expiryDate: new Date('2026-11-18'),
          },
        ],
      } as any);

    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'b-101',
        productId: 'prod-1',
        batchNumber: 'B-2026-11A',
        costPrice: new Prisma.Decimal(36.5),
        quantity: 8,
        expiryDate: new Date('2026-11-18'),
        createdAt: new Date(),
      },
    ] as any);
    vi.mocked(prisma.productBatch.update).mockResolvedValueOnce({} as any);

    const res = await request(app)
      .post('/api/products/prod-1/adjust-stock')
      .set('Authorization', `Bearer ${sign(Role.ADMIN)}`)
      .send({
        mode: 'RECONCILE',
        quantityToDeduct: 3,
        reason: 'تالف',
        notes: 'عبوات تالفة أثناء النقل',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('RECONCILE');
    expect(res.body.data.adjustment.quantityDeducted).toBe(3);
    expect(res.body.data.adjustment.reason).toBe('تالف');
    expect(res.body.data.product.totalStock).toBe(5);
  });

  it('GET /api/products/bulk-template exports .xlsx pre-populated with registered products, and POST /api/products/bulk-import processes .xlsx file inside transaction', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      {
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        weightUnit: 'لتر',
        retailPrice: new Prisma.Decimal(45),
        minStockAlert: 10,
        isAvailableOnline: true,
        description: 'حليب طبيعي',
        batches: [
          {
            id: 'b-101',
            batchNumber: 'B-2026-11A',
            costPrice: new Prisma.Decimal(36.5),
            quantity: 12,
            expiryDate: new Date('2026-11-18'),
          },
        ],
      },
    ] as any);

    const tplRes = await request(app)
      .get('/api/products/bulk-template')
      .set('Authorization', `Bearer ${sign(Role.ADMIN)}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(tplRes.status).toBe(200);
    expect(tplRes.headers['content-type']).toContain('spreadsheetml.sheet');

    // Build an .xlsx file in-memory with 1 existing product (updated price + new batch) and 1 new product
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow([
      'الباركود',
      'اسم الصنف',
      'سعر البيع',
      'سعر الشراء',
      'الكمية',
      'تاريخ الصلاحية',
      'رقم التشغيلة',
      'حد الطلب',
      'متاح أونلاين',
    ]);
    ws.addRow([
      '6221000001',
      'جهينة حليب كامل الدسم 1 لتر',
      48.0,
      38.5,
      15,
      '2027-02-01',
      'B-2027-02',
      10,
      'نعم',
    ]);
    ws.addRow([
      '6221000999',
      'مكرونة الملكة 400 جم',
      18.5,
      14.0,
      40,
      '2027-08-15',
      '',
      12,
      'لا',
    ]);
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // Mock DB calls for bulkImportProducts
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      { id: 'prod-1', barcode: '6221000001' },
    ] as any);

    // Row 1: existing barcode -> update product + create batch + refresh product
    vi.mocked(prisma.product.findUnique)
      .mockResolvedValueOnce({ id: 'prod-1', barcode: '6221000001' } as any)
      .mockResolvedValueOnce({
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        weightUnit: 'قطعة',
        retailPrice: new Prisma.Decimal(48),
        minStockAlert: 10,
        isAvailableOnline: true,
        batches: [
          {
            id: 'b-new-1',
            batchNumber: 'B-2027-02',
            costPrice: new Prisma.Decimal(38.5),
            quantity: 15,
            expiryDate: new Date('2027-02-01'),
          },
        ],
      } as any)
      // Row 2: new barcode -> findUnique returns null -> create product with batch
      .mockResolvedValueOnce(null);

    vi.mocked(prisma.product.update).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.productBatch.create).mockResolvedValueOnce({} as any);
    vi.mocked(prisma.product.create).mockResolvedValueOnce({
      id: 'prod-999',
      barcode: '6221000999',
      name: 'مكرونة الملكة 400 جم',
      weightUnit: 'قطعة',
      retailPrice: new Prisma.Decimal(18.5),
      minStockAlert: 12,
      isAvailableOnline: false,
      batches: [
        {
          id: 'b-999',
          batchNumber: 'B-AUTO',
          costPrice: new Prisma.Decimal(14),
          quantity: 40,
          expiryDate: new Date('2027-08-15'),
        },
      ],
    } as any);

    const importRes = await request(app)
      .post('/api/products/bulk-import')
      .set('Authorization', `Bearer ${sign(Role.ADMIN)}`)
      .attach('file', xlsxBuffer, 'products-import.xlsx');

    expect(importRes.status).toBe(200);
    expect(importRes.body.data.validCount).toBe(2);
    expect(importRes.body.data.updatedCount).toBe(1);
    expect(importRes.body.data.createdCount).toBe(1);
    expect(importRes.body.data.products).toHaveLength(2);
  });

  it('POST /api/products/:id/batches creates a new batch for a DIFFERENT expiryDate and merges quantity when expiryDate + costPrice match', async () => {
    const adminAuth = `Bearer ${sign(Role.ADMIN)}`;

    // Case 1: New stock with DIFFERENT expiry date (2027-05-01 vs existing 2026-11-18) -> creates a new ProductBatch
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      category: 'ألبان وأجبان',
    } as any);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'b-101',
        productId: 'prod-1',
        batchNumber: 'B-OLD',
        costPrice: new Prisma.Decimal(36.5),
        quantity: 8,
        expiryDate: new Date('2026-11-18T00:00:00.000Z'),
      },
    ] as any);
    vi.mocked(prisma.productBatch.create).mockResolvedValueOnce({
      id: 'b-new-diff-expiry',
      productId: 'prod-1',
      batchNumber: 'B-NEW-EXP',
      costPrice: new Prisma.Decimal(38.0),
      quantity: 20,
      expiryDate: new Date('2027-05-01T00:00:00.000Z'),
    } as any);

    const diffRes = await request(app)
      .post('/api/products/prod-1/batches')
      .set('Authorization', adminAuth)
      .send({
        batchNumber: 'B-NEW-EXP',
        costPrice: 38.0,
        quantity: 20,
        expiryDate: '2027-05-01',
      });

    expect(diffRes.status).toBe(201);
    expect(prisma.productBatch.create).toHaveBeenCalledTimes(1);
    expect(diffRes.body.data.id).toBe('b-new-diff-expiry');

    // Case 2: New stock with SAME expiryDate (2026-11-18) and SAME costPrice (36.5) -> merges into b-101 (8 + 12 = 20)
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
    } as any);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'b-101',
        productId: 'prod-1',
        batchNumber: 'B-OLD',
        costPrice: new Prisma.Decimal(36.5),
        quantity: 8,
        expiryDate: new Date('2026-11-18T00:00:00.000Z'),
      },
    ] as any);
    vi.mocked(prisma.productBatch.update).mockResolvedValueOnce({
      id: 'b-101',
      productId: 'prod-1',
      batchNumber: 'B-OLD',
      costPrice: new Prisma.Decimal(36.5),
      quantity: 20,
      expiryDate: new Date('2026-11-18T00:00:00.000Z'),
    } as any);

    const sameRes = await request(app)
      .post('/api/products/prod-1/batches')
      .set('Authorization', adminAuth)
      .send({
        batchNumber: 'B-SAME-EXP',
        costPrice: 36.5,
        quantity: 12,
        expiryDate: '2026-11-18',
      });

    expect(sameRes.status).toBe(201);
    expect(prisma.productBatch.update).toHaveBeenCalledWith({
      where: { id: 'b-101' },
      data: { quantity: 20 },
    });
    expect(sameRes.body.data.quantity).toBe(20);
  });

  it('ADMIN can delete a single product (DELETE /api/products/:id) and bulk delete selected products (POST /api/products/bulk-delete)', async () => {
    const adminAuth = `Bearer ${sign(Role.ADMIN)}`;
    const cashierAuth = `Bearer ${sign(Role.CASHIER)}`;

    const forbidden = await request(app)
      .delete('/api/products/prod-1')
      .set('Authorization', cashierAuth);
    expect(forbidden.status).toBe(403);

    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب',
    } as any);
    vi.mocked(prisma.product.delete).mockResolvedValueOnce({ id: 'prod-1' } as any);

    const singleDel = await request(app)
      .delete('/api/products/prod-1')
      .set('Authorization', adminAuth);
    expect(singleDel.status).toBe(200);
    expect(singleDel.body.data.deletedId).toBe('prod-1');

    vi.mocked(prisma.product.deleteMany).mockResolvedValueOnce({ count: 2 } as any);

    const bulkDel = await request(app)
      .post('/api/products/bulk-delete')
      .set('Authorization', adminAuth)
      .send({ ids: ['prod-2', 'prod-3'] });
    expect(bulkDel.status).toBe(200);
    expect(bulkDel.body.data.deletedCount).toBe(2);
    expect(bulkDel.body.data.deletedIds).toEqual(['prod-2', 'prod-3']);
  });
});

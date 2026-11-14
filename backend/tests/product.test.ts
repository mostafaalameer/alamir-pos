import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';
import { ProductService } from '../src/services/product.service';

vi.mock('../src/config/db', () => {
  const mockProduct = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockProductBatch = {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  return {
    prisma: {
      product: mockProduct,
      productBatch: mockProductBatch,
      $transaction: vi.fn((callback) =>
        callback({
          product: mockProduct,
          productBatch: mockProductBatch,
        })
      ),
    },
  };
});

describe('Alamir Market POS - Task 2: Product Catalog, Batches & FIFO Expiry Engine', () => {
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

  it('POST /api/products & PATCH /api/products/:id/price enforce ADMIN role and block CASHIER (403)', async () => {
    // 1. Cashier blocked from creating product
    const forbiddenCreate = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        retailPrice: 45.5,
      });
    expect(forbiddenCreate.status).toBe(403);

    // 2. Admin creates product
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.product.create).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      description: 'حليب طبيعي 100%',
      weightUnit: 'لتر',
      retailPrice: new Prisma.Decimal(45.5),
      isAvailableOnline: true,
      imageUrls: null,
      minStockAlert: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
      batches: [],
    } as any);

    const createRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        retailPrice: 45.5,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.retailPrice).toBe(45.5);

    // 3. Cashier blocked from updating price via PATCH /api/products/:id/price
    const forbiddenPrice = await request(app)
      .patch('/api/products/prod-1/price')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ retailPrice: 48.0 });
    expect(forbiddenPrice.status).toBe(403);

    // 4. Admin updates price via PATCH /api/products/:id/price
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({ id: 'prod-1' } as any);
    vi.mocked(prisma.product.update).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      retailPrice: new Prisma.Decimal(48.0),
      minStockAlert: 10,
      batches: [],
    } as any);

    const priceRes = await request(app)
      .patch('/api/products/prod-1/price')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ retailPrice: 48.0 });
    expect(priceRes.status).toBe(200);
    expect(priceRes.body.data.retailPrice).toBe(48.0);
  });

  it('GET /api/products/search supports fast barcode lookup (?barcode=) and case-insensitive name search (?q=) with costPrice stripped for CASHIER', async () => {
    const mockProductWithBatch = {
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      weightUnit: 'لتر',
      retailPrice: new Prisma.Decimal(45.5),
      minStockAlert: 5,
      batches: [
        {
          id: 'batch-1',
          productId: 'prod-1',
          batchNumber: 'B-2026-01',
          costPrice: new Prisma.Decimal(38.0),
          quantity: 20,
          expiryDate: new Date('2026-12-01'),
        },
      ],
    };

    // Barcode lookup by CASHIER
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(mockProductWithBatch as any);
    const barcodeRes = await request(app)
      .get('/api/products/search?barcode=6221000001')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(barcodeRes.status).toBe(200);
    expect(barcodeRes.body.count).toBe(1);
    expect(barcodeRes.body.data[0].totalStock).toBe(20);
    expect(barcodeRes.body.data[0].batches[0].costPrice).toBeUndefined();

    // Name search (?q=) by ADMIN
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([mockProductWithBatch] as any);
    const queryRes = await request(app)
      .get('/api/products/search?q=جهينة')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.data[0].batches[0].costPrice).toBe(38);
  });

  it('deductProductStockFIFO(productId, quantityToDeduct, tx) decrements oldest batch first and rolls over to next batch when exhausted', async () => {
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'batch-oldest',
        productId: 'prod-1',
        batchNumber: 'B-2026-11',
        costPrice: new Prisma.Decimal(35.0),
        quantity: 4,
        expiryDate: new Date('2026-11-15T00:00:00.000Z'),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: 'batch-newer',
        productId: 'prod-1',
        batchNumber: 'B-2026-12',
        costPrice: new Prisma.Decimal(38.0),
        quantity: 10,
        expiryDate: new Date('2026-12-20T00:00:00.000Z'),
        createdAt: new Date('2026-10-15T00:00:00.000Z'),
      },
    ]);

    // Deduct 7 units inside transaction: should take all 4 from batch-oldest (leaving 0) and 3 from batch-newer (leaving 7)
    const result = await prisma.$transaction(async (tx) => {
      return ProductService.deductProductStockFIFO('prod-1', 7, tx);
    });

    expect(result.totalDeducted).toBe(7);
    expect(result.remainingTotalStock).toBe(7);
    expect(result.allocations).toHaveLength(2);

    expect(result.allocations[0]).toMatchObject({
      batchId: 'batch-oldest',
      deductedQuantity: 4,
      remainingBatchQuantity: 0,
    });
    expect(result.allocations[1]).toMatchObject({
      batchId: 'batch-newer',
      deductedQuantity: 3,
      remainingBatchQuantity: 7,
    });

    expect(prisma.productBatch.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'batch-oldest' },
      data: { quantity: 0 },
    });
    expect(prisma.productBatch.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'batch-newer' },
      data: { quantity: 7 },
    });
  });

  it('GET /api/inventory/expiring?days=30 returns batches expiring within threshold with calculated remaining stock', async () => {
    const soonDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'batch-exp-1',
        productId: 'prod-1',
        batchNumber: 'B-EXP-15',
        costPrice: new Prisma.Decimal(35.0),
        quantity: 12,
        expiryDate: soonDate,
        createdAt: new Date(),
        product: {
          id: 'prod-1',
          barcode: '6221000001',
          name: 'جبنة عبور لاند 500 جم',
          retailPrice: new Prisma.Decimal(42.0),
          weightUnit: 'علبة',
          batches: [{ quantity: 12 }, { quantity: 18 }],
        },
      },
    ] as any);

    const res = await request(app)
      .get('/api/inventory/expiring?days=30')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(30);
    expect(res.body.data[0].remainingBatchStock).toBe(12);
    expect(res.body.data[0].calculatedRemainingStock).toBe(30);
    expect(res.body.data[0].alertBucket).toBe('30_DAYS');
  });
});

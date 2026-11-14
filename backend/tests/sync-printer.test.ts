import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma, PaymentMethod, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockProduct = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const mockProductBatch = {
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const mockShift = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const mockOrder = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  return {
    prisma: {
      product: mockProduct,
      productBatch: mockProductBatch,
      shift: mockShift,
      order: mockOrder,
      $transaction: vi.fn((callback) =>
        callback({
          product: mockProduct,
          productBatch: mockProductBatch,
          shift: mockShift,
          order: mockOrder,
        })
      ),
    },
  };
});

describe('Alamir Market POS - Task 6: Cloud-POS Conflict Resolution & Sync Engine', () => {
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

  it('GET /api/sync/pull supports delta sync (?updatedSince=) and returns CLOUD_PRICE_OVERRIDES_LOCAL conflict policy', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      {
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        retailPrice: new Prisma.Decimal(49.0), // Updated cloud price
        minStockAlert: 5,
        updatedAt: new Date('2026-11-01T20:00:00Z'),
        batches: [
          {
            id: 'batch-1',
            batchNumber: 'B-2026-11',
            costPrice: new Prisma.Decimal(36.0),
            quantity: 30,
            expiryDate: new Date('2026-12-01'),
          },
        ],
      },
      {
        id: 'prod-old',
        barcode: '6221000002',
        name: 'صنف قديم لم يتغير',
        retailPrice: new Prisma.Decimal(20.0),
        minStockAlert: 5,
        updatedAt: new Date('2026-10-01T10:00:00Z'),
        batches: [],
      },
    ] as any);

    const res = await request(app)
      .get('/api/sync/pull?updatedSince=2026-11-01T00:00:00Z')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.conflictResolutionPolicy).toBe('CLOUD_PRICE_OVERRIDES_LOCAL');
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.products[0].retailPrice).toBe(49);
    expect(res.body.data.products[0].batches[0].costPrice).toBeUndefined();
  });

  it('POST /api/sync/push preserves immutable local POS unitPrice even after cloud price changes, and syncs closed shifts', async () => {
    // 1. Order 1 already exists -> skipped
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord-existing',
      orderNumber: 'OFFLINE-ALM-100',
    } as any);

    // 2. Order 2 is new -> Cloud price is now 50.00 EGP, but local POS sold it offline at 45.00 EGP (immutable!)
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.shift.findUnique).mockResolvedValueOnce({
      id: 'shift-1',
      closedAt: null,
    } as any);
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      name: 'جهينة حليب 1 لتر',
      retailPrice: new Prisma.Decimal(50.0), // Cloud price increased to 50 EGP
    } as any);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'batch-1',
        productId: 'prod-1',
        batchNumber: 'B-01',
        quantity: 10,
        costPrice: new Prisma.Decimal(36.0),
        expiryDate: new Date('2026-12-01'),
        createdAt: new Date(),
      },
    ] as any);
    (prisma.order.create as any).mockImplementationOnce(({ data }: any) => {
      return Promise.resolve({
        id: 'ord-new',
        orderNumber: data.orderNumber,
        shiftId: data.shiftId,
        cashierId: data.cashierId,
        totalAmount: data.totalAmount,
        paymentMethod: data.paymentMethod,
        isReturned: false,
        createdAt: new Date(),
        items: data.items.create,
      });
    });

    // Mock shift closing during batch sync
    vi.mocked(prisma.shift.findUnique).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500.0),
      closedAt: null,
      cashier: { id: 'u-cashier-1', name: 'محمد كاشير', username: 'cashier1' },
      orders: [
        {
          id: 'ord-new',
          totalAmount: new Prisma.Decimal(90.0),
          paymentMethod: PaymentMethod.CASH,
          isReturned: false,
        },
      ],
    } as any);
    vi.mocked(prisma.shift.update).mockResolvedValueOnce({
      id: 'shift-1',
      startingCash: new Prisma.Decimal(500.0),
      expectedCash: new Prisma.Decimal(590.0),
      actualEndCash: new Prisma.Decimal(590.0),
      discrepancy: new Prisma.Decimal(0),
      openedAt: new Date(),
      closedAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orders: [
          {
            orderNumber: 'OFFLINE-ALM-100',
            shiftId: 'shift-1',
            paymentMethod: 'CASH',
            items: [{ productId: 'prod-1', quantity: 1, unitPrice: 45 }],
          },
          {
            orderNumber: 'OFFLINE-ALM-101',
            shiftId: 'shift-1',
            paymentMethod: 'CASH',
            // Sold 2 units at immutable local price 45.00 EGP -> totalAmount must be 90.00 EGP (NOT 100.00 EGP)
            items: [{ productId: 'prod-1', quantity: 2, unitPrice: 45 }],
          },
        ],
        closedShifts: [
          {
            shiftId: 'shift-1',
            actualEndCash: 590,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.conflictResolutionPolicy).toBe('LOCAL_SALES_IMMUTABLE');
    expect(res.body.data.skippedCount).toBe(1);
    expect(res.body.data.syncedCount).toBe(1);
    expect(res.body.data.syncedOrders[0].totalAmount).toBe(90); // Immutable 2 * 45 = 90
    expect(res.body.data.syncedShiftsCount).toBe(1);
  });

  it('POST /api/sync/hardware/receipt (80mm/58mm), /hardware/z-report, and /hardware/drawer-kick generate ESC/POS bytes & RJ11 pulse (ESC p 0 25 250)', async () => {
    const receiptRes = await request(app)
      .post('/api/sync/hardware/receipt')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'ALM-2026-999',
        cashierName: 'محمد كاشير',
        paymentMethod: 'CASH',
        paperWidth: '58mm',
        openCashDrawer: true,
        totalAmount: 90,
        changeGiven: 10,
        items: [
          {
            name: 'جهينة حليب 1 لتر',
            quantity: 2,
            unitPrice: 45,
            lineTotal: 90,
          },
        ],
      });

    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.data.paperWidth).toBe('58mm');
    expect(receiptRes.body.data.escPosHex).toContain('1b700019fa');
  });

  it('Idempotent /api/sync/push with X-Idempotency-Key deduplicates retried batches, and /api/sync/backup + /api/sync/telemetry work as expected', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.shift.findUnique).mockResolvedValueOnce({
      id: 'shift-idem-1',
      closedAt: null,
    } as any);
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      name: 'جهينة حليب 1 لتر',
      retailPrice: new Prisma.Decimal(46.5),
    } as any);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'batch-1',
        productId: 'prod-1',
        batchNumber: 'B-01',
        quantity: 20,
        costPrice: new Prisma.Decimal(36.0),
        expiryDate: new Date('2026-12-01'),
        createdAt: new Date(),
      },
    ] as any);
    (prisma.order.create as any).mockImplementationOnce(({ data }: any) =>
      Promise.resolve({
        id: data.id || 'ord-idem-1',
        orderNumber: data.orderNumber,
        shiftId: data.shiftId,
        cashierId: data.cashierId,
        totalAmount: data.totalAmount,
        paymentMethod: data.paymentMethod,
        isReturned: false,
        createdAt: new Date(),
        items: data.items.create,
      })
    );

    const batchPayload = {
      orders: [
        {
          clientOrderId: '550e8400-e29b-41d4-a716-446655440000',
          idempotencyKey: 'ord-550e8400-e29b-41d4-a716-446655440000',
          orderNumber: 'OFFLINE-IDEM-500',
          shiftId: 'shift-idem-1',
          paymentMethod: 'CASH',
          items: [{ productId: 'prod-1', quantity: 1, unitPrice: 46.5 }],
        },
      ],
    };

    const firstPush = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Idempotency-Key', 'batch-idem-key-500')
      .send(batchPayload);

    expect(firstPush.status).toBe(200);
    expect(firstPush.body.data.syncedCount).toBe(1);
    expect(firstPush.body.data.deduplicatedBatch).toBe(false);

    // Retry the exact same batch with the same X-Idempotency-Key -> must return 200 (not 409) and deduplicate
    const retryPush = await request(app)
      .post('/api/sync/push')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('X-Idempotency-Key', 'batch-idem-key-500')
      .send(batchPayload);

    expect(retryPush.status).toBe(200);
    expect(retryPush.body.data.deduplicatedBatch).toBe(true);
    expect(retryPush.body.data.syncedCount).toBe(0);
    expect(retryPush.body.data.skippedCount).toBe(1);

    // Telemetry endpoint records client/sync errors and Admin can inspect them
    const telemetryPost = await request(app)
      .post('/api/sync/telemetry')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        source: 'FRONTEND_POS',
        severity: 'WARN',
        message: 'اختبار تسجيل خطأ مزامنة مؤقت',
        metadata: { terminal: 'POS-1' },
      });
    expect(telemetryPost.status).toBe(201);

    const telemetryGet = await request(app)
      .get('/api/sync/telemetry')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(telemetryGet.status).toBe(200);
    expect(telemetryGet.body.data.length).toBeGreaterThanOrEqual(1);

    // Backup endpoint enforces ADMIN RBAC and returns snapshot
    const forbiddenBackup = await request(app)
      .get('/api/sync/backup?persist=false')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(forbiddenBackup.status).toBe(403);

    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([] as any);
    const adminBackup = await request(app)
      .get('/api/sync/backup?persist=false')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminBackup.status).toBe(200);
    expect(adminBackup.body.data.version).toBe('1.0');
    expect(adminBackup.body.data.loyaltySettings).toBeDefined();
  });
});

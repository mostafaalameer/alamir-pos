import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma, PaymentMethod, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockShift = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockProduct = {
    findUnique: vi.fn(),
  };
  const mockProductBatch = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const mockOrder = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  return {
    prisma: {
      shift: mockShift,
      product: mockProduct,
      productBatch: mockProductBatch,
      order: mockOrder,
      $transaction: vi.fn((callback) =>
        callback({
          shift: mockShift,
          product: mockProduct,
          productBatch: mockProductBatch,
          order: mockOrder,
        })
      ),
    },
  };
});

describe('Alamir Market POS - Task 3: Cashier Shift Sessions & Checkout Transactions', () => {
  const cashierToken = jwt.sign(
    { userId: 'u-cashier-1', username: 'cashier1', role: Role.CASHIER },
    env.JWT_SECRET
  );
  const adminToken = jwt.sign(
    { userId: 'u-admin-1', username: 'admin', role: Role.ADMIN },
    env.JWT_SECRET
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/shifts/open opens a shift, prevents multiple active shifts (409), and GET /api/shifts/active returns active shift', async () => {
    // 1. Open shift succeeds
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.shift.create).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500),
      actualEndCash: null,
      expectedCash: null,
      discrepancy: null,
      openedAt: new Date(),
      closedAt: null,
    });

    const openRes = await request(app)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ startingCash: 500 });

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.startingCash).toBe(500);

    // 2. Prevent opening multiple active shifts for the same cashier
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      closedAt: null,
    } as any);

    const dupRes = await request(app)
      .post('/api/shifts/open')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ startingCash: 300 });
    expect(dupRes.status).toBe(409);

    // 3. GET /api/shifts/active returns active shift
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500),
      closedAt: null,
      orders: [],
    } as any);

    const activeRes = await request(app)
      .get('/api/shifts/active')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.id).toBe('shift-1');
    expect(activeRes.body.data.startingCash).toBe(500);
  });

  it('POST /api/orders deducts inventory via deductProductStockFIFO and snapshots unitPrice & costPrice on OrderItem', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500),
      closedAt: null,
    } as any);

    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-milk',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      retailPrice: new Prisma.Decimal(45.0),
    } as any);

    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'batch-old',
        productId: 'prod-milk',
        batchNumber: 'B-OLD',
        costPrice: new Prisma.Decimal(36.0),
        quantity: 3,
        expiryDate: new Date('2026-11-10'),
        createdAt: new Date('2026-10-01'),
      },
      {
        id: 'batch-new',
        productId: 'prod-milk',
        batchNumber: 'B-NEW',
        costPrice: new Prisma.Decimal(39.0),
        quantity: 10,
        expiryDate: new Date('2026-12-25'),
        createdAt: new Date('2026-10-15'),
      },
    ]);

    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: 'ord-1',
      orderNumber: 'ALM-1001',
      shiftId: 'shift-1',
      cashierId: 'u-cashier-1',
      totalAmount: new Prisma.Decimal(225.0),
      paymentMethod: PaymentMethod.CASH,
      isReturned: false,
      createdAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId: 'ord-1',
          productId: 'prod-milk',
          quantity: 3,
          unitPrice: new Prisma.Decimal(45.0),
          costPrice: new Prisma.Decimal(36.0),
          product: { id: 'prod-milk', name: 'جهينة حليب كامل الدسم 1 لتر', barcode: '6221000001' },
        },
        {
          id: 'item-2',
          orderId: 'ord-1',
          productId: 'prod-milk',
          quantity: 2,
          unitPrice: new Prisma.Decimal(45.0),
          costPrice: new Prisma.Decimal(39.0),
          product: { id: 'prod-milk', name: 'جهينة حليب كامل الدسم 1 لتر', barcode: '6221000001' },
        },
      ],
    } as any);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        paymentMethod: 'CASH',
        items: [{ productId: 'prod-milk', quantity: 5 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(225);
    expect(prisma.productBatch.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'batch-old' },
      data: { quantity: 0 },
    });
    expect(prisma.productBatch.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'batch-new' },
      data: { quantity: 8 },
    });
  });

  it('POST /api/orders rolls back transaction completely when one product in the cart lacks stock (no items deducted, no order recorded)', async () => {
    // Stateful in-memory batch store to prove atomic transaction rollback
    const statefulBatches: Record<string, Array<{ id: string; quantity: number; costPrice: Prisma.Decimal; expiryDate: Date; createdAt: Date }>> = {
      'prod-1': [
        {
          id: 'b-1',
          quantity: 10,
          costPrice: new Prisma.Decimal(30),
          expiryDate: new Date('2026-12-01'),
          createdAt: new Date(),
        },
      ],
      'prod-2': [
        {
          id: 'b-2',
          quantity: 2, // Only 2 in stock, cart will ask for 5!
          costPrice: new Prisma.Decimal(50),
          expiryDate: new Date('2026-12-01'),
          createdAt: new Date(),
        },
      ],
    };

    let recordedOrdersCount = 0;

    // Simulate atomic database transaction with snapshot rollback on error
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback: any) => {
      const snapshot = JSON.parse(JSON.stringify(statefulBatches));
      const txClient = {
        shift: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'shift-1',
            cashierId: 'u-cashier-1',
            closedAt: null,
          }),
        },
        product: {
          findUnique: vi.fn(({ where }: any) =>
            Promise.resolve({
              id: where.id,
              name: where.id === 'prod-1' ? 'أرز الضحى' : 'زيت عافية',
              retailPrice: new Prisma.Decimal(40),
            })
          ),
        },
        productBatch: {
          findMany: vi.fn(({ where }: any) =>
            Promise.resolve(statefulBatches[where.productId] || [])
          ),
          update: vi.fn(({ where, data }: any) => {
            for (const list of Object.values(statefulBatches)) {
              const found = list.find((b) => b.id === where.id);
              if (found) found.quantity = data.quantity;
            }
            return Promise.resolve({});
          }),
        },
        order: {
          create: vi.fn(() => {
            recordedOrdersCount++;
            return Promise.resolve({});
          }),
        },
      };

      try {
        return await callback(txClient);
      } catch (err) {
        // Atomic DB rollback restores batch quantities
        statefulBatches['prod-1'][0].quantity = snapshot['prod-1'][0].quantity;
        statefulBatches['prod-2'][0].quantity = snapshot['prod-2'][0].quantity;
        throw err;
      }
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        paymentMethod: 'CASH',
        items: [
          { productId: 'prod-1', quantity: 4 }, // Succeeds first inside loop
          { productId: 'prod-2', quantity: 5 }, // Fails (only 2 available) -> triggers rollback!
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    // Verify prod-1 stock was rolled back to 10 and no order was created
    expect(statefulBatches['prod-1'][0].quantity).toBe(10);
    expect(statefulBatches['prod-2'][0].quantity).toBe(2);
    expect(recordedOrdersCount).toBe(0);
  });

  it('POST /api/orders/:id/return marks order as returned, restores batches, and logs against active shift', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord-1',
      orderNumber: 'ALM-1001',
      shiftId: 'shift-old',
      isReturned: false,
      items: [
        {
          id: 'item-1',
          productId: 'prod-milk',
          quantity: 3,
          unitPrice: new Prisma.Decimal(45.0),
          costPrice: new Prisma.Decimal(36.0),
        },
      ],
    } as any);

    vi.mocked(prisma.productBatch.findFirst).mockResolvedValueOnce({
      id: 'batch-old',
      productId: 'prod-milk',
      costPrice: new Prisma.Decimal(36.0),
      quantity: 0,
    } as any);

    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-active-now',
      cashierId: 'u-admin-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.order.update).mockResolvedValueOnce({
      id: 'ord-1',
      orderNumber: 'ALM-1001',
      shiftId: 'shift-active-now',
      cashierId: 'u-cashier-1',
      totalAmount: new Prisma.Decimal(135.0),
      paymentMethod: PaymentMethod.CASH,
      isReturned: true,
      createdAt: new Date(),
      items: [
        {
          id: 'item-1',
          productId: 'prod-milk',
          quantity: 3,
          unitPrice: new Prisma.Decimal(45.0),
          costPrice: new Prisma.Decimal(36.0),
          product: { id: 'prod-milk', name: 'جهينة حليب كامل الدسم 1 لتر', barcode: '6221000001' },
        },
      ],
    } as any);

    const res = await request(app)
      .post('/api/orders/ord-1/return')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isReturned).toBe(true);
    expect(res.body.data.shiftId).toBe('shift-active-now');
    expect(prisma.productBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-old' },
      data: { quantity: 3 },
    });
  });

  it('POST /api/shifts/close calculates totalCashSales, totalCardSales, totalReturns, expectedCash = startingCash + totalCashSales - cashReturns, and discrepancy', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500.0),
      closedAt: null,
      cashier: { id: 'u-cashier-1', name: 'محمد كاشير', username: 'cashier1' },
      orders: [
        {
          id: 'ord-1',
          totalAmount: new Prisma.Decimal(300.0),
          paymentMethod: PaymentMethod.CASH,
          isReturned: false,
        },
        {
          id: 'ord-2',
          totalAmount: new Prisma.Decimal(150.0),
          paymentMethod: PaymentMethod.CARD,
          isReturned: false,
        },
        {
          id: 'ord-3',
          totalAmount: new Prisma.Decimal(80.0),
          paymentMethod: PaymentMethod.CASH,
          isReturned: true, // Cash return of 80 -> totalCashSales = 380, cashReturns = 80, expectedCash = 500 + 380 - 80 = 800
        },
      ],
    } as any);

    vi.mocked(prisma.shift.update).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500.0),
      expectedCash: new Prisma.Decimal(800.0),
      actualEndCash: new Prisma.Decimal(785.0),
      discrepancy: new Prisma.Decimal(-15.0),
      openedAt: new Date(),
      closedAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/api/shifts/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ actualEndCash: 785.0 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalCashSales).toBe(380);
    expect(res.body.data.totalCardSales).toBe(150);
    expect(res.body.data.totalReturns).toBe(80);
    expect(res.body.data.expectedCash).toBe(800);
    expect(res.body.data.actualEndCash).toBe(785);
    expect(res.body.data.discrepancy).toBe(-15);
  });
});

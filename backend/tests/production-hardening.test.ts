import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma, PaymentMethod, Role } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockUser = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockAuditLog = {
    create: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockProduct = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockProductBatch = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockOrder = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockOrderItem = {
    update: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockShift = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockCashMovement = {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockCustomer = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockLoyaltySetting = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockLoyaltyTransaction = {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockWalletTransaction = {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const mockCreditTransaction = {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };

  const txClient = {
    user: mockUser,
    auditLog: mockAuditLog,
    product: mockProduct,
    productBatch: mockProductBatch,
    order: mockOrder,
    orderItem: mockOrderItem,
    shift: mockShift,
    cashMovement: mockCashMovement,
    customer: mockCustomer,
    loyaltySetting: mockLoyaltySetting,
    loyaltyTransaction: mockLoyaltyTransaction,
    walletTransaction: mockWalletTransaction,
    creditTransaction: mockCreditTransaction,
    $executeRawUnsafe: vi.fn(),
  };

  return {
    prisma: {
      ...txClient,
      $transaction: vi.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(txClient)
      ),
    },
  };
});

describe('Alamir Market POS - Production Hardening, Partial Returns & Backup', () => {
  const originalManagerPin = env.MANAGER_PIN;
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
    env.MANAGER_PIN = originalManagerPin;
  });

  afterEach(() => {
    env.MANAGER_PIN = originalManagerPin;
  });

  it('POST /api/auth/verify-pin strictly enforces env.MANAGER_PIN without hardcoded 1234 backdoor and logs AuditLog', async () => {
    env.MANAGER_PIN = '9876';

    // Default 1234 must be rejected when custom MANAGER_PIN is configured
    const backdoorAttempt = await request(app)
      .post('/api/auth/verify-pin')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ pin: '1234', action: 'PRICE_OVERRIDE', details: 'Attempted bypass' });

    expect(backdoorAttempt.status).toBe(403);
    expect(backdoorAttempt.body.authorized).toBe(false);

    // Valid custom PIN succeeds and creates auditLog
    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({
      id: 'audit-1',
      action: 'PRICE_OVERRIDE',
      cashierId: 'u-cashier-1',
      authorizedBy: 'SUPERVISOR_PIN',
      details: 'Approved discount',
      createdAt: new Date(),
    } as any);

    const validAttempt = await request(app)
      .post('/api/auth/verify-pin')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ pin: '9876', action: 'PRICE_OVERRIDE', details: 'Approved discount' });

    expect(validAttempt.status).toBe(200);
    expect(validAttempt.body.authorized).toBe(true);
    expect(validAttempt.body.data.auditLogId).toBe('audit-1');
  });

  it('PATCH /api/auth/users/:id and GET /api/auth/audit-logs enforce ADMIN RBAC', async () => {
    const forbiddenUpdate = await request(app)
      .patch('/api/auth/users/u-cashier-1')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'محاولة غير مصرح بها' });
    expect(forbiddenUpdate.status).toBe(403);

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'u-cashier-1',
      name: 'محمد',
      username: 'cashier1',
      password: 'old',
      role: Role.CASHIER,
      createdAt: new Date(),
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({
      id: 'u-cashier-1',
      name: 'محمد أحمد',
      username: 'cashier1',
      role: Role.CASHIER,
      createdAt: new Date(),
    } as any);

    const updateRes = await request(app)
      .patch('/api/auth/users/u-cashier-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'محمد أحمد', password: 'newpassword123' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('محمد أحمد');

    const forbiddenLogs = await request(app)
      .get('/api/auth/audit-logs')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(forbiddenLogs.status).toBe(403);

    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { id: 'audit-1', action: 'PRICE_OVERRIDE', createdAt: new Date() },
    ] as any);
    const logsRes = await request(app)
      .get('/api/auth/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.count).toBe(1);
  });

  it('POST /api/orders/:id/return handles partial item returns without marking the whole order returned', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord-partial-1',
      orderNumber: 'ALM-000120',
      shiftId: 'shift-1',
      paymentMethod: PaymentMethod.CASH,
      totalAmount: new Prisma.Decimal(150.0),
      isReturned: false,
      customerId: null,
      items: [
        {
          id: 'oi-1',
          productId: 'prod-1',
          quantity: 3,
          returnedQuantity: 0,
          unitPrice: new Prisma.Decimal(50.0),
          costPrice: new Prisma.Decimal(35.0),
        },
      ],
    } as any);

    vi.mocked(prisma.productBatch.findFirst).mockResolvedValueOnce({
      id: 'batch-1',
      productId: 'prod-1',
      costPrice: new Prisma.Decimal(35.0),
      quantity: 5,
    } as any);

    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-admin-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.order.update).mockResolvedValueOnce({
      id: 'ord-partial-1',
      orderNumber: 'ALM-000120',
      shiftId: 'shift-1',
      cashierId: 'u-cashier-1',
      totalAmount: new Prisma.Decimal(150.0),
      paymentMethod: PaymentMethod.CASH,
      isReturned: false,
      createdAt: new Date(),
      items: [
        {
          id: 'oi-1',
          productId: 'prod-1',
          quantity: 3,
          returnedQuantity: 1,
          unitPrice: new Prisma.Decimal(50.0),
          costPrice: new Prisma.Decimal(35.0),
          product: { id: 'prod-1', name: 'أرز مصري 1 كجم', barcode: '6220001' },
        },
      ],
    } as any);

    const res = await request(app)
      .post('/api/orders/ord-partial-1/return')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        refundMethod: 'CASH',
        returnedItems: [{ orderItemId: 'oi-1', quantity: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.isReturned).toBe(false);
    expect(res.body.data.hasPartialReturn).toBe(true);
    expect(res.body.data.returnedTotalAmount).toBe(50);
    expect(prisma.productBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { quantity: 6 },
    });
    expect(prisma.orderItem.update).toHaveBeenCalledWith({
      where: { id: 'oi-1' },
      data: { returnedQuantity: 1 },
    });
  });

  it('POST /api/orders/:id/return decrements customer creditBalance and logs ADJUSTMENT for CREDIT orders', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      id: 'ord-credit-1',
      orderNumber: 'ALM-000121',
      shiftId: 'shift-1',
      paymentMethod: PaymentMethod.CREDIT,
      totalAmount: new Prisma.Decimal(200.0),
      isReturned: false,
      customerId: 'cust-1',
      pointsEarned: 0,
      pointsRedeemed: 0,
      walletAmountUsed: new Prisma.Decimal(0),
      items: [
        {
          id: 'oi-2',
          productId: 'prod-1',
          quantity: 4,
          returnedQuantity: 0,
          unitPrice: new Prisma.Decimal(50.0),
          costPrice: new Prisma.Decimal(40.0),
        },
      ],
    } as any);

    vi.mocked(prisma.productBatch.findFirst).mockResolvedValueOnce({
      id: 'batch-1',
      productId: 'prod-1',
      costPrice: new Prisma.Decimal(40.0),
      quantity: 2,
    } as any);

    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
      id: 'cust-1',
      pointsBalance: 0,
      walletBalance: new Prisma.Decimal(0),
      creditBalance: new Prisma.Decimal(300.0),
    } as any);

    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-admin-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.order.update).mockResolvedValueOnce({
      id: 'ord-credit-1',
      orderNumber: 'ALM-000121',
      shiftId: 'shift-1',
      cashierId: 'u-cashier-1',
      customerId: 'cust-1',
      totalAmount: new Prisma.Decimal(200.0),
      paymentMethod: PaymentMethod.CREDIT,
      isReturned: false,
      createdAt: new Date(),
      items: [
        {
          id: 'oi-2',
          productId: 'prod-1',
          quantity: 4,
          returnedQuantity: 2,
          unitPrice: new Prisma.Decimal(50.0),
          costPrice: new Prisma.Decimal(40.0),
          product: { id: 'prod-1', name: 'زيت طعام 1 لتر', barcode: '6220002' },
        },
      ],
    } as any);

    const res = await request(app)
      .post('/api/orders/ord-credit-1/return')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        refundMethod: 'CASH',
        returnedItems: [{ orderItemId: 'oi-2', quantity: 2 }],
      });

    expect(res.status).toBe(200);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        data: expect.objectContaining({
          creditBalance: new Prisma.Decimal('200.00'),
        }),
      })
    );
    expect(prisma.creditTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          orderId: 'ord-credit-1',
          type: 'ADJUSTMENT',
          amount: new Prisma.Decimal('-100.00'),
          balanceAfter: new Prisma.Decimal('200.00'),
        }),
      })
    );
  });

  it('GET /api/reports/pnl and POST /api/shifts/close accurately subtract partial returns from revenue, COGS & expectedCash', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([
      {
        id: 'ord-partial-pnl',
        orderNumber: 'ALM-000200',
        totalAmount: new Prisma.Decimal(200.0),
        isReturned: false,
        items: [
          {
            quantity: 4,
            returnedQuantity: 1,
            unitPrice: new Prisma.Decimal(50.0),
            costPrice: new Prisma.Decimal(35.0),
          },
        ],
      },
    ] as any);

    const pnlRes = await request(app)
      .get('/api/reports/pnl')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(pnlRes.status).toBe(200);
    expect(pnlRes.body.data.validOrdersCount).toBe(1);
    expect(pnlRes.body.data.returnedOrdersCount).toBe(1);
    expect(pnlRes.body.data.returnedOrdersValue).toBe(50);
    expect(pnlRes.body.data.grossRevenue).toBe(150);
    expect(pnlRes.body.data.totalCostOfGoodsSold).toBe(105);
    expect(pnlRes.body.data.netProfit).toBe(45);

    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-partial',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal(500.0),
      closedAt: null,
      cashier: { id: 'u-cashier-1', name: 'محمد كاشير', username: 'cashier1' },
      cashMovements: [
        { id: 'cm-1', type: 'CASH_IN', amount: new Prisma.Decimal(100), reason: 'فكة', createdAt: new Date() },
        { id: 'cm-2', type: 'CASH_OUT', amount: new Prisma.Decimal(25), reason: 'مناديل', createdAt: new Date() },
      ],
      orders: [
        {
          id: 'ord-partial-pnl',
          totalAmount: new Prisma.Decimal(200.0),
          paymentMethod: PaymentMethod.CASH,
          isReturned: false,
          items: [
            {
              quantity: 4,
              returnedQuantity: 1,
              unitPrice: new Prisma.Decimal(50.0),
            },
          ],
        },
      ],
    } as any);

    vi.mocked(prisma.shift.update).mockResolvedValueOnce({
      id: 'shift-partial',
      startingCash: new Prisma.Decimal(500.0),
      expectedCash: new Prisma.Decimal(725.0),
      actualEndCash: new Prisma.Decimal(725.0),
      discrepancy: new Prisma.Decimal(0),
      openedAt: new Date(),
      closedAt: new Date(),
    } as any);

    const closeRes = await request(app)
      .post('/api/shifts/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ actualEndCash: 725 });

    // Expected cash = 500 (start) + 200 (gross cash) - 50 (partial cash return) + 100 (CASH_IN) - 25 (CASH_OUT) = 725
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.totalReturns).toBe(50);
    expect(closeRes.body.data.cashReturns).toBe(50);
    expect(closeRes.body.data.expectedCash).toBe(725);
    expect(closeRes.body.data.discrepancy).toBe(0);
  });

  it('POST /api/shifts/cash-movement & GET /api/shifts/:id/movements record and list cash drawer movements', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.cashMovement.create).mockResolvedValueOnce({
      id: 'cm-100',
      shiftId: 'shift-1',
      cashierId: 'u-cashier-1',
      type: 'CASH_OUT',
      amount: new Prisma.Decimal(75.5),
      reason: 'مصاريف نظافة',
      createdAt: new Date(),
    } as any);

    const postRes = await request(app)
      .post('/api/shifts/cash-movement')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ type: 'CASH_OUT', amount: 75.5, reason: 'مصاريف نظافة' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.data.amount).toBe(75.5);

    vi.mocked(prisma.cashMovement.findMany).mockResolvedValueOnce([
      {
        id: 'cm-100',
        shiftId: 'shift-1',
        cashierId: 'u-cashier-1',
        type: 'CASH_OUT',
        amount: new Prisma.Decimal(75.5),
        reason: 'مصاريف نظافة',
        createdAt: new Date(),
      },
    ] as any);

    const getRes = await request(app)
      .get('/api/shifts/shift-1/movements')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toHaveLength(1);
    expect(getRes.body.data[0].amount).toBe(75.5);
  });

  it('GET /api/backup/export and POST /api/backup/restore enforce ADMIN RBAC, validate format, and restore atomically', async () => {
    const forbiddenExport = await request(app)
      .get('/api/backup/export')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(forbiddenExport.status).toBe(403);

    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([{ id: 'u-1' }] as any);
    vi.mocked(prisma.loyaltySetting.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.customer.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([{ id: 'p-1' }] as any);
    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.shift.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.loyaltyTransaction.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.walletTransaction.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.creditTransaction.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.cashMovement.findMany).mockResolvedValueOnce([] as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([] as any);

    const exportRes = await request(app)
      .get('/api/backup/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(exportRes.status).toBe(200);
    expect(exportRes.body.data.format).toBe('alamir-pos-full-backup');
    expect(exportRes.body.data.counts.products).toBe(1);

    // Invalid restore payload returns 400
    const badRestore = await request(app)
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ format: 'wrong-format' });
    expect(badRestore.status).toBe(400);

    // Valid restore executes inside $transaction
    const restoreRes = await request(app)
      .post('/api/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        format: 'alamir-pos-full-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        tables: {
          users: [],
          loyaltySettings: [],
          customers: [],
          products: [
            {
              id: 'p-1',
              barcode: '6221234',
              name: 'منتج تجريبي',
              retailPrice: 25,
            },
          ],
          productBatches: [],
          shifts: [],
          orders: [],
          orderItems: [],
          loyaltyTransactions: [],
          walletTransactions: [],
          creditTransactions: [],
          cashMovements: [],
          auditLogs: [],
        },
      });

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.restoredCounts.products).toBe(1);
    expect(prisma.product.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'DATABASE_RESTORE',
        }),
      })
    );
  });
});

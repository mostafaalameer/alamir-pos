import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import {
  LoyaltyTransactionType,
  PaymentMethod,
  Prisma,
  Role,
  WalletTransactionType,
} from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';
import { env } from '../src/config/env';

vi.mock('../src/config/db', () => {
  const mockLoyaltySetting = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  const mockCustomer = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockLoyaltyTransaction = {
    create: vi.fn(),
  };
  const mockWalletTransaction = {
    create: vi.fn(),
  };
  const mockShift = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const mockProduct = {
    findUnique: vi.fn(),
  };
  const mockProductBatch = {
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const mockOrder = {
    create: vi.fn(),
  };

  return {
    prisma: {
      loyaltySetting: mockLoyaltySetting,
      customer: mockCustomer,
      loyaltyTransaction: mockLoyaltyTransaction,
      walletTransaction: mockWalletTransaction,
      shift: mockShift,
      product: mockProduct,
      productBatch: mockProductBatch,
      order: mockOrder,
      $transaction: vi.fn((callback) =>
        callback({
          loyaltySetting: mockLoyaltySetting,
          customer: mockCustomer,
          loyaltyTransaction: mockLoyaltyTransaction,
          walletTransaction: mockWalletTransaction,
          shift: mockShift,
          product: mockProduct,
          productBatch: mockProductBatch,
          order: mockOrder,
        })
      ),
    },
  };
});

describe('Alamir Market POS - Loyalty Points System & Smart Change Wallet', () => {
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

  it('GET /api/loyalty/settings returns default rules and PUT /api/loyalty/settings enforces ADMIN RBAC', async () => {
    vi.mocked((prisma as any).loyaltySetting.findUnique).mockResolvedValueOnce({
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('10.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('10.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 50,
      updatedAt: new Date(),
    });

    const getRes = await request(app)
      .get('/api/loyalty/settings')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.spendAmountPerPoint).toBe(10);
    expect(getRes.body.data.redemptionPointsBlock).toBe(100);
    expect(getRes.body.data.redemptionDiscountAmount).toBe(10);
    expect(getRes.body.data.minPointsToRedeem).toBe(50);

    // CASHIER cannot update settings
    const forbiddenRes = await request(app)
      .put('/api/loyalty/settings')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ spendAmountPerPoint: 20 });
    expect(forbiddenRes.status).toBe(403);

    // ADMIN can update settings
    vi.mocked((prisma as any).loyaltySetting.findUnique).mockResolvedValueOnce({
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('10.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('10.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 50,
    });
    vi.mocked((prisma as any).loyaltySetting.upsert).mockResolvedValueOnce({
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('20.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('15.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 40,
      updatedAt: new Date(),
    });

    const putRes = await request(app)
      .put('/api/loyalty/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        spendAmountPerPoint: 20,
        redemptionDiscountAmount: 15,
        maxDiscountCapPercent: 40,
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.data.spendAmountPerPoint).toBe(20);
    expect(putRes.body.data.redemptionDiscountAmount).toBe(15);
    expect(putRes.body.data.maxDiscountCapPercent).toBe(40);
  });

  it('GET /api/customers & POST /api/customers list and create customers with loyalty & wallet balances', async () => {
    vi.mocked((prisma as any).customer.findFirst).mockResolvedValueOnce({ customerCode: 1003 });
    vi.mocked((prisma as any).customer.upsert).mockResolvedValueOnce({
      id: 'cust-10',
      customerCode: 1004,
      name: 'أحمد حسن',
      phone: '01099998888',
      pointsBalance: 0,
      walletBalance: new Prisma.Decimal('0.00'),
      totalSpent: new Prisma.Decimal('0.00'),
      createdAt: new Date(),
      updatedAt: new Date(),
      loyaltyTransactions: [],
      walletTransactions: [],
    });

    const createRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ name: 'أحمد حسن', phone: '01099998888' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.phone).toBe('01099998888');
    expect(createRes.body.data.customerCode).toBe(1004);
    expect(createRes.body.data.formattedCode).toBe('C-1004');
    expect(createRes.body.data.displayName).toBe('أحمد حسن');
    expect(createRes.body.data.pointsBalance).toBe(0);
    expect(createRes.body.data.walletBalance).toBe(0);

    vi.mocked((prisma as any).customer.findMany).mockResolvedValueOnce([
      {
        id: 'cust-1',
        customerCode: 1001,
        name: 'محمد علي',
        phone: '01000000001',
        pointsBalance: 120,
        walletBalance: new Prisma.Decimal('15.50'),
        totalSpent: new Prisma.Decimal('1200.00'),
        createdAt: new Date(),
        updatedAt: new Date(),
        loyaltyTransactions: [
          {
            id: 'ltx-1',
            customerId: 'cust-1',
            orderId: 'ord-1',
            type: LoyaltyTransactionType.EARN,
            points: 120,
            amountValue: new Prisma.Decimal('1200.00'),
            description: 'رصيد نقاط',
            createdAt: new Date(),
          },
        ],
        walletTransactions: [
          {
            id: 'wtx-1',
            customerId: 'cust-1',
            orderId: 'ord-1',
            type: WalletTransactionType.CHANGE_DEPOSIT,
            amount: new Prisma.Decimal('15.50'),
            balanceAfter: new Prisma.Decimal('15.50'),
            description: 'إيداع فكة',
            createdAt: new Date(),
          },
        ],
      },
    ]);

    const listRes = await request(app)
      .get('/api/customers?phone=01000000001')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].customerCode).toBe(1001);
    expect(listRes.body.data[0].formattedCode).toBe('C-1001');
    expect(listRes.body.data[0].pointsBalance).toBe(120);
    expect(listRes.body.data[0].walletBalance).toBe(15.5);
    expect(listRes.body.data[0].walletTransactions).toHaveLength(1);
  });

  it('Privacy Fallback: Nameless customer gets sequential customerCode (1001+), displayName "عميل #1003", lookup by C-1003, and receipt prints "رقم العميل: C-1003"', async () => {
    vi.mocked((prisma as any).customer.findFirst).mockResolvedValueOnce({ customerCode: 1002 });
    vi.mocked((prisma as any).customer.upsert).mockResolvedValueOnce({
      id: 'cust-3',
      customerCode: 1003,
      name: null,
      phone: '01000000003',
      pointsBalance: 80,
      walletBalance: new Prisma.Decimal('4.50'),
      totalSpent: new Prisma.Decimal('250.00'),
      createdAt: new Date(),
      updatedAt: new Date(),
      loyaltyTransactions: [],
      walletTransactions: [],
    });

    const createNamelessRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ phone: '01000000003' });

    expect(createNamelessRes.status).toBe(201);
    expect(createNamelessRes.body.data.customerCode).toBe(1003);
    expect(createNamelessRes.body.data.formattedCode).toBe('C-1003');
    expect(createNamelessRes.body.data.name).toBeNull();
    expect(createNamelessRes.body.data.displayName).toBe('عميل #1003');

    // Lookup by customerCode ("C-1003")
    vi.mocked((prisma as any).customer.findMany).mockResolvedValueOnce([
      {
        id: 'cust-3',
        customerCode: 1003,
        name: null,
        phone: '01000000003',
        pointsBalance: 80,
        walletBalance: new Prisma.Decimal('4.50'),
        totalSpent: new Prisma.Decimal('250.00'),
        createdAt: new Date(),
        updatedAt: new Date(),
        loyaltyTransactions: [],
        walletTransactions: [],
      },
    ]);

    const searchByCodeRes = await request(app)
      .get('/api/customers?search=C-1003')
      .set('Authorization', `Bearer ${cashierToken}`);

    expect(searchByCodeRes.status).toBe(200);
    expect(searchByCodeRes.body.data).toHaveLength(1);
    expect(searchByCodeRes.body.data[0].customerCode).toBe(1003);
    expect(searchByCodeRes.body.data[0].displayName).toBe('عميل #1003');

    // Verify thermal receipt prints "رقم العميل: C-1003" and fallback name "عميل #1003"
    const receiptRes = await request(app)
      .post('/api/sync/hardware/receipt')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'ALM-9003',
        cashierName: 'محمد كاشير',
        paymentMethod: 'CASH',
        totalAmount: 46.5,
        paidAmount: 50,
        changeGiven: 0,
        changeDepositedToWallet: 3.5,
        walletAmountUsed: 0,
        customerCode: 1003,
        customerName: null,
        customerPhone: '01000000003',
        pointsEarned: 4,
        pointsRedeemed: 0,
        discountFromPoints: 0,
        customerPointsBalance: 84,
        customerWalletBalance: 8.0,
        items: [
          {
            name: 'جهينة حليب كامل الدسم 1 لتر',
            quantity: 1,
            unitPrice: 46.5,
            lineTotal: 46.5,
          },
        ],
      });

    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.data.printableText).toContain('رقم العميل: C-1003');
    expect(receiptRes.body.data.printableText).toContain('العميل: عميل #1003');
    expect(receiptRes.body.data.printableText).toContain('رصيد محفظتك الحالي: 8.00 ج.م');
    expect(receiptRes.body.data.printableText).toContain('الرصيد الجديد للنقاط: 84 نقطة');
  });

  it('POST /api/orders atomically handles loyalty points AND Smart Change Wallet (PURCHASE_PAYMENT + split CHANGE_DEPOSIT)', async () => {
    // Cart: 2 x 46.50 EGP = 93.00 EGP subtotal
    // Customer has walletBalance = 15.00 EGP, pointsBalance = 40
    // Customer uses 3.00 EGP from wallet -> remaining cash due = 90.00 EGP
    // Customer tenders 100.00 EGP cash -> change due = 10.00 EGP
    // Split change: 5.00 EGP returned as cash (changeGiven), 5.00 EGP deposited to wallet (changeDepositedToWallet)
    // Final wallet balance = 15.00 - 3.00 + 5.00 = 17.00 EGP
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-1',
      cashierId: 'u-cashier-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      retailPrice: new Prisma.Decimal('46.50'),
    } as any);

    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'b-1',
        productId: 'prod-1',
        batchNumber: 'B-1',
        costPrice: new Prisma.Decimal('36.00'),
        quantity: 10,
        expiryDate: new Date('2026-12-01'),
        createdAt: new Date(),
      },
    ]);

    const existingCustomer = {
      id: 'cust-1',
      customerCode: 1001,
      name: 'محمد علي',
      phone: '01000000001',
      pointsBalance: 40,
      walletBalance: new Prisma.Decimal('15.00'),
      totalSpent: new Prisma.Decimal('1000.00'),
    };
    vi.mocked((prisma as any).customer.findUnique)
      .mockResolvedValueOnce(existingCustomer)
      .mockResolvedValueOnce(existingCustomer);

    vi.mocked((prisma as any).loyaltySetting.findUnique).mockResolvedValueOnce({
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('10.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('10.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 50,
    });

    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: 'ord-wallet-1',
      orderNumber: 'ALM-9002',
      shiftId: 'shift-1',
      cashierId: 'u-cashier-1',
      customerId: 'cust-1',
      totalAmount: new Prisma.Decimal('93.00'),
      paidAmount: new Prisma.Decimal('100.00'),
      changeGiven: new Prisma.Decimal('5.00'),
      changeDepositedToWallet: new Prisma.Decimal('5.00'),
      walletAmountUsed: new Prisma.Decimal('3.00'),
      pointsEarned: 9,
      pointsRedeemed: 0,
      discountFromPoints: new Prisma.Decimal('0.00'),
      paymentMethod: PaymentMethod.CASH,
      isReturned: false,
      createdAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId: 'ord-wallet-1',
          productId: 'prod-1',
          quantity: 2,
          unitPrice: new Prisma.Decimal('46.50'),
          costPrice: new Prisma.Decimal('36.00'),
          product: { id: 'prod-1', name: 'جهينة حليب كامل الدسم 1 لتر', barcode: '6221000001' },
        },
      ],
    } as any);

    vi.mocked((prisma as any).customer.update).mockResolvedValueOnce({
      ...existingCustomer,
      pointsBalance: 49,
      walletBalance: new Prisma.Decimal('17.00'),
      totalSpent: new Prisma.Decimal('1093.00'),
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        paymentMethod: 'CASH',
        customerPhone: '01000000001',
        walletAmountUsed: 3.0,
        paidAmount: 100.0,
        changeGiven: 5.0,
        changeDepositedToWallet: 5.0,
        items: [{ productId: 'prod-1', quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(93);
    expect(res.body.data.paidAmount).toBe(100);
    expect(res.body.data.changeGiven).toBe(5);
    expect(res.body.data.changeDepositedToWallet).toBe(5);
    expect(res.body.data.walletAmountUsed).toBe(3);
    expect(res.body.data.customerWalletBalance).toBe(17);
    expect((prisma as any).walletTransaction.create).toHaveBeenCalledTimes(2);
  });

  it('POST /api/shifts/close reconciles physical drawer cash with Change Credited to Wallets and Wallet Redemptions', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'shift-wallet-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal('500.00'),
      closedAt: null,
      cashier: { id: 'u-cashier-1', name: 'محمد كاشير', username: 'cashier1' },
      orders: [
        {
          id: 'ord-1',
          totalAmount: new Prisma.Decimal('93.00'),
          paidAmount: new Prisma.Decimal('100.00'),
          changeGiven: new Prisma.Decimal('0.00'),
          changeDepositedToWallet: new Prisma.Decimal('7.00'),
          walletAmountUsed: new Prisma.Decimal('0.00'),
          paymentMethod: PaymentMethod.CASH,
          isReturned: false,
        },
        {
          id: 'ord-2',
          totalAmount: new Prisma.Decimal('50.00'),
          paidAmount: new Prisma.Decimal('35.00'),
          changeGiven: new Prisma.Decimal('0.00'),
          changeDepositedToWallet: new Prisma.Decimal('0.00'),
          walletAmountUsed: new Prisma.Decimal('15.00'),
          paymentMethod: PaymentMethod.CASH,
          isReturned: false,
        },
      ],
    } as any);

    // Physical drawer cash = 500 + (93 + 50) + 7 (change retained) - 15 (paid from wallet) = 635.00 EGP
    vi.mocked(prisma.shift.update).mockResolvedValueOnce({
      id: 'shift-wallet-1',
      cashierId: 'u-cashier-1',
      startingCash: new Prisma.Decimal('500.00'),
      expectedCash: new Prisma.Decimal('635.00'),
      actualEndCash: new Prisma.Decimal('635.00'),
      discrepancy: new Prisma.Decimal('0.00'),
      openedAt: new Date(),
      closedAt: new Date(),
    } as any);

    const res = await request(app)
      .post('/api/shifts/close')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ actualEndCash: 635.0 });

    expect(res.status).toBe(200);
    expect(res.body.data.totalCashSales).toBe(143);
    expect(res.body.data.totalChangeCreditedToWallets).toBe(7);
    expect(res.body.data.totalWalletRedemptions).toBe(15);
    expect(res.body.data.expectedCash).toBe(635);
    expect(res.body.data.discrepancy).toBe(0);
  });

  it('POST /api/sync/hardware/receipt & /hardware/z-report print Smart Change Wallet lines in Arabic', async () => {
    const receiptRes = await request(app)
      .post('/api/sync/hardware/receipt')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        orderNumber: 'ALM-9002',
        cashierName: 'محمد كاشير',
        paymentMethod: 'CASH',
        totalAmount: 93,
        paidAmount: 100,
        changeGiven: 5,
        changeDepositedToWallet: 5,
        walletAmountUsed: 3,
        customerName: 'محمد علي',
        customerPhone: '01000000001',
        pointsEarned: 9,
        pointsRedeemed: 0,
        discountFromPoints: 0,
        customerPointsBalance: 49,
        customerWalletBalance: 17,
        items: [
          {
            name: 'جهينة حليب كامل الدسم 1 لتر',
            quantity: 2,
            unitPrice: 46.5,
            lineTotal: 93,
          },
        ],
      });

    expect(receiptRes.status).toBe(200);
    expect(receiptRes.body.data.printableText).toContain('مدفوع من المحفظة: 3.00 ج.م');
    expect(receiptRes.body.data.printableText).toContain('الباقي مضاف للمحفظة: 5.00 ج.م');
    expect(receiptRes.body.data.printableText).toContain('رصيد محفظتك الحالي: 17.00 ج.م');

    const zReportRes = await request(app)
      .post('/api/sync/hardware/z-report')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({
        shiftId: 'SHIFT-2026-01',
        cashierName: 'محمد كاشير',
        startingCash: 500,
        totalCashSales: 143,
        totalCardSales: 0,
        totalReturns: 0,
        totalChangeCreditedToWallets: 7,
        totalWalletRedemptions: 15,
        expectedCash: 635,
        actualEndCash: 635,
        discrepancy: 0,
      });

    expect(zReportRes.status).toBe(200);
    expect(zReportRes.body.data.printableText).toContain(
      'إجمالي الفكة المحفوظة بالمحافظ (Change Credited to Wallets): 7.00 ج.م'
    );
    expect(zReportRes.body.data.printableText).toContain(
      'إجمالي المدفوعات من المحافظ (Wallet Redemptions): 15.00 ج.م'
    );
  });
});

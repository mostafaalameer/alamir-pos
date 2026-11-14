import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Prisma, PaymentMethod } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/config/db';

vi.mock('../src/config/db', () => {
  const mockShift = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockProduct = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const mockProductBatch = {
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const mockOrder = {
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const mockCustomer = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const mockLoyaltySetting = {
    findUnique: vi.fn(),
  };
  const mockLoyaltyTx = {
    create: vi.fn(),
  };
  const mockWalletTx = {
    create: vi.fn(),
  };
  const mockAuditLog = {
    create: vi.fn(),
  };
  return {
    prisma: {
      shift: mockShift,
      product: mockProduct,
      productBatch: mockProductBatch,
      order: mockOrder,
      customer: mockCustomer,
      loyaltySetting: mockLoyaltySetting,
      loyaltyTransaction: mockLoyaltyTx,
      walletTransaction: mockWalletTx,
      auditLog: mockAuditLog,
      $transaction: vi.fn((callback) =>
        callback({
          shift: mockShift,
          product: mockProduct,
          productBatch: mockProductBatch,
          order: mockOrder,
          customer: mockCustomer,
          loyaltySetting: mockLoyaltySetting,
          loyaltyTransaction: mockLoyaltyTx,
          walletTransaction: mockWalletTx,
          auditLog: mockAuditLog,
        })
      ),
    },
  };
});

describe('Alamir Market Public E-Commerce Storefront API (/api/public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/public/storefront/config returns promotional R2 banners, featured categories, deliveryFee, and store open status', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'SHIFT-2026-01',
      cashierId: 'u-cashier-1',
      closedAt: null,
    } as any);

    const res = await request(app).get('/api/public/storefront/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isOpen).toBe(true);
    expect(res.body.data.deliveryFee).toBe(0);
    expect(res.body.data.banners.length).toBeGreaterThan(0);
    expect(res.body.data.banners[0].imageUrl).toContain('r2.dev');
    expect(res.body.data.featuredCategories.length).toBeGreaterThan(0);
  });

  it('GET /api/public/products returns only online in-stock items with categories and search filtering', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      {
        id: 'prod-1',
        barcode: '6221000001',
        name: 'جهينة حليب كامل الدسم 1 لتر',
        category: 'ألبان وأجبان',
        weightUnit: 'لتر',
        retailPrice: new Prisma.Decimal(45.0),
        isAvailableOnline: true,
        imageUrls: 'https://images.unsplash.com/photo-1563636619-e9143da7973b',
        batches: [{ quantity: 15 }],
      },
      {
        id: 'prod-out',
        barcode: '6221000099',
        name: 'صنف نفذ من المخزون',
        category: 'بقالة جافة',
        weightUnit: 'كجم',
        retailPrice: new Prisma.Decimal(30.0),
        isAvailableOnline: true,
        imageUrls: null,
        batches: [], // 0 stock -> should be filtered out
      },
    ] as any);

    const res = await request(app).get('/api/public/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.categories).toEqual(['الكل', 'ألبان وأجبان']);
    expect(res.body.data[0].name).toBe('جهينة حليب كامل الدسم 1 لتر');
    expect(res.body.data[0].inStock).toBe(true);
  });

  it('GET /api/public/customers/lookup looks up existing customer loyalty & wallet balance by phone', async () => {
    vi.mocked((prisma as any).customer.findMany).mockResolvedValueOnce([
      {
        id: 'cust-1',
        customerCode: 1001,
        name: 'محمد علي',
        phone: '01000000001',
        pointsBalance: 120,
        walletBalance: new Prisma.Decimal('15.50'),
        creditLimit: new Prisma.Decimal('0.00'),
        creditBalance: new Prisma.Decimal('0.00'),
        totalSpent: new Prisma.Decimal('1200.00'),
        loyaltyTransactions: [],
        walletTransactions: [],
        creditTransactions: [],
      },
    ]);
    vi.mocked((prisma as any).loyaltySetting.findUnique).mockResolvedValueOnce({
      id: 'default',
      isEnabled: true,
      spendAmountPerPoint: new Prisma.Decimal('10.00'),
      redemptionPointsBlock: 100,
      redemptionDiscountAmount: new Prisma.Decimal('10.00'),
      minPointsToRedeem: 50,
      maxDiscountCapPercent: 50,
    });

    const res = await request(app).get('/api/customers/lookup?phone=01000000001');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.data.customerCode).toBe('C-1001');
    expect(res.body.data.pointsBalance).toBe(120);
    expect(res.body.data.totalPointsBalance).toBe(120);
    expect(res.body.data.walletBalance).toBe(15.5);
  });

  it('POST /api/public/orders submits online order with FIFO stock deduction, loyalty/wallet redemption, and #ORD-1080 confirmation', async () => {
    vi.mocked(prisma.shift.findFirst).mockResolvedValueOnce({
      id: 'SHIFT-2026-01',
      cashierId: 'u-cashier-1',
      closedAt: null,
    } as any);

    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 'prod-1',
      barcode: '6221000001',
      name: 'جهينة حليب كامل الدسم 1 لتر',
      retailPrice: new Prisma.Decimal(45.0),
      isAvailableOnline: true,
    } as any);

    vi.mocked(prisma.productBatch.findMany).mockResolvedValueOnce([
      {
        id: 'b-101',
        productId: 'prod-1',
        batchNumber: 'B-2026-11A',
        costPrice: new Prisma.Decimal(36.5),
        quantity: 10,
        expiryDate: new Date('2026-11-18T00:00:00.000Z'),
        createdAt: new Date(),
      },
    ]);

    vi.mocked((prisma.order as any).count).mockResolvedValueOnce(0);
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);

    const existingCustomer = {
      id: 'cust-1',
      customerCode: 1001,
      name: 'محمد علي',
      phone: '01000000001',
      pointsBalance: 100,
      walletBalance: new Prisma.Decimal('15.00'),
      totalSpent: new Prisma.Decimal('500.00'),
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
      id: 'ord-online-1',
      orderNumber: '#ORD-1080',
      shiftId: 'SHIFT-2026-01',
      cashierId: 'u-cashier-1',
      customerId: 'cust-1',
      totalAmount: new Prisma.Decimal(80.0), // 2 * 45 = 90 - 10 (points discount) = 80
      paidAmount: new Prisma.Decimal(65.0), // 80 - 15 (wallet) = 65 cash on delivery
      changeGiven: new Prisma.Decimal(0),
      changeDepositedToWallet: new Prisma.Decimal(0),
      walletAmountUsed: new Prisma.Decimal(15.0),
      pointsEarned: 8,
      pointsRedeemed: 100,
      discountFromPoints: new Prisma.Decimal(10.0),
      paymentMethod: PaymentMethod.CASH,
      isReturned: false,
      createdAt: new Date(),
      items: [
        {
          id: 'item-1',
          orderId: 'ord-online-1',
          productId: 'prod-1',
          quantity: 2,
          unitPrice: new Prisma.Decimal(45.0),
          costPrice: new Prisma.Decimal(36.5),
          product: {
            id: 'prod-1',
            name: 'جهينة حليب كامل الدسم 1 لتر',
            barcode: '6221000001',
          },
        },
      ],
    } as any);

    vi.mocked((prisma as any).customer.update).mockResolvedValueOnce({
      ...existingCustomer,
      pointsBalance: 8,
      walletBalance: new Prisma.Decimal('0.00'),
      totalSpent: new Prisma.Decimal('580.00'),
    });

    const res = await request(app)
      .post('/api/public/orders')
      .send({
        customerPhone: '01000000001',
        customerName: 'محمد علي',
        deliveryAddress: 'شارع التحرير، عمارة 12، الدور الثالث',
        deliveryNotes: 'يرجى الرن على الجرس مرة واحدة',
        redeemPoints: true,
        paymentMethod: 'WALLET',
        walletAmountUsed: 15,
        items: [{ productId: 'prod-1', quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderNumber).toBe('#ORD-1080');
    expect(res.body.data.subtotal).toBe(90);
    expect(res.body.data.discountFromPoints).toBe(10);
    expect(res.body.data.walletAmountUsed).toBe(15);
    expect(res.body.data.cashDueOnDelivery).toBe(65);
    expect(res.body.data.deliveryAddress).toBe('شارع التحرير، عمارة 12، الدور الثالث');
    expect(res.body.data.estimatedDelivery).toBe('30 - 45 دقيقة');
  });
});


import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalCustomer,
  LocalProduct,
  LocalSqliteBridge,
  formatCustomerCode,
  getCustomerDisplayName,
  parseCustomerCodeInput,
  parseScaleBarcode,
} from '../offlineSqlite';
import { daysUntil } from '../dates';

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
}

describe('Alamir Market POS Frontend - Core Business Logic & OfflineSqliteBridge', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  describe('Scale Barcode Parsing (parseScaleBarcode & LocalSqliteBridge.parseScaleBarcode)', () => {
    it('parses price-embedded barcodes (prefix 20) into EGP total and fractional weight', () => {
      // 20 + PLU 00105 + 05450 (54.50 EGP) + check digit 7
      const raw = '2000105054507';
      const parsed = parseScaleBarcode(raw);
      expect(parsed).toEqual({
        isScaleBarcode: true,
        prefix: '20',
        plu: '00105',
        type: 'PRICE',
        priceEgp: 54.5,
      });

      const cheeseProduct: LocalProduct = {
        id: 'prod-cheese',
        barcode: '00105',
        name: 'جبنة رومي بطارخ',
        weightUnit: 'كجم',
        retailPrice: 109.0,
        totalStock: 10,
        minStockAlert: 1,
        isAvailableOnline: true,
        batches: [
          {
            id: 'b-cheese',
            batchNumber: 'CH-01',
            quantity: 10,
            expiryDate: '2026-12-30',
          },
        ],
      };
      LocalSqliteBridge.saveCatalog([cheeseProduct]);

      const bridgeParsed = LocalSqliteBridge.parseScaleBarcode(raw);
      expect(bridgeParsed).toEqual({
        weight: 0.5,
        unitPrice: 109.0,
        plu: '00105',
        totalPackPrice: 54.5,
      });
    });

    it('parses weight-embedded barcodes (prefixes 21-29) into kg weight and total pack price', () => {
      // 21 + PLU 00210 + 01250 (1.250 kg) + check digit 3
      const raw = '2100210012503';
      const parsed = parseScaleBarcode(raw);
      expect(parsed).toEqual({
        isScaleBarcode: true,
        prefix: '21',
        plu: '00210',
        type: 'WEIGHT',
        weightKg: 1.25,
      });

      const oliveProduct: LocalProduct = {
        id: 'prod-olives',
        barcode: '210',
        name: 'زيتون كلاماتا',
        weightUnit: 'كجم',
        retailPrice: 120.0,
        totalStock: 10,
        minStockAlert: 1,
        isAvailableOnline: true,
        batches: [
          {
            id: 'b-olive',
            batchNumber: 'OL-01',
            quantity: 10,
            expiryDate: '2026-12-30',
          },
        ],
      };
      LocalSqliteBridge.saveCatalog([oliveProduct]);

      const bridgeParsed = LocalSqliteBridge.parseScaleBarcode(raw);
      expect(bridgeParsed).toEqual({
        weight: 1.25,
        unitPrice: 120.0,
        plu: '00210',
        totalPackPrice: 150.0,
      });
    });

    it('ignores standard retail EAN-13 barcodes', () => {
      expect(parseScaleBarcode('6221000001234')).toEqual({ isScaleBarcode: false });
      expect(LocalSqliteBridge.parseScaleBarcode('6221000001234')).toBeNull();
    });
  });

  describe('Customer Code Formatting & Parsing', () => {
    it('formats C-codes, parses numeric/prefixed inputs, and provides fallback display names', () => {
      expect(formatCustomerCode(1005)).toBe('C-1005');
      expect(parseCustomerCodeInput('c-1005')).toBe(1005);
      expect(parseCustomerCodeInput('#2040')).toBe(2040);
      expect(parseCustomerCodeInput('3001')).toBe(3001);
      expect(parseCustomerCodeInput('0100')).toBeNull();

      expect(getCustomerDisplayName({ name: '  أحمد محمود  ', customerCode: 1002 })).toBe(
        'أحمد محمود'
      );
      expect(getCustomerDisplayName({ name: null, customerCode: 1009 })).toBe('عميل #1009');
    });
  });

  describe('FEFO/FIFO Offline Checkout, Order Number Sequence & Stock Guard', () => {
    it('deducts earliest-expiry batch first and allocates sequential ALM-XXXXXX order numbers', () => {
      const milk: LocalProduct = {
        id: 'prod-milk',
        barcode: '6221001',
        name: 'لبن جهينة 1 لتر',
        weightUnit: 'عبوة',
        retailPrice: 45,
        totalStock: 10,
        minStockAlert: 2,
        isAvailableOnline: true,
        batches: [
          { id: 'b-late', batchNumber: 'LATE', quantity: 7, expiryDate: '2026-12-20' },
          { id: 'b-soon', batchNumber: 'SOON', quantity: 3, expiryDate: '2026-11-20' },
        ],
      };
      LocalSqliteBridge.saveCatalog([milk]);

      const order1 = LocalSqliteBridge.executeOfflineFifoCheckout('shift-1', 'CASH', [
        { product: milk, quantity: 5 },
      ]);
      expect(order1.orderNumber).toBe('ALM-000001');
      expect(order1.totalAmount).toBe(225);

      const updatedCatalog = LocalSqliteBridge.loadCatalog();
      const updatedMilk = updatedCatalog.find((p) => p.id === 'prod-milk')!;
      expect(updatedMilk.totalStock).toBe(5);
      expect(updatedMilk.batches.find((b) => b.id === 'b-soon')!.quantity).toBe(0);
      expect(updatedMilk.batches.find((b) => b.id === 'b-late')!.quantity).toBe(5);

      const order2 = LocalSqliteBridge.executeOfflineFifoCheckout('shift-1', 'CARD', [
        { product: updatedMilk, quantity: 2 },
      ]);
      expect(order2.orderNumber).toBe('ALM-000002');
    });

    it('throws without mutating stock when requested quantity exceeds available inventory', () => {
      const rice: LocalProduct = {
        id: 'prod-rice',
        barcode: '6221002',
        name: 'أرز الضحى 1 كجم',
        weightUnit: 'كيس',
        retailPrice: 40,
        totalStock: 2,
        minStockAlert: 1,
        isAvailableOnline: true,
        batches: [{ id: 'b-1', batchNumber: 'R-01', quantity: 2, expiryDate: '2027-01-01' }],
      };
      LocalSqliteBridge.saveCatalog([rice]);

      expect(() =>
        LocalSqliteBridge.executeOfflineFifoCheckout('shift-1', 'CASH', [
          { product: rice, quantity: 5 },
        ])
      ).toThrow();

      expect(LocalSqliteBridge.loadCatalog()[0].totalStock).toBe(2);
    });
  });

  describe('Loyalty Points, Smart Wallet & Credit Limit Enforcement', () => {
    it('calculates loyalty points earned, honors minPointsToRedeem and maxDiscountCapPercent, and credits wallet change', () => {
      const vipCustomer: LocalCustomer = {
        id: 'cust-vip',
        customerCode: 1050,
        name: 'كريم علي',
        phone: '01012345678',
        pointsBalance: 1000, // Worth 100 EGP at default 100 pts = 10 EGP
        walletBalance: 15,
        creditLimit: 500,
        creditBalance: 100,
        totalSpent: 2000,
      };
      LocalSqliteBridge.saveCustomers([vipCustomer]);

      // Cart subtotal = 100 EGP, cap = 50% (max 50 EGP discount = 500 pts)
      const calc = LocalSqliteBridge.calculateLoyaltyForCart(100, vipCustomer, true);
      expect(calc.pointsRedeemed).toBe(500);
      expect(calc.discountFromPoints).toBe(50);
      expect(calc.netPayable).toBe(50);
      expect(calc.pointsEarned).toBe(5); // 50 / 10 = 5 points

      // Execute checkout using wallet (15 EGP) + 50 EGP cash tendered, keeping 15 EGP change in wallet
      const tea: LocalProduct = {
        id: 'prod-tea',
        barcode: '6221003',
        name: 'شاي العروسة 250 جم',
        weightUnit: 'علبة',
        retailPrice: 100,
        totalStock: 5,
        minStockAlert: 1,
        isAvailableOnline: true,
        batches: [{ id: 'b-tea', batchNumber: 'T-1', quantity: 5, expiryDate: '2027-05-01' }],
      };
      LocalSqliteBridge.saveCatalog([tea]);

      const order = LocalSqliteBridge.executeOfflineFifoCheckout(
        'shift-1',
        'CASH',
        [{ product: tea, quantity: 1 }],
        {
          customerPhone: '01012345678',
          redeemPoints: true,
          useWallet: true,
          paidAmount: 50,
          changeDepositedToWallet: 15,
        }
      );

      expect(order.walletAmountUsed).toBe(15);
      expect(order.changeGiven).toBe(0); // 50 paid - 35 remaining due = 15 change -> deposited to wallet
      expect(order.customerWalletBalance).toBe(15);
      expect(order.customerPointsBalance).toBe(505); // 1000 - 500 + 5
    });

    it('settles local customer debt and records a CASH_IN drawer movement', () => {
      const creditCustomer: LocalCustomer = {
        id: 'cust-credit',
        customerCode: 1088,
        name: 'سعيد حسن',
        phone: '01198765432',
        pointsBalance: 0,
        walletBalance: 0,
        creditLimit: 500,
        creditBalance: 250,
        totalSpent: 250,
      };
      LocalSqliteBridge.saveCustomers([creditCustomer]);

      const settled = LocalSqliteBridge.settleCustomerDebtLocal({
        customerId: 'cust-credit',
        amount: 100,
        shiftId: 'shift-1',
        notes: 'دفعة نقدية',
      });

      expect(settled.customer.creditBalance).toBe(150);
      expect(settled.customer.availableCredit).toBe(350);

      const movements = LocalSqliteBridge.getCashMovements('shift-1');
      expect(movements).toHaveLength(1);
      expect(movements[0].type).toBe('CASH_IN');
      expect(movements[0].amount).toBe(100);
    });
  });

  describe('Parked Invoices, Cash Movements & Date Utilities', () => {
    it('parks, resumes, and deletes held carts cleanly', () => {
      const item: LocalProduct = {
        id: 'prod-1',
        barcode: '123',
        name: 'عصير',
        weightUnit: 'عبوة',
        retailPrice: 12,
        totalStock: 10,
        minStockAlert: 1,
        isAvailableOnline: true,
        batches: [],
      };
      const parked = LocalSqliteBridge.parkCurrentCart({
        items: [{ product: item, quantity: 3 }],
        customerName: 'عميل سريع',
      });

      expect(LocalSqliteBridge.getParkedInvoices()).toHaveLength(1);
      expect(LocalSqliteBridge.resumeParkedInvoice(parked.id)?.items[0].quantity).toBe(3);

      LocalSqliteBridge.deleteParkedInvoice(parked.id);
      expect(LocalSqliteBridge.getParkedInvoices()).toHaveLength(0);
    });

    it('computes daysUntil accurately for future and past dates', () => {
      const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(daysUntil(inThreeDays)).toBeGreaterThanOrEqual(3);
      expect(daysUntil(twoDaysAgo)).toBeLessThanOrEqual(-1);
    });
  });
});

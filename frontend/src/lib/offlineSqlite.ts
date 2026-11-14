export interface LocalBatch {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  costPrice?: number;
}

export interface LocalProduct {
  id: string;
  barcode: string;
  name: string;
  category?: string;
  weightUnit: string;
  retailPrice: number;
  totalStock: number;
  minStockAlert: number;
  isAvailableOnline: boolean;
  isWeighted?: boolean;
  updatedAt?: string;
  batches: LocalBatch[];
}

export interface LocalLoyaltySettings {
  id?: string;
  isEnabled: boolean;
  spendAmountPerPoint: number;
  redemptionPointsBlock: number;
  redemptionDiscountAmount: number;
  minPointsToRedeem: number;
  maxDiscountCapPercent: number;
  updatedAt?: string;
}

export interface LocalLoyaltyTransaction {
  id: string;
  customerId: string;
  orderId?: string | null;
  type: 'EARN' | 'REDEEM' | 'ADJUST';
  points: number;
  amountValue: number;
  description?: string | null;
  createdAt: string;
}

export interface LocalWalletTransaction {
  id: string;
  customerId: string;
  orderId?: string | null;
  amount: number;
  balanceAfter: number;
  type: 'CHANGE_DEPOSIT' | 'PURCHASE_PAYMENT' | 'REFUND_CREDIT';
  description?: string | null;
  createdAt: string;
}

export interface LocalCreditTransaction {
  id: string;
  customerId: string;
  orderId?: string | null;
  amount: number;
  balanceAfter: number;
  type: 'PURCHASE_DEBT' | 'SETTLEMENT_PAYMENT' | 'ADJUSTMENT';
  notes?: string | null;
  createdAt: string;
}

export interface LocalCustomer {
  id: string;
  customerCode: number;
  name?: string | null;
  phone: string;
  pointsBalance: number;
  walletBalance: number;
  creditLimit?: number;
  creditBalance?: number;
  availableCredit?: number;
  totalSpent: number;
  synced?: boolean;
  updatedAt?: string;
  loyaltyTransactions?: LocalLoyaltyTransaction[];
  walletTransactions?: LocalWalletTransaction[];
  creditTransactions?: LocalCreditTransaction[];
}

export interface ScaleBarcodeParseResult {
  isScaleBarcode: boolean;
  prefix?: string;
  plu?: string;
  type?: 'PRICE' | 'WEIGHT';
  weightKg?: number;
  priceEgp?: number;
}

export function parseScaleBarcode(raw: string): ScaleBarcodeParseResult {
  const trimmed = raw.trim();
  if (/^(?:20|21|22|23|24|25|26|27|28|29)\d{11}$/.test(trimmed)) {
    const prefix = trimmed.slice(0, 2);
    const plu = trimmed.slice(2, 7);
    const valueDigits = parseInt(trimmed.slice(7, 12), 10);
    if (prefix === '20') {
      return {
        isScaleBarcode: true,
        prefix,
        plu,
        type: 'PRICE',
        priceEgp: Number((valueDigits / 100).toFixed(2)),
      };
    }
    return {
      isScaleBarcode: true,
      prefix,
      plu,
      type: 'WEIGHT',
      weightKg: Number((valueDigits / 1000).toFixed(3)),
    };
  }
  return { isScaleBarcode: false };
}

export function getCustomerDisplayName(
  customer?: { name?: string | null; customerCode?: number | string | null } | null
): string {
  if (!customer) return '';
  const cleanName = typeof customer.name === 'string' ? customer.name.trim() : '';
  if (cleanName.length > 0) {
    return cleanName;
  }
  const code = customer.customerCode ?? 1001;
  return `عميل #${code}`;
}

export function formatCustomerCode(code?: number | string | null): string {
  const num = String(code ?? 1001).replace(/^(?:c-|#)/i, '');
  return `C-${num}`;
}

export function parseCustomerCodeInput(raw?: string | number | null): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const prefixed = trimmed.match(/^(?:c-|#|عميل\s*#?)(\d{3,8})$/i);
  if (prefixed) {
    return Number(prefixed[1]);
  }
  if (/^[1-9]\d{3,5}$/.test(trimmed)) {
    return Number(trimmed);
  }
  return null;
}

export interface OfflineOrderRecord {
  clientOrderId?: string;
  idempotencyKey?: string;
  orderNumber: string;
  shiftId: string;
  paymentMethod: 'CASH' | 'CARD' | 'SPLIT' | 'CREDIT';
  subtotalAmount?: number;
  totalAmount: number;
  paidAmount?: number;
  changeGiven?: number;
  changeDepositedToWallet?: number;
  walletAmountUsed?: number;
  customerId?: string;
  customerCode?: number;
  customerName?: string | null;
  customerPhone?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountFromPoints?: number;
  customerPointsBalance?: number;
  customerWalletBalance?: number;
  createdAt: string;
  synced: boolean;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number; // Immutable local POS snapshot price
  }>;
}

export interface OfflineClosedShiftRecord {
  shiftId: string;
  actualEndCash: number;
  expectedCash: number;
  discrepancy: number;
  totalChangeCreditedToWallets?: number;
  totalWalletRedemptions?: number;
  closedAt: string;
  synced: boolean;
}

export interface ParkedInvoiceRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  customerPhone?: string;
  customerName?: string | null;
  items: Array<{
    product: LocalProduct;
    quantity: number;
  }>;
}

export interface StockAdjustmentAuditRecord {
  id: string;
  productId: string;
  productName: string;
  barcode: string;
  batchId?: string;
  quantityDeducted: number;
  reason: string;
  notes?: string;
  createdAt: string;
}

export interface LocalCashMovement {
  id: string;
  shiftId: string;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: number;
  reason: string;
  createdAt: string;
}

export interface LocalAuditLog {
  id: string;
  action: string;
  cashierId?: string | null;
  authorizedBy: string;
  details?: string;
  createdAt: string;
}

const CATALOG_KEY = 'alamir_sqlite_catalog_v1';
const OFFLINE_QUEUE_KEY = 'alamir_sqlite_offline_orders_v1';
const OFFLINE_SHIFTS_KEY = 'alamir_sqlite_offline_shifts_v1';
const STOCK_ADJUSTMENTS_KEY = 'alamir_sqlite_stock_adjustments_v1';
const PARKED_INVOICES_KEY = 'alamir_sqlite_parked_invoices_v1';
const LOYALTY_SETTINGS_KEY = 'alamir_sqlite_loyalty_settings_v1';
const CUSTOMERS_KEY = 'alamir_sqlite_customers_v1';
const CASH_MOVEMENTS_KEY = 'alamir_sqlite_cash_movements_v1';
const AUDIT_LOGS_KEY = 'alamir_sqlite_audit_logs_v1';
const LOCAL_BACKUP_KEY = 'alamir_sqlite_auto_backup_v1';
const ORDER_SEQUENCE_KEY = 'alamir_sqlite_order_seq_v1';
const IDB_NAME = 'alamir_pos_sqlite_idb';
const IDB_STORE = 'pos_kv_tables';

function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Persistent storage mirror: writes every local POS table to:
 * 1) Tauri native SQLite (`sqlite:alamir_pos.db` via `@tauri-apps/plugin-sql` IPC when running inside Tauri)
 * 2) Browser IndexedDB (`alamir_pos_sqlite_idb`) so POS state survives cache clears
 */
function persistTableToNativeSqliteAndIdb(key: string, jsonValue: string): void {
  try {
    localStorage.setItem(key, jsonValue);
  } catch {
    // Ignore quota errors on localStorage; IndexedDB & Tauri SQLite handle persistence
  }

  // 1. Tauri Native SQLite (`tauri-plugin-sql`) bridge if running inside Tauri desktop container
  const tauriInternals =
    typeof window !== 'undefined'
      ? (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__
      : undefined;
  const invoke = tauriInternals?.invoke || tauriInternals?.core?.invoke;
  if (typeof invoke === 'function') {
    void (async () => {
      try {
        await invoke('plugin:sql|load', { db: 'sqlite:alamir_pos.db' });
        await invoke('plugin:sql|execute', {
          db: 'sqlite:alamir_pos.db',
          query:
            'CREATE TABLE IF NOT EXISTS pos_kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
          values: [],
        });
        await invoke('plugin:sql|execute', {
          db: 'sqlite:alamir_pos.db',
          query:
            'INSERT OR REPLACE INTO pos_kv_store (key, value, updated_at) VALUES ($1, $2, $3)',
          values: [key, jsonValue, new Date().toISOString()],
        });
      } catch {
        // Fallback silently when running in browser mode
      }
    })();
  }

  // 2. IndexedDB mirror so data survives localStorage clears
  if (typeof indexedDB !== 'undefined') {
    try {
      const openReq = indexedDB.open(IDB_NAME, 1);
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({
          key,
          value: jsonValue,
          updatedAt: new Date().toISOString(),
        });
      };
    } catch {
      // Ignore if IndexedDB is unavailable in test environment
    }
  }
}

export const DEFAULT_LOCAL_LOYALTY_SETTINGS: LocalLoyaltySettings = {
  id: 'default',
  isEnabled: true,
  spendAmountPerPoint: 10,
  redemptionPointsBlock: 100,
  redemptionDiscountAmount: 10,
  minPointsToRedeem: 50,
  maxDiscountCapPercent: 50,
};

const DEFAULT_CUSTOMERS: LocalCustomer[] = [
  {
    id: 'cust-1',
    customerCode: 1001,
    name: 'محمد علي (عميل مميز)',
    phone: '01000000001',
    pointsBalance: 120,
    walletBalance: 15.5,
    totalSpent: 1200,
    synced: true,
    loyaltyTransactions: [
      {
        id: 'ltx-seed-1',
        customerId: 'cust-1',
        type: 'EARN',
        points: 120,
        amountValue: 1200,
        description: 'رصيد نقاط افتتاحي للعميل المميز',
        createdAt: new Date().toISOString(),
      },
    ],
    walletTransactions: [
      {
        id: 'wtx-seed-1',
        customerId: 'cust-1',
        type: 'CHANGE_DEPOSIT',
        amount: 15.5,
        balanceAfter: 15.5,
        description: 'رصيد محفظة فكة افتتاحي',
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: 'cust-2',
    customerCode: 1002,
    name: 'سارة محمود',
    phone: '01000000002',
    pointsBalance: 60,
    walletBalance: 7.0,
    totalSpent: 600,
    synced: true,
    loyaltyTransactions: [
      {
        id: 'ltx-seed-2',
        customerId: 'cust-2',
        type: 'EARN',
        points: 60,
        amountValue: 600,
        description: 'رصيد نقاط افتتاحي',
        createdAt: new Date().toISOString(),
      },
    ],
    walletTransactions: [
      {
        id: 'wtx-seed-2',
        customerId: 'cust-2',
        type: 'CHANGE_DEPOSIT',
        amount: 7.0,
        balanceAfter: 7.0,
        description: 'رصيد محفظة فكة افتتاحي',
        createdAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: 'cust-3',
    customerCode: 1003,
    name: null,
    phone: '01000000003',
    pointsBalance: 80,
    walletBalance: 12.0,
    totalSpent: 800,
    synced: true,
    loyaltyTransactions: [
      {
        id: 'ltx-seed-3',
        customerId: 'cust-3',
        type: 'EARN',
        points: 80,
        amountValue: 800,
        description: 'رصيد نقاط للعميل C-1003',
        createdAt: new Date().toISOString(),
      },
    ],
    walletTransactions: [
      {
        id: 'wtx-seed-3',
        customerId: 'cust-3',
        type: 'CHANGE_DEPOSIT',
        amount: 12.0,
        balanceAfter: 12.0,
        description: 'رصيد محفظة فكة للعميل C-1003',
        createdAt: new Date().toISOString(),
      },
    ],
  },
];

const DEFAULT_PRODUCTS: LocalProduct[] = [
  {
    id: 'prod-1',
    barcode: '6221000001',
    name: 'جهينة حليب كامل الدسم 1 لتر',
    category: 'ألبان وأجبان',
    weightUnit: 'لتر',
    retailPrice: 45.0,
    totalStock: 38,
    minStockAlert: 10,
    isAvailableOnline: true,
    batches: [
      {
        id: 'b-101',
        batchNumber: 'B-2026-11A',
        quantity: 8,
        expiryDate: '2026-11-18',
        costPrice: 36.5,
      },
      {
        id: 'b-102',
        batchNumber: 'B-2026-12B',
        quantity: 30,
        expiryDate: '2026-12-28',
        costPrice: 38.0,
      },
    ],
  },
  {
    id: 'prod-2',
    barcode: '6221000002',
    name: 'أرز الضحى مصري فاخر 1 كجم',
    category: 'بقالة جافة',
    weightUnit: 'كجم',
    retailPrice: 36.0,
    totalStock: 50,
    minStockAlert: 15,
    isAvailableOnline: true,
    isWeighted: true,
    batches: [
      {
        id: 'b-201',
        batchNumber: 'B-RICE-01',
        quantity: 50,
        expiryDate: '2027-06-01',
        costPrice: 29.0,
      },
    ],
  },
  {
    id: 'prod-3',
    barcode: '6221000003',
    name: 'جبنة عبور لاند فيتا 500 جم',
    category: 'ألبان وأجبان',
    weightUnit: 'علبة',
    retailPrice: 42.0,
    totalStock: 14,
    minStockAlert: 10,
    isAvailableOnline: true,
    batches: [
      {
        id: 'b-301',
        batchNumber: 'B-CHEESE-09',
        quantity: 14,
        expiryDate: '2026-11-22',
        costPrice: 34.0,
      },
    ],
  },
  {
    id: 'prod-4',
    barcode: '6221000004',
    name: 'زيت عافية ذرة نقي 1.6 لتر',
    category: 'زيوت وسمن',
    weightUnit: 'زجاجة',
    retailPrice: 165.0,
    totalStock: 4,
    minStockAlert: 6,
    isAvailableOnline: false,
    batches: [
      {
        id: 'b-401',
        batchNumber: 'B-OIL-04',
        quantity: 4,
        expiryDate: '2027-03-15',
        costPrice: 142.0,
      },
    ],
  },
  {
    id: 'prod-scale-101',
    barcode: '00101',
    name: 'جبنة رومي قديمة فاخرة (ميزان)',
    category: 'أجبان ومقبلات',
    weightUnit: 'كجم',
    retailPrice: 380.0,
    totalStock: 35,
    minStockAlert: 5,
    isAvailableOnline: false,
    isWeighted: true,
    batches: [
      {
        id: 'b-scale-101',
        batchNumber: 'B-ROUMI-01',
        quantity: 35,
        expiryDate: '2027-05-01',
        costPrice: 310.0,
      },
    ],
  },
  {
    id: 'prod-scale-102',
    barcode: '00102',
    name: 'جبنة قريش فلاحي طازجة (ميزان)',
    category: 'ألبان وأجبان',
    weightUnit: 'كجم',
    retailPrice: 120.0,
    totalStock: 25,
    minStockAlert: 5,
    isAvailableOnline: false,
    isWeighted: true,
    batches: [
      {
        id: 'b-scale-102',
        batchNumber: 'B-QURAISH-01',
        quantity: 25,
        expiryDate: '2026-11-25',
        costPrice: 95.0,
      },
    ],
  },
  {
    id: 'prod-scale-103',
    barcode: '00103',
    name: 'لانشون بقري بالزيتون (ميزان)',
    category: 'لحوم ومصنعات',
    weightUnit: 'كجم',
    retailPrice: 240.0,
    totalStock: 20,
    minStockAlert: 4,
    isAvailableOnline: false,
    isWeighted: true,
    batches: [
      {
        id: 'b-scale-103',
        batchNumber: 'B-LUNCHEON-01',
        quantity: 20,
        expiryDate: '2026-12-10',
        costPrice: 190.0,
      },
    ],
  },
  {
    id: 'prod-scale-104',
    barcode: '00104',
    name: 'تفاح أحمر سكري إيطالي (ميزان)',
    category: 'خضار وفاكهة',
    weightUnit: 'كجم',
    retailPrice: 65.0,
    totalStock: 60,
    minStockAlert: 10,
    isAvailableOnline: false,
    isWeighted: true,
    batches: [
      {
        id: 'b-scale-104',
        batchNumber: 'B-APPLE-01',
        quantity: 60,
        expiryDate: '2026-11-28',
        costPrice: 50.0,
      },
    ],
  },
];

const LEGACY_SEED_PRODUCT_IDS = new Set([
  'prod-1',
  'prod-2',
  'prod-3',
  'prod-4',
  'prod-scale-101',
  'prod-scale-102',
  'prod-scale-103',
  'prod-scale-104',
]);

const LEGACY_SEED_BARCODES = new Set([
  '6221000001',
  '6221000002',
  '6221000003',
  '6221000004',
  '00101',
  '00102',
  '00103',
  '00104',
]);

function isTestEnv(): boolean {
  return Boolean((import.meta as any).env?.VITEST || (import.meta as any).env?.MODE === 'test');
}

export class LocalSqliteBridge {
  static loadCatalog(): LocalProduct[] {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) {
      if (isTestEnv()) {
        localStorage.setItem(CATALOG_KEY, JSON.stringify(DEFAULT_PRODUCTS));
        return DEFAULT_PRODUCTS;
      }
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as LocalProduct[];
      if (isTestEnv()) {
        return parsed;
      }
      // Purge any legacy hardcoded seed products from browser storage so only real DB products appear
      const cleaned = parsed.filter(
        (p) => !LEGACY_SEED_PRODUCT_IDS.has(p.id) && !LEGACY_SEED_BARCODES.has(p.barcode)
      );
      if (cleaned.length !== parsed.length) {
        persistTableToNativeSqliteAndIdb(CATALOG_KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    } catch {
      return isTestEnv() ? DEFAULT_PRODUCTS : [];
    }
  }

  static saveCatalog(products: LocalProduct[]): void {
    persistTableToNativeSqliteAndIdb(CATALOG_KEY, JSON.stringify(products));
  }

  static loadLoyaltySettings(): LocalLoyaltySettings {
    const raw = localStorage.getItem(LOYALTY_SETTINGS_KEY);
    if (!raw) {
      localStorage.setItem(
        LOYALTY_SETTINGS_KEY,
        JSON.stringify(DEFAULT_LOCAL_LOYALTY_SETTINGS)
      );
      return { ...DEFAULT_LOCAL_LOYALTY_SETTINGS };
    }
    try {
      return {
        ...DEFAULT_LOCAL_LOYALTY_SETTINGS,
        ...(JSON.parse(raw) as LocalLoyaltySettings),
      };
    } catch {
      return { ...DEFAULT_LOCAL_LOYALTY_SETTINGS };
    }
  }

  static saveLoyaltySettings(settings: LocalLoyaltySettings): LocalLoyaltySettings {
    const merged: LocalLoyaltySettings = {
      ...DEFAULT_LOCAL_LOYALTY_SETTINGS,
      ...settings,
      isEnabled: Boolean(settings.isEnabled),
      spendAmountPerPoint: Number(settings.spendAmountPerPoint),
      redemptionPointsBlock: Number(settings.redemptionPointsBlock),
      redemptionDiscountAmount: Number(settings.redemptionDiscountAmount),
      minPointsToRedeem: Number(settings.minPointsToRedeem),
      maxDiscountCapPercent: Number(settings.maxDiscountCapPercent),
    };
    persistTableToNativeSqliteAndIdb(LOYALTY_SETTINGS_KEY, JSON.stringify(merged));
    return merged;
  }

  static loadCustomers(): LocalCustomer[] {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    if (!raw) {
      localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(DEFAULT_CUSTOMERS));
      return DEFAULT_CUSTOMERS;
    }
    try {
      const parsed = JSON.parse(raw) as LocalCustomer[];
      let nextFallbackCode = 1001;
      return parsed.map((c) => {
        const assignedCode =
          typeof c.customerCode === 'number' && c.customerCode >= 1001
            ? c.customerCode
            : nextFallbackCode++;
        if (assignedCode >= nextFallbackCode) {
          nextFallbackCode = assignedCode + 1;
        }
        return {
          ...c,
          customerCode: assignedCode,
          name:
            typeof c.name === 'string' && c.name.trim().length > 0
              ? c.name.trim()
              : null,
          pointsBalance: Number(c.pointsBalance ?? 0),
          walletBalance: Number(c.walletBalance ?? 0),
          totalSpent: Number(c.totalSpent ?? 0),
        };
      });
    } catch {
      return DEFAULT_CUSTOMERS;
    }
  }

  static saveCustomers(customers: LocalCustomer[]): void {
    persistTableToNativeSqliteAndIdb(CUSTOMERS_KEY, JSON.stringify(customers));
  }

  static getNextLocalCustomerCode(customersList?: LocalCustomer[]): number {
    const list = customersList ?? this.loadCustomers();
    const maxCode = list.reduce(
      (max, c) => Math.max(max, Number(c.customerCode ?? 1000)),
      1000
    );
    return Math.max(1001, maxCode + 1);
  }

  static applyCloudCustomersOverride(cloudCustomers: LocalCustomer[]): LocalCustomer[] {
    const localList = this.loadCustomers();
    const byPhone = new Map<string, LocalCustomer>();

    for (const c of localList) {
      byPhone.set(c.phone.trim(), c);
    }
    for (const cloudCust of cloudCustomers) {
      const existing = byPhone.get(cloudCust.phone.trim());
      byPhone.set(cloudCust.phone.trim(), {
        ...existing,
        ...cloudCust,
        customerCode: Number(
          cloudCust.customerCode ?? existing?.customerCode ?? 1001
        ),
        name:
          typeof cloudCust.name === 'string' && cloudCust.name.trim().length > 0
            ? cloudCust.name.trim()
            : null,
        pointsBalance: Number(cloudCust.pointsBalance ?? existing?.pointsBalance ?? 0),
        walletBalance: Number(cloudCust.walletBalance ?? existing?.walletBalance ?? 0),
        totalSpent: Number(cloudCust.totalSpent ?? existing?.totalSpent ?? 0),
        synced: true,
      });
    }

    const next = Array.from(byPhone.values());
    this.saveCustomers(next);
    return next;
  }

  /**
   * Look up a customer by either phone number (e.g. "01000000001") OR customerCode
   * (e.g. "1001", "C-1001", "c-1001", "#1001").
   */
  static lookupCustomerByPhone(query: string): LocalCustomer | undefined {
    const clean = query.trim();
    if (!clean) return undefined;
    const customers = this.loadCustomers();

    // 1. Check if query matches customerCode (e.g. C-1001, #1001, 1001)
    const parsedCode = parseCustomerCodeInput(clean);
    if (parsedCode !== null) {
      const byCode = customers.find((c) => Number(c.customerCode) === parsedCode);
      if (byCode) return byCode;
    }

    // 2. Check exact phone match
    return customers.find((c) => c.phone.trim() === clean);
  }

  static createOrUpdateCustomerLocal(input: {
    id?: string;
    customerCode?: number;
    name?: string | null;
    phone: string;
    pointsBalance?: number;
    walletBalance?: number;
    creditLimit?: number;
    creditBalance?: number;
    totalSpent?: number;
    synced?: boolean;
  }): LocalCustomer {
    const cleanPhone = input.phone.trim();
    const cleanName =
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : null;
    const customers = this.loadCustomers();
    const existingIdx = customers.findIndex((c) => c.phone.trim() === cleanPhone);

    if (existingIdx >= 0) {
      const updated: LocalCustomer = {
        ...customers[existingIdx],
        ...(input.id ? { id: input.id } : {}),
        ...(input.customerCode ? { customerCode: Number(input.customerCode) } : {}),
        name: cleanName !== null ? cleanName : customers[existingIdx].name ?? null,
        ...(input.pointsBalance !== undefined
          ? { pointsBalance: Number(input.pointsBalance) }
          : {}),
        ...(input.walletBalance !== undefined
          ? { walletBalance: Number(input.walletBalance) }
          : {}),
        ...(input.creditLimit !== undefined
          ? { creditLimit: Number(input.creditLimit) }
          : {}),
        ...(input.creditBalance !== undefined
          ? { creditBalance: Number(input.creditBalance) }
          : {}),
        ...(input.totalSpent !== undefined ? { totalSpent: Number(input.totalSpent) } : {}),
        ...(input.synced !== undefined ? { synced: input.synced } : {}),
        updatedAt: new Date().toISOString(),
      };
      customers[existingIdx] = updated;
      this.saveCustomers(customers);
      return updated;
    }

    const assignedCode =
      input.customerCode && input.customerCode >= 1001
        ? Number(input.customerCode)
        : this.getNextLocalCustomerCode(customers);

    const created: LocalCustomer = {
      id: input.id || `cust-local-${Date.now()}`,
      customerCode: assignedCode,
      name: cleanName,
      phone: cleanPhone,
      pointsBalance: Number(input.pointsBalance ?? 0),
      walletBalance: Number(input.walletBalance ?? 0),
      creditLimit: Number(input.creditLimit ?? 0),
      creditBalance: Number(input.creditBalance ?? 0),
      totalSpent: Number(input.totalSpent ?? 0),
      synced: input.synced ?? false,
      updatedAt: new Date().toISOString(),
      loyaltyTransactions: [],
      walletTransactions: [],
      creditTransactions: [],
    };
    customers.unshift(created);
    this.saveCustomers(customers);
    return created;
  }

  static calculateLoyaltyForCart(
    cartSubtotal: number,
    customer?: LocalCustomer | null,
    redeemPoints?: boolean
  ): {
    pointsRedeemed: number;
    discountFromPoints: number;
    netPayable: number;
    pointsEarned: number;
  } {
    const settings = this.loadLoyaltySettings();
    const cleanSubtotal = Math.max(0, Number(cartSubtotal.toFixed(2)));

    if (!settings.isEnabled || cleanSubtotal <= 0 || !customer) {
      return {
        pointsRedeemed: 0,
        discountFromPoints: 0,
        netPayable: cleanSubtotal,
        pointsEarned: 0,
      };
    }

    let pointsRedeemed = 0;
    let discountFromPoints = 0;

    if (
      redeemPoints &&
      customer.pointsBalance >= settings.minPointsToRedeem &&
      settings.redemptionPointsBlock > 0 &&
      settings.redemptionDiscountAmount > 0
    ) {
      const valuePerPoint =
        settings.redemptionDiscountAmount / settings.redemptionPointsBlock;
      const maxDiscountByCap = Number(
        ((cleanSubtotal * settings.maxDiscountCapPercent) / 100).toFixed(2)
      );
      const maxPointsByCap = Math.floor(maxDiscountByCap / valuePerPoint);
      const candidatePoints = Math.min(customer.pointsBalance, maxPointsByCap);

      if (candidatePoints >= settings.minPointsToRedeem) {
        pointsRedeemed = candidatePoints;
        discountFromPoints = Number((pointsRedeemed * valuePerPoint).toFixed(2));
      }
    }

    const netPayable = Number(Math.max(0, cleanSubtotal - discountFromPoints).toFixed(2));
    const pointsEarned =
      settings.spendAmountPerPoint > 0
        ? Math.floor(netPayable / settings.spendAmountPerPoint)
        : 0;

    return {
      pointsRedeemed,
      discountFromPoints,
      netPayable,
      pointsEarned,
    };
  }

  /**
   * Authoritative Cloud Catalog Sync:
   * Replaces the local catalog with the exact products stored in the PostgreSQL database
   * (preserving only unsynced offline-created products with `local-*` IDs).
   * Ensures deleted database products and stale demo items are removed from POS & Admin.
   */
  static replaceCatalogFromCloud(cloudProducts: LocalProduct[]): LocalProduct[] {
    const localCatalog = this.loadCatalog();
    const cloudBarcodes = new Set(cloudProducts.map((p) => p.barcode));
    const normalizedCloud = cloudProducts.map((cloudItem) => ({
      ...cloudItem,
      retailPrice: Number(cloudItem.retailPrice),
      totalStock:
        cloudItem.totalStock !== undefined
          ? Number(cloudItem.totalStock)
          : (cloudItem.batches || []).reduce((sum, b) => sum + Number(b.quantity || 0), 0),
    }));

    // Keep only purely local offline-created products that haven't been synced to cloud yet
    const unsyncedLocal = localCatalog.filter(
      (localItem) =>
        localItem.id.startsWith('local-') && !cloudBarcodes.has(localItem.barcode)
    );

    const updatedList = [...normalizedCloud, ...unsyncedLocal];
    this.saveCatalog(updatedList);
    return updatedList;
  }

  /**
   * Removes one or more products by ID from the local SQLite / IndexedDB / localStorage catalog.
   */
  static removeProductsLocal(productIds: string[]): LocalProduct[] {
    const idSet = new Set(productIds);
    const next = this.loadCatalog().filter((p) => !idSet.has(p.id));
    this.saveCatalog(next);

    // Also clean any unsynced offline orders referencing deleted product IDs so they don't block sync
    const queue = this.getOfflineQueue();
    const cleanedQueue = queue.filter(
      (o) => o.synced || !o.items.some((item) => idSet.has(item.productId))
    );
    if (cleanedQueue.length !== queue.length) {
      persistTableToNativeSqliteAndIdb(OFFLINE_QUEUE_KEY, JSON.stringify(cleanedQueue));
    }

    return next;
  }

  /**
   * Conflict Resolution Strategy:
   * Cloud price adjustments ALWAYS override local SQLite prices (`retailPrice`),
   * while local pending sales transactions remain immutable in `offline_orders_queue`.
   */
  static applyCloudCatalogOverride(cloudProducts: LocalProduct[]): LocalProduct[] {
    const localCatalog = this.loadCatalog();
    const mergedMap = new Map<string, LocalProduct>();

    for (const localItem of localCatalog) {
      mergedMap.set(localItem.id, localItem);
    }

    for (const cloudItem of cloudProducts) {
      const existing = mergedMap.get(cloudItem.id);
      if (existing) {
        mergedMap.set(cloudItem.id, {
          ...existing,
          ...cloudItem,
          retailPrice: Number(cloudItem.retailPrice),
        });
      } else {
        mergedMap.set(cloudItem.id, {
          ...cloudItem,
          retailPrice: Number(cloudItem.retailPrice),
        });
      }
    }

    const updatedList = Array.from(mergedMap.values());
    this.saveCatalog(updatedList);
    return updatedList;
  }

  static parseScaleBarcode(rawBarcode: string): { weight: number; unitPrice: number; plu: string; totalPackPrice: number } | null {
    const digits = rawBarcode.trim().replace(/\D/g, '');
    if (digits.length !== 13 || !digits.startsWith('2')) {
      return null;
    }

    const prefix = digits.slice(0, 2);
    const plu = digits.slice(2, 7);
    const valueNum = Number(digits.slice(7, 12));

    const matchedProduct = this.findWeightedProductForScaleBarcode(rawBarcode);
    const retailPrice = matchedProduct ? matchedProduct.retailPrice : 100.0;

    let weight = 1.0;
    let totalPackPrice = retailPrice;

    if (prefix === '20') {
      // Price-embedded: digits 7-11 are piasters (e.g. 05450 -> 54.50 EGP)
      totalPackPrice = Number((valueNum / 100).toFixed(2));
      weight = retailPrice > 0 ? Number((totalPackPrice / retailPrice).toFixed(3)) : 1.0;
    } else {
      // Weight-embedded (prefixes 21-29): digits 7-11 are grams (e.g. 01250 -> 1.250 kg)
      weight = Number((valueNum / 1000).toFixed(3));
      totalPackPrice = Number((weight * retailPrice).toFixed(2));
    }

    if (weight <= 0 || !Number.isFinite(weight) || totalPackPrice <= 0) {
      return null;
    }

    return {
      weight,
      unitPrice: retailPrice,
      plu,
      totalPackPrice,
    };
  }

  static findWeightedProductForScaleBarcode(rawBarcode: string): LocalProduct | undefined {
    const digits = rawBarcode.trim().replace(/\D/g, '');
    if (digits.length !== 13 || !digits.startsWith('2')) {
      return undefined;
    }
    const plu = digits.slice(2, 7);
    const catalog = this.loadCatalog();

    // 1. Exact PLU match on barcode (e.g. "00101")
    const exactMatch = catalog.find((p) => p.barcode === plu || p.barcode.endsWith(plu));
    if (exactMatch) return exactMatch;

    // 2. Match without leading zeros (e.g. "101")
    const shortPlu = plu.replace(/^0+/, '');
    if (shortPlu) {
      const shortMatch = catalog.find((p) => p.barcode === shortPlu || p.barcode.endsWith(shortPlu));
      if (shortMatch) return shortMatch;
    }

    // 3. Fallback to any weighted product in catalog
    return catalog.find((p) => p.isWeighted || /(كجم|جرام|لتر|kg|g)/i.test(p.weightUnit));
  }

  static lookupByBarcode(barcode: string): LocalProduct | undefined {
    const catalog = this.loadCatalog();
    return catalog.find((p) => p.barcode === barcode.trim());
  }

  private static recalcStock(product: LocalProduct): LocalProduct {
    return {
      ...product,
      totalStock: product.batches.reduce((sum, b) => sum + b.quantity, 0),
    };
  }

  /** Insert or replace a product in the local catalog (used after create/edit). */
  static upsertProduct(product: LocalProduct): LocalProduct[] {
    const catalog = this.loadCatalog();
    const next = catalog.some((p) => p.id === product.id)
      ? catalog.map((p) => (p.id === product.id ? this.recalcStock(product) : p))
      : [this.recalcStock(product), ...catalog];
    this.saveCatalog(next);
    return next;
  }

  static addBatchLocal(productId: string, batch: LocalBatch): LocalProduct[] {
    const catalog = this.loadCatalog().map((p) => {
      if (p.id !== productId) return p;
      const incomingDateKey = String(batch.expiryDate).slice(0, 10);
      const incomingCost = Number((batch.costPrice ?? 0).toFixed(2));

      const existingIdx = p.batches.findIndex(
        (b) =>
          String(b.expiryDate).slice(0, 10) === incomingDateKey &&
          Number((b.costPrice ?? 0).toFixed(2)) === incomingCost
      );

      let nextBatches: LocalBatch[];
      if (existingIdx >= 0) {
        nextBatches = p.batches.map((b, idx) =>
          idx === existingIdx ? { ...b, quantity: b.quantity + batch.quantity } : b
        );
      } else {
        nextBatches = [...p.batches, { ...batch, expiryDate: incomingDateKey }];
      }

      nextBatches.sort(
        (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
      );
      return this.recalcStock({
        ...p,
        batches: nextBatches,
        updatedAt: new Date().toISOString(),
      });
    });
    this.saveCatalog(catalog);
    return catalog;
  }

  static reconcileStockLocal(params: {
    productId: string;
    quantityToDeduct: number;
    reason: string;
    batchId?: string;
    notes?: string;
  }): LocalProduct[] {
    const catalog = this.loadCatalog();
    const target = catalog.find((p) => p.id === params.productId);
    if (!target) {
      throw new Error('الصنف غير موجود');
    }

    if (params.quantityToDeduct <= 0) {
      throw new Error('الكمية المراد خصمها يجب أن تكون أكبر من صفر');
    }

    if (params.batchId) {
      const batch = target.batches.find((b) => b.id === params.batchId);
      if (!batch) {
        throw new Error('التشغيلة المحددة غير موجودة');
      }
      if (batch.quantity < params.quantityToDeduct) {
        throw new Error(
          `الكمية المطلوبة للتسوية (${params.quantityToDeduct}) أكبر من رصيد التشغيلة (${batch.quantity})`
        );
      }
      batch.quantity -= params.quantityToDeduct;
    } else {
      if (target.totalStock < params.quantityToDeduct) {
        throw new Error(
          `الكمية المطلوبة للتسوية (${params.quantityToDeduct}) أكبر من الرصيد الكلي (${target.totalStock})`
        );
      }
      target.batches.sort(
        (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
      );
      let remaining = params.quantityToDeduct;
      for (const batch of target.batches) {
        if (remaining <= 0) break;
        if (batch.quantity <= 0) continue;
        const deduct = Math.min(batch.quantity, remaining);
        batch.quantity -= deduct;
        remaining -= deduct;
      }
    }

    target.totalStock = target.batches.reduce((sum, b) => sum + b.quantity, 0);
    target.updatedAt = new Date().toISOString();
    this.saveCatalog(catalog);

    const audits = this.getStockAdjustments();
    audits.unshift({
      id: `adj-${Date.now()}`,
      productId: target.id,
      productName: target.name,
      barcode: target.barcode,
      batchId: params.batchId,
      quantityDeducted: params.quantityToDeduct,
      reason: params.reason,
      notes: params.notes,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(STOCK_ADJUSTMENTS_KEY, JSON.stringify(audits.slice(0, 200)));

    return catalog;
  }

  static getStockAdjustments(): StockAdjustmentAuditRecord[] {
    const raw = localStorage.getItem(STOCK_ADJUSTMENTS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as StockAdjustmentAuditRecord[];
    } catch {
      return [];
    }
  }

  static applyBulkImportLocal(importedProducts: LocalProduct[]): LocalProduct[] {
    const catalog = this.loadCatalog();
    const byBarcode = new Map<string, LocalProduct>();
    for (const item of catalog) {
      byBarcode.set(item.barcode, item);
    }

    for (const incoming of importedProducts) {
      byBarcode.set(incoming.barcode, this.recalcStock(incoming));
    }

    const next = Array.from(byBarcode.values());
    this.saveCatalog(next);
    return next;
  }

  static executeOfflineFifoCheckout(
    shiftId: string,
    paymentMethod: 'CASH' | 'CARD' | 'SPLIT' | 'CREDIT',
    cartItems: Array<{ product: LocalProduct; quantity: number }>,
    loyaltyOptions?: {
      customerPhone?: string;
      redeemPoints?: boolean;
      useWallet?: boolean;
      walletAmountUsed?: number;
      paidAmount?: number;
      changeGiven?: number;
      changeDepositedToWallet?: number;
    }
  ): OfflineOrderRecord {
    if (paymentMethod === 'CREDIT' && !loyaltyOptions?.customerPhone) {
      throw new Error('يجب ربط عميل لإتمام عملية الشراء على الحساب الآجل (شكك)');
    }

    const catalog = this.loadCatalog();
    let subtotalAmount = 0;

    for (const cartItem of cartItems) {
      const target = catalog.find((p) => p.id === cartItem.product.id);
      if (!target) {
        throw new Error(`الصنف غير موجود: ${cartItem.product.name}`);
      }

      const orderedQty = Number(cartItem.quantity);
      if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
        throw new Error(`الكمية غير صحيحة للصنف: ${cartItem.product.name}`);
      }

      if (target.totalStock < orderedQty) {
        throw new Error(`الكمية غير كافية للصنف: ${cartItem.product.name}`);
      }

      target.batches.sort(
        (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
      );

      let remaining = orderedQty;
      for (const batch of target.batches) {
        if (remaining <= 0) break;
        if (batch.quantity <= 0) continue;
        const deduct = Math.min(batch.quantity, remaining);
        batch.quantity -= deduct;
        remaining -= deduct;
      }

      target.totalStock = target.batches.reduce((sum, b) => sum + b.quantity, 0);
      subtotalAmount += orderedQty * target.retailPrice;
    }

    const clientOrderId = generateClientUuid();
    const orderNumber = this.allocateNextOrderNumber();
    const idempotencyKey = `ord-${clientOrderId}`;

    let customerId: string | undefined;
    let customerCode: number | undefined;
    let customerName: string | null | undefined;
    let customerPhone: string | undefined;
    let pointsEarned = 0;
    let pointsRedeemed = 0;
    let discountFromPoints = 0;
    let customerPointsBalance: number | undefined;
    let customerWalletBalance: number | undefined;
    let finalPayable = Number(subtotalAmount.toFixed(2));
    let walletAmountUsed = 0;
    const changeDepositedToWallet = Number(
      (loyaltyOptions?.changeDepositedToWallet ?? 0).toFixed(2)
    );

    if (loyaltyOptions?.customerPhone) {
      const customers = this.loadCustomers();
      const idx = customers.findIndex(
        (c) => c.phone.trim() === loyaltyOptions.customerPhone!.trim()
      );
      if (idx >= 0) {
        const cust = customers[idx];
        const calc = this.calculateLoyaltyForCart(
          subtotalAmount,
          cust,
          loyaltyOptions.redeemPoints
        );
        pointsRedeemed = calc.pointsRedeemed;
        discountFromPoints = calc.discountFromPoints;
        finalPayable = calc.netPayable;
        pointsEarned = calc.pointsEarned;

        const currentWallet = Number(cust.walletBalance ?? 0);
        if (loyaltyOptions.walletAmountUsed !== undefined) {
          walletAmountUsed = Number(
            Math.min(
              currentWallet,
              finalPayable,
              Math.max(0, loyaltyOptions.walletAmountUsed)
            ).toFixed(2)
          );
        } else if (loyaltyOptions.useWallet && currentWallet > 0) {
          walletAmountUsed = Number(Math.min(currentWallet, finalPayable).toFixed(2));
        }

        const walletAfterDebit = Number((currentWallet - walletAmountUsed).toFixed(2));
        const newWalletBalance = Number(
          (walletAfterDebit + changeDepositedToWallet).toFixed(2)
        );

        const newBalance = cust.pointsBalance - pointsRedeemed + pointsEarned;
        const newSpent = Number((cust.totalSpent + finalPayable).toFixed(2));
        const txHistory = [...(cust.loyaltyTransactions || [])];
        const walletHistory = [...(cust.walletTransactions || [])];
        const nowIso = new Date().toISOString();

        if (pointsRedeemed > 0) {
          txHistory.unshift({
            id: `ltx-redeem-${Date.now()}`,
            customerId: cust.id,
            orderId: orderNumber,
            type: 'REDEEM',
            points: -pointsRedeemed,
            amountValue: discountFromPoints,
            description: `استبدال ${pointsRedeemed} نقطة بخصم ${discountFromPoints.toFixed(2)} ج.م (${orderNumber})`,
            createdAt: nowIso,
          });
        }
        if (pointsEarned > 0) {
          txHistory.unshift({
            id: `ltx-earn-${Date.now()}`,
            customerId: cust.id,
            orderId: orderNumber,
            type: 'EARN',
            points: pointsEarned,
            amountValue: finalPayable,
            description: `اكتساب ${pointsEarned} نقطة من الفاتورة ${orderNumber}`,
            createdAt: nowIso,
          });
        }

        if (walletAmountUsed > 0) {
          walletHistory.unshift({
            id: `wtx-pay-${Date.now()}`,
            customerId: cust.id,
            orderId: orderNumber,
            type: 'PURCHASE_PAYMENT',
            amount: -walletAmountUsed,
            balanceAfter: walletAfterDebit,
            description: `سداد من رصيد محفظة الفكة للفاتورة ${orderNumber}`,
            createdAt: nowIso,
          });
        }

        if (changeDepositedToWallet > 0) {
          walletHistory.unshift({
            id: `wtx-dep-${Date.now()}`,
            customerId: cust.id,
            orderId: orderNumber,
            type: 'CHANGE_DEPOSIT',
            amount: changeDepositedToWallet,
            balanceAfter: newWalletBalance,
            description: `إيداع باقي الفكة في المحفظة من الفاتورة ${orderNumber}`,
            createdAt: nowIso,
          });
        }

        let currentCreditBalance = Number(cust.creditBalance ?? 0);
        const creditLimit = Number(cust.creditLimit ?? 0);
        const creditDue = Number(Math.max(0, finalPayable - walletAmountUsed).toFixed(2));
        const creditHistory = [...(cust.creditTransactions || [])];

        if (paymentMethod === 'CREDIT') {
          const availableCredit = Number((creditLimit - currentCreditBalance).toFixed(2));
          if (creditDue > availableCredit) {
            throw new Error(
              `الرصيد الائتماني غير كافٍ. المتبقي المتاح: ${availableCredit.toFixed(2)} ج.م والمطلوب: ${creditDue.toFixed(2)} ج.م`
            );
          }
          currentCreditBalance = Number((currentCreditBalance + creditDue).toFixed(2));
          creditHistory.unshift({
            id: `ctx-debt-${Date.now()}`,
            customerId: cust.id,
            orderId: orderNumber,
            type: 'PURCHASE_DEBT',
            amount: creditDue,
            balanceAfter: currentCreditBalance,
            notes: `شراء بالآجل - فاتورة رقم ${orderNumber}`,
            createdAt: nowIso,
          });
        }

        customers[idx] = {
          ...cust,
          pointsBalance: newBalance,
          walletBalance: newWalletBalance,
          creditBalance: currentCreditBalance,
          totalSpent: newSpent,
          updatedAt: nowIso,
          loyaltyTransactions: txHistory.slice(0, 50),
          walletTransactions: walletHistory.slice(0, 50),
          creditTransactions: creditHistory.slice(0, 50),
        };
        this.saveCustomers(customers);

        customerId = cust.id;
        customerCode = cust.customerCode;
        customerName = getCustomerDisplayName(cust);
        customerPhone = cust.phone;
        customerPointsBalance = newBalance;
        customerWalletBalance = newWalletBalance;
      }
    }

    const remainingCashDue = Number(
      Math.max(0, finalPayable - walletAmountUsed).toFixed(2)
    );
    const paidAmount =
      paymentMethod === 'CREDIT'
        ? 0
        : loyaltyOptions?.paidAmount !== undefined
        ? Number(loyaltyOptions.paidAmount.toFixed(2))
        : remainingCashDue;
    const totalChangeDue =
      paymentMethod === 'CREDIT'
        ? 0
        : Number(Math.max(0, paidAmount - remainingCashDue).toFixed(2));
    const changeGiven =
      paymentMethod === 'CREDIT'
        ? 0
        : loyaltyOptions?.changeGiven !== undefined
        ? Number(loyaltyOptions.changeGiven.toFixed(2))
        : Number(Math.max(0, totalChangeDue - changeDepositedToWallet).toFixed(2));

    this.saveCatalog(catalog);

    const record: OfflineOrderRecord = {
      clientOrderId,
      idempotencyKey,
      orderNumber,
      shiftId,
      paymentMethod,
      subtotalAmount: Number(subtotalAmount.toFixed(2)),
      totalAmount: finalPayable,
      paidAmount,
      changeGiven,
      changeDepositedToWallet,
      walletAmountUsed,
      customerId,
      customerCode,
      customerName,
      customerPhone,
      pointsEarned,
      pointsRedeemed,
      discountFromPoints,
      customerPointsBalance,
      customerWalletBalance,
      createdAt: new Date().toLocaleString('ar-EG'),
      synced: false,
      items: cartItems.map((ci) => ({
        productId: ci.product.id,
        name: ci.product.name,
        quantity: ci.quantity,
        unitPrice: ci.product.retailPrice,
      })),
    };

    const queue = this.getOfflineQueue();
    queue.unshift(record);
    persistTableToNativeSqliteAndIdb(OFFLINE_QUEUE_KEY, JSON.stringify(queue));

    return record;
  }

  static enqueueClosedShift(
    shiftId: string,
    actualEndCash: number,
    expectedCash: number,
    walletMetrics?: {
      totalChangeCreditedToWallets?: number;
      totalWalletRedemptions?: number;
    }
  ): OfflineClosedShiftRecord {
    const discrepancy = Number((actualEndCash - expectedCash).toFixed(2));
    const shiftRecord: OfflineClosedShiftRecord = {
      shiftId,
      actualEndCash,
      expectedCash,
      discrepancy,
      totalChangeCreditedToWallets: Number(
        (walletMetrics?.totalChangeCreditedToWallets ?? 0).toFixed(2)
      ),
      totalWalletRedemptions: Number(
        (walletMetrics?.totalWalletRedemptions ?? 0).toFixed(2)
      ),
      closedAt: new Date().toISOString(),
      synced: false,
    };

    const shifts = this.getOfflineClosedShifts();
    shifts.unshift(shiftRecord);
    persistTableToNativeSqliteAndIdb(OFFLINE_SHIFTS_KEY, JSON.stringify(shifts));
    return shiftRecord;
  }

  static getOfflineClosedShifts(): OfflineClosedShiftRecord[] {
    const raw = localStorage.getItem(OFFLINE_SHIFTS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as OfflineClosedShiftRecord[];
    } catch {
      return [];
    }
  }

  static getOfflineQueue(): OfflineOrderRecord[] {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as OfflineOrderRecord[];
      if (isTestEnv()) return parsed;
      const cleaned = parsed.filter(
        (o) =>
          o.synced ||
          !o.items.some((item) => LEGACY_SEED_PRODUCT_IDS.has(item.productId))
      );
      if (cleaned.length !== parsed.length) {
        persistTableToNativeSqliteAndIdb(OFFLINE_QUEUE_KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    } catch {
      return [];
    }
  }

  static getParkedInvoices(): ParkedInvoiceRecord[] {
    const raw = localStorage.getItem(PARKED_INVOICES_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ParkedInvoiceRecord[];
    } catch {
      return [];
    }
  }

  static saveParkedInvoices(invoices: ParkedInvoiceRecord[]): void {
    const next = invoices.slice(0, 20);
    persistTableToNativeSqliteAndIdb(PARKED_INVOICES_KEY, JSON.stringify(next));
  }

  static parkCurrentCart(params: {
    items: Array<{ product: LocalProduct; quantity: number }>;
    customerPhone?: string;
    customerName?: string | null;
  }): ParkedInvoiceRecord {
    const next: ParkedInvoiceRecord = {
      id: `park-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customerPhone: params.customerPhone?.trim() || undefined,
      customerName: params.customerName?.trim() || undefined,
      items: params.items.map((item) => ({
        product: item.product,
        quantity: Math.max(1, item.quantity),
      })),
    };

    const parked = [next, ...this.getParkedInvoices()].slice(0, 20);
    this.saveParkedInvoices(parked);
    return next;
  }

  static resumeParkedInvoice(id: string): ParkedInvoiceRecord | null {
    const parked = this.getParkedInvoices();
    return parked.find((invoice) => invoice.id === id) ?? null;
  }

  static deleteParkedInvoice(id: string): ParkedInvoiceRecord[] {
    const next = this.getParkedInvoices().filter((invoice) => invoice.id !== id);
    this.saveParkedInvoices(next);
    return next;
  }

  static markQueueSynced(): { ordersSynced: number; shiftsSynced: number } {
    const queue = this.getOfflineQueue();
    let ordersSynced = 0;
    const updatedOrders = queue.map((o) => {
      if (!o.synced) ordersSynced++;
      return { ...o, synced: true };
    });
    persistTableToNativeSqliteAndIdb(OFFLINE_QUEUE_KEY, JSON.stringify(updatedOrders));

    const shifts = this.getOfflineClosedShifts();
    let shiftsSynced = 0;
    const updatedShifts = shifts.map((s) => {
      if (!s.synced) shiftsSynced++;
      return { ...s, synced: true };
    });
    persistTableToNativeSqliteAndIdb(OFFLINE_SHIFTS_KEY, JSON.stringify(updatedShifts));

    const customers = this.loadCustomers().map((c) => ({ ...c, synced: true }));
    this.saveCustomers(customers);

    return { ordersSynced, shiftsSynced };
  }

  static getCashMovements(shiftId?: string): LocalCashMovement[] {
    const raw = localStorage.getItem(CASH_MOVEMENTS_KEY);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as LocalCashMovement[];
      if (shiftId) {
        return list.filter((m) => m.shiftId === shiftId);
      }
      return list;
    } catch {
      return [];
    }
  }

  static recordCashMovementLocal(params: {
    shiftId: string;
    type: 'CASH_IN' | 'CASH_OUT';
    amount: number;
    reason: string;
  }): LocalCashMovement {
    const movement: LocalCashMovement = {
      id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      shiftId: params.shiftId,
      type: params.type,
      amount: Math.max(0, Number(params.amount.toFixed(2))),
      reason: params.reason.trim(),
      createdAt: new Date().toISOString(),
    };
    const list = [movement, ...this.getCashMovements()].slice(0, 200);
    persistTableToNativeSqliteAndIdb(CASH_MOVEMENTS_KEY, JSON.stringify(list));
    return movement;
  }

  static getAuditLogs(): LocalAuditLog[] {
    const raw = localStorage.getItem(AUDIT_LOGS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as LocalAuditLog[];
    } catch {
      return [];
    }
  }

  static recordAuditLogLocal(action: string, authorizedBy: string, details?: string): LocalAuditLog {
    const log: LocalAuditLog = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      authorizedBy,
      details,
      createdAt: new Date().toISOString(),
    };
    const list = [log, ...this.getAuditLogs()].slice(0, 200);
    persistTableToNativeSqliteAndIdb(AUDIT_LOGS_KEY, JSON.stringify(list));
    return log;
  }

  static updateCustomerCreditLimitLocal(customerId: string, creditLimit: number): LocalCustomer | null {
    const customers = this.loadCustomers();
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx === -1) return null;
    const limit = Math.max(0, Number(creditLimit.toFixed(2)));
    customers[idx].creditLimit = limit;
    customers[idx].availableCredit = Math.max(0, Number((limit - (customers[idx].creditBalance ?? 0)).toFixed(2)));
    customers[idx].synced = false;
    this.saveCustomers(customers);
    return customers[idx];
  }

  static settleCustomerDebtLocal(params: {
    customerId: string;
    amount: number;
    notes?: string;
    shiftId?: string;
  }): { customer: LocalCustomer; transaction: LocalCreditTransaction } {
    const customers = this.loadCustomers();
    const idx = customers.findIndex((c) => c.id === params.customerId);
    if (idx === -1) throw new Error('العميل غير موجود محلياً');
    const cust = customers[idx];
    const currentDebt = Number(cust.creditBalance ?? 0);
    const amount = Number(params.amount);
    if (amount <= 0 || amount > currentDebt) {
      throw new Error('مبلغ السداد غير صالح أو أكبر من الدين المستحق');
    }
    const newDebt = Number((currentDebt - amount).toFixed(2));
    const tx: LocalCreditTransaction = {
      id: `ctx-settle-${Date.now()}`,
      customerId: cust.id,
      amount,
      balanceAfter: newDebt,
      type: 'SETTLEMENT_PAYMENT',
      notes: params.notes || 'سداد دفعة نقدية من الحساب الآجل (شكك)',
      createdAt: new Date().toISOString(),
    };
    cust.creditBalance = newDebt;
    cust.availableCredit = Math.max(0, Number(((cust.creditLimit ?? 0) - newDebt).toFixed(2)));
    cust.creditTransactions = [tx, ...(cust.creditTransactions || [])].slice(0, 50);
    cust.synced = false;
    this.saveCustomers(customers);

    if (params.shiftId) {
      this.recordCashMovementLocal({
        shiftId: params.shiftId,
        type: 'CASH_IN',
        amount,
        reason: `سداد دفعة حساب آجل للعميل ${cust.name || cust.phone}`,
      });
    }

    return { customer: cust, transaction: tx };
  }

  /**
   * Creates a local POS SQLite snapshot backup and stores it in IndexedDB / Tauri SQLite.
   */
  static createLocalBackupSnapshot() {
    const snapshot = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      catalog: this.loadCatalog(),
      customers: this.loadCustomers(),
      loyaltySettings: this.loadLoyaltySettings(),
      parkedInvoices: this.getParkedInvoices(),
      offlineOrdersQueue: this.getOfflineQueue(),
      offlineClosedShifts: this.getOfflineClosedShifts(),
      stockAdjustments: this.getStockAdjustments(),
    };
    persistTableToNativeSqliteAndIdb(LOCAL_BACKUP_KEY, JSON.stringify(snapshot));
    return snapshot;
  }

  static syncOrderSequenceFromCloud(nextOrderNumber: string): void {
    const match = nextOrderNumber.trim().match(/^ALM-(\d+)$/i);
    if (!match) return;
    const cloudNextSeq = Number.parseInt(match[1], 10);
    if (!Number.isFinite(cloudNextSeq) || cloudNextSeq < 1) return;

    const currentLast = Number.parseInt(
      localStorage.getItem(ORDER_SEQUENCE_KEY) || '0',
      10
    );
    const safeCurrent = Number.isFinite(currentLast) && currentLast >= 0 ? currentLast : 0;
    const targetLast = Math.max(safeCurrent, cloudNextSeq - 1);
    localStorage.setItem(ORDER_SEQUENCE_KEY, String(targetLast));
  }

  static allocateNextOrderNumber(): string {
    const currentLast = Number.parseInt(
      localStorage.getItem(ORDER_SEQUENCE_KEY) || '0',
      10
    );
    let nextSeq = Number.isFinite(currentLast) && currentLast >= 0 ? currentLast + 1 : 1;

    const queuedNumbers = new Set(
      this.getOfflineQueue().map((o) => o.orderNumber.toUpperCase())
    );
    while (queuedNumbers.has(`ALM-${String(nextSeq).padStart(6, '0')}`)) {
      nextSeq += 1;
    }

    localStorage.setItem(ORDER_SEQUENCE_KEY, String(nextSeq));
    return `ALM-${String(nextSeq).padStart(6, '0')}`;
  }
}

import { API_BASE, getSession, handleUnauthorized } from './auth';
import {
  LocalCustomer,
  LocalLoyaltySettings,
  LocalProduct,
  LocalSqliteBridge,
  OfflineClosedShiftRecord,
  OfflineOrderRecord,
} from './offlineSqlite';

async function authedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  if (!session) {
    handleUnauthorized();
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new Error('تعذر الاتصال بالخادم السحابي');
  }

  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  }
  if (!res.ok) {
    throw new Error(json.message || `فشل الطلب (${res.status})`);
  }
  return json.data as T;
}

export interface Overview {
  todayOrdersCount: number;
  todayRevenue: number;
  todayNetProfit: number;
  activeShiftsCount: number;
  activeShifts: Array<{
    id: string;
    cashierName: string;
    startingCash: number;
    openedAt: string;
  }>;
}

export interface PnlSummary {
  validOrdersCount: number;
  returnedOrdersCount: number;
  grossRevenue: number;
  totalCostOfGoodsSold: number;
  netProfit: number;
  profitMarginPercent: number;
  returnedOrdersValue: number;
}

export interface OrderLookupResult {
  id: string;
  orderNumber: string;
  totalAmount: number;
  paidAmount?: number;
  paymentMethod?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  isReturned?: boolean;
  createdAt?: string;
  items?: Array<{
    id?: string;
    productId?: string;
    productName?: string;
    barcode?: string;
    quantity?: number;
    unitPrice?: number;
    lineTotal?: number;
  }>;
}

export const fetchOverview = () => authedJson<Overview>('/api/reports/overview');

export function fetchPnl(startDate?: string, endDate?: string) {
  const qs = new URLSearchParams();
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return authedJson<PnlSummary>(`/api/reports/pnl${suffix}`);
}

export async function fetchOrderByNumber(orderNumber: string): Promise<OrderLookupResult> {
  return authedJson<OrderLookupResult>(`/api/orders/number/${encodeURIComponent(orderNumber)}`);
}

export async function returnOrderCloud(
  orderId: string,
  refundMethod: 'CASH' | 'WALLET' = 'CASH',
  refundAmount?: number,
  returnedItems?: Array<{ orderItemId: string; quantity: number }>
): Promise<OrderLookupResult> {
  return authedJson<OrderLookupResult>(`/api/orders/${encodeURIComponent(orderId)}/return`, {
    method: 'POST',
    body: JSON.stringify({
      refundMethod,
      ...(refundAmount !== undefined ? { refundAmount } : {}),
      ...(returnedItems && returnedItems.length > 0 ? { returnedItems } : {}),
    }),
  });
}

export async function recordCashMovementCloud(input: {
  type: 'CASH_IN' | 'CASH_OUT';
  amount: number;
  reason: string;
  shiftId?: string;
}) {
  return authedJson('/api/shifts/cash-movement', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyManagerPinCloud(input: {
  pin: string;
  action: string;
  details?: string;
}): Promise<{ authorized: boolean; message?: string }> {
  return authedJson<{ authorized: boolean; message?: string }>('/api/auth/verify-pin', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function settleCustomerDebtCloud(
  customerId: string,
  amount: number,
  notes?: string,
  shiftId?: string
) {
  return authedJson(`/api/customers/${encodeURIComponent(customerId)}/credit/settle`, {
    method: 'POST',
    body: JSON.stringify({ amount, notes, shiftId }),
  });
}

export async function updateCustomerCreditLimitCloud(
  customerId: string,
  creditLimit: number
): Promise<LocalCustomer> {
  return authedJson<LocalCustomer>(
    `/api/customers/${encodeURIComponent(customerId)}/credit-limit`,
    {
      method: 'PUT',
      body: JSON.stringify({ creditLimit }),
    }
  );
}

export async function fetchCustomerStatementCloud(customerId: string) {
  return authedJson<any>(`/api/customers/${encodeURIComponent(customerId)}/statement`);
}

export async function fetchAuditLogsCloud() {
  return authedJson<any[]>('/api/auth/audit-logs');
}

export async function fetchLoyaltySettings(): Promise<LocalLoyaltySettings> {
  const settings = await authedJson<LocalLoyaltySettings>('/api/loyalty/settings');
  return LocalSqliteBridge.saveLoyaltySettings(settings);
}

export async function updateLoyaltySettings(
  payload: Partial<LocalLoyaltySettings>
): Promise<LocalLoyaltySettings> {
  const updated = await authedJson<LocalLoyaltySettings>('/api/loyalty/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return LocalSqliteBridge.saveLoyaltySettings(updated);
}

export async function fetchCustomers(query?: {
  phone?: string;
  customerCode?: string;
  search?: string;
}): Promise<LocalCustomer[]> {
  const qs = new URLSearchParams();
  if (query?.phone) qs.set('phone', query.phone);
  if (query?.customerCode) qs.set('customerCode', query.customerCode);
  if (query?.search) qs.set('search', query.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const list = await authedJson<LocalCustomer[]>(`/api/customers${suffix}`);
  if (!query?.phone && !query?.customerCode && !query?.search) {
    LocalSqliteBridge.applyCloudCustomersOverride(list);
  }
  return list;
}

export async function createCustomerCloud(input: {
  name?: string | null;
  phone: string;
}): Promise<LocalCustomer> {
  const created = await authedJson<LocalCustomer>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return LocalSqliteBridge.createOrUpdateCustomerLocal({
    ...created,
    synced: true,
  });
}

function mapCloudProductToLocal(p: any): LocalProduct {
  const batches = (p.batches || []).map((b: any) => ({
    id: b.id,
    batchNumber: b.batchNumber,
    quantity: Number(b.quantity ?? 0),
    expiryDate: String(b.expiryDate).slice(0, 10),
    costPrice: b.costPrice !== undefined ? Number(b.costPrice) : undefined,
  }));
  const calculatedStock = batches.reduce((sum: number, b: any) => sum + b.quantity, 0);
  const weightUnit = p.weightUnit ?? 'قطعة';
  return {
    id: p.id,
    barcode: String(p.barcode ?? ''),
    name: String(p.name ?? ''),
    category: p.category ?? 'عام',
    weightUnit,
    retailPrice: Number(p.retailPrice ?? 0),
    totalStock: p.totalStock !== undefined ? Number(p.totalStock) : calculatedStock,
    minStockAlert: Number(p.minStockAlert ?? 5),
    isAvailableOnline: Boolean(p.isAvailableOnline),
    isWeighted:
      Boolean(p.isWeighted) ||
      /(كجم|جرام|وزن|ميزان|kg|g)/i.test(weightUnit) ||
      /(ميزان|وزن)/i.test(String(p.name ?? '')),
    updatedAt: p.updatedAt,
    batches,
  };
}

/** Pulls the cloud catalog, loyalty settings, and customer directory normalised to the local SQLite shape. */
export async function pullCatalog(): Promise<LocalProduct[]> {
  try {
    const data = await authedJson<{
      products: any[];
      loyaltySettings?: LocalLoyaltySettings;
      customers?: LocalCustomer[];
    }>('/api/sync/pull');

    if (data.loyaltySettings) {
      LocalSqliteBridge.saveLoyaltySettings(data.loyaltySettings);
    }
    if (Array.isArray(data.customers)) {
      LocalSqliteBridge.applyCloudCustomersOverride(data.customers);
    }

    return (data.products || []).map(mapCloudProductToLocal);
  } catch (syncErr) {
    // Fallback to direct /api/products endpoint if /api/sync/pull encounters any issue
    try {
      const products = await authedJson<any[]>('/api/products');
      return (products || []).map(mapCloudProductToLocal);
    } catch {
      throw syncErr;
    }
  }
}

export async function deleteProductCloud(productId: string): Promise<{ deletedId: string }> {
  return authedJson<{ deletedId: string }>(`/api/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
}

export async function bulkDeleteProductsCloud(
  productIds: string[]
): Promise<{ deletedCount: number; deletedIds: string[] }> {
  return authedJson<{ deletedCount: number; deletedIds: string[] }>('/api/products/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: productIds }),
  });
}

export interface PushResult {
  idempotencyKey?: string | null;
  deduplicatedBatch?: boolean;
  syncedCount: number;
  skippedCount: number;
  syncedShiftsCount: number;
}

function buildBatchIdempotencyKey(
  orders: OfflineOrderRecord[],
  closedShifts: OfflineClosedShiftRecord[],
  unsyncedCustomers: LocalCustomer[]
): string {
  const ordPart = orders
    .map((o) => o.idempotencyKey || o.clientOrderId || o.orderNumber)
    .sort()
    .join(',');
  const shiftPart = closedShifts
    .map((s) => s.shiftId)
    .sort()
    .join(',');
  const custPart = unsyncedCustomers
    .map((c) => c.phone)
    .sort()
    .join(',');
  return `batch-${ordPart}|${shiftPart}|${custPart}`.slice(0, 180);
}

export async function reportClientTelemetry(event: {
  source?: 'FRONTEND_POS' | 'SYNC_ENGINE';
  severity?: 'ERROR' | 'WARN' | 'INFO';
  message: string;
  code?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await authedJson('/api/sync/telemetry', {
      method: 'POST',
      body: JSON.stringify({
        source: event.source || 'FRONTEND_POS',
        severity: event.severity || 'ERROR',
        message: event.message,
        code: event.code,
        metadata: event.metadata,
      }),
    });
  } catch {
    // Non-blocking telemetry
  }
}

export async function pushOffline(
  orders: OfflineOrderRecord[],
  closedShifts: OfflineClosedShiftRecord[],
  unsyncedCustomers: LocalCustomer[] = []
) {
  const idempotencyKey = buildBatchIdempotencyKey(
    orders,
    closedShifts,
    unsyncedCustomers
  );

  // Create an automatic local backup snapshot before pushing
  LocalSqliteBridge.createLocalBackupSnapshot();

  try {
    return await authedJson<PushResult>('/api/sync/push', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        idempotencyKey,
        orders: orders.map((o) => ({
          clientOrderId: o.clientOrderId,
          idempotencyKey: o.idempotencyKey,
          orderNumber: o.orderNumber,
          shiftId: o.shiftId,
          paymentMethod: o.paymentMethod,
          customerCode: o.customerCode,
          customerPhone: o.customerPhone,
          customerName: o.customerName,
          pointsEarned: o.pointsEarned,
          pointsRedeemed: o.pointsRedeemed,
          discountFromPoints: o.discountFromPoints,
          paidAmount: o.paidAmount,
          changeGiven: o.changeGiven,
          changeDepositedToWallet: o.changeDepositedToWallet,
          walletAmountUsed: o.walletAmountUsed,
          items: o.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        })),
        closedShifts: closedShifts.map((s) => ({
          shiftId: s.shiftId,
          actualEndCash: s.actualEndCash,
        })),
        customers: unsyncedCustomers.map((c) => ({
          name: c.name ?? null,
          phone: c.phone,
          customerCode: c.customerCode,
        })),
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'فشل مزامنة الفواتير';
    void reportClientTelemetry({
      source: 'SYNC_ENGINE',
      severity: 'ERROR',
      message: msg,
      metadata: {
        idempotencyKey,
        ordersCount: orders.length,
        shiftsCount: closedShifts.length,
      },
    });
    throw err;
  }
}

export interface ThermalPrintCloudResponse {
  printableText: string;
  escPosBase64: string;
  printedPhysically?: boolean;
  printerName?: string;
  bytesSent?: number;
  printError?: string;
}

export async function printThermalReceiptCloud(payload: {
  orderNumber: string;
  cashierName?: string;
  paymentMethod?: string;
  createdAt?: string;
  paperWidth?: '80mm' | '58mm';
  openCashDrawer?: boolean;
  totalAmount: number;
  paidAmount?: number;
  changeGiven?: number;
  changeDepositedToWallet?: number;
  walletAmountUsed?: number;
  customerCode?: number | string;
  customerName?: string | null;
  customerPhone?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountFromPoints?: number;
  customerPointsBalance?: number;
  customerWalletBalance?: number;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}): Promise<ThermalPrintCloudResponse> {
  return authedJson<ThermalPrintCloudResponse>('/api/sync/hardware/receipt', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function printReturnReceiptCloud(payload: {
  returnNumber: string;
  originalOrderNumber: string;
  cashierName?: string;
  refundMethod: 'CASH' | 'WALLET';
  refundAmount: number;
  createdAt?: string;
  paperWidth?: '80mm' | '58mm';
  customerCode?: number | string;
  customerName?: string | null;
  customerPhone?: string;
  customerWalletBalance?: number;
  returnedItems: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}): Promise<ThermalPrintCloudResponse> {
  return authedJson<ThermalPrintCloudResponse>('/api/sync/hardware/return-receipt', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function printZReportCloud(payload: {
  shiftId: string;
  cashierName?: string;
  openedAt?: string;
  closedAt?: string;
  paperWidth?: '80mm' | '58mm';
  startingCash: number;
  totalCashSales: number;
  totalCardSales: number;
  totalReturns?: number;
  totalChangeCreditedToWallets?: number;
  totalWalletRedemptions?: number;
  expectedCash: number;
  actualEndCash: number;
  discrepancy: number;
}): Promise<ThermalPrintCloudResponse> {
  return authedJson<ThermalPrintCloudResponse>('/api/sync/hardware/z-report', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function kickCashDrawerCloud(): Promise<{
  printedPhysically?: boolean;
  printerName?: string;
}> {
  return authedJson<{
    printedPhysically?: boolean;
    printerName?: string;
  }>('/api/sync/hardware/drawer-kick', {
    method: 'POST',
  });
}

export async function testThermalPrinterCloud(options?: {
  paperWidth?: '80mm' | '58mm';
  cashierName?: string;
}): Promise<ThermalPrintCloudResponse> {
  return authedJson<ThermalPrintCloudResponse>('/api/sync/hardware/test-print', {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

export interface AdminOrderItemRecord {
  id: string;
  productId: string;
  productName: string;
  barcode?: string | null;
  quantity: number;
  returnedQuantity?: number;
  unitPrice: number;
  lineTotal: number;
  returnedTotal?: number;
  costPrice?: number;
}

export interface AdminOrderRecord {
  id: string;
  orderNumber: string;
  shiftId: string;
  cashierId: string;
  cashierName: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerFormattedCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  discountFromPoints: number;
  customerPointsBalance: number | null;
  customerWalletBalance: number | null;
  totalAmount: number;
  paidAmount: number;
  changeGiven: number;
  changeDepositedToWallet: number;
  walletAmountUsed: number;
  currency: 'EGP' | 'USD';
  paymentMethod: 'CASH' | 'CARD' | 'MIXED' | 'WALLET';
  refundMethod: 'CASH' | 'WALLET' | 'NONE' | null;
  isReturned: boolean;
  hasPartialReturn?: boolean;
  returnedTotalAmount?: number;
  createdAt: string;
  items: AdminOrderItemRecord[];
}

export async function fetchOrdersCloud(params?: {
  search?: string;
  paymentMethod?: string;
  isReturned?: boolean;
  limit?: number;
}): Promise<AdminOrderRecord[]> {
  const qs = new URLSearchParams();
  if (params?.search?.trim()) qs.set('search', params.search.trim());
  if (params?.paymentMethod && params.paymentMethod !== 'ALL') {
    qs.set('paymentMethod', params.paymentMethod);
  }
  if (typeof params?.isReturned === 'boolean') {
    qs.set('isReturned', String(params.isReturned));
  }
  if (params?.limit) qs.set('limit', String(params.limit));

  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return authedJson<AdminOrderRecord[]>(`/api/orders${suffix}`);
}

export async function fetchNextOrderNumberCloud(): Promise<{ orderNumber: string }> {
  return authedJson<{ orderNumber: string }>('/api/orders/next-number');
}

export interface FullDatabaseBackupPayload {
  format: 'alamir-pos-full-backup';
  version: number;
  exportedAt: string;
  exportedBy?: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export async function exportDatabaseBackupCloud(): Promise<FullDatabaseBackupPayload> {
  return authedJson<FullDatabaseBackupPayload>('/api/backup/export');
}

export async function restoreDatabaseBackupCloud(
  payload: FullDatabaseBackupPayload
): Promise<{ restoredCounts: Record<string, number> }> {
  return authedJson<{ restoredCounts: Record<string, number> }>('/api/backup/restore', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface AdminUserRecord {
  id: string;
  name: string;
  username: string;
  role: 'ADMIN' | 'CASHIER';
  createdAt: string;
}

export async function fetchUsersCloud(): Promise<AdminUserRecord[]> {
  return authedJson<AdminUserRecord[]>('/api/auth/users');
}

export async function createUserCloud(payload: {
  name: string;
  username: string;
  password: string;
  role: 'ADMIN' | 'CASHIER';
}): Promise<AdminUserRecord> {
  return authedJson<AdminUserRecord>('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUserCloud(
  id: string,
  payload: {
    name?: string;
    username?: string;
    password?: string;
    role?: 'ADMIN' | 'CASHIER';
  }
): Promise<AdminUserRecord> {
  return authedJson<AdminUserRecord>(`/api/auth/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}


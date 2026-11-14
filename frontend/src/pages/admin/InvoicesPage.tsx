import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AdminOrderRecord,
  fetchOrdersCloud,
  printThermalReceiptCloud,
} from '../../lib/cloud';
import { useData } from '../../context/DataContext';
import { InvoiceCodeGraphics } from '../../components/InvoiceCodeGraphics';

type PaymentFilter = 'ALL' | 'CASH' | 'CARD' | 'MIXED' | 'WALLET';
type ReturnFilter = 'ALL' | 'ACTIVE' | 'RETURNED';

interface UnifiedInvoice extends AdminOrderRecord {
  isLocalUnsynced?: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'نقدي (Cash)',
  CARD: 'بطاقة (Card)',
  MIXED: 'مختلط (Mixed)',
  WALLET: 'محفظة (Wallet)',
};

function formatCurrency(value: number, currency: 'EGP' | 'USD' = 'EGP'): string {
  return `${Number(value || 0).toFixed(2)} ${currency === 'USD' ? '$' : 'ج.م'}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function InvoicesPage() {
  const { offlineQueue, products, customers } = useData();
  const [cloudOrders, setCloudOrders] = useState<AdminOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL');
  const [returnFilter, setReturnFilter] = useState<ReturnFilter>('ALL');
  const [selectedInvoice, setSelectedInvoice] = useState<UnifiedInvoice | null>(null);
  const [printingThermal, setPrintingThermal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadOrders = useCallback(
    async (opts?: { silent?: boolean; search?: string; payment?: PaymentFilter; ret?: ReturnFilter }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const retVal = opts?.ret ?? returnFilter;
        const data = await fetchOrdersCloud({
          search: (opts?.search ?? searchInput).trim() || undefined,
          paymentMethod: opts?.payment ?? paymentFilter,
          isReturned:
            retVal === 'RETURNED' ? true : retVal === 'ACTIVE' ? false : undefined,
          limit: 200,
        });
        setCloudOrders(data);
        return data;
      } catch (err) {
        if (!opts?.silent) {
          toast.error(
            err instanceof Error ? err.message : 'تعذر تحميل الفواتير من السيرفر'
          );
        }
        return [];
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [paymentFilter, returnFilter, searchInput]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrders();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  // Merge any unsynced local offlineQueue orders so newly issued POS invoices appear immediately
  const invoices = useMemo<UnifiedInvoice[]>(() => {
    const cloudNumbers = new Set(cloudOrders.map((o) => o.orderNumber));
    const productById = new Map(products.map((p) => [p.id, p]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const localUnsynced: UnifiedInvoice[] = offlineQueue
      .filter((o) => !cloudNumbers.has(o.orderNumber))
      .filter((o) => {
        if (paymentFilter !== 'ALL' && o.paymentMethod !== paymentFilter) return false;
        if (returnFilter === 'RETURNED') return false;
        const q = searchInput.trim().toLowerCase();
        if (!q) return true;
        const cust = o.customerId ? customerById.get(o.customerId) : undefined;
        return (
          o.orderNumber.toLowerCase().includes(q) ||
          (cust?.name ?? '').toLowerCase().includes(q) ||
          (cust?.phone ?? '').toLowerCase().includes(q)
        );
      })
      .map((o) => {
        const cust = o.customerId ? customerById.get(o.customerId) : undefined;
        const localId = o.clientOrderId ?? o.orderNumber;
        const mappedPayment: AdminOrderRecord['paymentMethod'] =
          o.paymentMethod === 'SPLIT'
            ? 'MIXED'
            : o.paymentMethod === 'CREDIT'
              ? 'WALLET'
              : o.paymentMethod;
        return {
          id: localId,
          orderNumber: o.orderNumber,
          shiftId: o.shiftId,
          cashierId: 'local',
          cashierName: 'الكاشير (محلي)',
          customerId: o.customerId ?? null,
          customerCode: cust ? String(cust.customerCode) : null,
          customerFormattedCode: cust ? String(cust.customerCode) : null,
          customerName: cust?.name ?? o.customerName ?? null,
          customerPhone: cust?.phone ?? o.customerPhone ?? null,
          pointsEarned: o.pointsEarned ?? 0,
          pointsRedeemed: o.pointsRedeemed ?? 0,
          discountFromPoints: o.discountFromPoints ?? 0,
          customerPointsBalance: cust?.pointsBalance ?? null,
          customerWalletBalance: cust?.walletBalance ?? null,
          totalAmount: o.totalAmount,
          paidAmount: o.paidAmount ?? o.totalAmount,
          changeGiven: o.changeGiven ?? 0,
          changeDepositedToWallet: o.changeDepositedToWallet ?? 0,
          walletAmountUsed: o.walletAmountUsed ?? 0,
          currency: 'EGP' as const,
          paymentMethod: mappedPayment,
          refundMethod: null,
          isReturned: false,
          createdAt: o.createdAt,
          isLocalUnsynced: true,
          items: o.items.map((item, idx) => {
            const prod = productById.get(item.productId);
            const batchCost = prod?.batches?.find((b) => typeof b.costPrice === 'number')?.costPrice;
            return {
              id: `${localId}-${idx}`,
              productId: item.productId,
              productName: prod?.name ?? item.name ?? item.productId,
              barcode: prod?.barcode ?? null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              lineTotal: Number((item.quantity * item.unitPrice).toFixed(2)),
              costPrice: batchCost,
            };
          }),
        };
      });

    return [...localUnsynced, ...cloudOrders];
  }, [cloudOrders, customers, offlineQueue, paymentFilter, products, returnFilter, searchInput]);

  // Summary KPIs
  const summary = useMemo(() => {
    let totalSales = 0;
    let returnedTotal = 0;
    let totalProfit = 0;
    let returnedCount = 0;

    for (const inv of invoices) {
      const invReturnedAmount = inv.isReturned
        ? Number(inv.totalAmount || 0)
        : Number(
            inv.returnedTotalAmount ??
              inv.items.reduce(
                (s, i) => s + (i.returnedQuantity ?? 0) * i.unitPrice,
                0
              )
          );
      const hasAnyReturn =
        inv.isReturned ||
        Boolean(inv.hasPartialReturn) ||
        inv.items.some((i) => (i.returnedQuantity ?? 0) > 0);

      if (hasAnyReturn) {
        returnedCount += 1;
        returnedTotal += invReturnedAmount;
      }

      if (!inv.isReturned) {
        totalSales += Math.max(0, Number(inv.totalAmount || 0) - invReturnedAmount);
        for (const item of inv.items) {
          const netQty = Math.max(0, item.quantity - (item.returnedQuantity ?? 0));
          if (typeof item.costPrice === 'number') {
            totalProfit += (item.unitPrice - item.costPrice) * netQty;
          }
        }
      }
    }

    return {
      count: invoices.length,
      totalSales,
      returnedCount,
      returnedTotal,
      totalProfit,
    };
  }, [invoices]);

  // Barcode / QR scanner Enter handler: open exact invoice immediately
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const query = searchInput.trim();
    if (!query) return;

    const exactLocal = invoices.find(
      (inv) => inv.orderNumber.toLowerCase() === query.toLowerCase()
    );
    if (exactLocal) {
      setSelectedInvoice(exactLocal);
      return;
    }

    const fetched = await loadOrders({ silent: false, search: query });
    const exactRemote = fetched.find(
      (inv) => inv.orderNumber.toLowerCase() === query.toLowerCase()
    );
    if (exactRemote) {
      setSelectedInvoice(exactRemote);
    } else if (fetched.length === 1) {
      setSelectedInvoice(fetched[0]);
    }
  };

  const handleThermalPrint = async (invoice: UnifiedInvoice) => {
    setPrintingThermal(true);
    try {
      const res = await printThermalReceiptCloud({
        orderNumber: invoice.orderNumber,
        cashierName: invoice.cashierName ?? undefined,
        paymentMethod: invoice.paymentMethod,
        createdAt: invoice.createdAt,
        paperWidth: '80mm',
        openCashDrawer: false,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        changeGiven: invoice.changeGiven,
        changeDepositedToWallet: invoice.changeDepositedToWallet,
        walletAmountUsed: invoice.walletAmountUsed,
        customerCode: invoice.customerFormattedCode ?? invoice.customerCode ?? undefined,
        customerName: invoice.customerName,
        customerPhone: invoice.customerPhone ?? undefined,
        pointsEarned: invoice.pointsEarned,
        pointsRedeemed: invoice.pointsRedeemed,
        discountFromPoints: invoice.discountFromPoints,
        customerPointsBalance: invoice.customerPointsBalance ?? undefined,
        customerWalletBalance: invoice.customerWalletBalance ?? undefined,
        items: invoice.items.map((item) => ({
          name: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
      });

      if (res.printedPhysically) {
        toast.success(`تمت طباعة الفاتورة ${invoice.orderNumber} على ${res.printerName || 'الطابعة الحرارية'}`);
      } else {
        toast.warning(res.printError || 'لم يتم الإرسال للطابعة الحرارية مباشرة');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشلت طباعة الفاتورة حرارياً');
    } finally {
      setPrintingThermal(false);
    }
  };

  const selectedInvoiceCostAndProfit = useMemo(() => {
    if (!selectedInvoice) return { totalCost: 0, totalProfit: 0 };
    let totalCost = 0;
    let totalProfit = 0;
    for (const item of selectedInvoice.items) {
      const cost = Number(item.costPrice ?? 0);
      totalCost += cost * item.quantity;
      totalProfit += (item.unitPrice - cost) * item.quantity;
    }
    return { totalCost, totalProfit };
  }, [selectedInvoice]);

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Receipt className="w-7 h-7 text-amber-400" />
            الفواتير والمبيعات
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            استعراض وفتح جميع الفواتير، البحث برقم الفاتورة أو مسح الباركود / QR Code، وإعادة الطباعة
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadOrders()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-medium disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث القائمة
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs font-medium text-slate-400">عدد الفواتير</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.count}</div>
        </div>
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs font-medium text-slate-400">إجمالي المبيعات النشطة</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {formatCurrency(summary.totalSales)}
          </div>
        </div>
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs font-medium text-slate-400">صافي الربح التقديري</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {formatCurrency(summary.totalProfit)}
          </div>
        </div>
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs font-medium text-slate-400">المرتجعات ({summary.returnedCount})</div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            {formatCurrency(summary.returnedTotal)}
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="ابحث برقم الفاتورة، اسم العميل، الهاتف، أو امسح باركود / QR الفاتورة ثم Enter..."
            className="w-full pr-10 pl-10 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              aria-label="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <QrCode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
        </div>

        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
          className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="ALL">كل طرق الدفع</option>
          <option value="CASH">نقدي (Cash)</option>
          <option value="CARD">بطاقة (Card)</option>
          <option value="MIXED">مختلط (Mixed)</option>
          <option value="WALLET">محفظة (Wallet)</option>
        </select>

        <select
          value={returnFilter}
          onChange={(e) => setReturnFilter(e.target.value as ReturnFilter)}
          className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="ALL">كل الحالات</option>
          <option value="ACTIVE">فواتير مكتملة</option>
          <option value="RETURNED">فواتير مرتجعة</option>
        </select>
      </div>

      {/* Invoices Table */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-300 font-semibold">
              <tr>
                <th className="px-4 py-3.5">رقم الفاتورة</th>
                <th className="px-4 py-3.5">التاريخ والوقت</th>
                <th className="px-4 py-3.5">الكاشير</th>
                <th className="px-4 py-3.5">العميل</th>
                <th className="px-4 py-3.5">طريقة الدفع</th>
                <th className="px-4 py-3.5">الأصناف</th>
                <th className="px-4 py-3.5">الإجمالي</th>
                <th className="px-4 py-3.5">الحالة</th>
                <th className="px-4 py-3.5 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    جاري تحميل الفواتير...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    لا توجد فواتير مطابقة للبحث الحالي
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setSelectedInvoice(inv)}
                    className="hover:bg-slate-800/60 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-white">
                      <div className="flex items-center gap-2">
                        <span>{inv.orderNumber}</span>
                        {inv.isLocalUnsynced && (
                          <span className="px-2 py-0.5 text-[10px] font-sans rounded-full bg-amber-950 border border-amber-700 text-amber-300">
                            قيد المزامنة
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                      {formatDateTime(inv.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {inv.cashierName || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {inv.customerName ? (
                        <div>
                          <div className="font-medium text-white">{inv.customerName}</div>
                          {inv.customerPhone && (
                            <div className="text-xs text-slate-400 font-mono">
                              {inv.customerPhone}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">عميل نقدي</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium">
                        {PAYMENT_LABELS[inv.paymentMethod] ?? inv.paymentMethod}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {inv.items.reduce((sum, i) => sum + i.quantity, 0)} قطعة
                    </td>
                    <td className="px-4 py-3 font-bold text-white whitespace-nowrap">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {inv.isReturned ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-950/70 border border-rose-800 text-rose-300 text-xs font-semibold">
                          <RotateCcw className="w-3 h-3" />
                          مرتجع كامل
                        </span>
                      ) : inv.hasPartialReturn ||
                        inv.items.some((i) => (i.returnedQuantity ?? 0) > 0) ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-950/70 border border-amber-700 text-amber-300 text-xs font-semibold">
                          <RotateCcw className="w-3 h-3" />
                          مرتجع جزئي
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          مكتملة
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoice(inv);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        فتح الفاتورة
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedInvoice(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div>
                <div className="flex items-center gap-2.5">
                  <Receipt className="w-5 h-5 text-amber-400" />
                  <h2 className="text-lg font-bold text-white">
                    فاتورة رقم{' '}
                    <span className="font-mono text-amber-400">
                      {selectedInvoice.orderNumber}
                    </span>
                  </h2>
                  {selectedInvoice.isReturned && (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-950 border border-rose-800 text-rose-300 text-xs font-semibold">
                      مرتجع ({selectedInvoice.refundMethod || 'NONE'})
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatDateTime(selectedInvoice.createdAt)} • الكاشير:{' '}
                  {selectedInvoice.cashierName || 'غير محدد'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                aria-label="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Customer & Payment Meta */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-800 p-3.5 bg-slate-950/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1.5">
                    <User className="w-3.5 h-3.5" />
                    بيانات العميل
                  </div>
                  {selectedInvoice.customerName ? (
                    <div className="text-sm space-y-0.5">
                      <div className="font-semibold text-white">
                        {selectedInvoice.customerName}{' '}
                        {selectedInvoice.customerFormattedCode && (
                          <span className="font-mono text-xs text-amber-400">
                            ({selectedInvoice.customerFormattedCode})
                          </span>
                        )}
                      </div>
                      {selectedInvoice.customerPhone && (
                        <div className="text-xs text-slate-400 font-mono">
                          {selectedInvoice.customerPhone}
                        </div>
                      )}
                      <div className="text-xs text-slate-300 pt-1 flex flex-wrap gap-3">
                        <span>النقاط المكتسبة: +{selectedInvoice.pointsEarned}</span>
                        {selectedInvoice.pointsRedeemed > 0 && (
                          <span>النقاط المستبدلة: -{selectedInvoice.pointsRedeemed}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">عميل نقدي (بدون حساب عميل)</div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 p-3.5 bg-slate-950/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1.5">
                    <Wallet className="w-3.5 h-3.5" />
                    ملخص الدفع والربحية
                  </div>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">طريقة الدفع:</span>
                      <span className="font-semibold text-white">
                        {PAYMENT_LABELS[selectedInvoice.paymentMethod] ??
                          selectedInvoice.paymentMethod}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">إجمالي التكلفة:</span>
                      <span className="font-mono text-slate-200">
                        {formatCurrency(selectedInvoiceCostAndProfit.totalCost, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">صافي الربح:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {formatCurrency(selectedInvoiceCostAndProfit.totalProfit, selectedInvoice.currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead className="bg-slate-950/70 text-slate-300 font-semibold text-xs border-b border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2.5">المنتج</th>
                      <th className="px-3.5 py-2.5 text-center">الكمية</th>
                      <th className="px-3.5 py-2.5 text-center">المرتجع</th>
                      <th className="px-3.5 py-2.5">سعر الوحدة</th>
                      <th className="px-3.5 py-2.5">التكلفة</th>
                      <th className="px-3.5 py-2.5">الربح</th>
                      <th className="px-3.5 py-2.5">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {selectedInvoice.items.map((item) => {
                      const returnedQty = selectedInvoice.isReturned
                        ? item.returnedQuantity && item.returnedQuantity > 0
                          ? item.returnedQuantity
                          : item.quantity
                        : item.returnedQuantity ?? 0;
                      const cost = typeof item.costPrice === 'number' ? item.costPrice : null;
                      const profit =
                        cost !== null ? (item.unitPrice - cost) * item.quantity : null;
                      return (
                        <tr
                          key={item.id}
                          className={returnedQty > 0 ? 'bg-rose-950/20' : undefined}
                        >
                          <td className="px-3.5 py-2.5">
                            <div className="font-medium text-white">{item.productName}</div>
                            {item.barcode && (
                              <div className="text-[11px] font-mono text-slate-400">
                                {item.barcode}
                              </div>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 text-center font-semibold text-slate-200">
                            {item.quantity}
                          </td>
                          <td className="px-3.5 py-2.5 text-center">
                            {returnedQty > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-950 border border-rose-800 text-rose-300 text-xs font-semibold">
                                <RotateCcw className="w-3 h-3" />
                                {returnedQty}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-200">
                            {item.unitPrice.toFixed(2)}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-slate-400">
                            {cost !== null ? cost.toFixed(2) : '—'}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono text-emerald-400">
                            {profit !== null ? profit.toFixed(2) : '—'}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono font-bold text-white">
                            {item.lineTotal.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Returned Items Breakdown (shown when any item is returned) */}
              {(() => {
                const returnedList = selectedInvoice.items
                  .map((item) => {
                    const qty = selectedInvoice.isReturned
                      ? item.returnedQuantity && item.returnedQuantity > 0
                        ? item.returnedQuantity
                        : item.quantity
                      : item.returnedQuantity ?? 0;
                    return {
                      ...item,
                      effectiveReturnedQty: qty,
                      effectiveReturnedTotal: Number((qty * item.unitPrice).toFixed(2)),
                    };
                  })
                  .filter((i) => i.effectiveReturnedQty > 0);

                if (returnedList.length === 0) return null;

                const totalReturnedSum = returnedList.reduce(
                  (s, i) => s + i.effectiveReturnedTotal,
                  0
                );

                return (
                  <div className="rounded-xl border border-rose-800/70 bg-rose-950/25 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-bold text-rose-300">
                        <RotateCcw className="w-4 h-4" />
                        الأصناف المرتجعة ({returnedList.length})
                      </div>
                      <span className="text-sm font-mono font-bold text-rose-300">
                        إجمالي المرتجع: {formatCurrency(totalReturnedSum, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div className="divide-y divide-rose-900/40 text-sm">
                      {returnedList.map((r) => (
                        <div
                          key={`ret-${r.id}`}
                          className="py-1.5 flex items-center justify-between gap-3"
                        >
                          <div className="text-slate-200">
                            <span className="font-medium text-white">{r.productName}</span>
                            <span className="text-xs text-rose-300 mr-2">
                              × {r.effectiveReturnedQty} (سعر الوحدة: {r.unitPrice.toFixed(2)})
                            </span>
                          </div>
                          <span className="font-mono font-semibold text-rose-300">
                            -{formatCurrency(r.effectiveReturnedTotal, selectedInvoice.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Totals Breakdown */}
              <div className="rounded-xl border border-slate-800 p-4 bg-slate-950/50 space-y-1.5 text-sm">
                {selectedInvoice.discountFromPoints > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>خصم نقاط الولاء:</span>
                    <span className="font-mono">
                      -{formatCurrency(selectedInvoice.discountFromPoints, selectedInvoice.currency)}
                    </span>
                  </div>
                )}
                {selectedInvoice.walletAmountUsed > 0 && (
                  <div className="flex justify-between text-indigo-400">
                    <span>المدفوع من المحفظة:</span>
                    <span className="font-mono">
                      {formatCurrency(selectedInvoice.walletAmountUsed, selectedInvoice.currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-slate-800">
                  <span>الإجمالي النهائي:</span>
                  <span className="font-mono">
                    {formatCurrency(selectedInvoice.totalAmount, selectedInvoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>المبلغ المدفوع:</span>
                  <span className="font-mono">
                    {formatCurrency(selectedInvoice.paidAmount, selectedInvoice.currency)}
                  </span>
                </div>
                {selectedInvoice.changeGiven > 0 && (
                  <div className="flex justify-between text-slate-300">
                    <span>الباقي للعميل:</span>
                    <span className="font-mono">
                      {formatCurrency(selectedInvoice.changeGiven, selectedInvoice.currency)}
                    </span>
                  </div>
                )}
                {selectedInvoice.changeDepositedToWallet > 0 && (
                  <div className="flex justify-between text-indigo-400">
                    <span>الفكة المضافة للمحفظة:</span>
                    <span className="font-mono">
                      {formatCurrency(selectedInvoice.changeDepositedToWallet, selectedInvoice.currency)}
                    </span>
                  </div>
                )}
              </div>

              {/* Code 128B Barcode + QR Code (kept white background for reliable optical scanning) */}
              <div className="rounded-xl border border-dashed border-slate-700 p-4 flex flex-col items-center justify-center bg-white">
                <InvoiceCodeGraphics orderNumber={selectedInvoice.orderNumber} />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-800 transition"
              >
                إغلاق
              </button>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold transition"
                >
                  <Printer className="w-4 h-4" />
                  طباعة / PDF
                </button>
                <button
                  type="button"
                  disabled={printingThermal}
                  onClick={() => void handleThermalPrint(selectedInvoice)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50 transition"
                >
                  <Printer className="w-4 h-4" />
                  {printingThermal ? 'جاري الطباعة...' : 'طباعة حرارية (80mm)'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

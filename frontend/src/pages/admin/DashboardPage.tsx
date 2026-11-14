import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardList, PackageX, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { CardSkeleton } from '../../components/Skeleton';
import { useData } from '../../context/DataContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { daysUntil } from '../../lib/dates';

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{label}</p>
        <Icon size={18} className={tone} />
      </div>
      <p className={`text-2xl font-extrabold mt-1 ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { overview, overviewLoading, overviewError, reloadOverview } = useAdminContext();
  const { products, offlineQueue } = useData();

  const nearExpiry = useMemo(
    () =>
      products.reduce(
        (n, p) => n + p.batches.filter((b) => b.quantity > 0 && daysUntil(b.expiryDate) <= 30).length,
        0
      ),
    [products]
  );
  const lowStock = products.filter((p) => p.totalStock <= p.minStockAlert).length;
  const localRevenue = offlineQueue.reduce((s, o) => s + o.totalAmount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-white">الرئيسية</h1>
        <button
          type="button"
          onClick={reloadOverview}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
        >
          <RefreshCw size={14} className={overviewLoading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {overviewError && (
        <p className="text-xs text-amber-300 bg-amber-950/50 border border-amber-800 rounded-lg px-3 py-2">
          تعذر جلب أرقام السحابة ({overviewError}) — تُعرض البيانات المحلية لهذا الجهاز فقط.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : overview ? (
          <>
            <Kpi icon={Wallet} label="إيرادات اليوم (السحابة)" value={`${overview.todayRevenue.toFixed(2)} ج.م`} hint={`${overview.todayOrdersCount} فاتورة`} tone="text-emerald-400" />
            <Kpi icon={TrendingUp} label="صافي ربح اليوم" value={`${overview.todayNetProfit.toFixed(2)} ج.م`} tone="text-cyan-400" />
            <Kpi icon={ClipboardList} label="الورديات النشطة" value={String(overview.activeShiftsCount)} hint={overview.activeShifts.map((s) => s.cashierName).join('، ') || undefined} tone="text-emerald-400" />
            <Kpi icon={AlertTriangle} label="دفعات قاربت على الانتهاء (30 يوم)" value={String(nearExpiry)} tone="text-amber-400" />
          </>
        ) : (
          <>
            <Kpi icon={Wallet} label="مبيعات هذا الجهاز (محلي)" value={`${localRevenue.toFixed(2)} ج.م`} hint={`${offlineQueue.length} فاتورة`} tone="text-emerald-400" />
            <Kpi icon={AlertTriangle} label="دفعات قاربت على الانتهاء (30 يوم)" value={String(nearExpiry)} tone="text-amber-400" />
            <Kpi icon={PackageX} label="أصناف مخزونها منخفض" value={String(lowStock)} tone="text-rose-400" />
          </>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white">آخر الفواتير على هذا الجهاز</h2>
          <Link to="/admin/shifts" className="text-xs text-cyan-300 hover:underline">الورديات والجرد</Link>
        </div>
        {offlineQueue.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد فواتير محلية بعد.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {offlineQueue.slice(0, 6).map((o) => (
              <li key={o.orderNumber} className="py-2 flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-slate-300">{o.orderNumber}</span>
                <span className="text-xs text-slate-500">{o.paymentMethod}</span>
                <span className="font-bold text-emerald-400">{o.totalAmount.toFixed(2)} ج.م</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${o.synced ? 'border-emerald-700 text-emerald-300' : 'border-amber-700 text-amber-300'}`}>
                  {o.synced ? 'تمت المزامنة' : 'بانتظار المزامنة'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;


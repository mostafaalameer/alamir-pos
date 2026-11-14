import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DownloadButton } from '../../components/DownloadButton';
import { CardSkeleton } from '../../components/Skeleton';
import { PnlSummary, fetchPnl } from '../../lib/cloud';

const inputCls =
  'bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm text-white outline-none';

export function ReportsPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPnl(startDate || undefined, endDate ? `${endDate}T23:59:59.999Z` : undefined)
      .then((data) => !cancelled && setPnl(data))
      .catch((err: unknown) => {
        if (cancelled) return;
        setPnl(null);
        toast.error(err instanceof Error ? err.message : 'تعذر حساب تقرير الأرباح');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const range = `${startDate ? `?startDate=${startDate}` : ''}${
    endDate ? `${startDate ? '&' : '?'}endDate=${endDate}T23:59:59.999Z` : ''
  }`;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-white">التقارير والتصدير</h1>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-300 space-y-1">
          <span className="block">من تاريخ</span>
          <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span className="block">إلى تاريخ</span>
          <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : pnl ? (
          <>
            <Stat label="إجمالي الإيرادات" value={`${pnl.grossRevenue.toFixed(2)} ج.م`} tone="text-emerald-400" />
            <Stat label="تكلفة البضاعة المباعة" value={`${pnl.totalCostOfGoodsSold.toFixed(2)} ج.م`} tone="text-slate-200" />
            <Stat label="صافي الربح" value={`${pnl.netProfit.toFixed(2)} ج.م`} hint={`هامش ${pnl.profitMarginPercent}%`} tone="text-cyan-400" />
            <Stat label="المرتجعات" value={`${pnl.returnedOrdersValue.toFixed(2)} ج.م`} hint={`${pnl.returnedOrdersCount} فاتورة`} tone="text-rose-400" />
          </>
        ) : (
          <p className="col-span-full text-xs text-amber-300 bg-amber-950/50 border border-amber-800 rounded-lg px-3 py-2">
            لا تتوفر أرقام الأرباح حالياً (تتطلب اتصالاً بالسحابة وجلسة إدارة).
          </p>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-white mb-3">تصدير Excel (.xlsx)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <DownloadButton path={`/api/reports/sales/excel${range}`} fileName="alamir-sales-report.xlsx" label="تقرير المبيعات والأرباح" />
          <DownloadButton path="/api/reports/inventory/excel" fileName="alamir-inventory-report.xlsx" label="جرد المخزون والصلاحية" />
          <DownloadButton path={`/api/reports/shifts/excel${range}`} fileName="alamir-shifts-report.xlsx" label="سجل الورديات والعجز" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export default ReportsPage;


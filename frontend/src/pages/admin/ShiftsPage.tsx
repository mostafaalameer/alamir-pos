import { Clock, Wallet } from 'lucide-react';
import { Skeleton } from '../../components/Skeleton';
import { LOCAL_SHIFT_ID, LOCAL_STARTING_CASH, useData } from '../../context/DataContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { DownloadButton } from '../../components/DownloadButton';
import { LocalSqliteBridge } from '../../lib/offlineSqlite';

const statusOf = (d: number) =>
  d === 0
    ? { label: 'مطابق', cls: 'text-emerald-300 border-emerald-700' }
    : d > 0
    ? { label: 'فائض', cls: 'text-cyan-300 border-cyan-700' }
    : { label: 'عجز', cls: 'text-rose-300 border-rose-700' };

export function ShiftsPage() {
  const { overview, overviewLoading, overviewError } = useAdminContext();
  const { closedShifts, localShiftActive, offlineQueue } = useData();

  const localCash = offlineQueue
    .filter((o) => o.paymentMethod === 'CASH')
    .reduce((s, o) => s + o.totalAmount, 0);

  const localChangeToWallets = offlineQueue.reduce(
    (s, o) => s + Number(o.changeDepositedToWallet ?? 0),
    0
  );
  const localWalletRedemptions = offlineQueue.reduce(
    (s, o) => s + Number(o.walletAmountUsed ?? 0),
    0
  );
  const shiftMovements = LocalSqliteBridge.getCashMovements(LOCAL_SHIFT_ID);
  const totalCashIn = shiftMovements
    .filter((m) => m.type === 'CASH_IN')
    .reduce((s, m) => s + m.amount, 0);
  const totalCashOut = shiftMovements
    .filter((m) => m.type === 'CASH_OUT')
    .reduce((s, m) => s + m.amount, 0);
  const localExpectedDrawerCash = Number(
    (
      LOCAL_STARTING_CASH +
      localCash +
      localChangeToWallets -
      localWalletRedemptions +
      totalCashIn -
      totalCashOut
    ).toFixed(2)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-white">الورديات والجرد اليومي (Z-Report)</h1>
        <DownloadButton
          path="/api/reports/shifts/excel"
          fileName="alamir-shifts-report.xlsx"
          label="تصدير سجل الورديات (.xlsx)"
        />
      </div>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h2 className="text-sm font-bold text-white mb-3">الورديات النشطة (السحابة)</h2>
        {overviewLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : overview ? (
          overview.activeShifts.length === 0 ? (
            <p className="text-xs text-slate-500">لا توجد ورديات مفتوحة حالياً.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {overview.activeShifts.map((s) => (
                <li
                  key={s.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="flex items-center gap-2 text-white font-semibold">
                    <Clock size={14} className="text-cyan-400" />
                    {s.cashierName}
                  </span>
                  <span className="text-xs text-slate-400">
                    عهدة: {s.startingCash.toFixed(2)} ج.م
                  </span>
                  <span className="text-xs text-slate-500">
                    فُتحت: {new Date(s.openedAt).toLocaleString('ar-EG')}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-xs text-amber-300">
            تعذر جلب الورديات من السحابة ({overviewError}).
          </p>
        )}
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Wallet size={16} className="text-cyan-400" />
            وردية هذا الجهاز (ملخص الجرد ومحفظة الفكة)
          </h2>
          <span className="text-xs font-mono text-slate-400">
            {LOCAL_SHIFT_ID} — {localShiftActive ? 'نشطة' : 'مغلقة'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <span className="text-slate-400 block">عهدة البداية</span>
            <span className="font-bold text-white text-sm">
              {LOCAL_STARTING_CASH.toFixed(2)} ج.م
            </span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <span className="text-slate-400 block">مبيعات نقدية</span>
            <span className="font-bold text-emerald-400 text-sm">
              {localCash.toFixed(2)} ج.م
            </span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <span className="text-slate-400 block">إجمالي الفكة المحفوظة بالمحافظ</span>
            <span className="font-bold text-cyan-400 text-sm">
              +{localChangeToWallets.toFixed(2)} ج.م
            </span>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <span className="text-slate-400 block">إجمالي المدفوعات من المحافظ</span>
            <span className="font-bold text-amber-400 text-sm">
              -{localWalletRedemptions.toFixed(2)} ج.م
            </span>
          </div>
          <div className="bg-slate-950 border border-emerald-800/50 rounded-lg p-2.5">
            <span className="text-slate-300 block font-semibold">النقدية المتوقعة بالدرج</span>
            <span className="font-extrabold text-emerald-300 text-sm">
              {localExpectedDrawerCash.toFixed(2)} ج.م
            </span>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-3">
          الورديات المغلقة على هذا الجهاز (جرد النقدية وتقارير Z)
        </h2>
        {closedShifts.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد ورديات مغلقة بعد.</p>
        ) : (
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-800">
                <th className="py-2 px-2">الوردية</th>
                <th className="py-2 px-2">أُغلقت</th>
                <th className="py-2 px-2">فكة للمحافظ</th>
                <th className="py-2 px-2">مسدد من المحافظ</th>
                <th className="py-2 px-2">المتوقع بالدرج</th>
                <th className="py-2 px-2">الفعلي</th>
                <th className="py-2 px-2">الفرق</th>
                <th className="py-2 px-2">المزامنة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {closedShifts.map((s, i) => {
                const st = statusOf(s.discrepancy);
                return (
                  <tr key={`${s.shiftId}-${i}`}>
                    <td className="py-2 px-2 font-mono text-xs">{s.shiftId}</td>
                    <td className="py-2 px-2 text-xs">
                      {new Date(s.closedAt).toLocaleString('ar-EG')}
                    </td>
                    <td className="py-2 px-2 text-cyan-300 font-semibold">
                      +{Number(s.totalChangeCreditedToWallets ?? 0).toFixed(2)} ج.م
                    </td>
                    <td className="py-2 px-2 text-amber-300 font-semibold">
                      -{Number(s.totalWalletRedemptions ?? 0).toFixed(2)} ج.م
                    </td>
                    <td className="py-2 px-2 font-bold">{s.expectedCash.toFixed(2)} ج.م</td>
                    <td className="py-2 px-2">{s.actualEndCash.toFixed(2)} ج.م</td>
                    <td className="py-2 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${st.cls}`}>
                        {s.discrepancy.toFixed(2)} ({st.label})
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs">{s.synced ? 'تمت' : 'بالانتظار'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default ShiftsPage;

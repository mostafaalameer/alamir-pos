import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { daysUntil } from '../../lib/dates';

const WINDOWS = [30, 60, 90] as const;

export function ExpiryPage() {
  const { products } = useData();
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30);

  const entries = products
    .flatMap((product) =>
      product.batches
        .filter((b) => b.quantity > 0)
        .map((batch) => ({ product, batch, days: daysUntil(batch.expiryDate) }))
    )
    .filter((e) => e.days <= windowDays)
    .sort((a, b) => a.days - b.days);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-white">تنبيهات الصلاحية</h1>
        <div className="flex gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowDays(w)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${windowDays === w ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            >
              خلال {w} يوم
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
          لا توجد تشغيلات تنتهي صلاحيتها خلال {windowDays} يوماً.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {entries.map(({ product, batch, days }) => (
            <div
              key={batch.id}
              className={`bg-slate-900 border rounded-xl p-3 ${days <= 0 ? 'border-rose-700/70' : 'border-amber-700/50'}`}
            >
              <p className="font-bold text-sm text-white">{product.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                تشغيلة {batch.batchNumber} • المتبقي {batch.quantity} {product.weightUnit}
              </p>
              <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-300">ينتهي: {batch.expiryDate}</span>
                <span className={`px-2 py-0.5 rounded-full border font-bold ${days <= 0 ? 'bg-rose-950 text-rose-300 border-rose-700' : 'bg-amber-950 text-amber-300 border-amber-700'}`}>
                  {days <= 0 ? 'منتهي الصلاحية' : `متبقي ${days} يوم`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExpiryPage;


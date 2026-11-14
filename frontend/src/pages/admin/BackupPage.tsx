import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  HardDriveDownload,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  exportDatabaseBackupCloud,
  FullDatabaseBackupPayload,
  restoreDatabaseBackupCloud,
} from '../../lib/cloud';
import { LocalSqliteBridge } from '../../lib/offlineSqlite';
import { useData } from '../../context/DataContext';

const TABLE_LABELS: Record<string, string> = {
  users: 'المستخدمون (Users)',
  loyaltySettings: 'إعدادات الولاء',
  customers: 'العملاء',
  products: 'المنتجات',
  productBatches: 'دفعات المخزون',
  shifts: 'الورديات',
  orders: 'الفواتير',
  orderItems: 'أصناف الفواتير',
  loyaltyTransactions: 'حركات النقاط',
  walletTransactions: 'حركات المحفظة',
  creditTransactions: 'حركات الآجل',
  cashMovements: 'حركات الخزينة',
  auditLogs: 'سجل التدقيق',
};

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BackupPage() {
  const { refreshCatalogFromCloud } = useData();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [lastBackup, setLastBackup] = useState<FullDatabaseBackupPayload | null>(null);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<FullDatabaseBackupPayload | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoredCounts, setRestoredCounts] = useState<Record<string, number> | null>(null);

  const handleExportCloudBackup = async () => {
    setExporting(true);
    try {
      const backup = await exportDatabaseBackupCloud();
      setLastBackup(backup);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJsonFile(backup, `alamir-pos-backup-${stamp}.json`);
      toast.success('تم تصدير وتحميل النسخة الاحتياطية الكاملة بنجاح');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'تعذر تصدير النسخة الاحتياطية من قاعدة البيانات'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleExportLocalSnapshot = () => {
    try {
      const snapshot = LocalSqliteBridge.createLocalBackupSnapshot();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadJsonFile(snapshot, `alamir-pos-local-snapshot-${stamp}.json`);
      toast.success('تم حفظ وتحميل نسخة الجهاز المحلي بنجاح');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تصدير النسخة المحلية');
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as FullDatabaseBackupPayload;
      if (
        !parsed ||
        parsed.format !== 'alamir-pos-full-backup' ||
        !parsed.tables ||
        typeof parsed.tables !== 'object'
      ) {
        toast.error('الملف المختار ليس ملف نسخة احتياطية صالح لنظام الأمير POS');
        setPendingRestore(null);
        setSelectedFileName(null);
        return;
      }
      setPendingRestore(parsed);
      setSelectedFileName(file.name);
      setConfirmChecked(false);
      setRestoredCounts(null);
      toast.success(`تم قراءة ملف النسخة الاحتياطية: ${file.name}`);
    } catch {
      toast.error('تعذر قراءة الملف — تأكد من أنه ملف JSON صحيح');
      setPendingRestore(null);
      setSelectedFileName(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRestore = async () => {
    if (!pendingRestore || !confirmChecked) return;
    setRestoring(true);
    try {
      const res = await restoreDatabaseBackupCloud(pendingRestore);
      setRestoredCounts(res.restoredCounts);
      toast.success('تمت استعادة قاعدة البيانات بالكامل بنجاح');
      await refreshCatalogFromCloud(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'فشلت استعادة قاعدة البيانات'
      );
    } finally {
      setRestoring(false);
    }
  };

  const renderCountsGrid = (counts: Record<string, number>) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
      {Object.entries(counts).map(([key, count]) => (
        <div
          key={key}
          className="rounded-xl bg-slate-950/70 border border-slate-800 px-3 py-2 flex items-center justify-between gap-2"
        >
          <span className="text-xs text-slate-300">{TABLE_LABELS[key] ?? key}</span>
          <span className="text-sm font-mono font-bold text-amber-400">{count}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
          <Database className="w-7 h-7 text-amber-400" />
          النسخ الاحتياطي والاستعادة
        </h1>
        <p className="text-sm text-slate-300 mt-1">
          تصدير نسخة احتياطية كاملة لجميع جداول قاعدة البيانات بصيغة JSON، واستعادتها في أي وقت
        </p>
      </div>

      {/* Section 1: Export Backup */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-400" />
              إنشاء نسخة احتياطية كاملة (Backup)
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              تشمل المستخدمين، المنتجات، الدفعات، العملاء، الفواتير، الورديات، حركات النقاط والمحفظة والخزينة وسجل التدقيق.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportLocalSnapshot}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium transition"
            >
              <HardDriveDownload className="w-4 h-4" />
              نسخة الجهاز المحلي
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void handleExportCloudBackup()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'جاري التصدير...' : 'تحميل نسخة قاعدة البيانات (.json)'}
            </button>
          </div>
        </div>

        {lastBackup && (
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-emerald-300">
              <span className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                آخر نسخة تم تصديرها: {new Date(lastBackup.exportedAt).toLocaleString('ar-EG')}
              </span>
              {lastBackup.exportedBy && (
                <span className="text-slate-400">بواسطة: {lastBackup.exportedBy}</span>
              )}
            </div>
            {renderCountsGrid(lastBackup.counts)}
          </div>
        )}
      </div>

      {/* Section 2: Restore Backup */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-amber-400" />
            استعادة قاعدة البيانات (Restore)
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            اختر ملف نسخة احتياطية (<span className="font-mono text-slate-300">.json</span>) تم تصديره مسبقاً لاستعادة جميع البيانات.
          </p>
        </div>

        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3.5 flex items-start gap-3 text-xs text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">تنبيه هام:</span> عملية الاستعادة تستبدل البيانات الحالية في قاعدة البيانات بالبيانات الموجودة داخل ملف النسخة الاحتياطية. يُنصح بأخذ نسخة احتياطية جديدة قبل الاستعادة.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handleFileSelected(e)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-medium transition"
          >
            <Upload className="w-4 h-4 text-amber-400" />
            اختيار ملف النسخة الاحتياطية (.json)
          </button>
          {selectedFileName && (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-300 font-mono">
              <FileJson className="w-4 h-4 text-amber-400" />
              {selectedFileName}
            </span>
          )}
        </div>

        {pendingRestore && (
          <div className="pt-4 border-t border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>
                تاريخ النسخة:{' '}
                <strong className="text-white">
                  {new Date(pendingRestore.exportedAt).toLocaleString('ar-EG')}
                </strong>
              </span>
              {pendingRestore.exportedBy && (
                <span>
                  المُصدِر: <strong className="text-white">{pendingRestore.exportedBy}</strong>
                </span>
              )}
            </div>

            {renderCountsGrid(pendingRestore.counts || {})}

            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-950 text-amber-500 focus:ring-amber-500"
              />
              أؤكد رغبتي في استبدال قاعدة البيانات الحالية بمحتوى هذا الملف
            </label>

            <div>
              <button
                type="button"
                disabled={!confirmChecked || restoring}
                onClick={() => void handleRestore()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <RotateCcw className={`w-4 h-4 ${restoring ? 'animate-spin' : ''}`} />
                {restoring ? 'جاري الاستعادة...' : 'استعادة قاعدة البيانات الآن'}
              </button>
            </div>
          </div>
        )}

        {restoredCounts && (
          <div className="pt-4 border-t border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              تمت الاستعادة بنجاح — السجلات المستعادة:
            </div>
            {renderCountsGrid(restoredCounts)}
          </div>
        )}
      </div>
    </div>
  );
}


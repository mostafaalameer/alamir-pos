import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadReport } from '../lib/auth';

export function DownloadButton({
  path,
  fileName,
  label,
  className = '',
}: {
  path: string;
  fileName: string;
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await downloadReport(path, fileName);
      toast.success('تم تحميل التقرير بنجاح');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'تعذر تحميل التقرير');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={`flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-xs font-bold px-3 py-2 rounded-lg ${className}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </button>
  );
}


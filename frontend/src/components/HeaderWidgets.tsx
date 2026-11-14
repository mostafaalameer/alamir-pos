import { Link } from 'react-router-dom';
import { Cloud, CloudOff, LogOut, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';

/** Online/offline indicator; click to push queued orders to the cloud. */
export function SyncBadge() {
  const { isOnline, pendingCount, syncing, syncNow } = useData();
  const Icon = syncing ? RefreshCw : isOnline ? Cloud : CloudOff;
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={syncing}
      title={isOnline ? 'متصل — اضغط للمزامنة' : 'غير متصل — العمل محلياً'}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
        isOnline
          ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
          : 'bg-amber-950/70 border-amber-700 text-amber-300'
      }`}
    >
      <Icon size={14} className={syncing ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{isOnline ? 'متصل' : 'أوفلاين'}</span>
      {pendingCount > 0 && (
        <span className="px-1.5 rounded-full bg-slate-950/60 text-[10px]">{pendingCount} معلّق</span>
      )}
    </button>
  );
}

export function ShiftBadge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
        active
          ? 'bg-cyan-950/70 border-cyan-700 text-cyan-300'
          : 'bg-slate-800 border-slate-700 text-slate-400'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} />
      {label ?? (active ? 'وردية نشطة' : 'لا توجد وردية نشطة')}
    </span>
  );
}

export function UserBadge() {
  const { session, signOut } = useAuth();
  if (!session) return null;
  const isAdmin = session.user.role === 'ADMIN';
  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
        {isAdmin ? <ShieldCheck size={14} className="text-emerald-400" /> : <User size={14} className="text-cyan-400" />}
        <span className="text-xs text-white font-semibold">{session.user.name}</span>
        <span className="text-[10px] text-slate-400">{isAdmin ? 'مدير' : 'كاشير'}</span>
      </div>
      <button
        type="button"
        onClick={signOut}
        title="تسجيل الخروج"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-200"
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">تسجيل الخروج</span>
      </button>
    </div>
  );
}

export function BackToAdminLink() {
  const { session } = useAuth();
  if (session?.user.role !== 'ADMIN') return null;
  return (
    <Link
      to="/admin"
      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300"
    >
      لوحة الإدارة
    </Link>
  );
}


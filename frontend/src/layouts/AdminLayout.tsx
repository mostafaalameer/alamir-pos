import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  Clock,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  ShoppingCart,
  Store,
  Users,
} from 'lucide-react';
import { ShiftBadge, SyncBadge, UserBadge } from '../components/HeaderWidgets';
import { useData } from '../context/DataContext';
import { Overview, fetchOverview } from '../lib/cloud';

export interface AdminOutletContext {
  overview: Overview | null;
  overviewLoading: boolean;
  overviewError: string | null;
  reloadOverview: () => void;
}

export const useAdminContext = () => useOutletContext<AdminOutletContext>();

const NAV = [
  { to: '/admin', label: 'الرئيسية', sub: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/products', label: 'المنتجات والمخزون', sub: 'Products & Batches', icon: Package },
  { to: '/admin/invoices', label: 'الفواتير والمبيعات', sub: 'Invoices', icon: Receipt },
  { to: '/admin/expiry', label: 'تنبيهات الصلاحية', sub: 'Expiry Alerts', icon: AlertTriangle },
  { to: '/admin/shifts', label: 'الورديات والجرد اليومي', sub: 'Shifts & Reconciliation', icon: Clock },
  { to: '/admin/loyalty', label: 'نقاط الولاء والعملاء', sub: 'Loyalty & Rewards', icon: Award },
  { to: '/admin/reports', label: 'التقارير والتصدير', sub: 'Reports & Excel', icon: FileSpreadsheet },
  { to: '/admin/users', label: 'المستخدمون والصلاحيات', sub: 'Users & Passwords', icon: Users },
  { to: '/admin/backup', label: 'النسخ الاحتياطي', sub: 'Backup & Restore', icon: Database },
];

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

export function AdminLayout() {
  const navigate = useNavigate();
  const { localShiftActive } = useData();
  const [open, setOpen] = useState<boolean>(isDesktop);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const reloadOverview = useCallback(() => {
    setOverviewLoading(true);
    setOverviewError(null);
    fetchOverview()
      .then(setOverview)
      .catch((err: unknown) => {
        setOverview(null);
        setOverviewError(err instanceof Error ? err.message : 'تعذر جلب البيانات من السحابة');
      })
      .finally(() => setOverviewLoading(false));
  }, []);

  useEffect(() => {
    reloadOverview();
  }, [reloadOverview]);

  const closeOnMobile = () => {
    if (!isDesktop()) setOpen(false);
  };

  // Prefer the cloud count; fall back to the local POS shift when the cloud is unreachable.
  const shiftActive = overview ? overview.activeShiftsCount > 0 : localShiftActive;
  const shiftLabel = overview
    ? overview.activeShiftsCount > 0
      ? `${overview.activeShiftsCount} وردية نشطة`
      : 'لا توجد وردية نشطة'
    : localShiftActive
    ? 'وردية محلية نشطة'
    : 'لا توجد وردية نشطة';

  return (
    <div dir="rtl" className="min-h-screen bg-brand-black text-brand-white flex">
      {open && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-30"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: full on desktop, icon-only dock on mobile (expands as overlay) */}
      <aside
        aria-label="التنقل الرئيسي"
        className={`${open ? 'w-64' : 'w-16'} fixed md:sticky top-0 right-0 h-screen z-40 shrink-0 bg-brand-surface border-l border-brand-border flex flex-col transition-[width] duration-200`}
      >
        <div className="h-16 flex items-center gap-3 px-3 border-b border-brand-border overflow-hidden">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-brand-orange flex items-center justify-center shadow-md shadow-brand-orange/25">
            <Store size={20} className="text-brand-white" />
          </div>
          {open && (
            <div className="whitespace-nowrap">
              <p className="text-sm font-extrabold text-brand-white">ماركت الأمير</p>
              <p className="text-[11px] text-brand-tangerine">Alamir POS</p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {NAV.map(({ to, label, sub, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={closeOnMobile}
              title={label}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? 'bg-brand-orange/20 text-brand-tangerine border border-brand-orange/50'
                    : 'text-brand-muted hover:text-brand-white hover:bg-brand-border border border-transparent'
                }`
              }
            >
              <Icon size={20} className="shrink-0" />
              {open && (
                <span className="whitespace-nowrap leading-tight">
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-[10px] text-brand-muted">{sub}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-brand-border">
          <button
            type="button"
            onClick={() => navigate('/pos')}
            title="شاشة البيع"
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold bg-brand-orange hover:bg-brand-amber text-brand-white"
          >
            <ShoppingCart size={20} className="shrink-0" />
            {open && <span className="whitespace-nowrap">شاشة البيع (POS)</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 pr-16 md:pr-0">
        <header className="sticky top-0 z-20 h-16 flex items-center justify-between gap-2 px-3 sm:px-4 bg-brand-surface/90 backdrop-blur border-b border-brand-border">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="فتح/إغلاق القائمة الجانبية"
            aria-expanded={open}
            className="p-2 rounded-lg bg-brand-black hover:bg-brand-border border border-brand-border"
          >
            <Menu size={18} />
          </button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <ShiftBadge active={shiftActive} label={shiftLabel} />
            <SyncBadge />
            <UserBadge />
          </div>
        </header>

        <main className="p-3 sm:p-4 max-w-7xl mx-auto">
          <Outlet context={{ overview, overviewLoading, overviewError, reloadOverview } satisfies AdminOutletContext} />
        </main>
      </div>
    </div>
  );
}

export default AdminLayout;


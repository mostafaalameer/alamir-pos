import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  Coins,
  CreditCard,
  FileText,
  History,
  Lock,
  Phone,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { LOCAL_SHIFT_ID, useData } from '../../context/DataContext';
import {
  createCustomerCloud,
  fetchAuditLogsCloud,
  fetchCustomerStatementCloud,
  fetchCustomers,
  fetchLoyaltySettings,
  settleCustomerDebtCloud,
  updateCustomerCreditLimitCloud,
  updateLoyaltySettings,
} from '../../lib/cloud';
import {
  LocalAuditLog,
  LocalCustomer,
  LocalLoyaltySettings,
  LocalSqliteBridge,
  formatCustomerCode,
  getCustomerDisplayName,
  parseCustomerCodeInput,
} from '../../lib/offlineSqlite';

type ActiveTab = 'loyalty' | 'credit' | 'audit';

export function LoyaltyPage() {
  const {
    loyaltySettings,
    setLoyaltySettings,
    customers,
    setCustomers,
    refreshLocal,
  } = useData();

  const [activeTab, setActiveTab] = useState<ActiveTab>('loyalty');
  const [form, setForm] = useState<LocalLoyaltySettings>(() => loyaltySettings);
  const [saving, setSaving] = useState(false);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<LocalCustomer | null>(null);

  // New Customer inline state
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerCreditLimit, setNewCustomerCreditLimit] = useState('0');
  const [addingCustomer, setAddingCustomer] = useState(false);

  // Credit Limit Modal state
  const [creditLimitModalCustomer, setCreditLimitModalCustomer] = useState<LocalCustomer | null>(null);
  const [newLimitInput, setNewLimitInput] = useState('');
  const [updatingLimit, setUpdatingLimit] = useState(false);

  // Debt Settlement Modal state
  const [settlementCustomer, setSettlementCustomer] = useState<LocalCustomer | null>(null);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [submittingSettlement, setSubmittingSettlement] = useState(false);

  // Statement Modal state
  const [statementCustomer, setStatementCustomer] = useState<LocalCustomer | null>(null);
  const [statementData, setStatementData] = useState<any | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<LocalAuditLog[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [auditSearchQuery, setAuditSearchQuery] = useState('');

  // Selected customer sub-tab in details
  const [customerDetailTab, setCustomerDetailTab] = useState<'credit' | 'wallet' | 'loyalty'>('credit');

  useEffect(() => {
    setForm(loyaltySettings);
  }, [loyaltySettings]);

  const syncFromCloud = async () => {
    setLoadingCloud(true);
    try {
      const [cloudSettings, cloudCustomers] = await Promise.all([
        fetchLoyaltySettings(),
        fetchCustomers(),
      ]);
      setLoyaltySettings(cloudSettings);
      setForm(cloudSettings);
      setCustomers(cloudCustomers);
      toast.success('تم تحديث إعدادات الولاء وسجل العملاء من السحابة');
    } catch {
      refreshLocal();
    } finally {
      setLoadingCloud(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoadingAuditLogs(true);
    try {
      const cloudLogs = await fetchAuditLogsCloud();
      setAuditLogs(cloudLogs);
    } catch {
      setAuditLogs(LocalSqliteBridge.getAuditLogs());
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    void syncFromCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      void loadAuditLogs();
    }
  }, [activeTab]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.spendAmountPerPoint <= 0) {
      toast.error('قيمة الإنفاق لكل نقطة يجب أن تكون أكبر من صفر');
      return;
    }
    if (form.redemptionPointsBlock <= 0 || form.redemptionDiscountAmount <= 0) {
      toast.error('يرجى إدخال قيم صحيحة لمعدل استبدال النقاط');
      return;
    }
    if (form.minPointsToRedeem < 0) {
      toast.error('الحد الأدنى للاستبدال لا يمكن أن يكون سالباً');
      return;
    }
    if (form.maxDiscountCapPercent < 1 || form.maxDiscountCapPercent > 100) {
      toast.error('الحد الأقصى لنسبة الخصم يجب أن يكون بين 1% و 100%');
      return;
    }

    setSaving(true);
    try {
      const saved = await updateLoyaltySettings({
        isEnabled: form.isEnabled,
        spendAmountPerPoint: Number(form.spendAmountPerPoint),
        redemptionPointsBlock: Math.round(Number(form.redemptionPointsBlock)),
        redemptionDiscountAmount: Number(form.redemptionDiscountAmount),
        minPointsToRedeem: Math.round(Number(form.minPointsToRedeem)),
        maxDiscountCapPercent: Math.round(Number(form.maxDiscountCapPercent)),
      });
      setLoyaltySettings(saved);
      toast.success('تم حفظ قواعد برنامج نقاط الولاء ومزامنتها مع السحابة ونقاط البيع');
    } catch {
      const localSaved = LocalSqliteBridge.saveLoyaltySettings(form);
      setLoyaltySettings(localSaved);
      toast.warning('تم حفظ إعدادات الولاء محلياً (سيتم تطبيقها فوراً على الكاشير)');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerPhone.trim()) {
      toast.error('يرجى إدخال رقم هاتف العميل');
      return;
    }

    const cleanName = newCustomerName.trim() || null;
    const initialCreditLimit = parseFloat(newCustomerCreditLimit) || 0;

    setAddingCustomer(true);
    try {
      const created = await createCustomerCloud({
        name: cleanName,
        phone: newCustomerPhone.trim(),
      });
      if (initialCreditLimit > 0) {
        await updateCustomerCreditLimitCloud(created.id, initialCreditLimit);
        created.creditLimit = initialCreditLimit;
      }
      refreshLocal();
      setSelectedCustomer(created);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerCreditLimit('0');
      toast.success(
        `تم تسجيل العميل "${getCustomerDisplayName(created)}" (${formatCustomerCode(created.customerCode)}) بنجاح`
      );
    } catch {
      const localCreated = LocalSqliteBridge.createOrUpdateCustomerLocal({
        name: cleanName,
        phone: newCustomerPhone.trim(),
        creditLimit: initialCreditLimit,
        synced: false,
      });
      refreshLocal();
      setSelectedCustomer(localCreated);
      setNewCustomerName('');
      setNewCustomerPhone('');
      setNewCustomerCreditLimit('0');
      toast.success(
        `تم تسجيل العميل "${getCustomerDisplayName(localCreated)}" (${formatCustomerCode(localCreated.customerCode)}) محلياً`
      );
    } finally {
      setAddingCustomer(false);
    }
  };

  const handleUpdateCreditLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditLimitModalCustomer) return;
    const limit = parseFloat(newLimitInput);
    if (isNaN(limit) || limit < 0) {
      toast.error('يرجى إدخال حد ائتماني صالح (صفر أو أكثر)');
      return;
    }

    setUpdatingLimit(true);
    try {
      const updated = await updateCustomerCreditLimitCloud(creditLimitModalCustomer.id, limit);
      LocalSqliteBridge.updateCustomerCreditLimitLocal(creditLimitModalCustomer.id, limit);
      refreshLocal();
      if (selectedCustomer?.id === updated.id) {
        setSelectedCustomer((prev) => (prev ? { ...prev, creditLimit: updated.creditLimit } : null));
      }
      toast.success(`تم تحديث الحد الائتماني للعميل إلى ${limit.toFixed(2)} ج.م بنجاح`);
      setCreditLimitModalCustomer(null);
    } catch {
      const localUpdated = LocalSqliteBridge.updateCustomerCreditLimitLocal(creditLimitModalCustomer.id, limit);
      refreshLocal();
      if (localUpdated && selectedCustomer?.id === localUpdated.id) {
        setSelectedCustomer(localUpdated);
      }
      toast.warning('تم حفظ الحد الائتماني محلياً وسيرسل للسحابة');
      setCreditLimitModalCustomer(null);
    } finally {
      setUpdatingLimit(false);
    }
  };

  const handleSettleDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlementCustomer) return;
    const amount = parseFloat(settlementAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('يرجى إدخال مبلغ سداد صحيح أكبر من صفر');
      return;
    }
    const currentDebt = Number(settlementCustomer.creditBalance || 0);
    if (amount > currentDebt) {
      toast.error(`مبلغ السداد (${amount.toFixed(2)} ج.م) أكبر من إجمالي الدين المستحق (${currentDebt.toFixed(2)} ج.م)`);
      return;
    }

    setSubmittingSettlement(true);
    try {
      const res: any = await settleCustomerDebtCloud(
        settlementCustomer.id,
        amount,
        settlementNotes || undefined,
        LOCAL_SHIFT_ID
      );
      LocalSqliteBridge.settleCustomerDebtLocal({
        customerId: settlementCustomer.id,
        amount,
        notes: settlementNotes,
        shiftId: LOCAL_SHIFT_ID,
      });
      refreshLocal();
      const updatedCust = res?.data?.customer || res?.customer;
      if (updatedCust && selectedCustomer?.id === updatedCust.id) {
        setSelectedCustomer(updatedCust);
      }
      toast.success(`تم سداد ${amount.toFixed(2)} ج.م من حساب العميل وتسجيلها في درج الكاشير`);
      setSettlementCustomer(null);
      setSettlementAmount('');
      setSettlementNotes('');
    } catch {
      const localRes = LocalSqliteBridge.settleCustomerDebtLocal({
        customerId: settlementCustomer.id,
        amount,
        notes: settlementNotes,
        shiftId: LOCAL_SHIFT_ID,
      });
      refreshLocal();
      if (localRes?.customer && selectedCustomer?.id === localRes.customer.id) {
        setSelectedCustomer(localRes.customer);
      }
      toast.warning('تم تسجيل السداد محلياً وإضافته للدرج وسيزامن لاحقاً');
      setSettlementCustomer(null);
      setSettlementAmount('');
      setSettlementNotes('');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  const handleOpenStatement = async (cust: LocalCustomer) => {
    setStatementCustomer(cust);
    setLoadingStatement(true);
    try {
      const data = await fetchCustomerStatementCloud(cust.id);
      setStatementData(data);
    } catch {
      setStatementData({
        customer: cust,
        creditBalance: cust.creditBalance || 0,
        creditLimit: cust.creditLimit || 0,
        availableCredit: (cust.creditLimit || 0) - (cust.creditBalance || 0),
        creditTransactions: cust.creditTransactions || [],
        orders: [],
      });
    } finally {
      setLoadingStatement(false);
    }
  };

  const parsedCodeQuery = parseCustomerCodeInput(searchQuery);
  const filteredCustomers = customers.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const displayName = getCustomerDisplayName(c).toLowerCase();
    const formattedCode = formatCustomerCode(c.customerCode).toLowerCase();
    return (
      displayName.includes(q) ||
      (c.name || '').toLowerCase().includes(q) ||
      c.phone.includes(searchQuery.trim()) ||
      formattedCode.includes(q) ||
      String(c.customerCode) === q ||
      (parsedCodeQuery !== null && c.customerCode === parsedCodeQuery)
    );
  });

  const filteredAuditLogs = auditLogs.filter((log) => {
    const q = auditSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      log.action.toLowerCase().includes(q) ||
      (log.cashierId || '').toLowerCase().includes(q) ||
      (log.authorizedBy || '').toLowerCase().includes(q) ||
      (log.details || '').toLowerCase().includes(q)
    );
  });

  const totalOutstandingCredit = customers.reduce(
    (sum, c) => sum + Number(c.creditBalance || 0),
    0
  );
  const totalWalletBalances = customers.reduce(
    (sum, c) => sum + Number(c.walletBalance || 0),
    0
  );
  const totalPointsBalance = customers.reduce(
    (sum, c) => sum + Number(c.pointsBalance || 0),
    0
  );

  const pointValueEgp =
    form.redemptionPointsBlock > 0
      ? (form.redemptionDiscountAmount / form.redemptionPointsBlock).toFixed(2)
      : '0.00';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Award size={24} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-white">
              إدارة العملاء، الولاء، والحسابات الآجلة (Alamir Market ERP)
            </h1>
            <p className="text-xs text-slate-400">
              دفتر الشكك والديون • محفظة الفكة • نظام نقاط الولاء • سجل تدقيق العمليات الرقابي
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={syncFromCloud}
            disabled={loadingCloud}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition"
          >
            <RefreshCw size={15} className={loadingCloud ? 'animate-spin text-cyan-400' : ''} />
            تحديث البيانات من السحابة
          </button>
        </div>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-bold block">إجمالي ديون الشكك (الآجل)</span>
            <span className="text-xl font-extrabold text-rose-400 mt-1 block">
              {totalOutstandingCredit.toFixed(2)} ج.م
            </span>
            <span className="text-[11px] text-slate-500">مستحقة لدى العملاء</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <BookOpen size={20} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-bold block">إجمالي أرصدة محافظ الفكة</span>
            <span className="text-xl font-extrabold text-cyan-400 mt-1 block">
              {totalWalletBalances.toFixed(2)} ج.م
            </span>
            <span className="text-[11px] text-slate-500">أمانات فكة للعملاء</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Wallet size={20} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-bold block">إجمالي نقاط الولاء</span>
            <span className="text-xl font-extrabold text-amber-400 mt-1 block">
              {totalPointsBalance.toLocaleString('ar-EG')} نقطة
            </span>
            <span className="text-[11px] text-slate-500">جاهزة للاستبدال</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Award size={20} />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-bold block">إجمالي العملاء المسجلين</span>
            <span className="text-xl font-extrabold text-emerald-400 mt-1 block">
              {customers.length} عميل
            </span>
            <span className="text-[11px] text-slate-500">أكواد تسلسلية C-100X</span>
          </div>
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Users size={20} />
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('loyalty')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-extrabold border-b-2 transition ${
            activeTab === 'loyalty'
              ? 'border-amber-400 text-amber-400 bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Award size={16} />
          برنامج نقاط الولاء والعملاء
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('credit')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-extrabold border-b-2 transition ${
            activeTab === 'credit'
              ? 'border-rose-400 text-rose-400 bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <CreditCard size={16} />
          دفتر الشكك والحسابات الآجلة
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-extrabold border-b-2 transition ${
            activeTab === 'audit'
              ? 'border-cyan-400 text-cyan-400 bg-slate-900/60'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldAlert size={16} />
          سجل تدقيق العمليات (Audit Logs)
        </button>
      </div>

      {/* Tab 1: Loyalty Rules Settings */}
      {activeTab === 'loyalty' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Settings size={18} className="text-emerald-400" />
              <h2 className="text-base font-bold text-white">
                إعدادات وقواعد احتساب نقاط الولاء
              </h2>
            </div>

            <label className="inline-flex items-center gap-3 cursor-pointer select-none bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-xl">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-emerald-600" />
              <span
                className={`text-xs font-extrabold ${
                  form.isEnabled ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {form.isEnabled ? 'النظام مفعّل في شاشات البيع' : 'النظام معطّل مؤقتاً'}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Spend per 1 point */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                قيمة الإنفاق لكل (1 نقطة) بالجنيه (ج.م)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={form.spendAmountPerPoint}
                onChange={(e) =>
                  setForm((f) => ({ ...f, spendAmountPerPoint: Number(e.target.value) }))
                }
                className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm font-bold text-white outline-none"
              />
              <p className="text-[11px] text-slate-400">
                يحصل العميل على 1 نقطة لكل <span className="text-amber-300 font-bold">{form.spendAmountPerPoint} ج.م</span> إنفاق
              </p>
            </div>

            {/* Redemption block */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                معدل الاستبدال (نقاط مقابل جنيه)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-0.5">عدد النقاط</span>
                  <input
                    type="number"
                    min="1"
                    value={form.redemptionPointsBlock}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, redemptionPointsBlock: Number(e.target.value) }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-300 outline-none"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-0.5">الخصم (ج.م)</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={form.redemptionDiscountAmount}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        redemptionDiscountAmount: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-emerald-400 outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                قيمة النقطة = <span className="text-amber-300 font-bold">{pointValueEgp} ج.م</span>
              </p>
            </div>

            {/* Minimum points to redeem */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                الحد الأدنى لرصيد النقاط للاستبدال
              </label>
              <input
                type="number"
                min="0"
                value={form.minPointsToRedeem}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minPointsToRedeem: Number(e.target.value) }))
                }
                className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm font-bold text-white outline-none"
              />
              <p className="text-[11px] text-slate-400">
                يظهر زر الاستبدال للكاشير عند بلوغ العميل <span className="text-cyan-300 font-bold">{form.minPointsToRedeem} نقطة</span> فأكثر
              </p>
            </div>

            {/* Max discount cap percentage */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <label className="block text-xs font-bold text-slate-300">
                الحد الأقصى لنسبة الخصم من الفاتورة (%)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.maxDiscountCapPercent}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    maxDiscountCapPercent: Number(e.target.value),
                  }))
                }
                className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-sm font-bold text-white outline-none"
              />
              <p className="text-[11px] text-slate-400">
                لا يتجاوز خصم النقاط <span className="text-cyan-300 font-bold">{form.maxDiscountCapPercent}%</span> من إجمالي السلة
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-xs text-emerald-200">
              <Sparkles size={16} className="text-amber-400 shrink-0" />
              <span>
                <strong>ملخص القاعدة الحالية:</strong> كل{' '}
                <span className="font-bold text-white">{form.spendAmountPerPoint} ج.م</span> تمنح{' '}
                <span className="font-bold text-amber-300">1 نقطة</span> • استبدال كل{' '}
                <span className="font-bold text-amber-300">{form.redemptionPointsBlock} نقطة</span>{' '}
                بخصم فوري{' '}
                <span className="font-bold text-emerald-400">{form.redemptionDiscountAmount} ج.م</span>{' '}
                • بحد أدنى{' '}
                <span className="font-bold text-white">{form.minPointsToRedeem} نقطة</span> وبحد
                أقصى <span className="font-bold text-white">{form.maxDiscountCapPercent}%</span> من
                قيمة الفاتورة.
              </span>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-emerald-950/50 transition"
            >
              <Save size={15} />
              {saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق القواعد'}
            </button>
          </div>
        </form>
      )}

      {/* Section: Customers Directory (Visible in Loyalty & Credit tabs) */}
      {(activeTab === 'loyalty' || activeTab === 'credit') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Customers Table Column */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-cyan-400" />
                <h2 className="text-base font-bold text-white">
                  دليل العملاء والحسابات ({customers.length})
                </h2>
              </div>
            </div>

            {/* Quick Add Customer Form */}
            <form
              onSubmit={handleCreateCustomer}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <div className="sm:col-span-4">
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="اسم العميل (اختياري للخصوصية)..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="tel"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  placeholder="رقم الهاتف (010...)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-3">
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={newCustomerCreditLimit}
                  onChange={(e) => setNewCustomerCreditLimit(e.target.value)}
                  placeholder="الحد الائتماني (ج.م)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={addingCustomer}
                  className="w-full h-full flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold px-2 py-2 rounded-lg text-xs"
                >
                  <UserPlus size={14} />
                  إضافة
                </button>
              </div>
            </form>

            {/* Search Customers */}
            <div className="relative">
              <Search
                size={15}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بكود العميل (C-1001 أو #1001) أو رقم الهاتف أو الاسم..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl pr-9 pl-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-2">كود العميل</th>
                    <th className="py-2.5 px-2">العميل</th>
                    <th className="py-2.5 px-2">الهاتف</th>
                    {activeTab === 'credit' ? (
                      <>
                        <th className="py-2.5 px-2">الحد الائتماني</th>
                        <th className="py-2.5 px-2">الآجل المستحق</th>
                        <th className="py-2.5 px-2">المتاح للشكك</th>
                      </>
                    ) : (
                      <>
                        <th className="py-2.5 px-2">رصيد الفكة</th>
                        <th className="py-2.5 px-2">رصيد النقاط</th>
                        <th className="py-2.5 px-2">إجمالي الشراء</th>
                      </>
                    )}
                    <th className="py-2.5 px-2 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredCustomers.map((c) => {
                    const isSelected = selectedCustomer?.id === c.id;
                    const creditBal = Number(c.creditBalance || 0);
                    const creditLim = Number(c.creditLimit || 0);
                    const availCredit = Math.max(0, creditLim - creditBal);

                    return (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedCustomer(c)}
                        className={`cursor-pointer transition ${
                          isSelected ? 'bg-emerald-950/30' : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-2.5 px-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 font-mono text-[11px] font-extrabold text-emerald-300">
                            {formatCustomerCode(c.customerCode)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 font-bold text-white">
                          {getCustomerDisplayName(c)}
                        </td>
                        <td className="py-2.5 px-2 font-mono text-cyan-300">{c.phone}</td>

                        {activeTab === 'credit' ? (
                          <>
                            <td className="py-2.5 px-2 font-mono text-slate-300">
                              {creditLim.toFixed(2)} ج.م
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded font-extrabold text-[11px] ${
                                  creditBal > 0
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {creditBal.toFixed(2)} ج.م
                              </span>
                            </td>
                            <td className="py-2.5 px-2 font-mono text-emerald-400">
                              {availCredit.toFixed(2)} ج.م
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2.5 px-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-extrabold">
                                {Number(c.walletBalance || 0).toFixed(2)} ج.م
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-extrabold">
                                {c.pointsBalance} نقطة
                              </span>
                            </td>
                            <td className="py-2.5 px-2 font-semibold text-emerald-400">
                              {Number(c.totalSpent || 0).toFixed(2)} ج.م
                            </td>
                          </>
                        )}

                        <td className="py-2.5 px-2 text-center">
                          <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setCreditLimitModalCustomer(c);
                                setNewLimitInput(String(c.creditLimit || 0));
                              }}
                              title="تعديل الحد الائتماني"
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                            >
                              <Lock size={13} />
                            </button>
                            {creditBal > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementCustomer(c);
                                  setSettlementAmount(String(creditBal));
                                  setSettlementNotes('');
                                }}
                                title="سداد دفعة من الحساب الآجل"
                                className="px-2 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white font-bold text-[10px] border border-emerald-500/40"
                              >
                                سداد
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleOpenStatement(c)}
                              title="كشف حساب تفصيلي"
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300"
                            >
                              <FileText size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredCustomers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        لا يوجد عملاء مطابقون للبحث
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer Details & History Column */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <History size={18} className="text-amber-400" />
                  <h2 className="text-base font-bold text-white">تفاصيل وحركات العميل</h2>
                </div>
              </div>

              {!selectedCustomer ? (
                <div className="py-14 text-center text-slate-500 text-xs space-y-2">
                  <Users size={32} className="mx-auto text-slate-700" />
                  <p>اختر عميلاً من الجدول لعرض كشف حساب الديون، حركات المحفظة، والنقاط</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Selected Customer Card */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 font-mono text-[11px] font-extrabold text-emerald-300">
                            {formatCustomerCode(selectedCustomer.customerCode)}
                          </span>
                          <p className="text-sm font-extrabold text-white">
                            {getCustomerDisplayName(selectedCustomer)}
                          </p>
                        </div>
                        <p className="text-xs font-mono text-cyan-300 flex items-center gap-1 mt-1">
                          <Phone size={12} />
                          {selectedCustomer.phone}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCreditLimitModalCustomer(selectedCustomer);
                            setNewLimitInput(String(selectedCustomer.creditLimit || 0));
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-bold border border-slate-700"
                        >
                          تعديل الحد
                        </button>
                        {Number(selectedCustomer.creditBalance || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettlementCustomer(selectedCustomer);
                              setSettlementAmount(String(selectedCustomer.creditBalance || 0));
                              setSettlementNotes('');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs text-white font-bold"
                          >
                            سداد دفعة
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Financial summary badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-center">
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">الحد الائتماني</span>
                        <span className="text-xs font-extrabold text-white">
                          {Number(selectedCustomer.creditLimit || 0).toFixed(2)} ج.م
                        </span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">الآجل المستحق</span>
                        <span className="text-xs font-extrabold text-rose-400">
                          {Number(selectedCustomer.creditBalance || 0).toFixed(2)} ج.م
                        </span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">محفظة الفكة</span>
                        <span className="text-xs font-extrabold text-cyan-400">
                          {Number(selectedCustomer.walletBalance || 0).toFixed(2)} ج.م
                        </span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded-lg">
                        <span className="text-[10px] text-slate-400 block">رصيد النقاط</span>
                        <span className="text-xs font-extrabold text-amber-400">
                          {selectedCustomer.pointsBalance} نقطة
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Details Navigation Tabs */}
                  <div className="flex border-b border-slate-800 gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomerDetailTab('credit')}
                      className={`px-3 py-1.5 text-xs font-bold border-b-2 transition ${
                        customerDetailTab === 'credit'
                          ? 'border-rose-400 text-rose-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      حركات الآجل والشكك ({(selectedCustomer.creditTransactions || []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerDetailTab('wallet')}
                      className={`px-3 py-1.5 text-xs font-bold border-b-2 transition ${
                        customerDetailTab === 'wallet'
                          ? 'border-cyan-400 text-cyan-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      محفظة الفكة ({(selectedCustomer.walletTransactions || []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerDetailTab('loyalty')}
                      className={`px-3 py-1.5 text-xs font-bold border-b-2 transition ${
                        customerDetailTab === 'loyalty'
                          ? 'border-amber-400 text-amber-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      نقاط الولاء ({(selectedCustomer.loyaltyTransactions || []).length})
                    </button>
                  </div>

                  {/* SubTab: Credit Transactions */}
                  {customerDetailTab === 'credit' && (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {(selectedCustomer.creditTransactions || []).length === 0 ? (
                        <p className="text-center py-8 text-xs text-slate-500">
                          لا توجد حركات آجل مسجلة لهذا العميل
                        </p>
                      ) : (
                        (selectedCustomer.creditTransactions || []).map((ctx) => (
                          <div
                            key={ctx.id}
                            className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                                    ctx.type === 'PURCHASE_DEBT'
                                      ? 'bg-rose-950 text-rose-300 border border-rose-700/60'
                                      : 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                  }`}
                                >
                                  {ctx.type === 'PURCHASE_DEBT' ? 'شراء آجل (+دين)' : 'سداد دفعة (-دين)'}
                                </span>
                                <span className="text-slate-300 font-semibold">
                                  {ctx.notes || (ctx.type === 'PURCHASE_DEBT' ? 'فاتورة آجل' : 'سداد ديون')}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {new Date(ctx.createdAt).toLocaleString('ar-EG')}
                              </p>
                            </div>
                            <div className="text-left shrink-0">
                              <span
                                className={`text-sm font-extrabold ${
                                  ctx.type === 'PURCHASE_DEBT' ? 'text-rose-400' : 'text-emerald-400'
                                }`}
                              >
                                {ctx.type === 'PURCHASE_DEBT' ? `+${Number(ctx.amount).toFixed(2)}` : `-${Number(ctx.amount).toFixed(2)}`} ج.م
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                الرصيد المستحق: {Number(ctx.balanceAfter).toFixed(2)} ج.م
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* SubTab: Wallet Transactions */}
                  {customerDetailTab === 'wallet' && (
                    <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                      {(selectedCustomer.walletTransactions || []).length === 0 ? (
                        <p className="text-center py-8 text-xs text-slate-500">
                          لا توجد حركات محفظة مسجلة لهذا العميل
                        </p>
                      ) : (
                        (selectedCustomer.walletTransactions || []).map((wtx) => (
                          <div
                            key={wtx.id}
                            className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                    wtx.amount >= 0
                                      ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/60'
                                      : 'bg-rose-950 text-rose-300 border border-rose-700/60'
                                  }`}
                                >
                                  {wtx.type === 'CHANGE_DEPOSIT'
                                    ? 'إيداع فكة (+)'
                                    : wtx.type === 'PURCHASE_PAYMENT'
                                    ? 'سداد مشتريات (-)'
                                    : 'رصيد مرتجع (+)'}
                                </span>
                                <span className="text-slate-300 font-semibold">
                                  {wtx.description || 'حركة محفظة'}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {new Date(wtx.createdAt).toLocaleString('ar-EG')}
                              </p>
                            </div>
                            <div className="text-left shrink-0">
                              <span
                                className={`text-sm font-extrabold ${
                                  wtx.amount >= 0 ? 'text-cyan-400' : 'text-rose-400'
                                }`}
                              >
                                {wtx.amount >= 0
                                  ? `+${Number(wtx.amount).toFixed(2)}`
                                  : Number(wtx.amount).toFixed(2)}{' '}
                                ج.م
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                الرصيد بعدها: {Number(wtx.balanceAfter).toFixed(2)} ج.م
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* SubTab: Loyalty Transactions */}
                  {customerDetailTab === 'loyalty' && (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {(selectedCustomer.loyaltyTransactions || []).length === 0 ? (
                        <p className="text-center py-8 text-xs text-slate-500">
                          لا توجد حركات نقاط مسجلة لهذا العميل
                        </p>
                      ) : (
                        (selectedCustomer.loyaltyTransactions || []).map((tx) => (
                          <div
                            key={tx.id}
                            className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2 text-xs"
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                                    tx.type === 'EARN'
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                                      : 'bg-amber-950 text-amber-300 border border-amber-700/60'
                                  }`}
                                >
                                  {tx.type === 'EARN' ? 'اكتساب (+)' : 'استبدال (-)'}
                                </span>
                                <span className="text-slate-300 font-semibold">
                                  {tx.description || (tx.type === 'EARN' ? 'نقاط مكتسبة' : 'استبدال نقاط')}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-1">
                                {new Date(tx.createdAt).toLocaleString('ar-EG')}
                              </p>
                            </div>

                            <div className="text-left shrink-0">
                              <span
                                className={`text-sm font-extrabold ${
                                  tx.points >= 0 ? 'text-emerald-400' : 'text-amber-400'
                                }`}
                              >
                                {tx.points > 0 ? `+${tx.points}` : tx.points} نقطة
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                {Number(tx.amountValue || 0).toFixed(2)} ج.م
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span>
                تخزين محلي فوري في SQLite مع مزامنة سحابية تلقائية لمعاملات الديون والمحافظ والنقاط.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Audit Logs Tab */}
      {activeTab === 'audit' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-cyan-400" />
              <div>
                <h2 className="text-base font-bold text-white">سجل تدقيق ورقابة العمليات (Audit Trail)</h2>
                <p className="text-xs text-slate-400">
                  توثيق جميع العمليات الحساسة: حذف الأصناف، إلغاء السلات، فتح الدرج اليدوي، وسداد الحسابات الآجلة
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadAuditLogs}
                disabled={loadingAuditLogs}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700"
              >
                <RefreshCw size={13} className={loadingAuditLogs ? 'animate-spin' : ''} />
                تحديث السجل
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="text"
              value={auditSearchQuery}
              onChange={(e) => setAuditSearchQuery(e.target.value)}
              placeholder="ابحث بنوع الحركة أو الكاشير أو التفاصيل..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl pr-9 pl-3 py-2 text-xs text-white outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">التاريخ والوقت</th>
                  <th className="py-2.5 px-3">نوع العملية</th>
                  <th className="py-2.5 px-3">الكاشير المنفّذ</th>
                  <th className="py-2.5 px-3">المصادقة / التفويض</th>
                  <th className="py-2.5 px-3">تفاصيل الحركة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredAuditLogs.map((log) => {
                  let badgeColor = 'bg-slate-800 text-slate-300';
                  if (log.action.includes('حذف صنف') || log.action.includes('VOID')) {
                    badgeColor = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
                  } else if (log.action.includes('إلغاء') || log.action.includes('CLEAR')) {
                    badgeColor = 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
                  } else if (log.action.includes('درج') || log.action.includes('DRAWER')) {
                    badgeColor = 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
                  } else if (log.action.includes('سداد') || log.action.includes('SETTLEMENT')) {
                    badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
                  }

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono text-slate-400">
                        {new Date(log.createdAt).toLocaleString('ar-EG')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold ${badgeColor}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-white">
                        {log.cashierId || 'الكاشير الحالي'}
                      </td>
                      <td className="py-2.5 px-3 text-cyan-300 font-bold">
                        {log.authorizedBy || 'مدير الفرع (PIN)'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {log.details || '—'}
                      </td>
                    </tr>
                  );
                })}
                {filteredAuditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-slate-500">
                      لا توجد سجلات تدقيق مسجلة حتى الآن
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Update Credit Limit */}
      {creditLimitModalCustomer && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdateCreditLimit}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Lock size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">
                  تعديل الحد الائتماني (سقف الشكك)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreditLimitModalCustomer(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs space-y-1">
              <p className="text-white font-bold">
                العميل: {getCustomerDisplayName(creditLimitModalCustomer)} ({formatCustomerCode(creditLimitModalCustomer.customerCode)})
              </p>
              <p className="text-slate-400">الهاتف: {creditLimitModalCustomer.phone}</p>
              <p className="text-rose-400 font-bold">
                الآجل الحالي المستحق: {Number(creditLimitModalCustomer.creditBalance || 0).toFixed(2)} ج.م
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                الحد الائتماني الجديد بالجنيه (ج.م)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                value={newLimitInput}
                onChange={(e) => setNewLimitInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-base font-extrabold text-white outline-none"
                autoFocus
              />
              <p className="text-[11px] text-slate-400 mt-1">
                ضع 0 إذا كنت تريد إيقاف الشراء الآجل لهذا العميل.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreditLimitModalCustomer(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={updatingLimit}
                className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow-lg shadow-cyan-950/50"
              >
                {updatingLimit ? 'جارٍ الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Debt Settlement */}
      {settlementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleSettleDebt}
            className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  سداد دفعة نقدية من الحساب الآجل
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettlementCustomer(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">العميل:</span>
                <span className="text-white font-bold">
                  {getCustomerDisplayName(settlementCustomer)} ({formatCustomerCode(settlementCustomer.customerCode)})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">إجمالي الدين المستحق:</span>
                <span className="text-rose-400 font-extrabold text-sm">
                  {Number(settlementCustomer.creditBalance || 0).toFixed(2)} ج.م
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                مبلغ السداد المدفوع نقداً للكاشير (ج.م)
              </label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                max={Number(settlementCustomer.creditBalance || 0)}
                value={settlementAmount}
                onChange={(e) => setSettlementAmount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2.5 text-lg font-extrabold text-emerald-400 outline-none"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                ملاحظات أو رقم السند (اختياري)
              </label>
              <input
                type="text"
                value={settlementNotes}
                onChange={(e) => setSettlementNotes(e.target.value)}
                placeholder="مثال: سداد يدوي في الكاشير"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="bg-emerald-950/20 border border-emerald-800/40 p-2.5 rounded-xl text-[11px] text-emerald-200">
              * سيتم إيداع المبلغ فوراً في درج الكاشير كحركة نقدية داخلة (CASH_IN) وتخفيض مديونية العميل.
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSettlementCustomer(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submittingSettlement}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg shadow-emerald-950/50"
              >
                {submittingSettlement ? 'جارٍ السداد...' : 'تأكيد السداد والقبض'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Customer Statement */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-cyan-400" />
                <h3 className="text-sm font-bold text-white">
                  كشف حساب تفصيلي: {getCustomerDisplayName(statementCustomer)} ({formatCustomerCode(statementCustomer.customerCode)})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setStatementCustomer(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 flex-1">
              {loadingStatement ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  جارٍ تحميل كشف الحساب...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-[10px] text-slate-400 block">الحد الائتماني</span>
                      <span className="text-xs font-bold text-white">
                        {Number(statementData?.creditLimit || statementCustomer.creditLimit || 0).toFixed(2)} ج.م
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">الرصيد المستحق (الدين)</span>
                      <span className="text-xs font-bold text-rose-400">
                        {Number(statementData?.creditBalance || statementCustomer.creditBalance || 0).toFixed(2)} ج.م
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">المتاح للشكك</span>
                      <span className="text-xs font-bold text-emerald-400">
                        {Math.max(
                          0,
                          Number(statementData?.creditLimit || statementCustomer.creditLimit || 0) -
                            Number(statementData?.creditBalance || statementCustomer.creditBalance || 0)
                        ).toFixed(2)}{' '}
                        ج.م
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-200 mb-2">
                      سجل حركات الشكك والسداد (Credit Ledger)
                    </h4>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {((statementData?.creditTransactions || statementCustomer.creditTransactions) || []).length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">لا توجد حركات ديون مسجلة</p>
                      ) : (
                        ((statementData?.creditTransactions || statementCustomer.creditTransactions) || []).map((ctx: any) => (
                          <div
                            key={ctx.id}
                            className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between text-xs"
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    ctx.type === 'PURCHASE_DEBT'
                                      ? 'bg-rose-950 text-rose-300'
                                      : 'bg-emerald-950 text-emerald-300'
                                  }`}
                                >
                                  {ctx.type === 'PURCHASE_DEBT' ? 'شراء آجل' : 'سداد دفعة'}
                                </span>
                                <span className="text-slate-300 font-semibold">{ctx.notes || ctx.orderId || 'حركة حساب'}</span>
                              </div>
                              <span className="text-[10px] text-slate-500">
                                {new Date(ctx.createdAt).toLocaleString('ar-EG')}
                              </span>
                            </div>
                            <div className="text-left">
                              <span
                                className={`font-bold ${
                                  ctx.type === 'PURCHASE_DEBT' ? 'text-rose-400' : 'text-emerald-400'
                                }`}
                              >
                                {ctx.type === 'PURCHASE_DEBT' ? `+${Number(ctx.amount).toFixed(2)}` : `-${Number(ctx.amount).toFixed(2)}`} ج.م
                              </span>
                              <span className="block text-[10px] text-slate-400">
                                الرصيد بعد: {Number(ctx.balanceAfter).toFixed(2)} ج.م
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setStatementCustomer(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoyaltyPage;

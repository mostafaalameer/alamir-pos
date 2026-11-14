import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Banknote,
  Barcode,
  CheckCircle2,
  Clock,
  Coins,
  FileText,
  Gift,
  KeyRound,
  Lock,
  Pause,
  Phone,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  UserCheck,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BackToAdminLink,
  ShiftBadge,
  SyncBadge,
  UserBadge,
} from '../components/HeaderWidgets';
import { InvoiceCodeGraphics } from '../components/InvoiceCodeGraphics';
import {
  LOCAL_SHIFT_ID,
  LOCAL_STARTING_CASH,
  useData,
} from '../context/DataContext';
import {
  createCustomerCloud,
  fetchOrderByNumber,
  formatReturnReceiptCloud,
  kickCashDrawerCloud,
  printThermalReceiptCloud,
  printZReportCloud,
  recordCashMovementCloud,
  returnOrderCloud,
  settleCustomerDebtCloud,
  testThermalPrinterCloud,
  verifyManagerPinCloud,
} from '../lib/cloud';
import {
  LocalCustomer,
  LocalProduct,
  LocalSqliteBridge,
  OfflineOrderRecord,
  ParkedInvoiceRecord,
  formatCustomerCode,
  getCustomerDisplayName,
} from '../lib/offlineSqlite';

interface CartItem {
  product: LocalProduct;
  quantity: number;
}

export function PosPage() {
  const {
    products,
    loyaltySettings,
    customers,
    offlineQueue,
    localShiftActive,
    refreshLocal,
    refreshCatalogFromCloud,
    syncNow,
  } = useData();

  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const [printingThermal, setPrintingThermal] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'SPLIT' | 'CREDIT'>('CASH');
  const [lastReceipt, setLastReceipt] = useState<OfflineOrderRecord | null>(null);
  const [parkedInvoices, setParkedInvoices] = useState<ParkedInvoiceRecord[]>(
    LocalSqliteBridge.getParkedInvoices()
  );
  const [parkedInvoicesModalOpen, setParkedInvoicesModalOpen] = useState(false);

  // Returns with item selection & thermal return receipt
  const [returnOrderNumber, setReturnOrderNumber] = useState('');
  const [returnOrderResult, setReturnOrderResult] = useState<any>(null);
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'WALLET'>('CASH');
  const [refundAmount, setRefundAmount] = useState('');
  const [selectedReturnItemIds, setSelectedReturnItemIds] = useState<Set<string>>(new Set());
  const [returnItemQuantities, setReturnItemQuantities] = useState<Record<string, number>>({});
  const [lastReturnReceipt, setLastReturnReceipt] = useState<{
    base64Commands?: string;
    previewText: string;
    opensDrawer: boolean;
  } | null>(null);

  // Manager PIN override
  const [managerPinModalOpen, setManagerPinModalOpen] = useState(false);
  const [managerPinInput, setManagerPinInput] = useState('');
  const [managerPinAction, setManagerPinAction] = useState<{
    title: string;
    actionType: string;
    callback: () => void;
    details?: string;
  } | null>(null);

  // Cash In / Cash Out (حركات الصندوق والمصروفات النثرية)
  const [cashMovementModalOpen, setCashMovementModalOpen] = useState(false);
  const [cashMovementType, setCashMovementType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [cashMovementAmount, setCashMovementAmount] = useState('');
  const [cashMovementReason, setCashMovementReason] = useState('');

  // Customer debt settlement (سداد دفعة حساب آجل)
  const [debtSettlementModalOpen, setDebtSettlementModalOpen] = useState(false);
  const [debtSettlementAmount, setDebtSettlementAmount] = useState('');
  const [debtSettlementNotes, setDebtSettlementNotes] = useState('');

  // Blind Close & Z-Report modal
  const [zReportModalOpen, setZReportModalOpen] = useState(false);
  const [blindCloseStep, setBlindCloseStep] = useState<'COUNT' | 'REPORT'>('COUNT');
  const [actualEndCash, setActualEndCash] = useState('');

  // Loyalty & Customer Lookup state
  const [customerPhoneInput, setCustomerPhoneInput] = useState('');
  const [attachedCustomer, setAttachedCustomer] = useState<LocalCustomer | null>(null);
  const [showNewCustomerMiniForm, setShowNewCustomerMiniForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [redeemPointsActive, setRedeemPointsActive] = useState(false);

  // Smart Change Wallet state
  const [useWalletActive, setUseWalletActive] = useState(false);
  const [tenderedCashInput, setTenderedCashInput] = useState<string>('');
  const [changeMode, setChangeMode] = useState<'CASH' | 'WALLET' | 'SPLIT'>('CASH');
  const [splitCashReturnedInput, setSplitCashReturnedInput] = useState<string>('0');
  const [promptCustomerForWalletOpen, setPromptCustomerForWalletOpen] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const customerPhoneInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!zReportModalOpen && !showNewCustomerMiniForm && !promptCustomerForWalletOpen) {
      barcodeInputRef.current?.focus();
    }
  }, [zReportModalOpen, showNewCustomerMiniForm, promptCustomerForWalletOpen]);

  // Always pull the authoritative product catalog from the PostgreSQL database when POS screen mounts
  useEffect(() => {
    void refreshCatalogFromCloud(true);
  }, [refreshCatalogFromCloud]);

  // Keep attachedCustomer balance synced if local customers list refreshes
  useEffect(() => {
    if (attachedCustomer) {
      const updated = customers.find((c) => c.phone === attachedCustomer.phone);
      if (updated) {
        setAttachedCustomer(updated);
      }
    }
  }, [customers, attachedCustomer]);

  const handleCustomerLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const query = customerPhoneInput.trim();
    if (!query) return;

    const found = LocalSqliteBridge.lookupCustomerByPhone(query);
    if (found) {
      setAttachedCustomer(found);
      setShowNewCustomerMiniForm(false);
      setRedeemPointsActive(false);
      if (promptCustomerForWalletOpen) {
        setChangeMode('WALLET');
        setPromptCustomerForWalletOpen(false);
      }
      const displayName = getCustomerDisplayName(found);
      toast.success(
        `تم ربط العميل: ${displayName} [${formatCustomerCode(found.customerCode)}] (النقاط: ${found.pointsBalance} • المحفظة: ${Number(found.walletBalance || 0).toFixed(2)} ج.م)`
      );
    } else {
      setAttachedCustomer(null);
      setRedeemPointsActive(false);
      setUseWalletActive(false);
      setShowNewCustomerMiniForm(true);
      setNewCustomerName('');
      toast.info('العميل غير مسجل — يمكنك إضافته فوراً برقم الهاتف فقط (الاسم اختياري للخصوصية)');
    }
  };

  const handleQuickCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = customerPhoneInput.trim();
    const name = newCustomerName.trim() || null;
    if (!phone) {
      toast.error('يرجى إدخال رقم هاتف العميل');
      return;
    }

    try {
      const cloudCust = await createCustomerCloud({ name, phone });
      refreshLocal();
      setAttachedCustomer(cloudCust);
      setShowNewCustomerMiniForm(false);
      if (promptCustomerForWalletOpen) {
        setChangeMode('WALLET');
        setPromptCustomerForWalletOpen(false);
      }
      toast.success(
        `تم تسجيل وربط العميل الجديد: ${getCustomerDisplayName(cloudCust)} (${formatCustomerCode(cloudCust.customerCode)})`
      );
    } catch {
      const localCust = LocalSqliteBridge.createOrUpdateCustomerLocal({
        name,
        phone,
        synced: false,
      });
      refreshLocal();
      setAttachedCustomer(localCust);
      setShowNewCustomerMiniForm(false);
      if (promptCustomerForWalletOpen) {
        setChangeMode('WALLET');
        setPromptCustomerForWalletOpen(false);
      }
      toast.success(
        `تم تسجيل العميل "${getCustomerDisplayName(localCust)}" (${formatCustomerCode(localCust.customerCode)}) محلياً وربطه بالفاتورة`
      );
    }
  };

  const clearAttachedCustomer = () => {
    setAttachedCustomer(null);
    setCustomerPhoneInput('');
    setShowNewCustomerMiniForm(false);
    setRedeemPointsActive(false);
    setUseWalletActive(false);
    setChangeMode('CASH');
    setPromptCustomerForWalletOpen(false);
  };

  const refreshParkedInvoices = () => {
    setParkedInvoices(LocalSqliteBridge.getParkedInvoices());
  };

  const handleParkCurrentCart = () => {
    if (cart.length === 0) {
      toast.info('السلة الحالية فارغة — لا توجد فاتورة لتعليقها');
      return;
    }

    const saved = LocalSqliteBridge.parkCurrentCart({
      items: cart,
      customerPhone:
        attachedCustomer?.phone ?? (customerPhoneInput.trim() || undefined),
      customerName:
        attachedCustomer?.name ?? (newCustomerName.trim() || undefined),
    });

    refreshParkedInvoices();
    setCart([]);
    setBarcodeInput('');
    setSearchQuery('');
    setTenderedCashInput('');
    toast.success(`تم تعليق الفاتورة بنجاح — ${saved.items.length} صنفاً في قائمة التعليق`);
  };

  const handleResumeParkedInvoice = (invoiceId: string) => {
    const invoice = LocalSqliteBridge.resumeParkedInvoice(invoiceId);
    if (!invoice) return;

    setCart(invoice.items.map((item) => ({ product: item.product, quantity: item.quantity })));
    if (invoice.customerPhone) {
      const customer = LocalSqliteBridge.lookupCustomerByPhone(invoice.customerPhone);
      setAttachedCustomer(customer ?? null);
      setCustomerPhoneInput(invoice.customerPhone);
      if (!customer && invoice.customerName) {
        setShowNewCustomerMiniForm(true);
        setNewCustomerName(invoice.customerName);
      }
    }
    setTenderedCashInput('');
    setRedeemPointsActive(false);
    setUseWalletActive(false);
    setChangeMode('CASH');
    setSplitCashReturnedInput('0');
    toast.success('تم استئناف الفاتورة المؤجلة بنجاح');
  };

  const handleDeleteParkedInvoice = (invoiceId: string) => {
    const next = LocalSqliteBridge.deleteParkedInvoice(invoiceId);
    setParkedInvoices(next);
    refreshParkedInvoices();
    toast.info('تم حذف الفاتورة المؤجلة');
  };

  const handleLookupReturnOrder = async (explicitOrderNumber?: string) => {
    const cleaned = (explicitOrderNumber ?? returnOrderNumber)
      .trim()
      .replace(/^INV:/i, '')
      .toUpperCase();
    if (!cleaned) {
      toast.error('يرجى إدخال رقم الفاتورة للبحث');
      return;
    }
    setReturnOrderNumber(cleaned);

    try {
      const order = await fetchOrderByNumber(cleaned);
      setReturnOrderResult(order);
      setRefundMethod('CASH');
      setRefundAmount('');

      const initialSelected = new Set<string>();
      const initialQtys: Record<string, number> = {};
      (order.items || []).forEach((item: any) => {
        const remaining = (item.quantity ?? 1) - (item.returnedQuantity ?? 0);
        if (remaining > 0) {
          initialSelected.add(item.id);
          initialQtys[item.id] = remaining;
        }
      });
      setSelectedReturnItemIds(initialSelected);
      setReturnItemQuantities(initialQtys);

      toast.success(`تم العثور على الفاتورة ${order.orderNumber}`);
    } catch (err) {
      setReturnOrderResult(null);
      setSelectedReturnItemIds(new Set());
      setReturnItemQuantities({});
      toast.error(err instanceof Error ? err.message : 'تعذر العثور على الفاتورة');
    }
  };

  const calculatedReturnRefundTotal = returnOrderResult?.items
    ? returnOrderResult.items
      .filter((i: any) => selectedReturnItemIds.has(i.id))
      .reduce(
        (sum: number, i: any) =>
          sum + Number(i.unitPrice || 0) * (returnItemQuantities[i.id] ?? i.quantity ?? 1),
        0
      )
    : 0;

  const handleReturnOrder = async () => {
    if (!returnOrderResult) {
      toast.error('ابحث عن الفاتورة أولاً');
      return;
    }
    if (selectedReturnItemIds.size === 0) {
      toast.error('يرجى تحديد صنف واحد على الأقل للاسترجاع');
      return;
    }

    try {
      const itemsToReturn = Array.from(selectedReturnItemIds).map((id) => ({
        orderItemId: id,
        quantity: returnItemQuantities[id] || 1,
      }));

      const finalRefundAmt =
        refundAmount.trim() !== '' ? Number(refundAmount) : calculatedReturnRefundTotal;

      const returnedOrder = await returnOrderCloud(
        returnOrderResult.id,
        refundMethod,
        finalRefundAmt,
        itemsToReturn
      );

      const formattedItems = (returnOrderResult.items || [])
        .filter((i: any) => selectedReturnItemIds.has(i.id))
        .map((i: any) => ({
          name: i.productName || i.product?.name || 'صنف',
          quantity: returnItemQuantities[i.id] || 1,
          unitPrice: Number(i.unitPrice || 0),
          lineTotal: Number(i.unitPrice || 0) * (returnItemQuantities[i.id] || 1),
        }));

      try {
        const receipt = await formatReturnReceiptCloud({
          orderNumber: returnOrderResult.orderNumber,
          originalDate: returnOrderResult.createdAt,
          cashierName: 'الكاشير',
          refundMethod,
          refundAmount: finalRefundAmt,
          returnedItems: formattedItems,
          isPartial: !returnedOrder.isReturned,
        });
        setLastReturnReceipt(receipt);
      } catch {
        setLastReturnReceipt({
          previewText:
            `--- إيصال مرتجع مبيعات (ماركت الأمير) ---\n` +
            `رقم الفاتورة الأصلية: ${returnOrderResult.orderNumber}\n` +
            `المبلغ المسترد: ${finalRefundAmt.toFixed(2)} ج.م (${refundMethod === 'CASH' ? 'نقداً من الدرج' : 'إيداع بالمحفظة'
            })\n` +
            `الأصناف المسترجعة:\n` +
            formattedItems
              .map((f: { name: string; quantity: number; lineTotal: number }) => `• ${f.name} ×${f.quantity} = ${f.lineTotal.toFixed(2)} ج.م`)
              .map(
                (f: { name: string; quantity: number; unitPrice: number; lineTotal: number }) =>
                  `• ${f.name}\n   الكمية: ${f.quantity} × سعر الوحدة: ${f.unitPrice.toFixed(2)} ج.م = ${f.lineTotal.toFixed(2)} ج.م`
              )
              .join('\n'),
          opensDrawer: refundMethod === 'CASH',
        });
      }

      setReturnOrderResult(null);
      setReturnOrderNumber('');
      setRefundAmount('');
      setSelectedReturnItemIds(new Set());
      setReturnItemQuantities({});
      refreshLocal();
      toast.success(
        refundMethod === 'CASH'
          ? `تم استرجاع الأصناف بنجاح وصرف ${finalRefundAmt.toFixed(2)} ج.م نقداً وفتح الدرج`
          : `تم استرجاع الأصناف بنجاح وإيداع ${finalRefundAmt.toFixed(2)} ج.م في محفظة العميل`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الاسترجاع');
    }
  };

  const promptManagerPin = (
    title: string,
    actionType: string,
    callback: () => void,
    details?: string
  ) => {
    setManagerPinAction({ title, actionType, callback, details });
    setManagerPinInput('');
    setManagerPinModalOpen(true);
  };

  const handleConfirmManagerPin = async () => {
    if (!managerPinAction) return;
    const pin = managerPinInput.trim();
    if (!pin) {
      toast.error('أدخل رمز PIN للمشرف');
      return;
    }
    try {
      const res = await verifyManagerPinCloud({
        pin,
        action: managerPinAction.actionType,
        details: managerPinAction.details,
      });
      if (res.authorized) {
        toast.success('تم قبول تصريح المشرف وتوثيق العملية في سجل التدقيق');
        managerPinAction.callback();
        setManagerPinModalOpen(false);
        setManagerPinAction(null);
        return;
      }
    } catch {
      // Offline fallback
    }

    if (pin === '1234') {
      LocalSqliteBridge.recordAuditLogLocal(
        managerPinAction.actionType,
        'MANAGER_PIN_OFFLINE',
        managerPinAction.details
      );
      toast.success('تم قبول رمز المشرف محلياً وتوثيق العملية');
      managerPinAction.callback();
      setManagerPinModalOpen(false);
      setManagerPinAction(null);
    } else {
      toast.error('رمز PIN الخاص بالمشرف غير صحيح');
    }
  };

  const handleRecordCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(cashMovementAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('أدخل مبلغاً نقدياً صحيحاً أكبر من صفر');
      return;
    }
    const reason = cashMovementReason.trim();
    if (!reason) {
      toast.error('سبب حركة الصندوق مطلوب (مثل: شراء أكياس، عهدة، أجرة)');
      return;
    }

    try {
      await recordCashMovementCloud({
        type: cashMovementType,
        amount: amt,
        reason,
        shiftId: LOCAL_SHIFT_ID,
      });
      toast.success(
        cashMovementType === 'CASH_IN'
          ? `تم توريد ${amt.toFixed(2)} ج.م للدرج بنجاح`
          : `تم تسجيل سحب ${amt.toFixed(2)} ج.م مصروفات من الدرج`
      );
    } catch {
      LocalSqliteBridge.recordCashMovementLocal({
        shiftId: LOCAL_SHIFT_ID,
        type: cashMovementType,
        amount: amt,
        reason,
      });
      toast.success(`تم حفظ حركة الصندوق محلياً: ${amt.toFixed(2)} ج.م`);
    }

    setCashMovementModalOpen(false);
    setCashMovementAmount('');
    setCashMovementReason('');
    refreshLocal();
  };

  const handleSettleCustomerDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attachedCustomer) return;
    const amt = Number(debtSettlementAmount);
    const currentDebt = Number(attachedCustomer.creditBalance ?? 0);
    if (!Number.isFinite(amt) || amt <= 0 || amt > currentDebt) {
      toast.error(`المبلغ يجب أن يكون بين 0.01 و ${currentDebt.toFixed(2)} ج.م`);
      return;
    }

    try {
      await settleCustomerDebtCloud(
        attachedCustomer.id,
        amt,
        debtSettlementNotes || undefined,
        LOCAL_SHIFT_ID
      );
      toast.success(
        `تم سداد مبلغ ${amt.toFixed(2)} ج.م من حساب ${getCustomerDisplayName(attachedCustomer)} نقداً`
      );
    } catch {
      LocalSqliteBridge.settleCustomerDebtLocal({
        customerId: attachedCustomer.id,
        amount: amt,
        notes: debtSettlementNotes || undefined,
        shiftId: LOCAL_SHIFT_ID,
      });
      toast.success(`تم سداد ${amt.toFixed(2)} ج.م محلياً`);
    }

    setDebtSettlementModalOpen(false);
    setDebtSettlementAmount('');
    setDebtSettlementNotes('');
    refreshLocal();
  };

  const addToCart = (product: LocalProduct) => {
    if (product.totalStock <= 0) {
      toast.error(`الصنف "${product.name}" نفد من المخزون!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.totalStock) {
          toast.warning(`الكمية المطلوبة تتجاوز الرصيد المتاح (${product.totalStock})`);
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    toast.success(`تم إضافة: ${product.name} (${product.retailPrice.toFixed(2)} ج.م)`);
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawBarcode = barcodeInput.trim();
    if (!rawBarcode) return;

    const parsedScaleBarcode = LocalSqliteBridge.parseScaleBarcode(rawBarcode);
    if (parsedScaleBarcode) {
      const weightedProduct = LocalSqliteBridge.findWeightedProductForScaleBarcode(rawBarcode);
      if (weightedProduct) {
        const itemLinePrice = parsedScaleBarcode.totalPackPrice;
        const weightFormatted = `${parsedScaleBarcode.weight.toFixed(3)} ${weightedProduct.weightUnit}`;

        setCart((prev) => [
          ...prev,
          {
            product: {
              ...weightedProduct,
              name: `${weightedProduct.name} [${weightFormatted}]`,
              retailPrice: itemLinePrice,
            },
            quantity: 1,
          },
        ]);

        toast.success(
          `تمت إضافة صنف ميزان: ${weightedProduct.name} (${weightFormatted} = ${itemLinePrice.toFixed(2)} ج.م)`
        );
        setBarcodeInput('');
        return;
      }
    }

    // Detect scanned invoice Barcode / QR code (e.g. "ALM-123456" or "INV:ALM-123456")
    const invoiceMatch = rawBarcode.match(/^(?:INV:)?(ALM-\d+)$/i);
    if (invoiceMatch) {
      setBarcodeInput('');
      void handleLookupReturnOrder(invoiceMatch[1].toUpperCase());
      return;
    }

    const found = LocalSqliteBridge.lookupByBarcode(rawBarcode);
    if (found) {
      addToCart(found);
    } else {
      toast.error(`لم يتم العثور على صنف بالباركود: ${rawBarcode}`);
    }
    setBarcodeInput('');
  };

  const cartSubtotal = cart.reduce(
    (sum, item) => sum + item.product.retailPrice * item.quantity,
    0
  );

  // Dynamic loyalty calculation based on current cart & attached customer
  const loyaltyCalc = LocalSqliteBridge.calculateLoyaltyForCart(
    cartSubtotal,
    attachedCustomer,
    redeemPointsActive
  );

  const previewRedeemCalc = LocalSqliteBridge.calculateLoyaltyForCart(
    cartSubtotal,
    attachedCustomer,
    true
  );

  const canRedeemPoints =
    loyaltySettings.isEnabled &&
    attachedCustomer !== null &&
    attachedCustomer.pointsBalance >= loyaltySettings.minPointsToRedeem &&
    previewRedeemCalc.pointsRedeemed >= loyaltySettings.minPointsToRedeem &&
    cartSubtotal > 0;

  // Invoice total after points discount
  const invoiceNetTotal = attachedCustomer ? loyaltyCalc.netPayable : cartSubtotal;

  // Wallet redemption calculation
  const availableWalletBalance = Number(attachedCustomer?.walletBalance ?? 0);
  const walletAmountUsed =
    attachedCustomer && useWalletActive && availableWalletBalance > 0
      ? Number(Math.min(availableWalletBalance, invoiceNetTotal).toFixed(2))
      : 0;

  // Remaining cash due from customer after wallet deduction
  const remainingCashDue = Number(
    Math.max(0, invoiceNetTotal - walletAmountUsed).toFixed(2)
  );

  // Tendered physical cash & Change Due calculation
  const parsedTendered =
    tenderedCashInput.trim() === ''
      ? remainingCashDue
      : Math.max(0, Number(tenderedCashInput) || 0);
  const totalChangeDue = Number(
    Math.max(0, parsedTendered - remainingCashDue).toFixed(2)
  );

  // Determine how totalChangeDue is split between physical Cash Returned and Wallet Deposit
  let changeGivenCash = totalChangeDue;
  let changeDepositedToWallet = 0;

  if (totalChangeDue > 0 && attachedCustomer) {
    if (changeMode === 'WALLET') {
      changeGivenCash = 0;
      changeDepositedToWallet = totalChangeDue;
    } else if (changeMode === 'SPLIT') {
      const requestedCashReturn = Math.max(
        0,
        Math.min(totalChangeDue, Number(splitCashReturnedInput) || 0)
      );
      changeGivenCash = Number(requestedCashReturn.toFixed(2));
      changeDepositedToWallet = Number((totalChangeDue - changeGivenCash).toFixed(2));
    } else {
      changeGivenCash = totalChangeDue;
      changeDepositedToWallet = 0;
    }
  }

  const projectedPointsEarned =
    loyaltySettings.isEnabled && loyaltySettings.spendAmountPerPoint > 0
      ? Math.floor(invoiceNetTotal / loyaltySettings.spendAmountPerPoint)
      : 0;

  const activateSaveChangeToWallet = () => {
    if (!attachedCustomer) {
      setPromptCustomerForWalletOpen(true);
      setTimeout(() => {
        customerPhoneInputRef.current?.focus();
        customerPhoneInputRef.current?.select();
      }, 50);
      toast.info('أدخل رقم هاتف العميل أولاً لحفظ الفكة (${totalChangeDue.toFixed(2)} ج.م) في محفظته');
      return;
    }
    setChangeMode('WALLET');
    toast.success(
      `سيتم حفظ الفكة (${totalChangeDue.toFixed(2)} ج.م) في محفظة ${getCustomerDisplayName(attachedCustomer)} (${formatCustomerCode(attachedCustomer.customerCode)})`
    );
  };

  const activateCashChange = () => {
    setChangeMode('CASH');
    toast.info(`سيتم صرف الفكة نقداً (${totalChangeDue.toFixed(2)} ج.م) للعميل`);
  };

  // Global keyboard shortcuts:
  // F3 or Alt+C -> Focus Customer Phone Lookup
  // F4 -> Park Current Cart (or View Parked Invoices)
  // F7 -> Cash In / Out (حركة الصندوق)
  // F8 -> Cash Change (صرف الفكة نقداً)
  // F9 -> Save Change to Wallet (حفظ الفكة في المحفظة)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F3' || (e.altKey && (e.key === 'c' || e.key === 'C' || e.key === 'ؤ'))) {
        e.preventDefault();
        customerPhoneInputRef.current?.focus();
        customerPhoneInputRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0) {
          handleParkCurrentCart();
        } else {
          setParkedInvoicesModalOpen((v) => !v);
        }
      } else if (e.key === 'F7') {
        e.preventDefault();
        setCashMovementModalOpen(true);
      } else if (e.key === 'F8' && totalChangeDue > 0) {
        e.preventDefault();
        activateCashChange();
      } else if (e.key === 'F9' && totalChangeDue > 0) {
        e.preventDefault();
        activateSaveChangeToWallet();
      } else if (e.key === 'F10' && cart.length > 0) {
        e.preventDefault();
        handleCheckout({ printReceipt: true });
      } else if (e.key === 'F12' && cart.length > 0) {
        e.preventDefault();
        handleCheckout({ printReceipt: false });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleCheckout = (options?: { printReceipt?: boolean }) => {
    const shouldPrintReceipt = options?.printReceipt !== false;
    if (cart.length === 0) return;
    if (paymentMethod === 'CREDIT') {
      if (!attachedCustomer) {
        toast.error('يجب ربط حساب العميل أولاً لإتمام البيع بالآجل (الشكك)');
        customerPhoneInputRef.current?.focus();
        return;
      }
      const debt = Number(attachedCustomer.creditBalance ?? 0);
      const limit = Number(attachedCustomer.creditLimit ?? 0);
      if (limit <= 0) {
        toast.error('هذا العميل غير مفعّل له حد ائتمان للبيع بالآجل');
        return;
      }
      if (debt + remainingCashDue > limit) {
        toast.error(`تجاوز الحد الائتماني للعميل! الرصيد المتاح: ${(limit - debt).toFixed(2)} ج.م`);
        return;
      }
    } else if (parsedTendered + 0.001 < remainingCashDue) {
      toast.error(
        `المبلغ المدفوع (${parsedTendered.toFixed(2)} ج.م) أقل من المطلوب سداده (${remainingCashDue.toFixed(2)} ج.م)`
      );
      return;
    }
    if (changeDepositedToWallet > 0 && !attachedCustomer) {
      setPromptCustomerForWalletOpen(true);
      customerPhoneInputRef.current?.focus();
      toast.error('يرجى ربط العميل برقم الهاتف أولاً لحفظ الفكة في المحفظة');
      return;
    }

    try {
      const receipt = LocalSqliteBridge.executeOfflineFifoCheckout(
        LOCAL_SHIFT_ID,
        paymentMethod,
        cart,
        {
          customerPhone: attachedCustomer?.phone,
          redeemPoints: redeemPointsActive,
          useWallet: useWalletActive,
          walletAmountUsed,
          paidAmount: parsedTendered,
          changeGiven: changeGivenCash,
          changeDepositedToWallet,
        }
      );
      refreshLocal();
      setLastReceipt(receipt);
      setCart([]);
      setRedeemPointsActive(false);
      setUseWalletActive(false);
      setTenderedCashInput('');
      setChangeMode('CASH');
      setSplitCashReturnedInput('0');

      if (attachedCustomer) {
        const refreshed = LocalSqliteBridge.lookupCustomerByPhone(attachedCustomer.phone);
        if (refreshed) setAttachedCustomer(refreshed);
      }

      // Trigger cash drawer kick immediately as the very first hardware signal (<15ms)
      void kickCashDrawerCloud();

      if (shouldPrintReceipt) {
        toast.success(
          changeDepositedToWallet > 0
            ? `تم إصدار الفاتورة ${receipt.orderNumber} وطباعتها وإيداع ${changeDepositedToWallet.toFixed(2)} ج.م في محفظة الفكة`
            : `تم إصدار الفاتورة ${receipt.orderNumber} وطباعتها وفتح درج النقدية`
        );
        void handlePrintReceiptToThermal(receipt, false);
      } else {
        toast.success(
          changeDepositedToWallet > 0
            ? `تم إصدار الفاتورة ${receipt.orderNumber} (بدون طباعة ورقية) وإيداع ${changeDepositedToWallet.toFixed(2)} ج.م في المحفظة وفتح الدرج`
            : `تم إصدار الفاتورة ${receipt.orderNumber} وفتح درج النقدية بدون طباعة ورقية (توفير الورق)`
        );
      }
      void syncNow(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الدفع');
    }
  };

  const handlePrintReceiptToThermal = async (
    receipt: OfflineOrderRecord,
    isAutoCheckout = false
  ) => {
    setPrintingThermal(true);
    try {
      const res = await printThermalReceiptCloud({
        orderNumber: receipt.orderNumber,
        cashierName: 'كاشير الأمير',
        paymentMethod: receipt.paymentMethod,
        createdAt: receipt.createdAt,
        paperWidth: '80mm',
        openCashDrawer: isAutoCheckout,
        totalAmount: receipt.totalAmount,
        paidAmount: receipt.paidAmount,
        changeGiven: receipt.changeGiven ?? 0,
        changeDepositedToWallet: receipt.changeDepositedToWallet,
        walletAmountUsed: receipt.walletAmountUsed,
        customerCode: receipt.customerCode,
        customerName: receipt.customerName,
        customerPhone: receipt.customerPhone,
        pointsEarned: receipt.pointsEarned,
        pointsRedeemed: receipt.pointsRedeemed,
        discountFromPoints: receipt.discountFromPoints,
        customerPointsBalance: receipt.customerPointsBalance,
        customerWalletBalance: receipt.customerWalletBalance,
        items: receipt.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: Number((item.unitPrice * item.quantity).toFixed(2)),
        })),
      });

      if (res.printedPhysically) {
        if (!isAutoCheckout) {
          toast.success(
            `تمت طباعة الفاتورة ${receipt.orderNumber} على الطابعة الحرارية (${res.printerName || '80mm'})`
          );
        }
      } else if (!isAutoCheckout) {
        toast.warning(
          res.printError
            ? `تعذر الاتصال بالطابعة الحرارية: ${res.printError}`
            : 'تم تجهيز الفاتورة ولكن لم يتم العثور على طابعة حرارية متصلة'
        );
      }
    } catch (err: unknown) {
      if (!isAutoCheckout) {
        toast.error(
          err instanceof Error ? err.message : 'تعذر إرسال الفاتورة إلى الطابعة الحرارية'
        );
      }
    } finally {
      setPrintingThermal(false);
    }
  };

  const handleTestThermalPrint = async () => {
    setPrintingThermal(true);
    try {
      const res = await testThermalPrinterCloud({ paperWidth: '80mm' });
      if (res.printedPhysically) {
        toast.success(
          `تمت الطباعة التجريبية بنجاح على الطابعة الحرارية (${res.printerName || 'Printer 80Receipt'})`
        );
      } else {
        toast.error(
          res.printError
            ? `تعذر الطباعة التجريبية: ${res.printError}`
            : 'لم يتم العثور على طابعة حرارية جاهزة'
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'فشل اختبار الطابعة الحرارية');
    } finally {
      setPrintingThermal(false);
    }
  };

  const posCategories = Array.from(
    new Set(products.map((p) => (p.category || 'عام').trim()).filter(Boolean))
  );

  const filteredProducts = products.filter((p) => {
    const cat = (p.category || 'عام').trim();
    if (selectedCategory !== 'ALL' && cat !== selectedCategory) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.barcode.includes(q) ||
      cat.toLowerCase().includes(q)
    );
  });

  const handleManualCatalogRefresh = async () => {
    setRefreshingCatalog(true);
    try {
      await refreshCatalogFromCloud(false);
    } finally {
      setRefreshingCatalog(false);
    }
  };

  // Shift & Physical Cash Drawer Reconciliation (Z-Report)
  const cashOrders = offlineQueue.filter((o) => o.paymentMethod === 'CASH');
  const cashSalesTotal = cashOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalChangeCreditedToWallets = offlineQueue.reduce(
    (sum, o) => sum + Number(o.changeDepositedToWallet ?? 0),
    0
  );
  const totalWalletRedemptions = offlineQueue.reduce(
    (sum, o) => sum + Number(o.walletAmountUsed ?? 0),
    0
  );
  const shiftMovements = LocalSqliteBridge.getCashMovements(LOCAL_SHIFT_ID);
  const totalCashIn = shiftMovements
    .filter((m) => m.type === 'CASH_IN')
    .reduce((sum, m) => sum + m.amount, 0);
  const totalCashOut = shiftMovements
    .filter((m) => m.type === 'CASH_OUT')
    .reduce((sum, m) => sum + m.amount, 0);

  // Physical drawer cash = startingCash + cashSales + changeCreditedToWallets - walletRedemptions + cashIn - cashOut
  const expectedDrawerCash = Number(
    (
      LOCAL_STARTING_CASH +
      cashSalesTotal +
      totalChangeCreditedToWallets -
      totalWalletRedemptions +
      totalCashIn -
      totalCashOut
    ).toFixed(2)
  );
  const countedCashNum = Number(actualEndCash) || 0;
  const drawerDiscrepancy = Number((countedCashNum - expectedDrawerCash).toFixed(2));

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-900/40">
              <Store size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-white">
                ماركت الأمير — شاشة البيع (Alamir POS)
              </h1>
              <p className="text-xs text-cyan-300">
                جمهورية مصر العربية • العملة: ج.م • محفظة الفكة الذكية ونقاط الولاء
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setParkedInvoicesModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/50 text-cyan-300"
            >
              <Pause size={14} />
              <span>[F4] الفواتير المعلقة</span>
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-extrabold">
                {parkedInvoices.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCashMovementModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-950/70 hover:bg-amber-900/80 border border-amber-500/50 text-amber-300"
            >
              <Coins size={14} />
              <span>[F7] حركة نقدية</span>
            </button>
            <button
              type="button"
              disabled={printingThermal}
              onClick={() => void handleTestThermalPrint()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-500/50 text-emerald-300 disabled:opacity-50"
              title="طباعة إيصال تجريبي على الطابعة الحرارية 80mm"
            >
              <Printer size={13} className="text-emerald-400" />
              <span>{printingThermal ? 'جاري الطباعة...' : 'اختبار الطابعة 80mm'}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                promptManagerPin(
                  'فتح درج النقدية يدوياً بدون عملية بيع',
                  'MANUAL_DRAWER_OPEN',
                  () => {
                    void kickCashDrawerCloud();
                    toast.success('تم إرسال إشارة فتح الدرج بنجاح (ESC p 0 25 250)');
                  },
                  'فتح درج يدوي'
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="فتح الدرج بتصريح المشرف"
            >
              <KeyRound size={13} className="text-amber-400" />
              <span>فتح الدرج</span>
            </button>
            <BackToAdminLink />
            <ShiftBadge
              active={localShiftActive}
              label={`الوردية: ${LOCAL_SHIFT_ID}`}
            />
            <SyncBadge />
            <UserBadge />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <section className="lg:col-span-7 space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-extrabold text-rose-300">استرجاع / مرتجعات</h2>
                <span className="text-[10px] text-slate-400">بحث برقم الفاتورة</span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLookupReturnOrder();
                }}
                className="flex flex-col sm:flex-row gap-2"
              >
                <input
                  type="text"
                  value={returnOrderNumber}
                  onChange={(e) => setReturnOrderNumber(e.target.value)}
                  placeholder="امسح باركود/QR الفاتورة أو أدخل الرقم مثل: ALM-123456"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none"
                />
                <button
                  type="submit"
                  className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-2 rounded-lg text-xs font-extrabold"
                >
                  بحث
                </button>
              </form>

              {returnOrderResult && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3.5 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <Receipt size={16} className="text-rose-400" />
                      فاتورة: {returnOrderResult.orderNumber}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-rose-500/20 text-rose-300">
                      {returnOrderResult.isReturned ? 'تم استرجاعها كلياً' : 'مرتجع جزئي / كلي'}
                    </span>
                  </div>

                  {/* Interactive Items Table */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto border border-slate-800 rounded-xl p-2.5 bg-slate-950">
                    <p className="text-[11px] font-bold text-slate-300 mb-1 flex items-center justify-between">
                      <span>الأصناف المباعة — حدد ما يريد العميل إرجاعه:</span>
                      <span className="text-rose-400">({selectedReturnItemIds.size} محدد)</span>
                    </p>
                    {!returnOrderResult.items || returnOrderResult.items.length === 0 ? (
                      <p className="text-xs text-slate-500">لا توجد تفاصيل أصناف لهذه الفاتورة</p>
                    ) : (
                      returnOrderResult.items.map((item: any) => {
                        const isSelected = selectedReturnItemIds.has(item.id);
                        const returnQty = returnItemQuantities[item.id] ?? item.quantity ?? 1;
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between text-xs p-2 rounded-lg border transition ${isSelected
                                ? 'bg-rose-950/40 border-rose-700/60'
                                : 'bg-slate-900/60 border-slate-800 text-slate-400'
                              }`}
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  setSelectedReturnItemIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(item.id)) next.delete(item.id);
                                    else next.add(item.id);
                                    return next;
                                  });
                                }}
                                className="rounded border-slate-700 text-rose-600 focus:ring-rose-500"
                              />
                              <div>
                                <p className="font-bold text-white">
                                  {item.productName || item.product?.name || 'صنف'}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  سعر القطعة: {Number(item.unitPrice || 0).toFixed(2)} ج.م • المباع: {item.quantity}
                                </p>
                              </div>
                            </label>

                            {isSelected && (
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-400">كمية المرتجع:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={item.quantity}
                                  value={returnQty}
                                  onChange={(e) => {
                                    const val = Math.max(1, Math.min(item.quantity, Number(e.target.value) || 1));
                                    setReturnItemQuantities((prev) => ({ ...prev, [item.id]: val }));
                                  }}
                                  className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-center font-bold text-white outline-none"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                    <span className="text-slate-400 font-semibold">المبلغ المستحق للرد:</span>
                    <span className="font-extrabold text-base text-rose-400">
                      {calculatedReturnRefundTotal.toFixed(2)} ج.م
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRefundMethod('CASH')}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${refundMethod === 'CASH'
                          ? 'bg-rose-600 text-white shadow-md shadow-rose-950/40'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                        }`}
                    >
                      <Coins size={14} />
                      صرف نقداً من الدرج
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundMethod('WALLET')}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${refundMethod === 'WALLET'
                          ? 'bg-cyan-600 text-white shadow-md shadow-cyan-950/40'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                        }`}
                    >
                      <Wallet size={14} />
                      إيداع بمحفظة العميل
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleReturnOrder}
                    disabled={selectedReturnItemIds.size === 0}
                    className="w-full bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-3 py-2.5 rounded-xl text-xs font-extrabold shadow-lg shadow-rose-950/50 transition flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} />
                    تأكيد إرجاع الأصناف ({selectedReturnItemIds.size}) وصرف {calculatedReturnRefundTotal.toFixed(2)} ج.م
                  </button>
                </div>
              )}
            </div>

            <form
              onSubmit={handleBarcodeSubmit}
              className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1">
                <Barcode
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                />
                <input
                  ref={barcodeInputRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="امسح الباركود هنا (USB HID Scanner) أو اكتب الكود ثم Enter..."
                  className="w-full bg-slate-950 border border-emerald-600/60 focus:border-emerald-400 rounded-lg pr-9 pl-3 py-2 text-sm text-white outline-none"
                />
              </div>
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg text-sm"
              >
                إضافة بالباركود
              </button>
            </form>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-extrabold text-white">
                    الأصناف المسجلة بقاعدة البيانات ({filteredProducts.length} / {products.length})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => void handleManualCatalogRefresh()}
                  disabled={refreshingCatalog}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 transition"
                >
                  <RefreshCw size={12} className={refreshingCatalog ? 'animate-spin' : ''} />
                  <span>{refreshingCatalog ? 'جاري التحديث...' : 'تحديث الأصناف من قاعدة البيانات'}</span>
                </button>
              </div>

              <div className="relative">
                <Search
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث سريع باسم الصنف أو الباركود أو القسم..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg pr-9 pl-3 py-2 text-sm text-white outline-none"
                />
              </div>

              {posCategories.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${selectedCategory === 'ALL'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                      }`}
                  >
                    الكل ({products.length})
                  </button>
                  {posCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${selectedCategory === cat
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                        }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              {filteredProducts.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                  لا توجد أصناف مطابقة في قاعدة البيانات
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {filteredProducts.map((product) => {
                    const nearestExpiry = product.batches[0]?.expiryDate || '-';
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addToCart(product)}
                        className="text-right bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-600/60 rounded-xl p-3 transition flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-slate-400">
                              {product.barcode}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${product.totalStock <= product.minStockAlert
                                  ? 'bg-rose-950 text-rose-300 border border-rose-700'
                                  : 'bg-slate-800 text-slate-300'
                                }`}
                            >
                              الرصيد: {product.totalStock} {product.weightUnit}
                            </span>
                          </div>
                          <h3 className="font-bold text-sm text-white mt-1">
                            {product.name}
                          </h3>
                          {product.category && (
                            <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300">
                              {product.category}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            أقرب صلاحية (FIFO): {nearestExpiry}
                          </span>
                          <span className="text-base font-extrabold text-emerald-400">
                            {product.retailPrice.toFixed(2)} ج.م
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="lg:col-span-5 space-y-4">
            {/* Customer Lookup, Loyalty Points & Smart Change Wallet Bar */}
            <div
              className={`bg-slate-900 border rounded-xl p-3.5 space-y-3 transition ${promptCustomerForWalletOpen
                  ? 'border-cyan-400 ring-2 ring-cyan-500/30'
                  : 'border-slate-800'
                }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award size={17} className="text-amber-400" />
                  <h3 className="text-xs font-extrabold text-white">
                    حساب العميل: محفظة الفكة ونقاط الولاء (F3 أو Alt+C)
                  </h3>
                </div>
                {loyaltySettings.isEnabled && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold">
                    كل {loyaltySettings.spendAmountPerPoint} ج.م = 1 نقطة
                  </span>
                )}
              </div>

              {promptCustomerForWalletOpen && !attachedCustomer && (
                <div className="bg-cyan-950/60 border border-cyan-600/60 rounded-lg px-3 py-2 text-xs text-cyan-200 flex items-center justify-between">
                  <span>
                    أدخل رقم موبايل العميل لحفظ الفكة (
                    <strong>{totalChangeDue.toFixed(2)} ج.م</strong>) في محفظته فوراً:
                  </span>
                  <button
                    type="button"
                    onClick={() => setPromptCustomerForWalletOpen(false)}
                    className="text-cyan-400 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <form onSubmit={handleCustomerLookup} className="flex gap-2">
                <div className="relative flex-1">
                  <Phone
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400"
                  />
                  <input
                    ref={customerPhoneInputRef}
                    type="text"
                    value={customerPhoneInput}
                    onChange={(e) => setCustomerPhoneInput(e.target.value)}
                    placeholder="رقم الموبايل أو كود العميل (مثال: 01000000001 أو C-1001)..."
                    className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg pr-8 pl-3 py-1.5 text-xs font-mono text-white outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0"
                >
                  بحث / ربط
                </button>
                {(attachedCustomer || showNewCustomerMiniForm) && (
                  <button
                    type="button"
                    onClick={clearAttachedCustomer}
                    title="إلغاء ربط العميل"
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-lg text-xs"
                  >
                    <X size={14} />
                  </button>
                )}
              </form>

              {/* Attached Customer Badge: Customer Code + Wallet Balance + Loyalty Points */}
              {attachedCustomer && (
                <div className="bg-slate-950 border border-amber-600/40 rounded-xl p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <UserCheck size={16} className="text-emerald-400" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-extrabold">
                            {formatCustomerCode(attachedCustomer.customerCode)}
                          </span>
                          <p className="text-xs font-extrabold text-white">
                            {getCustomerDisplayName(attachedCustomer)}
                          </p>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                          {attachedCustomer.phone}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Wallet Balance Badge */}
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-extrabold">
                        <Wallet size={13} />
                        رصيد المحفظة: {availableWalletBalance.toFixed(2)} ج.م
                      </span>
                      {/* Points Balance Badge */}
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-extrabold">
                        <Award size={13} />
                        {attachedCustomer.pointsBalance} نقطة
                      </span>

                      {/* Credit Account Badge */}
                      {(Number(attachedCustomer.creditLimit ?? 0) > 0 ||
                        Number(attachedCustomer.creditBalance ?? 0) > 0) && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold border ${Number(attachedCustomer.creditBalance ?? 0) > 0
                                ? 'bg-purple-500/15 border-purple-500/40 text-purple-300'
                                : 'bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                          >
                            <FileText size={13} />
                            الآجل المستحق: {Number(attachedCustomer.creditBalance ?? 0).toFixed(2)} ج.م
                            <span className="text-[10px] text-slate-400">
                              (حد: {Number(attachedCustomer.creditLimit ?? 0).toFixed(2)})
                            </span>
                          </span>
                        )}
                    </div>
                  </div>

                  {/* Action Buttons: Pay from Wallet & Redeem Loyalty Points & Settle Credit Debt */}
                  <div className="flex flex-wrap gap-2 pt-1.5 border-t border-slate-800/80">
                    {Number(attachedCustomer.creditBalance ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setDebtSettlementAmount(String(attachedCustomer.creditBalance ?? ''));
                          setDebtSettlementModalOpen(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/50 transition"
                      >
                        <Banknote size={14} />
                        سداد دفعة من الحساب الآجل
                      </button>
                    )}
                    {availableWalletBalance > 0 && cartSubtotal > 0 && (
                      <button
                        type="button"
                        onClick={() => setUseWalletActive((v) => !v)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${useWalletActive
                            ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-950/50'
                            : 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/50'
                          }`}
                      >
                        <Wallet size={14} />
                        {useWalletActive
                          ? `تم خصم ${walletAmountUsed.toFixed(2)} ج.م من المحفظة ✓`
                          : `خصم من المحفظة (Pay from Wallet)`}
                      </button>
                    )}

                    {canRedeemPoints && (
                      <button
                        type="button"
                        onClick={() => setRedeemPointsActive((v) => !v)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${redeemPointsActive
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950/50'
                            : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/50'
                          }`}
                      >
                        <Gift size={14} />
                        {redeemPointsActive
                          ? `تم خصم النقاط (-${previewRedeemCalc.discountFromPoints.toFixed(2)} ج.م) ✓`
                          : `استبدال النقاط (-${previewRedeemCalc.discountFromPoints.toFixed(2)} ج.م)`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Inline "+ New Customer" Mini-Form when phone does not exist */}
              {showNewCustomerMiniForm && (
                <form
                  onSubmit={handleQuickCreateCustomer}
                  className="bg-slate-950 border border-cyan-600/50 rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                      <UserPlus size={14} />+ تسجيل عميل جديد ({customerPhoneInput})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewCustomerMiniForm(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="اسم العميل (اختياري — يُ assigned كود تلقائي مثل C-1004 للخصوصية)..."
                      autoFocus
                      className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                    />
                    <button
                      type="submit"
                      className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs shrink-0"
                    >
                      حفظ وربط
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                  <h2 className="font-bold text-base text-white flex items-center gap-2">
                    <ShoppingCart size={18} className="text-cyan-400" />
                    الفاتورة الحالية
                  </h2>
                  <div className="flex items-center gap-2">
                    {cart.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          promptManagerPin(
                            'إلغاء وتفريغ الفاتورة الحالية بالكامل',
                            'CANCEL_CART',
                            () => setCart([]),
                            `إلغاء سلة كاملة تحتوي على ${cart.length} أصناف بقيمة ${cartSubtotal.toFixed(2)} ج.م`
                          )
                        }
                        className="flex items-center gap-1 text-xs bg-rose-950/60 hover:bg-rose-900 border border-rose-600/50 text-rose-300 px-2 py-1 rounded-lg font-bold"
                        title="إلغاء الفاتورة بتصريح المشرف"
                      >
                        <Lock size={12} className="text-amber-400" />
                        <span>إلغاء الفاتورة</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setBlindCloseStep('COUNT');
                        setActualEndCash('');
                        setZReportModalOpen(true);
                      }}
                      className="text-xs bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/50 px-2.5 py-1 rounded-lg font-semibold"
                    >
                      إغلاق الوردية (تقرير Z)
                    </button>
                  </div>
                </div>

                <div className="mb-4 border border-slate-800 bg-slate-950/80 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-cyan-300">الفواتير المؤجلة</span>
                    <button
                      type="button"
                      onClick={handleParkCurrentCart}
                      disabled={cart.length === 0}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold border border-cyan-500/60 bg-cyan-600/20 text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      تعليق الفاتورة
                    </button>
                  </div>

                  {parkedInvoices.length === 0 ? (
                    <p className="text-[11px] text-slate-500">لا توجد فواتير مؤجلة في هذا الجهاز.</p>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto">
                      {parkedInvoices.map((invoice) => {
                        const invoiceTotal = invoice.items.reduce(
                          (sum, item) => sum + Number(item.product.retailPrice) * item.quantity,
                          0
                        );

                        return (
                          <div
                            key={invoice.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 p-2"
                          >
                            <div className="min-w-0">
                              <p className="text-[11px] text-slate-300 font-bold truncate">
                                {invoice.customerName ?? invoice.customerPhone ?? 'عميل غير محدد'}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {invoice.items.length} أصناف • {invoiceTotal.toFixed(2)} ج.م
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {new Date(invoice.createdAt).toLocaleString('ar-EG', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })}
                              </p>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleResumeParkedInvoice(invoice.id)}
                                className="px-2 py-1 rounded bg-emerald-600/20 border border-emerald-500/50 text-[10px] font-bold text-emerald-300"
                              >
                                استئناف
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteParkedInvoice(invoice.id)}
                                className="px-2 py-1 rounded bg-rose-600/20 border border-rose-500/50 text-[10px] font-bold text-rose-300"
                              >
                                حذف
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {cart.length === 0 ? (
                  <div className="py-10 text-center text-slate-500 text-sm">
                    السلة فارغة — امسح الباركود أو اختر صنفاً للبدء
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pl-1">
                    {cart.map((item) => (
                      <div
                        key={item.product.id}
                        className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-white">{item.product.name}</p>
                          <p className="text-xs text-slate-400">
                            {item.product.retailPrice.toFixed(2)} ج.م × {item.quantity}
                            سعر الوحدة: {item.product.retailPrice.toFixed(2)} ج.م × الكمية: {item.quantity}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-emerald-400">
                            {(item.product.retailPrice * item.quantity).toFixed(2)} ج.م
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              promptManagerPin(
                                `إلغاء الصنف "${item.product.name}" من الفاتورة`,
                                'VOID_ITEM',
                                () =>
                                  setCart((prev) =>
                                    prev.filter((i) => i.product.id !== item.product.id)
                                  ),
                                `إلغاء صنف: ${item.product.name} × ${item.quantity}`
                              )
                            }
                            aria-label="حذف الصنف بتصريح المشرف"
                            className="text-rose-400 hover:text-rose-300 p-1 flex items-center gap-0.5"
                            title="حذف بتصريح المشرف (Manager PIN)"
                          >
                            <Trash2 size={14} />
                            <Lock size={10} className="text-amber-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['CASH', 'CARD', 'SPLIT', 'CREDIT'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => {
                        if (method === 'CREDIT') {
                          if (!attachedCustomer) {
                            toast.error('يجب ربط حساب العميل أولاً لإتمام البيع بالآجل (الشكك)');
                            customerPhoneInputRef.current?.focus();
                            return;
                          }
                          const debt = Number(attachedCustomer.creditBalance ?? 0);
                          const limit = Number(attachedCustomer.creditLimit ?? 0);
                          if (limit <= 0) {
                            toast.error('هذا العميل غير مفعّل له حد ائتمان للبيع بالآجل');
                            return;
                          }
                          if (debt + invoiceNetTotal > limit) {
                            toast.error(
                              `تجاوز الحد الائتماني! المتاح: ${(limit - debt).toFixed(2)} ج.م`
                            );
                            return;
                          }
                        }
                        setPaymentMethod(method);
                      }}
                      className={`py-2 rounded-lg text-xs font-bold border transition ${paymentMethod === method
                          ? method === 'CREDIT'
                            ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                            : 'bg-emerald-600 border-emerald-400 text-white shadow-md'
                          : method === 'CREDIT'
                            ? 'bg-slate-950 border-purple-800/60 text-purple-300 hover:bg-purple-950/40'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                        }`}
                    >
                      {method === 'CASH'
                        ? 'نقدي (كاش)'
                        : method === 'CARD'
                          ? 'بطاقة بنكية'
                          : method === 'SPLIT'
                            ? 'دفع مشترك'
                            : 'آجل / شكك (Credit)'}
                    </button>
                  ))}
                </div>

                {/* Subtotal, Points Discount, Wallet Deduction & Projected Points */}
                {cart.length > 0 && (
                  <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2.5 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>إجمالي الأصناف:</span>
                      <span className="font-semibold text-slate-200">
                        {cartSubtotal.toFixed(2)} ج.م
                      </span>
                    </div>

                    {loyaltyCalc.discountFromPoints > 0 && (
                      <div className="flex justify-between text-amber-300 font-bold">
                        <span>
                          خصم استبدال النقاط ({loyaltyCalc.pointsRedeemed} نقطة):
                        </span>
                        <span>-{loyaltyCalc.discountFromPoints.toFixed(2)} ج.م</span>
                      </div>
                    )}

                    {walletAmountUsed > 0 && (
                      <div className="flex justify-between text-cyan-300 font-bold">
                        <span>مدفوع من محفظة الفكة:</span>
                        <span>-{walletAmountUsed.toFixed(2)} ج.م</span>
                      </div>
                    )}

                    {loyaltySettings.isEnabled && (
                      <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800/80">
                        <span>النقاط المكتسبة من الفاتورة:</span>
                        <span className="font-extrabold text-amber-300">
                          +{projectedPointsEarned} نقطة
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-sm text-slate-300 font-semibold">
                    المطلوب سداده نقداً:
                  </span>
                  <span className="text-2xl font-extrabold text-emerald-400">
                    {remainingCashDue.toFixed(2)} ج.م
                  </span>
                </div>

                {/* Tendered Cash & Smart Change Wallet Routing */}
                {cart.length > 0 && paymentMethod !== 'CARD' && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Banknote size={15} className="text-emerald-400" />
                        المبلغ المدفوع من العميل (ج.م):
                      </label>
                      <div className="flex gap-1">
                        {[remainingCashDue, 50, 100, 200]
                          .filter((v, idx, arr) => v >= remainingCashDue && arr.indexOf(v) === idx)
                          .slice(0, 4)
                          .map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setTenderedCashInput(String(preset))}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200 border border-slate-700"
                            >
                              {preset === remainingCashDue ? 'بالضبط' : `${preset}`}
                            </button>
                          ))}
                      </div>
                    </div>

                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={tenderedCashInput}
                      onChange={(e) => setTenderedCashInput(e.target.value)}
                      placeholder={`${remainingCashDue.toFixed(2)} (أدخل المبلغ النقدي المستلم لمعرفة الباقي)`}
                      className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-sm font-bold text-white outline-none"
                    />

                    {/* When Tendered Cash > Order Total: Show Change Due & Wallet Routing Options */}
                    {totalChangeDue > 0 && (
                      <div className="bg-slate-900/90 border border-amber-500/40 rounded-xl p-2.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-amber-300 flex items-center gap-1">
                            <Coins size={14} />
                            الباقي المستحق للعميل (الفكة):
                          </span>
                          <span className="text-base font-extrabold text-amber-400">
                            {totalChangeDue.toFixed(2)} ج.م
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={activateCashChange}
                            className={`py-1.5 px-2.5 rounded-lg text-[11px] font-extrabold border transition flex items-center justify-center gap-1 ${changeMode === 'CASH'
                                ? 'bg-emerald-600 border-emerald-400 text-white'
                                : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
                              }`}
                          >
                            [F8] صرف الفكة نقداً ({totalChangeDue.toFixed(2)})
                          </button>

                          <button
                            type="button"
                            onClick={activateSaveChangeToWallet}
                            className={`py-1.5 px-2.5 rounded-lg text-[11px] font-extrabold border transition flex items-center justify-center gap-1 ${changeMode === 'WALLET' && attachedCustomer
                                ? 'bg-cyan-600 border-cyan-400 text-white'
                                : 'bg-slate-950 border-cyan-700/60 text-cyan-300 hover:bg-cyan-950/50'
                              }`}
                          >
                            <Wallet size={13} />
                            [F9] حفظ الفكة في المحفظة
                          </button>
                        </div>

                        {/* Split Change Option (تقسيم الفكة بين كاش ومحفظة) */}
                        {attachedCustomer && (
                          <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => {
                                  setChangeMode('SPLIT');
                                  const suggestedCash = Math.floor(totalChangeDue / 5) * 5;
                                  setSplitCashReturnedInput(String(suggestedCash));
                                }}
                                className={`text-[11px] font-bold underline ${changeMode === 'SPLIT'
                                    ? 'text-cyan-300'
                                    : 'text-slate-400 hover:text-slate-200'
                                  }`}
                              >
                                تقسيم الفكة (إرجاع جزء نقداً والباقي للمحفظة)
                              </button>
                            </div>

                            {changeMode === 'SPLIT' && (
                              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800 text-xs">
                                <div>
                                  <span className="block text-[10px] text-slate-400 mb-0.5">
                                    المرتجع نقداً (ج.م):
                                  </span>
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    max={totalChangeDue}
                                    value={splitCashReturnedInput}
                                    onChange={(e) => setSplitCashReturnedInput(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-bold text-emerald-400 outline-none"
                                  />
                                </div>
                                <div>
                                  <span className="block text-[10px] text-slate-400 mb-0.5">
                                    يُحفظ بالمحفظة (ج.م):
                                  </span>
                                  <div className="w-full bg-slate-900 border border-cyan-800/60 rounded px-2 py-1 text-xs font-extrabold text-cyan-300">
                                    {changeDepositedToWallet.toFixed(2)} ج.م
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex justify-between text-[11px] text-slate-300 px-1">
                              <span>
                                نقداً للعميل:{' '}
                                <strong className="text-emerald-400">
                                  {changeGivenCash.toFixed(2)} ج.م
                                </strong>
                              </span>
                              <span>
                                يُضاف للمحفظة:{' '}
                                <strong className="text-cyan-300">
                                  +{changeDepositedToWallet.toFixed(2)} ج.م
                                </strong>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={cart.length === 0 || printingThermal}
                    onClick={() => handleCheckout({ printReceipt: true })}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-extrabold text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white shadow-lg shadow-emerald-950/50 transition"
                  >
                    <Printer size={18} />
                    <span>إتمام الدفع وطباعة الإيصال + فتح الدرج [F10]</span>
                  </button>

                  <button
                    type="button"
                    disabled={cart.length === 0 || printingThermal}
                    onClick={() => handleCheckout({ printReceipt: false })}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-extrabold text-xs bg-cyan-950/80 hover:bg-cyan-900/90 border border-cyan-500/60 disabled:bg-slate-900 disabled:border-slate-800 disabled:text-slate-600 text-cyan-200 transition"
                    title="حفظ الفاتورة وفتح درج النقدية بدون طباعة ورقية لتوفير رول الورق الحراري"
                  >
                    <KeyRound size={15} className="text-cyan-400" />
                    <span>إتمام الدفع وفتح الدرج بدون طباعة (توفير الورق) [F12]</span>
                  </button>
                </div>
              </div>
            </div>

            {lastReceipt && (
              <div className="bg-white text-slate-900 rounded-xl p-4 font-mono text-xs shadow-xl border-t-4 border-emerald-600">
                <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
                  <div className="flex justify-between items-center mb-1.5">
                    <button
                      type="button"
                      onClick={() => setLastReceipt(null)}
                      className="text-slate-400 hover:text-slate-700 text-xs px-2 py-0.5 rounded bg-slate-100"
                      title="إغلاق الإيصال"
                    >
                      إغلاق ✕
                    </button>
                    <button
                      type="button"
                      disabled={printingThermal}
                      onClick={() => void handlePrintReceiptToThermal(lastReceipt, false)}
                      className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-2.5 py-1 rounded shadow-sm"
                      title="طباعة الإيصال على الطابعة الحرارية 80mm"
                    >
                      <Printer size={13} />
                      {printingThermal ? 'جاري الطباعة...' : 'طباعة حرارية'}
                    </button>
                  </div>
                  <p className="font-bold text-sm">Alamir Market - ماركت الأمير</p>
                  <p>جمهورية مصر العربية - إيصال مبيعات (80mm ESC/POS)</p>
                  <p>رقم الفاتورة: {lastReceipt.orderNumber}</p>
                  <p>التاريخ: {lastReceipt.createdAt}</p>
                  {(lastReceipt.customerCode || lastReceipt.customerName) && (
                    <div className="mt-1 pt-1 border-t border-dashed border-slate-300 text-slate-900">
                      {lastReceipt.customerCode && (
                        <p className="font-bold">
                          رقم العميل: {formatCustomerCode(lastReceipt.customerCode)}
                        </p>
                      )}
                      <p className="font-bold">
                        العميل:{' '}
                        {getCustomerDisplayName({
                          name: lastReceipt.customerName,
                          customerCode: lastReceipt.customerCode,
                        })}
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 border-b border-dashed border-slate-400 pb-2 mb-2">
                  <div className="flex justify-between text-[11px] font-bold text-slate-600 border-b border-dashed border-slate-200 pb-1 mb-1">
                    <span>الصنف / تفاصيل السعر</span>
                    <span>الإجمالي</span>
                  </div>
                  {lastReceipt.items.map((item, idx) => (
                    <div key={idx} className="space-y-0.5">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>{item.name}</span>
                        <span>{(item.unitPrice * item.quantity).toFixed(2)} ج.م</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-600 font-mono">
                        <span>الكمية: {item.quantity} × سعر الوحدة: {item.unitPrice.toFixed(2)} ج.م</span>
                      </div>
                    </div>
                  ))}
                </div>
                {(lastReceipt.discountFromPoints ?? 0) > 0 && (
                  <div className="flex justify-between text-xs font-bold text-amber-800 mb-1">
                    <span>خصم نقاط الولاء ({lastReceipt.pointsRedeemed} نقطة):</span>
                    <span>-{(lastReceipt.discountFromPoints ?? 0).toFixed(2)} ج.م</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm">
                  <span>الإجمالي النهائي:</span>
                  <span>{lastReceipt.totalAmount.toFixed(2)} ج.م</span>
                </div>

                {/* Smart Change Wallet Section on Thermal Receipt */}
                {((lastReceipt.walletAmountUsed ?? 0) > 0 ||
                  (lastReceipt.changeDepositedToWallet ?? 0) > 0 ||
                  (lastReceipt.paidAmount ?? 0) > 0) && (
                    <div className="mt-1.5 pt-1.5 border-t border-dashed border-slate-300 space-y-0.5 text-[11px]">
                      {(lastReceipt.walletAmountUsed ?? 0) > 0 && (
                        <div className="flex justify-between font-bold text-cyan-900">
                          <span>مدفوع من المحفظة:</span>
                          <span>{(lastReceipt.walletAmountUsed ?? 0).toFixed(2)} ج.م</span>
                        </div>
                      )}
                      {(lastReceipt.paidAmount ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span>النقدية المدفوعة:</span>
                          <span>{(lastReceipt.paidAmount ?? 0).toFixed(2)} ج.م</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>الباقي نقداً للعميل:</span>
                        <span>{(lastReceipt.changeGiven ?? 0).toFixed(2)} ج.م</span>
                      </div>
                      {(lastReceipt.changeDepositedToWallet ?? 0) > 0 && (
                        <div className="flex justify-between font-bold text-emerald-800">
                          <span>الباقي مضاف للمحفظة:</span>
                          <span>
                            {(lastReceipt.changeDepositedToWallet ?? 0).toFixed(2)} ج.م
                          </span>
                        </div>
                      )}
                      {lastReceipt.customerWalletBalance !== undefined &&
                        ((lastReceipt.changeDepositedToWallet ?? 0) > 0 ||
                          (lastReceipt.walletAmountUsed ?? 0) > 0) && (
                          <div className="flex justify-between font-bold text-slate-900">
                            <span>رصيد محفظتك الحالي:</span>
                            <span>{lastReceipt.customerWalletBalance.toFixed(2)} ج.م</span>
                          </div>
                        )}
                    </div>
                  )}

                {/* Loyalty Points & Wallet Section on Thermal Receipt */}
                {(lastReceipt.customerCode || lastReceipt.customerName) && (
                  <div className="mt-2 pt-2 border-t border-dashed border-slate-400 space-y-0.5 text-[11px]">
                    <p className="font-bold text-center">--- ملخص حساب العميل (نقاط ومحفظة) ---</p>
                    {lastReceipt.customerCode && (
                      <div className="flex justify-between">
                        <span>رقم العميل:</span>
                        <span className="font-bold">
                          {formatCustomerCode(lastReceipt.customerCode)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>العميل:</span>
                      <span className="font-bold">
                        {getCustomerDisplayName({
                          name: lastReceipt.customerName,
                          customerCode: lastReceipt.customerCode,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>النقاط المكتسبة بهذه الفاتورة:</span>
                      <span className="font-bold">+{lastReceipt.pointsEarned ?? 0} نقطة</span>
                    </div>
                    <div className="flex justify-between">
                      <span>النقاط المستبدلة:</span>
                      <span className="font-bold">{lastReceipt.pointsRedeemed ?? 0} نقطة</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>الرصيد الإجمالي الجديد للنقاط:</span>
                      <span>{lastReceipt.customerPointsBalance ?? 0} نقطة</span>
                    </div>
                    {lastReceipt.customerWalletBalance !== undefined && (
                      <div className="flex justify-between font-bold text-cyan-900">
                        <span>رصيد محفظة الفكة الحالي:</span>
                        <span>{lastReceipt.customerWalletBalance.toFixed(2)} ج.م</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2 pt-2 border-t border-dashed border-slate-400 text-center text-[11px]">
                  <InvoiceCodeGraphics orderNumber={lastReceipt.orderNumber} />
                  <p className="mt-1 font-bold text-emerald-800">
                    RJ11 Cash Drawer Kick: ESC p 0 25 250 (0x1B 0x70 0x00 0x19 0xFA)
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Parked Invoices Modal ([F4]) */}
      {parkedInvoicesModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Pause size={18} className="text-cyan-400" />
                <h3 className="text-base font-bold text-white">
                  الفواتير المعلقة في الجهاز ({parkedInvoices.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setParkedInvoicesModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {parkedInvoices.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                لا توجد فواتير معلقة حالياً — يمكنك تعليق الفاتورة الحالية في أي وقت عبر [F4]
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {parkedInvoices.map((inv) => {
                  const invTotal = inv.items.reduce(
                    (sum, it) => sum + Number(it.product.retailPrice) * it.quantity,
                    0
                  );
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-cyan-500/40 transition"
                    >
                      <div>
                        <p className="text-xs font-bold text-white">
                          {inv.customerName || inv.customerPhone || 'عميل غير محدد'}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {inv.items.length} أصناف • {invTotal.toFixed(2)} ج.م
                        </p>
                        <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-1">
                          <Clock size={11} />
                          {new Date(inv.createdAt).toLocaleString('ar-EG', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            handleResumeParkedInvoice(inv.id);
                            setParkedInvoicesModalOpen(false);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                        >
                          استئناف الفاتورة
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteParkedInvoice(inv.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setParkedInvoicesModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager PIN Override Modal */}
      {managerPinModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl shadow-amber-950/50">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <KeyRound size={20} className="text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-extrabold text-white">
                  مطلوب تصريح المشرف (Manager PIN)
                </h3>
                <p className="text-[11px] text-amber-300">
                  {managerPinAction?.title || 'إجراء حساس يتطلب موافقة المدير'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-slate-300">
                أدخل رمز PIN للمشرف (الافتراضي: 1234):
              </label>
              <input
                type="password"
                maxLength={6}
                value={managerPinInput}
                onChange={(e) => setManagerPinInput(e.target.value)}
                autoFocus
                placeholder="••••"
                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-4 py-3 text-center text-xl tracking-widest text-white outline-none font-mono"
              />
            </div>

            {/* Quick Keypad */}
            <div className="grid grid-cols-3 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setManagerPinInput((p) => p + String(n))}
                  className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm"
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setManagerPinInput('')}
                className="py-2.5 rounded-lg bg-rose-900/50 text-rose-300 font-bold text-xs"
              >
                مسح
              </button>
              <button
                type="button"
                onClick={() => setManagerPinInput((p) => p + '0')}
                className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setManagerPinInput((p) => p.slice(0, -1))}
                className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                ←
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleConfirmManagerPin}
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-extrabold py-2.5 rounded-xl text-xs transition"
              >
                تأكيد التصريح
              </button>
              <button
                type="button"
                onClick={() => {
                  setManagerPinModalOpen(false);
                  setManagerPinAction(null);
                }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cash In / Out (حركة الصندوق) Modal ([F7]) */}
      {cashMovementModalOpen && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleRecordCashMovement}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  حركة نقدية في درج الوردية ([F7])
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCashMovementModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCashMovementType('CASH_OUT')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${cashMovementType === 'CASH_OUT'
                    ? 'bg-rose-600 border-rose-500 text-white shadow-md'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
              >
                <ArrowDownRight size={15} />
                سحب مصروفات (CASH OUT)
              </button>
              <button
                type="button"
                onClick={() => setCashMovementType('CASH_IN')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 ${cashMovementType === 'CASH_IN'
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
              >
                <ArrowUpRight size={15} />
                توريد نقدية (CASH IN)
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-slate-300 font-semibold">
                المبلغ النقدي (ج.م):
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                required
                value={cashMovementAmount}
                onChange={(e) => setCashMovementAmount(e.target.value)}
                placeholder="مثال: 50.00"
                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-sm text-white font-bold outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-slate-300 font-semibold">
                سبب الحركة / البيان:
              </label>
              <input
                type="text"
                required
                value={cashMovementReason}
                onChange={(e) => setCashMovementReason(e.target.value)}
                placeholder="مثال: شراء أكياس تعبئة، أجرة عامل، فاتورة كهرباء، عهدة إضافية..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2.5 rounded-xl text-xs transition"
              >
                تسجيل حركة النقدية
              </button>
              <button
                type="button"
                onClick={() => setCashMovementModalOpen(false)}
                className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Debt Settlement Modal (سداد دفعة آجل) */}
      {debtSettlementModalOpen && attachedCustomer && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSettleCustomerDebt}
            className="bg-slate-900 border border-purple-500/50 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Banknote size={18} className="text-purple-400" />
                <h3 className="text-base font-bold text-white">
                  سداد دفعة نقدية من الحساب الآجل (الشكك)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDebtSettlementModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">العميل:</span>
                <span className="font-bold text-white">
                  {getCustomerDisplayName(attachedCustomer)} ({formatCustomerCode(attachedCustomer.customerCode)})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">رقم الهاتف:</span>
                <span className="font-mono text-slate-300">{attachedCustomer.phone}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-1.5 text-sm">
                <span className="text-slate-400 font-semibold">إجمالي الدين المستحق الحالي:</span>
                <span className="font-extrabold text-purple-400">
                  {Number(attachedCustomer.creditBalance ?? 0).toFixed(2)} ج.م
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-slate-300 font-semibold">
                المبلغ المدفوع نقداً للسداد (ج.م):
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max={Number(attachedCustomer.creditBalance ?? 0)}
                required
                value={debtSettlementAmount}
                onChange={(e) => setDebtSettlementAmount(e.target.value)}
                placeholder="أدخل المبلغ المسدد..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-purple-400 rounded-xl px-3 py-2 text-sm text-white font-bold outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-slate-300 font-semibold">
                ملاحظات أو بيان السداد (اختياري):
              </label>
              <input
                type="text"
                value={debtSettlementNotes}
                onChange={(e) => setDebtSettlementNotes(e.target.value)}
                placeholder="مثال: سداد نقدي جزئي، تسوية شكك أسبوعية..."
                className="w-full bg-slate-950 border border-slate-700 focus:border-purple-400 rounded-xl px-3 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 rounded-xl text-xs transition"
              >
                تأكيد السداد وتوريد النقدية للدرج
              </button>
              <button
                type="button"
                onClick={() => setDebtSettlementModalOpen(false)}
                className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Return Receipt Preview Modal */}
      {lastReturnReceipt && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-white text-slate-900 border border-slate-300 rounded-2xl max-w-sm w-full p-5 space-y-3 font-mono text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-dashed border-slate-400 pb-2">
              <span className="font-extrabold text-sm text-rose-700">
                إيصال مرتجع مبيعات (ESC/POS)
              </span>
              <button
                type="button"
                onClick={() => setLastReturnReceipt(null)}
                className="text-slate-500 hover:text-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <pre className="whitespace-pre-wrap font-mono text-[11px] bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-800 leading-relaxed">
              {lastReturnReceipt.previewText}
            </pre>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  window.print();
                  setLastReturnReceipt(null);
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                <Printer size={15} />
                طباعة الإيصال الحراري
              </button>
              <button
                type="button"
                onClick={() => setLastReturnReceipt(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Z-Report Modal with True Blind Close */}
      {zReportModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-base font-extrabold text-white">
                  {blindCloseStep === 'COUNT'
                    ? 'الإغلاق الأعمى للوردية (Blind Close)'
                    : 'مطابقة وإغلاق الوردية (Z-Report)'}
                </h3>
                <p className="text-xs text-amber-300">
                  {blindCloseStep === 'COUNT'
                    ? 'النقدية المتوقعة مخفية لمنع التلاعب — قم بعد الدرج فعلياً'
                    : 'تقرير المطابقة الشامل وكشف العجز أو الزيادة'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZReportModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {blindCloseStep === 'COUNT' ? (
              <div className="space-y-4 py-2">
                <div className="p-3.5 bg-slate-950 border border-amber-600/40 rounded-xl text-xs space-y-2">
                  <div className="flex items-center gap-2 text-amber-300 font-bold">
                    <Lock size={15} />
                    <span>نظام العد الأعمى المعتمد في السوبرماركت:</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    لحماية الكاشير ومنع أي تلاعب، لا يتم عرض النقدية المتوقعة حتى يتم إدخال المبلغ
                    المعدود بالدرج فعلياً.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-white">
                    أدخل إجمالي النقدية المعدودة في الدرج الآن (ج.م):
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    autoFocus
                    value={actualEndCash}
                    onChange={(e) => setActualEndCash(e.target.value)}
                    placeholder="مثال: 1250.00"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-lg font-bold text-emerald-400 outline-none"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={actualEndCash.trim() === ''}
                    onClick={() => setBlindCloseStep('REPORT')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-extrabold py-2.5 rounded-xl text-xs transition"
                  >
                    متابعة وفحص المطابقة
                  </button>
                  <button
                    type="button"
                    onClick={() => setZReportModalOpen(false)}
                    className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">عهدة بداية الوردية:</span>
                    <span className="font-bold text-white">{LOCAL_STARTING_CASH.toFixed(2)} ج.م</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">إجمالي المبيعات النقدية:</span>
                    <span className="font-bold text-emerald-400">+{cashSalesTotal.toFixed(2)} ج.م</span>
                  </div>
                  {totalCashIn > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">توريدات نقدية / سداد آجل (CASH IN):</span>
                      <span className="font-bold text-cyan-400">+{totalCashIn.toFixed(2)} ج.م</span>
                    </div>
                  )}
                  {totalCashOut > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">سحب مصروفات نثرية (CASH OUT):</span>
                      <span className="font-bold text-rose-400">-{totalCashOut.toFixed(2)} ج.م</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">فكة مضافة للمحافظ:</span>
                    <span className="font-bold text-cyan-400">
                      +{totalChangeCreditedToWallets.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">مدفوعات من المحافظ:</span>
                    <span className="font-bold text-amber-400">
                      -{totalWalletRedemptions.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-2 text-sm">
                    <span className="text-slate-200 font-bold">النقدية المتوقعة بالدرج:</span>
                    <span className="font-extrabold text-white">
                      {expectedDrawerCash.toFixed(2)} ج.م
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center text-xs">
                  <span>المبلغ الفعلي المعدود بالدرج:</span>
                  <span className="font-extrabold text-base text-cyan-300">
                    {countedCashNum.toFixed(2)} ج.م
                  </span>
                </div>

                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-bold ${drawerDiscrepancy === 0
                      ? 'bg-emerald-950/40 border-emerald-600/60 text-emerald-300'
                      : drawerDiscrepancy > 0
                        ? 'bg-cyan-950/40 border-cyan-600/60 text-cyan-300'
                        : 'bg-rose-950/40 border-rose-600/60 text-rose-300'
                    }`}
                >
                  <span>حالة المطابقة:</span>
                  <span className="text-sm font-extrabold">
                    {drawerDiscrepancy === 0
                      ? 'مطابق تماماً (0.00 ج.م)'
                      : drawerDiscrepancy > 0
                        ? `فائض في الدرج (+${drawerDiscrepancy.toFixed(2)} ج.م)`
                        : `عجز في الدرج (${drawerDiscrepancy.toFixed(2)} ج.م)`}
                  </span>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      LocalSqliteBridge.enqueueClosedShift(
                        LOCAL_SHIFT_ID,
                        countedCashNum,
                        expectedDrawerCash,
                        {
                          totalChangeCreditedToWallets,
                          totalWalletRedemptions,
                        }
                      );
                      void printZReportCloud({
                        shiftId: LOCAL_SHIFT_ID,
                        cashierName: 'كاشير الأمير',
                        paperWidth: '80mm',
                        startingCash: LOCAL_STARTING_CASH,
                        totalCashSales: cashSalesTotal,
                        totalCardSales: offlineQueue
                          .filter((o) => o.paymentMethod === 'CARD')
                          .reduce((sum, o) => sum + o.totalAmount, 0),
                        totalReturns: 0,
                        totalChangeCreditedToWallets,
                        totalWalletRedemptions,
                        expectedCash: expectedDrawerCash,
                        actualEndCash: countedCashNum,
                        discrepancy: drawerDiscrepancy,
                      });
                      refreshLocal();
                      setZReportModalOpen(false);
                      toast.success(
                        'تم إصدار تقرير Z-Report وطباعته على الطابعة الحرارية وجدولة إغلاق الوردية للمزامنة السحابية'
                      );
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold py-2.5 rounded-xl text-xs transition"
                  >
                    طباعة تقرير Z وتأكيد الإغلاق
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlindCloseStep('COUNT')}
                    className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                  >
                    تعديل العد
                  </button>
                  <button
                    type="button"
                    onClick={() => setZReportModalOpen(false)}
                    className="px-3 py-2.5 bg-slate-800 text-slate-400 rounded-xl text-xs"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PosPage;

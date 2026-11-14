import React, { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Layers, SlidersHorizontal, Tag, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { LocalBatch, LocalProduct, LocalSqliteBridge } from '../lib/offlineSqlite';
import { daysUntil } from '../lib/dates';
import { downloadReport, handleUnauthorized } from '../lib/auth';
import { bulkDeleteProductsCloud, deleteProductCloud } from '../lib/cloud';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

type StatusFilter = 'ALL' | 'NEAR_EXPIRY' | 'LOW_STOCK';
type AdjustmentMode = 'ADD_BATCH' | 'RECONCILE';

const DEFAULT_CATEGORIES = [
  'ألبان وأجبان',
  'بقالة جافة',
  'زيوت وسمن',
  'مشروبات وعصائر',
  'مخبوزات وحلويات',
  'مجمدات ولحوم',
  'منظفات وعناية',
  'عام',
];

interface BulkPreviewRow {
  rowNumber: number;
  barcode: string;
  name: string;
  category: string;
  weightUnit: string;
  description?: string;
  retailPrice: number;
  costPrice: number;
  quantity: number;
  expiryDate: string;
  batchNumber: string;
  minStockAlert: number;
  isAvailableOnline: boolean;
  action: 'CREATE' | 'UPDATE';
  valid: boolean;
  errors: string[];
}

type ModalState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'edit'; product: LocalProduct }
  | { type: 'batch'; product: LocalProduct }
  | { type: 'adjust'; product: LocalProduct }
  | { type: 'bulk' }
  | { type: 'delete'; targets: LocalProduct[] };

interface Props {
  products: LocalProduct[];
  isOffline: boolean;
  onProductsChange: (products: LocalProduct[]) => void;
  onStatus?: (message: string) => void;
}

const NEAR_EXPIRY_DAYS = 30;
const AUDIT_REASONS = [
  'تالف',
  'منتهي الصلاحية',
  'خطأ جرد',
  'عجز مخزني',
  'استهلاك داخلي',
];

const inputCls =
  'w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-white outline-none';

const generateBarcode = () =>
  `622${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`;

/** Calls the cloud API. Returns null when no admin session/offline (local-only mode). */
async function cloudRequest<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  isOffline: boolean
): Promise<T | null> {
  const token = localStorage.getItem('alamir_jwt_token');
  if (!token || isOffline) return null;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  }
  if (!res.ok) {
    throw new Error(json.message || `فشل الطلب (${res.status})`);
  }
  return json.data as T;
}

export function AdminCatalog({ products, isOffline, onProductsChange, onStatus }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Instant price edit
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [newRetailPrice, setNewRetailPrice] = useState('');

  // Product form
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('عام');
  const [weightUnit, setWeightUnit] = useState('قطعة');
  const [retailPrice, setRetailPrice] = useState('');
  const [minStock, setMinStock] = useState('5');
  const [online, setOnline] = useState(false);

  // Batch & Direct Stock Adjustment form
  const [adjustMode, setAdjustMode] = useState<AdjustmentMode>('RECONCILE');
  const [batchNumber, setBatchNumber] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [deductQuantity, setDeductQuantity] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [auditReason, setAuditReason] = useState<string>(AUDIT_REASONS[0]);
  const [auditNotes, setAuditNotes] = useState('');

  // Bulk Excel Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewRows, setPreviewRows] = useState<BulkPreviewRow[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Multi-select & delete products state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const availableCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    for (const p of products) {
      if (p.category?.trim()) set.add(p.category.trim());
    }
    return Array.from(set);
  }, [products]);

  const resetForms = () => {
    setBarcode('');
    setName('');
    setCategory('عام');
    setWeightUnit('قطعة');
    setRetailPrice('');
    setMinStock('5');
    setOnline(false);
    setAdjustMode('RECONCILE');
    setBatchNumber('');
    setCostPrice('');
    setQuantity('');
    setExpiryDate('');
    setDeductQuantity('');
    setSelectedBatchId('');
    setAuditReason(AUDIT_REASONS[0]);
    setAuditNotes('');
    setSelectedFile(null);
    setPreviewRows([]);
    setError('');
  };

  const closeModal = () => {
    setModal({ type: 'none' });
    resetForms();
  };

  const openCreate = () => {
    resetForms();
    setBarcode(generateBarcode());
    setModal({ type: 'create' });
  };

  const openEdit = (product: LocalProduct) => {
    resetForms();
    setBarcode(product.barcode);
    setName(product.name);
    setCategory(product.category || 'عام');
    setWeightUnit(product.weightUnit || 'قطعة');
    setMinStock(String(product.minStockAlert));
    setOnline(product.isAvailableOnline);
    setModal({ type: 'edit', product });
  };

  const openBatch = (product: LocalProduct) => {
    resetForms();
    setBatchNumber(`B-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
    setModal({ type: 'batch', product });
  };

  const openAdjustStock = (product: LocalProduct) => {
    resetForms();
    setAdjustMode('RECONCILE');
    setBatchNumber(`B-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
    setModal({ type: 'adjust', product });
  };

  const openBulkImport = () => {
    resetForms();
    setModal({ type: 'bulk' });
  };

  const openDeleteModal = (targets: LocalProduct[]) => {
    if (targets.length === 0) return;
    resetForms();
    setModal({ type: 'delete', targets });
  };

  const toggleSelectOne = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const cat = p.category || 'عام';
      if (categoryFilter !== 'ALL' && cat !== categoryFilter) return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.barcode.includes(q) &&
        !cat.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === 'LOW_STOCK') return p.totalStock <= p.minStockAlert;
      if (filter === 'NEAR_EXPIRY') {
        return p.batches.some((b) => b.quantity > 0 && daysUntil(b.expiryDate) <= NEAR_EXPIRY_DAYS);
      }
      return true;
    });
  }, [products, search, filter, categoryFilter]);

  const validateBatch = (): string | null => {
    if (!batchNumber.trim()) return 'رقم التشغيلة مطلوب';
    if (!(Number(costPrice) > 0)) return 'سعر التكلفة يجب أن يكون أكبر من صفر';
    if (!(Number.isInteger(Number(quantity)) && Number(quantity) > 0))
      return 'الكمية يجب أن تكون عدداً صحيحاً أكبر من صفر';
    if (!expiryDate) return 'تاريخ الصلاحية مطلوب';
    return null;
  };

  const batchPayload = () => ({
    batchNumber: batchNumber.trim(),
    costPrice: Number(costPrice),
    quantity: Number(quantity),
    expiryDate: new Date(expiryDate).toISOString(),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || barcode.trim().length < 3) return setError('الباركود مطلوب (3 أحرف على الأقل)');
    if (name.trim().length < 2) return setError('اسم الصنف مطلوب');
    if (!(Number(retailPrice) > 0)) return setError('سعر البيع يجب أن يكون أكبر من صفر');
    if (!(Number(minStock) >= 0)) return setError('حد الطلب الأدنى غير صالح');

    const hasBatch = batchNumber || costPrice || quantity || expiryDate;
    if (hasBatch) {
      const batchError = validateBatch();
      if (batchError) return setError(batchError);
    }
    if (products.some((p) => p.barcode === barcode.trim())) {
      return setError('الباركود مسجل لصنف آخر بالفعل');
    }

    setBusy(true);
    setError('');
    try {
      const cloud = await cloudRequest<{ id: string }>(
        'POST',
        '/api/products',
        {
          barcode: barcode.trim(),
          name: name.trim(),
          category: category.trim() || 'عام',
          weightUnit: weightUnit.trim() || 'قطعة',
          retailPrice: Number(retailPrice),
          minStockAlert: Number(minStock),
          isAvailableOnline: online,
        },
        isOffline
      );
      const productId = cloud?.id ?? `local-${Date.now()}`;

      const batches: LocalBatch[] = [];
      if (hasBatch) {
        const cloudBatch = await cloudRequest<{ id: string }>(
          'POST',
          `/api/products/${productId}/batches`,
          batchPayload(),
          isOffline
        );
        batches.push({
          id: cloudBatch?.id ?? `local-b-${Date.now()}`,
          batchNumber: batchNumber.trim(),
          quantity: Number(quantity),
          expiryDate,
          costPrice: Number(costPrice),
        });
      }

      const initialStock = batches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
      const next = LocalSqliteBridge.upsertProduct({
        id: productId,
        barcode: barcode.trim(),
        name: name.trim(),
        category: category.trim() || 'عام',
        weightUnit: weightUnit.trim() || 'قطعة',
        retailPrice: Number(retailPrice),
        totalStock: initialStock,
        minStockAlert: Number(minStock),
        isAvailableOnline: online,
        updatedAt: new Date().toISOString(),
        batches,
      });
      onProductsChange(next);
      const createMsg = cloud
        ? `تم إضافة المنتج "${name.trim()}" في قسم "${category.trim() || 'عام'}"`
        : `تم حفظ المنتج "${name.trim()}" محلياً فقط (لا توجد جلسة إدارة سحابية متصلة)`;
      toast.success(createMsg);
      onStatus?.(createMsg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إضافة المنتج';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.type !== 'edit') return;
    const product = modal.product;
    if (barcode.trim().length < 3) return setError('الباركود مطلوب (3 أحرف على الأقل)');
    if (name.trim().length < 2) return setError('اسم الصنف مطلوب');
    if (!(Number(minStock) >= 0)) return setError('حد الطلب الأدنى غير صالح');
    if (products.some((p) => p.id !== product.id && p.barcode === barcode.trim())) {
      return setError('الباركود مسجل لصنف آخر بالفعل');
    }

    setBusy(true);
    setError('');
    try {
      const cloud = await cloudRequest(
        'PATCH',
        `/api/products/${product.id}`,
        {
          barcode: barcode.trim(),
          name: name.trim(),
          category: category.trim() || 'عام',
          weightUnit: weightUnit.trim() || product.weightUnit || 'قطعة',
          minStockAlert: Number(minStock),
          isAvailableOnline: online,
        },
        isOffline
      );
      const next = LocalSqliteBridge.upsertProduct({
        ...product,
        barcode: barcode.trim(),
        name: name.trim(),
        category: category.trim() || 'عام',
        weightUnit: weightUnit.trim() || product.weightUnit || 'قطعة',
        minStockAlert: Number(minStock),
        isAvailableOnline: online,
        updatedAt: new Date().toISOString(),
      });
      onProductsChange(next);
      const editMsg =
        cloud !== null
          ? `تم تحديث بيانات "${name.trim()}" في السحابة`
          : `تم تحديث "${name.trim()}" محلياً فقط (لا توجد جلسة إدارة سحابية متصلة)`;
      toast.success(editMsg);
      onStatus?.(editMsg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تحديث المنتج';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.type !== 'batch') return;
    const product = modal.product;
    const batchError = validateBatch();
    if (batchError) return setError(batchError);

    setBusy(true);
    setError('');
    try {
      const cloud = await cloudRequest<{ id: string }>(
        'POST',
        `/api/products/${product.id}/batches`,
        batchPayload(),
        isOffline
      );
      const next = LocalSqliteBridge.addBatchLocal(product.id, {
        id: cloud?.id ?? `local-b-${Date.now()}`,
        batchNumber: batchNumber.trim(),
        quantity: Number(quantity),
        expiryDate,
        costPrice: Number(costPrice),
      });
      onProductsChange(next);
      const batchMsg = `تمت إضافة ${quantity} وحدة إلى "${product.name}" ${
        cloud ? 'في السحابة' : 'محلياً فقط (لا توجد جلسة إدارة سحابية)'
      } وترتيب الصلاحيات وفق FIFO`;
      toast.success(batchMsg);
      onStatus?.(batchMsg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إضافة الدفعة';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.type !== 'adjust') return;
    const product = modal.product;

    if (adjustMode === 'ADD_BATCH') {
      const batchError = validateBatch();
      if (batchError) return setError(batchError);

      setBusy(true);
      setError('');
      try {
        const cloud = await cloudRequest<{ batch?: { id: string } }>(
          'POST',
          `/api/products/${product.id}/adjust-stock`,
          {
            mode: 'ADD_BATCH',
            ...batchPayload(),
          },
          isOffline
        );
        const next = LocalSqliteBridge.addBatchLocal(product.id, {
          id: cloud?.batch?.id ?? `local-b-${Date.now()}`,
          batchNumber: batchNumber.trim(),
          quantity: Number(quantity),
          expiryDate,
          costPrice: Number(costPrice),
        });
        onProductsChange(next);
        const msg = `تمت إضافة شحنة (${quantity} ${product.weightUnit}) للصنف "${product.name}" بنجاح`;
        toast.success(msg);
        onStatus?.(msg);
        closeModal();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'تعذر إضافة الشحنة';
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
      return;
    }

    // RECONCILE mode (تسوية جرد / عجز وتلف)
    const qtyToDeduct = Number(deductQuantity);
    if (!Number.isInteger(qtyToDeduct) || qtyToDeduct <= 0) {
      return setError('الكمية المراد خصمها يجب أن تكون عدداً صحيحاً أكبر من صفر');
    }
    if (qtyToDeduct > product.totalStock) {
      return setError(
        `الكمية المطلوبة للتسوية (${qtyToDeduct}) تتجاوز الرصيد المتاح حالياً (${product.totalStock})`
      );
    }
    if (!auditReason.trim()) {
      return setError('يرجى تحديد سبب التسوية (تالف / منتهي الصلاحية / خطأ جرد)');
    }

    setBusy(true);
    setError('');
    try {
      await cloudRequest(
        'POST',
        `/api/products/${product.id}/adjust-stock`,
        {
          mode: 'RECONCILE',
          quantityToDeduct: qtyToDeduct,
          reason: auditReason,
          batchId: selectedBatchId || undefined,
          notes: auditNotes.trim() || undefined,
        },
        isOffline
      );

      const next = LocalSqliteBridge.reconcileStockLocal({
        productId: product.id,
        quantityToDeduct: qtyToDeduct,
        reason: auditReason,
        batchId: selectedBatchId || undefined,
        notes: auditNotes.trim() || undefined,
      });
      onProductsChange(next);
      const msg = `تمت تسوية الرصيد (-${qtyToDeduct} ${product.weightUnit}) للصنف "${product.name}" — السبب: ${auditReason}`;
      toast.success(msg);
      onStatus?.(msg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إجراء تسوية المخزون';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setTemplateBusy(true);
    try {
      await downloadReport(
        '/api/products/bulk-template',
        `alamir-products-template-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success(
        'تم تحميل قالب الإكسيل شاملاً الأصناف المسجلة وأقسامها الحالية لمنع التكرار'
      );
    } catch {
      const headers = [
        'الباركود (Barcode)',
        'اسم الصنف (Name)',
        'القسم / التصنيف (Category)',
        'الوحدة (Weight Unit)',
        'سعر البيع (Retail Price)',
        'سعر الشراء (Cost Price)',
        'الكمية المضافة (Quantity)',
        'تاريخ الصلاحية (Expiry Date)',
        'رقم التشغيلة (Batch Number)',
        'حد الطلب (Min Stock)',
        'متاح أونلاين (Online Status)',
        'الرصيد الحالي بالنظام (للعلم فقط)',
      ];
      const csvRows = [
        headers.join(','),
        ...products.map((p) => {
          const b = p.batches[0];
          return [
            p.barcode,
            `"${p.name.replace(/"/g, '""')}"`,
            `"${(p.category || 'عام').replace(/"/g, '""')}"`,
            p.weightUnit || 'قطعة',
            p.retailPrice,
            b?.costPrice ?? Number((p.retailPrice * 0.8).toFixed(2)),
            0,
            b?.expiryDate ?? '2027-01-01',
            b?.batchNumber ?? 'B-2026-01',
            p.minStockAlert,
            p.isAvailableOnline ? 'نعم' : 'لا',
            p.totalStock,
          ].join(',');
        }),
      ];
      const blob = new Blob(['\uFEFF' + csvRows.join('\n')], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alamir-products-template-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.info('تم تحميل القالب المحلي بصيغة CSV شاملاً جميع الأصناف المسجلة');
    } finally {
      setTemplateBusy(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.csv')) {
      setError('يرجى اختيار ملف بصيغة .xlsx أو .csv فقط');
      return;
    }

    setSelectedFile(file);
    setError('');
    setPreviewBusy(true);

    try {
      const token = localStorage.getItem('alamir_jwt_token');
      if (token && !isOffline) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/api/products/bulk-import?dryRun=true`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) {
          handleUnauthorized();
          throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
        }
        if (!res.ok) {
          throw new Error(json.message || 'تعذر قراءة ملف الإكسيل');
        }
        setPreviewRows(json.data?.rows || []);
      } else {
        setError('يتطلب فحص ملفات .xlsx اتصالاً بالخادم السحابي');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تحليل الملف المرفوع';
      setError(msg);
      toast.error(msg);
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleConfirmBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = previewRows.filter((r) => r.valid);
    if (!selectedFile || validRows.length === 0) {
      return setError('لا توجد صفوف صالحة للاستيراد. يرجى مراجعة الجدول أعلاه.');
    }

    setBusy(true);
    setError('');
    try {
      const token = localStorage.getItem('alamir_jwt_token');
      if (!token || isOffline) {
        throw new Error('يرجى تسجيل الدخول بحساب المدير لإتمام الاستيراد السحابي');
      }

      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(`${API_BASE}/api/products/bulk-import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
      }
      if (!res.ok) {
        throw new Error(json.message || 'فشل استيراد الأصناف');
      }

      const summary = json.data as {
        createdCount: number;
        updatedCount: number;
        products: LocalProduct[];
      };

      if (Array.isArray(summary.products) && summary.products.length > 0) {
        const normalized: LocalProduct[] = summary.products.map((p: any) => ({
          id: p.id,
          barcode: p.barcode,
          name: p.name,
          category: p.category ?? 'عام',
          weightUnit: p.weightUnit ?? 'قطعة',
          retailPrice: Number(p.retailPrice),
          totalStock: Number(p.totalStock ?? 0),
          minStockAlert: Number(p.minStockAlert ?? 5),
          isAvailableOnline: Boolean(p.isAvailableOnline),
          updatedAt: p.updatedAt,
          batches: (p.batches || []).map((b: any) => ({
            id: b.id,
            batchNumber: b.batchNumber,
            quantity: Number(b.quantity),
            expiryDate: String(b.expiryDate).slice(0, 10),
            costPrice: b.costPrice !== undefined ? Number(b.costPrice) : undefined,
          })),
        }));
        const next = LocalSqliteBridge.applyBulkImportLocal(normalized);
        onProductsChange(next);
      }

      const msg = `تم استيراد ${summary.createdCount} صنف جديد وتحديث ${summary.updatedCount} صنف مسجل بنجاح`;
      toast.success(msg);
      onStatus?.(msg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء الاستيراد';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handlePriceUpdate = async (product: LocalProduct) => {
    const price = Number(newRetailPrice);
    if (!(price > 0)) return;
    try {
      const cloud = await cloudRequest(
        'PATCH',
        `/api/products/${product.id}/price`,
        { retailPrice: price },
        isOffline
      );
      onProductsChange(
        LocalSqliteBridge.upsertProduct({
          ...product,
          retailPrice: price,
          updatedAt: new Date().toISOString(),
        })
      );
      const priceMsg =
        cloud !== null
          ? 'تم حفظ سعر البيع الجديد في السحابة وفرضه فوراً على نقاط البيع'
          : 'تم تحديث السعر محلياً فقط (لا توجد جلسة إدارة سحابية متصلة)';
      toast.success(priceMsg);
      onStatus?.(priceMsg);
      setEditingPriceId(null);
      setNewRetailPrice('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر تحديث السعر';
      toast.error(msg);
      onStatus?.(msg);
    }
  };

  const allVisibleSelected =
    visibleProducts.length > 0 && visibleProducts.every((p) => selectedIds.has(p.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of visibleProducts) next.delete(p.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of visibleProducts) next.add(p.id);
        return next;
      });
    }
  };

  const handleConfirmDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modal.type !== 'delete' || modal.targets.length === 0) return;

    const targets = modal.targets;
    const allIds = targets.map((t) => t.id);
    const cloudIds = allIds.filter((id) => !id.startsWith('local-'));

    setBusy(true);
    setError('');
    try {
      const token = localStorage.getItem('alamir_jwt_token');
      if (token && !isOffline && cloudIds.length > 0) {
        if (cloudIds.length === 1) {
          await deleteProductCloud(cloudIds[0]);
        } else {
          await bulkDeleteProductsCloud(cloudIds);
        }
      }

      const next = LocalSqliteBridge.removeProductsLocal(allIds);
      onProductsChange(next);
      setSelectedIds((prev) => {
        const updated = new Set(prev);
        for (const id of allIds) updated.delete(id);
        return updated;
      });

      const delMsg =
        targets.length === 1
          ? `تم حذف الصنف "${targets[0].name}" نهائياً من قاعدة البيانات`
          : `تم حذف ${targets.length} أصناف محددة نهائياً من قاعدة البيانات`;
      toast.success(delMsg);
      onStatus?.(delMsg);
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر حذف الأصناف من قاعدة البيانات';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const filterButton = (value: StatusFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
        filter === value ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
      }`}
    >
      {label}
    </button>
  );

  const batchFields = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-300 space-y-1">
          <span>رقم التشغيلة</span>
          <input className={inputCls} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>سعر تكلفة الشراء للوحدة (ج.م)</span>
          <input type="number" step="0.01" min="0" className={inputCls} value={costPrice} onChange={(e) => setCostPrice(e.target.value)} />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>الكمية المضافة</span>
          <input type="number" step="1" min="1" className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="text-xs text-slate-300 space-y-1">
          <span>تاريخ انتهاء الصلاحية</span>
          <input type="date" className={inputCls} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </label>
      </div>
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2.5 text-[11px] text-slate-400 leading-relaxed">
        <strong className="text-cyan-300">آلية التعامل مع تواريخ الصلاحية المختلفة (FIFO / FEFO):</strong>
        <br />• إذا كان <span className="text-emerald-300">تاريخ الصلاحية مختلفاً</span> عن الدفعات الحالية: ينشئ النظام دفعة مستقلة جديدة، وعند البيع في الكاشير يتم الخصم تلقائياً من <span className="text-amber-300">الدفعة الأقدم صلاحية أولاً</span> حتى تنفد ثم ينتقل تلقائياً للدفعة الأحدث.
        <br />• إذا كان <span className="text-indigo-300">تاريخ الصلاحية وسعر التكلفة مطابقين</span> لدفعة حالية: يتم دمج الكمية المضافة تلقائياً في نفس الدفعة لمنع تكرار السطور.
      </div>
    </div>
  );

  const categoryInputField = (
    <label className="text-xs text-slate-300 space-y-1 block">
      <span>القسم / التصنيف (Category)</span>
      <input
        list="alamir-categories-list"
        className={inputCls}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="مثال: ألبان وأجبان، بقالة جافة، مشروبات..."
      />
      <datalist id="alamir-categories-list">
        {availableCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </label>
  );

  const modalShell = (
    title: string,
    onSubmit: (e: React.FormEvent) => void,
    children: React.ReactNode,
    submitLabel: string,
    wide = false
  ) => (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <form
        onSubmit={onSubmit}
        className={`bg-slate-900 border border-slate-700 rounded-2xl ${
          wide ? 'max-w-4xl' : 'max-w-lg'
        } w-full p-5 space-y-4 my-auto`}
      >
        <h3 className="text-lg font-bold text-white border-b border-slate-800 pb-2">{title}</h3>
        {children}
        {error && (
          <p role="alert" className="text-xs text-rose-300 bg-rose-950/60 border border-rose-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={busy || previewBusy}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold py-2 rounded-lg text-sm"
          >
            {busy ? 'جاري الحفظ...' : submitLabel}
          </button>
          <button
            type="button"
            onClick={closeModal}
            className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-sm"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );

  const validPreviewCount = previewRows.filter((r) => r.valid).length;
  const invalidPreviewCount = previewRows.filter((r) => !r.valid).length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-base text-white">إدارة كتالوج الأصناف والمخزون</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={templateBusy}
            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60 font-bold text-xs px-3 py-2 rounded-lg transition"
          >
            <FileSpreadsheet size={15} />
            {templateBusy
              ? 'جاري تجهيز القالب...'
              : 'تحميل قالب الإكسيل بالأصناف المسجلة (.xlsx)'}
          </button>
          <button
            type="button"
            onClick={openBulkImport}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-3.5 py-2 rounded-lg shadow-lg shadow-emerald-950/50 transition"
          >
            <Upload size={16} />
            استيراد من إكسيل (Bulk Upload)
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-4 py-2 rounded-lg shadow-lg shadow-indigo-950/50 transition"
          >
            + إضافة منتج جديد
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث فوري بالباركود أو اسم المنتج أو القسم..."
          className={`${inputCls} sm:max-w-xs`}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="تصفية حسب القسم"
          className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none"
        >
          <option value="ALL">كل الأقسام ({products.length})</option>
          {availableCategories.map((cat) => (
            <option key={cat} value={cat}>
              قسم: {cat}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          {filterButton('ALL', 'الكل')}
          {filterButton('NEAR_EXPIRY', 'قارب على الانتهاء')}
          {filterButton('LOW_STOCK', 'مخزون منخفض')}
        </div>
        <span className="text-xs text-slate-500">
          {visibleProducts.length} / {products.length}
        </span>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 mr-auto bg-rose-950/50 border border-rose-700/70 rounded-xl px-3 py-1.5">
            <span className="text-xs font-extrabold text-rose-200">
              تم تحديد {selectedIds.size} صنف
            </span>
            <button
              type="button"
              onClick={() => {
                const targets = products.filter((p) => selectedIds.has(p.id));
                openDeleteModal(targets);
              }}
              className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold px-3 py-1.5 rounded-lg shadow-md shadow-rose-950/60 transition"
            >
              <Trash2 size={14} />
              حذف المحدد من قاعدة البيانات ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800"
            >
              إلغاء التحديد
            </button>
          </div>
        )}
      </div>

      <table className="w-full text-right text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400 text-xs">
            <th className="py-2 px-2 w-8 text-center">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="تحديد كل الأصناف الظاهرة"
                title="تحديد / إلغاء تحديد الكل"
                className="rounded border-slate-600 text-rose-600 focus:ring-rose-500 cursor-pointer"
              />
            </th>
            <th className="py-2 px-2">الباركود</th>
            <th className="py-2 px-2">اسم الصنف والقسم</th>
            <th className="py-2 px-2">الرصيد الكلي</th>
            <th className="py-2 px-2">التشغيلات وتواريخ الصلاحية (FIFO)</th>
            <th className="py-2 px-2">سعر البيع (ج.م)</th>
            <th className="py-2 px-2">هامش الربح</th>
            <th className="py-2 px-2">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {visibleProducts.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center text-slate-500 text-xs">
                لا توجد أصناف مطابقة
              </td>
            </tr>
          )}
          {visibleProducts.map((product) => {
            const activeBatches = [...product.batches]
              .filter((b) => b.quantity > 0)
              .sort(
                (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
              );
            const fifoBatch = activeBatches[0] ?? product.batches[0];
            const cost = fifoBatch?.costPrice ?? 0;
            const margin = product.retailPrice - cost;
            const low = product.totalStock <= product.minStockAlert;
            const isSelected = selectedIds.has(product.id);
            return (
              <tr
                key={product.id}
                className={`align-top transition ${
                  isSelected ? 'bg-rose-950/25 hover:bg-rose-950/35' : 'hover:bg-slate-950/60'
                }`}
              >
                <td className="py-2.5 px-2 text-center">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelectOne(product.id)}
                    aria-label={`تحديد ${product.name}`}
                    className="rounded border-slate-600 text-rose-600 focus:ring-rose-500 cursor-pointer"
                  />
                </td>
                <td className="py-2.5 px-2 font-mono text-xs text-slate-400">{product.barcode}</td>
                <td className="py-2.5 px-2">
                  <div className="font-bold text-white">{product.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700">
                      <Tag size={10} />
                      {product.category || 'عام'}
                    </span>
                    {product.isAvailableOnline && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700">
                        أونلاين
                      </span>
                    )}
                  </div>
                </td>
                <td className={`py-2.5 px-2 ${low ? 'text-rose-300 font-bold' : ''}`}>
                  <div>
                    {product.totalStock} {product.weightUnit}
                  </div>
                  {activeBatches.length > 1 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-300 mt-0.5">
                      <Layers size={10} />
                      موزع على {activeBatches.length} تواريخ صلاحية
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-xs text-slate-300">
                  {activeBatches.length === 0 ? (
                    <span className="text-slate-500">لا توجد دفعات نشطة</span>
                  ) : (
                    <div className="space-y-1">
                      {activeBatches.map((b, idx) => {
                        const bCost = b.costPrice ?? 0;
                        const remDays = daysUntil(b.expiryDate);
                        const isNear = remDays <= NEAR_EXPIRY_DAYS;
                        return (
                          <div
                            key={b.id}
                            className={`rounded-lg px-2 py-1 border text-[11px] ${
                              idx === 0
                                ? 'bg-slate-950/90 border-emerald-800/70 text-slate-200'
                                : 'bg-slate-950/40 border-slate-800 text-slate-400'
                            }`}
                          >
                            <span
                              className={`font-bold ml-1.5 ${
                                idx === 0 ? 'text-emerald-400' : 'text-slate-400'
                              }`}
                            >
                              {idx === 0 ? '● تُباع أولاً (FIFO):' : `○ دفعة #${idx + 1}:`}
                            </span>
                            <span className="font-mono">{b.batchNumber}</span>
                            {' | '}
                            <span>الكمية: <strong>{b.quantity}</strong></span>
                            {b.costPrice !== undefined && (
                              <>
                                {' | '}
                                <span>تكلفة: {bCost.toFixed(2)} ج.م</span>
                              </>
                            )}
                            {' | '}
                            <span className={isNear ? 'text-amber-300 font-bold' : ''}>
                              انتهاء: {b.expiryDate}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-2 font-bold text-teal-400">
                  {editingPriceId === product.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.5"
                        value={newRetailPrice}
                        onChange={(e) => setNewRetailPrice(e.target.value)}
                        className="w-20 bg-slate-950 border border-indigo-500 rounded px-2 py-1 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => handlePriceUpdate(product)}
                        className="bg-emerald-600 text-white text-xs px-2 py-1 rounded font-bold"
                      >
                        حفظ
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      title="اضغط لتعديل السعر"
                      onClick={() => {
                        setEditingPriceId(product.id);
                        setNewRetailPrice(String(product.retailPrice));
                      }}
                      className="underline decoration-dotted"
                    >
                      {product.retailPrice.toFixed(2)} ج.م
                    </button>
                  )}
                </td>
                <td className="py-2.5 px-2 font-bold text-emerald-400">
                  {fifoBatch ? `+${margin.toFixed(2)} ج.م` : '-'}
                </td>
                <td className="py-2.5 px-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => openBatch(product)}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-2.5 py-1 rounded-lg font-semibold"
                    >
                      + إضافة دفعة / شحنة
                    </button>
                    <button
                      type="button"
                      onClick={() => openAdjustStock(product)}
                      className="inline-flex items-center gap-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 text-xs px-2.5 py-1 rounded-lg font-semibold"
                    >
                      <SlidersHorizontal size={12} />
                      تعديل الرصيد
                    </button>
                    <button
                      type="button"
                      aria-label={`تعديل ${product.name}`}
                      onClick={() => openEdit(product)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1 rounded-lg border border-slate-700"
                    >
                      ✏️ تعديل
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف ${product.name}`}
                      onClick={() => openDeleteModal([product])}
                      className="inline-flex items-center gap-1 bg-rose-950/70 hover:bg-rose-900 text-rose-200 text-xs px-2.5 py-1 rounded-lg border border-rose-800/70 font-semibold transition"
                    >
                      <Trash2 size={12} />
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modal.type === 'create' &&
        modalShell(
          '+ إضافة منتج جديد',
          handleCreate,
          <>
            <div className="space-y-3">
              <label className="text-xs text-slate-300 space-y-1 block">
                <span>الباركود (امسح بالقارئ أو اضغط توليد تلقائي)</span>
                <span className="flex gap-2">
                  <input
                    autoFocus
                    className={inputCls}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setBarcode(generateBarcode())}
                    className="shrink-0 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs px-3 rounded-lg"
                  >
                    توليد
                  </button>
                </span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="text-xs text-slate-300 space-y-1 sm:col-span-2">
                  <span>اسم المنتج (عربي / English)</span>
                  <input
                    className={inputCls}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="text-xs text-slate-300 space-y-1">
                  <span>الوحدة</span>
                  <input
                    className={inputCls}
                    value={weightUnit}
                    onChange={(e) => setWeightUnit(e.target.value)}
                    placeholder="قطعة / كجم / لتر"
                  />
                </label>
              </div>
              {categoryInputField}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-300 space-y-1">
                  <span>سعر البيع (ج.م)</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={inputCls}
                    value={retailPrice}
                    onChange={(e) => setRetailPrice(e.target.value)}
                  />
                </label>
                <label className="text-xs text-slate-300 space-y-1">
                  <span>حد الطلب الأدنى</span>
                  <input
                    type="number"
                    min="0"
                    className={inputCls}
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={online}
                  onChange={(e) => setOnline(e.target.checked)}
                />
                متاح أونلاين
              </label>
            </div>
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <p className="text-xs text-slate-400">دفعة افتتاحية (اختيارية)</p>
              {batchFields}
            </div>
          </>,
          'حفظ المنتج'
        )}

      {modal.type === 'edit' &&
        modalShell(
          `تعديل: ${modal.product.name}`,
          handleEdit,
          <div className="space-y-3">
            <label className="text-xs text-slate-300 space-y-1 block">
              <span>الباركود</span>
              <input
                className={inputCls}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-slate-300 space-y-1 sm:col-span-2">
                <span>اسم المنتج</span>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-300 space-y-1">
                <span>الوحدة</span>
                <input
                  className={inputCls}
                  value={weightUnit}
                  onChange={(e) => setWeightUnit(e.target.value)}
                />
              </label>
            </div>
            {categoryInputField}
            <label className="text-xs text-slate-300 space-y-1 block">
              <span>حد الطلب الأدنى</span>
              <input
                type="number"
                min="0"
                className={inputCls}
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={online}
                onChange={(e) => setOnline(e.target.checked)}
              />
              متاح أونلاين
            </label>
          </div>,
          'حفظ التعديلات'
        )}

      {modal.type === 'batch' &&
        modalShell(
          `+ إضافة دفعة / شحنة: ${modal.product.name}`,
          handleAddBatch,
          <>
            <p className="text-xs text-slate-400">
              الرصيد الحالي: {modal.product.totalStock} {modal.product.weightUnit}
              {Number(quantity) > 0 && (
                <span className="text-emerald-400">
                  {' '}
                  ← بعد الإضافة: {modal.product.totalStock + Number(quantity)}
                </span>
              )}
            </p>
            {batchFields}
          </>,
          'حفظ الدفعة'
        )}

      {modal.type === 'adjust' &&
        modalShell(
          `تعديل الرصيد / ضبط المخزون: ${modal.product.name}`,
          handleAdjustStock,
          <div className="space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400">الباركود: </span>
                <span className="font-mono text-slate-200">{modal.product.barcode}</span>
              </div>
              <div>
                <span className="text-slate-400">الرصيد الكلي الحالي: </span>
                <span className="font-bold text-emerald-400">
                  {modal.product.totalStock} {modal.product.weightUnit}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdjustMode('RECONCILE');
                  setError('');
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition ${
                  adjustMode === 'RECONCILE'
                    ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                تسوية جرد / عجز وتلف
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdjustMode('ADD_BATCH');
                  setError('');
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold border transition ${
                  adjustMode === 'ADD_BATCH'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                إضافة رصيد / شحنة جديدة
              </button>
            </div>

            {adjustMode === 'ADD_BATCH' ? (
              <div className="space-y-3">{batchFields}</div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-slate-300 space-y-1">
                    <span>الكمية المراد خصمها / تسويتها</span>
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, modal.product.totalStock)}
                      step="1"
                      className={inputCls}
                      value={deductQuantity}
                      onChange={(e) => setDeductQuantity(e.target.value)}
                      placeholder="مثال: 2"
                    />
                  </label>
                  <label className="text-xs text-slate-300 space-y-1">
                    <span>سبب التسوية (Audit Reason)</span>
                    <select
                      className={inputCls}
                      value={auditReason}
                      onChange={(e) => setAuditReason(e.target.value)}
                    >
                      {AUDIT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="text-xs text-slate-300 space-y-1 block">
                  <span>تحديد التشغيلة (اختياري — الافتراضي خصم تلقائي من الأقدم صلاحية FIFO)</span>
                  <select
                    className={inputCls}
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(e.target.value)}
                  >
                    <option value="">خصم تلقائي من الأقدم صلاحية (FIFO)</option>
                    {modal.product.batches
                      .filter((b) => b.quantity > 0)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchNumber} — الرصيد: {b.quantity} — انتهاء: {b.expiryDate}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="text-xs text-slate-300 space-y-1 block">
                  <span>ملاحظات المراجعة (اختياري)</span>
                  <input
                    className={inputCls}
                    value={auditNotes}
                    onChange={(e) => setAuditNotes(e.target.value)}
                    placeholder="تفاصيل إضافية لتقرير الجرد..."
                  />
                </label>

                {Number(deductQuantity) > 0 && (
                  <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2">
                    الرصيد المتبقي بعد التسوية:{' '}
                    <strong>
                      {Math.max(0, modal.product.totalStock - Number(deductQuantity))}{' '}
                      {modal.product.weightUnit}
                    </strong>{' '}
                    (السبب: {auditReason})
                  </p>
                )}
              </div>
            )}
          </div>,
          adjustMode === 'ADD_BATCH' ? 'حفظ وإضافة الشحنة' : 'تأكيد تسوية المخزون'
        )}

      {modal.type === 'bulk' &&
        modalShell(
          'استيراد وتحديث الأصناف من إكسيل (Bulk Upload .xlsx / .csv)',
          handleConfirmBulkImport,
          <div className="space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-300 space-y-1">
                <p className="font-bold text-cyan-300">
                  💡 نصيحة: حمّل القالب الجاهز الذي يحتوي على أصنافك المسجلة وأقسامها الحالية لمنع التكرار
                </p>
                <p className="text-slate-400">
                  عند رفع شحنة بتاريخ صلاحية جديد لنفس الباركود، يضيفها النظام كدفعة مستقلة ويرتب البيع تلقائياً وفق الأقدم صلاحية أولاً (FIFO).
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={templateBusy}
                className="shrink-0 inline-flex items-center gap-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-700 px-3 py-2 rounded-lg text-xs font-bold"
              >
                <FileSpreadsheet size={15} />
                {templateBusy ? 'جاري التحميل...' : 'تحميل قالب الأصناف المسجلة (.xlsx)'}
              </button>
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFileSelected(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer border-2 border-dashed rounded-2xl p-6 text-center transition ${
                dragActive
                  ? 'border-emerald-400 bg-emerald-950/30'
                  : 'border-slate-700 hover:border-indigo-500 bg-slate-950/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                }}
              />
              <Upload className="mx-auto mb-2 text-indigo-400" size={28} />
              <p className="text-sm font-bold text-white">
                {selectedFile
                  ? `الملف المحدد: ${selectedFile.name}`
                  : 'اسحب وأفلت ملف الإكسيل (.xlsx أو .csv) هنا أو اضغط للاختيار'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                الأعمدة المدعومة: الباركود، اسم الصنف، القسم، الوحدة، سعر البيع، سعر الشراء، الكمية، تاريخ الصلاحية، رقم التشغيلة، حد الطلب، متاح أونلاين
              </p>
            </div>

            {previewBusy && (
              <div className="text-center py-4 text-xs text-cyan-300">
                جاري قراءة وفحص صفوف ملف الإكسيل...
              </div>
            )}

            {previewRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-200">
                    معاينة البيانات قبل الاستيراد ({previewRows.length} صف):
                  </span>
                  <div className="flex gap-2">
                    <span className="px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-700 text-emerald-300 font-bold">
                      ✔ صالح: {validPreviewCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-rose-950/80 border border-rose-700 text-rose-300 font-bold">
                      ✖ أخطاء: {invalidPreviewCount}
                    </span>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead className="bg-slate-950 sticky top-0 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-2">#</th>
                        <th className="py-2 px-2">الحالة</th>
                        <th className="py-2 px-2">الباركود</th>
                        <th className="py-2 px-2">اسم الصنف</th>
                        <th className="py-2 px-2">القسم</th>
                        <th className="py-2 px-2">سعر البيع</th>
                        <th className="py-2 px-2">سعر الشراء</th>
                        <th className="py-2 px-2">الكمية المضافة</th>
                        <th className="py-2 px-2">الصلاحية</th>
                        <th className="py-2 px-2">التشغيلة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {previewRows.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={
                            row.valid
                              ? 'bg-emerald-950/20 hover:bg-emerald-950/30 text-emerald-100'
                              : 'bg-rose-950/30 hover:bg-rose-950/40 text-rose-200'
                          }
                        >
                          <td className="py-1.5 px-2 font-mono">{row.rowNumber}</td>
                          <td className="py-1.5 px-2 font-bold">
                            {row.valid ? (
                              <span className="text-emerald-400">
                                {row.action === 'UPDATE' ? '✔ تحديث مسجل' : '✔ صنف جديد'}
                              </span>
                            ) : (
                              <span className="text-rose-400">
                                ✖ {row.errors.join('، ')}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 font-mono">{row.barcode || '-'}</td>
                          <td className="py-1.5 px-2 font-semibold">{row.name || '-'}</td>
                          <td className="py-1.5 px-2 text-cyan-300">{row.category || 'عام'}</td>
                          <td className="py-1.5 px-2">{row.retailPrice.toFixed(2)} ج.م</td>
                          <td className="py-1.5 px-2">{row.costPrice.toFixed(2)} ج.م</td>
                          <td className="py-1.5 px-2 font-bold">{row.quantity}</td>
                          <td className="py-1.5 px-2 font-mono">{row.expiryDate || '-'}</td>
                          <td className="py-1.5 px-2 font-mono">{row.batchNumber || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>,
          `تأكيد واستيراد (${validPreviewCount}) صنف صالح`,
          true
        )}

      {modal.type === 'delete' &&
        modalShell(
          modal.targets.length === 1
            ? `تأكيد حذف الصنف من قاعدة البيانات`
            : `تأكيد حذف (${modal.targets.length}) أصناف من قاعدة البيانات`,
          handleConfirmDelete,
          <div className="space-y-3">
            <div className="bg-rose-950/50 border border-rose-800 rounded-xl p-3 text-xs text-rose-200 leading-relaxed">
              ⚠️ هل أنت متأكد من حذف{' '}
              <strong>
                {modal.targets.length === 1
                  ? `"${modal.targets[0].name}"`
                  : `${modal.targets.length} أصناف محددة`}
              </strong>{' '}
              نهائياً من قاعدة البيانات؟ سيتم إزالة الصنف وجميع تشغيلاته من قاعدة البيانات ومن شاشة الكاشير فوراً.
            </div>
            <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl divide-y divide-slate-800/60 bg-slate-950">
              {modal.targets.map((item) => (
                <div
                  key={item.id}
                  className="px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-white">{item.name}</span>
                    <span className="text-slate-400 font-mono mr-2">({item.barcode})</span>
                  </div>
                  <span className="text-slate-400">
                    الرصيد: {item.totalStock} {item.weightUnit}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          modal.targets.length === 1
            ? 'تأكيد الحذف النهائي'
            : `تأكيد حذف (${modal.targets.length}) أصناف`
        )}
    </div>
  );
}

export default AdminCatalog;

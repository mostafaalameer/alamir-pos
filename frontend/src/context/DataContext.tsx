import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import {
  LocalCustomer,
  LocalLoyaltySettings,
  LocalProduct,
  LocalSqliteBridge,
  OfflineClosedShiftRecord,
  OfflineOrderRecord,
} from '../lib/offlineSqlite';
import { fetchNextOrderNumberCloud, pullCatalog, pushOffline } from '../lib/cloud';
import { getSession } from '../lib/auth';
import { useAuth } from './AuthContext';

/** The POS currently runs a single local shift session (see Z-Report flow). */
export const LOCAL_SHIFT_ID = 'SHIFT-2026-01';
export const LOCAL_STARTING_CASH = 500;

interface DataState {
  products: LocalProduct[];
  setProducts: (products: LocalProduct[]) => void;
  loyaltySettings: LocalLoyaltySettings;
  setLoyaltySettings: (settings: LocalLoyaltySettings) => void;
  customers: LocalCustomer[];
  setCustomers: (customers: LocalCustomer[]) => void;
  offlineQueue: OfflineOrderRecord[];
  closedShifts: OfflineClosedShiftRecord[];
  isOnline: boolean;
  localShiftActive: boolean;
  pendingCount: number;
  syncing: boolean;
  refreshLocal: () => void;
  refreshCatalogFromCloud: (silent?: boolean) => Promise<void>;
  syncNow: (silent?: boolean) => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [products, setProducts] = useState<LocalProduct[]>(() => LocalSqliteBridge.loadCatalog());
  const [loyaltySettings, setLoyaltySettings] = useState<LocalLoyaltySettings>(() =>
    LocalSqliteBridge.loadLoyaltySettings()
  );
  const [customers, setCustomers] = useState<LocalCustomer[]>(() =>
    LocalSqliteBridge.loadCustomers()
  );
  const [offlineQueue, setOfflineQueue] = useState<OfflineOrderRecord[]>(() =>
    LocalSqliteBridge.getOfflineQueue()
  );
  const [closedShifts, setClosedShifts] = useState<OfflineClosedShiftRecord[]>(() =>
    LocalSqliteBridge.getOfflineClosedShifts()
  );
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshLocal = useCallback(() => {
    setProducts(LocalSqliteBridge.loadCatalog());
    setLoyaltySettings(LocalSqliteBridge.loadLoyaltySettings());
    setCustomers(LocalSqliteBridge.loadCustomers());
    setOfflineQueue(LocalSqliteBridge.getOfflineQueue());
    setClosedShifts(LocalSqliteBridge.getOfflineClosedShifts());
  }, []);

  const refreshCatalogFromCloud = useCallback(
    async (silent = true) => {
      if (!getSession()) return;
      try {
        const cloudProducts = await pullCatalog();
        LocalSqliteBridge.replaceCatalogFromCloud(cloudProducts);
        try {
          const nextOrd = await fetchNextOrderNumberCloud();
          if (nextOrd?.orderNumber) {
            LocalSqliteBridge.syncOrderSequenceFromCloud(nextOrd.orderNumber);
          }
        } catch {
          // Non-blocking: local counter continues from localStorage if offline
        }
        refreshLocal();
        if (!silent) {
          toast.success(`تم تحديث كتالوج الأصناف من قاعدة البيانات (${cloudProducts.length} صنف)`);
        }
      } catch (err: unknown) {
        if (!silent) {
          toast.error(
            err instanceof Error ? err.message : 'تعذر جلب الأصناف من قاعدة البيانات السحابية'
          );
        }
      }
    },
    [refreshLocal]
  );

  // Automatically hydrate products, loyalty settings & customer cache from cloud on login / session change
  useEffect(() => {
    if (!session?.token && !getSession()) return;
    void refreshCatalogFromCloud(true);
  }, [session?.token, isOnline, refreshCatalogFromCloud]);

  const syncNow = useCallback(
    async (silent = false) => {
      if (syncingRef.current) return;
      if (!getSession()) {
        if (!silent) toast.warning('سجّل الدخول أولاً لمزامنة البيانات مع السحابة');
        return;
      }

      const pendingOrders = LocalSqliteBridge.getOfflineQueue().filter((o) => !o.synced);
      const pendingShifts = LocalSqliteBridge.getOfflineClosedShifts().filter((s) => !s.synced);
      const pendingCustomers = LocalSqliteBridge.loadCustomers().filter(
        (c) => c.synced === false
      );
      const hasPendingPush =
        pendingOrders.length > 0 ||
        pendingShifts.length > 0 ||
        pendingCustomers.length > 0;

      syncingRef.current = true;
      setSyncing(true);
      try {
        // Always pull the authoritative database catalog first so POS immediately reflects DB products
        const cloudProducts = await pullCatalog();
        LocalSqliteBridge.replaceCatalogFromCloud(cloudProducts);
        try {
          const nextOrd = await fetchNextOrderNumberCloud();
          if (nextOrd?.orderNumber) {
            LocalSqliteBridge.syncOrderSequenceFromCloud(nextOrd.orderNumber);
          }
        } catch {
          // Non-blocking: local counter continues from localStorage if offline
        }
        refreshLocal();

        if (hasPendingPush) {
          const result = await pushOffline(pendingOrders, pendingShifts, pendingCustomers);
          LocalSqliteBridge.markQueueSynced();
          try {
            const refreshedProducts = await pullCatalog();
            LocalSqliteBridge.replaceCatalogFromCloud(refreshedProducts);
          } catch {
            // ignore post-push pull failure
          }
          refreshLocal();
          toast.success(
            `تمت المزامنة: ${result.syncedCount} فاتورة جديدة، ${result.skippedCount} مكررة، ${result.syncedShiftsCount} وردية`
          );
        } else if (!silent) {
          toast.success(
            `تم تحديث الكتالوج والبيانات من قاعدة البيانات (${cloudProducts.length} صنف مسجل)`
          );
        }
      } catch (err: unknown) {
        // Nothing is marked as synced on failure, so the queue is retried next time.
        if (!silent) {
          toast.error(err instanceof Error ? err.message : 'فشلت المزامنة مع السحابة');
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [refreshLocal]
  );

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void syncNow(true);
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [syncNow]);

  const value = useMemo<DataState>(
    () => ({
      products,
      setProducts,
      loyaltySettings,
      setLoyaltySettings,
      customers,
      setCustomers,
      offlineQueue,
      closedShifts,
      isOnline,
      localShiftActive: !closedShifts.some((s) => s.shiftId === LOCAL_SHIFT_ID),
      pendingCount:
        offlineQueue.filter((o) => !o.synced).length +
        closedShifts.filter((s) => !s.synced).length +
        customers.filter((c) => c.synced === false).length,
      syncing,
      refreshLocal,
      refreshCatalogFromCloud,
      syncNow,
    }),
    [
      products,
      loyaltySettings,
      customers,
      offlineQueue,
      closedShifts,
      isOnline,
      syncing,
      refreshLocal,
      refreshCatalogFromCloud,
      syncNow,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

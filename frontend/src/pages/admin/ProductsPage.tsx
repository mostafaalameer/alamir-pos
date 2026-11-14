import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AdminCatalog } from '../../components/AdminCatalog';
import { TableSkeleton } from '../../components/Skeleton';
import { useData } from '../../context/DataContext';
import { pullCatalog } from '../../lib/cloud';
import { LocalSqliteBridge } from '../../lib/offlineSqlite';

export function ProductsPage() {
  const { products, setProducts, isOnline } = useData();
  const [loading, setLoading] = useState<boolean>(isOnline);

  // Refresh from the cloud on entry; cloud prices/stock override local values (conflict policy).
  useEffect(() => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    pullCatalog()
      .then((cloud) => {
        if (cancelled) return;
        setProducts(LocalSqliteBridge.replaceCatalogFromCloud(cloud));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.warning(
            `تعذر تحديث الكتالوج من السحابة، يتم عرض النسخة المحلية (${
              err instanceof Error ? err.message : 'خطأ'
            })`
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOnline, setProducts]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-white">المنتجات والمخزون</h1>
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <TableSkeleton rows={6} />
        </div>
      ) : (
        <AdminCatalog products={products} isOffline={!isOnline} onProductsChange={setProducts} />
      )}
    </div>
  );
}

export default ProductsPage;


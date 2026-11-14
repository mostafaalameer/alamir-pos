-- ============================================================================
-- Supabase Postgres Optimization & Index Migration
-- Project: Alamir Market POS (ماركت الأمير)
-- Based on Supabase Postgres Best Practices Guide
-- ============================================================================

-- 1. ENABLE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. REMOVE REDUNDANT INDEXES
-- Product.barcode already has a UNIQUE constraint/index ("Product_barcode_key").
-- Redundant B-tree indexes consume RAM and slow down INSERT/UPDATE throughput.
DROP INDEX IF EXISTS "Product_barcode_idx";

-- 3. INDEX ALL FOREIGN KEY COLUMNS (HIGH IMPACT: 10-100x faster JOINs & cascades)
-- Postgres does NOT automatically index foreign keys.
CREATE INDEX IF NOT EXISTS "ProductBatch_productId_idx" 
  ON "ProductBatch" ("productId");

CREATE INDEX IF NOT EXISTS "Shift_cashierId_idx" 
  ON "Shift" ("cashierId");

CREATE INDEX IF NOT EXISTS "Order_shiftId_idx" 
  ON "Order" ("shiftId");

CREATE INDEX IF NOT EXISTS "Order_cashierId_idx" 
  ON "Order" ("cashierId");

CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" 
  ON "OrderItem" ("orderId");

CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" 
  ON "OrderItem" ("productId");

-- 4. COMPOSITE & PARTIAL INDEXES FOR CORE POS ACCESS PATTERNS
-- Rule: query-partial-indexes.md & query-composite-indexes.md

-- A. Active Shift Partial Index:
-- Fast O(1) lookup for cashier's current open shift without scanning closed shifts
CREATE INDEX IF NOT EXISTS "Shift_active_cashier_idx" 
  ON "Shift" ("cashierId") 
  WHERE "closedAt" IS NULL;

-- B. FIFO Batch Allocation Partial Composite Index:
-- Fast lookup and sorting for FIFO stock deduction (quantity > 0 ordered by expiryDate ASC)
CREATE INDEX IF NOT EXISTS "ProductBatch_fifo_allocation_idx" 
  ON "ProductBatch" ("productId", "expiryDate" ASC, "createdAt" ASC) 
  WHERE quantity > 0;

-- C. Expiring Batches Partial Index:
-- Accelerates 30/60/90 day expiry alert queries without scanning exhausted batches
CREATE INDEX IF NOT EXISTS "ProductBatch_active_expiry_idx" 
  ON "ProductBatch" ("expiryDate" ASC) 
  WHERE quantity > 0;

-- D. Valid Sales Orders Index (Dashboard & Revenue calculations):
CREATE INDEX IF NOT EXISTS "Order_valid_sales_createdAt_idx" 
  ON "Order" ("createdAt" DESC) 
  WHERE "isReturned" = false;

-- E. Orders Timeline Index:
CREATE INDEX IF NOT EXISTS "Order_createdAt_desc_idx" 
  ON "Order" ("createdAt" DESC);

-- F. Online Catalog Partial Index:
CREATE INDEX IF NOT EXISTS "Product_online_catalog_idx" 
  ON "Product" ("name" ASC) 
  WHERE "isAvailableOnline" = true;

-- G. Delta Sync Index for POS offline/cloud synchronization:
CREATE INDEX IF NOT EXISTS "Product_updatedAt_idx" 
  ON "Product" ("updatedAt");

-- 5. FAST ILIKE SEARCH USING TRIGRAM GIN INDEX
-- Rule: advanced-full-text-search.md
-- Enables fast sub-string search on Arabic/English product names (replaces full Seq Scan)
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" 
  ON "Product" USING gin ("name" gin_trgm_ops);

-- 6. COVERING INDEX FOR ORDER LINE ITEMS (Index-Only Scan)
-- Rule: query-covering-indexes.md
-- Serves line total calculations directly from index without touching the heap
CREATE INDEX IF NOT EXISTS "OrderItem_order_pricing_idx" 
  ON "OrderItem" ("orderId") 
  INCLUDE ("productId", "quantity", "unitPrice", "costPrice");

-- ============================================================================
-- VERIFICATION QUERY: Check for any remaining unindexed foreign keys
-- ============================================================================
-- SELECT
--   conrelid::regclass AS table_name,
--   a.attname AS fk_column
-- FROM pg_constraint c
-- JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
-- WHERE c.contype = 'f'
--   AND NOT EXISTS (
--     SELECT 1 FROM pg_index i
--     WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
--   );

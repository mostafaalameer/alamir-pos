-- Tauri v2 Embedded SQLite Local Schema for Alamir Market Offline POS
CREATE TABLE IF NOT EXISTS local_products (
  id TEXT PRIMARY KEY,
  barcode TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  weight_unit TEXT DEFAULT 'قطعة',
  retail_price REAL NOT NULL,
  total_stock INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_products_barcode ON local_products(barcode);

CREATE TABLE IF NOT EXISTS local_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  expiry_date TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES local_products(id)
);

CREATE INDEX IF NOT EXISTS idx_local_batches_expiry ON local_batches(expiry_date ASC);

CREATE TABLE IF NOT EXISTS offline_orders_queue (
  order_number TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  total_amount REAL NOT NULL,
  items_json TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);


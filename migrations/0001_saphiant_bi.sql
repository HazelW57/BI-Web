CREATE TABLE IF NOT EXISTS auth_users (
  email TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  currency TEXT NOT NULL DEFAULT 'USD',
  order_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ordered_at INTEGER NOT NULL,
  gross_sales REAL NOT NULL DEFAULT 0,
  seller_discount REAL NOT NULL DEFAULT 0,
  refund_amount REAL NOT NULL DEFAULT 0,
  shipping_revenue REAL NOT NULL DEFAULT 0,
  financial_net_sales REAL,
  platform_fee REAL NOT NULL DEFAULT 0,
  affiliate_commission REAL NOT NULL DEFAULT 0,
  shipping_cost REAL NOT NULL DEFAULT 0,
  settlement_amount REAL,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_line ON sales_lines(order_id, line_item_id);
CREATE INDEX IF NOT EXISTS idx_sales_ordered_at ON sales_lines(ordered_at);
CREATE INDEX IF NOT EXISTS idx_sales_sku_ordered_at ON sales_lines(sku, ordered_at);

CREATE TABLE IF NOT EXISTS return_lines (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '未分类',
  return_type TEXT NOT NULL DEFAULT 'RETURN',
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  quantity INTEGER NOT NULL DEFAULT 1,
  refund_amount REAL NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_return_line ON return_lines(return_id, line_item_id);
CREATE INDEX IF NOT EXISTS idx_returns_requested_at ON return_lines(requested_at);
CREATE INDEX IF NOT EXISTS idx_returns_sku_requested_at ON return_lines(sku, requested_at);

CREATE TABLE IF NOT EXISTS sku_costs (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  product_cost REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  import_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_cost_effective ON sku_costs(sku, effective_from);

CREATE TABLE IF NOT EXISTS period_expenses (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  import_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_period_expense_month_kind ON period_expenses(month, kind);

CREATE TABLE IF NOT EXISTS product_cost_rules (
  id TEXT PRIMARY KEY, seller_sku TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', unit_cost REAL NOT NULL,
  effective_from TEXT NOT NULL, effective_to TEXT, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_cost_rule ON product_cost_rules(seller_sku,effective_from);

CREATE TABLE IF NOT EXISTS agency_fee_rules (
  id TEXT PRIMARY KEY, fee_name TEXT NOT NULL, fee_category TEXT NOT NULL, scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL DEFAULT 'ALL', calculation_method TEXT NOT NULL, rate_amount REAL NOT NULL,
  effective_from TEXT NOT NULL, effective_to TEXT, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS return_shipping_rules (
  id TEXT PRIMARY KEY, seller_sku TEXT NOT NULL, cost_per_unit REAL NOT NULL,
  effective_from TEXT NOT NULL, effective_to TEXT, import_id TEXT, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_return_shipping_rule ON return_shipping_rules(seller_sku,effective_from);

CREATE TABLE IF NOT EXISTS manual_costs (
  id TEXT PRIMARY KEY, period TEXT NOT NULL, cost_category TEXT NOT NULL, seller_sku TEXT NOT NULL DEFAULT 'ALL',
  amount REAL NOT NULL, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS finance_line_costs (
  sales_line_id TEXT PRIMARY KEY, return_shipping_actual REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_finance_transactions (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_item_id TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  imported_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  orders_upserted INTEGER NOT NULL DEFAULT 0,
  returns_upserted INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at);
PRAGMA optimize;

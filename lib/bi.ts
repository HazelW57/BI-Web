export type BiEnv = Env & {
  TIKTOK_APP_KEY?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_SHOP_CIPHER?: string;
};

export type SalesFact = {
  orderId: string;
  lineItemId: string;
  sku: string;
  productName: string;
  quantity: number;
  currency: string;
  orderStatus: string;
  orderedAt: number;
  grossSales: number;
  sellerDiscount: number;
  refundAmount: number;
  shippingRevenue: number;
  financialNetSales: number | null;
  platformFee: number;
  affiliateCommission: number;
  shippingCost: number;
  settlementAmount: number | null;
};

export type CostFact = { sku: string; effectiveFrom: string; productCost: number };
export type ExpenseFact = { month: string; kind: string; amount: number };
export type ReturnFact = {
  returnId: string;
  sku: string;
  reason: string;
  quantity: number;
  status: string;
  requestedAt: number;
};

export type PnlRow = {
  key: string;
  revenue: number;
  units: number;
  cogs: number;
  platformFees: number;
  shippingCost: number;
  agencyFees: number;
  contributionProfit: number;
  operatingProfit: number;
  margin: number;
  settlement: number;
};

const BI_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sales_lines (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_item_id TEXT NOT NULL,
    sku TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1,
    currency TEXT NOT NULL DEFAULT 'USD', order_status TEXT NOT NULL DEFAULT 'UNKNOWN', ordered_at INTEGER NOT NULL,
    gross_sales REAL NOT NULL DEFAULT 0, seller_discount REAL NOT NULL DEFAULT 0,
    refund_amount REAL NOT NULL DEFAULT 0, shipping_revenue REAL NOT NULL DEFAULT 0,
    financial_net_sales REAL, platform_fee REAL NOT NULL DEFAULT 0,
    affiliate_commission REAL NOT NULL DEFAULT 0, shipping_cost REAL NOT NULL DEFAULT 0,
    settlement_amount REAL, raw_json TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_line ON sales_lines(order_id, line_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_ordered_at ON sales_lines(ordered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_sku_ordered_at ON sales_lines(sku, ordered_at)`,
  `CREATE TABLE IF NOT EXISTS return_lines (
    id TEXT PRIMARY KEY, return_id TEXT NOT NULL, order_id TEXT NOT NULL, line_item_id TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '未分类', return_type TEXT NOT NULL DEFAULT 'RETURN',
    status TEXT NOT NULL DEFAULT 'UNKNOWN', quantity INTEGER NOT NULL DEFAULT 1,
    refund_amount REAL NOT NULL DEFAULT 0, requested_at INTEGER NOT NULL,
    raw_json TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_return_line ON return_lines(return_id, line_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_requested_at ON return_lines(requested_at)`,
  `CREATE INDEX IF NOT EXISTS idx_returns_sku_requested_at ON return_lines(sku, requested_at)`,
  `CREATE TABLE IF NOT EXISTS sku_costs (
    id TEXT PRIMARY KEY, sku TEXT NOT NULL, effective_from TEXT NOT NULL, product_cost REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD', import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_cost_effective ON sku_costs(sku, effective_from)`,
  `CREATE TABLE IF NOT EXISTS period_expenses (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD', import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_period_expense_month_kind ON period_expenses(month, kind)`,
  `CREATE TABLE IF NOT EXISTS import_runs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, filename TEXT NOT NULL, row_count INTEGER NOT NULL,
    imported_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
    orders_upserted INTEGER NOT NULL DEFAULT 0, returns_upserted INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at)`,
] as const;

export async function ensureBiSchema(db: D1Database) {
  await db.batch(BI_SCHEMA.map((sql) => db.prepare(sql)));
}

function dayString(epoch: number) {
  return new Date(epoch).toISOString().slice(0, 10);
}

function monthString(epoch: number) {
  return new Date(epoch).toISOString().slice(0, 7);
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function baseRow(key: string): PnlRow {
  return { key, revenue: 0, units: 0, cogs: 0, platformFees: 0, shippingCost: 0, agencyFees: 0, contributionProfit: 0, operatingProfit: 0, margin: 0, settlement: 0 };
}

function matchingCost(costs: CostFact[], sku: string, orderedAt: number) {
  const date = dayString(orderedAt);
  let result = 0;
  for (const cost of costs) {
    if (cost.sku === sku && cost.effectiveFrom <= date) result = cost.productCost;
  }
  return result;
}

function finalize(row: PnlRow) {
  row.contributionProfit = round(row.revenue - row.cogs - row.platformFees - row.shippingCost);
  row.operatingProfit = round(row.contributionProfit - row.agencyFees);
  row.margin = row.revenue ? round((row.operatingProfit / row.revenue) * 100) : 0;
  row.revenue = round(row.revenue);
  row.cogs = round(row.cogs);
  row.platformFees = round(row.platformFees);
  row.shippingCost = round(row.shippingCost);
  row.agencyFees = round(row.agencyFees);
  row.settlement = round(row.settlement);
  return row;
}

export function calculatePnl(sales: SalesFact[], costs: CostFact[], expenses: ExpenseFact[]) {
  const orderedCosts = [...costs].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const monthly = new Map<string, PnlRow>();
  const sku = new Map<string, PnlRow>();
  const skuMonthlyRevenue = new Map<string, Map<string, number>>();

  for (const line of sales) {
    const month = monthString(line.orderedAt);
    const revenue = line.financialNetSales ?? (line.grossSales - line.sellerDiscount - line.refundAmount + line.shippingRevenue);
    const productCost = matchingCost(orderedCosts, line.sku, line.orderedAt) * line.quantity;
    const fees = Math.abs(line.platformFee);
    const shipping = Math.abs(line.shippingCost);
    const settlement = line.settlementAmount ?? 0;

    for (const [key, target] of [[month, monthly], [line.sku, sku]] as const) {
      const row = target.get(key) ?? baseRow(key);
      row.revenue += revenue;
      row.units += line.quantity;
      row.cogs += productCost;
      row.platformFees += fees;
      row.shippingCost += shipping;
      row.settlement += settlement;
      target.set(key, row);
    }
    const monthMap = skuMonthlyRevenue.get(month) ?? new Map<string, number>();
    monthMap.set(line.sku, (monthMap.get(line.sku) ?? 0) + Math.max(0, revenue));
    skuMonthlyRevenue.set(month, monthMap);
  }

  const expenseByMonth = new Map<string, number>();
  for (const expense of expenses) {
    expenseByMonth.set(expense.month, (expenseByMonth.get(expense.month) ?? 0) + expense.amount);
  }
  for (const [month, amount] of expenseByMonth) {
    const row = monthly.get(month) ?? baseRow(month);
    row.agencyFees += amount;
    monthly.set(month, row);

    const revenueMap = skuMonthlyRevenue.get(month);
    if (!revenueMap?.size) continue;
    const revenueTotal = [...revenueMap.values()].reduce((sum, value) => sum + value, 0);
    for (const [skuKey, skuRevenue] of revenueMap) {
      const share = revenueTotal > 0 ? skuRevenue / revenueTotal : 1 / revenueMap.size;
      const skuRow = sku.get(skuKey) ?? baseRow(skuKey);
      skuRow.agencyFees += amount * share;
      sku.set(skuKey, skuRow);
    }
  }

  const months = [...monthly.values()].map(finalize).sort((a, b) => a.key.localeCompare(b.key));
  const skus = [...sku.values()].map(finalize).sort((a, b) => b.revenue - a.revenue);
  const total = finalize(months.reduce((result, item) => {
    result.revenue += item.revenue;
    result.units += item.units;
    result.cogs += item.cogs;
    result.platformFees += item.platformFees;
    result.shippingCost += item.shippingCost;
    result.agencyFees += item.agencyFees;
    result.settlement += item.settlement;
    return result;
  }, baseRow("total")));

  return { total, months, skus };
}

export function calculateReturns(sales: SalesFact[], returns: ReturnFact[]) {
  const soldBySku = new Map<string, number>();
  for (const line of sales) soldBySku.set(line.sku, (soldBySku.get(line.sku) ?? 0) + line.quantity);
  const rows = new Map<string, { sku: string; soldUnits: number; returnedUnits: number; reasons: Map<string, number> }>();
  for (const [sku, soldUnits] of soldBySku) rows.set(sku, { sku, soldUnits, returnedUnits: 0, reasons: new Map() });
  for (const item of returns) {
    if (/REJECT|CANCEL/i.test(item.status)) continue;
    const row = rows.get(item.sku) ?? { sku: item.sku, soldUnits: 0, returnedUnits: 0, reasons: new Map<string, number>() };
    row.returnedUnits += item.quantity;
    row.reasons.set(item.reason || "未分类", (row.reasons.get(item.reason || "未分类") ?? 0) + item.quantity);
    rows.set(item.sku, row);
  }
  const skus = [...rows.values()].map((row) => ({
    sku: row.sku,
    soldUnits: row.soldUnits,
    returnedUnits: row.returnedUnits,
    returnRate: row.soldUnits ? round((row.returnedUnits / row.soldUnits) * 100) : 0,
    reasons: [...row.reasons.entries()].map(([reason, count]) => ({ reason, count, share: row.returnedUnits ? round((count / row.returnedUnits) * 100) : 0 })).sort((a, b) => b.count - a.count),
  })).sort((a, b) => b.returnRate - a.returnRate || b.returnedUnits - a.returnedUnits);
  const soldUnits = [...soldBySku.values()].reduce((sum, value) => sum + value, 0);
  const returnedUnits = skus.reduce((sum, row) => sum + row.returnedUnits, 0);
  return { soldUnits, returnedUnits, returnRate: soldUnits ? round((returnedUnits / soldUnits) * 100) : 0, skuCount: skus.filter((row) => row.soldUnits || row.returnedUnits).length, skus };
}

function periodBounds(from?: string | null, to?: string | null) {
  const endDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00.000Z`) : new Date();
  const startDate = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : new Date(endDate.getTime() - 89 * 86_400_000);
  return { from: startDate.toISOString().slice(0, 10), to: endDate.toISOString().slice(0, 10), start: startDate.getTime(), end: endDate.getTime() + 86_400_000 };
}

export async function getPnlSnapshot(db: D1Database, from?: string | null, to?: string | null) {
  await ensureBiSchema(db);
  const range = periodBounds(from, to);
  const [salesResult, costsResult, expensesResult] = await Promise.all([
    db.prepare(`SELECT order_id AS orderId, line_item_id AS lineItemId, sku, product_name AS productName,
      quantity, currency, order_status AS orderStatus, ordered_at AS orderedAt, gross_sales AS grossSales,
      seller_discount AS sellerDiscount, refund_amount AS refundAmount, shipping_revenue AS shippingRevenue,
      financial_net_sales AS financialNetSales, platform_fee AS platformFee,
      affiliate_commission AS affiliateCommission, shipping_cost AS shippingCost,
      settlement_amount AS settlementAmount FROM sales_lines WHERE ordered_at >= ? AND ordered_at < ? ORDER BY ordered_at`)
      .bind(range.start, range.end).all<SalesFact>(),
    db.prepare("SELECT sku, effective_from AS effectiveFrom, product_cost AS productCost FROM sku_costs ORDER BY effective_from").all<CostFact>(),
    db.prepare("SELECT month, kind, amount FROM period_expenses WHERE month >= ? AND month <= ? ORDER BY month")
      .bind(range.from.slice(0, 7), range.to.slice(0, 7)).all<ExpenseFact>(),
  ]);
  return { range: { from: range.from, to: range.to }, ...calculatePnl(salesResult.results, costsResult.results, expensesResult.results) };
}

export async function getReturnsSnapshot(db: D1Database, from?: string | null, to?: string | null) {
  await ensureBiSchema(db);
  const range = periodBounds(from, to);
  const [salesResult, returnsResult] = await Promise.all([
    db.prepare(`SELECT order_id AS orderId, line_item_id AS lineItemId, sku, product_name AS productName,
      quantity, currency, order_status AS orderStatus, ordered_at AS orderedAt, gross_sales AS grossSales,
      seller_discount AS sellerDiscount, refund_amount AS refundAmount, shipping_revenue AS shippingRevenue,
      financial_net_sales AS financialNetSales, platform_fee AS platformFee,
      affiliate_commission AS affiliateCommission, shipping_cost AS shippingCost,
      settlement_amount AS settlementAmount FROM sales_lines WHERE ordered_at >= ? AND ordered_at < ?`)
      .bind(range.start, range.end).all<SalesFact>(),
    db.prepare(`SELECT return_id AS returnId, sku, reason, quantity, status, requested_at AS requestedAt
      FROM return_lines WHERE requested_at >= ? AND requested_at < ?`)
      .bind(range.start, range.end).all<ReturnFact>(),
  ]);
  return { range: { from: range.from, to: range.to }, ...calculateReturns(salesResult.results, returnsResult.results) };
}

export async function getSyncStatus(env: BiEnv) {
  await ensureBiSchema(env.DB);
  const lastRun = await env.DB.prepare(`SELECT id, source, status, orders_upserted AS ordersUpserted,
    returns_upserted AS returnsUpserted, message, started_at AS startedAt, completed_at AS completedAt
    FROM sync_runs ORDER BY started_at DESC LIMIT 1`).first();
  return {
    configured: Boolean(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET && env.TIKTOK_ACCESS_TOKEN && env.TIKTOK_SHOP_CIPHER),
    lastRun,
  };
}

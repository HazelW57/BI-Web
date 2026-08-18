export type BiEnv = Env & {
  TIKTOK_APP_KEY?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_REFRESH_TOKEN?: string;
  TIKTOK_SHOP_CIPHER?: string;
};

export type Granularity = "daily" | "weekly" | "monthly";

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
  returnShippingActual?: number;
  settlementAmount: number | null;
  financeStatus?: string;
  adjustmentAmount?: number;
  unmappedDifference?: number;
};

export type CostFact = {
  sku: string;
  productName?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  productCost: number;
};

export type ExpenseFact = { month: string; kind: string; amount: number };

export type AgencyRule = {
  feeName: string;
  feeCategory: string;
  scopeType: string;
  scopeValue: string;
  method: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type ReturnShippingRule = {
  sku: string;
  costPerUnit: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type ManualCost = {
  period: string;
  category: string;
  sku: string;
  amount: number;
};

export type ReturnFact = {
  returnId: string;
  orderId?: string;
  lineItemId?: string;
  sku: string;
  reason: string;
  returnType?: string;
  quantity: number;
  refundAmount?: number;
  status: string;
  requestedAt: number;
};

export type PnlRow = {
  key: string;
  gmv: number;
  orders: number;
  units: number;
  refunds: number;
  tiktokFees: number;
  sellerShippingCost: number;
  netRevenue: number;
  cogs: number;
  affiliateCommission: number;
  adSpend: number;
  videoAgencyFees: number;
  liveAgencyFees: number;
  returnShippingCost: number;
  otherCosts: number;
  operatingProfit: number;
  margin: number;
  settlement: number;
  estimatedReturnShipping: boolean;
  revenue: number;
  platformFees: number;
  shippingCost: number;
  agencyFees: number;
  contributionProfit: number;
  adjustments: number;
  unmappedDifference: number;
  financeFinal: number;
  financePending: number;
};

type PnlAccumulator = PnlRow & { orderIds: Set<string> };

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
  `CREATE TABLE IF NOT EXISTS product_cost_rules (
    id TEXT PRIMARY KEY, seller_sku TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', unit_cost REAL NOT NULL,
    effective_from TEXT NOT NULL, effective_to TEXT, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_cost_rule ON product_cost_rules(seller_sku,effective_from)`,
  `CREATE TABLE IF NOT EXISTS agency_fee_rules (
    id TEXT PRIMARY KEY, fee_name TEXT NOT NULL, fee_category TEXT NOT NULL, scope_type TEXT NOT NULL,
    scope_value TEXT NOT NULL DEFAULT 'ALL', calculation_method TEXT NOT NULL, rate_amount REAL NOT NULL,
    effective_from TEXT NOT NULL, effective_to TEXT, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS return_shipping_rules (
    id TEXT PRIMARY KEY, seller_sku TEXT NOT NULL, cost_per_unit REAL NOT NULL,
    effective_from TEXT NOT NULL, effective_to TEXT, import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_return_shipping_rule ON return_shipping_rules(seller_sku,effective_from)`,
  `CREATE TABLE IF NOT EXISTS manual_costs (
    id TEXT PRIMARY KEY, period TEXT NOT NULL, cost_category TEXT NOT NULL, seller_sku TEXT NOT NULL DEFAULT 'ALL',
    amount REAL NOT NULL, notes TEXT NOT NULL DEFAULT '', import_id TEXT, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_line_costs (
    sales_line_id TEXT PRIMARY KEY, return_shipping_actual REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS raw_finance_transactions (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_item_id TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS raw_orders (
    id TEXT PRIMARY KEY, ordered_at INTEGER NOT NULL, raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_statements (
    id TEXT PRIMARY KEY, statement_time INTEGER NOT NULL, payment_status TEXT NOT NULL DEFAULT 'FINAL',
    settlement_amount REAL NOT NULL DEFAULT 0, revenue_amount REAL NOT NULL DEFAULT 0,
    fee_amount REAL NOT NULL DEFAULT 0, adjustment_amount REAL NOT NULL DEFAULT 0,
    shipping_cost_amount REAL NOT NULL DEFAULT 0, raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_item_id TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '',
    statement_id TEXT NOT NULL DEFAULT '', finance_status TEXT NOT NULL,
    transaction_time INTEGER NOT NULL, revenue_amount REAL NOT NULL DEFAULT 0,
    fee_tax_amount REAL NOT NULL DEFAULT 0, shipping_cost_amount REAL NOT NULL DEFAULT 0,
    adjustment_amount REAL NOT NULL DEFAULT 0, settlement_amount REAL NOT NULL DEFAULT 0,
    unmapped_difference REAL NOT NULL DEFAULT 0, raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finance_order ON finance_transactions(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_finance_time ON finance_transactions(transaction_time)`,
  `CREATE TABLE IF NOT EXISTS finance_components (
    id TEXT PRIMARY KEY, finance_transaction_id TEXT NOT NULL, order_id TEXT NOT NULL,
    component_key TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL,
    included_by_tiktok INTEGER NOT NULL DEFAULT 1, finance_status TEXT NOT NULL, raw_path TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finance_components_order ON finance_components(order_id)`,
  `CREATE TABLE IF NOT EXISTS affiliate_orders (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    content_type TEXT NOT NULL DEFAULT '', raw_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_windows (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL,
    status TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0, page_count INTEGER NOT NULL DEFAULT 0,
    cursor TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
  )`,
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

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dayString(epoch: number) {
  return new Date(epoch).toISOString().slice(0, 10);
}

function monthString(epoch: number) {
  return dayString(epoch).slice(0, 7);
}

function bucketString(epoch: number, granularity: Granularity) {
  const date = new Date(epoch);
  if (granularity === "daily") return date.toISOString().slice(0, 10);
  if (granularity === "monthly") return date.toISOString().slice(0, 7);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function validSale(status: string) {
  return !/CANCEL|UNPAID|FAILED|REJECT|AWAITING_PAYMENT/i.test(status);
}

function completedReturn(status: string) {
  if (/REJECT|CANCEL|PENDING|PROCESS|AWAIT|REQUESTING/i.test(status)) return false;
  return /COMPLETE|SUCCESS|APPROV|CLOSED|REFUND|RETURNED|RECEIVED/i.test(status);
}

function physicalReturn(type = "RETURN") {
  return !/REFUND_ONLY|REFUND_WITHOUT_RETURN|NO_RETURN/i.test(type) && /RETURN/i.test(type);
}

function baseRow(key: string): PnlAccumulator {
  return {
    key, gmv: 0, orders: 0, units: 0, refunds: 0, tiktokFees: 0, sellerShippingCost: 0,
    netRevenue: 0, cogs: 0, affiliateCommission: 0, adSpend: 0, videoAgencyFees: 0,
    liveAgencyFees: 0, returnShippingCost: 0, otherCosts: 0, operatingProfit: 0, margin: 0,
    settlement: 0, estimatedReturnShipping: false, revenue: 0, platformFees: 0, shippingCost: 0,
    agencyFees: 0, contributionProfit: 0, adjustments: 0, unmappedDifference: 0,
    financeFinal: 0, financePending: 0, orderIds: new Set<string>(),
  };
}

function matchingCost(costs: CostFact[], sku: string, orderedAt: number) {
  const date = dayString(orderedAt);
  let result = 0;
  for (const cost of costs) {
    if (cost.sku === sku && cost.effectiveFrom <= date && (!cost.effectiveTo || cost.effectiveTo >= date)) result = cost.productCost;
  }
  return result;
}

function matchingReturnShipping(rules: ReturnShippingRule[], sku: string, orderedAt: number) {
  const date = dayString(orderedAt);
  let fallback = 0;
  let exact = 0;
  for (const rule of rules) {
    if (rule.effectiveFrom > date || (rule.effectiveTo && rule.effectiveTo < date)) continue;
    if (rule.sku === "ALL") fallback = rule.costPerUnit;
    if (rule.sku === sku) exact = rule.costPerUnit;
  }
  return exact || fallback;
}

function addRow(target: PnlAccumulator, source: PnlAccumulator | PnlRow) {
  for (const key of ["gmv", "units", "refunds", "tiktokFees", "sellerShippingCost", "netRevenue", "cogs",
    "affiliateCommission", "adSpend", "videoAgencyFees", "liveAgencyFees", "returnShippingCost", "otherCosts", "settlement",
    "adjustments", "unmappedDifference", "financeFinal", "financePending"] as const) {
    target[key] += source[key];
  }
  target.estimatedReturnShipping ||= source.estimatedReturnShipping;
}

function finalize(row: PnlAccumulator): PnlRow {
  row.orders = row.orderIds.size || row.orders;
  // Finance settlement is the authoritative TikTok Net Revenue. Affiliate and platform fees
  // are disclosures already included by TikTok and must not be deducted a second time.
  row.netRevenue = row.financeFinal + row.financePending || row.settlement || row.gmv - row.refunds - row.tiktokFees - row.sellerShippingCost;
  row.operatingProfit = row.netRevenue - row.cogs - row.adSpend - row.videoAgencyFees
    - row.liveAgencyFees - row.returnShippingCost - row.otherCosts;
  row.margin = row.netRevenue ? row.operatingProfit / row.netRevenue * 100 : 0;
  row.revenue = row.netRevenue;
  row.platformFees = row.tiktokFees;
  row.shippingCost = row.sellerShippingCost;
  row.agencyFees = row.videoAgencyFees + row.liveAgencyFees;
  row.contributionProfit = row.netRevenue - row.cogs;
  const result = { ...row } as PnlRow & { orderIds?: Set<string> };
  delete result.orderIds;
  for (const key of Object.keys(result) as (keyof PnlRow)[]) {
    if (typeof result[key] === "number") (result[key] as number) = round(result[key] as number);
  }
  return result;
}

function addCost(row: PnlAccumulator, category: string, amount: number) {
  if (/AD_SPEND|ADVERTISING/i.test(category)) row.adSpend += amount;
  else if (/VIDEO/i.test(category)) row.videoAgencyFees += amount;
  else if (/LIVE/i.test(category)) row.liveAgencyFees += amount;
  else row.otherCosts += amount;
}

function distribute(rows: PnlAccumulator[], amount: number, category: string) {
  if (!rows.length || !amount) return;
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.gmv), 0);
  for (const row of rows) addCost(row, category, amount * (total ? Math.max(0, row.gmv) / total : 1 / rows.length));
}

export function calculatePnl(
  sales: SalesFact[],
  costs: CostFact[],
  expenses: ExpenseFact[],
  options: {
    granularity?: Granularity;
    returns?: ReturnFact[];
    agencyRules?: AgencyRule[];
    returnShippingRules?: ReturnShippingRule[];
    manualCosts?: ManualCost[];
  } = {},
) {
  const granularity = options.granularity || "monthly";
  const validSales = sales.filter((line) => validSale(line.orderStatus));
  const trend = new Map<string, PnlAccumulator>();
  const sku = new Map<string, PnlAccumulator>();
  const saleByOrderSku = new Map<string, SalesFact>();

  for (const line of validSales) {
    const gmv = Math.max(0, line.grossSales - Math.abs(line.sellerDiscount));
    const affiliate = Math.abs(line.affiliateCommission);
    // platform_fee is stored net of affiliate commission by the Finance mapper.
    const fees = Math.abs(line.platformFee);
    const shipping = Math.abs(line.shippingCost);
    const refunds = Math.abs(line.refundAmount);
    const cogs = matchingCost(costs, line.sku, line.orderedAt) * line.quantity;
    const values = { gmv, refunds, tiktokFees: fees, sellerShippingCost: shipping, cogs, affiliateCommission: affiliate };
    for (const [key, target] of [[bucketString(line.orderedAt, granularity), trend], [line.sku, sku]] as const) {
      const row = target.get(key) ?? baseRow(key);
      row.gmv += values.gmv; row.refunds += values.refunds; row.tiktokFees += values.tiktokFees;
      row.sellerShippingCost += values.sellerShippingCost; row.cogs += values.cogs;
      row.affiliateCommission += values.affiliateCommission; row.units += line.quantity;
      row.settlement += line.settlementAmount ?? 0; row.orderIds.add(line.orderId);
      row.adjustments += line.adjustmentAmount || 0; row.unmappedDifference += line.unmappedDifference || 0;
      if (line.settlementAmount !== null) {
        if (line.financeStatus === "ESTIMATED") row.financePending += line.settlementAmount;
        else row.financeFinal += line.settlementAmount;
      }
      if (line.returnShippingActual) row.returnShippingCost += Math.abs(line.returnShippingActual);
      target.set(key, row);
    }
    saleByOrderSku.set(`${line.orderId}:${line.sku}`, line);
  }

  const actualReturnShippingSkus = new Set(validSales.filter((line) => (line.returnShippingActual || 0) > 0).map((line) => line.sku));
  for (const item of options.returns || []) {
    if (!completedReturn(item.status) || !physicalReturn(item.returnType) || actualReturnShippingSkus.has(item.sku)) continue;
    const sale = saleByOrderSku.get(`${item.orderId || ""}:${item.sku}`) || validSales.find((line) => line.sku === item.sku);
    if (!sale) continue;
    const amount = item.quantity * matchingReturnShipping(options.returnShippingRules || [], item.sku, sale.orderedAt);
    if (!amount) continue;
    for (const [key, target] of [[bucketString(sale.orderedAt, granularity), trend], [item.sku, sku]] as const) {
      const row = target.get(key) ?? baseRow(key); row.returnShippingCost += amount; row.estimatedReturnShipping = true; target.set(key, row);
    }
  }

  for (const expense of expenses) {
    distribute([...trend.values()].filter((row) => row.key.startsWith(expense.month)), expense.amount, expense.kind);
    distribute([...sku.values()], expense.amount, expense.kind);
  }

  for (const cost of options.manualCosts || []) {
    const eligibleTrend = [...trend.values()].filter((row) => row.key.startsWith(cost.period.slice(0, 7)));
    if (cost.sku === "ALL") {
      distribute(eligibleTrend, cost.amount, cost.category);
      distribute([...sku.values()], cost.amount, cost.category);
    } else {
      const skuRow = sku.get(cost.sku); if (skuRow) addCost(skuRow, cost.category, cost.amount);
      distribute(eligibleTrend.filter((row) => row.gmv > 0), cost.amount, cost.category);
    }
  }

  for (const rule of options.agencyRules || []) {
    const eligibleSales = validSales.filter((line) => {
      const date = dayString(line.orderedAt);
      const scopeMatch = rule.scopeType === "ALL" || (rule.scopeType === "SKU" && rule.scopeValue === line.sku)
        || (rule.scopeType === "PRODUCT" && rule.scopeValue === line.productName);
      return scopeMatch && date >= rule.effectiveFrom && (!rule.effectiveTo || date <= rule.effectiveTo);
    });
    if (!eligibleSales.length) continue;
    const orderIds = new Set(eligibleSales.map((line) => line.orderId));
    const units = eligibleSales.reduce((sum, line) => sum + line.quantity, 0);
    const gmv = eligibleSales.reduce((sum, line) => sum + Math.max(0, line.grossSales - Math.abs(line.sellerDiscount)), 0);
    const net = eligibleSales.reduce((sum, line) => sum + Math.max(0, line.grossSales - Math.abs(line.sellerDiscount) - Math.abs(line.refundAmount) - Math.abs(line.shippingCost)), 0);
    const activeDays = new Set(eligibleSales.map((line) => dayString(line.orderedAt))).size;
    const activeMonths = new Set(eligibleSales.map((line) => monthString(line.orderedAt))).size;
    let amount = 0;
    if (rule.method === "PERCENT_GMV") amount = gmv * rule.rate;
    else if (rule.method === "PERCENT_NET_REVENUE") amount = net * rule.rate;
    else if (rule.method === "FIXED_PER_ORDER") amount = orderIds.size * rule.rate;
    else if (rule.method === "FIXED_PER_UNIT") amount = units * rule.rate;
    else if (rule.method === "FIXED_DAILY") amount = activeDays * rule.rate;
    else if (rule.method === "FIXED_MONTHLY") amount = activeMonths * rule.rate;
    const category = rule.feeCategory;
    const eligibleSkus = new Set(eligibleSales.map((line) => line.sku));
    const eligibleBuckets = new Set(eligibleSales.map((line) => bucketString(line.orderedAt, granularity)));
    distribute([...trend.values()].filter((row) => eligibleBuckets.has(row.key)), amount, category);
    distribute([...sku.values()].filter((row) => eligibleSkus.has(row.key)), amount, category);
  }

  const trendRows = [...trend.values()].map(finalize).sort((a, b) => a.key.localeCompare(b.key));
  const skuRows = [...sku.values()].map(finalize).sort((a, b) => b.operatingProfit - a.operatingProfit);
  const totalAccumulator = baseRow("total");
  for (const row of trendRows) { addRow(totalAccumulator, row); totalAccumulator.orders += row.orders; }
  const total = finalize(totalAccumulator);
  total.orders = trendRows.reduce((sum, row) => sum + row.orders, 0);
  return { total, trend: trendRows, months: trendRows, skus: skuRows };
}

export function calculateReturns(
  sales: SalesFact[],
  returns: ReturnFact[],
  returnShippingRules: ReturnShippingRule[] = [],
  granularity: Granularity = "monthly",
) {
  const validSales = sales.filter((line) => validSale(line.orderStatus));
  const salesByOrderSku = new Map(validSales.map((line) => [`${line.orderId}:${line.sku}`, line]));
  const rows = new Map<string, {
    sku: string; productName: string; soldUnits: number; gmv: number; returnedUnits: number; refundAmount: number;
    returnShippingCost: number; reasons: Map<string, { count: number; refundAmount: number }>;
    trend: Map<string, { key: string; soldUnits: number; returnedUnits: number; returnRate: number }>;
    reasonTrend: Map<string, Map<string, number>>;
  }>();
  for (const line of validSales) {
    const row = rows.get(line.sku) ?? { sku: line.sku, productName: line.productName, soldUnits: 0, gmv: 0, returnedUnits: 0, refundAmount: 0, returnShippingCost: 0, reasons: new Map(), trend: new Map(), reasonTrend: new Map() };
    row.soldUnits += line.quantity; row.gmv += Math.max(0, line.grossSales - Math.abs(line.sellerDiscount));
    const key = bucketString(line.orderedAt, granularity);
    const point = row.trend.get(key) ?? { key, soldUnits: 0, returnedUnits: 0, returnRate: 0 };
    point.soldUnits += line.quantity; row.trend.set(key, point); rows.set(line.sku, row);
  }
  for (const item of returns) {
    if (!completedReturn(item.status)) continue;
    const row = rows.get(item.sku); if (!row) continue;
    const sale = salesByOrderSku.get(`${item.orderId || ""}:${item.sku}`) || validSales.find((line) => line.sku === item.sku);
    const refund = Math.abs(item.refundAmount || 0); row.refundAmount += refund;
    if (physicalReturn(item.returnType)) {
      row.returnedUnits += item.quantity;
      if (sale) row.returnShippingCost += item.quantity * matchingReturnShipping(returnShippingRules, item.sku, sale.orderedAt);
      const reason = item.reason || "未分类";
      const reasonRow = row.reasons.get(reason) ?? { count: 0, refundAmount: 0 };
      reasonRow.count += item.quantity; reasonRow.refundAmount += refund; row.reasons.set(reason, reasonRow);
      if (sale) {
        const key = bucketString(sale.orderedAt, granularity);
        const point = row.trend.get(key) ?? { key, soldUnits: 0, returnedUnits: 0, returnRate: 0 };
        point.returnedUnits += item.quantity; row.trend.set(key, point);
        const reasons = row.reasonTrend.get(key) ?? new Map<string, number>();
        reasons.set(reason, (reasons.get(reason) || 0) + item.quantity); row.reasonTrend.set(key, reasons);
      }
    }
  }
  const skus = [...rows.values()].map((row) => ({
    sku: row.sku, productName: row.productName, soldUnits: row.soldUnits, returnedUnits: row.returnedUnits,
    returnRate: row.soldUnits ? round(row.returnedUnits / row.soldUnits * 100) : 0,
    refundAmount: round(row.refundAmount), refundGmvRate: row.gmv ? round(row.refundAmount / row.gmv * 100) : 0,
    returnShippingCost: round(row.returnShippingCost),
    reasons: [...row.reasons.entries()].map(([reason, value]) => ({ reason, count: value.count, refundAmount: round(value.refundAmount), share: row.returnedUnits ? round(value.count / row.returnedUnits * 100) : 0 })).sort((a, b) => b.count - a.count),
    trend: [...row.trend.values()].map((point) => ({ ...point, returnRate: point.soldUnits ? round(point.returnedUnits / point.soldUnits * 100) : 0 })).sort((a, b) => a.key.localeCompare(b.key)),
    reasonTrend: [...row.reasonTrend.entries()].map(([key, reasons]) => {
      const total = [...reasons.values()].reduce((sum, count) => sum + count, 0);
      return { key, reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count, share: total ? round(count / total * 100) : 0 })).sort((a, b) => b.count - a.count) };
    }).sort((a, b) => a.key.localeCompare(b.key)),
  })).sort((a, b) => b.returnRate - a.returnRate || b.returnedUnits - a.returnedUnits);
  const soldUnits = skus.reduce((sum, row) => sum + row.soldUnits, 0);
  const returnedUnits = skus.reduce((sum, row) => sum + row.returnedUnits, 0);
  const refundAmount = skus.reduce((sum, row) => sum + row.refundAmount, 0);
  const gmv = [...rows.values()].reduce((sum, row) => sum + row.gmv, 0);
  return {
    soldUnits, returnedUnits, returnRate: soldUnits ? round(returnedUnits / soldUnits * 100) : 0,
    refundAmount: round(refundAmount), refundGmvRate: gmv ? round(refundAmount / gmv * 100) : 0,
    returnShippingCost: round(skus.reduce((sum, row) => sum + row.returnShippingCost, 0)),
    skuCount: skus.filter((row) => row.soldUnits || row.returnedUnits).length, skus,
  };
}

function periodBounds(from?: string | null, to?: string | null) {
  const endDate = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00.000Z`) : new Date();
  const startDate = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00.000Z`) : new Date("2026-02-01T00:00:00.000Z");
  return { from: dayString(startDate.getTime()), to: dayString(endDate.getTime()), start: startDate.getTime(), end: endDate.getTime() + 86_400_000 };
}

function salesQuery() {
  return `SELECT s.order_id AS orderId, s.line_item_id AS lineItemId, s.sku, s.product_name AS productName,
    s.quantity, s.currency, s.order_status AS orderStatus, s.ordered_at AS orderedAt, s.gross_sales AS grossSales,
    s.seller_discount AS sellerDiscount, s.refund_amount AS refundAmount, s.shipping_revenue AS shippingRevenue,
    s.financial_net_sales AS financialNetSales, s.platform_fee AS platformFee,
    s.affiliate_commission AS affiliateCommission, s.shipping_cost AS shippingCost,
    COALESCE(f.return_shipping_actual,0) AS returnShippingActual,
    COALESCE(ft.settlementAmount,s.settlement_amount) AS settlementAmount, ft.financeStatus,
    COALESCE(ft.adjustmentAmount,0) AS adjustmentAmount, COALESCE(ft.unmappedDifference,0) AS unmappedDifference
    FROM sales_lines s LEFT JOIN finance_line_costs f ON f.sales_line_id=s.id
    LEFT JOIN (SELECT order_id,line_item_id,MAX(finance_status) AS financeStatus,SUM(settlement_amount) AS settlementAmount,
      SUM(adjustment_amount) AS adjustmentAmount,SUM(unmapped_difference) AS unmappedDifference
      FROM finance_transactions GROUP BY order_id,line_item_id) ft ON ft.order_id=s.order_id AND (ft.line_item_id=s.line_item_id OR ft.line_item_id='')`;
}

export type SnapshotFilters = { from?: string | null; to?: string | null; granularity?: string | null; product?: string | null; sku?: string | null; returnType?: string | null; returnStatus?: string | null };

function normalizedGranularity(value?: string | null): Granularity {
  return value === "daily" || value === "weekly" ? value : "monthly";
}

function filterSales(sales: SalesFact[], filters: SnapshotFilters) {
  return sales.filter((line) => (!filters.product || filters.product === "ALL" || line.productName === filters.product)
    && (!filters.sku || filters.sku === "ALL" || line.sku === filters.sku));
}

export async function getPnlSnapshot(db: D1Database, filters: SnapshotFilters = {}) {
  await ensureBiSchema(db);
  const range = periodBounds(filters.from, filters.to);
  const [salesResult, legacyCosts, costsResult, expensesResult, agencyResult, shippingResult, manualResult, returnsResult] = await Promise.all([
    db.prepare(`${salesQuery()} WHERE s.ordered_at >= ? AND s.ordered_at < ? ORDER BY s.ordered_at`).bind(range.start, range.end).all<SalesFact>(),
    db.prepare("SELECT sku, effective_from AS effectiveFrom, product_cost AS productCost FROM sku_costs ORDER BY effective_from").all<CostFact>(),
    db.prepare("SELECT seller_sku AS sku, product_name AS productName, unit_cost AS productCost, effective_from AS effectiveFrom, effective_to AS effectiveTo FROM product_cost_rules ORDER BY effective_from").all<CostFact>(),
    db.prepare("SELECT month, kind, amount FROM period_expenses WHERE month >= ? AND month <= ? ORDER BY month").bind(range.from.slice(0, 7), range.to.slice(0, 7)).all<ExpenseFact>(),
    db.prepare("SELECT fee_name AS feeName, fee_category AS feeCategory, scope_type AS scopeType, scope_value AS scopeValue, calculation_method AS method, rate_amount AS rate, effective_from AS effectiveFrom, effective_to AS effectiveTo FROM agency_fee_rules").all<AgencyRule>(),
    db.prepare("SELECT seller_sku AS sku, cost_per_unit AS costPerUnit, effective_from AS effectiveFrom, effective_to AS effectiveTo FROM return_shipping_rules ORDER BY effective_from").all<ReturnShippingRule>(),
    db.prepare("SELECT period, cost_category AS category, seller_sku AS sku, amount FROM manual_costs WHERE period >= ? AND period <= ?").bind(range.from.slice(0, 7), range.to).all<ManualCost>(),
    db.prepare(`SELECT return_id AS returnId, order_id AS orderId, line_item_id AS lineItemId, sku, reason, return_type AS returnType,
      quantity, refund_amount AS refundAmount, status, requested_at AS requestedAt FROM return_lines r
      WHERE EXISTS (SELECT 1 FROM sales_lines s WHERE s.order_id=r.order_id AND s.ordered_at>=? AND s.ordered_at<?)`).bind(range.start, range.end).all<ReturnFact>(),
  ]);
  const dimensions = {
    products: [...new Set(salesResult.results.map((line) => line.productName).filter(Boolean))].sort(),
    skus: [...new Set(salesResult.results.map((line) => line.sku).filter(Boolean))].sort(),
  };
  const filtered = filterSales(salesResult.results, filters);
  const allowedSkus = new Set(filtered.map((line) => line.sku));
  const allowedOrders = new Set(filtered.map((line) => line.orderId));
  const calculated = calculatePnl(filtered, [...legacyCosts.results, ...costsResult.results], expensesResult.results, {
    granularity: normalizedGranularity(filters.granularity), returns: returnsResult.results.filter((item) => allowedSkus.has(item.sku) && allowedOrders.has(item.orderId || "")),
    agencyRules: agencyResult.results, returnShippingRules: shippingResult.results, manualCosts: manualResult.results,
  });
  return { range: { from: range.from, to: range.to }, granularity: normalizedGranularity(filters.granularity), dimensions, ...calculated,
    sources: [
      { metric: "GMV / Orders / Units", source: "TikTok Orders API", status: "actual" },
      { metric: "Refunds / TikTok Fees / Shipping / Affiliate", source: "TikTok Finance API", status: "actual-or-pending" },
      { metric: "Product / Agency / Manual Costs", source: "Uploaded Cost Rules", status: "rule-based" },
      { metric: "Return Shipping", source: "Finance actual; uploaded per-unit rule as fallback", status: calculated.total.estimatedReturnShipping ? "estimated" : "actual-or-zero" },
      { metric: "Ad Spend", source: "TikTok API for Business", status: calculated.total.adSpend ? "uploaded" : "not-connected" },
    ] };
}

export async function getReturnsSnapshot(db: D1Database, filters: SnapshotFilters = {}) {
  await ensureBiSchema(db);
  const range = periodBounds(filters.from, filters.to);
  const [salesResult, returnsResult, createdResult, shippingResult] = await Promise.all([
    db.prepare(`${salesQuery()} WHERE s.ordered_at>=? AND s.ordered_at<?`).bind(range.start, range.end).all<SalesFact>(),
    db.prepare(`SELECT return_id AS returnId, order_id AS orderId, line_item_id AS lineItemId, sku, reason, return_type AS returnType,
      quantity, refund_amount AS refundAmount, status, requested_at AS requestedAt FROM return_lines r
      WHERE EXISTS (SELECT 1 FROM sales_lines s WHERE s.order_id=r.order_id AND s.ordered_at>=? AND s.ordered_at<?)`).bind(range.start, range.end).all<ReturnFact>(),
    db.prepare("SELECT COUNT(DISTINCT return_id) AS count FROM return_lines WHERE requested_at>=? AND requested_at<?").bind(range.start, range.end).first<{ count: number }>(),
    db.prepare("SELECT seller_sku AS sku, cost_per_unit AS costPerUnit, effective_from AS effectiveFrom, effective_to AS effectiveTo FROM return_shipping_rules ORDER BY effective_from").all<ReturnShippingRule>(),
  ]);
  const dimensions = {
    products: [...new Set(salesResult.results.map((line) => line.productName).filter(Boolean))].sort(),
    skus: [...new Set(salesResult.results.map((line) => line.sku).filter(Boolean))].sort(),
    returnTypes: [...new Set(returnsResult.results.map((item) => item.returnType || "RETURN"))].sort(),
    returnStatuses: [...new Set(returnsResult.results.map((item) => item.status))].sort(),
  };
  const filteredSales = filterSales(salesResult.results, filters);
  const skus = new Set(filteredSales.map((line) => line.sku));
  const orders = new Set(filteredSales.map((line) => line.orderId));
  const filteredReturns = returnsResult.results.filter((item) => skus.has(item.sku) && orders.has(item.orderId || "")
    && (!filters.returnType || filters.returnType === "ALL" || item.returnType === filters.returnType)
    && (!filters.returnStatus || filters.returnStatus === "ALL" || item.status === filters.returnStatus));
  return { range: { from: range.from, to: range.to }, granularity: normalizedGranularity(filters.granularity), dimensions,
    returnsCreatedDuringPeriod: createdResult?.count || 0, ...calculateReturns(filteredSales, filteredReturns, shippingResult.results, normalizedGranularity(filters.granularity)),
    sources: [{ metric: "Sold Units", source: "TikTok Orders API sales cohort" }, { metric: "Returns / Reasons / Refunds", source: "TikTok Returns & Refunds API joined to original order + SKU" }, { metric: "Return Shipping", source: "Finance actual when available; uploaded per-unit rule fallback" }] };
}

export async function getSyncStatus(env: BiEnv) {
  await ensureBiSchema(env.DB);
  const lastRun = await env.DB.prepare(`SELECT id, source, status, orders_upserted AS ordersUpserted,
    returns_upserted AS returnsUpserted, message, started_at AS startedAt, completed_at AS completedAt
    FROM sync_runs ORDER BY started_at DESC LIMIT 1`).first();
  const counts = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM sales_lines) AS salesLines,
    (SELECT COUNT(*) FROM return_lines) AS returnLines,
    (SELECT COUNT(*) FROM product_cost_rules) AS productCostRules,
    (SELECT COUNT(*) FROM agency_fee_rules) AS agencyRules,
    (SELECT COUNT(*) FROM return_shipping_rules) AS returnShippingRules,
    (SELECT COUNT(*) FROM manual_costs) AS manualCosts`).first();
  return {
    configured: Boolean(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET && env.TIKTOK_ACCESS_TOKEN && env.TIKTOK_SHOP_CIPHER),
    lastRun, counts,
  };
}

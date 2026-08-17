import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const authUsers = sqliteTable("auth_users", {
  email: text("email").primaryKey(), passwordHash: text("password_hash").notNull(), salt: text("salt").notNull(),
  role: text("role").notNull(), hidden: integer("hidden").notNull().default(0),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const salesLines = sqliteTable("sales_lines", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  lineItemId: text("line_item_id").notNull(),
  sku: text("sku").notNull(),
  productName: text("product_name").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  currency: text("currency").notNull().default("USD"),
  orderStatus: text("order_status").notNull().default("UNKNOWN"),
  orderedAt: integer("ordered_at").notNull(),
  grossSales: real("gross_sales").notNull().default(0),
  sellerDiscount: real("seller_discount").notNull().default(0),
  refundAmount: real("refund_amount").notNull().default(0),
  shippingRevenue: real("shipping_revenue").notNull().default(0),
  financialNetSales: real("financial_net_sales"),
  platformFee: real("platform_fee").notNull().default(0),
  affiliateCommission: real("affiliate_commission").notNull().default(0),
  shippingCost: real("shipping_cost").notNull().default(0),
  settlementAmount: real("settlement_amount"),
  rawJson: text("raw_json"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_order_line").on(table.orderId, table.lineItemId),
  index("idx_sales_ordered_at").on(table.orderedAt),
  index("idx_sales_sku_ordered_at").on(table.sku, table.orderedAt),
]);

export const returnLines = sqliteTable("return_lines", {
  id: text("id").primaryKey(),
  returnId: text("return_id").notNull(),
  orderId: text("order_id").notNull(),
  lineItemId: text("line_item_id").notNull().default(""),
  sku: text("sku").notNull(),
  reason: text("reason").notNull().default("未分类"),
  returnType: text("return_type").notNull().default("RETURN"),
  status: text("status").notNull().default("UNKNOWN"),
  quantity: integer("quantity").notNull().default(1),
  refundAmount: real("refund_amount").notNull().default(0),
  requestedAt: integer("requested_at").notNull(),
  rawJson: text("raw_json"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_returns_return_line").on(table.returnId, table.lineItemId),
  index("idx_returns_requested_at").on(table.requestedAt),
  index("idx_returns_sku_requested_at").on(table.sku, table.requestedAt),
]);

export const skuCosts = sqliteTable("sku_costs", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  productCost: real("product_cost").notNull(),
  currency: text("currency").notNull().default("USD"),
  importId: text("import_id"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sku_cost_effective").on(table.sku, table.effectiveFrom),
]);

export const periodExpenses = sqliteTable("period_expenses", {
  id: text("id").primaryKey(),
  month: text("month").notNull(),
  kind: text("kind").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  importId: text("import_id"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_period_expense_month_kind").on(table.month, table.kind),
]);

export const importRuns = sqliteTable("import_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  importedBy: text("imported_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  ordersUpserted: integer("orders_upserted").notNull().default(0),
  returnsUpserted: integer("returns_upserted").notNull().default(0),
  message: text("message").notNull().default(""),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
}, (table) => [index("idx_sync_runs_started_at").on(table.startedAt)]);

import { ensureBiSchema, type BiEnv } from "./bi";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  const object = asRecord(value);
  if (object.amount !== undefined) return numberValue(object.amount, fallback);
  if (object.value !== undefined) return numberValue(object.value, fallback);
  return fallback;
}

function timestampValue(value: unknown, fallback = Date.now()) {
  const numeric = numberValue(value, 0);
  if (!numeric) return fallback;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size = 250) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

async function signRequest(path: string, params: Record<string, string>, bodyText: string, secret: string) {
  const sorted = Object.entries(params)
    .filter(([key]) => key !== "sign" && key !== "access_token")
    .sort(([left], [right]) => left.localeCompare(right));
  const base = `${path}${sorted.map(([key, value]) => `${key}${value}`).join("")}${bodyText}`;
  const message = `${secret}${base}${secret}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function tiktokRequest(env: BiEnv, path: string, options: { method?: "GET" | "POST"; query?: Record<string, string>; body?: JsonRecord } = {}) {
  const method = options.method ?? "GET";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    app_key: env.TIKTOK_APP_KEY!,
    timestamp,
    shop_cipher: env.TIKTOK_SHOP_CIPHER!,
    ...options.query,
  };
  const bodyText = options.body ? JSON.stringify(options.body) : "";
  params.sign = await signRequest(path, params, bodyText, env.TIKTOK_APP_SECRET!);
  const url = new URL(path, env.TIKTOK_API_BASE_URL || "https://open-api.tiktokglobalshop.com");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-tts-access-token": env.TIKTOK_ACCESS_TOKEN! },
    body: method === "POST" ? bodyText || "{}" : undefined,
  });
  const payload = await response.json() as JsonRecord;
  if (!response.ok || numberValue(payload.code, 0) !== 0) {
    throw new Error(`TikTok API ${path}: ${stringValue(payload.message, payload.error, response.statusText) || `HTTP ${response.status}`}`);
  }
  return asRecord(payload.data);
}

function firstNamedAmount(value: unknown, pattern: RegExp): number {
  if (!value || typeof value !== "object") return 0;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (pattern.test(key)) return numberValue(child, 0);
    const nested = firstNamedAmount(child, pattern);
    if (nested) return nested;
  }
  return 0;
}

async function fetchOrders(env: BiEnv, fromSeconds: number, toSeconds: number) {
  const version = env.TIKTOK_ORDER_API_VERSION || "202309";
  const path = `/order/${version}/orders/search`;
  const orders: JsonRecord[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const data = await tiktokRequest(env, path, {
      method: "POST",
      query: {
        page_size: "100",
        sort_field: "create_time",
        sort_order: "ASC",
        ...(pageToken ? { page_token: pageToken } : {}),
      },
      body: { create_time_ge: fromSeconds, create_time_lt: toSeconds },
    });
    orders.push(...asArray(data.orders).map(asRecord));
    pageToken = stringValue(data.next_page_token, data.nextPageToken);
    if (!pageToken) break;
  }
  return orders;
}

async function upsertOrders(env: BiEnv, orders: JsonRecord[]) {
  let count = 0;
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const order of orders) {
    const orderId = stringValue(order.id, order.order_id);
    if (!orderId) continue;
    const payment = asRecord(order.payment);
    const lines = asArray(order.line_items ?? order.order_line_items).map(asRecord);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineId = stringValue(line.id, line.order_line_item_id, line.line_item_id) || `${orderId}-${index}`;
      const sku = stringValue(line.seller_sku, line.sku_id, line.sku_name, line.product_id) || "UNKNOWN-SKU";
      const quantity = Math.max(1, Math.round(numberValue(line.quantity, 1)));
      const unitPrice = numberValue(line.original_price ?? line.sale_price ?? line.sku_original_price, 0);
      const grossSales = unitPrice * quantity || (lines.length === 1 ? numberValue(payment.original_total_product_price ?? payment.total_amount, 0) : 0);
      const sellerDiscount = lines.length === 1 ? Math.abs(numberValue(payment.seller_discount, 0)) : 0;
      const shippingRevenue = lines.length === 1 ? numberValue(payment.shipping_fee, 0) : 0;
      const currency = stringValue(line.currency, payment.currency, order.currency) || "USD";
      statements.push(env.DB.prepare(`INSERT INTO sales_lines (
        id, order_id, line_item_id, sku, product_name, quantity, currency, order_status, ordered_at,
        gross_sales, seller_discount, shipping_revenue, raw_json, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(order_id, line_item_id) DO UPDATE SET
        sku=excluded.sku, product_name=excluded.product_name, quantity=excluded.quantity,
        currency=excluded.currency, order_status=excluded.order_status, ordered_at=excluded.ordered_at,
        gross_sales=excluded.gross_sales, seller_discount=excluded.seller_discount,
        shipping_revenue=excluded.shipping_revenue, raw_json=excluded.raw_json, updated_at=excluded.updated_at`)
        .bind(`${orderId}:${lineId}`, orderId, lineId, sku, stringValue(line.product_name, line.sku_name, line.display_name), quantity,
          currency, stringValue(order.status, order.order_status) || "UNKNOWN", timestampValue(order.create_time ?? order.created_at),
          grossSales, sellerDiscount, shippingRevenue, JSON.stringify({ order, line }), now));
      count += 1;
    }
  }
  await runBatches(env.DB, statements);
  return count;
}

async function fetchReturns(env: BiEnv, fromSeconds: number, toSeconds: number) {
  const version = env.TIKTOK_RETURNS_API_VERSION || "202602";
  const path = `/return_refund/${version}/returns/search`;
  const returns: JsonRecord[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page += 1) {
    const data = await tiktokRequest(env, path, {
      method: "POST",
      query: { page_size: "50", sort_field: "create_time", sort_order: "ASC", ...(pageToken ? { page_token: pageToken } : {}) },
      body: { create_time_ge: fromSeconds, create_time_lt: toSeconds },
    });
    returns.push(...asArray(data.return_orders ?? data.returns).map(asRecord));
    pageToken = stringValue(data.next_page_token, data.nextPageToken);
    if (!pageToken) break;
  }
  return returns;
}

async function upsertReturns(env: BiEnv, returns: JsonRecord[]) {
  let count = 0;
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const item of returns) {
    const returnId = stringValue(item.return_id, item.id);
    const orderId = stringValue(item.order_id);
    if (!returnId) continue;
    let lines = asArray(item.return_line_items ?? item.return_items ?? item.order_line_items).map(asRecord);
    if (!lines.length) lines = [item];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineId = stringValue(line.order_line_item_id, line.line_item_id, line.id) || `${returnId}-${index}`;
      let sku = stringValue(line.seller_sku, line.sku_id, item.seller_sku, item.sku_id);
      if (!sku && orderId) {
        const match = await env.DB.prepare("SELECT sku FROM sales_lines WHERE order_id = ? AND (line_item_id = ? OR ? = '') ORDER BY ordered_at LIMIT 1")
          .bind(orderId, lineId, lineId).first<{ sku: string }>();
        sku = match?.sku ?? "UNKNOWN-SKU";
      }
      const reason = stringValue(line.return_reason_text, line.return_reason, item.return_reason_text, item.return_reason, item.buyer_return_reason) || "未分类";
      const refund = numberValue(line.refund_amount ?? item.refund_amount, 0);
      statements.push(env.DB.prepare(`INSERT INTO return_lines (
        id, return_id, order_id, line_item_id, sku, reason, return_type, status,
        quantity, refund_amount, requested_at, raw_json, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(return_id, line_item_id) DO UPDATE SET
        sku=excluded.sku, reason=excluded.reason, return_type=excluded.return_type, status=excluded.status,
        quantity=excluded.quantity, refund_amount=excluded.refund_amount, requested_at=excluded.requested_at,
        raw_json=excluded.raw_json, updated_at=excluded.updated_at`)
        .bind(`${returnId}:${lineId}`, returnId, orderId, lineId, sku || "UNKNOWN-SKU", reason,
          stringValue(item.return_type, item.type) || "RETURN", stringValue(item.return_status, item.status) || "UNKNOWN",
          Math.max(1, Math.round(numberValue(line.quantity, 1))), Math.abs(refund),
          timestampValue(item.create_time ?? item.created_at ?? item.request_time), JSON.stringify({ item, line }), now));
      count += 1;
    }
  }
  await runBatches(env.DB, statements);
  return count;
}

async function applyFinance(env: BiEnv, orderId: string) {
  const version = env.TIKTOK_FINANCE_API_VERSION || "202501";
  const path = `/finance/${version}/orders/${encodeURIComponent(orderId)}/statement_transactions`;
  const data = await tiktokRequest(env, path);
  const transactions = asArray(data.sku_transactions ?? data.transactions).map(asRecord);
  for (const transaction of transactions) {
    const sku = stringValue(transaction.seller_sku, transaction.sku_id, transaction.sku_name);
    const lineId = stringValue(transaction.order_line_item_id, transaction.line_item_id);
    const row = lineId
      ? await env.DB.prepare("SELECT id FROM sales_lines WHERE order_id = ? AND line_item_id = ? LIMIT 1").bind(orderId, lineId).first<{ id: string }>()
      : await env.DB.prepare("SELECT id FROM sales_lines WHERE order_id = ? AND (? = '' OR sku = ?) ORDER BY ordered_at LIMIT 1").bind(orderId, sku, sku).first<{ id: string }>();
    if (!row) continue;
    const revenue = numberValue(transaction.revenue_amount, 0);
    const feeAndTax = Math.abs(numberValue(transaction.fee_and_tax_amount ?? transaction.fee_tax_amount, 0));
    const shipping = Math.abs(numberValue(transaction.shipping_cost_amount, 0));
    const settlement = numberValue(transaction.settlement_amount, 0);
    const affiliate = Math.abs(firstNamedAmount(transaction, /affiliate.*commission.*amount/i));
    const fee = Math.max(0, feeAndTax - affiliate);
    const refund = Math.abs(firstNamedAmount(transaction, /gross.*sales.*refund.*amount|refund.*amount/i));
    const returnShipping = Math.abs(firstNamedAmount(transaction, /return.*shipping.*amount|shipping.*return.*amount/i));
    await env.DB.prepare(`UPDATE sales_lines SET financial_net_sales=?, platform_fee=?, affiliate_commission=?,
      shipping_cost=?, settlement_amount=?, refund_amount=MAX(refund_amount, ?), updated_at=? WHERE id=?`)
      .bind(revenue, fee, affiliate, shipping, settlement, refund, Date.now(), row.id).run();
    await env.DB.prepare(`INSERT INTO finance_line_costs (sales_line_id,return_shipping_actual,updated_at) VALUES (?,?,?)
      ON CONFLICT(sales_line_id) DO UPDATE SET return_shipping_actual=excluded.return_shipping_actual,updated_at=excluded.updated_at`)
      .bind(row.id, returnShipping, Date.now()).run();
    const transactionId = stringValue(transaction.id, transaction.transaction_id) || `${orderId}:${lineId || sku || "order"}`;
    await env.DB.prepare(`INSERT INTO raw_finance_transactions (id,order_id,line_item_id,sku,raw_json,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET raw_json=excluded.raw_json,updated_at=excluded.updated_at`)
      .bind(transactionId, orderId, lineId, sku, JSON.stringify(transaction), Date.now()).run();
  }
}

function validateConfig(env: BiEnv) {
  const missing = [
    ["TIKTOK_APP_KEY", env.TIKTOK_APP_KEY], ["TIKTOK_APP_SECRET", env.TIKTOK_APP_SECRET],
    ["TIKTOK_ACCESS_TOKEN", env.TIKTOK_ACCESS_TOKEN], ["TIKTOK_SHOP_CIPHER", env.TIKTOK_SHOP_CIPHER],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`TikTok secrets not configured: ${missing.join(", ")}`);
}

export async function syncTikTok(env: BiEnv, days = 7) {
  await ensureBiSchema(env.DB);
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  await env.DB.prepare("INSERT INTO sync_runs (id,source,status,started_at) VALUES (?,'tiktok','running',?)").bind(id, startedAt).run();
  try {
    validateConfig(env);
    const toSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = toSeconds - Math.min(Math.max(days, 1), 90) * 86_400;
    const orders = await fetchOrders(env, fromSeconds, toSeconds);
    const ordersUpserted = await upsertOrders(env, orders);
    const returns = await fetchReturns(env, fromSeconds, toSeconds);
    const returnsUpserted = await upsertReturns(env, returns);
    const pendingFinance = await env.DB.prepare(`SELECT DISTINCT order_id AS orderId FROM sales_lines
      WHERE financial_net_sales IS NULL ORDER BY ordered_at DESC LIMIT 5`).all<{ orderId: string }>();
    let financeWarnings = 0;
    for (const { orderId } of pendingFinance.results) {
      try { await applyFinance(env, orderId); }
      catch { financeWarnings += 1; }
    }
    const message = `Synced ${orders.length} orders and ${returns.length} returns${financeWarnings ? `; ${financeWarnings} finance records pending` : ""}`;
    await env.DB.prepare(`UPDATE sync_runs SET status='success', orders_upserted=?, returns_upserted=?,
      message=?, completed_at=? WHERE id=?`).bind(ordersUpserted, returnsUpserted, message, Date.now(), id).run();
    return { id, ordersUpserted, returnsUpserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TikTok sync failed";
    await env.DB.prepare("UPDATE sync_runs SET status='failed', message=?, completed_at=? WHERE id=?").bind(message, Date.now(), id).run();
    throw error;
  }
}

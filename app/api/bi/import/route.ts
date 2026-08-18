import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { ensureBiSchema } from "../../../../lib/bi";
import { parseCsv } from "../../../../lib/csv";

const KINDS = new Set(["product_cost", "agency_fee_rules", "return_shipping_cost", "manual_costs", "video_agency_fee", "live_agency_fee"]);
const FEE_CATEGORIES = new Set(["VIDEO_AGENCY", "LIVE_AGENCY", "CREATOR_RETAINER", "CREATOR_BONUS", "OTHER"]);
const SCOPE_TYPES = new Set(["ALL", "SKU", "PRODUCT", "CREATOR", "CONTENT_TYPE"]);
const METHODS = new Set(["PERCENT_GMV", "PERCENT_NET_REVENUE", "PERCENT_AFFILIATE_GMV", "PERCENT_LIVE_GMV", "FIXED_PER_ORDER", "FIXED_PER_UNIT", "FIXED_MONTHLY", "FIXED_DAILY"]);

function requiredDate(value: unknown, label: string, row: number) {
  const result = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`第 ${row} 行格式错误：${label} 需要 YYYY-MM-DD`);
  return result;
}

function optionalDate(value: unknown, label: string, row: number) {
  const result = String(value || "").trim();
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`第 ${row} 行格式错误：${label} 需要 YYYY-MM-DD 或留空`);
  return result || null;
}

function nonNegative(value: unknown, label: string, row: number) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`第 ${row} 行格式错误：${label} 必须是非负数字`);
  return result;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const runtime = env;
  try {
    const data = await request.formData();
    const kind = String(data.get("kind") || "");
    const file = data.get("file");
    if (!KINDS.has(kind)) throw new Error("不支持的模板类型");
    if (!(file instanceof File)) throw new Error("请选择 CSV 文件");
    if (file.size > 2_000_000) throw new Error("CSV 文件不能超过 2 MB");
    if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("请上传对应页面下载的 CSV；Excel 工作簿导入将在页面中按 Sheet 自动拆分。");
    const rows = parseCsv(await file.text());
    if (!rows.length) throw new Error("模板中没有数据行");
    if (rows.length > 2_000) throw new Error("单次最多导入 2,000 行，请拆分后重试");
    await ensureBiSchema(runtime.DB);
    const importId = crypto.randomUUID();
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    if (kind === "product_cost") {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const line = index + 2;
        const sku = String(row.seller_sku || row.sku || "").trim();
        if (!sku) throw new Error(`第 ${line} 行格式错误：Seller SKU 不能为空`);
        const effectiveFrom = requiredDate(row.effective_start_date || row.effective_from || row.effective_date, "Effective Start Date", line);
        const effectiveTo = optionalDate(row.effective_end_date || row.effective_to, "Effective End Date", line);
        if (effectiveTo && effectiveTo < effectiveFrom) throw new Error(`第 ${line} 行格式错误：结束日期不能早于开始日期`);
        const productCost = nonNegative(row.unit_cost || row.product_cost || row.cost, "Unit Cost", line);
        statements.push(runtime.DB.prepare(`INSERT INTO product_cost_rules
          (id,seller_sku,product_name,unit_cost,effective_from,effective_to,notes,import_id,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(seller_sku,effective_from) DO UPDATE SET product_name=excluded.product_name,
          unit_cost=excluded.unit_cost,effective_to=excluded.effective_to,notes=excluded.notes,import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${sku}:${effectiveFrom}`, sku, String(row.product_name || ""), productCost, effectiveFrom, effectiveTo, String(row.notes || ""), importId, now));
      }
    } else if (kind === "agency_fee_rules") {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]; const line = index + 2;
        const feeName = String(row.fee_name || "").trim();
        const category = String(row.fee_category || "").trim().toUpperCase();
        const scopeType = String(row.scope_type || "ALL").trim().toUpperCase();
        const scopeValue = String(row.scope_value || "ALL").trim();
        const method = String(row.calculation_method || "").trim().toUpperCase();
        if (!feeName || !FEE_CATEGORIES.has(category) || !SCOPE_TYPES.has(scopeType) || !METHODS.has(method)) throw new Error(`第 ${line} 行格式错误：请检查 Fee Name、Fee Category、Scope Type、Calculation Method`);
        const rawRate = String(row.rate_amount || row.rate || row.amount || "").trim();
        let rate = nonNegative(rawRate.replace("%", ""), "Rate / Amount", line);
        if (rawRate.includes("%") || method.startsWith("PERCENT_")) rate /= 100;
        const effectiveFrom = requiredDate(row.effective_start_date || row.effective_from, "Effective Start Date", line);
        const effectiveTo = optionalDate(row.effective_end_date || row.effective_to, "Effective End Date", line);
        statements.push(runtime.DB.prepare(`INSERT INTO agency_fee_rules
          (id,fee_name,fee_category,scope_type,scope_value,calculation_method,rate_amount,effective_from,effective_to,notes,import_id,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fee_name=excluded.fee_name,fee_category=excluded.fee_category,
          scope_type=excluded.scope_type,scope_value=excluded.scope_value,calculation_method=excluded.calculation_method,
          rate_amount=excluded.rate_amount,effective_to=excluded.effective_to,notes=excluded.notes,import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${feeName}:${effectiveFrom}:${scopeType}:${scopeValue}`, feeName, category, scopeType, scopeValue, method, rate, effectiveFrom, effectiveTo, String(row.notes || ""), importId, now));
      }
    } else if (kind === "return_shipping_cost") {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]; const line = index + 2;
        const sku = String(row.seller_sku || row.sku || "ALL").trim();
        const cost = nonNegative(row.return_shipping_cost_per_unit || row.cost_per_unit || row.amount, "Return Shipping Cost Per Unit", line);
        const effectiveFrom = requiredDate(row.effective_start_date || row.effective_from, "Effective Start Date", line);
        const effectiveTo = optionalDate(row.effective_end_date || row.effective_to, "Effective End Date", line);
        statements.push(runtime.DB.prepare(`INSERT INTO return_shipping_rules
          (id,seller_sku,cost_per_unit,effective_from,effective_to,import_id,updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(seller_sku,effective_from) DO UPDATE SET cost_per_unit=excluded.cost_per_unit,effective_to=excluded.effective_to,
          import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${sku}:${effectiveFrom}`, sku, cost, effectiveFrom, effectiveTo, importId, now));
      }
    } else if (kind === "manual_costs") {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]; const line = index + 2;
        const period = String(row.date_month || row.date || row.month || row.period || "").trim();
        if (!/^\d{4}-\d{2}(-\d{2})?$/.test(period)) throw new Error(`第 ${line} 行格式错误：Date / Month 需要 YYYY-MM 或 YYYY-MM-DD`);
        const category = String(row.cost_category || row.category || "OTHER").trim().toUpperCase();
        const sku = String(row.sku_all || row.seller_sku || row.sku || "ALL").trim();
        const amount = nonNegative(row.amount, "Amount", line);
        statements.push(runtime.DB.prepare(`INSERT INTO manual_costs (id,period,cost_category,seller_sku,amount,notes,import_id,updated_at)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,notes=excluded.notes,import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${period}:${category}:${sku}`, period, category, sku, amount, String(row.notes || ""), importId, now));
      }
    } else {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const month = String(row.month || row.period || "").trim();
        const amount = Number(row.amount || row[kind] || row.fee);
        if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) {
          throw new Error(`第 ${index + 2} 行格式错误：需要 month (YYYY-MM)、amount`);
        }
        statements.push(runtime.DB.prepare(`INSERT INTO period_expenses (id,month,kind,amount,currency,import_id,updated_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(month,kind) DO UPDATE SET amount=excluded.amount,
          currency=excluded.currency,import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${month}:${kind}`, month, kind, amount, String(row.currency || "USD"), importId, now));
      }
    }
    for (let offset = 0; offset < statements.length; offset += 50) {
      await runtime.DB.batch(statements.slice(offset, offset + 50));
    }
    await runtime.DB.prepare("INSERT INTO import_runs (id,kind,filename,row_count,imported_by,created_at) VALUES (?,?,?,?,?,?)")
      .bind(importId, kind, file.name, rows.length, session.email, now).run();
    return NextResponse.json({ ok: true, rows: rows.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 });
  }
}

import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { ensureBiSchema } from "../../../../lib/bi";
import { parseCsv } from "../../../../lib/csv";

const KINDS = new Set(["product_cost", "video_agency_fee", "live_agency_fee"]);

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
    if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("目前只接受 CSV 模板");
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
        const sku = String(row.sku || row.seller_sku || "").trim();
        const effectiveFrom = String(row.effective_from || row.effective_date || "").trim();
        const productCost = Number(row.product_cost || row.cost);
        if (!sku || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || !Number.isFinite(productCost) || productCost < 0) {
          throw new Error(`第 ${index + 2} 行格式错误：需要 sku、effective_from (YYYY-MM-DD)、product_cost`);
        }
        statements.push(runtime.DB.prepare(`INSERT INTO sku_costs (id,sku,effective_from,product_cost,currency,import_id,updated_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(sku,effective_from) DO UPDATE SET product_cost=excluded.product_cost,
          currency=excluded.currency,import_id=excluded.import_id,updated_at=excluded.updated_at`)
          .bind(`${sku}:${effectiveFrom}`, sku, effectiveFrom, productCost, String(row.currency || "USD"), importId, now));
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

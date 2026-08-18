import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { ensureBiSchema } from "../../../../lib/bi";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await ensureBiSchema(env.DB);
  const [products, agencies] = await Promise.all([
    env.DB.prepare("SELECT id,seller_sku AS sku,product_name AS productName,unit_cost AS unitCost,effective_from AS startDate,effective_to AS endDate FROM product_cost_rules ORDER BY effective_from DESC").all(),
    env.DB.prepare("SELECT id,fee_name AS agency,fee_category AS type,calculation_method AS method,rate_amount AS rate,effective_from AS startDate,effective_to AS endDate FROM agency_fee_rules ORDER BY effective_from DESC").all(),
  ]);
  return NextResponse.json({ products: products.results, agencies: agencies.results });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensureBiSchema(env.DB);
  const body = await request.json() as Record<string, string | number | null>;
  const kind = String(body.kind || ""); const start = String(body.startDate || ""); const end = body.endDate ? String(body.endDate) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) || (end && end < start)) return NextResponse.json({ error: "日期无效" }, { status: 400 });
  if (kind === "product") {
    const sku = String(body.sku || "").trim(); const cost = Number(body.unitCost);
    if (!sku || !Number.isFinite(cost) || cost < 0) return NextResponse.json({ error: "SKU 和 Unit Cost 必填" }, { status: 400 });
    await env.DB.prepare(`INSERT INTO product_cost_rules (id,seller_sku,product_name,unit_cost,effective_from,effective_to,notes,updated_at)
      VALUES (?,?,?,?,?,?,'Website editor',?) ON CONFLICT(seller_sku,effective_from) DO UPDATE SET product_name=excluded.product_name,unit_cost=excluded.unit_cost,effective_to=excluded.effective_to,updated_at=excluded.updated_at`)
      .bind(`${sku}:${start}`, sku, String(body.productName || ""), cost, start, end, Date.now()).run();
  } else if (kind === "agency") {
    const agency = String(body.agency || "").trim(); const type = String(body.type || "OTHER"); const method = String(body.method || "FIXED_MONTHLY"); let rate = Number(body.rate);
    if (!agency || !Number.isFinite(rate) || rate < 0) return NextResponse.json({ error: "Agency 和 Rate/Amount 必填" }, { status: 400 });
    if (method.startsWith("PERCENT_")) rate /= 100;
    await env.DB.prepare(`INSERT INTO agency_fee_rules (id,fee_name,fee_category,scope_type,scope_value,calculation_method,rate_amount,effective_from,effective_to,notes,updated_at)
      VALUES (?,?,?,'ALL','ALL',?,?,?,?, 'Website editor',?) ON CONFLICT(id) DO UPDATE SET fee_category=excluded.fee_category,calculation_method=excluded.calculation_method,rate_amount=excluded.rate_amount,effective_to=excluded.effective_to,updated_at=excluded.updated_at`)
      .bind(`${agency}:${start}:ALL:ALL`, agency, type, method, rate, start, end, Date.now()).run();
  } else return NextResponse.json({ error: "Unsupported cost kind" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

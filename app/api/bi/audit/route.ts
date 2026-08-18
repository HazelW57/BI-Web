import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { ensureBiSchema } from "../../../../lib/bi";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensureBiSchema(env.DB);
  const [months, statuses, sample, finance, components, coverage, gmvCandidates] = await Promise.all([
    env.DB.prepare(`SELECT substr(datetime(ordered_at/1000,'unixepoch'),1,7) AS month,
      COUNT(DISTINCT order_id) AS orders,COUNT(*) AS lines,SUM(gross_sales) AS storedGross,
      SUM(seller_discount) AS storedDiscount
      FROM sales_lines GROUP BY month ORDER BY month`).all(),
    env.DB.prepare(`SELECT order_status AS status,COUNT(DISTINCT order_id) AS orders,SUM(gross_sales) AS gross
      FROM sales_lines GROUP BY order_status ORDER BY orders DESC`).all(),
    env.DB.prepare(`SELECT id,json_extract(raw_json,'$.payment.total_amount') AS totalAmount,
      json_extract(raw_json,'$.payment.original_total_product_price') AS originalProduct,
      json_extract(raw_json,'$.payment.sub_total') AS subTotal,
      json_extract(raw_json,'$.payment.seller_discount') AS sellerDiscount,
      substr(raw_json,1,1200) AS raw FROM raw_orders ORDER BY ordered_at DESC LIMIT 3`).all(),
    env.DB.prepare(`SELECT finance_status AS status,COUNT(*) AS transactions,COUNT(DISTINCT order_id) AS orders,
      SUM(revenue_amount) AS revenue,SUM(fee_tax_amount) AS feeTax,SUM(shipping_cost_amount) AS shipping,
      SUM(adjustment_amount) AS adjustments,SUM(settlement_amount) AS settlement,SUM(unmapped_difference) AS unmapped
      FROM finance_transactions GROUP BY finance_status`).all(),
    env.DB.prepare(`SELECT category,COUNT(*) AS entries,SUM(amount) AS amount FROM finance_components GROUP BY category ORDER BY ABS(SUM(amount)) DESC`).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT s.order_id) AS validOrders,
      COUNT(DISTINCT CASE WHEN f.order_id IS NOT NULL THEN s.order_id END) AS financeOrders
      FROM sales_lines s LEFT JOIN finance_transactions f ON f.order_id=s.order_id
      WHERE s.order_status NOT LIKE '%CANCEL%' AND s.order_status NOT LIKE '%UNPAID%'`).first(),
    env.DB.prepare(`SELECT
      SUM(CAST(json_extract(r.raw_json,'$.payment.original_total_product_price') AS REAL)-CAST(json_extract(r.raw_json,'$.payment.seller_discount') AS REAL)) AS sellerFundedGmv,
      SUM(CAST(json_extract(r.raw_json,'$.payment.sub_total') AS REAL)) AS buyerProductSubtotal,
      SUM(CAST(json_extract(r.raw_json,'$.payment.total_amount') AS REAL)) AS buyerPaidWithTaxShipping,
      SUM(CAST(json_extract(r.raw_json,'$.payment.original_total_product_price') AS REAL)) AS originalProductValue
      FROM raw_orders r WHERE EXISTS (SELECT 1 FROM sales_lines s WHERE s.order_id=r.id
      AND s.order_status NOT LIKE '%CANCEL%' AND s.order_status NOT LIKE '%UNPAID%')`).first(),
  ]);
  return NextResponse.json({ months: months.results, statuses: statuses.results, sample: sample.results,
    finance: finance.results, components: components.results, coverage, gmvCandidates });
}

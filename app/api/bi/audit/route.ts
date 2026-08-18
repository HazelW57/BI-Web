import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { ensureBiSchema } from "../../../../lib/bi";

export async function GET() {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await ensureBiSchema(env.DB);
  const [months, statuses, sample] = await Promise.all([
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
  ]);
  return NextResponse.json({ months: months.results, statuses: statuses.results, sample: sample.results });
}

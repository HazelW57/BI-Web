import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession } from "../../../auth";
import { getPnlSnapshot } from "../../../../lib/bi";

export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json(await getPnlSnapshot(env.DB, {
    from: url.searchParams.get("from"), to: url.searchParams.get("to"),
    granularity: url.searchParams.get("granularity"), product: url.searchParams.get("product"), sku: url.searchParams.get("sku"),
  }));
}

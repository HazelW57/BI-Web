import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession } from "../../../auth";
import { getPnlSnapshot } from "../../../../lib/bi";

export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json(await getPnlSnapshot(env.DB, url.searchParams.get("from"), url.searchParams.get("to")));
}

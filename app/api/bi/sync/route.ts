import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { getSyncStatus } from "../../../../lib/bi";
import { syncFinanceBatch, syncTikTok, syncTikTokWindow } from "../../../../lib/tiktok";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getSyncStatus(env));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { mode?: string; limit?: number; days?: number; from?: string; to?: string; financeOffset?: number };
  try {
    if (body.mode === "finance") return NextResponse.json(await syncFinanceBatch(env, Number(body.limit) || 25));
    if (body.from && body.to) return NextResponse.json(await syncTikTokWindow(env, body.from, body.to, Number(body.financeOffset) || 0));
    return NextResponse.json(await syncTikTok(env, Number(body.days) || 7));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}

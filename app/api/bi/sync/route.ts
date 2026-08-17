import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession, isAdmin } from "../../../auth";
import { getSyncStatus } from "../../../../lib/bi";
import { syncTikTok } from "../../../../lib/tiktok";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getSyncStatus(env));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { days?: number };
  try {
    return NextResponse.json(await syncTikTok(env, Number(body.days) || 7));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}

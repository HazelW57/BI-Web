import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getSession } from "../../../auth";
import { getReturnsSnapshot } from "../../../../lib/bi";

export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const response=NextResponse.json(await getReturnsSnapshot(env.DB, {
      from: url.searchParams.get("from"), to: url.searchParams.get("to"), granularity: url.searchParams.get("granularity"),
      product: url.searchParams.get("product"), sku: url.searchParams.get("sku"),
      returnType: url.searchParams.get("returnType"), returnStatus: url.searchParams.get("returnStatus"),
    }));
    response.headers.set("Cache-Control","private, no-store, max-age=0");
    return response;
  } catch(error) {
    console.error("TTS R&R read failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"TTS R&R unavailable"},{status:500});
  }
}

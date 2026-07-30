import { NextResponse } from "next/server";
import { authenticate, setSession } from "../../auth";

export async function POST(request: Request) {
  const { email, password } = await request.json() as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  const session = await authenticate(email, password);
  if (!session) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  await setSession(session);
  return NextResponse.json({ ok: true });
}

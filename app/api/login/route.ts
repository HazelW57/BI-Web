import { NextResponse } from "next/server";
import { authenticate, setSession } from "../../auth";

export async function POST(request: Request) {
  const formRequest = request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ?? false;
  const credentials = formRequest
    ? Object.fromEntries(await request.formData())
    : await request.json() as Record<string, FormDataEntryValue>;
  const email = typeof credentials.email === "string" ? credentials.email : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!email || !password) {
    if (formRequest) return NextResponse.redirect(new URL("/?error=missing", request.url), 303);
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }
  try {
    const session = await authenticate(email, password);
    if (!session) {
      if (formRequest) return NextResponse.redirect(new URL("/?error=invalid", request.url), 303);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    await setSession(session);
    if (formRequest) return NextResponse.redirect(new URL("/portal", request.url), 303);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Authentication initialization failed", error instanceof Error ? error.message : String(error));
    if (formRequest) return NextResponse.redirect(new URL("/?error=unavailable", request.url), 303);
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
}

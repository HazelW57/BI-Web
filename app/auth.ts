import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const PRIMARY_ADMIN_EMAIL = "hazel.w@saphiant.com";
const RECOVERY_ADMIN_EMAIL = "hazel.hanyu.w@outlook.com";
const COOKIE_NAME = "saphiant_session";
const encoder = new TextEncoder();

type Role = "owner" | "recovery" | "viewer";
export type Session = { email: string; role: Role; exp: number };
export type VisibleUser = { email: string; role: Role; createdAt: number };

function runtime() {
  return env as unknown as { DB: D1Database; SESSION_SECRET: string; PRIMARY_BOOTSTRAP_PASSWORD: string; PRIMARY_PASSWORD_VERSION?: string; RECOVERY_BOOTSTRAP_PASSWORD: string };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toUrlBase64(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlBase64(value: string) {
  return fromBase64(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
}

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const pepperedPassword = `${password}\u0000${runtime().SESSION_SECRET}`;
  const material = await crypto.subtle.importKey("raw", encoder.encode(pepperedPassword), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, material, 256);
  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt) };
}

async function verifyPassword(password: string, expected: string, salt: string) {
  const actual = await hashPassword(password, fromBase64(salt));
  const left = fromBase64(actual.hash); const right = fromBase64(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0; left.forEach((byte, index) => mismatch |= byte ^ right[index]);
  return mismatch === 0;
}

async function ensureAuth() {
  const { DB, PRIMARY_BOOTSTRAP_PASSWORD, RECOVERY_BOOTSTRAP_PASSWORD } = runtime();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS auth_users (
    email TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
    role TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`).run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const admins = [
    [PRIMARY_ADMIN_EMAIL, "owner", 0, PRIMARY_BOOTSTRAP_PASSWORD],
    [RECOVERY_ADMIN_EMAIL, "recovery", 1, RECOVERY_BOOTSTRAP_PASSWORD],
  ] as const;
  for (const [email, role, hidden, password] of admins) {
    const exists = await DB.prepare("SELECT email FROM auth_users WHERE email = ?").bind(email).first();
    if (!exists) {
      if (!password) throw new Error("Bootstrap password is not configured");
      const credential = await hashPassword(password);
      const now = Date.now();
      await DB.prepare("INSERT INTO auth_users (email,password_hash,salt,role,hidden,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(email, credential.hash, credential.salt, role, hidden, now, now).run();
    }
  }
  const passwordVersion = runtime().PRIMARY_PASSWORD_VERSION;
  if (passwordVersion) {
    const applied = await DB.prepare("SELECT value FROM app_settings WHERE key = 'primary_password_version'").first<{value:string}>();
    if (applied?.value !== passwordVersion) {
      const credential = await hashPassword(PRIMARY_BOOTSTRAP_PASSWORD);
      await DB.prepare("UPDATE auth_users SET password_hash=?, salt=?, updated_at=? WHERE email=?")
        .bind(credential.hash, credential.salt, Date.now(), PRIMARY_ADMIN_EMAIL).run();
      await DB.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('primary_password_version',?)").bind(passwordVersion).run();
    }
  }
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(runtime().SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function authenticate(email: string, password: string): Promise<Session | null> {
  await ensureAuth();
  const normalized = email.trim().toLowerCase();
  const row = await runtime().DB.prepare("SELECT email,password_hash AS passwordHash,salt,role FROM auth_users WHERE email = ?").bind(normalized).first<{email:string;passwordHash:string;salt:string;role:Role}>();
  if (!row || !(await verifyPassword(password, row.passwordHash, row.salt))) return null;
  return { email: row.email, role: row.role, exp: Date.now() + 8 * 60 * 60 * 1000 };
}

export async function setSession(session: Session) {
  const body = toUrlBase64(encoder.encode(JSON.stringify(session)));
  const signature = toUrlBase64(await sign(body));
  (await cookies()).set(COOKIE_NAME, `${body}.${signature}`, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = await sign(body); const actual = fromUrlBase64(signature);
  if (expected.length !== actual.length) return null;
  let mismatch = 0; expected.forEach((byte, index) => mismatch |= byte ^ actual[index]);
  if (mismatch) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromUrlBase64(body))) as Session;
    return session.exp > Date.now() ? session : null;
  } catch { return null; }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/");
  return session;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export function isAdmin(session: Session) { return session.role === "owner" || session.role === "recovery"; }

export async function listVisibleUsers(): Promise<VisibleUser[]> {
  await ensureAuth();
  const result = await runtime().DB.prepare("SELECT email,role,created_at AS createdAt FROM auth_users WHERE hidden = 0 ORDER BY created_at ASC").all<VisibleUser>();
  return result.results;
}

export async function addUser(email: string, password: string) {
  await ensureAuth();
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("请输入有效邮箱");
  if (password.length < 10) throw new Error("临时密码至少需要 10 位");
  if (normalized === PRIMARY_ADMIN_EMAIL || normalized === RECOVERY_ADMIN_EMAIL) throw new Error("管理员账户不可覆盖");
  const credential = await hashPassword(password); const now = Date.now();
  await runtime().DB.prepare(`INSERT INTO auth_users (email,password_hash,salt,role,hidden,created_at,updated_at)
    VALUES (?,?,?,'viewer',0,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,updated_at=excluded.updated_at`)
    .bind(normalized, credential.hash, credential.salt, now, now).run();
}

export async function removeUser(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized === PRIMARY_ADMIN_EMAIL || normalized === RECOVERY_ADMIN_EMAIL) throw new Error("管理员账户不可删除");
  await runtime().DB.prepare("DELETE FROM auth_users WHERE email = ? AND hidden = 0").bind(normalized).run();
}

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the Saphiant login surface and compiled worker", async () => {
  const [layout, login] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);
  assert.match(layout, /Saphiant Commerce BI/);
  assert.match(login, /SAP BI/);
  assert.match(login, /登录 BI 系统/);
  assert.doesNotMatch(`${layout}\n${login}`, /Codex is working|Your site is taking shape/);
});

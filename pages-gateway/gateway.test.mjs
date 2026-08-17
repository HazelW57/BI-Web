import assert from "node:assert/strict";
import test from "node:test";

import gateway from "./dist/_worker.js";

test("forwards the original request through the BI_WEB service binding", async () => {
  const request = new Request("https://bi.saphiant.com/api/bi/pnl?month=2026-08");
  let forwardedRequest;
  const response = await gateway.fetch(request, {
    BI_WEB: {
      async fetch(nextRequest) {
        forwardedRequest = nextRequest;
        return new Response("ok", { status: 202 });
      },
    },
  });

  assert.equal(forwardedRequest, request);
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "ok");
});

test("returns a non-cacheable diagnostic when the binding is missing", async () => {
  const response = await gateway.fetch(new Request("https://bi.saphiant.com/"), {});

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /BI service binding is unavailable/);
});

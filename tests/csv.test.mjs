import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../lib/csv.ts";

test("parses quoted CSV cells and normalized headers", () => {
  const rows = parseCsv('SKU,Effective From,Product Cost\n"ABC,1",2026-08-01,12.50\n');
  assert.deepEqual(rows, [{ sku: "ABC,1", effective_from: "2026-08-01", product_cost: "12.50" }]);
});

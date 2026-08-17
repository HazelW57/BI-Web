import assert from "node:assert/strict";
import test from "node:test";
import { calculatePnl, calculateReturns } from "../lib/bi.ts";

const timestamp = Date.parse("2026-08-10T12:00:00Z");
const base = {
  productName: "Product", currency: "USD", orderStatus: "COMPLETED", orderedAt: timestamp,
  sellerDiscount: 0, refundAmount: 0, shippingRevenue: 0, financialNetSales: null,
  platformFee: 0, affiliateCommission: 0, shippingCost: 0, settlementAmount: null,
};
const sales = [
  { ...base, orderId: "1", lineItemId: "1", sku: "SKU-A", quantity: 2, grossSales: 100 },
  { ...base, orderId: "2", lineItemId: "2", sku: "SKU-B", quantity: 1, grossSales: 100 },
];

test("calculates P&L and allocates monthly agency fees by revenue share", () => {
  const result = calculatePnl(sales, [
    { sku: "SKU-A", effectiveFrom: "2026-08-01", productCost: 10 },
    { sku: "SKU-B", effectiveFrom: "2026-08-01", productCost: 20 },
  ], [
    { month: "2026-08", kind: "video_agency_fee", amount: 30 },
    { month: "2026-08", kind: "live_agency_fee", amount: 20 },
  ]);
  assert.equal(result.total.revenue, 200);
  assert.equal(result.total.cogs, 40);
  assert.equal(result.total.agencyFees, 50);
  assert.equal(result.total.operatingProfit, 110);
  assert.equal(result.total.margin, 55);
  assert.equal(result.skus.find((row) => row.key === "SKU-A").agencyFees, 25);
  assert.equal(result.skus.find((row) => row.key === "SKU-B").agencyFees, 25);
});

test("calculates return rate and reason share by SKU", () => {
  const result = calculateReturns(sales, [
    { returnId: "R1", sku: "SKU-A", reason: "Defective", quantity: 1, status: "REQUEST_COMPLETE", requestedAt: timestamp },
    { returnId: "R2", sku: "SKU-B", reason: "Broken", quantity: 1, status: "REQUEST_COMPLETE", requestedAt: timestamp },
    { returnId: "R3", sku: "SKU-B", reason: "Changed mind", quantity: 1, status: "REQUEST_REJECTED", requestedAt: timestamp },
  ]);
  assert.equal(result.soldUnits, 3);
  assert.equal(result.returnedUnits, 2);
  assert.equal(result.returnRate, 66.67);
  assert.equal(result.skus.find((row) => row.sku === "SKU-A").reasons[0].share, 100);
});

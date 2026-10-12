import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assertCouponReceiptIntegrity } from "./coupon-receipt.js";

test("receipt integrity accepts jsonb key order and rejects altered values, array order or hash", () => {
  const payload = { action: "coupon", entitlements: [{ amount: "500", investor: "a" }, { amount: "1000", investor: "b" }] };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const draft = { payload, hash };
  const receipt = { payloadHash: Buffer.from(hash, "hex"), payloadJson: { entitlements: [{ investor: "a", amount: "500" }, { investor: "b", amount: "1000" }], action: "coupon" } };
  assert.doesNotThrow(() => assertCouponReceiptIntegrity(receipt, draft));
  for (const changed of [ { ...receipt, payloadHash: Buffer.alloc(32) },
    { ...receipt, payloadJson: { ...payload, action: "other" } },
    { ...receipt, payloadJson: { ...payload, entitlements: [...payload.entitlements].reverse() } } ]) {
    assert.throws(() => assertCouponReceiptIntegrity(changed, draft), { code: "RECEIPT_INTEGRITY" });
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSettlementLegs, type SettlementLegInput } from "./settlement-legs.js";

const cash: SettlementLegInput = {
  type: "CASH",
  status: "CONFIRMED",
  expectedAmountMinor: 500_000_000n,
  actualAmountMinor: 500_000_000n
};
const notApplicableAsset: SettlementLegInput = {
  type: "ASSET",
  status: "NOT_APPLICABLE",
  expectedAmountMinor: 0n,
  actualAmountMinor: null
};

test("matches coupon cash with a not-applicable asset leg", () => {
  assert.deepEqual(
    reconcileSettlementLegs("COUPON_PAYMENT", [notApplicableAsset, cash]),
    { status: "MATCHED", reason: "REQUIRED_LEGS_CONFIRMED" }
  );
});

test("redemption waits for burn and rejects mismatched amounts", () => {
  assert.deepEqual(
    reconcileSettlementLegs("BOND_REDEMPTION", [
      cash,
      { type: "ASSET", status: "SUBMITTED", expectedAmountMinor: 10n, actualAmountMinor: null }
    ]),
    { status: "PENDING", reason: "ASSET_LEG_NOT_CONFIRMED" }
  );
  assert.deepEqual(
    reconcileSettlementLegs("EARLY_REDEMPTION", [
      cash,
      { type: "ASSET", status: "CONFIRMED", expectedAmountMinor: 10n, actualAmountMinor: 9n }
    ]),
    { status: "MISMATCH", reason: "ASSET_AMOUNT_MISMATCH" }
  );
});

test("requires one cash and one asset leg", () => {
  assert.throws(
    () => reconcileSettlementLegs("COUPON_PAYMENT", [cash, cash]),
    /one CASH and one ASSET/
  );
  assert.deepEqual(
    reconcileSettlementLegs("BOND_REDEMPTION", [cash, notApplicableAsset]),
    { status: "MISMATCH", reason: "REDEMPTION_REQUIRES_ASSET_LEG" }
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { requireAtomicRedemptionSettlement } from "./redemption-receipt.js";

test("redemption receipt requires one finalized atomic transaction proving both required settlement legs", () => {
  const action = { id: "action", type: "EARLY_REDEMPTION" as const };
  const row = { id: "entitlement", amountMinor: 2_000_000n, tokensToRedeem: 2n, settlementSignature: "signature", burnSignature: "signature" };
  const op = { id: "op", signature: "signature", status: "FINALIZED", operationType: "REDEMPTION_PAYMENT", entitlementId: row.id, corporateActionId: action.id, networkGenesisHash: "genesis" };
  const settlement = { amountMinor: row.amountMinor, actualAmountMinor: row.amountMinor, status: "FINALIZED", reconciliationStatus: "MATCHED", legs: [
    { type: "CASH", required: true, status: "CONFIRMED", expectedAmountMinor: row.amountMinor, actualAmountMinor: row.amountMinor, blockchainTransactionId: op.id, blockchainTransaction: op },
    { type: "ASSET", required: true, status: "CONFIRMED", expectedAmountMinor: 2n, actualAmountMinor: 2n, blockchainTransactionId: op.id, blockchainTransaction: op }
  ] };
  assert.equal(requireAtomicRedemptionSettlement(action, "genesis", row, settlement as never).id, "op");
  const reject = (changed: typeof settlement) => assert.throws(() => requireAtomicRedemptionSettlement(action, "genesis", row, changed as never), { code: "RECONCILIATION_REQUIRED" });
  reject({ ...settlement, status: "PENDING" });
  reject({ ...settlement, legs: [settlement.legs[0]!, { ...settlement.legs[1]!, required: false, status: "NOT_APPLICABLE" }] });
  reject({ ...settlement, legs: [settlement.legs[0]!, { ...settlement.legs[1]!, blockchainTransactionId: "another-op" }] });
  reject({ ...settlement, legs: [settlement.legs[0]!, { ...settlement.legs[1]!, actualAmountMinor: 1n }] });
  reject({ ...settlement, legs: [{ ...settlement.legs[0]!, blockchainTransaction: { ...op, networkGenesisHash: "foreign" } }, settlement.legs[1]!] });
  assert.throws(() => requireAtomicRedemptionSettlement(action, "genesis", { ...row, burnSignature: "different" }, settlement as never));
  assert.throws(() => requireAtomicRedemptionSettlement({ ...action, type: "COUPON_PAYMENT" }, "genesis", row, settlement as never));
});

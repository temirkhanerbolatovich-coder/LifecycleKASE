import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildCouponExecution, buildCouponFinalization, decodeEntitlementReceipt, decodeActionReceipt,
  ENTITLEMENT_RECEIPT_BYTES, ACTION_RECEIPT_BYTES } from "./coupon-execution.js";
import { decodePublicKey, encodePublicKey } from "./base58.js";
const key = (n: number) => encodePublicKey(new Uint8Array(32).fill(n));
const identity = { programId: key(1), instrumentId: new Uint8Array(16).fill(2), actionId: new Uint8Array(16).fill(3), corporateActionAuthority: key(4) };
test("coupon plan binds recipient and entitlement; its receipt remains the same across idempotency keys", async () => {
  const input = { ...identity, investorId: new Uint8Array(16).fill(5), settlementMint: key(6), settlementWallet: key(7), idempotencyHash: "ab".repeat(32) };
  const a = await buildCouponExecution(input); const b = await buildCouponExecution({ ...input, idempotencyHash: "cd".repeat(32) });
  assert.equal(a.entitlementReceiptAddress, b.entitlementReceiptAddress);
  assert.notDeepEqual(a.instruction.data, b.instruction.data);
  assert.equal(a.instructions.length, 2); assert.equal(a.instruction.accounts[8]!.address, a.recipientAddress);
  assert.equal(a.instruction.accounts.filter(value => value.isSigner).length, 1);
  const other = await buildCouponExecution({ ...input, investorId: new Uint8Array(16).fill(9) });
  assert.notEqual(a.entitlementReceiptAddress, other.entitlementReceiptAddress);
  await assert.rejects(buildCouponExecution({ ...input, idempotencyHash: "00".repeat(32) }));
});
test("finalization rejects duplicate or absent investors and a zero commitment", async () => {
  const investor = new Uint8Array(16).fill(9);
  for (const investorIds of [[], [investor, investor]]) await assert.rejects(buildCouponFinalization({ ...identity, investorIds, receiptHash: "ab".repeat(32) }));
  await assert.rejects(buildCouponFinalization({ ...identity, investorIds: [investor], receiptHash: "00".repeat(32) }));
});
test("receipt decoders preserve exact u64 amounts and reject truncated, foreign or future layouts", () => {
  const entitlement = Buffer.alloc(ENTITLEMENT_RECEIPT_BYTES);
  createHash("sha256").update("account:EntitlementReceipt").digest().copy(entitlement, 0, 0, 8); entitlement[8] = 1;
  Buffer.from(decodePublicKey(key(7))).copy(entitlement, 137);
  entitlement.writeBigUInt64LE(1_750_000_000n, 169); entitlement.writeBigInt64LE(1_800_000_000n, 209);
  assert.equal(decodeEntitlementReceipt(entitlement.toString("base64")).settlementWallet, key(7));
  assert.equal(decodeEntitlementReceipt(entitlement.toString("base64")).amountMinor, 1_750_000_000n);
  const action = Buffer.alloc(ACTION_RECEIPT_BYTES);
  createHash("sha256").update("account:ActionReceipt").digest().copy(action, 0, 0, 8); action[8] = 1;
  action.writeBigUInt64LE(1_750_000_000n, 105); action.writeUInt32LE(3, 113);
  assert.equal(decodeActionReceipt(action.toString("base64")).processedEntitlements, 3);
  assert.throws(() => decodeActionReceipt(entitlement.toString("base64")));
  assert.throws(() => decodeEntitlementReceipt(entitlement.subarray(1).toString("base64")));
  entitlement[8] = 2; assert.throws(() => decodeEntitlementReceipt(entitlement.toString("base64")));
});

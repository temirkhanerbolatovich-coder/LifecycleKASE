import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { decodePublicKey, encodePublicKey } from "./base58.js";
import { buildCalculationFinalization, buildCalculationReset } from "./entitlement-registration.js";
import { buildRedemptionSourceRegistration, buildRedemptionExecution, buildRedemptionFinalization,
  decodeRedemptionSources, decodeRedemptionProgress, decodeRedemptionReceipt, redemptionSourceHash,
  REDEMPTION_SOURCES_BYTES, REDEMPTION_PROGRESS_BYTES, REDEMPTION_RECEIPT_BYTES } from "./redemption-execution.js";

const key = (n: number) => encodePublicKey(new Uint8Array(32).fill(n));
const identity = { programId: key(1), instrumentId: new Uint8Array(16).fill(2), actionId: new Uint8Array(16).fill(3), corporateActionAuthority: key(4) };
const investorId = new Uint8Array(16).fill(5);
const sources = [{ address: key(8), wallet: key(9), balanceAtSnapshot: 3n }, { address: key(6), wallet: key(7), balanceAtSnapshot: 7n }];
const snapshotHash = "ab".repeat(32);
function accountBytes(name: string, size: number) {
  const bytes = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(bytes, 0, 0, 8); bytes[8] = 1;
  return bytes;
}
test("redemption registration fixes canonical wallets and balances before approval", async () => {
  const input = { ...identity, investorId, bondMint: key(10), snapshotHash, tokenAccounts: sources };
  const plan = await buildRedemptionSourceRegistration(input);
  const reversed = await buildRedemptionSourceRegistration({ ...input, tokenAccounts: [...sources].reverse() });
  assert.deepEqual(plan.instruction.data, reversed.instruction.data);
  assert.equal(plan.sourceHash, reversed.sourceHash);
  assert.deepEqual(plan.tokenAccounts.map(value => value.address), [key(6), key(8)]);
  assert.equal(plan.instruction.data.length, 8 + 4 + 2 * 72);
  assert.equal(plan.instruction.accounts[4]!.address, plan.sourceAddress);
  assert.equal(plan.instruction.accounts[5]!.address, plan.progressAddress);
  const changed = await buildRedemptionSourceRegistration({ ...input, tokenAccounts: [{ ...sources[0]!, wallet: key(12) }, sources[1]!] });
  assert.equal(changed.sourceAddress, plan.sourceAddress);
  assert.notEqual(changed.sourceHash, plan.sourceHash);
  for (const tokenAccounts of [[], [sources[0]!, sources[0]!], [{ ...sources[0]!, balanceAtSnapshot: 0n }],
    [{ ...sources[0]!, balanceAtSnapshot: 1n << 64n }]]) await assert.rejects(buildRedemptionSourceRegistration({ ...input, tokenAccounts }));
});
test("atomic plan binds reserve, receipt, PermanentDelegate and every ordered burn source", async () => {
  const input = { ...identity, investorId, bondMint: key(10), settlementMint: key(11), settlementWallet: key(12), idempotencyHash: snapshotHash, tokenAccounts: sources };
  const plan = await buildRedemptionExecution(input);
  assert.equal(plan.instructions.length, 2);
  assert.equal(plan.instruction.data.length, 40);
  assert.equal(plan.instruction.accounts.length, 18);
  assert.equal(plan.instruction.accounts.filter(value => value.isSigner).length, 1);
  assert.equal(plan.instruction.accounts[7]!.address, plan.sourceAddress);
  assert.equal(plan.instruction.accounts[8]!.address, plan.progressAddress);
  assert.equal(plan.instruction.accounts[9]!.address, plan.redemptionReceiptAddress);
  assert.equal(plan.instruction.accounts[12]!.address, input.bondMint);
  assert.equal(plan.instruction.accounts[13]!.address, plan.instrumentAuthority);
  assert.deepEqual(plan.instruction.accounts.slice(16).map(value => value.address), [key(6), key(8)]);
  assert.ok(plan.instruction.accounts.slice(16).every(value => value.isWritable && !value.isSigner));
  const retry = await buildRedemptionExecution({ ...input, idempotencyHash: "cd".repeat(32) });
  assert.equal(retry.redemptionReceiptAddress, plan.redemptionReceiptAddress);
  await assert.rejects(buildRedemptionExecution({ ...input, settlementMint: input.bondMint }));
  await assert.rejects(buildRedemptionExecution({ ...input, idempotencyHash: "00".repeat(32) }));
});
test("calculation finalization and reset cover and close source and progress accounts", async () => {
  const investors = [investorId, new Uint8Array(16).fill(6)];
  const finalization = await buildCalculationFinalization({ ...identity, investorIds: investors, redemption: true });
  const reset = await buildCalculationReset({ ...identity, investorIds: investors, redemption: true });
  assert.equal(finalization.instruction.accounts.length, 8);
  assert.equal(finalization.sourceAddresses.length, 2);
  assert.equal(finalization.instruction.accounts[3]!.address, finalization.progressAddress);
  assert.equal(finalization.instruction.accounts[5]!.address, finalization.sourceAddresses[0]);
  assert.deepEqual(reset.instruction.accounts.slice(3).map(value => value.address), finalization.instruction.accounts.slice(3).map(value => value.address));
  assert.ok(reset.instruction.accounts.every(value => value.isWritable || value.address === reset.instrumentAddress));
  const receipt = await buildRedemptionFinalization({ ...identity, bondMint: key(10), investorIds: investors, receiptHash: snapshotHash });
  assert.equal(receipt.instruction.accounts[1]!.isWritable, true);
  assert.equal(receipt.instruction.accounts[3]!.address, finalization.progressAddress);
  assert.equal(receipt.instruction.accounts.length, 9);
  await assert.rejects(buildRedemptionFinalization({ ...identity, bondMint: key(10), investorIds: [investorId, investorId], receiptHash: snapshotHash }));
});
test("source commitment matches the Rust Borsh/SHA256 vector and detects tampering", () => {
  assert.equal(redemptionSourceHash(key(1), key(2), "03".repeat(32), [{ address: key(4), wallet: key(5), balanceAtSnapshot: 10n }]),
    "ea16e925ea95629b1999977b0e8aa02b52f0c11e08156e2d2ac95e8683a3f137");
  const data = accountBytes("RedemptionSources", REDEMPTION_SOURCES_BYTES);
  Buffer.from(decodePublicKey(key(1))).copy(data, 9); Buffer.from(decodePublicKey(key(2))).copy(data, 41);
  Buffer.from(snapshotHash, "hex").copy(data, 73);
  const source = [{ address: key(4), wallet: key(5), balanceAtSnapshot: 10n }];
  Buffer.from(redemptionSourceHash(key(1), key(2), snapshotHash, source), "hex").copy(data, 105);
  data.writeUInt32LE(1, 137); Buffer.from(decodePublicKey(key(4))).copy(data, 141); Buffer.from(decodePublicKey(key(5))).copy(data, 173);
  data.writeBigUInt64LE(10n, 205); data[213] = 201;
  assert.deepEqual(decodeRedemptionSources(data.toString("base64")).tokenAccounts, source);
  assert.equal(decodeRedemptionSources(data.toString("base64")).bump, 201);
  data[205] = 11; assert.throws(() => decodeRedemptionSources(data.toString("base64")));
});
test("redemption proof decoders verify exact supply deltas and preserve u64 amounts", () => {
  const progress = accountBytes("RedemptionProgress", REDEMPTION_PROGRESS_BYTES);
  progress.writeBigUInt64LE(35n, 73); progress.writeBigUInt64LE(7n, 81); progress.writeUInt32LE(3, 89);
  assert.equal(decodeRedemptionProgress(progress.toString("base64")).tokensRedeemed, 7n);
  progress.writeBigUInt64LE(36n, 81); assert.throws(() => decodeRedemptionProgress(progress.toString("base64")));
  const receipt = accountBytes("RedemptionReceipt", REDEMPTION_RECEIPT_BYTES);
  receipt.writeBigUInt64LE(7_000_000_000n, 169); receipt.writeBigUInt64LE(7n, 281);
  receipt.writeBigUInt64LE(35n, 289); receipt.writeBigUInt64LE(28n, 297);
  assert.equal(decodeRedemptionReceipt(receipt.toString("base64")).amountMinor, 7_000_000_000n);
  assert.equal(decodeRedemptionReceipt(receipt.toString("base64")).mintSupplyAfter, 28n);
  receipt.writeBigUInt64LE(27n, 297); assert.throws(() => decodeRedemptionReceipt(receipt.toString("base64")));
  receipt[8] = 2; assert.throws(() => decodeRedemptionReceipt(receipt.toString("base64")));
  assert.throws(() => decodeRedemptionReceipt(receipt.subarray(0, 218).toString("base64")));
});

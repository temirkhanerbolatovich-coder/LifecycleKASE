import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildEntitlementRegistration, buildCalculationFinalization, buildCalculationReset, decodeConfirmedEntitlement,
  deriveEntitlementAddress } from "./entitlement-registration.js";
import { decodePublicKey } from "./base58.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const investorId = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const identity = { programId: PROGRAM, instrumentId: investorId,
  actionId: new Uint8Array(16).fill(2), corporateActionAuthority: KEY };
const terms = { investorId, snapshotHash: "ab".repeat(32), settlementWallet: KEY,
  balanceAtSnapshot: 10n, eligible: true, paymentAmountMinor: 500_000_000n, tokensToRedeem: 0n };

test("registration pins snapshot, recipient and integer amounts with the required privileges", async () => {
  const plan = await buildEntitlementRegistration({ ...identity, ...terms });
  const bytes = Buffer.from(plan.instruction.data);
  assert.deepEqual(bytes.subarray(0, 8), createHash("sha256").update("global:register_entitlement").digest().subarray(0, 8));
  assert.deepEqual(bytes.subarray(8, 24), Buffer.from(investorId));
  assert.equal(bytes.subarray(24, 56).toString("hex"), terms.snapshotHash);
  assert.deepEqual(bytes.subarray(56, 88), Buffer.from(decodePublicKey(KEY)));
  assert.equal(bytes.readBigUInt64LE(88), 10n);
  assert.equal(bytes[96], 1);
  assert.equal(bytes.readBigUInt64LE(97), 500_000_000n);
  assert.equal(bytes.readBigUInt64LE(105), 0n);
  assert.equal(bytes.length, 113);
  assert.deepEqual(plan.instruction.accounts.map(a => [a.isSigner, a.isWritable]),
    [[true, true], [false, false], [false, true], [false, true], [false, false]]);
});

test("entitlement identity is stable per investor and isolated per action", async () => {
  const plan = await buildEntitlementRegistration({ ...identity, ...terms });
  assert.equal(await deriveEntitlementAddress(PROGRAM, plan.actionAddress, investorId), plan.entitlementAddress);
  const otherInvestor = await buildEntitlementRegistration({ ...identity, ...terms, investorId: new Uint8Array(16).fill(3) });
  const otherAction = await buildEntitlementRegistration({ ...identity, ...terms, actionId: new Uint8Array(16).fill(4) });
  assert.notEqual(plan.entitlementAddress, otherInvestor.entitlementAddress);
  assert.notEqual(plan.entitlementAddress, otherAction.entitlementAddress);
});

test("registration rejects invalid identities, eligible recipients and out-of-range integers", async () => {
  for (const override of [{ investorId: new Uint8Array(16) }, { investorId: new Uint8Array(15) },
    { snapshotHash: "00".repeat(32) }, { snapshotHash: "gg".repeat(32) }, { balanceAtSnapshot: 0n },
    { settlementWallet: "11111111111111111111111111111111" }, { balanceAtSnapshot: 1n << 64n },
    { paymentAmountMinor: -1n }, { tokensToRedeem: 1n << 64n }, { eligible: false }]) {
    await assert.rejects(buildEntitlementRegistration({ ...identity, ...terms, ...override }));
  }
});

test("ineligible investors remain in coverage without a recipient or payable amount", async () => {
  const plan = await buildEntitlementRegistration({ ...identity, ...terms, eligible: false,
    settlementWallet: "11111111111111111111111111111111", paymentAmountMinor: 0n, tokensToRedeem: 0n });
  assert.equal(Buffer.from(plan.instruction.data)[96], 0);
});

test("finalization supplies the complete unique set as read-only accounts", async () => {
  const investorIds = [investorId, new Uint8Array(16).fill(3), new Uint8Array(16).fill(4)];
  const plan = await buildCalculationFinalization({ ...identity, investorIds });
  assert.equal(plan.entitlementAddresses.length, 3);
  assert.deepEqual(plan.instruction.accounts.slice(3).map(a => [a.address, a.isSigner, a.isWritable]),
    plan.entitlementAddresses.map(a => [a, false, false]));
  assert.deepEqual(Buffer.from(plan.instruction.data), createHash("sha256").update("global:finalize_calculation").digest().subarray(0, 8));
  for (const ids of [[], [investorId, investorId], Array(65).fill(investorId)]) {
    await assert.rejects(buildCalculationFinalization({ ...identity, investorIds: ids }));
  }
});

test("reset supplies the exact registered set as writable close targets", async () => {
  const investorIds = [investorId, new Uint8Array(16).fill(3)];
  const plan = await buildCalculationReset({ ...identity, investorIds });
  assert.deepEqual(plan.instruction.accounts.slice(0, 3).map(a => [a.isSigner, a.isWritable]),
    [[true, true], [false, false], [false, true]]);
  assert.deepEqual(plan.instruction.accounts.slice(3).map(a => [a.address, a.isSigner, a.isWritable]),
    plan.entitlementAddresses.map(a => [a, false, true]));
  assert.deepEqual(Buffer.from(plan.instruction.data), createHash("sha256").update("global:reset_calculation").digest().subarray(0, 8));
  for (const ids of [[], [investorId, investorId], Array(65).fill(investorId)]) {
    await assert.rejects(buildCalculationReset({ ...identity, investorIds: ids }));
  }
});

test("decoder reads a finalized immutable entitlement and rejects malformed accounts", async () => {
  const plan = await buildEntitlementRegistration({ ...identity, ...terms });
  const data = Buffer.alloc(155); let offset = 0;
  createHash("sha256").update("account:Entitlement").digest().copy(data, offset, 0, 8); offset += 8;
  data[offset++] = 1; Buffer.from(decodePublicKey(plan.actionAddress)).copy(data, offset); offset += 32;
  Buffer.from(investorId).copy(data, offset); offset += 16; Buffer.from(terms.snapshotHash, "hex").copy(data, offset); offset += 32;
  Buffer.from(decodePublicKey(KEY)).copy(data, offset); offset += 32; data.writeBigUInt64LE(10n, offset); offset += 8;
  data.writeBigUInt64LE(500_000_000n, offset); offset += 8; data.writeBigUInt64LE(0n, offset); offset += 8;
  data[offset++] = 0; data[offset++] = 0; data[offset++] = 254;
  const decoded = decodeConfirmedEntitlement(data.toString("base64"));
  assert.equal(decoded.actionAddress, plan.actionAddress); assert.deepEqual(decoded.investorId, investorId);
  assert.equal(decoded.snapshotHash, terms.snapshotHash); assert.equal(decoded.settlementWallet, KEY);
  assert.equal(decoded.balanceAtSnapshot, 10n); assert.equal(decoded.paymentAmountMinor, 500_000_000n);
  assert.equal(decoded.tokensToRedeem, 0n); assert.equal(decoded.status, "READY"); assert.equal(decoded.executedAt, null); assert.equal(decoded.bump, 254);
  assert.throws(() => decodeConfirmedEntitlement(data.subarray(0, offset - 1).toString("base64")));
  const changed = Buffer.from(data); changed[8] = 2; assert.throws(() => decodeConfirmedEntitlement(changed.toString("base64")));
});

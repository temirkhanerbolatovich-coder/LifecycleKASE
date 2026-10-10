import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildActionApproval, decodeApprovalPolicy, decodeActionReserve, decodeReserveMint } from "./action-approval.js";
import { decodePublicKey, encodePublicKey } from "./base58.js";
const input = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1), actionId: new Uint8Array(16).fill(2),
  issuer: encodePublicKey(new Uint8Array(32).fill(3)), approver: encodePublicKey(new Uint8Array(32).fill(4)), settlementMint: encodePublicKey(new Uint8Array(32).fill(5)),
  networkReserveLamports: 50_000_000n, snapshotHash: "ab".repeat(32), amountMinor: 1_750_000_000n };
test("approval plans use distinct action vaults and one authority per phase", async () => {
  for (const phase of ["ASSIGN_APPROVER", "RESERVE", "RELEASE", "APPROVE"] as const) {
    const plan = await buildActionApproval({ ...input, phase });
    assert.equal(plan.requiredSigner, phase === "APPROVE" ? input.approver : input.issuer);
    assert.equal(plan.instruction.accounts.filter(account => account.isSigner).length, 1);
    assert.equal(plan.instruction.data.length, 48);
    const another = await buildActionApproval({ ...input, phase, actionId: new Uint8Array(16).fill(9) });
    assert.equal(another.approvalPolicyAddress, plan.approvalPolicyAddress);
    assert.notEqual(another.reserveAddress, plan.reserveAddress); assert.notEqual(another.vaultAddress, plan.vaultAddress);
  }
});
test("approval builder rejects invalid authority, budgets and commitments", async () => {
  for (const change of [{ approver: input.issuer }, { approver: "11111111111111111111111111111111" }, { networkReserveLamports: 4_999_999n },
    { amountMinor: 0n }, { amountMinor: 1n << 64n }, { snapshotHash: "00".repeat(32) }, { snapshotHash: "zz".repeat(32) }, { actionId: new Uint8Array(16) }]) {
    await assert.rejects(buildActionApproval({ ...input, phase: "RESERVE", ...change }));
  }
});
test("policy and reserve decoders support Borsh option offsets and reject ambiguous account data", () => {
  const policy = Buffer.alloc(82); createHash("sha256").update("account:ApprovalPolicy").digest().copy(policy, 0, 0, 8); policy[8] = 1;
  Buffer.from(decodePublicKey(input.issuer)).copy(policy, 9); Buffer.from(decodePublicKey(input.approver)).copy(policy, 41); policy.writeBigUInt64LE(input.networkReserveLamports, 73); policy[81] = 252;
  assert.equal(decodeApprovalPolicy(policy.toString("base64")).approver, input.approver);
  for (const bad of [policy.subarray(0, 81), Buffer.concat([policy, Buffer.from([0])]), Buffer.from(policy)]) {
    if (bad.length === 82) bad[8] = 2;
    assert.throws(() => decodeApprovalPolicy(bad.toString("base64")));
  }
  const reserve = Buffer.alloc(187); createHash("sha256").update("account:ActionReserve").digest().copy(reserve, 0, 0, 8); reserve[8] = 1; reserve[178] = 251;
  assert.equal(decodeActionReserve(reserve.toString("base64")).bump, 251);
  Buffer.from(decodePublicKey(input.approver)).copy(reserve, 145); reserve[177] = 1; reserve.writeBigInt64LE(1_700_000_000n, 178); reserve[186] = 250;
  assert.equal(decodeActionReserve(reserve.toString("base64")).approvedAt, 1_700_000_000n); assert.equal(decodeActionReserve(reserve.toString("base64")).bump, 250);
  reserve[177] = 0; assert.throws(() => decodeActionReserve(reserve.toString("base64"))); reserve[177] = 2;
  assert.throws(() => decodeActionReserve(reserve.toString("base64")));
});
test("reserve mint accepts revoked mint authority and rejects freeze authority, extensions or wrong precision", () => {
  const mint = Buffer.alloc(82); mint[44] = 6; mint[45] = 1;
  assert.equal(decodeReserveMint(mint.toString("base64")).mintAuthority, null);
  for (const change of [(data: Buffer) => { data[44] = 9; }, (data: Buffer) => { data[45] = 0; },
    (data: Buffer) => { data.writeUInt32LE(1, 46); }]) {
    const bad = Buffer.from(mint); change(bad); assert.throws(() => decodeReserveMint(bad.toString("base64")));
  }
  assert.throws(() => decodeReserveMint(Buffer.concat([mint, Buffer.alloc(83)]).toString("base64")));
});

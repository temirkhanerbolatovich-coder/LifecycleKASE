import assert from "node:assert/strict";
import test from "node:test";
import { buildActionApproval, encodePublicKey, serializeUnsignedInstructionsTransaction } from "@lifecycle-kase/solana-client";
import { approvalView, preparedActionApproval } from "./action-approval-workflow";
const input = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1), actionId: new Uint8Array(16).fill(2),
  issuer: encodePublicKey(new Uint8Array(32).fill(3)), approver: encodePublicKey(new Uint8Array(32).fill(4)), settlementMint: encodePublicKey(new Uint8Array(32).fill(5)),
  networkReserveLamports: 50_000_000n, snapshotHash: "ab".repeat(32), amountMinor: 1_750_000_000n };
const id = "00000000-0000-4000-8000-000000000001";
async function fixture(phase: "ASSIGN_APPROVER" | "RESERVE" | "RELEASE" | "APPROVE") {
  const plan = await buildActionApproval({ ...input, phase });
  const serialize = (instructions: typeof plan.instruction[]) => serializeUnsignedInstructionsTransaction({ instructions,
    feePayer: plan.requiredSigner, recentBlockhash: encodePublicKey(new Uint8Array(32).fill(8)), lastValidBlockHeight: 100 });
  const view = approvalView({ ...input, ...plan, actionId: id, actionVersion: 4, instrumentId: id,
    networkGenesisHash: encodePublicKey(new Uint8Array(32).fill(7)), policyAddress: plan.approvalPolicyAddress,
    amountMinor: input.amountMinor.toString(), networkReserveLamports: input.networkReserveLamports.toString(), treasuryBalanceMinor: "1750000000", reservedMinor: "0",
    approver: phase === "ASSIGN_APPROVER" ? null : input.approver, reserveExists: false, approved: false, pending: null });
  const payload = { ...input, ...plan, phase, instrumentId: id, actionVersion: 4, corporateActionId: id, operationId: id,
    networkGenesisHash: view.networkGenesisHash, amountMinor: view.amountMinor, networkReserveLamports: view.networkReserveLamports,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", cluster: "localnet", lastValidBlockHeight: 100,
    serializedTransactionBase64: serialize([plan.instruction]), feeLamports: "5000", creationRentLamports: "0", recipientRentLamports: "0",
    estimatedExecutionFeeLamports: "0", requiredLamports: "50005000", payerLamports: "1000000000", signature: null, status: "PREPARED", note: phase === "APPROVE" ? "Reviewed" : null };
  return { plan, view, payload, serialize };
}
test("every approval phase validates production serialized bytes and exact signer", async () => {
  for (const phase of ["ASSIGN_APPROVER", "RESERVE", "RELEASE", "APPROVE"] as const) {
    const { view, payload, plan } = await fixture(phase);
    assert.equal(preparedActionApproval(payload, view, plan.requiredSigner, input.approver).phase, phase);
    for (const change of [{ amountMinor: "1750000001" }, { snapshotHash: "cd".repeat(32) }, { approver: input.issuer }, { actionVersion: 3 },
      { requiredSigner: input.settlementMint }, { networkGenesisHash: input.settlementMint }, { requiredLamports: "1" }, { payerLamports: "0" }]) {
      assert.throws(() => preparedActionApproval({ ...payload, ...change }, view, plan.requiredSigner, input.approver));
    }
  }
});
test("approval rejects changed instruction data, privileges, accounts and hidden extra instructions", async () => {
  const { view, payload, plan, serialize } = await fixture("RESERVE");
  const changedData = Uint8Array.from(plan.instruction.data); changedData[47] = changedData[47]! ^ 1;
  for (const instruction of [{ ...plan.instruction, data: changedData },
    { ...plan.instruction, accounts: plan.instruction.accounts.map((a, i) => i === 5 ? { ...a, address: input.approver } : a) },
    { ...plan.instruction, accounts: plan.instruction.accounts.map((a, i) => i === 5 ? { ...a, isWritable: false } : a) }]) {
    assert.throws(() => preparedActionApproval({ ...payload, serializedTransactionBase64: serialize([instruction]) }, view, plan.requiredSigner));
  }
  assert.throws(() => preparedActionApproval({ ...payload, serializedTransactionBase64: serialize([plan.instruction, plan.instruction]) }, view, plan.requiredSigner));
});
test("restored signed approval requires its original signature and intact review facts", async () => {
  const { view, payload, plan } = await fixture("APPROVE");
  assert.throws(() => preparedActionApproval({ ...payload, status: "UNKNOWN_CONFIRMATION" }, view, plan.requiredSigner));
  const restored = { ...payload, status: "UNKNOWN_CONFIRMATION", signature: "2".repeat(88) };
  assert.equal(preparedActionApproval(restored, view, plan.requiredSigner).signature, restored.signature);
  assert.throws(() => preparedActionApproval({ ...restored, note: null }, view, plan.requiredSigner));
  assert.throws(() => preparedActionApproval({ ...restored, signature: "invalid" }, view, plan.requiredSigner));
});

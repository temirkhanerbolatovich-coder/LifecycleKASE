import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCouponExecution, buildCouponFinalization, encodePublicKey, serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { preparedCouponExecution, couponReviewChanged, type CouponExecutionView } from "./coupon-execution-workflow";
import { finalizedCouponReceipt } from "./coupon-execution-workflow";
import { deriveControlledCaptureAddress, deriveControlledPolicyAddress, decodePublicKey } from "@lifecycle-kase/solana-client";
const id = "00000000-0000-4000-8000-000000000001";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3);
async function fixture(phase: "PAY" | "FINALIZE" = "PAY") {
  const identity = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1), actionId: new Uint8Array(16).fill(2), corporateActionAuthority: signer };
  const idempotencyHash = createHash("sha256").update(`coupon:${id}:${phase === "PAY" ? id : "finalize"}:coupon-key-1`).digest("hex");
  const pay = await buildCouponExecution({ ...identity, investorId: new Uint8Array(16).fill(3), settlementMint: key(5), settlementWallet: key(6), idempotencyHash });
  const final = await buildCouponFinalization({ ...identity, investorIds: [new Uint8Array(16).fill(3)], receiptHash: "ab".repeat(32) });
  const plan = phase === "PAY" ? pay : final;
  const serialize = (instructions: SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
  const view: CouponExecutionView = { enabled: true, actionId: id, actionVersion: 7, status: "APPROVED", requiredSigner: signer, programId: identity.programId,
    networkGenesisHash: key(7), settlementMint: key(5), snapshotHash: "ab".repeat(32), totalAmountMinor: "500000000", paid: 0, payable: 1, executeAt: new Date(0).toISOString(), pending: null,
    ...final, items: [{ id, investorId: id, status: "READY", amountMinor: "500000000", receiver: key(6), signature: null,
      entitlementAddress: pay.entitlementAddress, entitlementReceiptAddress: pay.entitlementReceiptAddress, recipientAddress: pay.recipientAddress }] };
  const payload = { ...plan, corporateActionId: id, operationId: "00000000-0000-4000-8000-000000000002", phase, cluster: "localnet",
    actionVersion: 7, requiredSigner: signer, programId: view.programId, networkGenesisHash: view.networkGenesisHash, settlementMint: view.settlementMint, snapshotHash: view.snapshotHash,
    idempotencyKey: "coupon-key-1", idempotencyHash, entitlementId: phase === "PAY" ? id : null, amountMinor: "500000000", settlementWallet: phase === "PAY" ? key(6) : null,
    ...(phase === "FINALIZE" ? { receiptHash: "ab".repeat(32) } : {}), status: "PREPARED", signature: null,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", lastValidBlockHeight: 100, serializedTransactionBase64: serialize(plan.instructions) };
  return { view, payload, plan, serialize };
}
test("payment review binds amount, receiver, snapshot, mint, network and version to production wire bytes", async () => {
  const { view, payload } = await fixture(); assert.equal((await preparedCouponExecution(payload, view, signer)).entitlementId, id);
  for (const changed of [{ amountMinor: "501000000" }, { settlementWallet: "other" }, { settlementMint: key(9) }, { snapshotHash: "cd".repeat(32) },
    { networkGenesisHash: key(9) }, { corporateActionId: "other" }, { entitlementId: "other" }, { actionVersion: 6 }, { requiredSigner: key(9) }, { lastValidBlockHeight: -1 },
    { idempotencyKey: "another-key" }, { entitlementReceiptAddress: key(9) }, { status: "UNKNOWN_CONFIRMATION" }, { signature: "malformed" }]) {
    await assert.rejects(preparedCouponExecution({ ...payload, ...changed }, view, signer));
  }
});
test("receipt review binds complete amount and permits a blockhash refresh of the reviewed terms", async () => {
  const { view, payload } = await fixture("FINALIZE"); const plan = await preparedCouponExecution(payload, view, signer);
  await assert.rejects(preparedCouponExecution({ ...payload, amountMinor: "1" }, view, signer));
  await assert.rejects(preparedCouponExecution({ ...payload, actionReceiptAddress: key(9) }, view, signer));
  assert.equal(couponReviewChanged(plan, { ...plan, serializedTransactionBase64: "another-blockhash" }), false);
  assert.equal(couponReviewChanged(plan, { ...plan, receiptHash: "cd".repeat(32) }), true);
  assert.equal(couponReviewChanged(plan, { ...plan, settlementMint: key(9) }), true);
  assert.equal(couponReviewChanged(plan, { ...plan, idempotencyKey: "another-key" }), true);
});
test("coupon phases reject altered instructions, recipients, privileges and hidden extra instructions", async () => {
  for (const phase of ["PAY", "FINALIZE"] as const) {
    const { view, payload, plan, serialize } = await fixture(phase);
    const altered = Uint8Array.from(plan.instruction.data); altered[8] = altered[8]! ^ 1;
    for (const instruction of [{ ...plan.instruction, data: altered },
      { ...plan.instruction, accounts: plan.instruction.accounts.map((account, i) => i === 3 ? { ...account, address: key(9) } : account) },
      { ...plan.instruction, accounts: plan.instruction.accounts.map((account, i) => i === 2 ? { ...account, isWritable: !account.isWritable } : account) }]) {
      await assert.rejects(preparedCouponExecution({ ...payload, serializedTransactionBase64: serialize([...plan.instructions.slice(0, -1), instruction]) }, view, signer));
    }
    await assert.rejects(preparedCouponExecution({ ...payload, serializedTransactionBase64: serialize([...plan.instructions, plan.instruction]) }, view, signer));
    if (phase === "PAY") {
      const ata = plan.instructions[0]!;
      const changedAta = { ...ata, accounts: ata.accounts.map((account, i) => i === 2 ? { ...account, address: key(9) } : account) };
      await assert.rejects(preparedCouponExecution({ ...payload, serializedTransactionBase64: serialize([changedAta, plan.instruction]) }, view, signer));
    }
  }
});
test("governed coupon uses existing payment wire while binding the canonical capture and policy metadata", async () => {
  const f = await fixture(); const view = { ...f.view, tokenPolicy: "CONTROLLED_FROZEN_V2" as const };
  const payload = { ...f.payload, tokenPolicy: view.tokenPolicy, controlledPolicyAddress: await deriveControlledPolicyAddress(view.programId, view.instrumentAddress), controlledCaptureAddress: await deriveControlledCaptureAddress(view.programId, view.actionAddress) };
  await preparedCouponExecution(payload, view, signer);
  for (const change of [{ tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, { controlledPolicyAddress: key(20) }, { controlledCaptureAddress: key(20) }]) {
    await assert.rejects(preparedCouponExecution({ ...payload, ...change }, view, signer));
  }
});
test("coupon downloads require canonical hash and governed raw holder lineage; hash-valid corruption fails closed", async () => {
  const f = await fixture("FINALIZE"); const signature = "1".repeat(64);
  const view = { ...f.view, tokenPolicy: "CONTROLLED_FROZEN_V2" as const, tokenMint: key(4), items: f.view.items.map(row => ({ ...row, signature })) };
  const policy = await deriveControlledPolicyAddress(view.programId, view.instrumentAddress), capture = await deriveControlledCaptureAddress(view.programId, view.actionAddress);
  const bytes = Buffer.alloc(170); Buffer.from(decodePublicKey(view.tokenMint)).copy(bytes); Buffer.from(decodePublicKey(key(9))).copy(bytes, 32);
  bytes.writeBigUInt64LE(35n, 64); bytes[108] = 2; bytes[165] = 2; bytes.writeUInt16LE(7, 166);
  const position = { address: key(10), tokenProgramOwner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", mintAddress: view.tokenMint, walletAddress: key(9), balance: "35", state: "FROZEN", delegate: null, closeAuthority: null, immutableOwner: true, dataBase64: bytes.toString("base64") };
  const registry = { mintAddress: view.tokenMint, slot: 20, supply: "35", totalBalance: "35", positivePositions: [position] }; const registryCanonicalJson = JSON.stringify(registry);
  const evidence = { schema: "controlled-capture-v1", controlledPolicyAddress: policy, controlledCaptureAddress: capture, startedSlot: "10", readSlot: 20,
    registry, registryCanonicalJson, registrySha256: createHash("sha256").update(registryCanonicalJson).digest("hex") };
  const receipt = { schemaVersion: "coupon-controlled-action-receipt-v1", actionId: id, actionType: "COUPON_PAYMENT", tokenPolicy: view.tokenPolicy, programId: view.programId,
    genesisHash: view.networkGenesisHash, snapshot: { hash: view.snapshotHash }, totalAmountMinor: view.totalAmountMinor, reconciliation: "MATCHED",
    controlledRegistry: { captureAddress: capture, captureFinishSignature: signature, captureEvidence: evidence, assignedUnitPolicy: "NOT_APPLICABLE" },
    entitlements: view.items.map(row => ({ entitlementId: row.id, investorId: row.investorId, amountMinor: row.amountMinor, settlement: { receiver: row.receiver, signature, reconciliation: "MATCHED" } })) };
  const response = (value: unknown) => { const canonicalJson = JSON.stringify(value); return { actionId: id, status: "FINALIZED", signature, onchainPda: view.actionReceiptAddress, canonicalJson, sha256: createHash("sha256").update(canonicalJson).digest("hex") }; };
  assert.equal(await finalizedCouponReceipt(response(receipt), view), JSON.stringify(receipt));
  // PostgreSQL JSONB can reorder parsed registry keys; the original UTF-8 bytes remain authoritative.
  const reordered = { ...evidence, registry: Object.fromEntries(Object.entries(registry).reverse()) };
  await finalizedCouponReceipt(response({ ...receipt, controlledRegistry: { ...receipt.controlledRegistry, captureEvidence: reordered } }), view);
  for (const changed of [{ tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, { totalAmountMinor: "1" }, { controlledRegistry: { ...receipt.controlledRegistry, captureAddress: key(20) } },
    { controlledRegistry: { ...receipt.controlledRegistry, captureEvidence: { ...evidence, registrySha256: "ab".repeat(32) } } },
    { entitlements: [{ ...receipt.entitlements[0], settlement: { ...receipt.entitlements[0]!.settlement, receiver: key(20) } }] }]) {
    await assert.rejects(finalizedCouponReceipt(response({ ...receipt, ...changed }), view));
  }
  await assert.rejects(finalizedCouponReceipt({ ...response(receipt), sha256: "ab".repeat(32) }, view));
});

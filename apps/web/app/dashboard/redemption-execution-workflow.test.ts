import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildRedemptionExecution, buildRedemptionFinalization, encodePublicKey, redemptionSourceHash,
  serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { finalizedRedemptionReceipt, preparedRedemptionExecution, redemptionExecutionSignature, redemptionExecutionView,
  redemptionReviewChanged, type RedemptionExecutionView } from "./redemption-execution-workflow";
const id = "00000000-0000-4000-8000-000000000001";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3);
const signature = "1".repeat(64);
async function fixture(phase: "PAY" | "FINALIZE" = "PAY", actionType = "EARLY_REDEMPTION") {
  const identity = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2), corporateActionAuthority: signer };
  const investorId = new Uint8Array(16).fill(3);
  const snapshotHash = "ab".repeat(32);
  const idempotencyKey = "1111111111111111";
  const idempotencyHash = createHash("sha256").update(`redemption:${id}:${phase === "PAY" ? id : "finalize"}:${idempotencyKey}`).digest("hex");
  const tokenAccounts = [{ address: key(9), wallet: key(11), balanceAtSnapshot: 5n }, { address: key(10), wallet: key(12), balanceAtSnapshot: 5n }]
    .sort((a, b) => a.address < b.address ? -1 : 1);
  const pay = await buildRedemptionExecution({ ...identity, investorId, bondMint: key(4), settlementMint: key(5), settlementWallet: key(6), idempotencyHash, tokenAccounts });
  const final = await buildRedemptionFinalization({ ...identity, bondMint: key(4), investorIds: [investorId], receiptHash: "cd".repeat(32) });
  const plan = phase === "PAY" ? pay : final;
  const tokensToRedeem = actionType === "BOND_REDEMPTION" ? "10" : "2";
  const supplyBefore = actionType === "BOND_REDEMPTION" ? "10" : "35";
  const supplyAfter = (BigInt(supplyBefore) - BigInt(tokensToRedeem)).toString();
  let remaining = BigInt(tokensToRedeem);
  const sources = tokenAccounts.map(source => {
    const burn = source.balanceAtSnapshot < remaining ? source.balanceAtSnapshot : remaining; remaining -= burn;
    return { address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString(), burnAmount: burn.toString(),
      balanceBefore: source.balanceAtSnapshot.toString(), expectedBalanceAfter: (source.balanceAtSnapshot - burn).toString() };
  });
  const sourceHash = redemptionSourceHash(pay.actionAddress, pay.entitlementAddress, snapshotHash, tokenAccounts);
  const view: RedemptionExecutionView = { enabled: true, actionId: id, actionVersion: 7, actionType, status: phase === "PAY" ? "APPROVED" : "SETTLED",
    requiredSigner: signer, programId: identity.programId, networkGenesisHash: key(7), settlementMint: key(5), tokenMint: key(4), snapshotHash,
    instrumentAddress: final.instrumentAddress, instrumentAuthorityAddress: pay.instrumentAuthority, actionAddress: final.actionAddress,
    approvalPolicyAddress: final.approvalPolicyAddress, reserveAddress: final.reserveAddress, vaultAddress: final.vaultAddress,
    redemptionProgressAddress: final.progressAddress, actionReceiptAddress: final.actionReceiptAddress,
    totalAmountMinor: "2000000000", currentTokenSupply: phase === "PAY" ? supplyBefore : supplyAfter,
    paid: phase === "PAY" ? 0 : 1, payable: 1, executeAt: new Date(0).toISOString(), pending: null,
    items: [{ id, investorId: id, status: phase === "PAY" ? "READY" : "REDEEMED", amountMinor: "2000000000", tokensToRedeem, receiver: key(6), signature: phase === "PAY" ? null : signature,
      entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress, redemptionReceiptAddress: pay.redemptionReceiptAddress,
      recipientAddress: pay.recipientAddress, sourceHash, burnAvailable: true, tokenAccounts: sources }] };
  const serialize = (instructions: SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
  const payload: Record<string, unknown> = { ...view, corporateActionId: id, operationId: "00000000-0000-4000-8000-000000000002", phase, cluster: "localnet",
    idempotencyKey, idempotencyHash, entitlementId: phase === "PAY" ? id : null, amountMinor: view.totalAmountMinor, settlementWallet: phase === "PAY" ? key(6) : null,
    ...(phase === "PAY" ? { entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress, redemptionReceiptAddress: pay.redemptionReceiptAddress,
      recipientAddress: pay.recipientAddress, sourceHash, tokensToRedeem, tokenAccounts: sources, supplyBefore, supplyAfter } :
      { receiptHash: "cd".repeat(32), totalTokensRedeemed: tokensToRedeem, finalSupply: supplyAfter }),
    status: "PREPARED", signature: null, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", lastValidBlockHeight: 100, serializedTransactionBase64: serialize(plan.instructions) };
  return { view, payload, plan, serialize };
}

test("redemption review accepts production payment/burn and finalization bytes for both mandatory types", async () => {
  for (const actionType of ["EARLY_REDEMPTION", "BOND_REDEMPTION"]) for (const phase of ["PAY", "FINALIZE"] as const) {
    const { view, payload } = await fixture(phase, actionType);
    assert.equal(redemptionExecutionView(view as unknown as Record<string, unknown>, id, actionType), view);
    assert.equal((await preparedRedemptionExecution(payload, view, signer)).phase, phase);
  }
});

test("payment review binds amount, sources, mint, balances and supply before opening the wallet", async () => {
  const { view, payload } = await fixture();
  for (const changed of [{ amountMinor: "1" }, { settlementWallet: key(9) }, { tokenMint: key(9) }, { actionType: "BOND_REDEMPTION" },
    { tokensToRedeem: "3" }, { supplyAfter: "32" }, { supplyBefore: "34", supplyAfter: "32" }, { actionVersion: 6 }, { sourceHash: "cd".repeat(32) },
    { redemptionReceiptAddress: key(9) }, { redemptionSourcesAddress: key(9) }, { redemptionProgressAddress: key(9) }, { instrumentAuthorityAddress: key(9) },
    { idempotencyKey: "other-key-1" }, { status: "UNKNOWN_CONFIRMATION" }, { signature: "malformed" }]) {
    await assert.rejects(preparedRedemptionExecution({ ...payload, ...changed }, view, signer));
  }
  const original = view.items[0]!.tokenAccounts;
  for (const tokenAccounts of [[...original].reverse(), [original[0]], original.map((source, index) => index === 0 ? { ...source, walletAddress: key(9) } : source),
    original.map((source, index) => index === 0 ? { ...source, balanceBefore: "6", expectedBalanceAfter: "4" } : source)]) {
    await assert.rejects(preparedRedemptionExecution({ ...payload, tokenAccounts }, view, signer));
  }
});

test("payment and finalization reject changed burn accounts, privileges, data and hidden instructions", async () => {
  for (const phase of ["PAY", "FINALIZE"] as const) {
    const { view, payload, plan, serialize } = await fixture(phase);
    const data = Uint8Array.from(plan.instruction.data); data[8] = data[8]! ^ 1;
    for (const instruction of [{ ...plan.instruction, data },
      { ...plan.instruction, accounts: plan.instruction.accounts.map((account, index) => index === plan.instruction.accounts.length - 1 ? { ...account, address: key(20) } : account) },
      { ...plan.instruction, accounts: plan.instruction.accounts.map((account, index) => index === 1 ? { ...account, isWritable: !account.isWritable } : account) }]) {
      await assert.rejects(preparedRedemptionExecution({ ...payload, serializedTransactionBase64: serialize([...plan.instructions.slice(0, -1), instruction]) }, view, signer));
    }
    await assert.rejects(preparedRedemptionExecution({ ...payload, serializedTransactionBase64: serialize([...plan.instructions, plan.instruction]) }, view, signer));
    if (phase === "PAY") {
      const ata = plan.instructions[0]!;
      const changed = { ...ata, accounts: ata.accounts.map((account, index) => index === 2 ? { ...account, address: key(20) } : account) };
      await assert.rejects(preparedRedemptionExecution({ ...payload, serializedTransactionBase64: serialize([changed, plan.instruction]) }, view, signer));
    }
  }
});

test("signed recovery preserves captured pre-burn balances and never turns into an unsigned retry", async () => {
  const { view, payload } = await fixture();
  const current = { ...view, currentTokenSupply: "33", items: view.items.map(row => ({ ...row, tokenAccounts: row.tokenAccounts.map(source => ({ ...source,
    balanceBefore: source.expectedBalanceAfter!, expectedBalanceAfter: (BigInt(source.expectedBalanceAfter!) - BigInt(source.burnAmount)).toString() })) })) };
  const signed = { ...payload, status: "UNKNOWN_CONFIRMATION", signature, resumed: true };
  assert.equal(redemptionExecutionSignature(signed), signature);
  assert.equal((await preparedRedemptionExecution(signed, current, signer)).supplyBefore, "35");
  await assert.rejects(preparedRedemptionExecution(payload, current, signer));
  for (const status of ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED", "FAILED"]) {
    assert.equal(redemptionExecutionSignature({ status, signature }), signature);
    assert.throws(() => redemptionExecutionSignature({ status, signature: null }), /Повторная отправка/);
  }
});

test("changes to financial review reset consent while a fresh blockhash alone preserves it", async () => {
  const { view, payload } = await fixture(); const plan = await preparedRedemptionExecution(payload, view, signer);
  assert.equal(redemptionReviewChanged(plan, { ...plan, serializedTransactionBase64: "fresh-blockhash" }), false);
  for (const change of [{ supplyAfter: "32" }, { tokensToRedeem: "3" }, { amountMinor: "1" }, { tokenMint: key(20) }, { actionVersion: 8 },
    { tokenAccounts: plan.tokenAccounts!.map(source => ({ ...source, expectedBalanceAfter: "1" })) }]) {
    assert.equal(redemptionReviewChanged(plan, { ...plan, ...change }), true);
  }
});

test("finalization includes all entitlements and maturity requires zero remaining supply", async () => {
  const { view, payload } = await fixture("FINALIZE", "BOND_REDEMPTION");
  for (const change of [{ finalSupply: "1" }, { totalTokensRedeemed: "9" }, { receiptHash: "0".repeat(64) }, { amountMinor: "1" }, { actionReceiptAddress: key(20) }]) {
    await assert.rejects(preparedRedemptionExecution({ ...payload, ...change }, view, signer));
  }
  await assert.rejects(preparedRedemptionExecution(payload, { ...view, paid: 0 }, signer));
});

test("receipt download requires finalized canonical JSON bound to the selected action and hash", async () => {
  const { view } = await fixture("FINALIZE");
  const canonicalJson = JSON.stringify({ actionId: id, actionType: view.actionType, totalTokensRedeemed: "2", finalSupply: "33" });
  const receipt = { actionId: id, status: "FINALIZED", onchainPda: view.actionReceiptAddress, signature,
    canonicalJson, sha256: createHash("sha256").update(canonicalJson).digest("hex") };
  assert.equal(await finalizedRedemptionReceipt(receipt, view), canonicalJson);
  for (const change of [{ status: "DRAFT" }, { canonicalJson: canonicalJson + " " }, { onchainPda: key(20) }, { actionId: "other" }, { signature: null }]) {
    await assert.rejects(finalizedRedemptionReceipt({ ...receipt, ...change }, view));
  }
});

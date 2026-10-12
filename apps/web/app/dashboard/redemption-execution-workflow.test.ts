import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildRedemptionExecution, buildRedemptionFinalization, encodePublicKey, redemptionSourceHash,
  serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { buildControlledRedemptionExecution, buildControlledRedemptionCompletion, deriveControlledCaptureAddress, deriveControlledPolicyAddress, decodePublicKey } from "@lifecycle-kase/solana-client";
import { finalizedRedemptionReceipt, preparedRedemptionExecution, redemptionExecutionSignature, redemptionExecutionView,
  redemptionReviewChanged, type RedemptionExecutionView } from "./redemption-execution-workflow";
const id = "00000000-0000-4000-8000-000000000001";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3);
const signature = "1".repeat(64);
async function fixture(phase: "PAY" | "FINALIZE" = "PAY", actionType = "EARLY_REDEMPTION", controlled = false) {
  const identity = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2), corporateActionAuthority: signer };
  const investorId = new Uint8Array(16).fill(3);
  const snapshotHash = "ab".repeat(32);
  const idempotencyKey = "1111111111111111";
  const idempotencyHash = createHash("sha256").update(`redemption:${id}:${phase === "PAY" ? id : "finalize"}:${idempotencyKey}`).digest("hex");
  const tokenAccounts = [{ address: key(9), wallet: key(11), balanceAtSnapshot: 5n }, { address: key(10), wallet: key(12), balanceAtSnapshot: 5n }]
    .sort((a, b) => a.address < b.address ? -1 : 1);
  const pay = await (controlled ? buildControlledRedemptionExecution : buildRedemptionExecution)({ ...identity, investorId, bondMint: key(4), settlementMint: key(5), settlementWallet: key(6), idempotencyHash, tokenAccounts });
  const final = await buildRedemptionFinalization({ ...identity, bondMint: key(4), investorIds: [investorId], receiptHash: "cd".repeat(32) });
  const completion = await buildControlledRedemptionCompletion(identity);
  const controlPay = pay as Awaited<ReturnType<typeof buildControlledRedemptionExecution>>;
  const plan = phase === "PAY" ? pay : final;
  const tokensToRedeem = actionType === "BOND_REDEMPTION" ? "10" : "2";
  const supplyBefore = actionType === "BOND_REDEMPTION" || controlled ? "10" : "35";
  const supplyAfter = (BigInt(supplyBefore) - BigInt(tokensToRedeem)).toString();
  let remaining = BigInt(tokensToRedeem);
  const sources = tokenAccounts.map(source => {
    const burn = source.balanceAtSnapshot < remaining ? source.balanceAtSnapshot : remaining; remaining -= burn;
    return { address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString(), burnAmount: burn.toString(),
      ...(controlled && burn === 0n ? { balanceBefore: null, expectedBalanceAfter: null, sourceUntouched: true } :
        { balanceBefore: source.balanceAtSnapshot.toString(), expectedBalanceAfter: (source.balanceAtSnapshot - burn).toString() }) };
  });
  const sourceHash = redemptionSourceHash(pay.actionAddress, pay.entitlementAddress, snapshotHash, tokenAccounts);
  const view: RedemptionExecutionView = { enabled: true, actionId: id, actionVersion: 7, actionType, status: phase === "PAY" ? "APPROVED" : "SETTLED",
    requiredSigner: signer, programId: identity.programId, networkGenesisHash: key(7), settlementMint: key(5), tokenMint: key(4), snapshotHash,
    ...(controlled ? { tokenPolicy: "CONTROLLED_FROZEN_V2" as const } : {}),
    instrumentAddress: final.instrumentAddress, instrumentAuthorityAddress: pay.instrumentAuthority, actionAddress: final.actionAddress,
    approvalPolicyAddress: final.approvalPolicyAddress, reserveAddress: final.reserveAddress, vaultAddress: final.vaultAddress,
    redemptionProgressAddress: final.progressAddress, actionReceiptAddress: final.actionReceiptAddress,
    totalAmountMinor: "2000000000", currentTokenSupply: phase === "PAY" ? supplyBefore : supplyAfter,
    paid: phase === "PAY" ? 0 : 1, payable: 1, executeAt: new Date(0).toISOString(), pending: null,
    items: [{ id, investorId: id, status: phase === "PAY" ? "READY" : "REDEEMED", amountMinor: "2000000000", tokensToRedeem, receiver: key(6), signature: phase === "PAY" ? null : signature,
      entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress, redemptionReceiptAddress: pay.redemptionReceiptAddress,
      recipientAddress: pay.recipientAddress, sourceHash, burnAvailable: true, tokenAccounts: sources,
      ...(controlled ? { unitReservationAddress: controlPay.unitReservationAddress, controlledPolicyAddress: controlPay.controlledPolicyAddress, holdingAddresses: controlPay.holdingAddresses } : {}) }] };
  const serialize = (instructions: SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
  const payload: Record<string, unknown> = { ...view, corporateActionId: id, operationId: "00000000-0000-4000-8000-000000000002", phase, cluster: "localnet",
    idempotencyKey, idempotencyHash, entitlementId: phase === "PAY" ? id : null, amountMinor: view.totalAmountMinor, settlementWallet: phase === "PAY" ? key(6) : null,
    ...(controlled ? { controlledPolicyAddress: completion.controlledPolicyAddress, controlledCaptureAddress: await deriveControlledCaptureAddress(identity.programId, final.actionAddress),
      ...(phase === "PAY" ? { unitReservationAddress: controlPay.unitReservationAddress, holdingAddresses: controlPay.holdingAddresses, assignedAllocations: sources.map(source => source.burnAmount) } : { completesControlledRedemption: true }) } : {}),
    ...(phase === "PAY" ? { entitlementAddress: pay.entitlementAddress, redemptionSourcesAddress: pay.sourceAddress, redemptionReceiptAddress: pay.redemptionReceiptAddress,
      recipientAddress: pay.recipientAddress, sourceHash, tokensToRedeem, tokenAccounts: sources, supplyBefore, supplyAfter } :
      { receiptHash: "cd".repeat(32), totalTokensRedeemed: tokensToRedeem, finalSupply: supplyAfter }),
    status: "PREPARED", signature: null, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", lastValidBlockHeight: 100, serializedTransactionBase64: serialize([...plan.instructions, ...(controlled && phase === "FINALIZE" ? completion.instructions : [])]) };
  return { view, payload, plan, serialize };
}

test("redemption review accepts production payment/burn and finalization bytes for both mandatory types", async () => {
  for (const actionType of ["EARLY_REDEMPTION", "BOND_REDEMPTION"]) for (const phase of ["PAY", "FINALIZE"] as const) {
    const { view, payload } = await fixture(phase, actionType);
    assert.equal(redemptionExecutionView(view as unknown as Record<string, unknown>, id, actionType), view);
    assert.equal((await preparedRedemptionExecution(payload, view, signer)).phase, phase);
  }
});
test("controlled payment includes canonical reservation and Holding accounts; finalization clears the policy in the same transaction", async () => {
  for (const actionType of ["EARLY_REDEMPTION", "BOND_REDEMPTION"]) for (const phase of ["PAY", "FINALIZE"] as const) {
    const f = await fixture(phase, actionType, true);
    redemptionExecutionView(f.view as unknown as Record<string, unknown>, id, actionType);
    assert.equal((await preparedRedemptionExecution(f.payload, f.view, signer)).phase, phase);
    for (const change of [{ tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, { controlledPolicyAddress: key(20) }, { controlledCaptureAddress: key(20) },
      ...(phase === "PAY" ? [{ unitReservationAddress: key(20) }, { holdingAddresses: [key(20), key(21)] }, { assignedAllocations: ["1", "1"] }] : [{ completesControlledRedemption: false }])]) {
      await assert.rejects(preparedRedemptionExecution({ ...f.payload, ...change }, f.view, signer));
    }
  }
});
test("controlled zero-assignment sources retain original commitment without invented current balances", async () => {
  const f = await fixture("PAY", "EARLY_REDEMPTION", true);
  const source = f.view.items[0]!.tokenAccounts[1]!;
  assert.equal(source.sourceUntouched, true); assert.equal(source.balanceBefore, null);
  for (const change of [{ sourceUntouched: false }, { balanceBefore: "5", expectedBalanceAfter: "5" }, { walletAddress: key(20) }]) {
    await assert.rejects(preparedRedemptionExecution({ ...f.payload, tokenAccounts: f.view.items[0]!.tokenAccounts.map((value, index) => index === 1 ? { ...value, ...change } : value) }, f.view, signer));
  }
});
test("governed receipt download verifies raw holder bytes, assigned units and historical burn evidence", async t => {
  const f = await fixture("FINALIZE", "EARLY_REDEMPTION", true);
  const view = { ...f.view, items: f.view.items.map(item => ({ ...item, signature: "1".repeat(64) })) };
  const item = view.items[0]!;
  const policy = await deriveControlledPolicyAddress(view.programId, view.instrumentAddress);
  const capture = await deriveControlledCaptureAddress(view.programId, view.actionAddress);
  const positions = item.tokenAccounts.map(source => {
    const bytes = Buffer.alloc(170); Buffer.from(decodePublicKey(view.tokenMint)).copy(bytes); Buffer.from(decodePublicKey(source.walletAddress)).copy(bytes, 32);
    bytes.writeBigUInt64LE(BigInt(source.balanceAtSnapshot), 64); bytes[108] = 2; bytes[165] = 2; bytes.writeUInt16LE(7, 166);
    return { address: source.address, tokenProgramOwner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", mintAddress: view.tokenMint, walletAddress: source.walletAddress,
      balance: source.balanceAtSnapshot, state: "FROZEN", delegate: null, closeAuthority: null, immutableOwner: true, dataBase64: bytes.toString("base64") };
  });
  const registry = { mintAddress: view.tokenMint, slot: 20, supply: "10", totalBalance: "10", positivePositions: positions };
  const registryCanonicalJson = JSON.stringify(registry);
  const captureEvidence = { schema: "controlled-capture-v1", controlledPolicyAddress: policy, controlledCaptureAddress: capture, startedSlot: "10", startedAt: "1", readSlot: 20,
    registry, registryCanonicalJson, registrySha256: createHash("sha256").update(registryCanonicalJson).digest("hex") };
  const reservation = { unitReservationAddress: item.unitReservationAddress, sourceHash: item.sourceHash, consumed: true, allocations: item.tokenAccounts.map(source => source.burnAmount),
    holdings: item.tokenAccounts.map((source, index) => ({ address: item.holdingAddresses![index], tokenAccount: source.address, walletAddress: source.walletAddress, reservedTokens: "0" })) };
  const receipt = { schemaVersion: "redemption-controlled-action-receipt-v1", actionId: id, actionType: "EARLY_REDEMPTION", tokenPolicy: "CONTROLLED_FROZEN_V2", programId: view.programId,
    genesisHash: view.networkGenesisHash, bondMint: view.tokenMint, reconciliation: "MATCHED", totalAmountMinor: view.totalAmountMinor, totalTokensRedeemed: "2", finalSupply: "8",
    snapshot: { hash: view.snapshotHash, mintSupply: "10" }, controlledRegistry: { captureAddress: capture, captureFinishSignature: "1".repeat(64), captureEvidence,
      assignedUnitPolicy: "SNAPSHOT_SOURCE_BASE58_ASC_GREEDY", untouchedZeroSources: "IMMUTABLE_COMMITMENT_ONLY" },
    entitlements: [{ entitlementId: item.id, investorId: item.investorId, amountMinor: item.amountMinor, tokensRedeemed: "2", settlement: { receiver: item.receiver, signature: item.signature,
      sourceHash: item.sourceHash, receiptAddress: item.redemptionReceiptAddress, tokenAccounts: item.tokenAccounts, supplyBefore: "10", supplyAfter: "8",
      freezePolicy: "ATOMIC_THAW_BURN_REFREEZE", cashLeg: "CONFIRMED", assetLeg: "CONFIRMED", reconciliation: "MATCHED", unitReservation: reservation } }] };
  const response = (value: unknown) => { const json = JSON.stringify(value); return { actionId: id, status: "FINALIZED", onchainPda: view.actionReceiptAddress, signature: "1".repeat(64), canonicalJson: json, sha256: createHash("sha256").update(json).digest("hex") }; };
  assert.equal(await finalizedRedemptionReceipt(response(receipt), view), JSON.stringify(receipt));
  for (const currentTokenSupply of ["5", "0"]) {
    const historicalView = { ...view, currentTokenSupply };
    assert.equal(await finalizedRedemptionReceipt(response(receipt), historicalView), JSON.stringify(receipt));
    await assert.rejects(finalizedRedemptionReceipt(response({ ...receipt, finalSupply: currentTokenSupply }), historicalView));
  }
  for (const change of [{ tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, { finalSupply: "9" }, { controlledRegistry: { ...receipt.controlledRegistry, captureAddress: key(20) } },
    { controlledRegistry: { ...receipt.controlledRegistry, captureEvidence: { ...captureEvidence, registrySha256: "cd".repeat(32) } } },
    { entitlements: [{ ...receipt.entitlements[0], settlement: { ...receipt.entitlements[0]!.settlement, unitReservation: { ...reservation, allocations: ["1", "1"] } } }] }]) {
    await assert.rejects(finalizedRedemptionReceipt(response({ ...receipt, ...change }), view));
  }
  for (const [label, change] of [
    ["missing burn sources", { tokenAccounts: [] }],
    ["reordered burn sources", { tokenAccounts: [...item.tokenAccounts].reverse() }],
    ["changed receipt PDA", { receiptAddress: key(20) }],
    ["zero mint supply delta", { supplyBefore: "100", supplyAfter: "100" }],
    ["out-of-range mint supply with exact burn delta", { supplyBefore: "100", supplyAfter: "98" }],
    ["negative mint supply delta", { supplyBefore: "8", supplyAfter: "10" }],
    ["invalid mint supply", { supplyBefore: "-1", supplyAfter: "-3" }],
  ] as const) await t.test(label, async () => {
    const changed = structuredClone(receipt); Object.assign(changed.entitlements[0]!.settlement, change);
    await assert.rejects(finalizedRedemptionReceipt(response(changed), { ...view, currentTokenSupply: "0" }));
  });
  for (const [label, sourceIndex, change] of [
    ["source address", 0, { address: key(20) }], ["source wallet", 0, { walletAddress: key(20) }],
    ["snapshot balance", 0, { balanceAtSnapshot: "6" }], ["assigned burn", 0, { burnAmount: "1" }],
    ["historical balance", 0, { balanceBefore: "6", expectedBalanceAfter: "4" }],
    ["inconsistent source burn", 0, { expectedBalanceAfter: "5" }], ["invented untouched burn", 0, { sourceUntouched: true }],
    ["zero source history", 1, { balanceBefore: "5", expectedBalanceAfter: "5" }],
    ["missing untouched marker", 1, { sourceUntouched: false }],
  ] as const) await t.test(label, async () => {
    const changed = structuredClone(receipt); Object.assign(changed.entitlements[0]!.settlement.tokenAccounts[sourceIndex]!, change);
    await assert.rejects(finalizedRedemptionReceipt(response(changed), { ...view, currentTokenSupply: "0" }));
  });
  const changedPosition = { ...positions[0]!, state: "INITIALIZED" };
  const alteredRegistry = { ...registry, positivePositions: [changedPosition, positions[1]!] }; const alteredJson = JSON.stringify(alteredRegistry);
  await assert.rejects(finalizedRedemptionReceipt(response({ ...receipt, controlledRegistry: { ...receipt.controlledRegistry, captureEvidence: {
    ...captureEvidence, registry: alteredRegistry, registryCanonicalJson: alteredJson, registrySha256: createHash("sha256").update(alteredJson).digest("hex") } } }), view));
  await t.test("historical mint supply chain follows execution rather than canonical investor order", async t => {
    const items = await Promise.all(item.tokenAccounts.map(async (source, index) => {
      const investorId = `00000000-0000-4000-8000-00000000000${index + 1}`;
      const tokenAccounts = [{ address: source.address, wallet: source.walletAddress, balanceAtSnapshot: BigInt(source.balanceAtSnapshot) }];
      const plan = await buildControlledRedemptionExecution({ programId: view.programId, instrumentId: new Uint8Array(16).fill(1),
        actionId: new Uint8Array(16).fill(2), corporateActionAuthority: signer, investorId: Uint8Array.from(Buffer.from(investorId.replaceAll("-", ""), "hex")),
        bondMint: view.tokenMint, settlementMint: view.settlementMint, settlementWallet: source.walletAddress, idempotencyHash: "ab".repeat(32), tokenAccounts });
      return { ...item, id: investorId, investorId, amountMinor: "1000000000", tokensToRedeem: "1", receiver: source.walletAddress,
        entitlementAddress: plan.entitlementAddress, redemptionSourcesAddress: plan.sourceAddress, redemptionReceiptAddress: plan.redemptionReceiptAddress,
        recipientAddress: plan.recipientAddress, unitReservationAddress: plan.unitReservationAddress, holdingAddresses: plan.holdingAddresses,
        sourceHash: redemptionSourceHash(plan.actionAddress, plan.entitlementAddress, view.snapshotHash, tokenAccounts),
        tokenAccounts: [{ address: source.address, walletAddress: source.walletAddress, balanceAtSnapshot: source.balanceAtSnapshot,
          burnAmount: "1", balanceBefore: "5", expectedBalanceAfter: "4" }] };
    }));
    const sequentialView = { ...view, currentTokenSupply: "0", paid: 2, payable: 2, items };
    const sequentialReceipt = { ...receipt, entitlements: items.map((row, index) => ({ entitlementId: row.id, investorId: row.investorId,
      amountMinor: row.amountMinor, tokensRedeemed: row.tokensToRedeem, settlement: {
        ...receipt.entitlements[0]!.settlement, receiver: row.receiver, sourceHash: row.sourceHash, receiptAddress: row.redemptionReceiptAddress,
        tokenAccounts: row.tokenAccounts, supplyBefore: String(10 - index), supplyAfter: String(9 - index),
        unitReservation: { ...reservation, unitReservationAddress: row.unitReservationAddress, sourceHash: row.sourceHash, allocations: ["1"],
          holdings: row.tokenAccounts.map((source, sourceIndex) => ({ address: row.holdingAddresses[sourceIndex], tokenAccount: source.address,
            walletAddress: source.walletAddress, reservedTokens: "0" })) },
      } })).reverse() };
    assert.equal(await finalizedRedemptionReceipt(response(sequentialReceipt), sequentialView), JSON.stringify(sequentialReceipt));
    for (const [label, supplyBefore, supplyAfter] of [["overlapping burn steps", "10", "9"], ["gapped burn steps", "8", "7"]] as const) {
      await t.test(label, async () => {
        const changed = structuredClone(sequentialReceipt); Object.assign(changed.entitlements[0]!.settlement, { supplyBefore, supplyAfter });
        await assert.rejects(finalizedRedemptionReceipt(response(changed), sequentialView));
      });
    }
  });
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

test("exact v2 receipt reconciles allocation and rejects hash-valid target, quota or supply corruption", async () => {
  const { view } = await fixture("FINALIZE");
  Object.assign(view, { redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "2",
    snapshotSupply: "10", totalBalance: "10", currentTokenSupply: "8" });
  view.items[0]!.exactAllocation = { balanceAtRecordDate: "10", tieAddress: key(11) };
  const original = { schemaVersion: "redemption-action-receipt-v2", actionId: id, actionType: "EARLY_REDEMPTION",
    allocation: { policy: "exact-target-largest-remainder-v2", targetTokens: "2", totalBalance: "10", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" },
    snapshot: { hash: view.snapshotHash, mintSupply: "10" }, totalTokensRedeemed: "2", finalSupply: "8",
    entitlements: [{ investorId: id, entitlementId: id, tokensRedeemed: "2", amountMinor: "2000000000",
      allocation: { tieAddress: key(11), remainingTokens: "8", roundingRemainder: "0", denominator: "10" } }] };
  const signedDocument = (data: unknown) => {
    const canonicalJson = JSON.stringify(data);
    return { actionId: id, status: "FINALIZED", onchainPda: view.actionReceiptAddress, signature, canonicalJson,
      sha256: createHash("sha256").update(canonicalJson).digest("hex") };
  };
  assert.equal(redemptionExecutionView(view as unknown as Record<string, unknown>, id, view.actionType), view);
  assert.equal(await finalizedRedemptionReceipt(signedDocument(original), view), JSON.stringify(original));
  // Later actions may change live supply; this receipt still describes its immutable snapshot.
  assert.equal(await finalizedRedemptionReceipt(signedDocument(original), { ...view, currentTokenSupply: "5" }), JSON.stringify(original));
  for (const change of ["target", "quota", "supply", "ties", "coverage", "version", "amount", "snapshot", "owner", "coherentBalance"] as const) {
    const document = structuredClone(original);
    if (change === "target") document.allocation.targetTokens = "3";
    if (change === "quota") document.entitlements[0]!.allocation.roundingRemainder = "1";
    if (change === "supply") document.finalSupply = "9";
    if (change === "ties") document.allocation.tieBreak = "PAYMENT_RECEIVER_ASC";
    if (change === "coverage") document.entitlements.push(structuredClone(document.entitlements[0]!));
    if (change === "version") document.schemaVersion = "redemption-action-receipt-v1";
    if (change === "amount") document.entitlements[0]!.amountMinor = "1";
    if (change === "snapshot") document.snapshot.hash = "cd".repeat(32);
    if (change === "owner") document.entitlements[0]!.allocation.tieAddress = key(20);
    if (change === "coherentBalance") {
      document.allocation.totalBalance = "20"; document.snapshot.mintSupply = "20"; document.finalSupply = "18";
      document.entitlements[0]!.allocation.denominator = "20"; document.entitlements[0]!.allocation.remainingTokens = "18";
    }
    await assert.rejects(finalizedRedemptionReceipt(signedDocument(document), view));
  }
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(original), { ...view, redemptionTargetTokens: "3" }));
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(original), { ...view, actionType: "BOND_REDEMPTION" }));
  const missingSupply = structuredClone(view); delete missingSupply.snapshotSupply;
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(original), missingSupply));
  const missingOwner = structuredClone(view);
  for (const item of missingOwner.items) delete item.exactAllocation;
  assert.throws(() => redemptionExecutionView(missingOwner as unknown as Record<string, unknown>, id, view.actionType));
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(original), missingOwner));
});

test("exact receipts bind zero-allocation rows to their independent snapshot balances and owners", async () => {
  const { view } = await fixture("FINALIZE"); const originalItem = view.items[0]!;
  Object.assign(view, { redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "1",
    snapshotSupply: "3", totalBalance: "3", currentTokenSupply: "2", totalAmountMinor: "1000" });
  const owners = [key(11), key(12), key(13)].sort();
  view.items = owners.map((tieAddress, index) => ({ ...originalItem,
    id: `00000000-0000-4000-8000-00000000000${index + 1}`, investorId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    tokensToRedeem: index === 0 ? "1" : "0", amountMinor: index === 0 ? "1000" : "0",
    status: index === 0 ? "REDEEMED" : "NOT_ELIGIBLE_ZERO_ROUNDING", signature: index === 0 ? signature : null,
    exactAllocation: { balanceAtRecordDate: "1", tieAddress }, tokenAccounts: index === 0 ? [{
      address: key(9), walletAddress: tieAddress, balanceAtSnapshot: "1", burnAmount: "1", balanceBefore: "1", expectedBalanceAfter: "0"
    }] : [] }));
  assert.equal(redemptionExecutionView(view as unknown as Record<string, unknown>, id, view.actionType), view);
  const document = { schemaVersion: "redemption-action-receipt-v2", actionId: id, actionType: view.actionType,
    allocation: { policy: view.redemptionAllocationPolicy, targetTokens: "1", totalBalance: "3", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" },
    snapshot: { hash: view.snapshotHash, mintSupply: "3" }, totalTokensRedeemed: "1", finalSupply: "2",
    entitlements: view.items.map((item, index) => ({ investorId: item.investorId, entitlementId: item.id,
      tokensRedeemed: item.tokensToRedeem, amountMinor: item.amountMinor, allocation: {
        tieAddress: item.exactAllocation!.tieAddress, remainingTokens: index === 0 ? "0" : "1", roundingRemainder: "1", denominator: "3"
      } })) };
  const signedDocument = (value: unknown) => { const canonicalJson = JSON.stringify(value); return {
    actionId: id, status: "FINALIZED", onchainPda: view.actionReceiptAddress, signature, canonicalJson,
    sha256: createHash("sha256").update(canonicalJson).digest("hex")
  }; };
  assert.equal(await finalizedRedemptionReceipt(signedDocument(document), view), JSON.stringify(document));
  const changedOwner = structuredClone(document); changedOwner.entitlements[2]!.allocation.tieAddress = key(20);
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(changedOwner), view));
  const coherentBalance = structuredClone(document);
  coherentBalance.allocation.totalBalance = "2"; coherentBalance.snapshot.mintSupply = "2"; coherentBalance.finalSupply = "1";
  for (const item of coherentBalance.entitlements) item.allocation.denominator = "2";
  coherentBalance.entitlements[2]!.allocation.remainingTokens = "0"; coherentBalance.entitlements[2]!.allocation.roundingRemainder = "0";
  await assert.rejects(finalizedRedemptionReceipt(signedDocument(coherentBalance), view));
  const missingZeroOwner = { ...view, items: view.items.map((item, index) => index === 2 ? { ...item, exactAllocation: undefined } : item) };
  assert.throws(() => redemptionExecutionView(missingZeroOwner as unknown as Record<string, unknown>, id, view.actionType));
});

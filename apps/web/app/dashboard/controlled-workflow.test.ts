import assert from "node:assert/strict";
import test from "node:test";
import { buildControlledCaptureAbort, buildControlledCaptureBegin, buildControlledCaptureFinish, buildControlledCaptureRecord,
  buildControlledHoldingRegistration, buildControlledInstrumentActivation, buildControlledInstrumentInitialization, buildControlledMintSetup,
  buildControlledTransfer, createAssociatedTokenAccountIdempotent, associatedTokenAccount, encodePublicKey,
  serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { reviewedDeploymentPlan, type DeploymentInstrument, type DeploymentPhase } from "./instrument-deployment-workflow";
import { controlledCaptureView, preparedControlledCapture, recoverCaptureAttempt, requireControlledSnapshot, type CapturePhase, type ControlledCaptureView } from "./controlled-capture-workflow";
import { uuidBytes } from "./controlled-identity";
import type { CorporateActionView } from "./action-workflow";
import { preparedSnapshot } from "./snapshot-workflow";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3), programId = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const instrumentId = "00000000-0000-4000-8000-000000000001", actionId = "00000000-0000-4000-8000-000000000002";
const operationId = "00000000-0000-4000-8000-000000000003", investorId = "00000000-0000-4000-8000-000000000004";
const configuration = { programId, networkGenesisHash: key(7) };
const identity = { programId, instrumentId: uuidBytes(instrumentId), actionId: uuidBytes(actionId), corporateActionAuthority: signer };
const serialize = (instructions: readonly SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
async function issuanceFixture(phase: DeploymentPhase) {
  const instrument: DeploymentInstrument = { id: instrumentId, issuerAuthority: signer, complianceAuthority: signer, corporateActionAuthority: signer,
    tokenPolicy: "CONTROLLED_FROZEN_V2", programId: null, network: "SOLANA_LOCALNET", faceValueMinor: "1000000000", couponRateBps: 1000,
    paymentsPerYear: 2, issueAt: "2026-10-12T00:00:00.000Z", maturityAt: "2027-10-12T00:00:00.000Z", totalSupply: "35", mintAddress: null };
  const mint = await buildControlledMintSetup({ ...identity, administrator: signer, bondRentLamports: 1_000_000n, settlementRentLamports: 2_000_000n, totalSupply: 35n });
  const wallets = [key(11), key(12), key(13)];
  const allocations = await Promise.all(["10", "20", "5"].map(async (amount, index) => ({ amount, investorId: `00000000-0000-4000-8000-00000000000${index + 5}`, walletAddress: wallets[index]!, tokenAccount: await associatedTokenAccount(wallets[index]!, mint.bondMint) })));
  let instructions: readonly SolanaInstructionPlan[];
  if (phase === "MINT_SETUP") instructions = mint.instructions;
  else if (phase === "INITIALIZE") instructions = (await buildControlledInstrumentInitialization({ ...identity, administrator: signer, bondMint: mint.bondMint, settlementMint: mint.settlementMint,
    complianceAuthority: signer, corporateActionAuthority: signer, faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2, issueAt: BigInt(Date.parse(instrument.issueAt) / 1000), maturityAt: BigInt(Date.parse(instrument.maturityAt) / 1000), totalSupply: 35n })).instructions;
  else if (phase === "ACTIVATE") instructions = (await buildControlledInstrumentActivation({ ...identity, issuerAuthority: signer, bondMint: mint.bondMint, holderTokenAccounts: allocations.map(row => row.tokenAccount) })).instructions;
  else {
    const prepared: SolanaInstructionPlan[] = [(await buildControlledHoldingRegistration({ ...identity, bondTokenAccount: mint.treasuryTokenAccount })).instruction];
    for (const row of allocations) {
      prepared.push(createAssociatedTokenAccountIdempotent(signer, row.tokenAccount, row.walletAddress, mint.bondMint),
        (await buildControlledHoldingRegistration({ ...identity, bondTokenAccount: row.tokenAccount })).instruction,
        (await buildControlledTransfer({ ...identity, holder: signer, bondMint: mint.bondMint, sourceTokenAccount: mint.treasuryTokenAccount, destinationTokenAccount: row.tokenAccount, amount: BigInt(row.amount) })).instruction);
    }
    instructions = prepared;
  }
  const payload = { operationId, phase, cluster: "localnet", requiredSigner: signer, networkGenesisHash: key(7), instrumentId, programId,
    tokenPolicy: "CONTROLLED_FROZEN_V2", transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", lastValidBlockHeight: 100,
    terms: { issuerAuthority: signer, complianceAuthority: signer, corporateActionAuthority: signer, faceValueMinor: instrument.faceValueMinor, couponRateBps: 1000,
      paymentsPerYear: 2, issueAt: instrument.issueAt, maturityAt: instrument.maturityAt, totalSupply: "35" },
    bondMint: mint.bondMint, settlementMint: mint.settlementMint, treasuryTokenAccount: mint.treasuryTokenAccount,
    instrumentAddress: mint.instrumentAddress, controlledPolicyAddress: mint.controlledPolicyAddress,
    ...(phase === "MINT_SETUP" ? { rent: { bondRentLamports: "1000000", settlementRentLamports: "2000000" } } : {}),
    ...(["DISTRIBUTION", "ACTIVATE"].includes(phase) ? { allocations } : {}), serializedTransactionBase64: serialize(instructions) };
  return { instrument, payload, instructions, allocations };
}
test("governed issuance independently matches all four production transaction phases", async () => {
  for (const phase of ["MINT_SETUP", "INITIALIZE", "DISTRIBUTION", "ACTIVATE"] as const) {
    const f = await issuanceFixture(phase);
    assert.equal((await reviewedDeploymentPlan(f.payload, f.instrument, signer, configuration, f.allocations)).phase, phase);
  }
});
test("governed issuance rejects coordinated identity, terms, mint and network substitutions", async () => {
  const f = await issuanceFixture("INITIALIZE");
  for (const change of [{ programId: key(20) }, { tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, { networkGenesisHash: key(20) },
    { instrumentAddress: key(20) }, { controlledPolicyAddress: key(20) }, { bondMint: key(20) }, { terms: { ...f.payload.terms, faceValueMinor: "1" } }]) {
    await assert.rejects(reviewedDeploymentPlan({ ...f.payload, ...change }, f.instrument, signer, configuration));
  }
  await assert.rejects(reviewedDeploymentPlan(f.payload, f.instrument, signer, null));
});
test("governed issuance rejects changed token instructions, authority, writable privileges and hidden instructions", async () => {
  for (const phase of ["MINT_SETUP", "INITIALIZE", "DISTRIBUTION", "ACTIVATE"] as const) {
    const f = await issuanceFixture(phase); const original = f.instructions[f.instructions.length - 1]!;
    const data = Uint8Array.from(original.data); data[0] = data[0]! ^ 1;
    const privilegeIndex = phase === "INITIALIZE" ? 3 : phase === "DISTRIBUTION" ? 2 : 1;
    for (const changed of [{ ...original, data }, { ...original, accounts: original.accounts.map((value, index) => index === privilegeIndex ? { ...value, address: key(20) } : value) },
      { ...original, accounts: original.accounts.map((value, index) => index === privilegeIndex ? { ...value, isWritable: !value.isWritable } : value) }]) {
      await assert.rejects(reviewedDeploymentPlan({ ...f.payload, serializedTransactionBase64: serialize([...f.instructions.slice(0, -1), changed]) }, f.instrument, signer, configuration, f.allocations));
    }
    if (phase !== "DISTRIBUTION") await assert.rejects(reviewedDeploymentPlan({ ...f.payload, serializedTransactionBase64: serialize([...f.instructions, original]) }, f.instrument, signer, configuration, f.allocations));
  }
});
test("distribution compares selected wallets before accepting metadata and refuses a policy downgrade", async () => {
  const f = await issuanceFixture("DISTRIBUTION");
  await assert.rejects(reviewedDeploymentPlan(f.payload, f.instrument, signer, configuration, f.allocations.map((row, index) => index === 0 ? { ...row, walletAddress: key(20) } : row)));
  await assert.rejects(reviewedDeploymentPlan(f.payload, { ...f.instrument, tokenPolicy: "LEGACY_UNRESTRICTED_V1" }, signer, configuration, f.allocations));
});

async function captureFixture(phase: CapturePhase, coupon = false) {
  const plan = phase === "BEGIN" ? await buildControlledCaptureBegin(identity) : phase === "ABORT" ? await buildControlledCaptureAbort(identity) : await buildControlledCaptureFinish({ ...identity, investorIds: coupon ? [] : [uuidBytes(investorId)] });
  const view: ControlledCaptureView = { actionId, instrumentId, tokenPolicy: "CONTROLLED_FROZEN_V2", enabled: true, cluster: "localnet", networkGenesisHash: key(7), requiredSigner: signer, programId,
    instrumentAddress: plan.instrumentAddress, actionAddress: plan.actionAddress, controlledPolicyAddress: plan.controlledPolicyAddress, controlledCaptureAddress: plan.controlledCaptureAddress, bondMint: key(4),
    investorIds: coupon || phase !== "FINISH" ? [] : [investorId], capture: phase === "BEGIN" ? null : { startedSlot: "10", startedAt: "1791763200", committed: phase === "FINISH", finished: false }, readiness: { begin: true, finish: true, abort: true }, pending: null };
  const payload = { ...view, corporateActionId: actionId, operationId, phase, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", lastValidBlockHeight: 100, status: "PREPARED", signature: null, serializedTransactionBase64: serialize(plan.instructions) };
  return { view, payload, plan };
}
test("capture begin, finish and abort match production instructions and complete ordered reservation coverage", async () => {
  for (const phase of ["BEGIN", "FINISH", "ABORT"] as const) {
    const f = await captureFixture(phase);
    assert.equal((await preparedControlledCapture(f.payload, f.view, signer, f.view.investorIds)).phase, phase);
  }
  const coupon = await captureFixture("FINISH", true);
  assert.equal((await preparedControlledCapture(coupon.payload, coupon.view, signer, [])).phase, "FINISH");
  const f = await captureFixture("FINISH");
  await assert.rejects(preparedControlledCapture(f.payload, f.view, signer, []));
});
test("capture review rejects changed canonical addresses, metadata, privilege escalation and hidden instructions", async () => {
  const f = await captureFixture("BEGIN");
  for (const change of [{ controlledPolicyAddress: key(20) }, { instrumentId: investorId }, { bondMint: key(20) }, { networkGenesisHash: key(20) }]) {
    await assert.rejects(preparedControlledCapture({ ...f.payload, ...change }, f.view, signer));
  }
  const selected = { id: actionId, instrumentId, instrument: { tokenPolicy: "CONTROLLED_FROZEN_V2", programId, corporateActionAuthority: signer, network: "SOLANA_LOCALNET", mintAddress: key(4), networkGenesisHash: key(7) } } as CorporateActionView;
  assert.equal((await controlledCaptureView(f.view as unknown as Record<string, unknown>, selected)).controlledCaptureAddress, f.view.controlledCaptureAddress);
  await assert.rejects(controlledCaptureView({ ...f.view, controlledCaptureAddress: key(20) }, selected));
  for (const instruction of [{ ...f.plan.instruction, accounts: f.plan.instruction.accounts.map((value, index) => index === 1 ? { ...value, isWritable: true } : value) },
    { ...f.plan.instruction, accounts: f.plan.instruction.accounts.map((value, index) => index === 1 ? { ...value, address: key(20) } : value) }]) {
    await assert.rejects(preparedControlledCapture({ ...f.payload, serializedTransactionBase64: serialize([instruction]) }, f.view, signer));
  }
  await assert.rejects(preparedControlledCapture({ ...f.payload, serializedTransactionBase64: serialize([...f.plan.instructions, f.plan.instruction]) }, f.view, signer));
});
test("capture recovery retains a locally signed attempt through a lost submission and blocks conflicting wire or signatures", async () => {
  const f = await captureFixture("BEGIN"); const signature = "1".repeat(64);
  const local = { operationId, wire: f.payload.serializedTransactionBase64, signature, sent: true };
  assert.deepEqual(recoverCaptureAttempt(f.payload, local), { signature, sent: true });
  assert.deepEqual(recoverCaptureAttempt({ ...f.payload, status: "UNKNOWN_CONFIRMATION", signature }, null), { signature, sent: true });
  for (const change of [{ operationId: actionId }, { serializedTransactionBase64: "changed" }, { status: "SUBMITTED", signature: "2".repeat(64) }]) {
    assert.throws(() => recoverCaptureAttempt({ ...f.payload, ...change }, local));
  }
});
test("controlled record verifies every actual holder source, sidecar and capture slot in the wire", async () => {
  const f = await captureFixture("ABORT"); const holderTokenAccounts = [key(9), key(10)];
  const snapshotHash = "ab".repeat(32);
  const plan = await buildControlledCaptureRecord({ ...identity, bondMint: key(4), holderTokenAccounts, snapshotHash, snapshotSlot: 10n, investorCount: 1, walletCount: 2, totalBalance: 35n, mintSupply: 35n });
  const payload = { ...f.payload, snapshotId: investorId, snapshotHash, recordPointMode: "DEMO_CAPTURE_SLOT", recordAt: "2026-10-12T00:00:00.000Z", effectiveBlockTime: "2026-10-12T00:00:00.000Z", effectiveSlot: "10",
    investorCount: 1, walletCount: 2, totalBalance: "35", mintSupply: "35", holderTokenAccounts, serializedTransactionBase64: serialize(plan.instructions) };
  const prepared = preparedSnapshot(payload, actionId, signer); await requireControlledSnapshot(prepared, payload, f.view);
  for (const change of [{ holderTokenAccounts: [key(9)] }, { totalBalance: "34" }, { effectiveSlot: "11" }, { controlledCaptureAddress: key(20) }]) {
    await assert.rejects(requireControlledSnapshot({ ...prepared, ...change }, { ...payload, ...change }, f.view));
  }
  const changed = { ...plan.instruction, accounts: plan.instruction.accounts.map((value, index) => index === plan.instruction.accounts.length - 1 ? { ...value, address: key(20) } : value) };
  await assert.rejects(requireControlledSnapshot({ ...prepared, serializedTransactionBase64: serialize([changed]) }, payload, f.view));
});

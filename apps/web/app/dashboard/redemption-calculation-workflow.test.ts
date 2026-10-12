import assert from "node:assert/strict";
import test from "node:test";
import { buildCalculationFinalization, buildCalculationReset, buildEntitlementRegistration, buildRedemptionSourceRegistration,
  encodePublicKey, serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { buildControlledRedemptionSourceRegistration, buildControlledUnitReservation } from "@lifecycle-kase/solana-client";
import { requireRedemptionCalculationTransaction } from "./redemption-calculation-workflow";
import { preparedOnchainCalculation } from "./onchain-entitlement-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
const id = "00000000-0000-4000-8000-000000000001";
const investorId = "00000000-0000-4000-8000-000000000003";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3);
const investorBytes = Uint8Array.from(Buffer.from(investorId.replace(/-/g, ""), "hex"));
async function fixture(phase: "REGISTER" | "FINALIZE" | "RESET" | "RESERVE_UNITS" = "REGISTER", exact = false, controlled = false) {
  const instrumentId = "00000000-0000-4000-8000-000000000005";
  const uuid = (value: string) => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
  const identity = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: exact || controlled ? uuid(instrumentId) : new Uint8Array(16).fill(1),
    actionId: exact || controlled ? uuid(id) : new Uint8Array(16).fill(2), corporateActionAuthority: signer,
    ...(exact ? { allocationPolicy: "exact-target-largest-remainder-v2" as const } : {}) };
  const snapshotHash = "ab".repeat(32);
  const accounts = [{ address: key(9), wallet: key(11), balanceAtSnapshot: 5n }, { address: key(10), wallet: key(12), balanceAtSnapshot: 5n }]
    .sort((a, b) => a.address < b.address ? -1 : 1);
  const register = await buildEntitlementRegistration({ ...identity, investorId: investorBytes, snapshotHash, settlementWallet: key(6),
    balanceAtSnapshot: 10n, eligible: true, paymentAmountMinor: 2_000_000_000n, tokensToRedeem: 2n });
  const sources = await (controlled ? buildControlledRedemptionSourceRegistration : buildRedemptionSourceRegistration)({ ...identity, investorId: investorBytes, bondMint: key(4), tokenAccounts: accounts, snapshotHash });
  const unit = await buildControlledUnitReservation({ ...identity, investorId: investorBytes, bondMint: key(4), tokenAccounts: accounts, snapshotHash });
  const final = await buildCalculationFinalization({ ...identity, investorIds: [investorBytes], redemption: true });
  const reset = await buildCalculationReset({ ...identity, investorIds: [investorBytes], redemption: true });
  const instructions = phase === "REGISTER" ? [register.instruction, sources.instruction] : [phase === "RESERVE_UNITS" ? unit.instruction : phase === "FINALIZE" ? final.instruction : reset.instruction];
  const serialize = (value: SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions: value, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
  const tokenAccounts = accounts.map(source => ({ address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString() }));
  const view: EntitlementsView = { actionId: id, actionVersion: 4, actionType: "EARLY_REDEMPTION", tokenMint: key(4), status: "UNDER_REVIEW",
    totalEntitlementMinor: "2000000000", eligibleHolders: 1, approvedById: null, approvedAt: null, reviewNote: null,
    onchainRegistrationEnabled: true, onchainCalculationFinalized: phase === "RESERVE_UNITS", investors: [], items: [{ id, investorId,
      onchainPda: phase === "REGISTER" ? null : register.entitlementAddress, settlementWalletAddress: key(6), balanceAtRecordDate: "10", amountMinor: "2000000000",
      tokensToRedeem: "2", status: "CALCULATED", eligibilityReason: "LOCAL_DEMO_ELIGIBLE", formulaVersion: "integer-entitlements-v1",
      currentEligibility: { eligible: true, reason: "LOCAL_DEMO_ELIGIBLE" }, redemptionSources: tokenAccounts,
      calculationInputs: { snapshotHash, balance: "10", faceValueMinor: "1000000000", couponRateBps: 1000, paymentsPerYear: 2,
        redemptionPercentageBps: 2000, redemptionPriceMinor: "1000000000", roundingRemainder: "0", denominator: "10000" } }] };
  if (exact || controlled) {
    view.instrumentId = instrumentId; view.programId = identity.programId; view.network = "SOLANA_LOCALNET";
    view.networkGenesisHash = key(7); view.corporateActionAuthority = signer;
  }
  if (controlled) view.tokenPolicy = "CONTROLLED_FROZEN_V2";
  if (exact) {
    view.redemptionAllocationPolicy = "exact-target-largest-remainder-v2"; view.redemptionTargetTokens = "2";
    view.exactRedemptionSummary = { policy: "exact-target-largest-remainder-v2", targetTokens: "2", allocatedTokens: "2",
      totalBalance: "10", remainingTokens: "8", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" };
    const row = view.items[0]!; row.formulaVersion = "exact-target-largest-remainder-v2";
    Object.assign(row.calculationInputs, { redemptionPercentageBps: null, denominator: "10",
      allocationPolicy: "exact-target-largest-remainder-v2", targetTokens: "2", totalBalance: "10",
      remainingTokens: "8", tieAddress: accounts.map(source => source.wallet).sort()[0] });
  }
  const payload = { corporateActionId: id, actionVersion: 4, operationId: "00000000-0000-4000-8000-000000000002", phase, cluster: "localnet",
    requiredSigner: signer, networkGenesisHash: key(7), programId: identity.programId, instrumentAddress: register.instrumentAddress,
    actionAddress: register.actionAddress, snapshotHash, redemptionProgressAddress: sources.progressAddress,
    ...(controlled ? { tokenPolicy: "CONTROLLED_FROZEN_V2", controlledPolicyAddress: unit.controlledPolicyAddress, controlledCaptureAddress: unit.controlledCaptureAddress } : {}),
    ...(exact ? { redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "2",
      ...(phase !== "RESET" ? { targetAddress: register.targetAddress } : {}) } : {}),
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: serialize(instructions), lastValidBlockHeight: 100,
    ...(phase === "REGISTER" || phase === "RESERVE_UNITS" ? { entitlementId: id, entitlementAddress: register.entitlementAddress, investorId, settlementWallet: key(6), balanceAtSnapshot: "10",
      paymentAmountMinor: "2000000000", tokensToRedeem: "2", entitlementStatus: "CALCULATED", bondMint: key(4), tokenAccounts,
      sourceHash: sources.sourceHash, redemptionSourcesAddress: sources.sourceAddress,
      ...(phase === "RESERVE_UNITS" ? { unitReservationAddress: unit.unitReservationAddress, holdingAddresses: unit.holdingAddresses, allocations: ["2", "0"] } : {}) } :
      { entitlementAddresses: final.entitlementAddresses, sourceAddresses: final.sourceAddresses, entitlementCount: 1, totalAmountMinor: "2000000000" }) };
  return { view, payload, instructions, serialize };
}
test("registration commits exact production snapshot source bytes and finalization/reset require the ordered full set", async () => {
  for (const phase of ["REGISTER", "FINALIZE", "RESET"] as const) {
    const { view, payload } = await fixture(phase);
    const plan = preparedOnchainCalculation(payload, view, signer, signer);
    await requireRedemptionCalculationTransaction(plan, view);
  }
});
test("governed source registration and per-entitlement reservations independently bind the actual production wire", async () => {
  for (const phase of ["REGISTER", "FINALIZE", "RESERVE_UNITS"] as const) {
    const f = await fixture(phase, true, true); const plan = preparedOnchainCalculation(f.payload, f.view, signer, signer);
    await requireRedemptionCalculationTransaction(plan, f.view);
    for (const change of [{ controlledPolicyAddress: key(20) }, { controlledCaptureAddress: key(20) }, { tokenPolicy: "LEGACY_UNRESTRICTED_V1" as const }]) {
      await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, ...change }, f.view));
    }
  }
});
test("unit reservations protect only deterministic assigned amounts and retain zero markers", async () => {
  const f = await fixture("RESERVE_UNITS", false, true); const plan = preparedOnchainCalculation(f.payload, f.view, signer, signer);
  for (const change of [{ allocations: ["5", "0"] }, { unitReservationAddress: key(20) }, { holdingAddresses: [key(20), key(21)] }, { allocations: ["1", "1"] }]) {
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, ...change }, f.view));
  }
  const zeroView = { ...f.view, totalEntitlementMinor: "0", items: f.view.items.map(row => ({ ...row, tokensToRedeem: "0", amountMinor: "0", status: "NOT_ELIGIBLE_ZERO_ROUNDING" })) };
  const zeroPayload = { ...f.payload, tokensToRedeem: "0", paymentAmountMinor: "0", entitlementStatus: "NOT_ELIGIBLE_ZERO_ROUNDING", allocations: ["0", "0"] };
  await requireRedemptionCalculationTransaction(preparedOnchainCalculation(zeroPayload, zeroView, signer, signer), zeroView);
});

test("v2 calculation review derives every action, target, entitlement and source PDA from loaded identity", async () => {
  for (const phase of ["REGISTER", "FINALIZE", "RESET"] as const) {
    const f = await fixture(phase, true);
    const plan = preparedOnchainCalculation(f.payload, f.view, signer, signer);
    await requireRedemptionCalculationTransaction(plan, f.view);
    for (const field of ["instrumentAddress", "actionAddress", "redemptionProgressAddress",
      ...(phase === "REGISTER" ? ["entitlementAddress", "redemptionSourcesAddress", "targetAddress"] :
        phase === "FINALIZE" ? ["targetAddress"] : [])]) {
      const original = plan[field as keyof typeof plan] as string;
      const replacement = key(20);
      const instructions = f.instructions.map(instruction => ({ ...instruction, accounts: instruction.accounts.map(account =>
        account.address === original ? { ...account, address: replacement } : account) }));
      await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, [field]: replacement,
        serializedTransactionBase64: f.serialize(instructions) }, f.view));
    }
    const foreignProgram = key(20);
    const foreignWire = f.serialize(f.instructions.map(instruction => ({ ...instruction, programId: foreignProgram })));
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, programId: foreignProgram,
      serializedTransactionBase64: foreignWire }, f.view));
    if (phase !== "REGISTER") {
      const replacement = key(21), original = plan.sourceAddresses![0]!;
      const wire = f.serialize(f.instructions.map(instruction => ({ ...instruction, accounts: instruction.accounts.map(account =>
        account.address === original ? { ...account, address: replacement } : account) })));
      await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, sourceAddresses: [replacement], serializedTransactionBase64: wire }, f.view));
    }
  }
});

test("v2 calculation cannot sign with missing independent identity or mismatched network and authority", async () => {
  const f = await fixture("REGISTER", true);
  const plan = preparedOnchainCalculation(f.payload, f.view, signer, signer);
  for (const field of ["programId", "instrumentId", "network", "networkGenesisHash", "corporateActionAuthority"] as const) {
    const missing = { ...f.view }; delete missing[field];
    assert.throws(() => preparedOnchainCalculation(f.payload, missing, signer, signer));
    await assert.rejects(requireRedemptionCalculationTransaction(plan, missing));
  }
  for (const changed of [{ cluster: "devnet" as const }, { networkGenesisHash: key(20) }, { requiredSigner: key(20) }]) {
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, ...changed }, f.view));
  }
});
test("source registration rejects changed snapshot accounts, owners, balances, commitment or hidden instructions", async () => {
  const { view, payload, instructions, serialize } = await fixture();
  const plan = preparedOnchainCalculation(payload, view, signer, signer);
  for (const changed of [{ bondMint: key(20) }, { sourceHash: "cd".repeat(32) }, { redemptionSourcesAddress: key(20) },
    { tokenAccounts: [...plan.tokenAccounts!].reverse() }, { tokenAccounts: plan.tokenAccounts!.map(source => ({ ...source, walletAddress: key(20) })) },
    { tokenAccounts: plan.tokenAccounts!.map(source => ({ ...source, balanceAtSnapshot: "6" })) }]) {
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, ...changed }, view));
  }
  const last = instructions[1]!;
  const data = Uint8Array.from(last.data); data[data.length - 1] = data[data.length - 1]! ^ 1;
  for (const instruction of [{ ...last, data }, { ...last, accounts: last.accounts.map((account, index) => index === last.accounts.length - 1 ? { ...account, address: key(20) } : account) },
    { ...last, accounts: last.accounts.map((account, index) => index === last.accounts.length - 1 ? { ...account, isWritable: true } : account) }]) {
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, serializedTransactionBase64: serialize([instructions[0]!, instruction]) }, view));
  }
  await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, serializedTransactionBase64: serialize([...instructions, instructions[0]!]) }, view));
});
test("redemption finalization and reset reject omitted, reordered or changed source/progress accounts", async () => {
  for (const phase of ["FINALIZE", "RESET"] as const) {
    const { view, payload, instructions, serialize } = await fixture(phase);
    const plan = preparedOnchainCalculation(payload, view, signer, signer);
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, sourceAddresses: [] }, view));
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, redemptionProgressAddress: key(20) }, view));
    const instruction = instructions[0]!;
    const changed = { ...instruction, accounts: instruction.accounts.map((account, index) => index === instruction.accounts.length - 1 ? { ...account, address: key(20) } : account) };
    await assert.rejects(requireRedemptionCalculationTransaction({ ...plan, serializedTransactionBase64: serialize([changed]) }, view));
  }
});

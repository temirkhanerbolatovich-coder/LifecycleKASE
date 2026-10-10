import assert from "node:assert/strict";
import test from "node:test";
import { buildCalculationFinalization, buildCalculationReset, buildEntitlementRegistration, buildRedemptionSourceRegistration,
  encodePublicKey, serializeUnsignedInstructionsTransaction, type SolanaInstructionPlan } from "@lifecycle-kase/solana-client";
import { requireRedemptionCalculationTransaction } from "./redemption-calculation-workflow";
import { preparedOnchainCalculation } from "./onchain-entitlement-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
const id = "00000000-0000-4000-8000-000000000001";
const investorId = "00000000-0000-4000-8000-000000000003";
const key = (value: number) => encodePublicKey(new Uint8Array(32).fill(value));
const signer = key(3);
const investorBytes = Uint8Array.from(Buffer.from(investorId.replace(/-/g, ""), "hex"));
async function fixture(phase: "REGISTER" | "FINALIZE" | "RESET" = "REGISTER") {
  const identity = { programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2), corporateActionAuthority: signer };
  const snapshotHash = "ab".repeat(32);
  const accounts = [{ address: key(9), wallet: key(11), balanceAtSnapshot: 5n }, { address: key(10), wallet: key(12), balanceAtSnapshot: 5n }]
    .sort((a, b) => a.address < b.address ? -1 : 1);
  const register = await buildEntitlementRegistration({ ...identity, investorId: investorBytes, snapshotHash, settlementWallet: key(6),
    balanceAtSnapshot: 10n, eligible: true, paymentAmountMinor: 2_000_000_000n, tokensToRedeem: 2n });
  const sources = await buildRedemptionSourceRegistration({ ...identity, investorId: investorBytes, bondMint: key(4), tokenAccounts: accounts, snapshotHash });
  const final = await buildCalculationFinalization({ ...identity, investorIds: [investorBytes], redemption: true });
  const reset = await buildCalculationReset({ ...identity, investorIds: [investorBytes], redemption: true });
  const instructions = phase === "REGISTER" ? [register.instruction, sources.instruction] : [phase === "FINALIZE" ? final.instruction : reset.instruction];
  const serialize = (value: SolanaInstructionPlan[]) => serializeUnsignedInstructionsTransaction({ instructions: value, feePayer: signer, recentBlockhash: key(8), lastValidBlockHeight: 100 });
  const tokenAccounts = accounts.map(source => ({ address: source.address, walletAddress: source.wallet, balanceAtSnapshot: source.balanceAtSnapshot.toString() }));
  const view: EntitlementsView = { actionId: id, actionVersion: 4, actionType: "EARLY_REDEMPTION", tokenMint: key(4), status: "UNDER_REVIEW",
    totalEntitlementMinor: "2000000000", eligibleHolders: 1, approvedById: null, approvedAt: null, reviewNote: null,
    onchainRegistrationEnabled: true, onchainCalculationFinalized: false, investors: [], items: [{ id, investorId,
      onchainPda: phase === "REGISTER" ? null : register.entitlementAddress, settlementWalletAddress: key(6), balanceAtRecordDate: "10", amountMinor: "2000000000",
      tokensToRedeem: "2", status: "CALCULATED", eligibilityReason: "LOCAL_DEMO_ELIGIBLE", formulaVersion: "integer-entitlements-v1",
      currentEligibility: { eligible: true, reason: "LOCAL_DEMO_ELIGIBLE" }, redemptionSources: tokenAccounts,
      calculationInputs: { snapshotHash, balance: "10", faceValueMinor: "1000000000", couponRateBps: 1000, paymentsPerYear: 2,
        redemptionPercentageBps: 2000, redemptionPriceMinor: "1000000000", roundingRemainder: "0", denominator: "10000" } }] };
  const payload = { corporateActionId: id, actionVersion: 4, operationId: "00000000-0000-4000-8000-000000000002", phase, cluster: "localnet",
    requiredSigner: signer, networkGenesisHash: key(7), programId: identity.programId, instrumentAddress: register.instrumentAddress,
    actionAddress: register.actionAddress, snapshotHash, redemptionProgressAddress: sources.progressAddress,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: serialize(instructions), lastValidBlockHeight: 100,
    ...(phase === "REGISTER" ? { entitlementId: id, entitlementAddress: register.entitlementAddress, investorId, settlementWallet: key(6), balanceAtSnapshot: "10",
      paymentAmountMinor: "2000000000", tokensToRedeem: "2", entitlementStatus: "CALCULATED", bondMint: key(4), tokenAccounts,
      sourceHash: sources.sourceHash, redemptionSourcesAddress: sources.sourceAddress } :
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

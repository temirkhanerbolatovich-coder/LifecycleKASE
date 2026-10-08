import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { encodePublicKey, serializeUnsignedInstructionsTransaction } from "@lifecycle-kase/solana-client";
import { preparedOnchainCalculation } from "./onchain-entitlement-workflow";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const actionId = "00000000-0000-4000-8000-000000000001";
const entitlementId = "00000000-0000-4000-8000-000000000002";
const investorId = "00000000-0000-4000-8000-000000000003";
const pair = generateKeyPairSync("ed25519");
const signer = encodePublicKey(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
const wire = serializeUnsignedInstructionsTransaction({ instructions: [{ programId: PROGRAM,
  accounts: [{ address: signer, isSigner: true, isWritable: true }], data: new Uint8Array([1]) }],
  feePayer: signer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 });
const view = { actionId, actionVersion: 4, status: "UNDER_REVIEW", totalEntitlementMinor: "500000000", eligibleHolders: 1,
  approvedById: null, approvedAt: null, reviewNote: null, onchainRegistrationEnabled: true, onchainCalculationFinalized: false,
  investors: [], items: [{ id: entitlementId, investorId, onchainPda: null, settlementWalletAddress: signer,
    balanceAtRecordDate: "10", amountMinor: "500000000", tokensToRedeem: "0", status: "CALCULATED",
    eligibilityReason: "LOCAL_DEMO_ELIGIBLE", formulaVersion: "integer-entitlements-v1", currentEligibility: { eligible: true, reason: "LOCAL_DEMO_ELIGIBLE" },
    calculationInputs: { snapshotHash: "ab".repeat(32), balance: "10", faceValueMinor: "1000000000", couponRateBps: 1000,
      paymentsPerYear: 2, redemptionPercentageBps: null, redemptionPriceMinor: null, roundingRemainder: "0", denominator: "20000" } }] };
const payload = { corporateActionId: actionId, actionVersion: 4, operationId: "00000000-0000-4000-8000-000000000004",
  phase: "REGISTER", cluster: "localnet", requiredSigner: signer, networkGenesisHash: "11111111111111111111111111111111",
  programId: PROGRAM, instrumentAddress: signer, actionAddress: signer, snapshotHash: "ab".repeat(32),
  transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", serializedTransactionBase64: wire, lastValidBlockHeight: 10,
  entitlementId, entitlementAddress: signer, investorId, settlementWallet: signer, balanceAtSnapshot: "10",
  paymentAmountMinor: "500000000", tokensToRedeem: "0", entitlementStatus: "CALCULATED" };

test("accepts an exact registration plan and rejects changed financial or authority facts", () => {
  assert.equal(preparedOnchainCalculation(payload, view, signer, signer).entitlementId, entitlementId);
  for (const change of [{ paymentAmountMinor: "500000001" }, { balanceAtSnapshot: "11" }, { settlementWallet: PROGRAM },
    { tokensToRedeem: "1" }, { entitlementStatus: "READY" }, { snapshotHash: "cd".repeat(32) }, { requiredSigner: PROGRAM },
    { actionVersion: 3 }, { entitlementId: actionId }]) {
    assert.throws(() => preparedOnchainCalculation({ ...payload, ...change }, view, signer, signer));
  }
});

test("finalization is available only after every entitlement has an on-chain PDA", () => {
  const finalPayload = { ...payload, phase: "FINALIZE", entitlementId: undefined, entitlementAddress: undefined,
    investorId: undefined, settlementWallet: undefined, balanceAtSnapshot: undefined, paymentAmountMinor: undefined,
    tokensToRedeem: undefined, entitlementStatus: undefined, entitlementAddresses: [signer], entitlementCount: 1, totalAmountMinor: "500000000" };
  assert.throws(() => preparedOnchainCalculation(finalPayload, view, signer, signer));
  const registered = { ...view, items: view.items.map(row => ({ ...row, onchainPda: signer })) };
  assert.equal(preparedOnchainCalculation(finalPayload, registered, signer, signer).phase, "FINALIZE");
  assert.throws(() => preparedOnchainCalculation({ ...finalPayload, entitlementAddresses: [PROGRAM] }, registered, signer, signer));
});

test("reset binds the exact confirmed partial set and amount", () => {
  const registered = { ...view, items: view.items.map(row => ({ ...row, onchainPda: signer })) };
  const resetPayload = { ...payload, phase: "RESET", entitlementId: undefined, entitlementAddress: undefined,
    investorId: undefined, settlementWallet: undefined, balanceAtSnapshot: undefined, paymentAmountMinor: undefined,
    tokensToRedeem: undefined, entitlementStatus: undefined, entitlementAddresses: [signer], entitlementCount: 1,
    totalAmountMinor: "500000000" };
  assert.equal(preparedOnchainCalculation(resetPayload, registered, signer, signer).phase, "RESET");
  assert.throws(() => preparedOnchainCalculation({ ...resetPayload, totalAmountMinor: "500000001" }, registered, signer, signer));
  assert.throws(() => preparedOnchainCalculation(resetPayload, view, signer, signer));
});

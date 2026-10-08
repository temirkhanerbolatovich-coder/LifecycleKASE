import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { entitlementAmounts, getEntitlements, requireFinalizedEntitlementSnapshot, requireApprovedEntitlements } from "./entitlements.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const terms = { faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2 };
test("stored entitlement calculations use investor totals, maturity final coupon, early floor and database bounds", () => {
  assert.equal(entitlementAmounts("COUPON_PAYMENT", 10n, terms, null, null).amountMinor, 500_000_000n);
  assert.equal(entitlementAmounts("BOND_REDEMPTION", 10n, terms, null, null).amountMinor, 10_500_000_000n);
  assert.deepEqual(entitlementAmounts("EARLY_REDEMPTION", 3n, terms, 2000, 1_000_000_000n), {
    amountMinor: 0n, tokensToRedeem: 0n, roundingRemainder: "6000", denominator: "10000" });
  assert.throws(() => entitlementAmounts("BOND_REDEMPTION", (1n << 63n) - 1n, { ...terms, faceValueMinor: 2n }, null, null));
});

function fixture() {
  const id = randomUUID(); const instrumentId = randomUUID(); const investorId = randomUUID(); const walletId = randomUUID();
  const key = "11111111111111111111111111111111"; const at = new Date("2026-10-02T12:00:00.000Z");
  const commitment = createSnapshotV2Commitment({ actionId: id, instrumentId, cluster: "localnet", networkGenesisHash: key,
    mintAddress: key, recordAt: at.toISOString(), blockTime: at.toISOString(), createdAt: at.toISOString(), solanaSlot: 10n,
    mintSupply: 10n, investors: [{ investorId, eligibilityStatus: "ELIGIBLE", wallets: [{ walletId, walletAddress: key,
      walletStatus: "ACTIVE", tokenAccounts: [{ address: key, balance: 10n }] }] }] });
  return { id, instrumentId, recordAt: at, status: "SNAPSHOT_CREATED", approvedById: null, approvedAt: null, reviewNote: null,
    totalEntitlementMinor: 0n, eligibleHolders: 0,
    instrument: { network: "SOLANA_LOCALNET", mintAddress: key }, entitlements: [], blockchainTransactions: [{ signature: "synthetic", status: "FINALIZED" }],
    snapshot: { id: randomUUID(), instrumentId, status: "FINALIZED", recordAt: at, blockTime: at, createdAt: at,
      networkGenesisHash: key, solanaSlot: 10n, snapshotHash: Buffer.from(commitment.sha256, "hex"), canonicalJson: commitment.snapshot,
      mintSupply: 10n, totalBalance: 10n, investorCount: 1, walletCount: 1,
      investors: [{ investorId, balance: 10n, eligibilityStatus: "ELIGIBLE", wallets: [{ walletId, walletAddress: key,
        walletStatus: "ACTIVE", balance: 10n, tokenAccounts: [{ address: key, balance: 10n }] }] }] } };
}
test("calculation requires finalized registration and verifies canonical hash, relational amounts and metadata", () => {
  const action = fixture(); assert.equal(requireFinalizedEntitlementSnapshot(action as never), Buffer.from(action.snapshot.snapshotHash).toString("hex"));
  for (const change of [() => action.snapshot.status = "PENDING_REGISTRATION", () => action.snapshot.snapshotHash.fill(0),
    () => action.snapshot.investors[0]!.balance = 11n, () => action.snapshot.walletCount = 2, () => action.blockchainTransactions.length = 0]) {
    const previous = structuredClone(action); change();
    assert.throws(() => requireFinalizedEntitlementSnapshot(action as never)); Object.assign(action, previous);
  }
});
test("execution gate blocks snapshot-created/calculated/unreviewed actions even when their snapshot is finalized", async () => {
  const action = fixture(); const database = { corporateAction: { findUnique: async () => action } };
  for (const status of ["SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "REJECTED", "APPROVED"]) {
    action.status = status;
    await assert.rejects(requireApprovedEntitlements(database as never, action.id),
      (error: unknown) => error instanceof TransactionWorkflowError && error.code === "APPROVAL_REQUIRED");
  }
});

test("reading entitlements rejects a row linked outside the action snapshot", async () => {
  const action = fixture();
  Object.assign(action, { entitlements: [{ snapshotInvestorId: randomUUID(), investorId: randomUUID() }] });
  const database = { corporateAction: { findUnique: async () => action } };
  await assert.rejects(getEntitlements(database as never, action.id),
    (error: unknown) => error instanceof TransactionWorkflowError && error.code === "CALCULATION_CHANGED");
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { calculateCouponBreakdown, createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { entitlementAmounts, FORMULA_VERSION, getEntitlements, requireFinalizedEntitlementSnapshot, requireApprovedEntitlements } from "./entitlements.js";
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

function couponReadingFixture(balances = [10n, 20n, 5n], capturedTerms = terms) {
  const key = "11111111111111111111111111111111";
  const snapshotId = randomUUID(); const snapshotHash = Buffer.alloc(32, 1);
  const solanaSlot = 100n; const blockTime = new Date("2026-10-02T12:00:00.000Z");
  const investors = balances.map(balance => {
    const investorId = randomUUID();
    return { id: randomUUID(), investorId, balance, eligibilityStatus: "ELIGIBLE",
      investor: { displayName: "Test holder", status: "ACTIVE", kycStatus: "VERIFIED", eligibilityStatus: "ELIGIBLE",
        eligibilityReasonCode: null, eligibilityReviewedAt: null,
        wallets: [{ investorId, address: key, network: "SOLANA_LOCALNET", status: "ACTIVE", verifiedAt: new Date(), revokedAt: null }] },
      wallets: [] };
  });
  const entitlements = investors.map(investor => {
    const breakdown = calculateCouponBreakdown({ balance: investor.balance, ...capturedTerms });
    return { id: randomUUID(), investorId: investor.investorId, snapshotInvestorId: investor.id,
      settlementWalletAddress: key, balanceAtRecordDate: investor.balance, amountMinor: breakdown.amountMinor,
      tokensToRedeem: 0n, formulaVersion: FORMULA_VERSION, status: breakdown.amountMinor === 0n ? "NOT_ELIGIBLE_ZERO_ROUNDING" : "CALCULATED",
      calculationInputs: { actionType: "COUPON_PAYMENT", balance: investor.balance.toString(), faceValueMinor: capturedTerms.faceValueMinor.toString(),
        snapshotId, snapshotHash: snapshotHash.toString("hex"), effectiveSlot: solanaSlot.toString(), effectiveBlockTime: blockTime.toISOString(),
        couponRateBps: capturedTerms.couponRateBps, paymentsPerYear: capturedTerms.paymentsPerYear,
        roundingRemainder: breakdown.remainder.toString(), denominator: breakdown.denominator.toString() } };
  });
  return { id: randomUUID(), type: "COUPON_PAYMENT", status: "CALCULATED", version: 1,
    approvedById: null, approvedAt: null, reviewNote: null, eligibleHolders: entitlements.filter(row => row.amountMinor > 0n).length,
    totalEntitlementMinor: entitlements.reduce((sum, row) => sum + row.amountMinor, 0n),
    instrument: { ...capturedTerms, status: "ACTIVE", network: "SOLANA_LOCALNET", mintAddress: key },
    snapshot: { id: snapshotId, snapshotHash, solanaSlot, blockTime, investorCount: investors.length, investors }, entitlements };
}

test("coupon reads expose exact stored rounding totals and tax status without using changed instrument terms", async () => {
  const action = couponReadingFixture();
  action.instrument.faceValueMinor = 7n;
  action.instrument.couponRateBps = 1;
  action.instrument.paymentsPerYear = 4;
  const database = { corporateAction: { findUnique: async () => action } };
  const result = await getEntitlements(database as never, action.id);
  assert.deepEqual(result.couponSummary, {
    roundedTotalMinor: "1750000000",
    theoreticalTotal: { numerator: "35000000000000", denominator: "20000" },
    roundingResidual: { numerator: "0", denominator: "20000" },
    roundingPolicy: "FLOOR_PER_INVESTOR", residualDestination: "TREASURY", taxTreatment: "NOT_IMPLEMENTED"
  });
  assert.deepEqual(result.items.map(row => row.amountMinor), ["500000000", "1000000000", "250000000"]);
});

test("coupon reads preserve zero payouts with a nonzero exact aggregate residual", async () => {
  const action = couponReadingFixture([1n, 1n, 1n], { faceValueMinor: 1n, couponRateBps: 5_000, paymentsPerYear: 1 });
  const database = { corporateAction: { findUnique: async () => action } };
  const result = await getEntitlements(database as never, action.id);
  assert.equal(result.couponSummary?.roundedTotalMinor, "0");
  assert.deepEqual(result.couponSummary?.theoreticalTotal, { numerator: "15000", denominator: "10000" });
  assert.deepEqual(result.couponSummary?.roundingResidual, { numerator: "15000", denominator: "10000" });
});

test("mixed zero and positive coupon rows retain an exact undistributed fractional minor unit", async () => {
  const action = couponReadingFixture([1n, 10_000n], { faceValueMinor: 1n, couponRateBps: 1, paymentsPerYear: 1 });
  const database = { corporateAction: { findUnique: async () => action } };
  const result = await getEntitlements(database as never, action.id);
  assert.deepEqual(result.items.map(row => row.amountMinor), ["0", "1"]);
  assert.equal(result.couponSummary?.roundedTotalMinor, "1");
  assert.deepEqual(result.couponSummary?.theoreticalTotal, { numerator: "10001", denominator: "10000" });
  assert.deepEqual(result.couponSummary?.roundingResidual, { numerator: "1", denominator: "10000" });
});

test("gross coupon summary survives current eligibility changes and completed settlement", async () => {
  const action = couponReadingFixture();
  const database = { corporateAction: { findUnique: async () => action } };
  const before = await getEntitlements(database as never, action.id);
  assert.equal(before.items.every(row => row.currentEligibility.eligible), true);
  action.snapshot.investors[0]!.investor.wallets[0]!.status = "BLOCKED";
  const blocked = await getEntitlements(database as never, action.id);
  assert.equal(blocked.items[0]!.currentEligibility.eligible, false);
  assert.deepEqual(blocked.couponSummary, before.couponSummary);
  action.status = "FINALIZED";
  action.instrument.status = "REDEEMED";
  for (const row of action.entitlements) row.status = "PAID";
  const settled = await getEntitlements(database as never, action.id);
  assert.deepEqual(settled.couponSummary, before.couponSummary);
  assert.equal(settled.items.every(row => row.status === "PAID"), true);
  assert.equal(settled.items.every(row => !row.currentEligibility.eligible), true);
});

test("uncalculated and redemption actions do not claim a coupon summary", async () => {
  const action = couponReadingFixture();
  const database = { corporateAction: { findUnique: async () => action } };
  for (const type of ["BOND_REDEMPTION", "EARLY_REDEMPTION", "COUPON_PAYMENT"]) {
    action.type = type; action.entitlements = [];
    assert.equal((await getEntitlements(database as never, action.id)).couponSummary, null);
  }
});

test("coupon reads reject corrupted saved amounts, rounding, inputs, positions, coverage and totals", async () => {
  const corruptions = [
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.amountMinor += 1n; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.roundingRemainder = "1"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.denominator = "10000"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.faceValueMinor = "-1"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.couponRateBps = 1.5; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.paymentsPerYear = 3; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.balance = "11"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.actionType = "BOND_REDEMPTION"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.snapshotId = randomUUID(); },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.snapshotHash = "a".repeat(64); },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.effectiveSlot = "99"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.calculationInputs.effectiveBlockTime = "2026-10-02T12:00:01.000Z"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.formulaVersion = "unknown-formula"; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.tokensToRedeem = 1n; },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[0]!.snapshotInvestorId = randomUUID(); },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements[1] = structuredClone(action.entitlements[0]!); },
    (action: ReturnType<typeof couponReadingFixture>) => { action.entitlements.pop(); },
    (action: ReturnType<typeof couponReadingFixture>) => { action.snapshot.investors.pop(); },
    (action: ReturnType<typeof couponReadingFixture>) => {
      const removed = action.entitlements.pop()!;
      action.totalEntitlementMinor -= removed.amountMinor; action.snapshot.investorCount--;
    },
    (action: ReturnType<typeof couponReadingFixture>) => { action.totalEntitlementMinor += 1n; },
    (action: ReturnType<typeof couponReadingFixture>) => {
      const inputs = action.entitlements[0]!.calculationInputs;
      inputs.faceValueMinor = "2"; inputs.couponRateBps = 0; inputs.roundingRemainder = "0";
      action.entitlements[0]!.amountMinor = 0n;
    }
  ];
  for (const corrupt of corruptions) {
    const action = couponReadingFixture(); corrupt(action);
    const database = { corporateAction: { findUnique: async () => action } };
    await assert.rejects(getEntitlements(database as never, action.id), { code: "CALCULATION_CHANGED" });
  }
});

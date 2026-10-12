import assert from "node:assert/strict";
import test from "node:test";
import { formatMinorKzt, reviewChoices, validatedCouponSummary, validatedExactRedemptionSummary, type EntitlementsView } from "./entitlement-workflow";
test("money formatting preserves all minor units including values beyond Number precision", () => {
  assert.equal(formatMinorKzt("500000000"), "500.00 KZT-Test");
  assert.equal(formatMinorKzt("1"), "0.000001 KZT-Test");
  assert.equal(formatMinorKzt("9223372036854775807"), "9223372036854.775807 KZT-Test");
  for (const value of ["1e6", "0.1", "-1", "NaN"]) assert.throws(() => formatMinorKzt(value));
});
test("approval cannot skip review and terminal/approved actions offer no editing decisions", () => {
  assert.deepEqual(reviewChoices("CALCULATED"), ["SUBMIT"]);
  assert.deepEqual(reviewChoices("UNDER_REVIEW"), ["APPROVE", "RETURN", "REJECT"]);
  for (const status of ["SNAPSHOT_CREATED", "RETURNED_FOR_REVISION", "REJECTED", "APPROVED", "FINALIZED"]) assert.deepEqual(reviewChoices(status), []);
});

const zeroRoundedCoupon = () => ({ actionType: "COUPON_PAYMENT", totalEntitlementMinor: "0",
  items: Array.from({ length: 3 }, () => ({ amountMinor: "0", calculationInputs: { roundingRemainder: "5000", denominator: "10000" } })),
  couponSummary: { roundedTotalMinor: "0", theoreticalTotal: { numerator: "15000", denominator: "10000" },
    roundingResidual: { numerator: "15000", denominator: "10000" }, roundingPolicy: "FLOOR_PER_INVESTOR", residualDestination: "TREASURY", taxTreatment: "NOT_IMPLEMENTED" }
});

test("coupon totals preserve the sum of per-investor floors when the aggregate theoretical amount crosses a minor unit", () => {
  const view = zeroRoundedCoupon(); const before = structuredClone(view);
  const summary = validatedCouponSummary(view)!;
  assert.equal(summary.roundedTotalMinor, "0");
  assert.deepEqual(summary.theoreticalTotal, { numerator: "15000", denominator: "10000" });
  assert.deepEqual(summary.roundingResidual, summary.theoreticalTotal);
  assert.deepEqual(view, before);
});

test("absent rollout metadata and uncalculated or redemption actions do not invent zero coupon totals", () => {
  const view = zeroRoundedCoupon();
  assert.equal(validatedCouponSummary({ ...view, couponSummary: undefined }), null);
  assert.equal(validatedCouponSummary({ ...view, couponSummary: null }), null);
  assert.equal(validatedCouponSummary({ ...view, items: [] }), null);
  const { actionType: _actionType, ...legacyView } = view;
  assert.equal(validatedCouponSummary(legacyView), null);
  for (const actionType of ["BOND_REDEMPTION", "EARLY_REDEMPTION"]) assert.equal(validatedCouponSummary({ ...view, actionType }), null);
});

test("coupon metadata fails closed on malformed units, unsupported policies and inconsistencies with saved rows", () => {
  const view = zeroRoundedCoupon(); const valid = view.couponSummary;
  for (const couponSummary of [false, [], {},
    { ...valid, roundingPolicy: "ROUND_AGGREGATE" }, { ...valid, residualDestination: "INVESTORS" }, { ...valid, taxTreatment: "NET" },
    { ...valid, roundedTotalMinor: "1" }, { ...valid, roundedTotalMinor: 0 },
    ...["0", "-1", "1.5", "01", "1e4"].map(denominator => ({ ...valid, theoreticalTotal: { numerator: "15000", denominator } })),
    ...["-1", "01", "1e4", "9".repeat(129)].map(numerator => ({ ...valid, roundingResidual: { numerator, denominator: "10000" } })),
    { ...valid, theoreticalTotal: { numerator: "14999", denominator: "10000" } },
    { ...valid, roundingResidual: { numerator: "5000", denominator: "10000" } }]) {
    assert.throws(() => validatedCouponSummary({ ...view, couponSummary }), /Итоги купона/);
  }
  assert.throws(() => validatedCouponSummary({ ...view, totalEntitlementMinor: "1" }), /Итоги купона/);
  assert.throws(() => validatedCouponSummary({ ...view, items: [{ amountMinor: "0", calculationInputs: { roundingRemainder: "10000", denominator: "10000" } }] }), /Итоги купона/);
});

test("coupon summary reconciliation remains exact above the safe Number range", () => {
  const amountMinor = "9007199254740993";
  const view = { actionType: "COUPON_PAYMENT", totalEntitlementMinor: amountMinor,
    items: [{ amountMinor, calculationInputs: { roundingRemainder: "1", denominator: "20000" } }],
    couponSummary: { ...zeroRoundedCoupon().couponSummary, roundedTotalMinor: amountMinor,
      theoreticalTotal: { numerator: "180143985094819860001", denominator: "20000" }, roundingResidual: { numerator: "1", denominator: "20000" } } };
  assert.equal(validatedCouponSummary(view)!.roundedTotalMinor, amountMinor);
  assert.throws(() => validatedCouponSummary({ ...view, couponSummary: { ...view.couponSummary, roundedTotalMinor: "9007199254740992" } }), /Итоги купона/);
});

function exactRedemptionFixture(): EntitlementsView {
  const owners = ["11111111111111111111111111111111", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  return { actionId: "00000000-0000-4000-8000-000000000010", actionVersion: 3, actionType: "EARLY_REDEMPTION", status: "CALCULATED",
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "1", approvedById: null, approvedAt: null,
    reviewNote: null, totalEntitlementMinor: "1000000000", eligibleHolders: 1, onchainRegistrationEnabled: false, onchainCalculationFinalized: false,
    exactRedemptionSummary: { policy: "exact-target-largest-remainder-v2", targetTokens: "1", allocatedTokens: "1", totalBalance: "3", remainingTokens: "2", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" },
    investors: [], items: owners.map((owner, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, investorId: `00000000-0000-4000-8000-${String(index + 4).padStart(12, "0")}`,
      onchainPda: null, settlementWalletAddress: owners[2 - index]!, balanceAtRecordDate: "1", amountMinor: index === 0 ? "1000000000" : "0",
      tokensToRedeem: index === 0 ? "1" : "0", status: index === 0 ? "CALCULATED" : "NOT_ELIGIBLE_ZERO_ROUNDING", eligibilityReason: "LOCAL_DEMO_ELIGIBLE",
      formulaVersion: "exact-target-largest-remainder-v2", currentEligibility: { eligible: true, reason: "LOCAL_DEMO_ELIGIBLE" },
      redemptionSources: [{ address: owner, walletAddress: owner, balanceAtSnapshot: "1" }],
      calculationInputs: { snapshotHash: "ab".repeat(32), balance: "1", faceValueMinor: "1000000000", couponRateBps: 1000, paymentsPerYear: 2,
        redemptionPercentageBps: null, redemptionPriceMinor: "1000000000", allocationPolicy: "exact-target-largest-remainder-v2", targetTokens: "1", totalBalance: "3",
        tieAddress: owner, remainingTokens: index === 0 ? "0" : "1", roundingRemainder: "1", denominator: "3" }
    })) };
}

test("exact redemption summary reconciles the target and every quota against immutable owners independently of receivers", () => {
  const view = exactRedemptionFixture(); const before = structuredClone(view);
  assert.deepEqual(validatedExactRedemptionSummary(view), view.exactRedemptionSummary);
  assert.deepEqual(view, before);
  assert.deepEqual(validatedExactRedemptionSummary({ ...view, items: [...view.items].reverse() }), view.exactRedemptionSummary);
  assert.equal(validatedExactRedemptionSummary({ ...view, items: [], exactRedemptionSummary: null }), null);
  assert.equal(validatedExactRedemptionSummary({ ...view, redemptionAllocationPolicy: "integer-entitlements-v1", redemptionTargetTokens: null, exactRedemptionSummary: null }), null);
});

test("exact redemption summary fails closed on missing policy, wrong totals, changed quotas or snapshot owner ties", () => {
  const view = exactRedemptionFixture();
  for (const summary of [null, undefined, { ...view.exactRedemptionSummary!, allocatedTokens: "2" },
    { ...view.exactRedemptionSummary!, targetTokens: "2" }, { ...view.exactRedemptionSummary!, totalBalance: "4" },
    { ...view.exactRedemptionSummary!, remainingTokens: "1" }, { ...view.exactRedemptionSummary!, tieBreak: "PAYMENT_RECEIVER_ASC" }]) {
    assert.throws(() => validatedExactRedemptionSummary({ ...view, exactRedemptionSummary: summary } as EntitlementsView), /Итоги погашения/);
  }
  for (const change of [{ tokensToRedeem: "0" }, { amountMinor: "1" }, { formulaVersion: "integer-entitlements-v1" }, { balanceAtRecordDate: "2" }, { redemptionSources: [] },
    { calculationInputs: { ...view.items[0]!.calculationInputs, allocationPolicy: undefined } },
    { calculationInputs: { ...view.items[0]!.calculationInputs, tieAddress: view.items[1]!.calculationInputs.tieAddress } },
    { calculationInputs: { ...view.items[0]!.calculationInputs, remainingTokens: "1" } },
    { calculationInputs: { ...view.items[0]!.calculationInputs, roundingRemainder: "0" } },
    { calculationInputs: { ...view.items[0]!.calculationInputs, denominator: "10000" } }]) {
    assert.throws(() => validatedExactRedemptionSummary({ ...view, items: [{ ...view.items[0]!, ...change }, ...view.items.slice(1)] } as EntitlementsView), /Итоги погашения/);
  }
  assert.throws(() => validatedExactRedemptionSummary({ ...view, actionType: "BOND_REDEMPTION" }), /Итоги погашения/);
  assert.throws(() => validatedExactRedemptionSummary({ ...view, redemptionAllocationPolicy: undefined } as unknown as EntitlementsView), /Итоги погашения/);
  const movedWinner = structuredClone(view);
  movedWinner.items[0]!.tokensToRedeem = "0"; movedWinner.items[0]!.calculationInputs.remainingTokens = "1";
  movedWinner.items[1]!.tokensToRedeem = "1"; movedWinner.items[1]!.calculationInputs.remainingTokens = "0";
  assert.throws(() => validatedExactRedemptionSummary(movedWinner), /Итоги погашения/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateInvestorEligibility,
  type InvestorEligibilityInput
} from "./eligibility.js";

const eligibleInput: InvestorEligibilityInput = {
  snapshotEligibility: "ELIGIBLE",
  currentEligibility: "ELIGIBLE",
  investorStatus: "ACTIVE",
  kycStatus: "VERIFIED",
  instrumentStatus: "ACTIVE",
  payoutWalletStatus: "ACTIVE",
  payoutWalletVerified: true,
  payoutWalletBelongsToInvestor: true
};

test("allows an eligible investor to use a verified active wallet", () => {
  assert.deepEqual(evaluateInvestorEligibility(eligibleInput), {
    eligible: true,
    reason: "ELIGIBLE"
  });
});

test("explicit synthetic Localnet review does not claim KYC and cannot bypass other payout controls", () => {
  const demo = { ...eligibleInput, kycStatus: "NOT_STARTED" as const,
    localDemoReview: { network: "SOLANA_LOCALNET", reasonCode: "DEMO_CRITERIA_MET", reviewed: true } };
  assert.deepEqual(evaluateInvestorEligibility(demo), { eligible: true, reason: "LOCAL_DEMO_ELIGIBLE" });
  assert.equal(evaluateInvestorEligibility({ ...eligibleInput, kycStatus: "NOT_STARTED" }).eligible, false);
  for (const localDemoReview of [{ ...demo.localDemoReview, network: "SOLANA_DEVNET" },
    { ...demo.localDemoReview, reasonCode: "UNREVIEWED" }, { ...demo.localDemoReview, reviewed: false }]) {
    assert.equal(evaluateInvestorEligibility({ ...demo, localDemoReview }).eligible, false);
  }
  for (const kycStatus of ["REJECTED", "EXPIRED", "PENDING_REVIEW"] as const) {
    assert.equal(evaluateInvestorEligibility({ ...demo, kycStatus }).eligible, false);
  }
  assert.equal(evaluateInvestorEligibility({ ...demo, payoutWalletStatus: "REVOKED" }).eligible, false);
  assert.equal(evaluateInvestorEligibility({ ...demo, snapshotEligibility: "NOT_ELIGIBLE" }).eligible, false);
});

test("preserves record-date exclusion even when current eligibility changes", () => {
  assert.deepEqual(
    evaluateInvestorEligibility({
      ...eligibleInput,
      snapshotEligibility: "PENDING_REVIEW"
    }),
    { eligible: false, reason: "NOT_ELIGIBLE_AT_RECORD_DATE" }
  );
});

test("blocks payout when investor, instrument, or selected wallet changes", () => {
  const cases: Array<[Partial<InvestorEligibilityInput>, string]> = [
    [{ investorStatus: "SUSPENDED" }, "INVESTOR_NOT_ACTIVE"],
    [{ kycStatus: "EXPIRED" }, "KYC_NOT_VERIFIED"],
    [{ currentEligibility: "SUSPENDED" }, "CURRENT_ELIGIBILITY_NOT_ELIGIBLE"],
    [{ instrumentStatus: "PAUSED" }, "INSTRUMENT_NOT_ACTIVE"],
    [{ payoutWalletBelongsToInvestor: false }, "PAYOUT_WALLET_OWNER_MISMATCH"],
    [{ payoutWalletStatus: "REVOKED" }, "PAYOUT_WALLET_NOT_ACTIVE"],
    [{ payoutWalletVerified: false }, "PAYOUT_WALLET_NOT_VERIFIED"]
  ];
  for (const [change, reason] of cases) {
    assert.deepEqual(
      evaluateInvestorEligibility({ ...eligibleInput, ...change }),
      { eligible: false, reason }
    );
  }
});

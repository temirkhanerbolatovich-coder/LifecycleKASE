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

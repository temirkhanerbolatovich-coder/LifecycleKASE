export interface InvestorEligibilityInput {
  snapshotEligibility: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_REVIEW" | "SUSPENDED";
  currentEligibility: "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_REVIEW" | "SUSPENDED";
  investorStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  kycStatus: "NOT_STARTED" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "EXPIRED";
  instrumentStatus: "DRAFT" | "DEPLOYING" | "ACTIVE" | "PAUSED" | "REDEEMED" | "FAILED";
  payoutWalletStatus: "PENDING" | "ACTIVE" | "BLOCKED" | "REVOKED";
  payoutWalletVerified: boolean;
  payoutWalletBelongsToInvestor: boolean;
}

export type EligibilityReason =
  | "ELIGIBLE"
  | "NOT_ELIGIBLE_AT_RECORD_DATE"
  | "INVESTOR_NOT_ACTIVE"
  | "KYC_NOT_VERIFIED"
  | "CURRENT_ELIGIBILITY_NOT_ELIGIBLE"
  | "INSTRUMENT_NOT_ACTIVE"
  | "PAYOUT_WALLET_NOT_ACTIVE"
  | "PAYOUT_WALLET_NOT_VERIFIED"
  | "PAYOUT_WALLET_OWNER_MISMATCH";

export function evaluateInvestorEligibility(
  input: InvestorEligibilityInput
): { eligible: boolean; reason: EligibilityReason } {
  if (input.snapshotEligibility !== "ELIGIBLE") {
    return { eligible: false, reason: "NOT_ELIGIBLE_AT_RECORD_DATE" };
  }
  if (input.investorStatus !== "ACTIVE") {
    return { eligible: false, reason: "INVESTOR_NOT_ACTIVE" };
  }
  if (input.kycStatus !== "VERIFIED") {
    return { eligible: false, reason: "KYC_NOT_VERIFIED" };
  }
  if (input.currentEligibility !== "ELIGIBLE") {
    return { eligible: false, reason: "CURRENT_ELIGIBILITY_NOT_ELIGIBLE" };
  }
  if (input.instrumentStatus !== "ACTIVE") {
    return { eligible: false, reason: "INSTRUMENT_NOT_ACTIVE" };
  }
  if (!input.payoutWalletBelongsToInvestor) {
    return { eligible: false, reason: "PAYOUT_WALLET_OWNER_MISMATCH" };
  }
  if (input.payoutWalletStatus !== "ACTIVE") {
    return { eligible: false, reason: "PAYOUT_WALLET_NOT_ACTIVE" };
  }
  if (!input.payoutWalletVerified) {
    return { eligible: false, reason: "PAYOUT_WALLET_NOT_VERIFIED" };
  }
  return { eligible: true, reason: "ELIGIBLE" };
}

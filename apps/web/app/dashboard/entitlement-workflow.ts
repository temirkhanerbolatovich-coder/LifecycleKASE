export type EntitlementsView = {
  actionId: string; actionVersion: number; status: string; approvedById: string | null; approvedAt: string | null;
  actionType?: string;
  reviewNote: string | null; totalEntitlementMinor: string; eligibleHolders: number;
  onchainRegistrationEnabled: boolean; onchainCalculationFinalized: boolean;
  actionApprovalEnabled?: boolean;
  onchainPending?: Record<string, unknown> | null;
  items: Array<{ id: string; investorId: string; onchainPda: string | null; settlementWalletAddress: string; balanceAtRecordDate: string;
    amountMinor: string; tokensToRedeem: string; status: string; eligibilityReason: string; formulaVersion: string;
    calculationInputs: { snapshotHash: string; balance: string; faceValueMinor: string; couponRateBps: number; paymentsPerYear: number;
      redemptionPercentageBps: number | null; redemptionPriceMinor: string | null; roundingRemainder: string; denominator: string };
    currentEligibility: { eligible: boolean; reason: string } }>;
  investors: Array<{ investorId: string; displayName: string; balance: string; snapshotEligibility: string; receiverWallets: string[] }>;
};

/** Displays six-decimal minor units without converting money to a floating point number. */
export function formatMinorKzt(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Некорректная сумма начисления.");
  const amount = BigInt(value); const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${amount / 1_000_000n}.${fraction} KZT-Test`;
}
export function reviewChoices(status: string): Array<"SUBMIT" | "APPROVE" | "RETURN" | "REJECT"> {
  return status === "CALCULATED" ? ["SUBMIT"] : status === "UNDER_REVIEW" ? ["APPROVE", "RETURN", "REJECT"] : [];
}

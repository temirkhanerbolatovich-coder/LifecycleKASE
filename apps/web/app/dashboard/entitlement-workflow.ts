import { allocateEarlyRedemption } from "@lifecycle-kase/domain/early-redemption-allocation";
import { redemptionAllocationMatches, type RedemptionAllocationPolicy } from "./action-workflow";
import type { InstrumentTokenPolicy } from "./controlled-identity";

export type RationalMinorAmount = { numerator: string; denominator: string };
export type CouponSummary = {
  roundedTotalMinor: string;
  theoreticalTotal: RationalMinorAmount;
  roundingResidual: RationalMinorAmount;
  roundingPolicy: "FLOOR_PER_INVESTOR";
  residualDestination: "TREASURY";
  taxTreatment: "NOT_IMPLEMENTED";
};

export type EntitlementsView = {
  actionId: string; actionVersion: number; status: string; approvedById: string | null; approvedAt: string | null;
  actionType?: string;
  instrumentId?: string; programId?: string | null; network?: string; networkGenesisHash?: string | null;
  corporateActionAuthority?: string;
  tokenMint?: string | null;
  tokenPolicy?: InstrumentTokenPolicy;
  reviewNote: string | null; totalEntitlementMinor: string; eligibleHolders: number;
  onchainRegistrationEnabled: boolean; onchainCalculationFinalized: boolean;
  actionApprovalEnabled?: boolean;
  onchainPending?: Record<string, unknown> | null;
  couponSummary?: CouponSummary | null;
  redemptionAllocationPolicy?: RedemptionAllocationPolicy;
  redemptionTargetTokens?: string | null;
  exactRedemptionSummary?: ExactRedemptionSummary | null;
  items: Array<{ id: string; investorId: string; onchainPda: string | null; settlementWalletAddress: string; balanceAtRecordDate: string;
    redemptionSources?: { address: string; walletAddress: string; balanceAtSnapshot: string }[];
    unitReservationAddress?: string | null; unitReservationConfirmed?: boolean;
    amountMinor: string; tokensToRedeem: string; status: string; eligibilityReason: string; formulaVersion: string;
    calculationInputs: { snapshotHash: string; balance: string; faceValueMinor: string; couponRateBps: number; paymentsPerYear: number;
      redemptionPercentageBps: number | null; redemptionPriceMinor: string | null; roundingRemainder: string; denominator: string;
      allocationPolicy?: RedemptionAllocationPolicy; targetTokens?: string; totalBalance?: string; tieAddress?: string; remainingTokens?: string };
    currentEligibility: { eligible: boolean; reason: string } }>;
  investors: Array<{ investorId: string; displayName: string; balance: string; snapshotEligibility: string; receiverWallets: string[] }>;
};

export type ExactRedemptionSummary = {
  policy: "exact-target-largest-remainder-v2";
  targetTokens: string; allocatedTokens: string; totalBalance: string; remainingTokens: string;
  tieBreak: "SNAPSHOT_OWNER_BASE58_ASC";
};

/** Reconciles every quota with the independently calculated exact-target allocation. */
export function validatedExactRedemptionSummary(view: EntitlementsView): ExactRedemptionSummary | null {
  const invalid = () => new Error("Итоги погашения не совпадают с целевым количеством или начислениями. Обновите данные и проверьте расчёт.");
  const exact = view.redemptionAllocationPolicy === "exact-target-largest-remainder-v2";
  if (!exact) {
    if (view.exactRedemptionSummary != null || !redemptionAllocationMatches({}, view)) throw invalid();
    return null;
  }
  if (view.actionType !== "EARLY_REDEMPTION" || !redemptionAllocationMatches({
    redemptionAllocationPolicy: view.redemptionAllocationPolicy, redemptionTargetTokens: view.redemptionTargetTokens
  }, view)) throw invalid();
  if (view.items.length === 0 && view.exactRedemptionSummary == null) return null;
  try {
    const summary = view.exactRedemptionSummary;
    let price: string | null = null;
    let amountTotal = 0n;
    if (!summary || summary.policy !== view.redemptionAllocationPolicy || summary.tieBreak !== "SNAPSHOT_OWNER_BASE58_ASC" ||
        summary.targetTokens !== view.redemptionTargetTokens) throw invalid();
    const allocated = allocateEarlyRedemption({ targetTokens: BigInt(summary.targetTokens), rows: view.items.map(item => {
      const inputs = item.calculationInputs;
      if (inputs.allocationPolicy !== summary.policy || inputs.targetTokens !== summary.targetTokens || inputs.totalBalance !== summary.totalBalance ||
          item.formulaVersion !== summary.policy || inputs.redemptionPercentageBps !== null ||
          inputs.balance !== item.balanceAtRecordDate || !inputs.tieAddress || !/^(0|[1-9][0-9]{0,19})$/.test(item.balanceAtRecordDate) ||
          !inputs.redemptionPriceMinor || !/^[1-9][0-9]{0,19}$/.test(inputs.redemptionPriceMinor) ||
          !/^(0|[1-9][0-9]{0,19})$/.test(item.amountMinor) || !/^(0|[1-9][0-9]{0,19})$/.test(item.tokensToRedeem) ||
          price !== null && price !== inputs.redemptionPriceMinor) throw invalid();
      price = inputs.redemptionPriceMinor;
      if (BigInt(item.amountMinor) !== BigInt(item.tokensToRedeem) * BigInt(price)) throw invalid();
      amountTotal += BigInt(item.amountMinor);
      const owners = item.redemptionSources?.filter(source => /^[1-9][0-9]*$/.test(source.balanceAtSnapshot)).map(source => source.walletAddress).sort();
      if (!owners?.length || owners[0] !== inputs.tieAddress) throw invalid();
      return { investorId: item.investorId, tieAddress: inputs.tieAddress, balance: BigInt(item.balanceAtRecordDate) };
    }) });
    if (summary.allocatedTokens !== allocated.targetTokens.toString() || summary.totalBalance !== allocated.totalBalance.toString() ||
        summary.remainingTokens !== (allocated.totalBalance - allocated.targetTokens).toString() || amountTotal.toString() !== view.totalEntitlementMinor ||
        view.eligibleHolders !== view.items.filter(item => item.tokensToRedeem !== "0").length) throw invalid();
    for (const expected of allocated.rows) {
      const item = view.items.find(row => row.investorId.toLowerCase() === expected.investorId)!;
      if (item.tokensToRedeem !== expected.redeemedTokens.toString() || item.calculationInputs.remainingTokens !== expected.remainingTokens.toString() ||
          item.calculationInputs.roundingRemainder !== expected.quotaRemainder.toString() || item.calculationInputs.denominator !== allocated.denominator.toString()) throw invalid();
    }
    return { ...summary };
  } catch { throw invalid(); }
}

const invalidCouponSummary = () => new Error("Итоги купона не совпадают с сохранёнными начислениями. Обновите данные и проверьте расчёт.");
function unsignedSummaryValue(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 128 || !/^(0|[1-9][0-9]*)$/.test(value)) throw invalidCouponSummary();
  return BigInt(value);
}
function summaryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidCouponSummary();
  return value as Record<string, unknown>;
}
function rationalSummary(value: unknown): RationalMinorAmount {
  const row = summaryRecord(value);
  unsignedSummaryValue(row["numerator"]);
  if (unsignedSummaryValue(row["denominator"]) === 0n) throw invalidCouponSummary();
  return { numerator: row["numerator"] as string, denominator: row["denominator"] as string };
}

/** Reconciles optional rollout metadata with the saved per-investor floor calculation. */
export function validatedCouponSummary(view: Pick<EntitlementsView, "actionType" | "totalEntitlementMinor"> & {
  items: Array<{ amountMinor: string; calculationInputs: { roundingRemainder: string; denominator: string } }>;
  couponSummary?: unknown;
}): CouponSummary | null {
  if (view.actionType !== "COUPON_PAYMENT" || !view.items.length || view.couponSummary === undefined || view.couponSummary === null) return null;
  const row = summaryRecord(view.couponSummary);
  if (row["roundingPolicy"] !== "FLOOR_PER_INVESTOR" || row["residualDestination"] !== "TREASURY" || row["taxTreatment"] !== "NOT_IMPLEMENTED") throw invalidCouponSummary();
  const rounded = unsignedSummaryValue(row["roundedTotalMinor"]);
  const theoretical = rationalSummary(row["theoreticalTotal"]);
  const residual = rationalSummary(row["roundingResidual"]);
  let amountTotal = 0n; let remainderTotal = 0n; let denominator = 0n;
  for (const item of view.items) {
    const inputs = summaryRecord(item.calculationInputs);
    const itemDenominator = unsignedSummaryValue(inputs["denominator"]);
    const remainder = unsignedSummaryValue(inputs["roundingRemainder"]);
    if (itemDenominator === 0n || remainder >= itemDenominator || denominator !== 0n && denominator !== itemDenominator) throw invalidCouponSummary();
    denominator = itemDenominator;
    amountTotal += unsignedSummaryValue(item.amountMinor); remainderTotal += remainder;
  }
  if (rounded !== amountTotal || unsignedSummaryValue(view.totalEntitlementMinor) !== amountTotal ||
      BigInt(residual.numerator) * denominator !== remainderTotal * BigInt(residual.denominator) ||
      BigInt(theoretical.numerator) * denominator !== (amountTotal * denominator + remainderTotal) * BigInt(theoretical.denominator)) throw invalidCouponSummary();
  return { roundedTotalMinor: amountTotal.toString(), theoreticalTotal: theoretical, roundingResidual: residual,
    roundingPolicy: "FLOOR_PER_INVESTOR", residualDestination: "TREASURY", taxTreatment: "NOT_IMPLEMENTED" };
}

/** Displays six-decimal minor units without converting money to a floating point number. */
export function formatMinorKzt(value: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Некорректная сумма начисления.");
  const amount = BigInt(value); const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${amount / 1_000_000n}.${fraction} KZT-Test`;
}
export function reviewChoices(status: string): Array<"SUBMIT" | "APPROVE" | "RETURN" | "REJECT"> {
  return status === "CALCULATED" ? ["SUBMIT"] : status === "UNDER_REVIEW" ? ["APPROVE", "RETURN", "REJECT"] : [];
}

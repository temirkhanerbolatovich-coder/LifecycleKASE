import { DomainValidationError } from "./errors.js";
import { assertU64 } from "./numeric.js";

export type SettlementLegInput = {
  type: "CASH" | "ASSET";
  status: "NOT_APPLICABLE" | "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED_RETRYABLE" | "FAILED_FINAL";
  expectedAmountMinor: bigint;
  actualAmountMinor: bigint | null;
};

export type SettlementLegResult =
  | { status: "PENDING"; reason: string }
  | { status: "MISMATCH"; reason: string }
  | { status: "MATCHED"; reason: "REQUIRED_LEGS_CONFIRMED" };

export function reconcileSettlementLegs(
  actionType: "COUPON_PAYMENT" | "BOND_REDEMPTION" | "EARLY_REDEMPTION",
  legs: readonly SettlementLegInput[]
): SettlementLegResult {
  if (legs.length !== 2 || new Set(legs.map((leg) => leg.type)).size !== 2) {
    throw new DomainValidationError(
      "INVALID_SETTLEMENT_LEGS",
      "Settlement must contain one CASH and one ASSET leg"
    );
  }
  const cash = legs.find((leg) => leg.type === "CASH")!;
  const asset = legs.find((leg) => leg.type === "ASSET")!;
  for (const leg of legs) {
    assertU64(leg.expectedAmountMinor, "expectedAmountMinor");
    if (leg.actualAmountMinor !== null) {
      assertU64(leg.actualAmountMinor, "actualAmountMinor");
    }
  }

  if (actionType === "COUPON_PAYMENT") {
    if (asset.status !== "NOT_APPLICABLE" || asset.expectedAmountMinor !== 0n || asset.actualAmountMinor !== null) {
      return { status: "MISMATCH", reason: "COUPON_ASSET_LEG_MUST_BE_NOT_APPLICABLE" };
    }
  } else if (asset.status === "NOT_APPLICABLE") {
    return { status: "MISMATCH", reason: "REDEMPTION_REQUIRES_ASSET_LEG" };
  }
  if (cash.status === "NOT_APPLICABLE") {
    return { status: "MISMATCH", reason: "CASH_LEG_REQUIRED" };
  }

  const required = actionType === "COUPON_PAYMENT" ? [cash] : [cash, asset];
  for (const leg of required) {
    if (leg.status === "FAILED_FINAL") {
      return { status: "MISMATCH", reason: leg.type + "_LEG_FAILED_FINAL" };
    }
    if (leg.status !== "CONFIRMED") {
      return { status: "PENDING", reason: leg.type + "_LEG_NOT_CONFIRMED" };
    }
    if (leg.actualAmountMinor !== leg.expectedAmountMinor) {
      return { status: "MISMATCH", reason: leg.type + "_AMOUNT_MISMATCH" };
    }
  }
  return { status: "MATCHED", reason: "REQUIRED_LEGS_CONFIRMED" };
}

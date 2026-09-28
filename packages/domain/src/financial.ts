import { DomainValidationError } from "./errors.js";
import {
  assertPositiveU64,
  assertResultU64,
  assertU64,
  multiplyU128
} from "./numeric.js";

const BASIS_POINTS_DENOMINATOR = 10_000n;
const ALLOWED_PAYMENT_FREQUENCIES = new Set([1, 2, 4]);

export interface CouponInput {
  balance: bigint;
  faceValueMinor: bigint;
  couponRateBps: number;
  paymentsPerYear: number;
}

export interface CouponBreakdown {
  amountMinor: bigint;
  remainder: bigint;
  denominator: bigint;
}

export interface PrincipalInput {
  balance: bigint;
  faceValueMinor: bigint;
}

export interface EarlyRedemptionTokensInput {
  balance: bigint;
  percentageBps: number;
}

export interface EarlyRedemptionAmountInput {
  redeemedTokens: bigint;
  redemptionPriceMinor: bigint;
}

export interface EarlyRedemptionInput
  extends EarlyRedemptionTokensInput,
    Pick<EarlyRedemptionAmountInput, "redemptionPriceMinor"> {}

export interface EarlyRedemptionBreakdown {
  redeemedTokens: bigint;
  amountMinor: bigint;
  remainingTokens: bigint;
}

function assertIntegerInRange(
  value: number,
  fieldName: string,
  minimum: number,
  maximum: number
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DomainValidationError(
      "VALUE_OUT_OF_RANGE",
      `${fieldName} must be an integer between ${minimum} and ${maximum}`
    );
  }
}

export function calculateCouponBreakdown(input: CouponInput): CouponBreakdown {
  assertU64(input.balance, "balance");
  assertPositiveU64(input.faceValueMinor, "faceValueMinor");
  assertIntegerInRange(input.couponRateBps, "couponRateBps", 0, 100_000);

  if (!ALLOWED_PAYMENT_FREQUENCIES.has(input.paymentsPerYear)) {
    throw new DomainValidationError(
      "INVALID_PAYMENT_FREQUENCY",
      "paymentsPerYear must be one of 1, 2, or 4"
    );
  }

  const balanceTimesFaceValue = multiplyU128(
    input.balance,
    input.faceValueMinor,
    "coupon calculation"
  );
  const numerator = multiplyU128(
    balanceTimesFaceValue,
    BigInt(input.couponRateBps),
    "coupon calculation"
  );
  const denominator = BASIS_POINTS_DENOMINATOR * BigInt(input.paymentsPerYear);

  return {
    amountMinor: assertResultU64(numerator / denominator, "coupon calculation"),
    remainder: numerator % denominator,
    denominator
  };
}

export function calculateCoupon(input: CouponInput): bigint {
  return calculateCouponBreakdown(input).amountMinor;
}

export function calculateFinalCoupon(input: CouponInput): bigint {
  return calculateCoupon(input);
}

export function calculatePrincipal(input: PrincipalInput): bigint {
  assertU64(input.balance, "balance");
  assertPositiveU64(input.faceValueMinor, "faceValueMinor");

  const principal = multiplyU128(
    input.balance,
    input.faceValueMinor,
    "principal calculation"
  );
  return assertResultU64(principal, "principal calculation");
}

export function calculateEarlyRedemptionTokens(
  input: EarlyRedemptionTokensInput
): bigint {
  assertU64(input.balance, "balance");
  assertIntegerInRange(input.percentageBps, "percentageBps", 1, 10_000);

  const numerator = multiplyU128(
    input.balance,
    BigInt(input.percentageBps),
    "early redemption token calculation"
  );
  return numerator / BASIS_POINTS_DENOMINATOR;
}

export function calculateEarlyRedemptionAmount(
  input: EarlyRedemptionAmountInput
): bigint {
  assertU64(input.redeemedTokens, "redeemedTokens");
  assertPositiveU64(input.redemptionPriceMinor, "redemptionPriceMinor");

  const amount = multiplyU128(
    input.redeemedTokens,
    input.redemptionPriceMinor,
    "early redemption amount calculation"
  );
  return assertResultU64(amount, "early redemption amount calculation");
}

export function calculateEarlyRedemption(
  input: EarlyRedemptionInput
): EarlyRedemptionBreakdown {
  const redeemedTokens = calculateEarlyRedemptionTokens(input);
  const amountMinor = calculateEarlyRedemptionAmount({
    redeemedTokens,
    redemptionPriceMinor: input.redemptionPriceMinor
  });

  return {
    redeemedTokens,
    amountMinor,
    remainingTokens: input.balance - redeemedTokens
  };
}

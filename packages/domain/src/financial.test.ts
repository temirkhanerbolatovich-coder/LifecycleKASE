import assert from "node:assert/strict";
import test from "node:test";

import { DomainValidationError } from "./errors.js";
import {
  calculateCoupon,
  calculateCouponBreakdown,
  calculateEarlyRedemption,
  calculateEarlyRedemptionTokens,
  calculateFinalCoupon,
  calculatePrincipal,
  summarizeCouponBreakdowns
} from "./financial.js";
import { MAX_U64 } from "./numeric.js";

const canonicalCoupon = {
  faceValueMinor: 1_000_000_000n,
  couponRateBps: 1_000,
  paymentsPerYear: 2
};

test("calculates canonical 10/20/5 coupon allocation", () => {
  assert.equal(calculateCoupon({ balance: 10n, ...canonicalCoupon }), 500_000_000n);
  assert.equal(calculateCoupon({ balance: 20n, ...canonicalCoupon }), 1_000_000_000n);
  assert.equal(calculateCoupon({ balance: 5n, ...canonicalCoupon }), 250_000_000n);
});

test("reports floor-rounding remainder without redistributing it", () => {
  assert.deepEqual(
    calculateCouponBreakdown({
      balance: 1n,
      faceValueMinor: 1n,
      couponRateBps: 1,
      paymentsPerYear: 4
    }),
    { amountMinor: 0n, remainder: 1n, denominator: 40_000n }
  );
});

test("summarizes coupon rows exactly when fractional residuals exceed one minor unit", () => {
  const rows = [1n, 1n, 1n].map(balance => calculateCouponBreakdown({
    balance, faceValueMinor: 1n, couponRateBps: 5_000, paymentsPerYear: 1
  }));
  assert.deepEqual(summarizeCouponBreakdowns(rows), {
    roundedTotalMinor: 0n,
    theoreticalTotal: { numerator: 15_000n, denominator: 10_000n },
    roundingResidual: { numerator: 15_000n, denominator: 10_000n }
  });
});

test("coupon summary retains canonical payouts and integers above Number precision", () => {
  const canonical = summarizeCouponBreakdowns([10n, 20n, 5n].map(balance =>
    calculateCouponBreakdown({ balance, ...canonicalCoupon })));
  assert.equal(canonical.roundedTotalMinor, 1_750_000_000n);
  assert.deepEqual(canonical.roundingResidual, { numerator: 0n, denominator: 20_000n });
  const maximum = summarizeCouponBreakdowns([
    calculateCouponBreakdown({ balance: 1n, faceValueMinor: MAX_U64, couponRateBps: 10_000, paymentsPerYear: 1 })
  ]);
  assert.equal(maximum.roundedTotalMinor, MAX_U64);
  assert.equal(maximum.theoreticalTotal.numerator, MAX_U64 * 10_000n);
});

test("coupon summary rejects missing, inconsistent, invalid and overflowing rows", () => {
  const valid = { amountMinor: 1n, remainder: 0n, denominator: 10_000n };
  for (const rows of [[], [{ ...valid, denominator: 1n }], [valid, { ...valid, denominator: 20_000n }],
    [{ ...valid, remainder: -1n }], [{ ...valid, remainder: 10_000n }], [{ ...valid, amountMinor: -1n }],
    [{ ...valid, amountMinor: MAX_U64 }, valid]]) {
    assert.throws(() => summarizeCouponBreakdowns(rows), DomainValidationError);
  }
});

test("calculates principal and final coupon", () => {
  assert.equal(calculatePrincipal({ balance: 35n, faceValueMinor: 1_000_000_000n }), 35_000_000_000n);
  assert.equal(
    calculateFinalCoupon({ balance: 35n, ...canonicalCoupon }),
    1_750_000_000n
  );
});

test("calculates 20 percent early redemption and remaining balance", () => {
  assert.deepEqual(
    calculateEarlyRedemption({
      balance: 20n,
      percentageBps: 2_000,
      redemptionPriceMinor: 1_000_000_000n
    }),
    { redeemedTokens: 4n, amountMinor: 4_000_000_000n, remainingTokens: 16n }
  );
});

test("returns zero tokens when floor rounding makes holder ineligible", () => {
  assert.equal(
    calculateEarlyRedemptionTokens({ balance: 4n, percentageBps: 2_000 }),
    0n
  );
});

test("rejects invalid rates and payment frequency", () => {
  assert.throws(
    () => calculateCoupon({ balance: 1n, ...canonicalCoupon, couponRateBps: -1 }),
    DomainValidationError
  );
  assert.throws(
    () => calculateCoupon({ balance: 1n, ...canonicalCoupon, paymentsPerYear: 12 }),
    /paymentsPerYear/
  );
});

test("rejects u128 intermediate and u64 result overflow", () => {
  assert.throws(
    () =>
      calculateCoupon({
        balance: MAX_U64,
        faceValueMinor: MAX_U64,
        couponRateBps: 100_000,
        paymentsPerYear: 1
      }),
    /u128/
  );
  assert.throws(
    () => calculatePrincipal({ balance: MAX_U64, faceValueMinor: 2n }),
    /u64 storage/
  );
});

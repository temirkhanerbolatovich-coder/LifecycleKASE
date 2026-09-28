import assert from "node:assert/strict";
import test from "node:test";

import { DomainValidationError } from "./errors.js";
import {
  calculateCoupon,
  calculateCouponBreakdown,
  calculateEarlyRedemption,
  calculateEarlyRedemptionTokens,
  calculateFinalCoupon,
  calculatePrincipal
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

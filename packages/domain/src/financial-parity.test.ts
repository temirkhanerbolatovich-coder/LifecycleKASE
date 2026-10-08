import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateCouponBreakdown, calculateEarlyRedemption, calculatePrincipal } from "./financial.js";
import { assertResultU64 } from "./numeric.js";

test("TypeScript matches the shared Rust integer vectors, including rounding and overflow rejection", () => {
  const vectors = readFileSync(new URL("../../../test/fixtures/financial-parity.tsv", import.meta.url), "utf8").trim().split(/\r?\n/).slice(1);
  for (const line of vectors) {
    const [type, balanceText, faceText, rateText, frequencyText, percentText, priceText, amount, tokens, remainder, denominator] = line.split("\t");
    const balance = BigInt(balanceText!); const faceValueMinor = BigInt(faceText!);
    const calculate = () => {
      if (type === "EARLY_REDEMPTION") {
        const result = calculateEarlyRedemption({ balance, percentageBps: Number(percentText), redemptionPriceMinor: BigInt(priceText!) });
        return [result.amountMinor, result.redeemedTokens, balance * BigInt(percentText!) % 10_000n, 10_000n];
      }
      const coupon = calculateCouponBreakdown({ balance, faceValueMinor, couponRateBps: Number(rateText), paymentsPerYear: Number(frequencyText) });
      return [assertResultU64(coupon.amountMinor + (type === "BOND_REDEMPTION" ? calculatePrincipal({ balance, faceValueMinor }) : 0n), "maturity total"),
        type === "BOND_REDEMPTION" ? balance : 0n, coupon.remainder, coupon.denominator];
    };
    if (amount === "ERROR") assert.throws(calculate, line);
    else assert.deepEqual(calculate().map(String), [amount, tokens, remainder, denominator], line);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { couponNetworkReserve, prepareCouponFunding, verifyFundingDelta, getCouponBudget } from "./coupon-funding.js";
import { TOKEN_2022_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const mint = "11111111111111111111111111111111"; const issuer = mint;
const balance = (amount: string, changes: object = {}) => ({ accountIndex: 2, mint, owner: issuer,
  programId: TOKEN_2022_PROGRAM_ID, uiTokenAmount: { amount, decimals: 6 }, ...changes });
test("funding confirmation requires the exact treasury index, owner, mint, precision and integer delta", () => {
  verifyFundingDelta({ preTokenBalances: [], postTokenBalances: [balance("1750000000")] }, 2, mint, issuer, 1_750_000_000n);
  verifyFundingDelta({ preTokenBalances: [balance("500")], postTokenBalances: [balance("1750000500")] }, 2, mint, issuer, 1_750_000_000n);
  for (const meta of [
    { preTokenBalances: [], postTokenBalances: [balance("1750000001")] },
    { preTokenBalances: [], postTokenBalances: [balance("1750000000", { accountIndex: 3 })] },
    { preTokenBalances: [], postTokenBalances: [balance("1750000000", { mint: "foreign" })] },
    { preTokenBalances: [], postTokenBalances: [balance("1750000000", { owner: "foreign" })] },
    { preTokenBalances: [], postTokenBalances: [balance("1750000000", { uiTokenAmount: { amount: "1750.0", decimals: 6 } })] },
    { preTokenBalances: [], postTokenBalances: [balance("1750000000"), balance("1750000000")] },
    { postTokenBalances: [balance("1750000000")] }
  ]) assert.throws(() => verifyFundingDelta(meta, 2, mint, issuer, 1_750_000_000n));
});
test("network reserve has a conservative default and rejects missing precision or unsafe values", () => {
  assert.equal(couponNetworkReserve({}), 50_000_000n);
  for (const value of ["0", "4999999", "5000000.0", "-1", "1e9", "not-a-number"]) assert.throws(() => couponNetworkReserve({ COUPON_NETWORK_RESERVE_LAMPORTS: value }));
});
test("funding rejects caller amounts and stale format before accessing the database", async () => {
  for (const body of [{ version: 1, amountMinor: "10" }, { version: "1" }, { version: -1 }]) {
    await assert.rejects(prepareCouponFunding({} as never, {} as never, issuer, body, {} as never, {} as never),
      (error: unknown) => error instanceof TransactionWorkflowError && error.code === "INVALID_REQUEST");
  }
});
test("funding cannot operate on public Devnet", async () => {
  const database = { corporateAction: { findUnique: async () => ({ instrument: { settlementAsset: {} } }) } };
  await assert.rejects(getCouponBudget(database as never, {} as never, "00000000-0000-4000-8000-000000000001", { cluster: "devnet" } as never),
    (error: unknown) => error instanceof TransactionWorkflowError && error.code === "FUNDING_LOCALNET_ONLY");
});

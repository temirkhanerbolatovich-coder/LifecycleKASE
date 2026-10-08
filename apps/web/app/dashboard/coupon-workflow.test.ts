import assert from "node:assert/strict";
import test from "node:test";
import { couponBudget, couponFundingReviewChanged, couponFundingSignature, preparedCouponFunding,
  refreshCouponFundingPlan, unsignedFundingPlanIsStale, type CouponBudget, type CouponFundingPlan } from "./coupon-workflow";

const signer = "11111111111111111111111111111111";
const actionId = "00000000-0000-4000-8000-000000000001";
const path = `/api/v1/corporate-actions/${actionId}/coupon`;
function fundingFixture() {
  const bytes = new Uint8Array(200); bytes[0] = 1; bytes[65] = 128; bytes[66] = 1; bytes[69] = 2;
  const budget = { corporateActionId: actionId, actionVersion: 6, cluster: "localnet", requiredSigner: signer,
    networkGenesisHash: "genesis", snapshotHash: "hash", settlementMint: "mint", treasuryTokenAccount: "treasury",
    deficitMinor: "1750000000", totalCouponMinor: "1750000000", executionAvailable: false } as CouponBudget;
  const plan = { ...budget, operationId: "00000000-0000-4000-8000-000000000002", phase: "COUPON_FUNDING",
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", amountMinor: budget.deficitMinor,
    serializedTransactionBase64: Buffer.from(bytes).toString("base64"), lastValidBlockHeight: 10,
    status: "PREPARED", signature: null, resumed: true };
  return { budget, plan };
}

test("funding UI blocks mismatched action, signer, mint, treasury, genesis and arbitrary issuance amounts", () => {
  const budget = { corporateActionId: "00000000-0000-4000-8000-000000000001", actionVersion: 6, cluster: "localnet",
    requiredSigner: "issuer", networkGenesisHash: "genesis", snapshotHash: "hash", settlementMint: "mint",
    treasuryTokenAccount: "treasury", deficitMinor: "1750000000", totalCouponMinor: "1750000000" } as CouponBudget;
  const plan = { ...budget, operationId: "00000000-0000-4000-8000-000000000002", phase: "COUPON_FUNDING",
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", amountMinor: budget.deficitMinor, serializedTransactionBase64: "invalid", lastValidBlockHeight: 10 };
  for (const changes of [{ corporateActionId: "other" }, { cluster: "devnet" }, { requiredSigner: "other" }, { settlementMint: "other" },
    { treasuryTokenAccount: "other" }, { networkGenesisHash: "other" }, { snapshotHash: "other" },
    { amountMinor: "1750000001" }, { amountMinor: "0" }, { actionVersion: 5 }, { amountMinor: "1749999999" }]) {
    assert.throws(() => preparedCouponFunding({ ...plan, ...changes }, budget, "issuer"), /План финансирования/);
  }
});

test("stale unsigned plans cannot block preparation against the fresh version or treasury deficit", async () => {
  const { budget, plan } = fundingFixture();
  for (const changes of [{ actionVersion: 7 }, { deficitMinor: "1000000000" }]) {
    const current = { ...budget, ...changes, fundingAttempt: plan };
    assert.equal(unsignedFundingPlanIsStale(plan, current), true);
    const calls: string[] = [];
    const result = await refreshCouponFundingPlan(async (url, init) => {
      calls.push(url);
      if (url === path + "/budget") return current;
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(init!.body as string), { version: current.actionVersion });
      return { ...plan, actionVersion: current.actionVersion, amountMinor: current.deficitMinor };
    }, path, actionId, signer);
    assert.deepEqual(calls, [path + "/budget", path + "/funding/prepare"]);
    assert.equal(result.plan.actionVersion, current.actionVersion);
    assert.equal(result.plan.amountMinor, current.deficitMinor);
    assert.equal(couponFundingReviewChanged(plan as CouponFundingPlan, result.plan), true);
  }
});

test("an unexpired stale plan returned by the server remains blocked from signing", async () => {
  const { budget, plan } = fundingFixture();
  await assert.rejects(refreshCouponFundingPlan(async url => url === path + "/budget"
    ? { ...budget, actionVersion: 7, fundingAttempt: plan } : plan, path, actionId, signer), /План финансирования/);
});

test("submitted, unknown and finalized funding restore the same signature across reload and budget changes", async () => {
  const { budget, plan } = fundingFixture();
  for (const status of ["SUBMITTED", "UNKNOWN_CONFIRMATION", "FINALIZED"]) {
    const saved = { ...plan, status, signature: "2".repeat(88) };
    const current = { ...budget, actionVersion: 7, deficitMinor: "0", fundingAttempt: saved };
    assert.equal(unsignedFundingPlanIsStale(saved, current), false);
    const result = await refreshCouponFundingPlan(async url => url === path + "/budget" ? current : saved,
      path, actionId, signer);
    assert.equal(result.plan.operationId, saved.operationId);
    assert.equal(couponFundingSignature(result.plan), saved.signature);
  }
  assert.throws(() => couponFundingSignature({ ...plan, status: "FINALIZED" } as CouponFundingPlan), /подписи/);
});

test("fresh preparation still rejects wrong network, signer, mint, treasury and malformed wire", async () => {
  const { budget, plan } = fundingFixture();
  for (const changes of [{ networkGenesisHash: "other" }, { requiredSigner: "other" },
    { settlementMint: "other" }, { treasuryTokenAccount: "other" }, { serializedTransactionBase64: "invalid" }]) {
    await assert.rejects(refreshCouponFundingPlan(async url => url === path + "/budget"
      ? budget as unknown as Record<string, unknown> : { ...plan, ...changes }, path, actionId, signer));
  }
  for (const changes of [{ actionVersion: -1 }, { deficitMinor: "-1" }, { totalCouponMinor: "0" }, { executionAvailable: true }]) {
    assert.throws(() => couponBudget({ ...budget, ...changes }, actionId), /бюджет/);
  }
});

test("only refreshed blockhash and operation identity may change without reviewing financial facts again", () => {
  const { plan } = fundingFixture();
  assert.equal(couponFundingReviewChanged(plan as CouponFundingPlan,
    { ...plan, operationId: "00000000-0000-4000-8000-000000000003", lastValidBlockHeight: 20 } as CouponFundingPlan), false);
  for (const changes of [{ actionVersion: 7 }, { amountMinor: "1000000000" }, { totalCouponMinor: "2000000000" },
    { snapshotHash: "other" }, { settlementMint: "other" }, { treasuryTokenAccount: "other" },
    { requiredSigner: "other" }, { networkGenesisHash: "other" }]) {
    assert.equal(couponFundingReviewChanged(plan as CouponFundingPlan, { ...plan, ...changes } as CouponFundingPlan), true);
  }
});

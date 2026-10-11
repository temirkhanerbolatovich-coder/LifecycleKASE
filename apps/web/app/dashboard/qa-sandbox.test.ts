import assert from "node:assert/strict";
import test from "node:test";
import { createQaSandbox, QA_ACTION_IDS, QA_FRESH_INSTRUMENT_ID, QA_APPROVER, type QaActionStep } from "./qa-sandbox";
import { OperatorApiError } from "./operator-api";

const post = (body: object): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const rejected = (code: string) => (error: unknown) => error instanceof OperatorApiError && error.code === code;
async function prepare(model: ReturnType<typeof createQaSandbox>, actionId: string) {
  model.setActor("ISSUER");
  for (const step of ["SCHEDULE", "SNAPSHOT", "CALCULATE", "SUBMIT", "FUND", "RESERVE"] as QaActionStep[]) await model.advanceAction(actionId, step);
  model.setActor("APPROVER"); await model.advanceAction(actionId, "APPROVE"); model.setActor("ISSUER");
}
async function settle(model: ReturnType<typeof createQaSandbox>, actionId: string) {
  await prepare(model, actionId); for (let index = 0; index < 3; index++) await model.advanceAction(actionId, "PAY"); return model.advanceAction(actionId, "FINALIZE");
}
async function snapshot(model: ReturnType<typeof createQaSandbox>, actionId: string) {
  await model.advanceAction(actionId, "SCHEDULE"); await model.advanceAction(actionId, "SNAPSHOT"); await model.advanceAction(actionId, "CALCULATE");
}

test("isolated complete three-action simulation uses accepted integer formulas and atomic burn", async () => {
  const model = createQaSandbox();
  const initialCash = Object.values(model.exportState().receivedCashMinor).reduce((sum, value) => sum + BigInt(value), 0n);
  const coupon = await settle(model, QA_ACTION_IDS.coupon);
  assert.equal((coupon["qa"] as { totalAmountMinor: string }).totalAmountMinor, "1750000000");
  assert.equal(model.exportState().instruments.find(row => row.id === QA_FRESH_INSTRUMENT_ID)!.circulatingSupply, "35");
  const partial = await settle(model, QA_ACTION_IDS.partial);
  assert.equal((partial["qa"] as { totalAmountMinor: string }).totalAmountMinor, "7000000000");
  assert.equal(model.exportState().instruments.find(row => row.id === QA_FRESH_INSTRUMENT_ID)!.circulatingSupply, "28");
  const maturity = await settle(model, QA_ACTION_IDS.maturity);
  assert.equal((maturity["qa"] as { totalAmountMinor: string }).totalAmountMinor, "29400000000");
  const current = model.exportState().instruments.find(row => row.id === QA_FRESH_INSTRUMENT_ID)!;
  assert.equal(current.circulatingSupply, "0"); assert.equal(current.status, "REDEEMED");
  const finalCash = Object.values(model.exportState().receivedCashMinor).reduce((sum, value) => sum + BigInt(value), 0n);
  assert.equal(finalCash - initialCash, 38_150_000_000n);
  assert.equal(model.exportState().actions.find(row => row.id === QA_ACTION_IDS.maturity)!.receipt!["onChain"], false);
  assert.equal(model.exportState().transactions.every(row => row.signature === null && row.simulation), true);
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.maturity, "PAY"), rejected("QA_STEP_NOT_ALLOWED"));
});

test("auditor cannot mutate; issuer cannot approve; reserve and separate review are mandatory", async () => {
  const model = createQaSandbox(); model.setActor("AUDITOR"); const before = model.exportState();
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "SCHEDULE"), rejected("QA_ROLE_REQUIRED"));
  await assert.rejects(model.activateInstrument(QA_FRESH_INSTRUMENT_ID), rejected("QA_ROLE_REQUIRED"));
  await assert.rejects(model.request("/api/v1/investors", post({})), rejected("QA_ROLE_REQUIRED"));
  assert.deepEqual(model.exportState(), before);
  model.setActor("ISSUER"); await snapshot(model, QA_ACTION_IDS.coupon); await model.advanceAction(QA_ACTION_IDS.coupon, "SUBMIT");
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "APPROVE"), rejected("QA_ROLE_REQUIRED"));
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "RESERVE"), rejected("COUPON_RESERVE_REQUIRED"));
  model.setActor("APPROVER"); await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "APPROVE"), rejected("COUPON_RESERVE_REQUIRED"));
  assert.equal(model.exportState().transactions.some(row => row.requiredSigner === QA_APPROVER), true); // historical distinct reviewer
});

test("funding/reserve replay is blocked and incomplete finalization never changes state", async () => {
  const model = createQaSandbox(); await snapshot(model, QA_ACTION_IDS.coupon); await model.advanceAction(QA_ACTION_IDS.coupon, "SUBMIT");
  await model.advanceAction(QA_ACTION_IDS.coupon, "FUND"); await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "FUND"), rejected("QA_ALREADY_FUNDED"));
  await model.advanceAction(QA_ACTION_IDS.coupon, "RESERVE"); await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "RESERVE"), rejected("QA_ALREADY_RESERVED"));
  const before = model.exportState(); await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "FINALIZE"), rejected("QA_STEP_NOT_ALLOWED")); assert.deepEqual(model.exportState(), before);
});

test("return keeps immutable snapshot, releases reserve, and permits recalculation", async () => {
  const model = createQaSandbox(); await snapshot(model, QA_ACTION_IDS.coupon);
  const original = model.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.snapshot;
  for (const step of ["SUBMIT", "FUND", "RESERVE"] as QaActionStep[]) await model.advanceAction(QA_ACTION_IDS.coupon, step);
  model.setActor("APPROVER"); const before = model.exportState();
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.coupon, "RETURN", "x"), rejected("INVALID_REQUEST")); assert.deepEqual(model.exportState(), before);
  await model.advanceAction(QA_ACTION_IDS.coupon, "RETURN", "Проверьте источник расчёта");
  assert.deepEqual(model.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.snapshot, original);
  assert.equal(model.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.reservedMinor, "0");
  model.setActor("ISSUER"); await model.advanceAction(QA_ACTION_IDS.coupon, "CALCULATE");
  assert.equal(model.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.totalAmountMinor, "1750000000");
});

test("wallet revocation after approval blocks payment without consuming reserve or burning tokens", async () => {
  const model = createQaSandbox(); await prepare(model, QA_ACTION_IDS.partial);
  const holder = model.exportState().investors[0]!;
  await model.request(`/api/v1/investors/${holder.id}/wallets/${holder.wallets[0]!.id}/revoke`, post({ reasonCode: "SECURITY_CONCERN" }));
  const before = model.exportState(); await assert.rejects(model.advanceAction(QA_ACTION_IDS.partial, "PAY"), rejected("ELIGIBILITY_BLOCKED")); assert.deepEqual(model.exportState(), before);
});

test("local registry workflow verifies only explicit synthetic challenges and rejects replay", async () => {
  const model = createQaSandbox();
  const created = await model.request("/api/v1/investors", post({ displayName: "QA New", externalReference: "QA-NEW", countryCode: "KZ", type: "INDIVIDUAL" }));
  await assert.rejects(model.request("/api/v1/investors", post({ displayName: "QA New", externalReference: "QA-NEW", countryCode: "KZ", type: "INDIVIDUAL" })), rejected("REGISTRY_CONFLICT"));
  const wallet = await model.request(`/api/v1/investors/${created["id"]}/wallets`, post({ address: QA_APPROVER }));
  await assert.rejects(model.request(`/api/v1/investors/${created["id"]}/eligibility`, post({ decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" })), rejected("VERIFIED_WALLET_REQUIRED"));
  const challengePath = `/api/v1/investors/${created["id"]}/wallets/${wallet["id"]}/verification`;
  const challenge = await model.request(challengePath + "/challenge", post({}));
  const body = { challengeId: challenge["challengeId"], nonce: challenge["nonce"], signature: "QA_SIMULATED_PROOF" };
  await model.request(challengePath + "/verify", post(body));
  await assert.rejects(model.request(challengePath + "/verify", post(body)), rejected("QA_WALLET_STATE"));
  await model.request(`/api/v1/investors/${created["id"]}/eligibility`, post({ decision: "ELIGIBLE", reasonCode: "DEMO_CRITERIA_MET" }));
  await assert.rejects(model.request(`/api/v1/investors/${created["id"]}/eligibility`, post({ decision: "NOT_ELIGIBLE", reasonCode: "DEMO_CRITERIA_NOT_MET" })), rejected("ELIGIBILITY_ALREADY_DECIDED"));
});

test("new drafts validate dates, instrument status, money and stable action request IDs", async () => {
  const model = createQaSandbox();
  const body = { issuerLegalName: "QA Issuer", name: "QA Test Bond", ticker: "QA-NEW", faceValueKzt: "1000", couponRateBps: 1000,
    paymentsPerYear: 2, issueAt: "2026-01-01T00:00:00.000Z", maturityAt: "2028-01-01T00:00:00.000Z" };
  await assert.rejects(model.request("/api/v1/instruments", post({ ...body, faceValueKzt: "1e3" })), rejected("INVALID_REQUEST"));
  const created = await model.request("/api/v1/instruments", post(body));
  const actionBody = { requestId: crypto.randomUUID(), instrumentId: created["id"], type: "COUPON_PAYMENT", intent: "QA valid coupon", sourceType: "MANUAL",
    recordAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 300000).toISOString(), executeAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 900000).toISOString() };
  await assert.rejects(model.request("/api/v1/corporate-actions", post(actionBody)), rejected("INSTRUMENT_NOT_ACTIVE"));
  await model.activateInstrument(String(created["id"]));
  const createdAction = await model.request("/api/v1/corporate-actions", post(actionBody));
  const before = model.exportState(); const duplicate = await model.request("/api/v1/corporate-actions", post(actionBody)); assert.deepEqual(duplicate, createdAction); assert.deepEqual(model.exportState(), before);
  await assert.rejects(model.request("/api/v1/corporate-actions", post({ ...actionBody, intent: "Another action" })), rejected("ACTION_CONFLICT"));
  await assert.rejects(model.request("/api/v1/corporate-actions", post({ ...actionBody, requestId: crypto.randomUUID(), recordAt: "2026-02-31T00:00:00.000Z" })), rejected("INVALID_REQUEST"));
});

test("QA retains zero-rounded rows, blocks all-zero review and settles only positive obligations", async () => {
  for (const percentage of [1, 1000]) {
    const model = createQaSandbox(); const actionId = crypto.randomUUID();
    await model.request("/api/v1/corporate-actions", post({ requestId: actionId, instrumentId: QA_FRESH_INSTRUMENT_ID,
      type: "EARLY_REDEMPTION", intent: "Zero rounding regression", sourceType: "MANUAL",
      recordAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 300000).toISOString(),
      executeAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 900000).toISOString(),
      redemptionPercentageBps: percentage, redemptionPriceKzt: "1000" }));
    await snapshot(model, actionId);
    const calculated = model.exportState().actions.find(row => row.id === actionId)!;
    assert.equal(calculated.entitlements.length, 3);
    if (percentage === 1) {
      assert.equal(calculated.totalAmountMinor, "0"); assert.equal(calculated.status, "CALCULATED");
      assert.ok(calculated.entitlements.every(row => row.status === "NOT_ELIGIBLE_ZERO_ROUNDING"));
      const before = model.exportState();
      await assert.rejects(model.advanceAction(actionId, "SUBMIT"), rejected("CALCULATION_INCOMPLETE"));
      assert.deepEqual(model.exportState(), before);
    } else {
      for (const step of ["SUBMIT", "FUND", "RESERVE"] as QaActionStep[]) await model.advanceAction(actionId, step);
      model.setActor("APPROVER"); await model.advanceAction(actionId, "APPROVE"); model.setActor("ISSUER");
      await model.advanceAction(actionId, "PAY"); await model.advanceAction(actionId, "PAY");
      await model.advanceAction(actionId, "FINALIZE");
      const final = model.exportState().actions.find(row => row.id === actionId)!;
      assert.equal(final.entitlements.filter(row => row.status === "REDEEMED").length, 2);
      assert.equal(final.entitlements.filter(row => row.status === "NOT_ELIGIBLE_ZERO_ROUNDING").length, 1);
      assert.equal(final.reservedMinor, "0"); assert.equal(final.receipt!["tokensRedeemed"], "3");
      assert.equal(model.exportState().instruments.find(row => row.id === QA_FRESH_INSTRUMENT_ID)!.circulatingSupply, "32");
    }
  }
});

test("models never call network and reject unsupported auth, signing, traversal and mutation verbs", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error("network forbidden"); };
  try {
    const model = createQaSandbox(); await model.request("/api/v1/corporate-actions?limit=20");
    await assert.rejects(model.request("/api/v1/auth/session"), rejected("QA_ROUTE_UNAVAILABLE"));
    await assert.rejects(model.request("https://example.com/api/v1/investors"), rejected("QA_ROUTE_UNAVAILABLE"));
    await assert.rejects(model.request("/api/v1/../../auth/session"), rejected("QA_ROUTE_UNAVAILABLE"));
    await assert.rejects(model.request(`/api/v1/corporate-actions/${QA_ACTION_IDS.coupon}/prepare`, post({ phase: "SCHEDULE" })), rejected("QA_ROUTE_UNAVAILABLE"));
    await assert.rejects(model.request("/api/v1/investors", { method: "DELETE" }), rejected("INVALID_REQUEST"));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("independent models, returned clones, pagination and reset preserve isolated QA state", async () => {
  const one = createQaSandbox(); const two = createQaSandbox();
  const result = await one.request("/api/v1/instruments?limit=1");
  (result["items"] as { name: string }[])[0]!.name = "changed outside model";
  assert.notEqual(one.exportState().instruments[0]!.name, "changed outside model");
  const next = await one.request(`/api/v1/instruments?limit=1&cursor=${result["nextCursor"]}`); assert.equal((next["items"] as object[]).length, 1);
  await one.advanceAction(QA_ACTION_IDS.coupon, "SCHEDULE"); assert.equal(two.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.status, "DRAFT");
  one.reset(); assert.equal(one.exportState().actions.find(row => row.id === QA_ACTION_IDS.coupon)!.status, "DRAFT"); assert.equal(one.exportState().actor, "ISSUER");
  const controller = new AbortController(); controller.abort(); await assert.rejects(one.request("/api/v1/instruments", { signal: controller.signal }), { name: "AbortError" });
});

test("receipt accessor is final-only, immutable, and explicitly excludes chain proof", async () => {
  const model = createQaSandbox();
  assert.throws(() => model.actionReceipt(QA_ACTION_IDS.coupon), rejected("QA_RECEIPT_UNAVAILABLE"));
  await settle(model, QA_ACTION_IDS.coupon);
  const receipt = model.actionReceipt(QA_ACTION_IDS.coupon);
  assert.equal(receipt["mode"], "UI_SIMULATION"); assert.equal(receipt["no_chain_transaction"], true); assert.equal(receipt["onChain"], false);
  receipt["onChain"] = true;
  assert.equal(model.actionReceipt(QA_ACTION_IDS.coupon)["onChain"], false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createQaSandbox, QA_ACTION_IDS, QA_FRESH_INSTRUMENT_ID, QA_APPROVER, type QaActionStep } from "./qa-sandbox";
import { OperatorApiError } from "./operator-api";
import { encodeBase58 } from "./snapshot-workflow";
import { validatedCouponSummary, validatedExactRedemptionSummary, type EntitlementsView } from "./entitlement-workflow";

const post = (body: object): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const rejected = (code: string) => (error: unknown) => error instanceof OperatorApiError && error.code === code;

test("QA profile correction preserves snapshots, wallets and eligibility and rejects stale/no-op/duplicate/unauthorized writes atomically", async () => {
  const model = createQaSandbox(); const original = model.exportState(); const holder = original.investors[0]!;
  const path = `/api/v1/investors/${holder.id}/profile`;
  const body = { displayName: "  Corrected holder  ", type: "INSTITUTIONAL", countryCode: "us", externalReference: null, expectedVersion: 1, reasonCode: "REGISTRY_CORRECTION" };
  const updated = await model.request(path, post(body));
  assert.equal(updated["displayName"], "Corrected holder"); assert.equal(updated["countryCode"], "US");
  assert.equal(updated["externalReference"], null); assert.equal(updated["registryVersion"], 2);
  const after = model.exportState(); const current = after.investors[0]!;
  assert.deepEqual(current.wallets, holder.wallets); assert.equal(current.eligibilityStatus, holder.eligibilityStatus); assert.equal(current.kycStatus, holder.kycStatus);
  assert.deepEqual(after.actions, original.actions); assert.deepEqual(after.instruments, original.instruments);
  assert.equal(after.audit.at(-1)!.event, "INVESTOR_PROFILE_UPDATED");
  assert.deepEqual(after.audit.at(-1)!.metadataJson["changedFields"], ["displayName", "type", "countryCode", "externalReference"]);
  assert.equal(JSON.stringify(after.audit.at(-1)).includes("Corrected holder"), false);
  assert.equal(JSON.stringify(after.audit.at(-1)).includes(holder.externalReference!), false);
  await assert.rejects(model.request(path, post(body)), rejected("REGISTRY_CONFLICT"));
  await assert.rejects(model.request(path, post({ ...body, expectedVersion: 2 })), rejected("REGISTRY_TRANSITION_INVALID"));
  await assert.rejects(model.request(path, post({ ...body, expectedVersion: 2, externalReference: "QA-2" })), rejected("REGISTRY_CONFLICT"));
  for (const invalid of [ { ...body, expectedVersion: "2" }, { ...body, countryCode: "ıı" }, { ...body, countryCode: "ß" },
    { ...body, type: ["INDIVIDUAL"] }, { ...body, externalReference: "" }, { ...body, reasonCode: "OTHER" }, { ...body, eligibilityStatus: "ELIGIBLE" },
    { displayName: "Missing mandatory profile fields", expectedVersion: 2, reasonCode: "OWNER_REQUEST" } ]) {
    await assert.rejects(model.request(path, post(invalid)), rejected("INVALID_REQUEST"));
  }
  assert.deepEqual(model.exportState(), after);
  await assert.rejects(model.request("/api/v1/investors/abc/profile", post(body)), rejected("INVALID_REQUEST"));
  model.setActor("AUDITOR"); const readonly = model.exportState();
  assert.equal((await model.request(`/api/v1/investors/${holder.id}`))["registryVersion"], 2);
  await assert.rejects(model.request(path, post({ ...body, expectedVersion: 2, displayName: "Denied" })), rejected("QA_ROLE_REQUIRED"));
  assert.deepEqual(model.exportState(), readonly);
});

test("QA server search finds records outside the first registry page and wallet pages stay scoped to their investor", async () => {
  const model = createQaSandbox();
  for (let index = 0; index < 23; index++) await model.request("/api/v1/investors", post({ displayName: `Paged holder ${index}`, externalReference: `PAGED-${index}`, type: "INDIVIDUAL", countryCode: "KZ" }));
  const first = await model.request("/api/v1/investors?limit=20");
  const firstIds = (first["items"] as { id: string }[]).map(row => row.id);
  const outside = model.exportState().investors.find(row => !firstIds.includes(row.id))!;
  assert.equal((await model.request(`/api/v1/investors/${outside.id}`))["id"], outside.id);
  for (const search of [outside.id, outside.externalReference!, outside.displayName]) {
    const found = await model.request(`/api/v1/investors?limit=20&search=${encodeURIComponent(search)}`);
    assert.ok((found["items"] as { id: string }[]).some(row => row.id === outside.id));
  }
  for (let index = 0; index < 23; index++) {
    const address = encodeBase58(Uint8Array.from({ length: 32 }, (_, byte) => (index + byte + 190) % 256));
    await model.request(`/api/v1/investors/${outside.id}/wallets`, post({ address }));
  }
  const detail = await model.request(`/api/v1/investors/${outside.id}`);
  assert.equal((detail["wallets"] as unknown[]).length, 20); assert.equal((detail["_count"] as { wallets: number }).wallets, outside.wallets.length + 23);
  const firstWallets = await model.request(`/api/v1/investors/${outside.id}/wallets?limit=20`);
  const secondWallets = await model.request(`/api/v1/investors/${outside.id}/wallets?limit=20&cursor=${firstWallets["nextCursor"]}`);
  assert.equal((firstWallets["items"] as unknown[]).length, 20); assert.equal(secondWallets["nextCursor"], null);
  const all = [...firstWallets["items"] as { id: string; address: string }[], ...secondWallets["items"] as { id: string; address: string }[]];
  assert.equal(new Set(all.map(wallet => wallet.id)).size, outside.wallets.length + 23);
  const byWallet = await model.request(`/api/v1/investors?limit=20&search=${all.at(-1)!.address}`);
  assert.deepEqual((byWallet["items"] as { id: string }[]).map(row => row.id), [outside.id]);
  const byPartialWallet = await model.request(`/api/v1/investors?limit=20&search=${all.at(-1)!.address.slice(9, 25)}`);
  assert.deepEqual((byPartialWallet["items"] as { id: string }[]).map(row => row.id), [outside.id]);
  const foreign = model.exportState().investors.find(row => row.id !== outside.id)!.id;
  await assert.rejects(model.request(`/api/v1/investors/${foreign}/wallets?cursor=${all[0]!.id}`), rejected("INVALID_REQUEST"));
  await assert.rejects(model.request("/api/v1/investors?search=" + "x".repeat(201)), rejected("INVALID_REQUEST"));
  await assert.rejects(model.request("/api/v1/investors?search=a&search=b"), rejected("INVALID_REQUEST"));
  const noMatch = await model.request("/api/v1/investors?search=not-in-this-registry");
  assert.deepEqual(noMatch, { items: [], nextCursor: null });
  for (const countryCode of ["ß", "ıı"]) await assert.rejects(model.request("/api/v1/investors", post({
    displayName: "Invalid raw country", externalReference: "BAD-COUNTRY", type: "INDIVIDUAL", countryCode
  })), rejected("INVALID_REQUEST"));
});

test("QA search continuation survives a cursor profile correction that removes the anchor from results", async () => {
  const model = createQaSandbox();
  const first = await model.request("/api/v1/investors?limit=1&search=QA%20Investor");
  const anchor = (first["items"] as { id: string; type: string; countryCode: string; externalReference: string }[])[0]!;
  await model.request(`/api/v1/investors/${anchor.id}/profile`, post({ displayName: "Corrected record", type: anchor.type,
    countryCode: anchor.countryCode, externalReference: anchor.externalReference, expectedVersion: 1, reasonCode: "REGISTRY_CORRECTION" }));
  const continued = await model.request(`/api/v1/investors?limit=20&search=QA%20Investor&cursor=${first["nextCursor"]}`);
  assert.equal((continued["items"] as { id: string }[]).length, 2);
  assert.equal((continued["items"] as { id: string }[]).some(row => row.id === anchor.id), false);
});
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

test("QA coupon summary exposes exact gross accrual without making simulated funds or chain evidence", async () => {
  const model = createQaSandbox(); const initial = model.exportState();
  for (const actionId of Object.values(QA_ACTION_IDS)) {
    assert.equal((await model.request(`/api/v1/corporate-actions/${actionId}/entitlements`))["couponSummary"], null);
  }
  const actionId = QA_ACTION_IDS.coupon;
  await snapshot(model, actionId);
  const before = model.exportState();
  const response = await model.request(`/api/v1/corporate-actions/${actionId}/entitlements`);
  assert.deepEqual(response["couponSummary"], { roundedTotalMinor: "1750000000", theoreticalTotal: { numerator: "35000000000000", denominator: "20000" },
    roundingResidual: { numerator: "0", denominator: "20000" }, roundingPolicy: "FLOOR_PER_INVESTOR", residualDestination: "TREASURY", taxTreatment: "NOT_IMPLEMENTED" });
  assert.equal(validatedCouponSummary(response as unknown as EntitlementsView)!.roundedTotalMinor, "1750000000");
  assert.deepEqual(model.exportState(), before);
  assert.deepEqual(before.receivedCashMinor, initial.receivedCashMinor);
  assert.ok(before.transactions.every(row => row.signature === null && row.status === "QA_SIMULATED"));
  const redemptionModel = createQaSandbox();
  await snapshot(redemptionModel, QA_ACTION_IDS.partial);
  assert.equal((await redemptionModel.request(`/api/v1/corporate-actions/${QA_ACTION_IDS.partial}/entitlements`))["couponSummary"], null);
});

test("QA exact-target fixture uses immutable snapshot owners and reconciles 35 bonds to target 7 with no chain proof", async () => {
  const model = createQaSandbox();
  const draft = await model.request(`/api/v1/corporate-actions/${QA_ACTION_IDS.partial}`);
  assert.equal(draft["redemptionAllocationPolicy"], "exact-target-largest-remainder-v2");
  assert.equal(draft["redemptionTargetTokens"], "7"); assert.equal(draft["redemptionPercentageBps"], null);
  await snapshot(model, QA_ACTION_IDS.partial);
  const before = model.exportState();
  const response = await model.request(`/api/v1/corporate-actions/${QA_ACTION_IDS.partial}/entitlements`) as unknown as EntitlementsView;
  assert.deepEqual(validatedExactRedemptionSummary(response), {
    policy: "exact-target-largest-remainder-v2", targetTokens: "7", allocatedTokens: "7", totalBalance: "35", remainingTokens: "28", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC"
  });
  assert.deepEqual(response.items.map(row => [row.balanceAtRecordDate, row.tokensToRedeem, row.calculationInputs.remainingTokens]), [["10", "2", "8"], ["20", "4", "16"], ["5", "1", "4"]]);
  assert.deepEqual(model.exportState(), before);
  assert.equal(response.onchainRegistrationEnabled, false); assert.equal(response.onchainCalculationFinalized, false);
  assert.ok(before.transactions.every(row => row.signature === null && row.simulation));
});

test("QA v2 exact target distributes a residual token, settles only the winner and rejects changed draft targets or overdraw atomically", async () => {
  const model = createQaSandbox(); const actionId = crypto.randomUUID();
  const body = { requestId: actionId, instrumentId: QA_FRESH_INSTRUMENT_ID, type: "EARLY_REDEMPTION", intent: "Exact target residual regression", sourceType: "MANUAL",
    recordAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 300000).toISOString(), executeAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 900000).toISOString(),
    redemptionAllocationPolicy: "exact-target-largest-remainder-v2", redemptionTargetTokens: "1", redemptionPercentageBps: null, redemptionPriceKzt: "1000" };
  const created = await model.request("/api/v1/corporate-actions", post(body));
  assert.deepEqual(await model.request("/api/v1/corporate-actions", post(body)), created);
  await assert.rejects(model.request("/api/v1/corporate-actions", post({ ...body, redemptionTargetTokens: "2" })), rejected("ACTION_CONFLICT"));
  for (const change of [{ redemptionTargetTokens: "0" }, { redemptionTargetTokens: "1.5" }, { redemptionTargetTokens: 1 },
    { redemptionPercentageBps: 2000 }, { redemptionAllocationPolicy: "integer-entitlements-v1" }]) {
    const before = model.exportState();
    await assert.rejects(model.request("/api/v1/corporate-actions", post({ ...body, requestId: crypto.randomUUID(), ...change })), rejected("INVALID_REQUEST"));
    assert.deepEqual(model.exportState(), before);
  }
  await snapshot(model, actionId);
  const response = await model.request(`/api/v1/corporate-actions/${actionId}/entitlements`) as unknown as EntitlementsView;
  assert.deepEqual(response.items.map(row => row.tokensToRedeem), ["0", "1", "0"]);
  assert.equal(validatedExactRedemptionSummary(response)!.allocatedTokens, "1");
  for (const step of ["SUBMIT", "FUND", "RESERVE"] as QaActionStep[]) await model.advanceAction(actionId, step);
  model.setActor("APPROVER"); await model.advanceAction(actionId, "APPROVE"); model.setActor("ISSUER");
  await model.advanceAction(actionId, "PAY"); await model.advanceAction(actionId, "FINALIZE");
  const final = model.exportState().actions.find(row => row.id === actionId)!;
  assert.equal(final.entitlements.filter(row => row.status === "REDEEMED").length, 1);
  assert.equal(final.receipt!["tokensRedeemed"], "1"); assert.equal(final.receipt!["finalSupply"], "34");
  assert.equal(final.receipt!["onChain"], false); assert.equal(final.reservedMinor, "0");
  assert.equal(final.receipt!["snapshotSupply"], "35"); assert.equal(final.receipt!["totalBalance"], "35");
  assert.deepEqual(final.receipt!["snapshot"], { hash: final.snapshot!.snapshotHash, mintSupply: "35" });
  assert.deepEqual(final.receipt!["allocation"], { policy: "exact-target-largest-remainder-v2", targetTokens: "1",
    totalBalance: "35", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" });
  const receiptItems = final.receipt!["items"] as Array<{ investorId: string; tokensToRedeem: string;
    exactAllocation: { balanceAtRecordDate: string; tieAddress: string } }>;
  assert.equal(receiptItems.filter(item => item.tokensToRedeem === "0").length, 2);
  for (const item of receiptItems) assert.deepEqual(item.exactAllocation, {
    balanceAtRecordDate: final.holderBalances[item.investorId],
    tieAddress: final.holderSources[item.investorId]!.map(source => source.walletAddress).sort()[0]
  });

  const tooLargeId = crypto.randomUUID();
  await model.request("/api/v1/corporate-actions", post({ ...body, requestId: tooLargeId, redemptionTargetTokens: "35" }));
  await model.advanceAction(tooLargeId, "SCHEDULE"); await model.advanceAction(tooLargeId, "SNAPSHOT");
  const before = model.exportState();
  await assert.rejects(model.advanceAction(tooLargeId, "CALCULATE"), /targetTokens must not exceed totalBalance/);
  assert.deepEqual(model.exportState(), before);
});

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

test("eligibility review and temporary wallet blocking stop future payment without rewriting snapshot or reserve", async () => {
  const model = createQaSandbox(); await prepare(model, QA_ACTION_IDS.partial);
  const initial = model.exportState(); const holder = initial.investors[0]!; const wallet = holder.wallets[0]!;
  const reviewPath = `/api/v1/investors/${holder.id}/eligibility/review`;
  const statusPath = `/api/v1/investors/${holder.id}/wallets/${wallet.id}/status`;
  await model.request(reviewPath, post({ decision: "SUSPENDED", expectedVersion: holder.registryVersion, reasonCode: "PERIODIC_REVIEW" }));
  const suspended = model.exportState();
  assert.deepEqual(suspended.actions, initial.actions);
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.partial, "PAY"), rejected("ELIGIBILITY_BLOCKED"));
  assert.deepEqual(model.exportState(), suspended);
  await model.request(reviewPath, post({ decision: "ELIGIBLE", expectedVersion: holder.registryVersion + 1, reasonCode: "REGISTRY_CORRECTION" }));
  await assert.rejects(model.request(reviewPath, post({ decision: "NOT_ELIGIBLE", expectedVersion: holder.registryVersion, reasonCode: "OWNER_REQUEST" })), rejected("REGISTRY_CONFLICT"));
  await model.request(statusPath, post({ status: "BLOCKED", expectedVersion: wallet.registryVersion, reasonCode: "SECURITY_CONCERN" }));
  const blocked = model.exportState();
  assert.deepEqual(blocked.actions, initial.actions);
  await assert.rejects(model.advanceAction(QA_ACTION_IDS.partial, "PAY"), rejected("ELIGIBILITY_BLOCKED"));
  assert.deepEqual(model.exportState(), blocked);
  await model.request(statusPath, post({ status: "ACTIVE", expectedVersion: wallet.registryVersion + 1, reasonCode: "OWNER_REQUEST" }));
  await assert.rejects(model.request(statusPath, post({ status: "BLOCKED", expectedVersion: wallet.registryVersion, reasonCode: "OWNER_REQUEST" })), rejected("REGISTRY_CONFLICT"));
  const restored = model.exportState().investors[0]!.wallets[0]!;
  assert.equal(restored.verifiedAt, wallet.verifiedAt); assert.equal(restored.revokedAt, null);
  assert.equal(restored.address, wallet.address); assert.equal(restored.registryVersion, wallet.registryVersion + 2);
  await model.advanceAction(QA_ACTION_IDS.partial, "PAY");
  assert.equal(model.exportState().actions.find(row => row.id === QA_ACTION_IDS.partial)!.entitlements[0]!.status, "REDEEMED");
});

test("QA registry transitions validate version, fixed reason, no-op, revoked wallets and read-only roles", async () => {
  const model = createQaSandbox(); const holder = model.exportState().investors[0]!; const wallet = holder.wallets[0]!;
  const reviewPath = `/api/v1/investors/${holder.id}/eligibility/review`;
  const statusPath = `/api/v1/investors/${holder.id}/wallets/${wallet.id}/status`;
  for (const body of [{ status: "BLOCKED", expectedVersion: "1", reasonCode: "SECURITY_CONCERN" },
    { status: "BLOCKED", expectedVersion: 1, reasonCode: "OTHER" }, { status: "REVOKED", expectedVersion: 1, reasonCode: "OWNER_REQUEST" },
    { status: "BLOCKED", expectedVersion: 1, reasonCode: "OWNER_REQUEST", verifiedAt: "now" }]) {
    const before = model.exportState(); await assert.rejects(model.request(statusPath, post(body)), rejected("INVALID_REQUEST"));
    assert.deepEqual(model.exportState(), before);
  }
  await assert.rejects(model.request(reviewPath, post({ decision: "ELIGIBLE", expectedVersion: 1, reasonCode: "PERIODIC_REVIEW" })), rejected("REGISTRY_TRANSITION_INVALID"));
  for (const actor of ["AUDITOR", "APPROVER"] as const) {
    model.setActor(actor);
    await assert.rejects(model.request(statusPath, post({ status: "BLOCKED", expectedVersion: 1, reasonCode: "OWNER_REQUEST" })), rejected("QA_ROLE_REQUIRED"));
    await assert.rejects(model.request(reviewPath, post({ decision: "SUSPENDED", expectedVersion: 1, reasonCode: "OWNER_REQUEST" })), rejected("QA_ROLE_REQUIRED"));
  }
  model.setActor("ISSUER");
  await model.request(`/api/v1/investors/${holder.id}/wallets/${wallet.id}/revoke`, post({ reasonCode: "OWNER_REQUEST" }));
  await assert.rejects(model.request(statusPath, post({ status: "ACTIVE", expectedVersion: 2, reasonCode: "OWNER_REQUEST" })), rejected("WALLET_STATUS_TRANSITION_INVALID"));
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

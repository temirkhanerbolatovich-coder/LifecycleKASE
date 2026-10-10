import assert from "node:assert/strict";
import { createHash, randomUUID, sign } from "node:crypto";
import { verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";
import { confirmCouponExecution } from "../apps/api/dist/coupon-execution.js";

/** Generated PostgreSQL database and disposable validator; never imports .env or uses owner signing keys. */
export async function testLiveCouponExecution({ database, request, write, administrator, auditor, outsider, actionId, rpc }) {
  const { preparedCouponExecution } = await import("../apps/web/.test-dist/coupon-execution-workflow.js");
  process.env.COUPON_EXECUTION_ENABLED = "true";
  const path = `/corporate-actions/${actionId}/coupon/execution`;
  const get = async () => {
    const result = await request(path, { cookie: auditor.cookie }); assert.equal(result.status, 200, JSON.stringify(result.payload)); return result.payload;
  };
  let state = await get(); assert.equal(state.paid, 0);
  const snapshot = await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } });
  const snapshotBefore = Buffer.from(snapshot.snapshotHash).toString("hex");
  const firstId = state.items[0].id;
  const beforeAttemptCount = await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "COUPON_PAYMENT" } });
  const base = { phase: "PAY", version: state.actionVersion, entitlementId: firstId, idempotencyKey: randomUUID() };
  assert.equal((await request(path + "/prepare", { ...write(base), cookie: auditor.cookie })).status, 403);
  assert.equal((await request(path + "/prepare", { ...write(base), cookie: outsider.cookie })).status, 403);
  assert.equal((await request(path + "/prepare", { ...write(base), requestOrigin: "https://foreign.invalid" })).status, 403);
  assert.equal((await request(`/corporate-actions/${actionId}/receipt`, { cookie: auditor.cookie })).status, 404);
  assert.equal(await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "COUPON_PAYMENT" } }), beforeAttemptCount);
  const deadline = Date.now() + 180_000;
  while (true) {
    const slot = await rpc.request("getSlot", [{ commitment: "finalized" }]); const time = await rpc.request("getBlockTime", [slot]);
    if (time * 1000 >= Date.parse(state.executeAt)) break;
    if (Date.now() > deadline) throw new Error("Disposable coupon execute time was not reached");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal((await request(path + "/prepare", write({ phase: "FINALIZE", version: state.actionVersion, idempotencyKey: randomUUID() }))).status, 409);
  for (const [index, item] of state.items.entries()) {
    state = await get(); const body = { phase: "PAY", version: state.actionVersion, entitlementId: item.id, idempotencyKey: randomUUID() };
    if (index === 1) {
      const wallet = await database.wallet.findUniqueOrThrow({ where: { address: item.receiver } });
      await database.wallet.update({ where: { id: wallet.id }, data: { status: "BLOCKED" } });
      assert.equal((await request(path + "/prepare", write(body))).payload.code, "ELIGIBILITY_BLOCKED");
      await database.wallet.update({ where: { id: wallet.id }, data: { status: wallet.status } });
    }
    const response = await request(path + "/prepare", write(body)); assert.equal(response.status, 201, JSON.stringify(response.payload)); const plan = response.payload;
    assert.equal((await preparedCouponExecution(plan, state, administrator.walletAddress)).entitlementId, item.id);
    const restored = await request(path + "/prepare", write(body)); assert.equal(restored.payload.operationId, plan.operationId);
    assert.equal((await request(path + "/prepare", write({ ...body, entitlementId: state.items[(index + 1) % 3].id }))).payload.code, "IDEMPOTENCY_CONFLICT");
    const wire = Buffer.from(plan.serializedTransactionBase64, "base64"); sign(null, wire.subarray(65), administrator.privateKey).copy(wire, 1);
    const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64, signedTransactionBase64: wire.toString("base64"), requiredSigner: administrator.walletAddress });
    const tampered = Buffer.from(wire); tampered[tampered.length - 1] ^= 1;
    assert.equal((await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: tampered.toString("base64") }))).status, 400);
    const sent = await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") })); assert.equal(sent.status, 201, JSON.stringify(sent.payload));
    assert.equal((await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") }))).status, 409);
    const finishDeadline = Date.now() + 90_000;
    while ((await rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0]?.confirmationStatus !== "finalized") {
      if (Date.now() > finishDeadline) throw new Error("Coupon did not finalize"); await new Promise(resolve => setTimeout(resolve, 500));
    }
    while (await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]) === null) {
      if (Date.now() > finishDeadline) throw new Error("Coupon finalized bytes did not become available");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (index === 0) {
      const attempt = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } });
      const missingHistory = { request: async (method, params) => method === "getTransaction" ? null : method === "getSignatureStatuses" ? { value: [null] } : rpc.request(method, params) };
      const actor = { id: administrator.userId, walletAddress: administrator.walletAddress, correlationId: randomUUID() };
      const options = { enabled: true, cluster: "localnet", expectedGenesisHash: process.env.SOLANA_GENESIS_HASH, programId: process.env.PROGRAM_ID, rpcEndpoint: process.env.SOLANA_RPC_URL, rpcTimeoutMs: 15_000 };
      await assert.rejects(confirmCouponExecution(database, missingHistory, actionId, { operationId: attempt.id, signature }, actor, options));
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: attempt.id } })).status, "UNKNOWN_CONFIRMATION");
      assert.equal((await request(path + "/prepare", write(body))).payload.operationId, plan.operationId);
      await database.$executeRawUnsafe(`CREATE FUNCTION test_coupon_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'COUPON_PAYMENT_FINALIZED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await database.$executeRawUnsafe(`CREATE TRIGGER test_coupon_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_coupon_audit_failure()`);
      assert.equal((await request(path + "/confirm", write({ operationId: plan.operationId, signature }))).status, 500);
      assert.equal((await database.entitlement.findUniqueOrThrow({ where: { id: item.id } })).status, "READY");
      assert.equal(await database.settlement.count({ where: { entitlementId: item.id } }), 0);
      await database.$executeRawUnsafe(`DROP TRIGGER test_coupon_audit_failure ON audit_logs`); await database.$executeRawUnsafe(`DROP FUNCTION test_coupon_audit_failure()`);
    }
    const confirmed = await request(path + "/confirm", write({ operationId: plan.operationId, signature })); assert.equal(confirmed.status, 201, JSON.stringify(confirmed.payload));
    const auditCount = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal((await request(path + "/confirm", write({ operationId: plan.operationId, signature }))).status, 201);
    assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), auditCount);
    assert.equal((await request(path + "/prepare", write(body))).payload.status, "FINALIZED");
    assert.equal((await request(path + "/prepare", write({ ...body, version: (await get()).actionVersion, idempotencyKey: randomUUID() }))).status, 409);
    const settlement = await database.settlement.findUniqueOrThrow({ where: { entitlementId: item.id }, include: { legs: true } });
    assert.equal(settlement.reconciliationStatus, "MATCHED"); assert.equal(settlement.actualAmountMinor.toString(), item.amountMinor); assert.equal(settlement.legs.length, 2);
    assert.equal(settlement.legs.find(leg => leg.type === "ASSET").actualAmountMinor, null);
  }
  state = await get(); assert.equal(state.paid, 3); assert.equal(state.status, "SETTLED");
  assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).processedEntitlements, 3);
  const body = { phase: "FINALIZE", version: state.actionVersion, idempotencyKey: randomUUID() };
  const planned = await request(path + "/prepare", write(body)); assert.equal(planned.status, 201, JSON.stringify(planned.payload)); const plan = planned.payload;
  assert.equal((await preparedCouponExecution(plan, state, administrator.walletAddress)).phase, "FINALIZE");
  const draft = await request(`/corporate-actions/${actionId}/receipt`, { cookie: auditor.cookie }); assert.equal(draft.payload.status, "DRAFT");
  assert.equal(createHash("sha256").update(draft.payload.canonicalJson).digest("hex"), draft.payload.sha256);
  const wire = Buffer.from(plan.serializedTransactionBase64, "base64"); sign(null, wire.subarray(65), administrator.privateKey).copy(wire, 1);
  const savedReceipt = await database.actionReceipt.findUniqueOrThrow({ where: { corporateActionId: actionId } });
  await database.actionReceipt.update({ where: { id: savedReceipt.id }, data: { payloadJson: { ...savedReceipt.payloadJson, totalAmountMinor: "1" } } });
  assert.equal((await request(`/corporate-actions/${actionId}/receipt`, { cookie: auditor.cookie })).payload.code, "RECEIPT_INTEGRITY");
  assert.equal((await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") }))).payload.code, "RECEIPT_INTEGRITY");
  assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).signature, null);
  await database.actionReceipt.update({ where: { id: savedReceipt.id }, data: { payloadJson: savedReceipt.payloadJson } });
  const sent = await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: wire.toString("base64") })); assert.equal(sent.status, 201, JSON.stringify(sent.payload));
  const finishDeadline = Date.now() + 90_000;
  while (true) {
    const result = await request(path + "/confirm", write({ operationId: plan.operationId, signature: sent.payload.signature }));
    if (result.status === 201) break;
    assert.ok(["TRANSACTION_NOT_FINALIZED", "TRANSACTION_UNAVAILABLE", "TRANSACTION_HISTORY_UNAVAILABLE"].includes(result.payload.code), JSON.stringify(result.payload));
    if (Date.now() > finishDeadline) throw new Error("Coupon receipt did not finalize"); await new Promise(resolve => setTimeout(resolve, 500));
  }
  const receipt = await request(`/corporate-actions/${actionId}/receipt`, { cookie: auditor.cookie });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.payload)); assert.equal(receipt.payload.status, "FINALIZED"); assert.equal(receipt.payload.sha256, draft.payload.sha256);
  assert.ok(receipt.payload.onchainPda); assert.equal((await get()).status, "FINALIZED");
  assert.equal(Buffer.from((await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } })).snapshotHash).toString("hex"), snapshotBefore);
  assert.equal((await request("/transactions")).status, 401);
  assert.equal((await request(`/corporate-actions/${actionId}/audit`, { cookie: auditor.cookie })).status, 200);
  const journal = await request(`/transactions?actionId=${actionId}&limit=2`, { cookie: auditor.cookie });
  assert.equal(journal.status, 200); assert.equal(journal.headers.get("cache-control"), "no-store"); assert.equal(journal.payload.items.length, 2);
  assert.ok(journal.payload.items.every(row => row.preparedPayload === undefined && row.preparedTransactionBase64 === undefined));
  const next = await request(`/transactions?actionId=${actionId}&limit=2&cursor=${journal.payload.nextCursor}`, { cookie: auditor.cookie });
  assert.ok(next.payload.items.every(row => !journal.payload.items.some(previous => row.id === previous.id)));
  assert.equal((await request(`/transactions/${receipt.payload.signature}`, { cookie: auditor.cookie })).payload.status, "FINALIZED");
  console.log("PASS coupon HTTP/PostgreSQL + real validator: exact 500/1000/250 deltas, role/origin/current-receiver guards, saved-key restore/conflict, exact-wire rejection, no rebroadcast, missing-history recovery, atomic audit rollback, two legs MATCHED, canonical JSON/hash and finalized ActionReceipt PDA", JSON.stringify({ actionId, sha256: receipt.payload.sha256, signature: receipt.payload.signature }));
}

import assert from "node:assert/strict";

// Invoked only after real snapshot/calculation in the existing disposable-validator DB.
export async function testCouponFundingFlow({ database, request, write, administrator, auditor, outsider, actionId, version, signAndSubmit, confirm }) {
  const path = `/corporate-actions/${actionId}/coupon`;
  const read = async () => { const response = await request(path + "/budget", { cookie: auditor.cookie });
    assert.equal(response.status, 200, JSON.stringify(response.payload)); return response.payload; };
  assert.equal((await request(path + "/budget")).status, 401);
  let budget = await read(); assert.equal(budget.totalCouponMinor, "1750000000");
  assert.equal(budget.treasuryBalanceMinor, "0"); assert.equal(budget.deficitMinor, "1750000000");
  assert.equal(budget.budgetReady, false); assert.equal(budget.executionAvailable, false);
  for (const cookie of [auditor.cookie, outsider.cookie]) {
    const response = await request(path + "/funding/prepare", { ...write({ version }), cookie }); assert.equal(response.status, 403);
  }
  assert.equal((await request(path + "/funding/prepare", { ...write({ version }), requestOrigin: "https://untrusted.example" })).status, 403);
  assert.equal((await request(path + "/funding/prepare", write({ version, amountMinor: "999" }))).status, 400);
  assert.equal((await request(path + "/funding/prepare", write({ version: version - 1 }))).status, 409);
  const beforeAudit = await database.auditLog.count({ where: { corporateActionId: actionId, event: "COUPON_FUNDING_PREPARED" } });
  await database.$executeRawUnsafe(`CREATE FUNCTION test_funding_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'COUPON_FUNDING_PREPARED' THEN RAISE EXCEPTION 'synthetic funding audit failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER test_funding_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_funding_audit_failure()`);
  assert.equal((await request(path + "/funding/prepare", write({ version }))).status, 500);
  assert.equal(await database.blockchainTransaction.count({ where: { corporateActionId: actionId, operationType: "COUPON_FUNDING" } }), 0);
  await database.$executeRawUnsafe(`DROP TRIGGER test_funding_audit_failure ON audit_logs`);
  await database.$executeRawUnsafe(`DROP FUNCTION test_funding_audit_failure()`);
  const attempts = await Promise.all([request(path + "/funding/prepare", write({ version })), request(path + "/funding/prepare", write({ version }))]);
  assert.ok(attempts.some(response => response.status === 201), JSON.stringify(attempts));
  assert.ok(attempts.every(response => [201, 409].includes(response.status)), JSON.stringify(attempts));
  const plan = attempts.find(response => response.status === 201).payload;
  assert.equal(plan.amountMinor, "1750000000"); assert.equal(plan.requiredSigner, administrator.walletAddress);
  assert.equal(await database.blockchainTransaction.count({ where: { instrumentId: plan.instrumentId, corporateActionId: actionId, operationType: "COUPON_FUNDING" } }), 1);
  const resumed = await request(path + "/funding/prepare", write({ version }));
  assert.equal(resumed.payload.operationId, plan.operationId); assert.equal(resumed.payload.serializedTransactionBase64, plan.serializedTransactionBase64);
  const signature = await signAndSubmit(plan, "coupon/funding/");
  const saved = await request(path + "/funding/prepare", write({ version })); assert.equal(saved.payload.signature, signature);
  assert.equal((await read()).fundingAttempt.operationId, plan.operationId);
  await database.$executeRawUnsafe(`CREATE FUNCTION test_funding_confirm_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'COUPON_FUNDING_FINALIZED' THEN RAISE EXCEPTION 'synthetic funding confirmation audit failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER test_funding_confirm_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_funding_confirm_audit_failure()`);
  assert.equal((await request(path + "/funding/confirm", write({ operationId: plan.operationId, signature }))).status, 500);
  assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).status, "SUBMITTED");
  await database.$executeRawUnsafe(`DROP TRIGGER test_funding_confirm_audit_failure ON audit_logs`);
  await database.$executeRawUnsafe(`DROP FUNCTION test_funding_confirm_audit_failure()`);
  await confirm(plan, signature, "coupon/funding/"); budget = await read();
  assert.equal(budget.treasuryBalanceMinor, "1750000000"); assert.equal(budget.mintSupplyMinor, "1750000000");
  assert.equal(budget.deficitMinor, "0"); assert.equal(budget.budgetReady, true); assert.equal(budget.executionAvailable, false);
  const repeated = await request(path + "/funding/prepare", write({ version })); assert.equal(repeated.payload.operationId, plan.operationId); assert.equal(repeated.payload.signature, signature);
  const audit = await database.auditLog.findMany({ where: { corporateActionId: actionId, event: { in: ["COUPON_FUNDING_PREPARED", "COUPON_FUNDING_FINALIZED"] } } });
  assert.equal(audit.length, beforeAudit + 2); assert.ok(audit.every(event => event.actorWallet === administrator.walletAddress && event.metadataJson.operationSource === "HTTP"));
  assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).status, "UNDER_REVIEW");
  assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, status: "READY" } }), 0);
  console.log("PASS live Localnet coupon funding through HTTP/PostgreSQL: exact 1750 treasury mint/delta, roles/Origin, concurrency, preparation/finalization audit rollback, resume and no approval/payment");
  console.log("Disposable coupon funding evidence", JSON.stringify({ actionId, operationId: plan.operationId, signature,
    settlementMint: budget.settlementMint, treasury: budget.treasuryTokenAccount, balanceMinor: budget.treasuryBalanceMinor, slot: budget.finalizedSlot }));
}

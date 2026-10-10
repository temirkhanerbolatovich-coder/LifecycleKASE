import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { NestFactory } from "@nestjs/core";
import { encodePublicKey, HttpSolanaRpc, verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";

// Only the disposable validator wrapper can supply this fixture and temporary signer.
const fixture = JSON.parse(process.argv[2] ?? "null");
const administratorPath = process.argv[3];
assert.ok(fixture?.kaseDemo && process.send, "Use the isolated KASE demo wrapper");
assert.match(fixture.rpcUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(administratorPath ?? "", /lifecycle-kase-integration\.[^\\/]+[\\/]admin\.json$/);
const base = new URL(process.env.ACTION_TEST_DATABASE_URL ?? "");
assert.equal(base.protocol, "postgresql:");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
assert.match(base.port, /^[0-9]{2,5}$/); assert.equal(base.pathname, "/lifecycle_kase");
const name = "actions_test_" + randomUUID().replaceAll("-", "");
const databaseUrl = new URL(base); databaseUrl.pathname = "/" + name;
const baseDatabase = new PrismaClient({ datasources: { db: { url: base.toString() } } });
const origin = "http://localhost:3000";
const rpc = new HttpSolanaRpc(fixture.rpcUrl, 20_000);
const secret = Uint8Array.from(JSON.parse(await readFile(administratorPath, "utf8")));
assert.equal(secret.length, 64);
const issuerKey = { walletAddress: encodePublicKey(secret.slice(32)), privateKey: createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secret.slice(0, 32))]),
  format: "der", type: "pkcs8" }) };
let database, app, created = false;
const pendingTransfers = new Map();
process.on("message", message => {
  const pending = pendingTransfers.get(message?.id);
  if (!pending) return;
  pendingTransfers.delete(message.id);
  message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.signature);
});
function transfer(from, to, amount) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pendingTransfers.set(id, { resolve, reject });
    process.send({ id, kind: "TRANSFER", from, to, amount: String(amount) });
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function finalized(signature, allowError = false) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const row = (await rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0];
    if (row?.confirmationStatus === "finalized") {
      if (!allowError) assert.equal(row.err, null, JSON.stringify(row));
      return row;
    }
    await sleep(500);
  }
  throw new Error("Disposable signature did not finalize: " + signature);
}
async function mintSupply() {
  return BigInt((await rpc.request("getTokenSupply", [fixture.bondMint, { commitment: "finalized" }])).value.amount);
}
const evidence = { schema: "kase-three-actions-demo-v1", scope: "DISPOSABLE_LOCALNET", simulated: ["KZT-Test", "investor eligibility"],
  instrumentId: fixture.instrumentId, programId: fixture.programId, bondMint: fixture.bondMint, actions: [], transfers: [] };
try {
  await baseDatabase.$executeRawUnsafe('CREATE DATABASE "' + name + '"'); created = true;
  const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: databaseUrl.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Fresh demo database migration failed");
  Object.assign(process.env, { DATABASE_URL: databaseUrl.toString(), AUTH_ENABLED: "true", AUTH_DOMAIN: "localhost:3000",
    AUTH_ALLOWED_ORIGINS: origin + ",http://localhost:13060", AUTH_COOKIE_SECURE: "false", SOLANA_CLUSTER: "localnet", WALLET_NETWORK: "SOLANA_LOCALNET",
    LOCALNET_PROGRAM_UPGRADE_ENABLED: "false", MUTATION_RATE_LIMIT: "500", AUTH_CHALLENGE_RATE_LIMIT: "30", AUTH_VERIFY_RATE_LIMIT: "30",
    PROGRAM_ID: fixture.programId, SOLANA_RPC_URL: fixture.rpcUrl, SOLANA_GENESIS_HASH: await rpc.request("getGenesisHash", []),
    ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "true", ACTION_APPROVAL_RESERVE_ENABLED: "true",
    COUPON_EXECUTION_ENABLED: "true", REDEMPTION_EXECUTION_ENABLED: "true" });
  evidence.genesisHash = process.env.SOLANA_GENESIS_HASH;
  database = new PrismaClient();
  const { AppModule } = await import("../apps/api/dist/app.module.js");
  const { provisionOperator } = await import("../apps/api/dist/operator-provisioning.js");
  app = await NestFactory.create(AppModule, { logger: process.env.ACTION_TEST_DEBUG === "1" ? ["error"] : false });
  app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1"); const host = await app.getUrl();
  async function request(path, { cookie, body, method = "GET", requestOrigin = origin } = {}) {
    const response = await fetch(host + "/api/v1" + path, { method, signal: AbortSignal.timeout(25_000), headers: {
      "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(requestOrigin ? { origin: requestOrigin } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  }
  async function login(role, suppliedKey) {
    const pair = suppliedKey ? null : generateKeyPairSync("ed25519");
    const key = suppliedKey ?? { walletAddress: encodePublicKey(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)), privateKey: pair.privateKey };
    const user = await provisionOperator(database, { walletAddress: key.walletAddress, displayName: "KASE demo " + role,
      role, network: "SOLANA_LOCALNET", now: new Date() });
    const challenge = await request("/auth/challenge", { method: "POST", body: { walletAddress: key.walletAddress } });
    assert.equal(challenge.status, 201, JSON.stringify(challenge.payload));
    const result = await request("/auth/verify", { method: "POST", body: { challengeId: challenge.payload.challengeId, nonce: challenge.payload.nonce,
      signature: sign(null, Buffer.from(challenge.payload.message), key.privateKey).toString("base64") } });
    assert.equal(result.status, 201, JSON.stringify(result.payload));
    return { ...user, ...key, cookie: result.headers.getSetCookie()[0].split(";")[0] };
  }
  const administrator = await login("ADMINISTRATOR", issuerKey), approver = await login("ADMINISTRATOR"), auditor = await login("AUDITOR");
  await finalized(await rpc.request("requestAirdrop", [approver.walletAddress, 2_000_000_000]));
  const issuer = await database.issuer.create({ data: { legalName: "Synthetic KASE demo issuer" } });
  const asset = await database.settlementAsset.create({ data: { code: "KZT_TEST", name: "KZT-Test", network: "SOLANA_LOCALNET",
    mintAddress: fixture.settlementMint, disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." } });
  const instrument = await database.instrument.create({ data: { id: fixture.instrumentId, issuerId: issuer.id, settlementAssetId: asset.id,
    name: "Three-action disposable demo bond", ticker: "KASEDEMO", network: "SOLANA_LOCALNET", programId: fixture.programId,
    mintAddress: fixture.bondMint, issuerAuthority: administrator.walletAddress, complianceAuthority: administrator.walletAddress,
    corporateActionAuthority: administrator.walletAddress, faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2,
    issueAt: new Date(1_700_000_000_000), maturityAt: new Date(Number(fixture.maturityAt) * 1000),
    totalSupply: 35n, circulatingSupply: 35n, status: "ACTIVE" } });
  for (const [index, allocation] of fixture.allocations.entries()) await database.investor.create({ data: {
    displayName: "Demo holder " + (index + 1), type: "INDIVIDUAL", countryCode: "KZ", eligibilityStatus: "ELIGIBLE",
    eligibilityReasonCode: "DEMO_CRITERIA_MET", eligibilityReviewedAt: new Date(Date.now() - 86_400_000),
    wallets: { create: { address: allocation.walletAddress, status: "ACTIVE", network: "SOLANA_LOCALNET", verifiedAt: new Date(Date.now() - 86_400_000) } }
  } });
  const write = (body, signer = administrator) => ({ method: "POST", cookie: signer.cookie, body });
  async function state(path) {
    const result = await request(path, { cookie: auditor.cookie });
    assert.equal(result.status, 200, JSON.stringify(result.payload)); return result.payload;
  }
  async function complete(path, body, signer = administrator, validatePlan, afterSubmission) {
    const prepared = await request(path + "/prepare", write(body, signer));
    assert.equal(prepared.status, 201, JSON.stringify(prepared.payload)); const plan = prepared.payload;
    if (validatePlan) await validatePlan(plan);
    const wire = Buffer.from(plan.serializedTransactionBase64, "base64");
    sign(null, wire.subarray(65), signer.privateKey).copy(wire, 1);
    const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64,
      signedTransactionBase64: wire.toString("base64"), requiredSigner: signer.walletAddress });
    const phase = path.endsWith("/onchain") || /^\/corporate-actions\/[^/]+$/.test(path) ? { phase: body.phase } : {};
    if (path.endsWith("/redemption-execution") && body.phase === "PAY") {
      const changedWire = Buffer.from(wire); changedWire[changedWire.length - 1] ^= 1;
      assert.equal((await request(path + "/submit", write({ operationId: plan.operationId, signedTransactionBase64: changedWire.toString("base64") }, signer))).status, 400);
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).status, "PREPARED");
    }
    const sent = await request(path + "/submit", write({ operationId: plan.operationId, ...phase, signedTransactionBase64: wire.toString("base64") }, signer));
    assert.equal(sent.status, 201, JSON.stringify(sent.payload)); assert.equal(sent.payload.signature, signature);
    if (path.endsWith("/execution") || path.endsWith("/redemption-execution") || path.endsWith("/funding")) {
      const repeated = await request(path + "/submit", write({ operationId: plan.operationId, ...phase, signedTransactionBase64: wire.toString("base64") }, signer));
      assert.equal(repeated.status, 409);
    }
    if (afterSubmission) await afterSubmission(plan, signature);
    const deadline = Date.now() + 90_000;
    while (true) {
      const result = await request(path + "/confirm", write({ operationId: plan.operationId, ...phase, signature }, signer));
      if (result.status === 201) break;
      assert.ok(["TRANSACTION_NOT_FINALIZED", "TRANSACTION_UNAVAILABLE", "TRANSACTION_HISTORY_UNAVAILABLE"].includes(result.payload.code), JSON.stringify(result.payload));
      if (Date.now() > deadline) throw new Error("Original signature confirmation deadline: " + path);
      await sleep(500);
    }
    const auditCount = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal((await request(path + "/confirm", write({ operationId: plan.operationId, ...phase, signature }, signer))).status, 201);
    assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), auditCount);
    console.log("PASS saved-wire phase", path.split("/").slice(-2).join("/"), body.phase ?? "FUNDING");
    return { plan, signature };
  }
  let approverAssigned = false;
  for (const type of ["COUPON_PAYMENT", "EARLY_REDEMPTION", "BOND_REDEMPTION"]) {
    const supplyBefore = await mintSupply();
    const recordAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 90_000);
    const executeAt = type === "BOND_REDEMPTION" ? instrument.maturityAt : new Date(recordAt.getTime() + 20_000);
    const createdAction = await request("/corporate-actions", write({ requestId: randomUUID(), instrumentId: instrument.id, type,
      intent: "Reproducible three-action KASE demonstration", sourceType: "MANUAL", sourceReference: "KASE-DEMO-TEST-ONLY",
      recordAt: recordAt.toISOString(), executeAt: executeAt.toISOString(),
      ...(type === "EARLY_REDEMPTION" ? { redemptionPercentageBps: 2000, redemptionPriceKzt: "1000" } : {}) }));
    assert.equal(createdAction.status, 201, JSON.stringify(createdAction.payload));
    const actionId = createdAction.payload.id, actionPath = "/corporate-actions/" + actionId;
    await complete(actionPath, { phase: "SCHEDULE" });
    if (type === "COUPON_PAYMENT") evidence.transfers.push({ boundary: "BEFORE_CAPTURE", signature: await transfer(0, 1, 1) });
    const captureDeadline = Date.now() + 120_000;
    let capture;
    while (true) {
      capture = await request(actionPath + "/snapshot/prepare", write({}));
      if (capture.status === 201) break;
      assert.ok(["RECORD_DATE_NOT_REACHED", "SNAPSHOT_SLOT_OUTSIDE_WINDOW"].includes(capture.payload.code), JSON.stringify(capture.payload));
      if (Date.now() > captureDeadline) throw new Error("Finalized record-date capture did not become eligible");
      await sleep(500);
    }
    // Restore uses the same durable capture plan, never a later holder scan.
    const snapshotTransaction = await complete(actionPath + "/snapshot", {});
    const captured = await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } });
    const snapshotHash = Buffer.from(captured.snapshotHash).toString("hex");
    if (type === "COUPON_PAYMENT") {
      evidence.transfers.push({ boundary: "AFTER_CAPTURE", signature: await transfer(1, 0, 1) });
      assert.equal(Buffer.from((await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } })).snapshotHash).toString("hex"), snapshotHash);
    }
    const entitlementPath = actionPath + "/entitlements", initial = await state(entitlementPath);
    const calculated = await request(entitlementPath + "/calculate", write({ version: initial.actionVersion,
      receivers: Object.fromEntries(initial.investors.map(row => [row.investorId, row.receiverWallets[0]])) }));
    assert.equal(calculated.status, 201, JSON.stringify(calculated.payload));
    const submitted = await request(entitlementPath + "/review", write({ version: calculated.payload.actionVersion,
      decision: "SUBMIT", note: "Explicit synthetic KASE demo review" }));
    assert.equal(submitted.status, 201, JSON.stringify(submitted.payload));
    const version = submitted.payload.actionVersion;
    // Maturity pays remaining principal plus the final semiannual coupon.
    const expectedTotal = type === "COUPON_PAYMENT" ? 1_750_000_000n : type === "EARLY_REDEMPTION" ? 7_000_000_000n : 29_400_000_000n;
    assert.equal(submitted.payload.items.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n), expectedTotal);
    const funding = await complete(actionPath + "/coupon/funding", { version });
    for (const row of submitted.payload.items) await complete(entitlementPath + "/onchain", { phase: "REGISTER", version, entitlementId: row.id });
    await complete(entitlementPath + "/onchain", { phase: "FINALIZE", version });
    if (!approverAssigned) {
      await complete(actionPath + "/approval", { phase: "ASSIGN_APPROVER", version, approver: approver.walletAddress });
      approverAssigned = true;
    }
    await complete(actionPath + "/approval", { phase: "RESERVE", version });
    const approval = await complete(actionPath + "/approval", { phase: "APPROVE", version, note: "Separate approver, immutable full reserve" }, approver);
    const executionPath = actionPath + (type === "COUPON_PAYMENT" ? "/coupon/execution" : "/redemption-execution");
    let current = await state(executionPath);
    const firstBody = { phase: "PAY", version: current.actionVersion, entitlementId: current.items[0].id, idempotencyKey: randomUUID() };
    assert.equal((await request(executionPath + "/prepare", write(firstBody, auditor))).status, 403);
    assert.equal((await request(executionPath + "/prepare", { ...write(firstBody), requestOrigin: "https://foreign.invalid" })).status, 403);
    assert.equal((await request(executionPath + "/prepare", write({ phase: "FINALIZE", version: current.actionVersion, idempotencyKey: randomUUID() }))).status, 409);
    const executionDeadline = Date.now() + 600_000;
    while (true) {
      const slot = await rpc.request("getSlot", [{ commitment: "finalized" }]);
      if (Number(await rpc.request("getBlockTime", [slot])) * 1000 >= Date.parse(current.executeAt)) break;
      if (Date.now() > executionDeadline) throw new Error("Accelerated disposable maturity was not reached");
      await sleep(500);
    }
    if (type === "EARLY_REDEMPTION") {
      const holder = current.items.find(row => row.receiver === fixture.allocations[0].walletAddress);
      assert.ok(holder);
      const failedBody = { phase: "PAY", version: current.actionVersion, entitlementId: holder.id, idempotencyKey: randomUUID() };
      const beforeTransfer = await request(executionPath + "/prepare", write(failedBody));
      assert.equal(beforeTransfer.status, 201, JSON.stringify(beforeTransfer.payload));
      const failedPlan = beforeTransfer.payload;
      const beforeVault = (await rpc.request("getAccountInfo", [failedPlan.vaultAddress, { commitment: "finalized", encoding: "base64" }])).value;
      const beforeReceiver = (await rpc.request("getAccountInfo", [failedPlan.recipientAddress, { commitment: "finalized", encoding: "base64" }])).value;
      await transfer(0, 1, 10);
      const failedWire = Buffer.from(failedPlan.serializedTransactionBase64, "base64");
      sign(null, failedWire.subarray(65), administrator.privateKey).copy(failedWire, 1);
      const blocked = await request(executionPath + "/submit", write({ operationId: failedPlan.operationId, signedTransactionBase64: failedWire.toString("base64") }));
      assert.equal(blocked.payload.code, "REDEMPTION_BALANCE_CHANGED", JSON.stringify(blocked.payload));
      // Bypass the API only inside this disposable negative test to prove the program fails atomically.
      const failedSignature = await rpc.request("sendTransaction", [failedWire.toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
      assert.notEqual((await finalized(failedSignature, true)).err, null);
      assert.deepEqual((await rpc.request("getAccountInfo", [failedPlan.vaultAddress, { commitment: "finalized", encoding: "base64" }])).value, beforeVault);
      assert.deepEqual((await rpc.request("getAccountInfo", [failedPlan.recipientAddress, { commitment: "finalized", encoding: "base64" }])).value, beforeReceiver);
      assert.equal((await rpc.request("getAccountInfo", [failedPlan.redemptionReceiptAddress, { commitment: "finalized", encoding: "base64" }])).value, null);
      const failedConfirmation = await request(executionPath + "/confirm", write({ operationId: failedPlan.operationId, signature: failedSignature }));
      assert.equal(failedConfirmation.payload.code, "TRANSACTION_FAILED", JSON.stringify(failedConfirmation.payload));
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: failedPlan.operationId } })).status, "FAILED");
      assert.equal(await mintSupply(), supplyBefore);
      assert.equal(await database.settlement.count({ where: { entitlementId: holder.id } }), 0);
      await transfer(1, 0, 10);
      evidence.failedAtomicRedemptionSignature = failedSignature;
      console.log("PASS insufficient snapshot source: API rejection, finalized program failure, unchanged reserve/recipient/supply, no receipt or settlement");
    }
    const payments = [];
    for (const row of current.items) {
      current = await state(executionPath);
      const body = { phase: "PAY", version: current.actionVersion, entitlementId: row.id, idempotencyKey: randomUUID() };
      const result = await complete(executionPath, body, administrator, async plan => {
        const module = await import(type === "COUPON_PAYMENT" ? "../apps/web/.test-dist/coupon-execution-workflow.js" : "../apps/web/.test-dist/redemption-execution-workflow.js");
        await (type === "COUPON_PAYMENT" ? module.preparedCouponExecution : module.preparedRedemptionExecution)(plan, current, administrator.walletAddress);
      }, type === "EARLY_REDEMPTION" && payments.length === 0 ? async (plan, signature) => {
        await finalized(signature);
        const { confirmRedemptionExecution } = await import("../apps/api/dist/redemption-execution.js");
        const missingHistory = { request: async (method, params) => method === "getTransaction" ? null : method === "getSignatureStatuses" ? { value: [null] } : rpc.request(method, params) };
        const actor = { id: administrator.userId, walletAddress: administrator.walletAddress, correlationId: randomUUID() };
        const options = { enabled: true, cluster: "localnet", expectedGenesisHash: process.env.SOLANA_GENESIS_HASH, programId: fixture.programId, rpcEndpoint: fixture.rpcUrl, rpcTimeoutMs: 15_000 };
        await assert.rejects(confirmRedemptionExecution(database, missingHistory, actionId, { operationId: plan.operationId, signature }, actor, options));
        const unknown = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } });
        assert.equal(unknown.status, "UNKNOWN_CONFIRMATION"); assert.equal(unknown.signature, signature);
        const restored = await request(executionPath + "/prepare", write(body));
        assert.equal(restored.payload.operationId, plan.operationId); assert.equal(restored.payload.signature, signature);
        await database.$executeRawUnsafe("CREATE FUNCTION test_redemption_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'REDEMPTION_PAYMENT_FINALIZED' THEN RAISE EXCEPTION 'synthetic redemption audit failure'; END IF; RETURN NEW; END $$");
        await database.$executeRawUnsafe("CREATE TRIGGER test_redemption_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_redemption_audit_failure()");
        try {
          const failed = await request(executionPath + "/confirm", write({ operationId: plan.operationId, signature }));
          assert.equal(failed.status, 500, JSON.stringify(failed.payload));
          assert.equal((await database.entitlement.findUniqueOrThrow({ where: { id: row.id } })).status, "READY");
          assert.equal(await database.settlement.count({ where: { entitlementId: row.id } }), 0);
          assert.equal((await database.instrument.findUniqueOrThrow({ where: { id: instrument.id } })).circulatingSupply.toString(), plan.supplyBefore);
          assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } })).status, "UNKNOWN_CONFIRMATION");
        } finally {
          await database.$executeRawUnsafe("DROP TRIGGER test_redemption_audit_failure ON audit_logs");
          await database.$executeRawUnsafe("DROP FUNCTION test_redemption_audit_failure()");
        }
        console.log("PASS redemption missing-history recovery and complete projection/audit rollback using original signature");
      } : undefined);
      payments.push({ entitlementId: row.id, signature: result.signature });
      const saved = await database.entitlement.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.status, type === "COUPON_PAYMENT" ? "PAID" : "REDEEMED");
      assert.equal(saved.settlementSignature, result.signature);
      assert.equal(saved.burnSignature, type === "COUPON_PAYMENT" ? null : result.signature);
      const settlement = await database.settlement.findUniqueOrThrow({ where: { entitlementId: row.id }, include: { legs: true } });
      assert.equal(settlement.reconciliationStatus, "MATCHED");
      assert.equal(settlement.actualAmountMinor, saved.amountMinor); assert.equal(settlement.legs.length, 2);
      for (const leg of settlement.legs) assert.equal(leg.status, leg.type === "ASSET" && type === "COUPON_PAYMENT" ? "NOT_APPLICABLE" : "CONFIRMED");
      assert.equal((await request(executionPath + "/prepare", write({ ...body, idempotencyKey: randomUUID() }))).status, 409);
    }
    current = await state(executionPath); assert.equal(current.status, "SETTLED");
    const finalization = await complete(executionPath, { phase: "FINALIZE", version: current.actionVersion, idempotencyKey: randomUUID() }, administrator,
      async plan => {
        const module = await import(type === "COUPON_PAYMENT" ? "../apps/web/.test-dist/coupon-execution-workflow.js" : "../apps/web/.test-dist/redemption-execution-workflow.js");
        await (type === "COUPON_PAYMENT" ? module.preparedCouponExecution : module.preparedRedemptionExecution)(plan, current, administrator.walletAddress);
      });
    const receipt = await request(actionPath + "/receipt", { cookie: auditor.cookie });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.payload)); assert.equal(receipt.payload.status, "FINALIZED");
    assert.equal(createHash("sha256").update(receipt.payload.canonicalJson).digest("hex"), receipt.payload.sha256);
    assert.equal(receipt.payload.signature, finalization.signature);
    const supplyAfter = await mintSupply();
    assert.equal(supplyAfter, type === "COUPON_PAYMENT" ? 35n : type === "EARLY_REDEMPTION" ? 28n : 0n);
    const projectedInstrument = await database.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    assert.equal(projectedInstrument.circulatingSupply, supplyAfter);
    assert.equal(projectedInstrument.status, type === "BOND_REDEMPTION" ? "REDEEMED" : "ACTIVE");
    assert.equal((await state(executionPath)).status, "FINALIZED");
    evidence.actions.push({ type, actionId, snapshotHash, snapshotSignature: snapshotTransaction.signature,
      plannedRecordAt: captured.recordAt?.toISOString() ?? recordAt.toISOString(), effectiveSlot: captured.solanaSlot.toString(),
      effectiveBlockTime: captured.blockTime.toISOString(), amountMinor: expectedTotal.toString(),
      supplyBefore: supplyBefore.toString(), supplyAfter: supplyAfter.toString(), fundingSignature: funding.signature,
      approvalSignature: approval.signature, payments, actionReceipt: receipt.payload.onchainPda,
      receiptHash: receipt.payload.sha256, finalizedSignature: finalization.signature, canonicalJson: receipt.payload.canonicalJson });
    console.log("PASS complete KASE action", JSON.stringify({ type, actionId, amountMinor: expectedTotal.toString(),
      supplyBefore: supplyBefore.toString(), supplyAfter: supplyAfter.toString(), receiptHash: receipt.payload.sha256, signature: finalization.signature }));
  }
  evidence.completedAt = new Date().toISOString();
  const evidencePath = fileURLToPath(new URL("../generated/kase-demo-" + randomUUID() + ".json", import.meta.url));
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  if (process.env.KASE_DEMO_VIDEO === "true") {
    const { captureKaseDemo } = await import("./capture-kase-demo.mjs");
    evidence.browser = await captureKaseDemo({ host, cookie: auditor.cookie, evidence });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  }
  console.log("PASS coupon → partial20% → maturity, supply35 →28 →0, HTTP/PostgreSQL, separate approval, exact browser wires, immutable receipts and before/after snapshot transfers; evidence:", evidencePath);
} finally {
  try {
    if (app) await app.close();
    if (database) await database.$disconnect();
    if (created) await baseDatabase.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
  } finally {
    await baseDatabase.$disconnect();
    if (process.connected) process.disconnect();
  }
}

import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { NestFactory } from "@nestjs/core";
import { encodePublicKey, HttpSolanaRpc, verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";
import { syntheticEntitlementAction, testEntitlementsFlow } from "./test-entitlements-flow.mjs";
import { testCouponFundingFlow } from "./test-coupon-funding-flow.mjs";

// Never load .env. Only a generated database on an explicit loopback port is modified.
const base = new URL(process.env.ACTION_TEST_DATABASE_URL ?? process.env.DATABASE_URL ??
  "postgresql://lifecycle_kase:local_development_only@[::1]:55432/lifecycle_kase?schema=public");
if (base.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    base.pathname !== "/lifecycle_kase" || !/^[0-9]{2,5}$/.test(base.port)) {
  throw new Error("Action tests require local lifecycle_kase on an explicit loopback port");
}
const name = `actions_test_${randomUUID().replaceAll("-", "")}`;
if (!/^actions_test_[0-9a-f]{32}$/.test(name)) throw new Error("Invalid generated test database name");
const url = new URL(base); url.pathname = "/" + name;
const ownerDatabase = new PrismaClient({ datasources: { db: { url: base.toString() } } });
let database; let app; let created = false;
const origin = "http://localhost:3000";
const publicAddress = () => encodePublicKey(randomBytes(32));
const validatorFixture = process.argv[2] ? JSON.parse(process.argv[2]) : null;
let testIssuer;
if (validatorFixture) {
  // This optional mode is called only by the disposable-validator harness with its temporary admin.
  if (!/^http:\/\/(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d+$/.test(validatorFixture.rpcUrl) ||
      typeof process.argv[3] !== "string" || !/lifecycle-kase-integration\.[^\\/]+[\\/]admin\.json$/.test(process.argv[3])) {
    throw new Error("Validator acceptance requires the isolated harness RPC and disposable admin path");
  }
  const secret = Uint8Array.from(JSON.parse(await readFile(process.argv[3], "utf8")));
  if (secret.length !== 64) throw new Error("Disposable admin key has invalid length");
  testIssuer = { walletAddress: encodePublicKey(secret.slice(32)), privateKey: createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secret.slice(0, 32))]), format: "der", type: "pkcs8" }) };
}

try {
  await ownerDatabase.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Action test migration failed");
  process.env.DATABASE_URL = url.toString(); process.env.AUTH_ENABLED = "true";
  process.env.AUTH_DOMAIN = "localhost:3000"; process.env.AUTH_ALLOWED_ORIGINS = origin;
  process.env.AUTH_COOKIE_SECURE = "false"; process.env.SOLANA_CLUSTER = "localnet"; process.env.WALLET_NETWORK = "SOLANA_LOCALNET";
  process.env.MUTATION_RATE_LIMIT = "200"; process.env.AUTH_CHALLENGE_RATE_LIMIT = "20"; process.env.AUTH_VERIFY_RATE_LIMIT = "20";
  process.env.PROGRAM_ID = validatorFixture?.programId ?? "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
  process.env.SOLANA_RPC_URL = validatorFixture?.rpcUrl ?? "http://127.0.0.1:1";
  const rpc = validatorFixture ? new HttpSolanaRpc(validatorFixture.rpcUrl, 15_000) : null;
  process.env.SOLANA_GENESIS_HASH = rpc ? await rpc.request("getGenesisHash", []) : publicAddress();
  database = new PrismaClient();
  const { AppModule } = await import("../apps/api/dist/app.module.js");
  const { provisionOperator } = await import("../apps/api/dist/operator-provisioning.js");
  app = await NestFactory.create(AppModule, { logger: process.env.ACTION_TEST_DEBUG === "1" ? ["error"] : false });
  app.setGlobalPrefix("api/v1"); await app.listen(0, "127.0.0.1"); const host = await app.getUrl();
  async function request(path, { cookie, body, method = "GET", requestOrigin = origin } = {}) {
    const response = await fetch(host + "/api/v1" + path, { method, signal: AbortSignal.timeout(20_000), headers: {
      "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(requestOrigin ? { origin: requestOrigin } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  }
  async function login(role, key) {
    if (!key) {
      const pair = generateKeyPairSync("ed25519");
      key = { walletAddress: encodePublicKey(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32)), privateKey: pair.privateKey };
    }
    const record = await provisionOperator(database, { walletAddress: key.walletAddress, displayName: "Synthetic action operator", role, network: "SOLANA_LOCALNET", now: new Date() });
    const challenge = await request("/auth/challenge", { method: "POST", body: { walletAddress: key.walletAddress } });
    assert.equal(challenge.status, 201);
    const verified = await request("/auth/verify", { method: "POST", body: { challengeId: challenge.payload.challengeId, nonce: challenge.payload.nonce,
      signature: sign(null, Buffer.from(challenge.payload.message), key.privateKey).toString("base64") } });
    assert.equal(verified.status, 201);
    return { ...record, ...key, cookie: verified.headers.getSetCookie()[0].split(";")[0] };
  }
  const administrator = await login("ADMINISTRATOR", testIssuer);
  const auditor = await login("AUDITOR"); const outsider = await login("ADMINISTRATOR"); const otherRole = await login("ISSUER_OPERATOR");
  const issuer = await database.issuer.create({ data: { legalName: "Synthetic action test issuer" } });
  const settlementAsset = await database.settlementAsset.create({ data: { code: "KZT_TEST", name: "KZT-Test", network: "SOLANA_LOCALNET",
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." } });
  const instrument = await database.instrument.create({ data: { id: validatorFixture?.instrumentId ?? randomUUID(), issuerId: issuer.id,
    settlementAssetId: settlementAsset.id, name: "Synthetic ACTIVE fixture", ticker: "ACTEST", network: "SOLANA_LOCALNET",
    programId: process.env.PROGRAM_ID, mintAddress: validatorFixture?.bondMint ?? publicAddress(),
    issuerAuthority: administrator.walletAddress, complianceAuthority: administrator.walletAddress, corporateActionAuthority: administrator.walletAddress,
    faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2,
    issueAt: new Date(1_700_000_000 * 1000), maturityAt: new Date(1_800_000_000 * 1000), totalSupply: 35n, circulatingSupply: 35n, status: "ACTIVE" } });
  if (validatorFixture) {
    await database.settlementAsset.update({ where: { id: settlementAsset.id }, data: { network: "SOLANA_LOCALNET", mintAddress: validatorFixture.settlementMint } });
    for (const allocation of validatorFixture.allocations) {
      await database.investor.create({ data: { displayName: "Synthetic action holder", type: "INDIVIDUAL", countryCode: "KZ",
        eligibilityStatus: "ELIGIBLE", eligibilityReasonCode: "DEMO_CRITERIA_MET", eligibilityReviewedAt: new Date(Date.now() - 86_400_000),
        wallets: { create: { address: allocation.walletAddress, status: "ACTIVE", network: "SOLANA_LOCALNET", verifiedAt: new Date(Date.now() - 86_400_000) } } } });
    }
  }
  const future = minutes => new Date(Math.floor(Date.now() / 1000) * 1000 + minutes * 60_000).toISOString();
  const input = { requestId: randomUUID(), instrumentId: instrument.id, type: "COUPON_PAYMENT", intent: "Synthetic coupon acceptance",
    sourceType: "MANUAL", sourceReference: "TEST-ONLY", recordAt: future(10), executeAt: future(20) };
  const write = body => ({ method: "POST", cookie: administrator.cookie, body });
  assert.equal((await request("/corporate-actions")).status, 401);
  assert.equal((await request("/corporate-actions", { cookie: otherRole.cookie })).status, 403);
  assert.equal((await request("/corporate-actions", { ...write(input), cookie: auditor.cookie })).status, 403);
  assert.equal((await request("/corporate-actions", { ...write(input), cookie: outsider.cookie })).status, 403);
  assert.equal((await request("/corporate-actions", { ...write(input), requestOrigin: "https://untrusted.example" })).status, 403);
  assert.equal((await request("/corporate-actions", { ...write(input), requestOrigin: null })).status, 403);
  for (const override of [{ type: "OTHER" }, { status: "SCHEDULED" }, { recordAt: "2026-02-30T00:00:00.000Z" },
    { recordAt: new Date(0).toISOString() }, { executeAt: new Date(0).toISOString() }, { redemptionPriceKzt: "1" },
    { type: "EARLY_REDEMPTION", redemptionPercentageBps: 10001, redemptionPriceKzt: "1" },
    { type: "EARLY_REDEMPTION", redemptionPercentageBps: 2000, redemptionPriceKzt: "0" }]) {
    const response = await request("/corporate-actions", write({ ...input, requestId: randomUUID(), ...override }));
    assert.ok([400, 409].includes(response.status), JSON.stringify(response.payload));
  }
  const creation = await Promise.all([request("/corporate-actions", write(input)), request("/corporate-actions", write(input))]);
  for (const response of creation) assert.equal(response.status, 201, JSON.stringify(response.payload));
  assert.equal(await database.corporateAction.count(), 1);
  assert.equal(await database.auditLog.count({ where: { event: "CORPORATE_ACTION_DRAFT_CREATED", entityId: input.requestId } }), 1);
  assert.equal((await request("/corporate-actions", write({ ...input, intent: "Different intent" }))).status, 409);
  const list = await request("/corporate-actions?limit=1", { cookie: auditor.cookie }); assert.equal(list.status, 200); assert.equal(list.payload.items[0].id, input.requestId);
  const detail = await request(`/corporate-actions/${input.requestId}`, { cookie: auditor.cookie }); assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("cache-control"), "no-store"); assert.equal(detail.payload.events.length, 1);
  assert.equal((await request(`/corporate-actions/${input.requestId}/cancel`, write({ reason: "Acceptance draft cancellation" }))).status, 201);
  assert.equal((await request(`/corporate-actions/${input.requestId}/cancel`, write({ reason: "Replay is rejected" }))).status, 409);
  console.log("PASS action HTTP/PostgreSQL: roles, Origin, dates/terms, concurrent idempotent draft, list/detail, reasoned cancellation and actor audit");

  // Failure of append-only evidence must roll back the entire draft.
  await database.$executeRawUnsafe(`CREATE FUNCTION test_action_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'CORPORATE_ACTION_DRAFT_CREATED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER test_action_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_action_audit_failure()`);
  const failedId = randomUUID(); assert.equal((await request("/corporate-actions", write({ ...input, requestId: failedId }))).status, 500);
  assert.equal(await database.corporateAction.count({ where: { id: failedId } }), 0);
  await database.$executeRawUnsafe(`DROP TRIGGER test_action_audit_failure ON audit_logs`);
  await database.$executeRawUnsafe(`DROP FUNCTION test_action_audit_failure()`);
  console.log("PASS PostgreSQL action/audit rollback; no persistent project records modified");

  if (!validatorFixture) {
    for (const type of ["COUPON_PAYMENT", "BOND_REDEMPTION", "EARLY_REDEMPTION"]) {
      const actionId = await syntheticEntitlementAction(database, instrument, administrator, type);
      await testEntitlementsFlow({ database, request, write, administrator, auditor, outsider, actionId });
    }
    for (const percentage of [1, 1000]) {
      const actionId = await syntheticEntitlementAction(database, instrument, administrator, "EARLY_REDEMPTION");
      await database.corporateAction.update({ where: { id: actionId }, data: { redemptionPercentageBps: percentage } });
      const path = `/corporate-actions/${actionId}/entitlements`;
      let state = (await request(path, { cookie: administrator.cookie })).payload;
      const receivers = Object.fromEntries(state.investors.map(row => [row.investorId, row.receiverWallets[0]]));
      if (percentage === 1) {
        await database.$executeRawUnsafe(`CREATE FUNCTION test_calculation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = 'ENTITLEMENTS_CALCULATED' THEN RAISE EXCEPTION 'synthetic calculation audit failure'; END IF; RETURN NEW; END $$`);
        await database.$executeRawUnsafe(`CREATE TRIGGER test_calculation_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_calculation_audit_failure()`);
        assert.equal((await request(path + "/calculate", write({ version: state.actionVersion, receivers }))).status, 500);
        assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId } }), 0);
        assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).status, "SNAPSHOT_CREATED");
        await database.$executeRawUnsafe(`DROP TRIGGER test_calculation_audit_failure ON audit_logs`);
        await database.$executeRawUnsafe(`DROP FUNCTION test_calculation_audit_failure()`);
      }
      const calculated = await request(path + "/calculate", write({ version: state.actionVersion, receivers }));
      assert.equal(calculated.status, 201, JSON.stringify(calculated.payload)); state = calculated.payload;
      const reviewed = await request(path + "/review", write({ version: state.actionVersion, decision: "SUBMIT", note: "Review zero rounding" }));
      assert.equal(reviewed.status, 201); state = reviewed.payload;
      const approved = await request(path + "/review", write({ version: state.actionVersion, decision: "APPROVE", note: "Explicit zero rounding decision" }));
      if (percentage === 1) {
        assert.equal(approved.status, 409); assert.equal(approved.payload.code, "CALCULATION_INCOMPLETE");
        assert.ok(state.items.every(row => row.status === "NOT_ELIGIBLE_ZERO_ROUNDING"));
        const rejected = await request(path + "/review", write({ version: state.actionVersion, decision: "REJECT", note: "All rows round to zero" }));
        assert.equal(rejected.status, 201); assert.equal(rejected.payload.status, "REJECTED");
        assert.equal((await request(path + "/calculate", write({ version: rejected.payload.actionVersion, receivers }))).status, 409);
      } else {
        assert.equal(approved.status, 201); assert.equal(approved.payload.eligibleHolders, 2);
        assert.equal(approved.payload.items.filter(row => row.status === "READY").length, 2);
        assert.equal(approved.payload.items.filter(row => row.status === "NOT_ELIGIBLE_ZERO_ROUNDING").length, 1);
      }
    }
    console.log("PASS zero-rounding exclusion, all-zero approval rejection, terminal rejection and complete calculation/audit rollback");
    console.log("Synthetic finalized snapshot fixtures test application logic; they do not prove any chain registration");
  }

  if (validatorFixture) {
    async function createAction(type, recordAt = future(10)) {
      const response = await request("/corporate-actions", write({ ...input, requestId: randomUUID(), type, recordAt,
        executeAt: type === "BOND_REDEMPTION" ? instrument.maturityAt.toISOString() : future(20),
        ...(type === "EARLY_REDEMPTION" ? { redemptionPercentageBps: 2000, redemptionPriceKzt: "1000.000001" } : {}) }));
      assert.equal(response.status, 201, JSON.stringify(response.payload)); return response.payload;
    }
    async function prepare(action, phase, reason) {
      const response = await request(`/corporate-actions/${action.id}/prepare`, write({ phase, ...(reason ? { reason } : {}) }));
      assert.equal(response.status, 201, JSON.stringify(response.payload)); return response.payload;
    }
    async function signAndSubmit(plan, snapshot = false) {
      const wire = Buffer.from(plan.serializedTransactionBase64, "base64"); sign(null, wire.subarray(65), administrator.privateKey).copy(wire, 1);
      const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: plan.serializedTransactionBase64,
        signedTransactionBase64: wire.toString("base64"), requiredSigner: administrator.walletAddress });
      const prefix = typeof snapshot === "string" ? snapshot : snapshot ? "snapshot/" : "";
      const path = `/corporate-actions/${plan.corporateActionId}/${prefix}submit`;
      const body = { operationId: plan.operationId, ...(prefix ? {} : { phase: plan.phase }), signedTransactionBase64: wire.toString("base64") };
      const tampered = Buffer.from(wire); tampered[tampered.length - 1] ^= 1;
      assert.equal((await request(path, write({ ...body, signedTransactionBase64: tampered.toString("base64") }))).status, 400);
      const response = await request(path, write(body)); assert.equal(response.status, 201, JSON.stringify(response.payload)); assert.equal(response.payload.signature, signature);
      for (let attempt = 0; attempt < 80; attempt++) {
        const status = await rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
        if (status.value[0]?.confirmationStatus === "finalized") { assert.equal(status.value[0].err, null); return signature; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("Disposable transaction did not finalize");
    }
    async function confirm(plan, signature, snapshot = false) {
      const prefix = typeof snapshot === "string" ? snapshot : snapshot ? "snapshot/" : "";
      const path = `/corporate-actions/${plan.corporateActionId}/${prefix}confirm`;
      const body = { operationId: plan.operationId, signature, ...(prefix ? {} : { phase: plan.phase }) };
      const response = await request(path, write(body)); assert.equal(response.status, 201, JSON.stringify(response.payload)); assert.equal(response.payload.status, "FINALIZED");
      assert.equal((await request(path, write(body))).status, 201);
    }
    for (const type of ["COUPON_PAYMENT", "BOND_REDEMPTION", "EARLY_REDEMPTION"]) {
      const action = await createAction(type); const plan = await prepare(action, "SCHEDULE");
      assert.equal((await request(`/corporate-actions/${action.id}/cancel`, write({ reason: "Pending schedule cannot be cancelled off-chain" }))).status, 409);
      const signature = await signAndSubmit(plan);
      const resumed = await prepare(action, "SCHEDULE"); assert.equal(resumed.operationId, plan.operationId); assert.equal(resumed.signature, signature);
      await confirm(plan, signature);
      const cancellation = await prepare(action, "CANCEL", "Synthetic schedule cancellation");
      assert.equal((await request(`/corporate-actions/${action.id}/snapshot/prepare`, write({}))).status, 409);
      const cancelledSignature = await signAndSubmit(cancellation); await confirm(cancellation, cancelledSignature);
      const row = await database.corporateAction.findUniqueOrThrow({ where: { id: action.id } }); assert.equal(row.status, "CANCELLED");
    }
    console.log("PASS live Localnet + HTTP/PostgreSQL: all three action types schedule/cancel, exact signed-wire/PDA confirmation, replay/resume and cancellation/snapshot exclusion");

    const snapshotAction = await createAction("COUPON_PAYMENT", future(2));
    const schedule = await prepare(snapshotAction, "SCHEDULE"); await confirm(schedule, await signAndSubmit(schedule));
    console.log("Waiting for disposable action record window (up to two minutes); the owner's instrument is untouched");
    while (Date.now() < Date.parse(snapshotAction.recordAt) + 1000) await new Promise(resolve => setTimeout(resolve, Math.min(1000, Date.parse(snapshotAction.recordAt) + 1000 - Date.now())));
    let capture;
    const captureDeadline = Date.now() + 90_000;
    for (let attempt = 0; Date.now() < captureDeadline; attempt++) {
      capture = await request(`/corporate-actions/${snapshotAction.id}/snapshot/prepare`, write({}));
      if (capture.status === 201) break;
      assert.equal(capture.payload.code, "SNAPSHOT_SLOT_OUTSIDE_WINDOW", JSON.stringify(capture.payload));
      if (attempt % 20 === 0) {
        const slot = await rpc.request("getSlot", [{ commitment: "finalized" }]);
        const blockTime = await rpc.request("getBlockTime", [slot]);
        console.log("Waiting for eligible finalized capture", JSON.stringify({ recordAt: snapshotAction.recordAt,
          serverTime: new Date().toISOString(), finalizedSlot: slot, finalizedBlockTime: new Date(blockTime * 1000).toISOString() }));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(capture.status, 201, JSON.stringify(capture.payload));
    const plan = capture.payload; const signature = await signAndSubmit(plan, true);
    const restored = await request(`/corporate-actions/${snapshotAction.id}/snapshot/prepare`, write({}));
    assert.equal(restored.payload.operationId, plan.operationId); assert.equal(restored.payload.signature, signature);
    await confirm(plan, signature, true);
    const state = await request(`/corporate-actions/${snapshotAction.id}`, { cookie: auditor.cookie });
    assert.equal(state.payload.status, "SNAPSHOT_CREATED"); assert.equal(state.payload.snapshot.status, "FINALIZED");
    assert.equal(state.payload.snapshot.totalBalance, "35"); assert.equal(state.payload.snapshot.investorCount, 3);
    assert.equal(state.payload.snapshot.snapshotHash, plan.snapshotHash);
    assert.equal((await request(`/corporate-actions/${snapshotAction.id}/prepare`, write({ phase: "CANCEL", reason: "Cannot cancel committed snapshot" }))).status, 409);
    await assert.rejects(database.snapshot.update({ where: { id: plan.snapshotId }, data: { totalBalance: 34n } }));
    console.log("PASS live Localnet snapshot through HTTP/PostgreSQL: real 10/20/5 collection, canonical hash/effective slot, signed-wire/PDA verification, finalized immutability and signed-attempt recovery");
    console.log("Disposable snapshot evidence", JSON.stringify({ instrumentId: instrument.id, actionId: snapshotAction.id,
      genesisHash: process.env.SOLANA_GENESIS_HASH, snapshotHash: plan.snapshotHash, signature,
      recordAt: plan.recordAt, effectiveBlockTime: plan.effectiveBlockTime, effectiveSlot: plan.effectiveSlot,
      investorCount: state.payload.snapshot.investorCount, totalBalance: state.payload.snapshot.totalBalance }));
    await testEntitlementsFlow({ database, request, write, administrator, auditor, outsider, actionId: snapshotAction.id, extensive: false,
      beforeApproval: current => testCouponFundingFlow({ database, request, write, administrator, auditor, outsider,
        actionId: snapshotAction.id, version: current.actionVersion, signAndSubmit, confirm }) });
  }
} finally {
  try {
    if (app) await app.close(); if (database) await database.$disconnect();
    if (created) { await ownerDatabase.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); console.log("PASS removed only the generated action test database"); }
  } finally { await ownerDatabase.$disconnect(); }
}

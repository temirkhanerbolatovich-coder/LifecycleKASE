import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { NestFactory } from "@nestjs/core";
import { buildCalculationFinalization, buildCalculationReset, buildEntitlementRegistration, buildRedemptionSourceRegistration,
  decodeConfirmedCorporateAction, decodeConfirmedExactRedemptionTarget, deriveCorporateActionAddresses, deriveExactRedemptionTargetAddress,
  encodePublicKey, HttpSolanaRpc, serializeUnsignedInstructionsTransaction, verifySignedPreparedTransaction } from "@lifecycle-kase/solana-client";

// Only the disposable validator wrapper can supply this fixture and temporary signer.
const fixture = JSON.parse(process.argv[2] ?? "null");
const controlledWorkflow = process.env.KASE_CONTROLLED_WORKFLOW === "true";
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
function closeControlledSource(holderIndex, tokenAccount) {
  assert.equal(controlledWorkflow, true);
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pendingTransfers.set(id, { resolve, reject });
    process.send({ id, kind: "CLOSE_CONTROLLED_SOURCE", holderIndex, tokenAccount,
      instrumentId: fixture.instrumentId, bondMint: fixture.bondMint });
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exactPolicy = "exact-target-largest-remainder-v2";
const uuidBytes = value => Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
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
const evidence = { schema: "kase-four-actions-demo-v2", scope: "DISPOSABLE_LOCALNET", simulated: ["KZT-Test", "investor eligibility"],
  instrumentId: fixture.instrumentId, programId: fixture.programId, bondMint: fixture.bondMint, actions: [], transfers: [] };
if (controlledWorkflow) {
  assert.match(fixture.programSha256, /^[0-9a-f]{64}$/); assert.match(fixture.idlSha256, /^[0-9a-f]{64}$/);
  const sourceFingerprints = {};
  for (const path of ["scripts/test-kase-demo.mjs", "scripts/test-controlled-workflow.mjs", "scripts/test-controlled-workflow.ps1",
    "scripts/test-initialize-instrument.sh", "tools/solana-integration/test-initialize-instrument.mjs",
    "tools/solana-integration/test-zero-rounded-coupon.mjs",
    "apps/api/src/instrument-deployment.ts", "apps/api/src/instrument-registry.ts", "apps/api/src/controlled-policy.ts",
    "prisma/schema.prisma", "prisma/migrations/20261012010000_controlled_registry_policy/migration.sql",
    "apps/api/src/controlled-capture.ts", "apps/api/src/controlled-snapshot.ts", "apps/api/src/onchain-entitlements.ts",
    "apps/api/src/snapshot-persistence.ts", "apps/api/src/coupon-execution.ts", "apps/api/src/coupon-receipt.ts",
    "apps/api/src/controlled-settlement.ts", "apps/api/src/redemption-receipt.ts", "apps/api/src/action-approval.ts", "apps/api/src/entitlements.ts",
    "apps/api/src/redemption-execution.ts", "packages/solana-client/dist/controlled-registry.js",
    "apps/web/.test-dist/instrument-deployment-workflow.js", "apps/web/.test-dist/controlled-capture-workflow.js",
    "apps/web/.test-dist/onchain-entitlement-workflow.js", "apps/web/.test-dist/redemption-calculation-workflow.js",
    "apps/web/.test-dist/coupon-execution-workflow.js", "apps/web/.test-dist/redemption-execution-workflow.js"]) {
    sourceFingerprints[path] = createHash("sha256").update(await readFile(new URL("../" + path, import.meta.url))).digest("hex");
  }
  Object.assign(evidence, { schema: "controlled-four-actions-workflow-v1", tokenPolicy: "CONTROLLED_FROZEN_V2", issuance: [],
    startedAt: new Date().toISOString(), programSha256: fixture.programSha256, idlSha256: fixture.idlSha256, sourceFingerprints,
    timing: { validatorTicksPerSlot: fixture.validatorTicksPerSlot, instrumentMaturityDelaySeconds: 1200, originalSignatureConfirmationDeadlineSeconds: 90 },
    exclusions: ["LEGACY_ZERO_MIXED_COUPON_PRELUDE"] });
  console.log("Controlled API runtime artifact identity", JSON.stringify({ programSha256: evidence.programSha256, idlSha256: evidence.idlSha256, sourceFingerprints }));
}
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
    COUPON_EXECUTION_ENABLED: "true", REDEMPTION_EXECUTION_ENABLED: "true", EXACT_TARGET_REDEMPTION_ENABLED: "true" });
  if (controlledWorkflow) process.env.CONTROLLED_REGISTRY_ENABLED = "true";
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
  let instrument;
  if (controlledWorkflow) {
    const draft = await request("/instruments", { method: "POST", cookie: administrator.cookie, body: {
      issuerLegalName: "Synthetic controlled KASE issuer", name: "Controlled four-action disposable bond", ticker: "KASEV2",
      faceValueKzt: "1000", couponRateBps: 1000, paymentsPerYear: 2, issueAt: "2023-11-14T22:13:20.000Z",
      maturityAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 1_200_000).toISOString(), tokenPolicy: "CONTROLLED_FROZEN_V2"
    } });
    assert.equal(draft.status, 201, JSON.stringify(draft.payload));
    instrument = await database.instrument.findUniqueOrThrow({ where: { id: draft.payload.id } });
    await assert.rejects(database.instrument.update({ where: { id: instrument.id }, data: { tokenPolicy: "LEGACY_UNRESTRICTED_V1" } }), /immutable/);
    fixture.instrumentId = instrument.id; evidence.instrumentId = instrument.id;
  } else {
    const issuer = await database.issuer.create({ data: { legalName: "Synthetic KASE demo issuer" } });
    const asset = await database.settlementAsset.create({ data: { code: "KZT_TEST", name: "KZT-Test", network: "SOLANA_LOCALNET",
      mintAddress: fixture.settlementMint, disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." } });
    instrument = await database.instrument.create({ data: { id: fixture.instrumentId, issuerId: issuer.id, settlementAssetId: asset.id,
      name: "Four-action disposable demo bond", ticker: "KASEDEMO", network: "SOLANA_LOCALNET", programId: fixture.programId,
      mintAddress: fixture.bondMint, issuerAuthority: administrator.walletAddress, complianceAuthority: administrator.walletAddress,
      corporateActionAuthority: administrator.walletAddress, faceValueMinor: 1_000_000_000n, couponRateBps: 1000, paymentsPerYear: 2,
      issueAt: new Date(1_700_000_000_000), maturityAt: new Date(Number(fixture.maturityAt) * 1000),
      totalSupply: 35n, circulatingSupply: 35n, status: "ACTIVE" } });
  }
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
    const phase = path.endsWith("/onchain") || path.endsWith("/deploy") || /^\/corporate-actions\/[^/]+$/.test(path) ? { phase: body.phase } : {};
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
    let lastConfirmationCode;
    while (true) {
      const result = await request(path + "/confirm", write({ operationId: plan.operationId, ...phase, signature }, signer));
      if (result.status === 201) break;
      assert.ok(["TRANSACTION_NOT_FINALIZED", "TRANSACTION_UNAVAILABLE", "TRANSACTION_HISTORY_UNAVAILABLE"].includes(result.payload.code), JSON.stringify(result.payload));
      lastConfirmationCode = result.payload.code;
      if (Date.now() > deadline) {
        const operation = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } });
        const height = await rpc.request("getBlockHeight", [{ commitment: "finalized" }]);
        const statuses = await rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
        const transaction = await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
        console.error("FAIL original signature confirmation diagnostics", JSON.stringify({ path, signature,
          operationId: operation.id, status: operation.status, lastErrorCode: operation.lastErrorCode,
          recentBlockhash: operation.recentBlockhash, lastValidBlockHeight: operation.lastValidBlockHeight?.toString(),
          currentFinalizedBlockHeight: height, lastConfirmationCode, signatureStatus: statuses.value[0], transactionHistoryAvailable: transaction !== null }));
        throw new Error("Original signature confirmation deadline: " + path);
      }
      await sleep(500);
    }
    const auditCount = await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } });
    assert.equal((await request(path + "/confirm", write({ operationId: plan.operationId, ...phase, signature }, signer))).status, 201);
    assert.equal(await database.auditLog.count({ where: { blockchainTransactionId: plan.operationId } }), auditCount);
    console.log("PASS saved-wire phase", path.split("/").slice(-2).join("/"), body.phase ?? "FUNDING");
    return { plan, signature };
  }

  if (controlledWorkflow) {
    for (const phase of ["MINT_SETUP", "INITIALIZE", "DISTRIBUTION", "ACTIVATE"]) {
      const body = { phase, ...(phase === "DISTRIBUTION" ? { allocations: fixture.allocations.map(({ walletAddress, amount }) => ({ walletAddress, amount })) } : {}) };
      const listed = await state("/instruments"); const selected = listed.items.find(row => row.id === instrument.id);
      assert.ok(selected); assert.equal(listed.controlledRegistryEnabled, true);
      const result = await complete("/instruments/" + instrument.id + "/deploy", body, administrator, async plan => {
        const browser = await import("../apps/web/.test-dist/instrument-deployment-workflow.js");
        await browser.reviewedDeploymentPlan(plan, selected, administrator.walletAddress,
          { programId: listed.controlledProgramId, networkGenesisHash: listed.controlledNetworkGenesisHash }, body.allocations);
      });
      if (phase === "MINT_SETUP") {
        fixture.bondMint = result.plan.bondMint; fixture.settlementMint = result.plan.settlementMint;
        evidence.bondMint = fixture.bondMint; evidence.settlementMint = fixture.settlementMint;
      }
      evidence.issuance.push({ phase, signature: result.signature, operationId: result.plan.operationId,
        instrumentAddress: result.plan.instrumentAddress, controlledPolicyAddress: result.plan.controlledPolicyAddress });
    }
    instrument = await database.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    assert.equal(instrument.status, "ACTIVE"); assert.equal(instrument.tokenPolicy, "CONTROLLED_FROZEN_V2");
    assert.equal(await mintSupply(), 35n);
    console.log("PASS controlled API issuance: mint-zero → initialize → frozen distribution10/20/5 → activate");
  }

  async function programAccount(address) {
    const result = (await rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }])).value;
    assert.ok(result, "Missing disposable program account: " + address);
    assert.equal(result.owner, fixture.programId); assert.equal(result.data[1], "base64");
    return result.data[0];
  }

  // These deliberately invalid wires bypass HTTP only on this fresh validator and temporary signer.
  async function fixtureInstructions(instructions, expectedErrorCode) {
    const lifetime = (await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }])).value;
    const wire = Buffer.from(serializeUnsignedInstructionsTransaction({ instructions, feePayer: administrator.walletAddress,
      recentBlockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight }), "base64");
    sign(null, wire.subarray(65), administrator.privateKey).copy(wire, 1);
    const signature = await rpc.request("sendTransaction", [wire.toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
    const result = await finalized(signature, !!expectedErrorCode);
    if (expectedErrorCode) {
      assert.notEqual(result.err, null);
      const transaction = await rpc.request("getTransaction", [signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
      assert.ok(transaction?.meta?.logMessages?.some(line => line.includes("Error Code: " + expectedErrorCode)), JSON.stringify(transaction?.meta));
    }
    return signature;
  }

  async function verifyExactPlanRejection(actionId, rows, snapshotHash, targetAddress, targetData) {
    const identity = { programId: fixture.programId, instrumentId: uuidBytes(instrument.id), actionId: uuidBytes(actionId),
      corporateActionAuthority: administrator.walletAddress, allocationPolicy: exactPolicy };
    const registered = [];
    const first = rows.find(row => row.balanceAtRecordDate === "8"); assert.ok(first);
    const legacyRegistration = await buildEntitlementRegistration({ ...identity, allocationPolicy: "integer-entitlements-v1",
      investorId: uuidBytes(first.investorId), snapshotHash, settlementWallet: first.settlementWalletAddress,
      balanceAtSnapshot: 8n, eligible: true, paymentAmountMinor: 2_000_000_000n, tokensToRedeem: 2n });
    const legacyRegistrationSignature = await fixtureInstructions([legacyRegistration.instruction], "InvalidEntitlement");
    assert.equal((await rpc.request("getAccountInfo", [legacyRegistration.entitlementAddress, { commitment: "finalized" }])).value, null);
    for (const row of rows) {
      // 3/4/1 totals eight, but the largest remainder belongs to the sixteen-bond position.
      const tokens = row.balanceAtRecordDate === "8" ? 3n : row.balanceAtRecordDate === "16" ? 4n : 1n;
      const registration = await buildEntitlementRegistration({ ...identity, investorId: uuidBytes(row.investorId), snapshotHash,
        settlementWallet: row.settlementWalletAddress, balanceAtSnapshot: BigInt(row.balanceAtRecordDate), eligible: true,
        paymentAmountMinor: tokens * 1_000_000_000n, tokensToRedeem: tokens });
      const sources = await buildRedemptionSourceRegistration({ ...identity, investorId: uuidBytes(row.investorId), snapshotHash,
        bondMint: fixture.bondMint, tokenAccounts: row.redemptionSources.map(source => ({ address: source.address,
          wallet: source.walletAddress, balanceAtSnapshot: BigInt(source.balanceAtSnapshot) })) });
      await fixtureInstructions([registration.instruction, sources.instruction]); registered.push({ ...registration, ...sources });
    }
    const investorIds = rows.map(row => uuidBytes(row.investorId));
    const wrongPlan = await buildCalculationFinalization({ ...identity, investorIds, redemption: true });
    const legacyFinalization = await buildCalculationFinalization({ ...identity, allocationPolicy: "integer-entitlements-v1", investorIds, redemption: true });
    const legacyFinalizationSignature = await fixtureInstructions([legacyFinalization.instruction], "InvalidEntitlement");
    const wrongPlanSignature = await fixtureInstructions([wrongPlan.instruction], "InvalidEntitlement");
    const invalid = decodeConfirmedCorporateAction(await programAccount(wrongPlan.actionAddress));
    assert.equal(invalid.status, "CALCULATED"); assert.equal(invalid.registeredEntitlements, 3);
    assert.equal(invalid.totalAmountMinor, 8_000_000_000n); assert.equal(invalid.processedEntitlements, 0);
    const reset = await buildCalculationReset({ ...identity, investorIds, redemption: true });
    const resetSignature = await fixtureInstructions([reset.instruction]);
    const restored = decodeConfirmedCorporateAction(await programAccount(reset.actionAddress));
    assert.equal(restored.status, "SNAPSHOT_CREATED"); assert.equal(restored.registeredEntitlements, 0);
    assert.equal(restored.totalAmountMinor, 0n); assert.equal(restored.processedEntitlements, 0);
    for (const row of registered) for (const address of [row.entitlementAddress, row.sourceAddress]) {
      assert.equal((await rpc.request("getAccountInfo", [address, { commitment: "finalized" }])).value, null);
    }
    assert.equal((await rpc.request("getAccountInfo", [reset.progressAddress, { commitment: "finalized" }])).value, null);
    assert.equal(await programAccount(targetAddress), targetData);
    assert.equal(await mintSupply(), 28n);
    assert.equal(await database.entitlement.count({ where: { corporateActionId: actionId, onchainPda: { not: null } } }), 0);
    console.log("PASS v2 rejects legacy instructions and same-total wrong remainder plan; reset preserves immutable target and snapshot supply");
    return { legacyRegistrationSignature, legacyFinalizationSignature, wrongPlanSignature, resetSignature };
  }
  let approverAssigned = false;
  for (const scenario of ["COUPON_PAYMENT", "EARLY_REDEMPTION", "EXACT_EARLY_REDEMPTION", "BOND_REDEMPTION"]) {
    const exact = scenario === "EXACT_EARLY_REDEMPTION";
    const legacyEarly = scenario === "EARLY_REDEMPTION";
    const type = exact ? "EARLY_REDEMPTION" : scenario;
    const supplyBefore = await mintSupply();
    const recordAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 90_000);
    const executeAt = type === "BOND_REDEMPTION" ? instrument.maturityAt : new Date(recordAt.getTime() + 20_000);
    const createdAction = await request("/corporate-actions", write({ requestId: randomUUID(), instrumentId: instrument.id, type,
      intent: "Reproducible four-action KASE demonstration", sourceType: "MANUAL", sourceReference: "KASE-DEMO-TEST-ONLY",
      recordAt: recordAt.toISOString(), executeAt: executeAt.toISOString(),
      ...(exact ? { redemptionAllocationPolicy: exactPolicy, redemptionTargetTokens: "8", redemptionPriceKzt: "1000" }
        : legacyEarly ? { redemptionPercentageBps: 2000, redemptionPriceKzt: "1000" } : {}) }));
    assert.equal(createdAction.status, 201, JSON.stringify(createdAction.payload));
    const actionId = createdAction.payload.id, actionPath = "/corporate-actions/" + actionId;
    if (exact) {
      const original = await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } });
      for (const change of [{ redemptionTargetTokens: 9n }, { redemptionAllocationPolicy: "integer-entitlements-v1" },
        { redemptionPriceMinor: original.redemptionPriceMinor + 1n }, { recordAt: new Date(original.recordAt.getTime() + 1000) },
        { executeAt: new Date(original.executeAt.getTime() + 1000) }, { instrumentId: randomUUID() }]) {
        await assert.rejects(database.corporateAction.update({ where: { id: actionId }, data: change }), /immutable/);
      }
      assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).redemptionTargetTokens, 8n);
      console.log("PASS PostgreSQL exact target, policy, price, dates and instrument are immutable");
    }
    const selectedAction = await state(actionPath);
    const scheduled = await complete(actionPath, { phase: "SCHEDULE" }, administrator, async plan => {
      const module = await import("../apps/web/.test-dist/action-workflow.js");
      await module.requireCorporateActionTransaction(module.preparedActionPlan(plan, selectedAction, administrator.walletAddress), selectedAction);
    });
    let targetAddress, targetData, exactNegative;
    if (exact) {
      assert.equal(supplyBefore, 28n);
      const addresses = await deriveCorporateActionAddresses(fixture.programId, uuidBytes(instrument.id), uuidBytes(actionId));
      targetAddress = await deriveExactRedemptionTargetAddress(fixture.programId, addresses.actionAddress);
      targetData = await programAccount(targetAddress);
      const target = decodeConfirmedExactRedemptionTarget(targetData);
      assert.equal(target.version, 2); assert.equal(target.actionAddress, addresses.actionAddress); assert.equal(target.targetTokens, 8n);
      const chain = decodeConfirmedCorporateAction(await programAccount(addresses.actionAddress));
      assert.equal(chain.version, 2); assert.equal(chain.redemptionPercentageBps, null); assert.equal(chain.redemptionPriceMinor, 1_000_000_000n);
    }
    let captureBegin, captureFinish; const unitReservations = [];
    async function validateCapture(plan) {
      const browser = await import("../apps/web/.test-dist/controlled-capture-workflow.js");
      const view = await browser.controlledCaptureView(await state(actionPath + "/snapshot/capture"), await state(actionPath));
      const investors = type === "COUPON_PAYMENT" ? [] : (await state(actionPath + "/entitlements")).items.map(row => row.investorId);
      await browser.preparedControlledCapture(plan, view, administrator.walletAddress, investors);
    }
    if (controlledWorkflow) {
      while (true) {
        const slot = await rpc.request("getSlot", [{ commitment: "finalized" }]);
        if (Date.now() >= recordAt.getTime() && Number(await rpc.request("getBlockTime", [slot])) * 1000 >= recordAt.getTime()) break;
        await sleep(500);
      }
      captureBegin = await complete(actionPath + "/snapshot/capture", { phase: "BEGIN" }, administrator, validateCapture);
      assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).controlledCaptureLocked, true);
      const guard = await import("../apps/api/dist/investor-registry.js");
      await assert.rejects(guard.assertRegistryMutationAllowed(database, { now: new Date(recordAt.getTime() + 301_000), graceSeconds: 300 }),
        error => error.code === "REGISTRY_CAPTURE_LOCKED");
      const firstInvestor = await database.investor.findFirstOrThrow();
      const blockedEdit = await request("/investors/" + firstInvestor.id + "/eligibility/review", write({ decision: "SUSPENDED",
        expectedVersion: firstInvestor.registryVersion, reasonCode: "PERIODIC_REVIEW" }));
      assert.equal(blockedEdit.payload.code, "REGISTRY_CAPTURE_LOCKED", JSON.stringify(blockedEdit.payload));
    }
    if (type === "COUPON_PAYMENT" && !controlledWorkflow) evidence.transfers.push({ boundary: "BEFORE_CAPTURE", signature: await transfer(0, 1, 1) });
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
    const snapshotTransaction = await complete(actionPath + "/snapshot", {}, administrator, controlledWorkflow ? async plan => {
      const browser = await import("../apps/web/.test-dist/controlled-capture-workflow.js");
      const metadata = await import("../apps/web/.test-dist/snapshot-workflow.js");
      const view = await browser.controlledCaptureView(await state(actionPath + "/snapshot/capture"), await state(actionPath));
      await browser.requireControlledSnapshot(metadata.preparedSnapshot(plan, actionId, administrator.walletAddress), plan, view);
    } : undefined);
    const captured = await database.snapshot.findUniqueOrThrow({ where: { corporateActionId: actionId } });
    const snapshotHash = Buffer.from(captured.snapshotHash).toString("hex");
    if (controlledWorkflow) {
      assert.equal(captured.captureEvidence.schema, "controlled-capture-v1");
      assert.equal(captured.captureEvidence.registrySha256, createHash("sha256").update(captured.captureEvidence.registryCanonicalJson).digest("hex"));
      assert.deepEqual(JSON.parse(captured.captureEvidence.registryCanonicalJson), captured.captureEvidence.registry);
      await assert.rejects(database.snapshot.update({ where: { id: captured.id }, data: { captureEvidence: { schema: "controlled-capture-v1", changed: true } } }), /immutable/);
      if (type === "COUPON_PAYMENT") captureFinish = await complete(actionPath + "/snapshot/capture", { phase: "FINISH" }, administrator, validateCapture);
    }
    if (type === "COUPON_PAYMENT" && !controlledWorkflow) {
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
    const expectedTotal = type === "COUPON_PAYMENT" ? 1_750_000_000n : exact ? 8_000_000_000n : legacyEarly ? 7_000_000_000n : 21_000_000_000n;
    assert.equal(submitted.payload.items.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n), expectedTotal);
    if (exact) {
      assert.deepEqual(submitted.payload.exactRedemptionSummary, { policy: exactPolicy, targetTokens: "8", allocatedTokens: "8",
        totalBalance: "28", remainingTokens: "20", tieBreak: "SNAPSHOT_OWNER_BASE58_ASC" });
      assert.deepEqual(submitted.payload.items.map(row => [row.balanceAtRecordDate, row.tokensToRedeem])
        .sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0),
        [["4", "1"], ["8", "2"], ["16", "5"]]);
      assert.equal(submitted.payload.items.reduce((sum, row) => sum + BigInt(row.balanceAtRecordDate) * 8n / 28n, 0n), 7n);
      if (!controlledWorkflow) exactNegative = await verifyExactPlanRejection(actionId, submitted.payload.items, snapshotHash, targetAddress, targetData);
    }
    let funding;
    if (!controlledWorkflow) funding = await complete(actionPath + "/coupon/funding", { version });
    const validateCalculation = async plan => {
      const view = await state(entitlementPath);
      const metadata = await import("../apps/web/.test-dist/onchain-entitlement-workflow.js");
      const module = await import("../apps/web/.test-dist/redemption-calculation-workflow.js");
      const reviewed = metadata.preparedOnchainCalculation(plan, view, administrator.walletAddress, administrator.walletAddress);
      await module.requireRedemptionCalculationTransaction(reviewed, view);
    };
    for (const row of submitted.payload.items) await complete(entitlementPath + "/onchain", { phase: "REGISTER", version, entitlementId: row.id }, administrator, validateCalculation);
    await complete(entitlementPath + "/onchain", { phase: "FINALIZE", version }, administrator, validateCalculation);
    if (controlledWorkflow && type !== "COUPON_PAYMENT") {
      for (const row of submitted.payload.items) {
        const reserved = await complete(entitlementPath + "/onchain", { phase: "RESERVE_UNITS", version, entitlementId: row.id }, administrator, validateCalculation);
        unitReservations.push({ entitlementId: row.id, investorId: row.investorId, signature: reserved.signature,
          unitReservationAddress: reserved.plan.unitReservationAddress, tokensToRedeem: reserved.plan.tokensToRedeem,
          allocations: reserved.plan.allocations, holdingAddresses: reserved.plan.holdingAddresses });
      }
      captureFinish = await complete(actionPath + "/snapshot/capture", { phase: "FINISH" }, administrator, validateCapture);
    }
    if (controlledWorkflow) assert.equal((await database.corporateAction.findUniqueOrThrow({ where: { id: actionId } })).controlledCaptureLocked, false);
    if (controlledWorkflow) funding = await complete(actionPath + "/coupon/funding", { version });
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
    let consecutiveReadFailures = 0;
    while (true) {
      try {
        const slot = await rpc.request("getSlot", [{ commitment: "finalized" }]);
        if (Number(await rpc.request("getBlockTime", [slot])) * 1000 >= Date.parse(current.executeAt)) break;
        consecutiveReadFailures = 0;
      } catch (error) {
        // Host suspension can briefly interrupt the disposable RPC. Only clock reads are retried.
        if (error?.code !== "RPC_TRANSPORT_FAILED" || ++consecutiveReadFailures > 3) throw error;
        console.warn("WARN disposable execution clock read interrupted; bounded read retry", consecutiveReadFailures);
      }
      if (Date.now() > executionDeadline) throw new Error("Accelerated disposable maturity was not reached");
      await sleep(500);
    }
    if (legacyEarly && !controlledWorkflow) {
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
      }, (legacyEarly || controlledWorkflow && type === "BOND_REDEMPTION") && payments.length === 0 ? async (plan, signature) => {
        await finalized(signature);
        let sourceClosure;
        if (controlledWorkflow && type === "BOND_REDEMPTION") {
          const source = plan.tokenAccounts[0];
          assert.equal(plan.tokenAccounts.length, 1); assert.equal(source.expectedBalanceAfter, "0");
          const holderIndex = fixture.allocations.findIndex(allocation => allocation.walletAddress === source.walletAddress);
          assert.ok(holderIndex >= 0);
          const closureSignature = await closeControlledSource(holderIndex, source.address);
          assert.equal((await rpc.request("getAccountInfo", [source.address, { commitment: "finalized", encoding: "base64" }])).value, null);
          sourceClosure = { sourceAddress: source.address, walletAddress: source.walletAddress, closureSignature,
            paymentSignature: signature, operationId: plan.operationId };
          evidence.postBurnClosureRecovery = sourceClosure;
        }
        const { confirmRedemptionExecution } = await import("../apps/api/dist/redemption-execution.js");
        const missingHistory = { request: async (method, params) => method === "getTransaction" ? null : method === "getSignatureStatuses" ? { value: [null] } : rpc.request(method, params) };
        const actor = { id: administrator.userId, walletAddress: administrator.walletAddress, correlationId: randomUUID() };
        const options = { enabled: true, cluster: "localnet", expectedGenesisHash: process.env.SOLANA_GENESIS_HASH, programId: fixture.programId, rpcEndpoint: fixture.rpcUrl, rpcTimeoutMs: 15_000,
          ...(controlledWorkflow ? { controlledRegistryEnabled: true } : {}) };
        await assert.rejects(confirmRedemptionExecution(database, missingHistory, actionId, { operationId: plan.operationId, signature }, actor, options));
        const unknown = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: plan.operationId } });
        assert.equal(unknown.status, "UNKNOWN_CONFIRMATION"); assert.equal(unknown.signature, signature);
        if (sourceClosure) {
          const recovery = await state(executionPath);
          assert.equal(recovery.pending.operationId, plan.operationId); assert.equal(recovery.pending.signature, signature);
          const browser = await import("../apps/web/.test-dist/redemption-execution-workflow.js");
          const view = browser.redemptionExecutionView(recovery, actionId, type);
          await browser.preparedRedemptionExecution(recovery.pending, view, administrator.walletAddress);
          sourceClosure.getRecoveryVerified = true;
        }
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
      if (controlledWorkflow && evidence.postBurnClosureRecovery?.paymentSignature === result.signature) {
        evidence.postBurnClosureRecovery.confirmedOriginalSignature = result.signature;
        evidence.postBurnClosureRecovery.sourceAbsentAfterConfirm =
          (await rpc.request("getAccountInfo", [evidence.postBurnClosureRecovery.sourceAddress, { commitment: "finalized", encoding: "base64" }])).value === null;
        assert.equal(evidence.postBurnClosureRecovery.sourceAbsentAfterConfirm, true);
        console.log("PASS finalized maturity burn, empty source closure, GET recovery and original-signature reconciliation");
      }
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
    if (exact || controlledWorkflow) {
      const module = await import(type === "COUPON_PAYMENT" ? "../apps/web/.test-dist/coupon-execution-workflow.js" : "../apps/web/.test-dist/redemption-execution-workflow.js");
      await (type === "COUPON_PAYMENT" ? module.finalizedCouponReceipt : module.finalizedRedemptionReceipt)(receipt.payload, await state(executionPath));
    }
    const supplyAfter = await mintSupply();
    assert.equal(supplyAfter, type === "COUPON_PAYMENT" ? 35n : exact ? 20n : legacyEarly ? 28n : 0n);
    if (exact) assert.equal(await programAccount(targetAddress), targetData);
    const projectedInstrument = await database.instrument.findUniqueOrThrow({ where: { id: instrument.id } });
    assert.equal(projectedInstrument.circulatingSupply, supplyAfter);
    assert.equal(projectedInstrument.status, type === "BOND_REDEMPTION" ? "REDEEMED" : "ACTIVE");
    assert.equal((await state(executionPath)).status, "FINALIZED");
    if (controlledWorkflow) {
      const finished = await state(actionPath + "/snapshot/capture");
      assert.equal(finished.policy.captureAction, "11111111111111111111111111111111");
      assert.equal(finished.policy.activeRedemption, "11111111111111111111111111111111");
    }
    evidence.actions.push({ type, scenario, actionId, snapshotHash, scheduleSignature: scheduled.signature, snapshotSignature: snapshotTransaction.signature,
      ...(controlledWorkflow ? { captureBeginSignature: captureBegin.signature, captureFinishSignature: captureFinish.signature,
        captureEvidence: captured.captureEvidence, registryMutationBeyondWindowRejected: true, unitReservations } : {}),
      ...(exact ? { allocationPolicy: exactPolicy, targetTokens: "8", targetAddress,
        allocations: submitted.payload.items.map(row => ({ investorId: row.investorId, snapshotBalance: row.balanceAtRecordDate,
          tokensToRedeem: row.tokensToRedeem, amountMinor: row.amountMinor })), negative: exactNegative } : {}),
      plannedRecordAt: captured.recordAt?.toISOString() ?? recordAt.toISOString(), effectiveSlot: captured.solanaSlot.toString(),
      effectiveBlockTime: captured.blockTime.toISOString(), amountMinor: expectedTotal.toString(),
      supplyBefore: supplyBefore.toString(), supplyAfter: supplyAfter.toString(), fundingSignature: funding.signature,
      approvalSignature: approval.signature, payments, actionReceipt: receipt.payload.onchainPda,
      receiptHash: receipt.payload.sha256, finalizedSignature: finalization.signature, canonicalJson: receipt.payload.canonicalJson });
    console.log("PASS complete KASE action", JSON.stringify({ type, scenario, actionId, amountMinor: expectedTotal.toString(),
      supplyBefore: supplyBefore.toString(), supplyAfter: supplyAfter.toString(), receiptHash: receipt.payload.sha256, signature: finalization.signature }));
  }
  if (controlledWorkflow) {
    evidence.historicalReceiptDownloads = [];
    const browser = await import("../apps/web/.test-dist/redemption-execution-workflow.js");
    for (const historical of evidence.actions.filter(action => action.type === "EARLY_REDEMPTION")) {
      const actionPath = "/corporate-actions/" + historical.actionId;
      const downloaded = await request(actionPath + "/receipt", { cookie: auditor.cookie });
      assert.equal(downloaded.status, 200, JSON.stringify(downloaded.payload));
      assert.equal(downloaded.payload.sha256, historical.receiptHash); assert.equal(downloaded.payload.canonicalJson, historical.canonicalJson);
      const current = await state(actionPath + "/redemption-execution");
      assert.equal(current.currentTokenSupply, "0");
      await browser.finalizedRedemptionReceipt(downloaded.payload, browser.redemptionExecutionView(current, historical.actionId, historical.type));
      evidence.historicalReceiptDownloads.push({ actionId: historical.actionId, scenario: historical.scenario,
        receiptHash: downloaded.payload.sha256, currentTokenSupply: "0", originalCanonicalBytesMatched: true, browserVerified: true });
    }
    console.log("PASS historical percentage/exact receipt downloads remain unchanged and verified after maturity supply0");
  }
  evidence.completedAt = new Date().toISOString();
  const evidencePath = fileURLToPath(new URL("../generated/" + (controlledWorkflow ? "controlled-workflow-" : "kase-demo-") + randomUUID() + ".json", import.meta.url));
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  if (process.env.KASE_DEMO_VIDEO === "true") {
    const { captureKaseDemo } = await import("./capture-kase-demo.mjs");
    evidence.browser = await captureKaseDemo({ host, cookie: auditor.cookie, evidence });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  }
  console.log(controlledWorkflow
    ? "PASS controlled API issuance → coupon → partial20% → exact8 → maturity, supply35 →28 →20 →0, HTTP/PostgreSQL, frozen captures, assigned-unit reservation, separate approval, reviewed browser wires and immutable receipts; evidence:"
    : "PASS coupon → legacy partial20% → exact partial8 → maturity, supply35 →28 →20 →0, HTTP/PostgreSQL, separate approval, exact browser wires, immutable target/receipts and before/after snapshot transfers; evidence:", evidencePath);
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

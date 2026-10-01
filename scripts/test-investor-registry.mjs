import "reflect-metadata";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { NestFactory } from "@nestjs/core";
import { encodePublicKey } from "@lifecycle-kase/solana-client";

// No .env loading: never silently test against a staging/production database.
const localUrl = new URL(process.env.REGISTRY_TEST_DATABASE_URL ??
  "postgresql://lifecycle_kase:local_development_only@[::1]:55432/lifecycle_kase?schema=public");
if (localUrl.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname) ||
    localUrl.pathname !== "/lifecycle_kase" || localUrl.port !== "55432") {
  throw new Error("Registry tests require the local lifecycle_kase database on loopback port 55432");
}
const testDatabaseName = `registry_test_${randomUUID().replaceAll("-", "")}`;
if (!/^registry_test_[0-9a-f]{32}$/.test(testDatabaseName)) throw new Error("Invalid test database name");
const testUrl = new URL(localUrl);
testUrl.pathname = `/${testDatabaseName}`;
const administratorDatabase = new PrismaClient({ datasources: { db: { url: localUrl.toString() } } });
let database;
let app;
let createdDatabase = false;
const origin = "http://localhost:3000";
const publicAddress = () => encodePublicKey(randomBytes(32));

try {
  // Identifiers are generated/validated above, never taken from external SQL input.
  await administratorDatabase.$executeRawUnsafe(`CREATE DATABASE "${testDatabaseName}"`);
  createdDatabase = true;
  const migration = spawnSync(process.execPath,
    [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Isolated registry database migration failed");
  process.env.DATABASE_URL = testUrl.toString();
  process.env.AUTH_ENABLED = "true";
  process.env.AUTH_DOMAIN = "localhost:3000";
  process.env.AUTH_ALLOWED_ORIGINS = origin;
  process.env.AUTH_CHALLENGE_RATE_LIMIT = "5";
  process.env.AUTH_VERIFY_RATE_LIMIT = "10";
  process.env.MUTATION_RATE_LIMIT = "20";
  process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = "60";
  database = new PrismaClient();
  const { AppModule } = await import("../apps/api/dist/app.module.js");
  const { provisionOperator } = await import("../apps/api/dist/operator-provisioning.js");
  const { createInvestor } = await import("../apps/api/dist/investor-registry.js");
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const baseUrl = await app.getUrl();

  async function request(path, { cookie, body, requestOrigin = origin, method = "GET" } = {}) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method, signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", ...(requestOrigin ? { origin: requestOrigin } : {}), ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  }
  async function operator(role) {
    const keypair = generateKeyPairSync("ed25519");
    const der = keypair.publicKey.export({ type: "spki", format: "der" });
    const address = encodePublicKey(der.subarray(-32));
    const record = await provisionOperator(database, { walletAddress: address, displayName: `Synthetic ${role}`,
      role, network: "SOLANA_LOCALNET", now: new Date() });
    const challenge = await request("/auth/challenge", { method: "POST", body: { walletAddress: address } });
    assert.equal(challenge.status, 201, JSON.stringify(challenge.payload));
    const signature = sign(null, Buffer.from(challenge.payload.message), keypair.privateKey).toString("base64");
    const verified = await request("/auth/verify", { method: "POST", body: {
      challengeId: challenge.payload.challengeId, nonce: challenge.payload.nonce, signature
    } });
    assert.equal(verified.status, 201);
    const cookie = verified.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie, "Signed login must return a session cookie");
    const session = await request("/auth/session", { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.payload.user.role, role);
    return { ...record, cookie };
  }

  const administrator = await operator("ADMINISTRATOR");
  const auditor = await operator("AUDITOR");
  const issuer = await operator("ISSUER_OPERATOR");
  console.log("PASS local HTTP wallet challenge/signature/session for three operator roles");
  const investorInput = { displayName: "Synthetic Registry Investor", type: "INDIVIDUAL", countryCode: "KZ", externalReference: "REGISTRY-TEST-A" };
  assert.equal((await request("/investors")).status, 401);
  assert.equal((await request("/investors", { cookie: issuer.cookie })).status, 403);
  assert.equal((await request("/investors", { cookie: auditor.cookie, method: "POST", body: investorInput })).status, 403);
  assert.equal((await request("/investors", { cookie: administrator.cookie, method: "POST", body: investorInput,
    requestOrigin: "https://untrusted.example" })).status, 403);
  assert.equal((await request("/investors", { cookie: administrator.cookie, method: "POST", body: investorInput, requestOrigin: null })).status, 403);
  console.log("PASS unauthenticated/incorrect role and missing/wrong Origin are denied over HTTP");

  const created = await request("/investors", { cookie: administrator.cookie, method: "POST", body: investorInput });
  assert.equal(created.status, 201);
  assert.equal(created.payload.kycStatus, "NOT_STARTED");
  assert.equal(created.payload.eligibilityStatus, "PENDING_REVIEW");
  assert.equal(created.headers.get("cache-control"), "no-store");
  const investorId = created.payload.id;
  const investorKeypair = generateKeyPairSync("ed25519");
  const investorPublicDer = investorKeypair.publicKey.export({ type: "spki", format: "der" });
  const investorWalletAddress = encodePublicKey(investorPublicDer.subarray(-32));
  const attached = await request(`/investors/${investorId}/wallets`, { cookie: administrator.cookie,
    method: "POST", body: { address: investorWalletAddress } });
  assert.equal(attached.status, 201);
  assert.equal(attached.payload.network, "SOLANA_LOCALNET");
  assert.equal(attached.payload.status, "PENDING");
  assert.equal(attached.payload.verifiedAt, null);
  const read = await request("/investors", { cookie: auditor.cookie });
  assert.equal(read.status, 200);
  assert.equal(read.payload.items[0]._count.wallets, 1);
  assert.equal(read.payload.items[0].wallets[0].id, attached.payload.id);
  const audit = await database.auditLog.findMany({ where: { entityId: investorId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audit.map(row => row.event), ["INVESTOR_CREATED", "INVESTOR_WALLET_ATTACHED"]);
  assert.ok(audit.every(row => row.actorId === administrator.userId && row.actorWallet === administrator.walletAddress));
  assert.equal(audit[0].correlationId, created.headers.get("x-correlation-id"));
  assert.equal(audit[1].correlationId, attached.headers.get("x-correlation-id"));
  console.log("PASS HTTP create/pending wallet, real PostgreSQL projection and actor/correlation audit");

  const verificationPath = `/investors/${investorId}/wallets/${attached.payload.id}/verification`;
  assert.equal((await request(`${verificationPath}/challenge`, {
    cookie: auditor.cookie, method: "POST", body: {}
  })).status, 403);
  assert.equal((await request(`${verificationPath}/challenge`, {
    cookie: administrator.cookie, method: "POST", body: {}, requestOrigin: "https://untrusted.example"
  })).status, 403);
  const walletChallenge = await request(`${verificationPath}/challenge`, {
    cookie: administrator.cookie, method: "POST", body: {}
  });
  assert.equal(walletChallenge.status, 201);
  assert.equal(walletChallenge.payload.walletAddress, investorWalletAddress);
  assert.match(walletChallenge.payload.message, /does not submit a transaction, approve eligibility, or authorize a payment/);
  assert.equal((await request(`${verificationPath}/verify`, { cookie: administrator.cookie, method: "POST", body: {
    challengeId: walletChallenge.payload.challengeId,
    nonce: walletChallenge.payload.nonce,
    signature: Buffer.alloc(64).toString("base64")
  } })).status, 401);
  const investorSignature = sign(null, Buffer.from(walletChallenge.payload.message), investorKeypair.privateKey).toString("base64");
  const walletVerified = await request(`${verificationPath}/verify`, { cookie: administrator.cookie, method: "POST", body: {
    challengeId: walletChallenge.payload.challengeId,
    nonce: walletChallenge.payload.nonce,
    signature: investorSignature
  } });
  assert.equal(walletVerified.status, 201);
  assert.equal(walletVerified.payload.status, "ACTIVE");
  assert.ok(walletVerified.payload.verifiedAt);
  assert.equal((await request(`${verificationPath}/verify`, { cookie: administrator.cookie, method: "POST", body: {
    challengeId: walletChallenge.payload.challengeId,
    nonce: walletChallenge.payload.nonce,
    signature: investorSignature
  } })).status, 401);
  const walletAudit = await database.auditLog.findMany({ where: { entityId: attached.payload.id } });
  assert.equal(walletAudit.length, 1);
  assert.equal(walletAudit[0].event, "INVESTOR_WALLET_OWNERSHIP_VERIFIED");
  assert.equal(walletAudit[0].actorId, administrator.userId);
  assert.equal(walletAudit[0].correlationId, walletVerified.headers.get("x-correlation-id"));
  for (const data of [
    { purpose: "INVESTOR_WALLET_VERIFICATION", walletId: null },
    { purpose: "OPERATOR_LOGIN", walletId: attached.payload.id }
  ]) {
    await assert.rejects(database.authChallenge.create({ data: {
      userId: administrator.userId,
      walletAddress: investorWalletAddress,
      nonceHash: randomBytes(32),
      domain: "localhost:3000",
      origin,
      expiresAt: new Date(Date.now() + 60_000),
      ...data
    } }), error => error instanceof Error && /auth_challenges_purpose_wallet_check/.test(error.message));
  }
  console.log("PASS exact investor-wallet signature activates mapping once with atomic administrator audit");

  for (const address of [attached.payload.address, administrator.walletAddress]) {
    assert.equal((await request(`/investors/${investorId}/wallets`, { cookie: administrator.cookie,
      method: "POST", body: { address } })).status, 409);
  }
  assert.equal((await request(`/investors/${investorId}/wallets`, { cookie: auditor.cookie,
    method: "POST", body: { address: publicAddress() } })).status, 403);
  assert.equal((await request("/investors", { cookie: administrator.cookie, method: "POST",
    body: { ...investorInput, externalReference: "OTHER", eligibilityStatus: "ELIGIBLE" } })).status, 400);
  assert.equal((await request(`/investors/${investorId}/wallets`, { cookie: administrator.cookie, method: "POST",
    body: { address: publicAddress(), verifiedAt: new Date().toISOString() } })).status, 400);
  assert.equal((await request(`/investors/${randomUUID()}/wallets`, { cookie: administrator.cookie,
    method: "POST", body: { address: publicAddress() } })).status, 404);
  assert.equal(await database.auditLog.count({ where: { entityId: investorId } }), 2);
  console.log("PASS no wallet reassignment, auditor write, privilege injection or missing investor creation");

  const concurrent = await Promise.all([1, 2].map(() => request("/investors", { cookie: administrator.cookie,
    method: "POST", body: { ...investorInput, externalReference: "RACE-REFERENCE" } })));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [201, 409]);
  const raced = await database.investor.findUniqueOrThrow({ where: { externalReference: "RACE-REFERENCE" } });
  assert.equal(await database.auditLog.count({ where: { entityId: raced.id } }), 1);
  console.log("PASS concurrent duplicate reference yields one investor and one audit event");

  await assert.rejects(createInvestor(database, { ...investorInput, externalReference: "ROLLBACK-REFERENCE" },
    { id: randomUUID(), walletAddress: publicAddress(), correlationId: randomUUID() }),
    error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
  assert.equal(await database.investor.count({ where: { externalReference: "ROLLBACK-REFERENCE" } }), 0);
  const immutableAuditError = error => error instanceof Error && /audit events are append-only/.test(error.message);
  await assert.rejects(database.auditLog.update({ where: { id: audit[0].id }, data: { event: "ALTERED" } }), immutableAuditError);
  await assert.rejects(database.auditLog.delete({ where: { id: audit[0].id } }), immutableAuditError);
  assert.equal(await database.auditLog.count({ where: { entityId: investorId } }), 2);
  console.log("PASS actual audit foreign-key failure rolls back creation; audit update/delete forbidden");

  for (const data of [
    { network: "SOLANA_MAINNET", status: "PENDING" },
    { network: "SOLANA_LOCALNET", status: "ACTIVE" },
    { network: "SOLANA_LOCALNET", status: "REVOKED" }
  ]) {
    await assert.rejects(database.wallet.create({ data: { address: publicAddress(), investorId, ...data } }),
      error => error instanceof Error && /wallets_status_timeline_check/.test(error.message));
  }
  const devnetCompatibility = await database.wallet.create({ data: {
    address: publicAddress(), investorId, network: "SOLANA_DEVNET", status: "PENDING"
  } });
  assert.equal(devnetCompatibility.status, "PENDING");
  console.log("PASS localnet migration preserves Devnet compatibility, rejects mainnet and invalid wallet lifecycles");

  let cursor;
  const seen = new Set();
  do {
    const page = await request(`/investors?limit=1${cursor ? `&cursor=${cursor}` : ""}`, { cookie: auditor.cookie });
    assert.equal(page.status, 200);
    for (const row of page.payload.items) { assert.ok(!seen.has(row.id)); seen.add(row.id); }
    cursor = page.payload.nextCursor;
  } while (cursor);
  assert.equal(seen.size, await database.investor.count());
  assert.equal((await request("/investors?limit=101", { cookie: auditor.cookie })).status, 400);
  assert.equal((await request("/investors?cursor=invalid", { cookie: auditor.cookie })).status, 400);
  console.log("PASS real HTTP/Prisma cursor pagination and input bounds");

  let limited;
  for (let attempt = 0; attempt < 25; attempt++) {
    const result = await request("/investors", { cookie: administrator.cookie, method: "POST", body: {} });
    if (result.status === 429) { limited = result; break; }
    assert.equal(result.status, 400);
  }
  assert.ok(limited);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  console.log("PASS local HTTP mutation limiter returns 429 and Retry-After");
  const loggedOut = await request("/auth/logout", { cookie: administrator.cookie, method: "POST", body: {} });
  assert.equal(loggedOut.status, 201);
  assert.equal((await request("/investors", { cookie: administrator.cookie })).status, 401);
  console.log("PASS logout invalidates subsequent registry reads");
} finally {
  try {
    if (app) await app.close();
    if (database) await database.$disconnect();
    if (createdDatabase) {
      await administratorDatabase.$executeRawUnsafe(`DROP DATABASE "${testDatabaseName}" WITH (FORCE)`);
      console.log("PASS removed only the generated isolated registry test database; normal database untouched");
    }
  } finally { await administratorDatabase.$disconnect(); }
}

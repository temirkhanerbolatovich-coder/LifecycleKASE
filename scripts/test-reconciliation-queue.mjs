import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { claimReconciliationJob, enqueueSubmittedReconciliations, runReconciliationTick } from "../apps/api/dist/reconciliation-worker.js";
import { confirmationAuditActor, completeReconciliationJob, requireReconciliationLease } from "../apps/api/dist/reconciliation-context.js";

// Database-only concurrency acceptance. No .env, RPC endpoint, keys, signatures from a real wallet or retained database.
const base = new URL(process.env.RECONCILIATION_TEST_DATABASE_URL ?? "");
if (base.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    !base.port || !["/postgres", "/lifecycle_kase"].includes(base.pathname)) throw new Error("Explicit loopback test PostgreSQL base is required");
const name = "lifecycle_kase_reconciliation_acceptance_" + randomUUID().replaceAll("-", "").slice(0, 16);
assert.match(name, /^lifecycle_kase_reconciliation_acceptance_[a-f0-9]{16}$/);
const target = new URL(base); target.pathname = "/" + name;
const host = new PrismaClient({ datasources: { db: { url: base.toString() } } });
const database = new PrismaClient({ datasources: { db: { url: target.toString() } } });
const runnerBDatabase = new PrismaClient({ datasources: { db: { url: target.toString() } } });
const publicAddress = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const programId = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const signature = "a".repeat(88);
const options = { enabled: true, cluster: "localnet", expectedGenesisHash: publicAddress, programId, databaseUrl: target.toString(),
  rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000, pollMs: 100, leaseMs: 120000,
  baseBackoffMs: 100, maxBackoffMs: 1000, maxAttempts: 3 };
const evidence = { scope: "DISPOSABLE_POSTGRESQL_ONLY", realChainExecution: false, assertions: [] };
const record = label => evidence.assertions.push(label);
let created = false;
try {
  await host.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: target.toString() }, stdio: "inherit" });
  if (migration.error || migration.status !== 0) throw new Error("Disposable reconciliation migration failed");
  const user = await database.user.create({ data: { displayName: "Synthetic reconciliation initiator", role: "ADMINISTRATOR" } });
  const issuer = await database.issuer.create({ data: { legalName: "Synthetic reconciliation fixture" } });
  const asset = await database.settlementAsset.create({ data: { code: "KZT_TEST", name: "KZT-Test", network: "SOLANA_LOCALNET",
    disclaimer: "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan." } });
  const instrument = await database.instrument.create({ data: { issuerId: issuer.id, settlementAssetId: asset.id, name: "Synthetic fixture", ticker: "RECONTEST",
    network: "SOLANA_LOCALNET", programId, issuerAuthority: publicAddress, complianceAuthority: publicAddress, corporateActionAuthority: publicAddress,
    faceValueMinor: 1000n, couponRateBps: 1000, paymentsPerYear: 2, issueAt: new Date(1700000000000),
    maturityAt: new Date(1900000000000), totalSupply: 35n, circulatingSupply: 35n } });
  const action = await database.corporateAction.create({ data: { instrumentId: instrument.id, createdById: user.id,
    type: "COUPON_PAYMENT", intent: "Synthetic queue fixture", recordAt: new Date(1800000000000), executeAt: new Date(1800000100000) } });
  const createOperation = async (changes = {}) => database.blockchainTransaction.create({ data: { instrumentId: instrument.id,
    corporateActionId: action.id, operationType: "COUPON_PAYMENT", signature, status: "UNKNOWN_CONFIRMATION",
    requiredSigner: publicAddress, networkGenesisHash: publicAddress, preparedTransactionBase64: "synthetic-not-a-real-wire", ...changes } });
  const operation = await createOperation();
  const submission = await database.auditLog.create({ data: { actorId: user.id, actorWallet: publicAddress, correlationId: randomUUID(),
    event: "TRANSACTION_SUBMISSION_REQUESTED", entityType: "BlockchainTransaction", entityId: operation.id,
    blockchainTransactionId: operation.id, corporateActionId: action.id, metadataJson: { signature, operationType: "COUPON_PAYMENT", cluster: "localnet" } } });
  assert.equal(await enqueueSubmittedReconciliations(database, options), 1);
  assert.equal(await enqueueSubmittedReconciliations(database, options), 0); record("signed sweeper is idempotent after a submission/queue crash");
  const claims = await Promise.all([claimReconciliationJob(database, options, "runner-a"), claimReconciliationJob(runnerBDatabase, options, "runner-b")]);
  assert.equal(claims.filter(Boolean).length, 1); record("two PostgreSQL runners claim one job exactly once");
  const first = claims.find(Boolean);
  const actorFor = job => ({ id: user.id, walletAddress: publicAddress, correlationId: randomUUID(), reconciliationContext: {
    jobId: job.id, leaseToken: job.leaseToken, runnerId: job.runnerId, operationId: operation.id, originalSignature: signature,
    initiatorId: user.id, submissionAuditId: submission.id } });
  await database.$executeRaw`UPDATE reconciliation_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = ${first.id}::uuid`;
  const resumed = await claimReconciliationJob(runnerBDatabase, options, "runner-restarted");
  assert.equal(resumed.id, first.id); assert.notEqual(resumed.leaseToken, first.leaseToken); assert.equal(resumed.attemptCount, 2);
  await assert.rejects(database.$transaction(tx => requireReconciliationLease(tx, actorFor(first), operation.id, signature)), { code: "RECONCILIATION_LEASE_LOST" });
  record("expired runner is fenced after persisted restart reclaim");
  await assert.rejects(database.$transaction(async tx => {
    await requireReconciliationLease(tx, actorFor(resumed), operation.id, signature);
    await tx.blockchainTransaction.update({ where: { id: operation.id }, data: { status: "FINALIZED" } });
    await completeReconciliationJob(tx, actorFor(resumed), new Date());
    await tx.auditLog.create({ data: { actorId: randomUUID(), actorWallet: null, correlationId: randomUUID(), event: "INVALID_FK_ROLLBACK",
      entityType: "BlockchainTransaction", entityId: operation.id, metadataJson: {} } });
  }));
  assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: operation.id } })).status, "UNKNOWN_CONFIRMATION");
  assert.equal((await database.reconciliationJob.findUniqueOrThrow({ where: { id: resumed.id } })).status, "RUNNING");
  record("audit failure rolls back projection and job completion together");
  const actor = actorFor(resumed); const observer = confirmationAuditActor(actor);
  await database.$transaction(async tx => {
    await requireReconciliationLease(tx, actor, operation.id, signature);
    await tx.blockchainTransaction.update({ where: { id: operation.id }, data: { status: "FINALIZED" } });
    await tx.auditLog.create({ data: { actorId: observer.actorId, actorWallet: observer.actorWallet, correlationId: actor.correlationId,
      event: "SYNTHETIC_RECONCILIATION_ACCEPTANCE", entityType: "BlockchainTransaction", entityId: operation.id,
      blockchainTransactionId: operation.id, metadataJson: observer.metadata } });
    await completeReconciliationJob(tx, actor, new Date());
  });
  const committed = await database.reconciliationJob.findUniqueOrThrow({ where: { id: resumed.id } });
  assert.equal(committed.status, "COMPLETED"); assert.equal(committed.leaseToken, null);
  assert.equal(await claimReconciliationJob(database, options, "runner-next"), null);
  const audit = await database.auditLog.findFirstOrThrow({ where: { event: "SYNTHETIC_RECONCILIATION_ACCEPTANCE" } });
  assert.equal(audit.actorId, null); assert.equal(audit.actorWallet, null); assert.equal(audit.metadataJson.originalInitiatorId, user.id);
  record("atomic completion removes job from claim queue and attributes observation to system");
  await assert.rejects(database.reconciliationJob.update({ where: { id: resumed.id }, data: { originalSignature: "b".repeat(88) } }));
  record("migration prevents changing queued original signature");
  await createOperation({ signature: null, status: "PREPARED" });
  await createOperation({ signature: "b".repeat(88), operationType: "RECONCILIATION_TEST_UNSUPPORTED" });
  await createOperation({ signature: "c".repeat(88), networkGenesisHash: "foreign" });
  assert.equal(await enqueueSubmittedReconciliations(database, options), 0);
  record("unsigned, unsupported and foreign-genesis operations are excluded");
  const unaudited = await createOperation({ signature: "d".repeat(88) });
  const result = await runReconciliationTick(database, { request: async method => { assert.equal(method, "getGenesisHash"); return publicAddress; } }, options, "runner-audit-check");
  assert.equal(result.status, "BLOCKED");
  const preserved = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: unaudited.id } });
  assert.equal(preserved.signature, "d".repeat(88)); assert.equal(preserved.status, "UNKNOWN_CONFIRMATION");
  record("missing original submission audit blocks worker while preserving unknown signature");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await Promise.all([database.$disconnect(), runnerBDatabase.$disconnect()]);
  if (created) await host.$executeRawUnsafe(`DROP DATABASE "${name}"`);
  await host.$disconnect();
}

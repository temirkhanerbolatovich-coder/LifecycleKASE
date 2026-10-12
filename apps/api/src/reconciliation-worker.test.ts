import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { encodePublicKey, SolanaRpcError } from "@lifecycle-kase/solana-client";
import { Prisma, type PrismaClient } from "@prisma/client";
import { confirmationAuditActor, completeReconciliationJob, requireReconciliationLease } from "./reconciliation-context.js";
import type { EntitlementActor } from "./entitlements.js";
import { reconciliationBackoff, reconciliationErrorCode, reconciliationWorkerOptionsFromEnvironment,
  readOnlyReconciliationRpc, runReconciliationTick } from "./reconciliation-worker.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const key = encodePublicKey(Buffer.alloc(32, 7));
const environment = { RECONCILIATION_WORKER_ENABLED: "true", RECONCILIATION_DATABASE_URL:
  "postgresql://synthetic:fixture@127.0.0.1:65492/lifecycle_kase_reconciliation_acceptance_unit",
  ACTION_APPROVAL_RESERVE_ENABLED: "true", COUPON_EXECUTION_ENABLED: "true", REDEMPTION_EXECUTION_ENABLED: "true",
  SOLANA_CLUSTER: "localnet", SOLANA_RPC_URL: "http://127.0.0.1:19248", SOLANA_GENESIS_HASH: key, PROGRAM_ID: key };
const enabled = () => {
  const options = reconciliationWorkerOptionsFromEnvironment(environment);
  assert.equal(options.enabled, true);
  if (!options.enabled) throw new Error("Expected enabled fixture");
  return options;
};
const actor: EntitlementActor = { id: "c7d2a03f-bd7d-4ee0-a81b-476323ccce38", walletAddress: key,
  correlationId: "9c93889d-deed-4b53-9e94-4c765f40ea02", reconciliationContext: {
    jobId: "3ee9b111-7a7a-4b3f-904c-afd816c83fdb", leaseToken: randomUUID(), runnerId: "runner-a",
    operationId: "82c6eb3f-825b-4d35-8db1-8b32b4b580fd", originalSignature: "a".repeat(88),
    initiatorId: "c7d2a03f-bd7d-4ee0-a81b-476323ccce38", submissionAuditId: "76c977ce-2808-4d4f-8d5a-dbc3d9e7d26"
  } };

test("reconciliation is default off without requiring or reading any environment target", () => {
  assert.deepEqual(reconciliationWorkerOptionsFromEnvironment({}), { enabled: false });
  assert.deepEqual(reconciliationWorkerOptionsFromEnvironment({ RECONCILIATION_DATABASE_URL: "secret invalid value" }), { enabled: false });
  assert.equal(enabled().leaseMs, 120_000);
});
test("worker rejects owner database, public RPC, Devnet, implicit DB and missing execution capabilities", () => {
  for (const changes of [
    { RECONCILIATION_WORKER_ENABLED: "TRUE" }, { RECONCILIATION_DATABASE_URL: "" },
    { RECONCILIATION_DATABASE_URL: "postgresql://synthetic:fixture@127.0.0.1:65492/lifecycle_kase" },
    { RECONCILIATION_DATABASE_URL: "postgresql://synthetic:fixture@db.example.com:65492/lifecycle_kase_reconciliation_acceptance_unit" },
    { RECONCILIATION_DATABASE_URL: "postgresql://synthetic:fixture@127.0.0.1/lifecycle_kase_reconciliation_acceptance_unit" },
    { SOLANA_RPC_URL: "https://api.devnet.solana.com" }, { SOLANA_CLUSTER: "devnet" },
    { COUPON_EXECUTION_ENABLED: "false" }, { REDEMPTION_EXECUTION_ENABLED: "false" }, { ACTION_APPROVAL_RESERVE_ENABLED: "false" }
  ]) assert.throws(() => reconciliationWorkerOptionsFromEnvironment({ ...environment, ...changes }));
});
test("durable worker configuration accepts only bounded integer delays and capped retry counts", () => {
  for (const changes of [ { RECONCILIATION_POLL_MS: "0" }, { RECONCILIATION_LEASE_MS: "999" },
    { RECONCILIATION_MAX_ATTEMPTS: "1.5" }, { RECONCILIATION_MAX_ATTEMPTS: "10001" },
    { RECONCILIATION_BASE_BACKOFF_MS: "5000", RECONCILIATION_MAX_BACKOFF_MS: "1000" },
    { RECONCILIATION_MAX_BACKOFF_MS: "3600001" }, { RECONCILIATION_POLL_MS: "2000ms" } ]) {
    assert.throws(() => reconciliationWorkerOptionsFromEnvironment({ ...environment, ...changes }));
  }
});
test("wrong network is rejected before sweeper or claim mutates the database", async () => {
  const database = new Proxy({}, { get: () => { throw new Error("Database must not be accessed"); } }) as PrismaClient;
  await assert.rejects(runReconciliationTick(database, { request: async () => "foreign" }, enabled(), "runner-a"), { code: "WRONG_SOLANA_NETWORK" });
});
test("connected DB must match the explicit disposable target before any job mutation", async () => {
  let reads = 0;
  const database = { $queryRaw: async () => { reads++; return [{ name: "lifecycle_kase" }]; } } as unknown as PrismaClient;
  await assert.rejects(runReconciliationTick(database, { request: async () => key }, enabled(), "runner-a"), { code: "RECONCILIATION_CONFIGURATION_INVALID" });
  assert.equal(reads, 1);
});
test("worker RPC permits only reads and cannot send, simulate, rebuild or request airdrops", async () => {
  const called: string[] = [];
  const rpc = readOnlyReconciliationRpc({ request: async method => { called.push(method); return null; } });
  await rpc.request("getTransaction", []); await rpc.request("getGenesisHash", []);
  for (const method of ["sendTransaction", "requestAirdrop", "simulateTransaction", "getLatestBlockhash", "unknownMethod"]) {
    await assert.rejects(rpc.request(method, []), { code: "RECONCILIATION_RPC_MUTATION_FORBIDDEN" });
  }
  assert.deepEqual(called, ["getTransaction", "getGenesisHash"]);
});
test("retry backoff grows then stays capped, and secret-bearing error text is never saved", () => {
  const options = { baseBackoffMs: 5_000, maxBackoffMs: 300_000 };
  assert.deepEqual([1, 2, 3, 7, 8, 10000].map(count => reconciliationBackoff(count, options)), [5000, 10000, 20000, 300000, 300000, 300000]);
  assert.equal(reconciliationErrorCode(new Error("postgresql://private:secret@host/db")), "RECONCILIATION_INTERNAL_ERROR");
  assert.equal(reconciliationErrorCode(new TransactionWorkflowError("TRANSACTION_HISTORY_UNAVAILABLE", "pruned")), "TRANSACTION_HISTORY_UNAVAILABLE");
});
test("only recognized RPC/database transport and serialization failures qualify for automatic retry", () => {
  assert.equal(reconciliationErrorCode(new SolanaRpcError("RPC_TRANSPORT_FAILED", "hidden URL")), "RPC_TRANSPORT_FAILED");
  assert.equal(reconciliationErrorCode(new SolanaRpcError("INVALID_RPC_ENDPOINT", "hidden URL")), "INVALID_RPC_ENDPOINT");
  assert.equal(reconciliationErrorCode(new Prisma.PrismaClientKnownRequestError("hidden connection", { code: "P2024", clientVersion: "6.12.0" })), "DATABASE_UNAVAILABLE");
  assert.equal(reconciliationErrorCode(new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "6.12.0" })), "SERIALIZATION_RETRY");
  assert.equal(reconciliationErrorCode(new Prisma.PrismaClientKnownRequestError("constraint", { code: "P2003", clientVersion: "6.12.0" })), "RECONCILIATION_DATABASE_ERROR");
});
test("system observer audit preserves original signer and initiator while keeping interactive actor attribution", () => {
  const system = confirmationAuditActor(actor);
  assert.equal(system.actorId, null); assert.equal(system.actorWallet, null);
  assert.equal(system.metadata["confirmationSource"], "SYSTEM_RECONCILIATION");
  assert.equal(system.metadata["requiredSigner"], key);
  assert.equal(system.metadata["originalInitiatorId"], actor.id);
  const interactive = confirmationAuditActor({ id: actor.id, walletAddress: key, correlationId: actor.correlationId });
  assert.deepEqual(interactive, { actorId: actor.id, actorWallet: key, metadata: {} });
});
test("projection lease is mandatory for worker context and rejects mismatched operation/signature", async () => {
  const tx = { $queryRaw: async () => [] } as unknown as Prisma.TransactionClient;
  const context = actor.reconciliationContext!;
  await assert.rejects(requireReconciliationLease(tx, actor, context.operationId, context.originalSignature), { code: "RECONCILIATION_LEASE_LOST" });
  await assert.rejects(requireReconciliationLease(tx, actor, "foreign", context.originalSignature), { code: "RECONCILIATION_IDENTITY_MISMATCH" });
  await assert.rejects(requireReconciliationLease(tx, actor, context.operationId, "b".repeat(88)), { code: "RECONCILIATION_IDENTITY_MISMATCH" });
  await requireReconciliationLease(tx, { id: actor.id, walletAddress: key, correlationId: actor.correlationId }, "", "");
});
test("job completion cannot commit when its ownership token changed", async () => {
  const tx = { reconciliationJob: { updateMany: async () => ({ count: 0 }) } } as unknown as Prisma.TransactionClient;
  await assert.rejects(completeReconciliationJob(tx, actor, new Date()), { code: "RECONCILIATION_LEASE_LOST" });
});

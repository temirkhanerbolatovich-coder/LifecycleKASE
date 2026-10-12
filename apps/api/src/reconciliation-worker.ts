import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type ReconciliationJob } from "@prisma/client";
import { SolanaRpcError, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { DomainValidationError } from "@lifecycle-kase/domain";
import { ControlledRegistryError } from "./controlled-policy.js";
import { confirmCouponExecution, couponExecutionEnabled } from "./coupon-execution.js";
import { confirmRedemptionExecution, redemptionExecutionEnabled } from "./redemption-execution.js";
import type { EntitlementActor } from "./entitlements.js";
import { InstrumentDeploymentError, instrumentDeploymentOptions, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { completeReconciliationJob, requireReconciliationLease } from "./reconciliation-context.js";
import { requireWorkflowNetwork, TransactionWorkflowError } from "./transaction-workflow.js";

const SUPPORTED_OPERATIONS = ["COUPON_PAYMENT", "COUPON_FINALIZE", "REDEMPTION_PAYMENT", "REDEMPTION_FINALIZE"] as const;
const SIGNED_STATUSES = ["SUBMITTED", "UNKNOWN_CONFIRMATION"] as const;
const RETRY_CODES = new Set(["TRANSACTION_NOT_FINALIZED", "TRANSACTION_HISTORY_UNAVAILABLE", "TRANSACTION_UNAVAILABLE",
  "INVALID_RPC_RESPONSE", "RPC_TRANSPORT_FAILED", "RPC_HTTP_ERROR", "RPC_METHOD_FAILED", "DATABASE_UNAVAILABLE", "SERIALIZATION_RETRY"]);
const READ_METHODS = new Set(["getGenesisHash", "getTransaction", "getSignatureStatuses", "isBlockhashValid",
  "getAccountInfo", "getSlot", "getBlockTime", "getBlockHeight", "getTokenSupply"]);
const ACCEPTANCE_DATABASE = /^(?:lifecycle_kase_(?:reconciliation_)?acceptance_[a-z0-9_]+|actions_test_[a-f0-9]{32})$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type ReconciliationWorkerOptions = InstrumentDeploymentOptions & {
  enabled: true;
  databaseUrl: string;
  pollMs: number;
  leaseMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxAttempts: number;
};

function configurationError(): never {
  throw new TransactionWorkflowError("RECONCILIATION_CONFIGURATION_INVALID", "Worker requires explicit disposable loopback Localnet configuration", 503);
}
function integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = environment[name];
  if (raw !== undefined && !/^[1-9][0-9]*$/.test(raw)) configurationError();
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) configurationError();
  return value;
}
function targetDatabase(value: string) {
  let target: URL;
  try { target = new URL(value); } catch { return configurationError(); }
  if (target.protocol !== "postgresql:" || !LOOPBACK.has(target.hostname) || !target.port ||
      target.pathname.slice(1).length > 63 || (target.searchParams.get("schema") ?? "public") !== "public" ||
      !ACCEPTANCE_DATABASE.test(target.pathname.slice(1))) configurationError();
  return target.pathname.slice(1);
}
export function reconciliationWorkerOptionsFromEnvironment(environment: NodeJS.ProcessEnv = process.env):
  ReconciliationWorkerOptions | { enabled: false } {
  const flag = environment.RECONCILIATION_WORKER_ENABLED ?? "false";
  if (flag === "false") return { enabled: false };
  if (flag !== "true" || !environment.RECONCILIATION_DATABASE_URL ||
      !couponExecutionEnabled(environment) || !redemptionExecutionEnabled(environment)) configurationError();
  targetDatabase(environment.RECONCILIATION_DATABASE_URL);
  const network = instrumentDeploymentOptions(environment);
  const rpc = new URL(network.rpcEndpoint);
  if (network.cluster !== "localnet" || rpc.protocol !== "http:" || !LOOPBACK.has(rpc.hostname)) configurationError();
  const baseBackoffMs = integer(environment, "RECONCILIATION_BASE_BACKOFF_MS", 5_000, 100, 300_000);
  const maxBackoffMs = integer(environment, "RECONCILIATION_MAX_BACKOFF_MS", 300_000, 100, 3_600_000);
  if (maxBackoffMs < baseBackoffMs) configurationError();
  return { ...network, enabled: true, databaseUrl: environment.RECONCILIATION_DATABASE_URL,
    pollMs: integer(environment, "RECONCILIATION_POLL_MS", 2_000, 100, 60_000),
    leaseMs: integer(environment, "RECONCILIATION_LEASE_MS", 120_000, 1_000, 600_000), baseBackoffMs, maxBackoffMs,
    maxAttempts: integer(environment, "RECONCILIATION_MAX_ATTEMPTS", 100, 1, 10_000) };
}

/** Defense in depth: an imported confirmation function cannot accidentally broadcast through this adapter. */
export function readOnlyReconciliationRpc(rpc: SolanaRpc): SolanaRpc {
  return { request: async (method, params) => {
    if (!READ_METHODS.has(method)) throw new TransactionWorkflowError("RECONCILIATION_RPC_MUTATION_FORBIDDEN", "Worker RPC method is not a permitted read");
    return rpc.request(method, params);
  } };
}
export function reconciliationBackoff(attemptCount: number, options: Pick<ReconciliationWorkerOptions, "baseBackoffMs" | "maxBackoffMs">) {
  return Math.min(options.maxBackoffMs, options.baseBackoffMs * 2 ** Math.min(30, Math.max(0, attemptCount - 1)));
}
export function reconciliationErrorCode(error: unknown) {
  if ((error instanceof TransactionWorkflowError || error instanceof SolanaRpcError || error instanceof ControlledRegistryError ||
      error instanceof InstrumentDeploymentError || error instanceof DomainValidationError) && /^[A-Z][A-Z0-9_]{1,99}$/.test(error.code)) return error.code;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") return "SERIALIZATION_RETRY";
    if (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code)) return "DATABASE_UNAVAILABLE";
    return "RECONCILIATION_DATABASE_ERROR";
  }
  if (error instanceof Prisma.PrismaClientInitializationError &&
      ["P1001", "P1002", "P1008", "P1017"].includes(error.errorCode ?? "")) return "DATABASE_UNAVAILABLE";
  // Unrecognized logic failures require attention; do not hide them behind an RPC retry.
  // Error messages can contain URLs or credentials, so persist only this bounded diagnosis.
  return "RECONCILIATION_INTERNAL_ERROR";
}

async function verifyTarget(database: PrismaClient, rpc: SolanaRpc, options: ReconciliationWorkerOptions) {
  if (options.enabled !== true || options.cluster !== "localnet") configurationError();
  const rpcUrl = new URL(options.rpcEndpoint);
  if (rpcUrl.protocol !== "http:" || !LOOPBACK.has(rpcUrl.hostname)) configurationError();
  const expected = targetDatabase(options.databaseUrl);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const rows = await database.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (rows.length !== 1 || rows[0]!.name !== expected) configurationError();
}

/** A bounded sweeper repairs a crash after submission was saved but before any queue insertion. */
export async function enqueueSubmittedReconciliations(database: PrismaClient, options: ReconciliationWorkerOptions) {
  const inserted = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO reconciliation_jobs (id, blockchain_transaction_id, original_signature, network_genesis_hash, updated_at)
    SELECT gen_random_uuid(), pending.id, pending.signature, pending.network_genesis_hash, clock_timestamp()
    FROM (
      SELECT operation.id, operation.signature, operation.network_genesis_hash
      FROM blockchain_transactions operation
      JOIN instruments instrument ON instrument.id = operation.instrument_id
      WHERE operation.status::text IN (${Prisma.join(SIGNED_STATUSES)})
        AND operation.operation_type IN (${Prisma.join(SUPPORTED_OPERATIONS)})
        AND operation.signature IS NOT NULL AND operation.corporate_action_id IS NOT NULL
        AND operation.required_signer IS NOT NULL AND operation.prepared_transaction_base64 IS NOT NULL
        AND operation.network_genesis_hash = ${options.expectedGenesisHash}
        AND instrument.network = 'SOLANA_LOCALNET' AND instrument.program_id = ${options.programId}
        AND NOT EXISTS (SELECT 1 FROM reconciliation_jobs existing WHERE existing.blockchain_transaction_id = operation.id)
      ORDER BY operation.created_at, operation.id LIMIT 100
    ) pending
    ON CONFLICT (blockchain_transaction_id) DO NOTHING RETURNING id`);
  return inserted.length;
}

/** Row locks skip work owned by another runner; a fresh token fences a restarted or expired runner. */
export async function claimReconciliationJob(database: PrismaClient, options: ReconciliationWorkerOptions, runnerId: string) {
  if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(runnerId)) configurationError();
  const rows = await database.$queryRaw<ReconciliationJob[]>(Prisma.sql`
    WITH candidate AS (
      SELECT job.id FROM reconciliation_jobs job
      JOIN blockchain_transactions operation ON operation.id = job.blockchain_transaction_id
      JOIN instruments instrument ON instrument.id = operation.instrument_id
      WHERE job.network_genesis_hash = ${options.expectedGenesisHash}
        AND instrument.network = 'SOLANA_LOCALNET' AND instrument.program_id = ${options.programId}
        AND operation.operation_type IN (${Prisma.join(SUPPORTED_OPERATIONS)})
        AND ((job.status IN ('PENDING', 'RETRY_SCHEDULED') AND job.next_attempt_at <= clock_timestamp())
          OR (job.status = 'RUNNING' AND job.lease_expires_at <= clock_timestamp()))
      ORDER BY job.next_attempt_at, job.created_at, job.id
      FOR UPDATE OF job SKIP LOCKED LIMIT 1
    )
    UPDATE reconciliation_jobs job SET status = 'RUNNING', lease_token = ${randomUUID()}::uuid,
      lease_expires_at = clock_timestamp() + ${options.leaseMs} * interval '1 millisecond', runner_id = ${runnerId},
      attempt_count = attempt_count + 1, updated_at = clock_timestamp()
    FROM candidate WHERE job.id = candidate.id RETURNING job.id,
      job.blockchain_transaction_id AS "blockchainTransactionId", job.original_signature AS "originalSignature",
      job.network_genesis_hash AS "networkGenesisHash", job.status, job.attempt_count AS "attemptCount",
      job.next_attempt_at AS "nextAttemptAt", job.lease_token AS "leaseToken", job.lease_expires_at AS "leaseExpiresAt",
      job.runner_id AS "runnerId", job.last_error_code AS "lastErrorCode", job.completed_at AS "completedAt",
      job.created_at AS "createdAt", job.updated_at AS "updatedAt"`);
  return rows[0] ?? null;
}

function jobActor(job: ReconciliationJob, walletAddress: string, initiatorId: string | null, submissionAuditId: string): EntitlementActor {
  return { id: initiatorId ?? randomUUID(), walletAddress, correlationId: randomUUID(), reconciliationContext: {
    jobId: job.id, operationId: job.blockchainTransactionId, originalSignature: job.originalSignature,
    leaseToken: job.leaseToken!, runnerId: job.runnerId!, initiatorId, submissionAuditId
  } };
}
async function actorForSubmittedAttempt(database: PrismaClient, job: ReconciliationJob, options: ReconciliationWorkerOptions) {
  const operation = await database.blockchainTransaction.findUniqueOrThrow({ where: { id: job.blockchainTransactionId },
    include: { instrument: true } });
  if (!operation.requiredSigner || !operation.corporateActionId || operation.signature !== job.originalSignature ||
      operation.networkGenesisHash !== job.networkGenesisHash || job.networkGenesisHash !== options.expectedGenesisHash ||
      operation.instrument?.network !== "SOLANA_LOCALNET" || operation.instrument.programId !== options.programId ||
      !SUPPORTED_OPERATIONS.includes(operation.operationType as typeof SUPPORTED_OPERATIONS[number])) {
    throw new TransactionWorkflowError("RECONCILIATION_IDENTITY_MISMATCH", "Job differs from its original signed Localnet attempt");
  }
  const audit = await database.auditLog.findFirst({ where: { blockchainTransactionId: operation.id,
    event: "TRANSACTION_SUBMISSION_REQUESTED", actorWallet: operation.requiredSigner }, orderBy: { createdAt: "asc" } });
  const submission = audit && audit.metadataJson && typeof audit.metadataJson === "object" && !Array.isArray(audit.metadataJson)
    ? audit.metadataJson : null;
  if (!audit || submission?.["signature"] !== job.originalSignature || submission["operationType"] !== operation.operationType ||
      submission["cluster"] !== "localnet") {
    throw new TransactionWorkflowError("RECONCILIATION_SUBMISSION_AUDIT_MISSING", "Original authenticated submission audit is required");
  }
  return { operation, actor: jobActor(job, operation.requiredSigner, audit.actorId, audit.id) };
}

async function observeAlreadyFinalized(database: PrismaClient, job: ReconciliationJob, actor: EntitlementActor) {
  await database.$transaction(async tx => {
    const currentJob = await tx.reconciliationJob.findUniqueOrThrow({ where: { id: job.id } });
    if (currentJob.status === "COMPLETED") return;
    await requireReconciliationLease(tx, actor, job.blockchainTransactionId, job.originalSignature);
    const operation = await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: job.blockchainTransactionId } });
    if (operation.status !== "FINALIZED" || operation.signature !== job.originalSignature) {
      throw new TransactionWorkflowError("RECONCILIATION_NOT_FINALIZED", "Confirmation did not commit its finalized projection");
    }
    await tx.auditLog.create({ data: { actorId: null, actorWallet: null, correlationId: actor.correlationId,
      event: "RECONCILIATION_ALREADY_FINALIZED", entityType: "BlockchainTransaction", entityId: operation.id,
      corporateActionId: operation.corporateActionId, blockchainTransactionId: operation.id,
      metadataJson: { confirmationSource: "SYSTEM_RECONCILIATION", reconciliationJobId: job.id,
        signature: job.originalSignature, requiredSigner: actor.walletAddress, originalInitiatorId: actor.reconciliationContext!.initiatorId,
        originalSubmissionAuditId: actor.reconciliationContext!.submissionAuditId } } });
    await completeReconciliationJob(tx, actor, new Date());
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function scheduleFailure(database: PrismaClient, job: ReconciliationJob, code: string, options: ReconciliationWorkerOptions) {
  const blocked = !RETRY_CODES.has(code) || job.attemptCount >= options.maxAttempts;
  const savedCode = !blocked || !RETRY_CODES.has(code) ? code : "RECONCILIATION_RETRY_LIMIT";
  const delay = reconciliationBackoff(job.attemptCount, options);
  const contextActor = jobActor(job, "", null, job.id);
  await database.$transaction(async tx => {
    await requireReconciliationLease(tx, contextActor, job.blockchainTransactionId, job.originalSignature);
    await tx.$executeRaw(Prisma.sql`
      UPDATE reconciliation_jobs SET status = ${blocked ? "BLOCKED" : "RETRY_SCHEDULED"}::"ReconciliationJobStatus",
        next_attempt_at = clock_timestamp() + ${delay} * interval '1 millisecond', last_error_code = ${savedCode},
        lease_token = NULL, lease_expires_at = NULL, runner_id = NULL, updated_at = clock_timestamp()
      WHERE id = ${job.id}::uuid AND status = 'RUNNING' AND lease_token = ${job.leaseToken}::uuid`);
    await tx.auditLog.create({ data: { actorId: null, actorWallet: null, correlationId: contextActor.correlationId,
      event: blocked ? "RECONCILIATION_BLOCKED" : "RECONCILIATION_RETRY_SCHEDULED", entityType: "BlockchainTransaction",
      entityId: job.blockchainTransactionId, blockchainTransactionId: job.blockchainTransactionId,
      metadataJson: { confirmationSource: "SYSTEM_RECONCILIATION", reconciliationJobId: job.id, runnerId: job.runnerId,
        signature: job.originalSignature, attemptCount: job.attemptCount, errorCode: savedCode,
        ...(blocked ? {} : { nextAttemptDelayMs: delay }) } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return blocked ? "BLOCKED" as const : "RETRY_SCHEDULED" as const;
}

/** One tick handles at most one already signed attempt. It never prepares, signs, rebuilds or submits transactions. */
export async function runReconciliationTick(database: PrismaClient, rpc: SolanaRpc, options: ReconciliationWorkerOptions, runnerId: string) {
  const reads = readOnlyReconciliationRpc(rpc);
  await verifyTarget(database, reads, options);
  const enqueued = await enqueueSubmittedReconciliations(database, options);
  const job = await claimReconciliationJob(database, options, runnerId);
  if (!job) return { status: "IDLE" as const, enqueued };
  try {
    const { operation, actor } = await actorForSubmittedAttempt(database, job, options);
    if (operation.status === "FAILED") throw new TransactionWorkflowError("TRANSACTION_FAILED", "Recorded transaction failed on chain");
    if (operation.status !== "FINALIZED") {
      if (job.attemptCount > options.maxAttempts) {
        throw new TransactionWorkflowError("RECONCILIATION_RETRY_LIMIT", "Worker retry limit requires explicit operator attention");
      }
      if (!SIGNED_STATUSES.includes(operation.status as typeof SIGNED_STATUSES[number])) {
        throw new TransactionWorkflowError("RECONCILIATION_UNSIGNED_ATTEMPT", "Worker only confirms saved submitted signatures");
      }
      const confirm = operation.operationType.startsWith("COUPON_") ? confirmCouponExecution : confirmRedemptionExecution;
      await confirm(database, reads, operation.corporateActionId!, { operationId: operation.id, signature: job.originalSignature }, actor, options);
    }
    await observeAlreadyFinalized(database, job, actor);
    return { status: "COMPLETED" as const, jobId: job.id, operationId: operation.id, enqueued };
  } catch (error) {
    const code = reconciliationErrorCode(error);
    if (code === "RECONCILIATION_LEASE_LOST") return { status: "LEASE_LOST" as const, jobId: job.id, enqueued };
    // Interactive confirmation can win while the worker is reading RPC; observe its committed projection.
    const operation = await database.blockchainTransaction.findUnique({ where: { id: job.blockchainTransactionId } });
    if (operation?.status === "FINALIZED" && operation.signature === job.originalSignature) {
      const { actor } = await actorForSubmittedAttempt(database, job, options);
      await observeAlreadyFinalized(database, job, actor);
      return { status: "COMPLETED" as const, jobId: job.id, operationId: operation.id, enqueued };
    }
    try {
      return { status: await scheduleFailure(database, job, code, options), jobId: job.id, errorCode: code, enqueued };
    } catch (failure) {
      if (reconciliationErrorCode(failure) === "RECONCILIATION_LEASE_LOST") return { status: "LEASE_LOST" as const, jobId: job.id, enqueued };
      throw failure;
    }
  }
}

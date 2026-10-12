import { Prisma } from "@prisma/client";
import type { EntitlementActor } from "./entitlements.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

export type ReconciliationContext = {
  jobId: string;
  leaseToken: string;
  runnerId: string;
  operationId: string;
  originalSignature: string;
  initiatorId: string | null;
  submissionAuditId: string;
};

/** Hold the job row until projection commits, fencing a runner whose lease expired during RPC reads. */
export async function requireReconciliationLease(tx: Prisma.TransactionClient, actor: EntitlementActor,
  operationId: string, signature: string) {
  const context = actor.reconciliationContext;
  if (!context) return;
  if (context.operationId !== operationId || context.originalSignature !== signature) {
    throw new TransactionWorkflowError("RECONCILIATION_IDENTITY_MISMATCH", "Worker context belongs to another submitted operation");
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM reconciliation_jobs
    WHERE id = ${context.jobId}::uuid AND blockchain_transaction_id = ${operationId}::uuid
      AND original_signature = ${signature} AND status = 'RUNNING'
      AND lease_token = ${context.leaseToken}::uuid AND runner_id = ${context.runnerId}
      AND lease_expires_at > clock_timestamp()
    FOR UPDATE`);
  if (rows.length !== 1) {
    throw new TransactionWorkflowError("RECONCILIATION_LEASE_LOST", "Worker lease expired or another runner claimed the job");
  }
}

/** The saved signer proves the transaction; the background observer is the audit actor. */
export function confirmationAuditActor(actor: EntitlementActor) {
  if (!actor.reconciliationContext) {
    return { actorId: actor.id, actorWallet: actor.walletAddress, metadata: {} as Prisma.InputJsonObject };
  }
  const context = actor.reconciliationContext;
  return { actorId: null, actorWallet: null, metadata: {
    confirmationSource: "SYSTEM_RECONCILIATION", reconciliationJobId: context.jobId,
    runnerId: context.runnerId, leaseToken: context.leaseToken, requiredSigner: actor.walletAddress,
    originalInitiatorId: context.initiatorId, originalSubmissionAuditId: context.submissionAuditId
  } satisfies Prisma.InputJsonObject };
}

export function reconciliationProjectionError(error: unknown, actor: EntitlementActor) {
  if (actor.reconciliationContext && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return new TransactionWorkflowError("SERIALIZATION_RETRY", "Reconciliation projection conflicted; retry the original signature");
  }
  return error;
}

/** Complete the job in the same transaction as the settlement projection and its audit record. */
export async function completeReconciliationJob(tx: Prisma.TransactionClient, actor: EntitlementActor, now: Date) {
  const context = actor.reconciliationContext;
  if (!context) return;
  const changed = await tx.reconciliationJob.updateMany({ where: { id: context.jobId, status: "RUNNING",
    leaseToken: context.leaseToken, runnerId: context.runnerId }, data: { status: "COMPLETED", completedAt: now,
    leaseToken: null, leaseExpiresAt: null, runnerId: null, lastErrorCode: null } });
  if (changed.count !== 1) {
    throw new TransactionWorkflowError("RECONCILIATION_LEASE_LOST", "Worker job changed during projection");
  }
}

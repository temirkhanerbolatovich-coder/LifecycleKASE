import { BlockchainTransactionStatus, type PrismaClient } from "@prisma/client";
import { TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";
export type EvidenceQuery = { limit?: string; cursor?: string; actionId?: string; status?: string };
function paging(query: EvidenceQuery) {
  const limit = query.limit === undefined ? 20 : typeof query.limit === "string" && /^[0-9]{1,3}$/.test(query.limit) ? Number(query.limit) : 0;
  if (limit < 1 || limit > 100 || query.cursor !== undefined && (typeof query.cursor !== "string" || !WORKFLOW_UUID.test(query.cursor)) ||
      query.actionId !== undefined && (typeof query.actionId !== "string" || !WORKFLOW_UUID.test(query.actionId))) throw new TransactionWorkflowError("INVALID_REQUEST", "Evidence limit or object UUID is invalid", 400);
  return { limit, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) };
}
export const transactionEvidenceSelect = { id: true, instrumentId: true, corporateActionId: true, entitlementId: true,
  operationType: true, signature: true, status: true, lastErrorCode: true, requiredSigner: true, networkGenesisHash: true,
  createdAt: true, submittedAt: true, finalizedAt: true } as const;
export async function listTransactionEvidence(database: PrismaClient, query: EvidenceQuery) {
  const { limit, ...page } = paging(query);
  if (query.status !== undefined && (typeof query.status !== "string" || !Object.hasOwn(BlockchainTransactionStatus, query.status))) throw new TransactionWorkflowError("INVALID_REQUEST", "Transaction status is invalid", 400);
  const items = await database.blockchainTransaction.findMany({ where: { ...(query.actionId ? { corporateActionId: query.actionId } : {}),
    ...(query.status ? { status: query.status as BlockchainTransactionStatus } : {}) }, select: transactionEvidenceSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...page });
  return { items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1]!.id : null };
}
export async function listAuditEvidence(database: PrismaClient, query: EvidenceQuery) {
  const { limit, ...page } = paging(query);
  if (query.status !== undefined) throw new TransactionWorkflowError("INVALID_REQUEST", "Audit records have no transaction status filter", 400);
  const items = await database.auditLog.findMany({ where: query.actionId ? { corporateActionId: query.actionId } : {},
    select: { id: true, event: true, entityType: true, entityId: true, actorWallet: true, corporateActionId: true,
      blockchainTransactionId: true, correlationId: true, createdAt: true, metadataJson: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...page });
  return { items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1]!.id : null };
}

import type { PrismaClient } from "@prisma/client";
import type { SolanaRpc } from "@lifecycle-kase/solana-client";
import { actionInput, requireActionIssuer } from "./corporate-action-registry.js";
import type { InstrumentActor } from "./instrument-registry.js";
import { ACTIVE_TRANSACTION_STATUSES, submitWorkflowTransaction, TransactionWorkflowError,
  WORKFLOW_UUID, type WorkflowNetwork } from "./transaction-workflow.js";

export async function submitSnapshotRegistration(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  body: unknown, actor: InstrumentActor, options: WorkflowNetwork) {
  const input = actionInput(body, ["operationId", "signedTransactionBase64"]);
  if (!WORKFLOW_UUID.test(actionId) || typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"]) ||
      typeof input["signedTransactionBase64"] !== "string") throw new TransactionWorkflowError("INVALID_REQUEST", "Snapshot operation or signed bytes are invalid", 400);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] },
    include: { corporateAction: { include: { instrument: true, snapshot: true } } } });
  const action = operation?.corporateAction;
  if (!operation || !action || action.id !== actionId || operation.operationType !== "REGISTER_SNAPSHOT") {
    throw new TransactionWorkflowError("REGISTRATION_NOT_FOUND", "Snapshot registration attempt was not found", 404);
  }
  requireActionIssuer(action.instrument, actor);
  if (action.instrument.programId !== options.programId || action.instrument.status !== "ACTIVE" ||
      operation.status !== "FINALIZED" && (action.status !== "SCHEDULED" || action.snapshot?.status !== "PENDING_REGISTRATION") ||
      await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId, operationType: "ACTION_CANCEL",
        status: { in: [...ACTIVE_TRANSACTION_STATUSES] } } })) {
    throw new TransactionWorkflowError("REGISTRATION_NOT_READY", "Snapshot registration is not available");
  }
  return submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"], actor, options);
}

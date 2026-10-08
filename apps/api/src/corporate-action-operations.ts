import { Prisma, type PrismaClient, type BlockchainTransaction } from "@prisma/client";
import { buildCorporateActionSchedule, buildCorporateActionCancellation, decodeConfirmedCorporateAction,
  deriveCorporateActionAddresses, serializeUnsignedInstructionsTransaction, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { verifyConfirmedInstrument, type InstrumentDeploymentOptions } from "./instrument-deployment.js";
import { actionInput, actionText, requireActionIssuer, requireFutureAction, workflowDatabaseError } from "./corporate-action-registry.js";
import type { InstrumentActor } from "./instrument-registry.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, rpcObject, resumeWorkflowAttempt, requireAttemptSigner, requireWorkflowNetwork,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash, workflowProgramAccount, WORKFLOW_UUID } from "./transaction-workflow.js";

export type ActionPhase = "SCHEDULE" | "CANCEL";
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
const actionRelations = { instrument: { include: { settlementAsset: true } }, snapshot: true } as const;
const operationType = (phase: ActionPhase) => `ACTION_${phase}`;

function phaseBody(body: unknown): { phase: ActionPhase; reason: string | null } {
  const input = actionInput(body, ["phase", "reason"]);
  const phase = input["phase"];
  if (phase !== "SCHEDULE" && phase !== "CANCEL") throw new TransactionWorkflowError("INVALID_REQUEST", "Action phase must be SCHEDULE or CANCEL", 400);
  const reason = phase === "CANCEL" ? actionText(input["reason"], "Cancellation reason", 1000)! : null;
  if (phase === "SCHEDULE" && input["reason"] !== undefined) throw new TransactionWorkflowError("INVALID_REQUEST", "Schedule does not accept a cancellation reason", 400);
  return { phase, reason };
}
function preparedAction(operation: BlockchainTransaction, cluster: "localnet" | "devnet", resumed: boolean) {
  return { ...rpcObject(operation.preparedPayload), operationId: operation.id, cluster,
    requiredSigner: operation.requiredSigner, networkGenesisHash: operation.networkGenesisHash,
    serializedTransactionBase64: operation.preparedTransactionBase64, recentBlockhash: operation.recentBlockhash,
    lastValidBlockHeight: Number(operation.lastValidBlockHeight), signature: operation.signature,
    status: operation.status, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const, resumed };
}
export async function prepareCorporateActionOperation(database: PrismaClient, rpc: SolanaRpc,
  actionId: string, body: unknown, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!WORKFLOW_UUID.test(actionId)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const { phase, reason } = phaseBody(body);
  const action = await database.corporateAction.findUnique({ where: { id: actionId }, include: actionRelations });
  if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  const instrument = action.instrument;
  requireActionIssuer(instrument, actor);
  if (instrument.programId !== options.programId || instrument.network !== (options.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET")) {
    throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Instrument program/network differs from configuration");
  }
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const existing = await database.blockchainTransaction.findFirst({ where: {
    corporateActionId: actionId, operationType: operationType(phase), status: active }, orderBy: { createdAt: "desc" } });
  if (existing && await resumeWorkflowAttempt(database, rpc, existing, actor, options.expectedGenesisHash)) {
    if (rpcObject(existing.preparedPayload)["reason"] !== reason) throw new TransactionWorkflowError("ACTION_CONFLICT", "Existing cancellation uses another reason");
    return preparedAction(existing, options.cluster, true);
  }
  if (instrument.status !== "ACTIVE" || !instrument.mintAddress ||
      action.status !== (phase === "SCHEDULE" ? "DRAFT" : "SCHEDULED") || action.snapshot) {
    throw new TransactionWorkflowError("ACTION_NOT_READY", "Action or instrument cannot enter this phase");
  }
  if (phase === "SCHEDULE") requireFutureAction(action.recordAt, now);
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(instrument.id), uuidBytes(action.id));
  verifyConfirmedInstrument(await workflowProgramAccount(rpc, addresses.instrumentAddress, options.programId), instrument, "ACTIVE");
  const chainAccount = rpcObject(await rpc.request("getAccountInfo", [addresses.actionAddress, { commitment: "finalized", encoding: "base64" }]));
  if (phase === "SCHEDULE" && chainAccount["value"] !== null) throw new TransactionWorkflowError("ACTION_ADDRESS_OCCUPIED", "Action PDA is already occupied; confirm the existing attempt");
  if (phase === "CANCEL") verifyActionAccount(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId), action, addresses.instrumentAddress, "SCHEDULED");
  const input = { programId: options.programId, instrumentId: uuidBytes(instrument.id), actionId: uuidBytes(action.id), issuerAuthority: actor.walletAddress };
  const plan = phase === "SCHEDULE" ? await buildCorporateActionSchedule({ ...input, type: action.type,
    recordAt: BigInt(action.recordAt.getTime() / 1000), executeAt: BigInt(action.executeAt.getTime() / 1000),
    redemptionPercentageBps: action.redemptionPercentageBps, redemptionPriceMinor: action.redemptionPriceMinor })
    : await buildCorporateActionCancellation(input);
  const blockhash = await workflowBlockhash(rpc);
  const wire = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction], feePayer: actor.walletAddress, ...blockhash });
  const payload = { corporateActionId: action.id, phase, ...addresses, programId: options.programId, reason,
    type: action.type, intent: action.intent, recordAt: action.recordAt.toISOString(), executeAt: action.executeAt.toISOString(),
    redemptionPercentageBps: action.redemptionPercentageBps, redemptionPriceMinor: action.redemptionPriceMinor?.toString() ?? null };
  try {
    const operation = await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, include: { snapshot: true } });
      if (!current || current.version !== action.version || current.status !== action.status || current.snapshot) {
        throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed during preparation");
      }
      const updated = await tx.corporateAction.updateMany({ where: { id: action.id, version: action.version, status: action.status }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed concurrently");
      const row = await tx.blockchainTransaction.create({ data: { corporateActionId: action.id, instrumentId: instrument.id,
        operationType: operationType(phase), status: "PREPARED", createdAt: now, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight),
        requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: wire, preparedPayload: payload } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: `CORPORATE_ACTION_${phase}_PREPARED`, entityType: "BlockchainTransaction", entityId: row.id,
        corporateActionId: action.id, blockchainTransactionId: row.id, metadataJson: { ...payload, onChain: false } } });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return preparedAction(operation, options.cluster, false);
  } catch (error) { return workflowDatabaseError(error); }
}

function verifyActionAccount(base64: string, action: {
  id: string; type: string; recordAt: Date; executeAt: Date; redemptionPercentageBps: number | null; redemptionPriceMinor: bigint | null;
}, instrumentAddress: string, status: "SCHEDULED" | "CANCELLED") {
  let chain;
  try { chain = decodeConfirmedCorporateAction(base64); }
  catch { throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Action PDA data is invalid"); }
  if (!Buffer.from(chain.actionId).equals(Buffer.from(uuidBytes(action.id))) || chain.instrumentAddress !== instrumentAddress ||
      chain.type !== action.type || chain.recordAt !== BigInt(action.recordAt.getTime() / 1000) || chain.executeAt !== BigInt(action.executeAt.getTime() / 1000) ||
      chain.redemptionPercentageBps !== action.redemptionPercentageBps || chain.redemptionPriceMinor !== action.redemptionPriceMinor ||
      chain.status !== status || chain.snapshotHash !== "0".repeat(64) || chain.snapshotSlot !== 0n ||
      chain.investorCount !== 0 || chain.walletCount !== 0 || chain.totalBalance !== 0n || chain.totalAmountMinor !== 0n ||
      chain.registeredEntitlements !== 0 || chain.processedEntitlements !== 0 ||
      status === "SCHEDULED" && chain.completedAt !== null || status === "CANCELLED" && chain.completedAt === null) {
    throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Action PDA terms/status differ from the database plan");
  }
}
async function actionOperation(database: PrismaClient, actionId: string, body: unknown, actor: InstrumentActor, options: InstrumentDeploymentOptions, submit: boolean) {
  const input = actionInput(body, submit ? ["operationId", "phase", "signedTransactionBase64"] : ["operationId", "phase", "signature"]);
  if (!WORKFLOW_UUID.test(actionId) || typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"]) ||
      !["SCHEDULE", "CANCEL"].includes(String(input["phase"]))) throw new TransactionWorkflowError("INVALID_REQUEST", "Action phase or operation UUID is invalid", 400);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] }, include: { corporateAction: { include: actionRelations } } });
  if (!operation?.corporateAction || operation.corporateAction.id !== actionId || operation.operationType !== operationType(input["phase"] as ActionPhase)) {
    throw new TransactionWorkflowError("ACTION_OPERATION_NOT_FOUND", "Action operation was not found", 404);
  }
  requireActionIssuer(operation.corporateAction.instrument, actor);
  requireAttemptSigner(operation, actor.walletAddress, options.expectedGenesisHash);
  if (operation.corporateAction.instrument.programId !== options.programId) throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Instrument program differs from configuration");
  return { input, operation, action: operation.corporateAction, phase: input["phase"] as ActionPhase };
}
export async function submitCorporateActionOperation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  body: unknown, actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  const { input, operation, action, phase } = await actionOperation(database, actionId, body, actor, options, true);
  if (typeof input["signedTransactionBase64"] !== "string") throw new TransactionWorkflowError("INVALID_REQUEST", "Signed bytes are required", 400);
  if (operation.status !== "FINALIZED" && (action.status !== (phase === "SCHEDULE" ? "DRAFT" : "SCHEDULED") || action.snapshot)) {
    throw new TransactionWorkflowError("ACTION_NOT_READY", "Action cannot be submitted in its current state");
  }
  return { ...await submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"], actor, options), phase };
}
export async function confirmCorporateActionOperation(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  body: unknown, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  const { input, operation, action, phase } = await actionOperation(database, actionId, body, actor, options, false);
  const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Transaction signature is invalid", 400);
  const nextStatus = phase === "SCHEDULE" ? "SCHEDULED" : "CANCELLED";
  if (operation.status === "FINALIZED") {
    if (operation.signature !== signature) throw new TransactionWorkflowError("ACTION_CONFLICT", "Finalized operation has another signature");
    return { operationId: operation.id, signature, phase, status: "FINALIZED" as const };
  }
  if (action.status !== (phase === "SCHEDULE" ? "DRAFT" : "SCHEDULED") || action.snapshot) throw new TransactionWorkflowError("ACTION_NOT_READY", "Action cannot be confirmed in its current state");
  const slot = await verifyWorkflowFinalization(database, rpc, operation, signature, actor, options.expectedGenesisHash);
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(action.id));
  verifyActionAccount(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId, slot), action, addresses.instrumentAddress, nextStatus);
  try {
    await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: action.id }, include: { snapshot: true } });
      if (!current || current.snapshot) throw new TransactionWorkflowError("ACTION_CONFLICT", "Snapshot changed during confirmation");
      const updated = await tx.corporateAction.updateMany({ where: { id: action.id, status: action.status, version: action.version },
        data: { status: nextStatus, version: { increment: 1 }, ...(phase === "CANCEL" ? { reviewNote: String(rpcObject(operation.preparedPayload)["reason"]) } : {}) } });
      const confirmed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: active, OR: [{ signature: null }, { signature }] },
        data: { signature, status: "FINALIZED", submittedAt: operation.submittedAt ?? now, finalizedAt: now, lastErrorCode: null } });
      if (updated.count !== 1 || confirmed.count !== 1) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed concurrently");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: phase === "SCHEDULE" ? "CORPORATE_ACTION_SCHEDULED" : "CORPORATE_ACTION_CANCELLED", entityType: "CorporateAction", entityId: action.id,
        corporateActionId: action.id, blockchainTransactionId: operation.id, metadataJson: { signature, finalizedSlot: slot,
          actionAddress: addresses.actionAddress, reason: rpcObject(operation.preparedPayload)["reason"] as string | null } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: operation.id, signature, phase, actionAddress: addresses.actionAddress, finalizedSlot: slot, status: "FINALIZED" as const };
}

/** An untouched off-chain draft may be cancelled directly; a possibly signed schedule cannot. */
export async function cancelCorporateActionDraft(database: PrismaClient, actionId: string, body: unknown, actor: InstrumentActor) {
  if (!WORKFLOW_UUID.test(actionId)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const reason = actionText(actionInput(body, ["reason"])["reason"], "Cancellation reason", 1000)!;
  try {
    await database.$transaction(async tx => {
      const action = await tx.corporateAction.findUnique({ where: { id: actionId }, include: actionRelations });
      if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
      requireActionIssuer(action.instrument, actor);
      const existing = await tx.blockchainTransaction.findFirst({ where: { corporateActionId: actionId, status: active } });
      if (action.status !== "DRAFT" || action.snapshot || existing) throw new TransactionWorkflowError("ACTION_NOT_READY", "Only a draft without a pending transaction can be cancelled directly");
      const changed = await tx.corporateAction.updateMany({ where: { id: actionId, status: "DRAFT", version: action.version }, data: { status: "CANCELLED", reviewNote: reason, version: { increment: 1 } } });
      if (changed.count !== 1) throw new TransactionWorkflowError("ACTION_CONFLICT", "Draft changed concurrently");
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "CORPORATE_ACTION_DRAFT_CANCELLED", entityType: "CorporateAction", entityId: actionId, corporateActionId: actionId, metadataJson: { reason, onChain: false } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { corporateActionId: actionId, status: "CANCELLED" as const };
  } catch (error) { return workflowDatabaseError(error); }
}

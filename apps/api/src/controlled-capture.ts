import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildControlledCaptureBegin, buildControlledCaptureFinish, buildControlledCaptureAbort,
  decodeControlledCapture, decodeControlledPolicy, deriveControlledCaptureAddress,
  deriveControlledPolicyAddress, deriveCorporateActionAddresses,
  serializeUnsignedInstructionsTransaction, SYSTEM_PROGRAM_ID, type SolanaRpc,
  type ControlledAccountData
} from "@lifecycle-kase/solana-client";
import { actionInput, requireActionIssuer, workflowDatabaseError } from "./corporate-action-registry.js";
import { requireControlledRegistry } from "./controlled-policy.js";
import type { InstrumentActor } from "./instrument-registry.js";
import { ACTIVE_TRANSACTION_STATUSES, requireAttemptSigner, requireWorkflowNetwork, resumeWorkflowAttempt, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash,
  WORKFLOW_UUID, type WorkflowNetwork } from "./transaction-workflow.js";

export type ControlledCapturePhase = "BEGIN" | "FINISH" | "ABORT";
export type ControlledCaptureOptions = WorkflowNetwork & { controlledRegistryEnabled?: boolean };
type InstrumentIdentity = { id: string; programId: string | null; mintAddress: string | null;
  issuerAuthority: string; corporateActionAuthority: string; tokenPolicy?: string };
const relations = { instrument: true, snapshot: { include: { investors: true } } } as const;
const TYPES = { BEGIN: "CONTROLLED_CAPTURE_BEGIN", FINISH: "CONTROLLED_CAPTURE_FINISH", ABORT: "CONTROLLED_CAPTURE_ABORT" } as const;
const ids = (value: string) => {
  if (!WORKFLOW_UUID.test(value)) throw new TransactionWorkflowError("INVALID_REQUEST", "A valid UUID is required", 400);
  return Buffer.from(value.replaceAll("-", ""), "hex");
};
export const isControlledInstrument = (instrument: { tokenPolicy?: string }) => instrument.tokenPolicy === "CONTROLLED_FROZEN_V2";
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value,
  (_, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;

async function programData(rpc: SolanaRpc, address: string, programId: string, minimumSlot: number, optional = false) {
  const result = rpcObject(await rpc.request("getAccountInfo", [address,
    { commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }]));
  if (rpcNumber(rpcObject(result["context"])["slot"]) < minimumSlot) {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Capture response precedes the required finalized slot");
  }
  if (optional && result["value"] === null) return null;
  const account = rpcObject(result["value"]); const data = account["data"];
  if (account["owner"] !== programId || account["executable"] !== false || !Array.isArray(data) ||
      data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Controlled account metadata is invalid");
  }
  return { address, owner: programId, executable: false, dataBase64: data[0] } satisfies ControlledAccountData;
}

/** Reads identity-bound policy/capture at finalized commitment; does not acquire the movement lock. */
export async function readControlledCaptureState(rpc: SolanaRpc, instrument: InstrumentIdentity, actionId: string, minimumSlot = 0) {
  if (!instrument.programId || !instrument.mintAddress) throw new TransactionWorkflowError("INSTRUMENT_NOT_ACTIVE", "Controlled instrument identity is incomplete");
  const addresses = await deriveCorporateActionAddresses(instrument.programId, ids(instrument.id), ids(actionId));
  const controlledPolicyAddress = await deriveControlledPolicyAddress(instrument.programId, addresses.instrumentAddress);
  const controlledCaptureAddress = await deriveControlledCaptureAddress(instrument.programId, addresses.actionAddress);
  const policyData = await programData(rpc, controlledPolicyAddress, instrument.programId, minimumSlot);
  const captureData = await programData(rpc, controlledCaptureAddress, instrument.programId, minimumSlot, true);
  try {
    const policy = decodeControlledPolicy(policyData!, { programId: instrument.programId, accountAddress: controlledPolicyAddress,
      instrumentAddress: addresses.instrumentAddress, mintAddress: instrument.mintAddress });
    const capture = captureData ? decodeControlledCapture(captureData, { programId: instrument.programId,
      accountAddress: controlledCaptureAddress, instrumentAddress: addresses.instrumentAddress, actionAddress: addresses.actionAddress }) : null;
    return { ...addresses, controlledPolicyAddress, controlledCaptureAddress, policy, capture };
  } catch { throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Finalized policy or capture differs from this instrument/action"); }
}

function phaseInput(value: unknown): ControlledCapturePhase {
  if (value !== "BEGIN" && value !== "FINISH" && value !== "ABORT") throw new TransactionWorkflowError("INVALID_REQUEST", "Capture phase is unsupported", 400);
  return value;
}
async function actionForCapture(database: PrismaClient, actionId: string, options: ControlledCaptureOptions, actor?: InstrumentActor) {
  ids(actionId);
  const action = await database.corporateAction.findUnique({ where: { id: actionId }, include: relations });
  if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  if (actor) { requireActionIssuer(action.instrument, actor);
    if (action.instrument.corporateActionAuthority !== actor.walletAddress) throw new TransactionWorkflowError("WALLET_MISMATCH", "Corporate-action authority must sign capture", 403); }
  if (!requireControlledRegistry(action.instrument, options)) throw new TransactionWorkflowError("INSTRUMENT_TOKEN_POLICY_INVALID", "This instrument does not use controlled capture");
  if (action.instrument.programId !== options.programId) throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Instrument program differs from configuration");
  return action;
}
function captureIdentity(action: Awaited<ReturnType<typeof actionForCapture>>) {
  return { programId: action.instrument.programId!, instrumentId: ids(action.instrumentId), actionId: ids(action.id),
    corporateActionAuthority: action.instrument.corporateActionAuthority };
}
const captureInvestors = (action: Awaited<ReturnType<typeof actionForCapture>>) =>
  action.type === "COUPON_PAYMENT" ? [] : (action.snapshot?.investors ?? []).map(row => row.investorId).sort();
async function buildPhase(action: Awaited<ReturnType<typeof actionForCapture>>, phase: ControlledCapturePhase) {
  const identity = captureIdentity(action);
  if (phase === "BEGIN") return buildControlledCaptureBegin(identity);
  if (phase === "ABORT") return buildControlledCaptureAbort(identity);
  return buildControlledCaptureFinish({ ...identity,
    investorIds: captureInvestors(action).map(ids) });
}
function phaseReady(action: Awaited<ReturnType<typeof actionForCapture>>, state: Awaited<ReturnType<typeof readControlledCaptureState>>, phase: ControlledCapturePhase) {
  if (phase === "BEGIN") {
    const elapsed = Date.now() - action.recordAt.getTime();
    if (action.instrument.status !== "ACTIVE" || elapsed < 0 || elapsed > 300_000) {
      throw new TransactionWorkflowError("CONTROLLED_CAPTURE_NOT_READY", "Capture must begin on an active instrument within the record-date window");
    }
    if (action.status !== "SCHEDULED" || action.snapshot || state.capture || state.policy.captureAction !== SYSTEM_PROGRAM_ID ||
        state.policy.activeRedemption !== SYSTEM_PROGRAM_ID) throw new TransactionWorkflowError("CONTROLLED_CAPTURE_NOT_READY", "A capture or redemption already exists; resume it first");
  } else if (!state.capture || state.policy.captureAction !== state.actionAddress || state.capture.finished) {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_NOT_READY", "An unfinished movement lock is required");
  } else if (phase === "ABORT") {
    if (action.snapshot || state.capture.committed || state.capture.reservedTokens !== 0n || state.capture.reservedEntitlements !== 0) {
      throw new TransactionWorkflowError("CONTROLLED_CAPTURE_NOT_READY", "Committed capture or assigned units cannot be aborted");
    }
  } else {
    if (!action.snapshot || action.snapshot.status !== "FINALIZED" || !state.capture.committed ||
        state.capture.snapshotHash !== Buffer.from(action.snapshot.snapshotHash).toString("hex") ||
        action.type !== "COUPON_PAYMENT" && (!(["UNDER_REVIEW", "APPROVED"] as string[]).includes(action.status) ||
          state.capture.reservedEntitlements !== action.snapshot.investorCount || state.capture.reservedSources.some(value => value !== 1))) {
      throw new TransactionWorkflowError("CONTROLLED_CAPTURE_NOT_READY", "Commit snapshot and reserve every assigned entitlement before resuming transfers");
    }
  }
}

export async function getControlledCapture(database: PrismaClient, rpc: SolanaRpc, actionId: string, options: ControlledCaptureOptions) {
  const action = await actionForCapture(database, actionId, options);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const state = await readControlledCaptureState(rpc, action.instrument, actionId);
  const operations = await database.blockchainTransaction.findMany({ where: { corporateActionId: actionId,
    operationType: { in: Object.values(TYPES) } }, orderBy: { createdAt: "desc" }, take: 20 });
  const ready = (phase: ControlledCapturePhase) => { try { phaseReady(action, state, phase); return true; } catch { return false; } };
  const pendingOperation = operations.find(operation => ACTIVE_TRANSACTION_STATUSES.includes(operation.status as typeof ACTIVE_TRANSACTION_STATUSES[number]));
  return { actionId, instrumentId: action.instrumentId, tokenPolicy: action.instrument.tokenPolicy,
    enabled: true,
    programId: options.programId, bondMint: action.instrument.mintAddress, cluster: options.cluster,
    networkGenesisHash: options.expectedGenesisHash, requiredSigner: action.instrument.corporateActionAuthority,
    instrumentAddress: state.instrumentAddress, actionAddress: state.actionAddress,
    controlledPolicyAddress: state.controlledPolicyAddress, controlledCaptureAddress: state.controlledCaptureAddress,
    investorIds: captureInvestors(action),
    policy: json(state.policy), capture: state.capture ? json(state.capture) : null,
    canBegin: ready("BEGIN"), canFinish: ready("FINISH"), canAbort: ready("ABORT"),
    readiness: { begin: ready("BEGIN"), finish: ready("FINISH"), abort: ready("ABORT") },
    pending: pendingOperation ? { ...rpcObject(pendingOperation.preparedPayload), operationId: pendingOperation.id,
      status: pendingOperation.status, signature: pendingOperation.signature, resumed: true } : null,
    operations: operations.map(operation => ({ operationId: operation.id, phase: Object.entries(TYPES).find(([, type]) => type === operation.operationType)?.[0],
      status: operation.status, signature: operation.signature, lastErrorCode: operation.lastErrorCode, prepared: operation.preparedPayload })) };
}

export async function prepareControlledCapture(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  body: unknown, actor: InstrumentActor, options: ControlledCaptureOptions) {
  const input = actionInput(body, ["phase"]); const phase = phaseInput(input["phase"]);
  const action = await actionForCapture(database, actionId, options, actor);
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const attempt = await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId,
    operationType: { in: Object.values(TYPES) }, status: { in: [...ACTIVE_TRANSACTION_STATUSES] } }, orderBy: { createdAt: "desc" } });
  if (attempt && await resumeWorkflowAttempt(database, rpc, attempt, actor, options.expectedGenesisHash)) {
    if (attempt.operationType !== TYPES[phase]) throw new TransactionWorkflowError("CONTROLLED_CAPTURE_PENDING", "Confirm the original capture operation first");
    return { ...rpcObject(attempt.preparedPayload), operationId: attempt.id, status: attempt.status, signature: attempt.signature, resumed: true };
  }
  const state = await readControlledCaptureState(rpc, action.instrument, actionId); phaseReady(action, state, phase);
  if (phase === "BEGIN" && await database.blockchainTransaction.findFirst({ where: {
    OR: [{ instrumentId: action.instrumentId }, { corporateAction: { instrumentId: action.instrumentId } }],
    status: { in: [...ACTIVE_TRANSACTION_STATUSES] }
  } })) throw new TransactionWorkflowError("CONTROLLED_CAPTURE_PENDING", "Confirm outstanding instrument operations before acquiring another capture lock");
  const plan = await buildPhase(action, phase); const blockhash = await workflowBlockhash(rpc);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions,
    feePayer: actor.walletAddress, ...blockhash });
  const payload = { ...captureIdentity(action), instrumentId: action.instrumentId, actionId, corporateActionId: actionId, phase,
    bondMint: action.instrument.mintAddress,
    tokenPolicy: action.instrument.tokenPolicy, cluster: options.cluster, networkGenesisHash: options.expectedGenesisHash,
    requiredSigner: actor.walletAddress, ...blockhash, serializedTransactionBase64,
    instrumentAddress: plan.instrumentAddress, actionAddress: plan.actionAddress,
    controlledPolicyAddress: plan.controlledPolicyAddress, controlledCaptureAddress: plan.controlledCaptureAddress,
    investorIds: phase === "FINISH" ? captureInvestors(action) : [],
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64", effect: phase === "BEGIN" ? "Lock bond transfers for ownership capture" :
      phase === "FINISH" ? "Resume transfers of unreserved bond units" : "Abort uncommitted capture and resume transfers" };
  const operation = await database.$transaction(async tx => {
    const current = await tx.corporateAction.findUnique({ where: { id: actionId }, include: relations });
    if (!current || current.version !== action.version || current.instrument.tokenPolicy !== action.instrument.tokenPolicy ||
        current.instrument.corporateActionAuthority !== actor.walletAddress || await tx.blockchainTransaction.findFirst({
          where: { ...(phase === "BEGIN" ? { OR: [{ instrumentId: action.instrumentId }, { corporateAction: { instrumentId: action.instrumentId } }] } : { corporateActionId: actionId }),
            status: { in: [...ACTIVE_TRANSACTION_STATUSES] } } })) {
      throw new TransactionWorkflowError("ACTION_CONFLICT", "Action or pending transaction changed concurrently");
    }
    const saved = await tx.blockchainTransaction.create({ data: { instrumentId: action.instrumentId, corporateActionId: actionId,
      operationType: TYPES[phase], requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash,
      ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight), preparedTransactionBase64: serializedTransactionBase64,
      preparedPayload: json(payload) } });
    await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
      event: TYPES[phase] + "_PREPARED", entityType: "CorporateAction", entityId: actionId, corporateActionId: actionId,
      blockchainTransactionId: saved.id, metadataJson: { phase, controlledCaptureAddress: plan.controlledCaptureAddress } } });
    return saved;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(workflowDatabaseError);
  return { ...payload, operationId: operation.id, status: operation.status, signature: null, resumed: false };
}

async function captureAttempt(database: PrismaClient, actionId: string, body: unknown, actor: InstrumentActor,
  options: ControlledCaptureOptions, confirming: boolean) {
  const input = actionInput(body, ["operationId", ...(confirming ? ["signature"] : ["signedTransactionBase64"])]);
  if (typeof input["operationId"] !== "string" || !WORKFLOW_UUID.test(input["operationId"])) throw new TransactionWorkflowError("INVALID_REQUEST", "Capture operation UUID is invalid", 400);
  const action = await actionForCapture(database, actionId, options, actor);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: input["operationId"] } });
  const entry = Object.entries(TYPES).find(([, type]) => type === operation?.operationType);
  if (!operation || operation.corporateActionId !== actionId || !entry) throw new TransactionWorkflowError("REGISTRATION_NOT_FOUND", "Capture operation was not found", 404);
  requireAttemptSigner(operation, actor.walletAddress, options.expectedGenesisHash);
  const phase = phaseInput(entry[0]); const plan = await buildPhase(action, phase);
  if (!operation.recentBlockhash || operation.lastValidBlockHeight === null || operation.lastValidBlockHeight > BigInt(Number.MAX_SAFE_INTEGER) ||
      serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: actor.walletAddress,
        recentBlockhash: operation.recentBlockhash, lastValidBlockHeight: Number(operation.lastValidBlockHeight) }) !== operation.preparedTransactionBase64) {
    throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Capture wire differs from immutable action identities");
  }
  return { input, action, operation, phase };
}
export async function submitControlledCapture(database: PrismaClient, rpc: SolanaRpc, actionId: string, body: unknown,
  actor: InstrumentActor, options: ControlledCaptureOptions) {
  const { input, operation } = await captureAttempt(database, actionId, body, actor, options, false);
  if (typeof input["signedTransactionBase64"] !== "string") throw new TransactionWorkflowError("INVALID_REQUEST", "Signed capture wire is required", 400);
  return submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"], actor,
    { ...options, confirmationOnlyAfterSubmission: true });
}
export async function confirmControlledCapture(database: PrismaClient, rpc: SolanaRpc, actionId: string, body: unknown,
  actor: InstrumentActor, options: ControlledCaptureOptions) {
  const { input, action, operation, phase } = await captureAttempt(database, actionId, body, actor, options, true);
  if (typeof input["signature"] !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input["signature"])) throw new TransactionWorkflowError("INVALID_REQUEST", "Original capture signature is required", 400);
  const signature = input["signature"];
  if (operation.status === "FINALIZED") {
    if (operation.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized signature differs from the request");
    return { operationId: operation.id, phase, signature, status: "FINALIZED" as const };
  }
  const slot = await verifyWorkflowFinalization(database, rpc, operation, signature, actor, options.expectedGenesisHash);
  const state = await readControlledCaptureState(rpc, action.instrument, actionId, slot);
  if (phase === "BEGIN" && (!state.capture || state.capture.committed || state.capture.finished || state.policy.captureAction !== state.actionAddress ||
      state.capture.startedSlot > BigInt(slot) || state.capture.startedAt < BigInt(action.recordAt.getTime() / 1000)) ||
      phase === "FINISH" && (!state.capture?.finished || state.policy.captureAction !== SYSTEM_PROGRAM_ID ||
        state.capture.snapshotHash !== Buffer.from(action.snapshot!.snapshotHash).toString("hex")) ||
      phase === "ABORT" && (state.capture !== null || state.policy.captureAction !== SYSTEM_PROGRAM_ID || state.policy.activeRedemption === state.actionAddress)) {
    throw new TransactionWorkflowError("CONTROLLED_CAPTURE_MISMATCH", "Finalized capture effect differs from the prepared phase");
  }
  await database.$transaction(async tx => {
    const changed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: { in: [...ACTIVE_TRANSACTION_STATUSES] },
      OR: [{ signature: null }, { signature }] }, data: { signature, status: "FINALIZED", finalizedAt: new Date(), lastErrorCode: null } });
    if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Capture operation changed concurrently");
    await tx.corporateAction.update({ where: { id: actionId }, data: { controlledCaptureLocked: phase === "BEGIN" } });
    await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
      event: TYPES[phase] + "_FINALIZED", entityType: "CorporateAction", entityId: actionId, corporateActionId: actionId,
      blockchainTransactionId: operation.id, metadataJson: { phase, signature, finalizedSlot: slot,
        controlledCaptureAddress: state.controlledCaptureAddress, capture: state.capture ? json(state.capture) : null } } });
  });
  return { operationId: operation.id, phase, signature, finalizedSlot: slot, status: "FINALIZED" as const };
}

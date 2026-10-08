import type { BlockchainTransaction, PrismaClient } from "@prisma/client";
import { verifyFinalizedTransaction, verifySignedPreparedTransaction, type SolanaRpc } from "@lifecycle-kase/solana-client";
import type { InstrumentActor } from "./instrument-registry.js";

export const ACTIVE_TRANSACTION_STATUSES = ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"] as const;
export const WORKFLOW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type WorkflowNetwork = { cluster: "localnet" | "devnet"; expectedGenesisHash: string; programId: string };

export class TransactionWorkflowError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message); this.name = "TransactionWorkflowError";
  }
}
export function rpcObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "RPC returned an invalid object", 503);
  }
  return value as Record<string, unknown>;
}
export function rpcNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "RPC returned an invalid number", 503);
  }
  return value as number;
}
export async function requireWorkflowNetwork(rpc: SolanaRpc, genesis: string) {
  if (await rpc.request("getGenesisHash", []) !== genesis) {
    throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "RPC genesis differs from the prepared network", 503);
  }
}
export function requireAttemptSigner(operation: BlockchainTransaction, walletAddress: string, genesis: string) {
  if (operation.requiredSigner !== walletAddress) {
    throw new TransactionWorkflowError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (operation.networkGenesisHash !== genesis || !operation.preparedTransactionBase64 ||
      !operation.recentBlockhash || operation.lastValidBlockHeight === null || operation.lastValidBlockHeight < 0n ||
      operation.lastValidBlockHeight > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Stored transaction or network is incomplete");
  }
}

/** Signed attempts are only resumed for confirmation, even after blockhash expiry. */
export async function resumeWorkflowAttempt(database: PrismaClient, rpc: SolanaRpc,
  operation: BlockchainTransaction, actor: InstrumentActor, genesis: string): Promise<boolean> {
  requireAttemptSigner(operation, actor.walletAddress, genesis);
  if (operation.signature) return true;
  if (operation.status !== "PREPARED") {
    throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "An uncertain attempt has no recorded signature");
  }
  if (rpcNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }])) <= Number(operation.lastValidBlockHeight)) return true;
  const changed = await database.blockchainTransaction.updateMany({ where: {
    id: operation.id, status: "PREPARED", signature: null
  }, data: { status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED" } });
  if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Attempt changed; reload before continuing");
  return false;
}

export async function workflowBlockhash(rpc: SolanaRpc) {
  const value = rpcObject(rpcObject(await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]))["value"]);
  if (typeof value["blockhash"] !== "string") throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Blockhash is missing", 503);
  return { recentBlockhash: value["blockhash"], lastValidBlockHeight: rpcNumber(value["lastValidBlockHeight"]) };
}

/** The only transport mutation: validates exact message/signature before loopback RPC broadcast. */
export async function submitWorkflowTransaction(database: PrismaClient, rpc: SolanaRpc,
  operation: BlockchainTransaction, signedTransactionBase64: string, actor: InstrumentActor, options: WorkflowNetwork) {
  if (options.cluster !== "localnet") throw new TransactionWorkflowError("TRUSTED_BROADCAST_NOT_AVAILABLE", "API broadcast is Localnet only");
  requireAttemptSigner(operation, actor.walletAddress, options.expectedGenesisHash);
  if (typeof signedTransactionBase64 !== "string" || signedTransactionBase64.length > 2_000) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Signed transaction is invalid", 400);
  }
  let signature: string;
  try { signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: operation.preparedTransactionBase64!,
    signedTransactionBase64, requiredSigner: actor.walletAddress }); }
  catch { throw new TransactionWorkflowError("SIGNED_TRANSACTION_INVALID", "Transaction does not match the prepared message or signer", 400); }
  if (operation.signature && operation.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Another signature is already recorded");
  if (operation.status === "FINALIZED") return { operationId: operation.id, signature, status: "FINALIZED" as const };
  if (!ACTIVE_TRANSACTION_STATUSES.includes(operation.status as typeof ACTIVE_TRANSACTION_STATUSES[number])) {
    throw new TransactionWorkflowError("TRANSACTION_NOT_SUBMITTABLE", "Attempt cannot be submitted");
  }
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  await database.$transaction(async tx => {
    const result = await tx.blockchainTransaction.updateMany({ where: { id: operation.id,
      status: { in: [...ACTIVE_TRANSACTION_STATUSES] }, OR: [{ signature: null }, { signature }] },
    data: { signature, status: "SUBMITTED", submittedAt: new Date(), lastErrorCode: null } });
    if (result.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Attempt changed concurrently");
    await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      correlationId: actor.correlationId, event: "TRANSACTION_SUBMISSION_REQUESTED", entityType: "BlockchainTransaction",
      entityId: operation.id, corporateActionId: operation.corporateActionId, blockchainTransactionId: operation.id,
      metadataJson: { signature, operationType: operation.operationType, cluster: options.cluster } } });
  });
  try {
    const result = await rpc.request("sendTransaction", [signedTransactionBase64,
      { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }]);
    if (result !== signature) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "RPC returned another signature", 503);
  } catch (error) {
    await database.blockchainTransaction.updateMany({ where: { id: operation.id, status: "SUBMITTED", signature },
      data: { status: "UNKNOWN_CONFIRMATION", lastErrorCode: "SUBMISSION_RESPONSE_UNKNOWN" } });
    throw error;
  }
  return { operationId: operation.id, signature, status: "SUBMITTED" as const };
}

/** Records uncertainty without replacing an already signed attempt or accepting pruned history. */
export async function unavailableWorkflowTransaction(database: PrismaClient, rpc: SolanaRpc,
  operation: Pick<BlockchainTransaction, "id" | "recentBlockhash">, signature: string): Promise<never> {
  const response = rpcObject(await rpc.request("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]));
  const values = response["value"];
  if (!Array.isArray(values) || values.length !== 1) throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Invalid signature status", 503);
  let code = "TRANSACTION_NOT_FINALIZED";
  if (values[0] !== null && rpcObject(values[0])["confirmationStatus"] === "finalized") code = "TRANSACTION_HISTORY_UNAVAILABLE";
  if (values[0] === null && operation.recentBlockhash) {
    const valid = rpcObject(await rpc.request("isBlockhashValid", [operation.recentBlockhash, { commitment: "finalized" }]));
    if (typeof valid["value"] !== "boolean") throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Invalid blockhash status", 503);
    if (!valid["value"]) code = "TRANSACTION_UNAVAILABLE";
  }
  await database.blockchainTransaction.updateMany({ where: { id: operation.id,
    status: { in: [...ACTIVE_TRANSACTION_STATUSES] }, OR: [{ signature: null }, { signature }] },
  data: { signature, status: "UNKNOWN_CONFIRMATION", submittedAt: new Date(), lastErrorCode: code } });
  throw new TransactionWorkflowError(code, "Finalized transaction bytes are unavailable; verify the existing signature before any new attempt");
}

export async function verifyWorkflowFinalization(database: PrismaClient, rpc: SolanaRpc,
  operation: BlockchainTransaction, signature: string, actor: InstrumentActor, genesis: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  requireAttemptSigner(operation, actor.walletAddress, genesis);
  if (!ACTIVE_TRANSACTION_STATUSES.includes(operation.status as typeof ACTIVE_TRANSACTION_STATUSES[number]) ||
      operation.signature && operation.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Attempt cannot be confirmed with this signature");
  await requireWorkflowNetwork(rpc, genesis);
  const response = await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (response === null) return unavailableWorkflowTransaction(database, rpc, operation, signature);
  const result = rpcObject(response); const meta = rpcObject(result["meta"]); const slot = rpcNumber(result["slot"]);
  const tuple = result["transaction"];
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64") {
    throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Finalized wire transaction is missing", 503);
  }
  try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: operation.preparedTransactionBase64!,
    finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature }); }
  catch { throw new TransactionWorkflowError("TRANSACTION_MISMATCH", "Finalized message differs from the prepared transaction"); }
  if (meta["err"] !== null) {
    await database.blockchainTransaction.updateMany({ where: { id: operation.id, status: { in: [...ACTIVE_TRANSACTION_STATUSES] },
      OR: [{ signature: null }, { signature }] }, data: { signature, status: "FAILED", submittedAt: new Date(), lastErrorCode: "TRANSACTION_FAILED" } });
    throw new TransactionWorkflowError("TRANSACTION_FAILED", "Prepared transaction failed on chain");
  }
  return slot;
}

export async function workflowProgramAccount(rpc: SolanaRpc, address: string, programId: string, minimumSlot = 0) {
  const response = rpcObject(await rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }]));
  const value = rpcObject(response["value"]); const context = rpcObject(response["context"]);
  const data = value["data"];
  if (rpcNumber(context["slot"]) < minimumSlot || value["owner"] !== programId || value["executable"] !== false ||
      !Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new TransactionWorkflowError("ACTION_ACCOUNT_MISMATCH", "Finalized program account metadata differs from the plan");
  }
  return data[0];
}

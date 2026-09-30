import type { PrismaClient } from "@prisma/client";
import {
  buildSnapshotRegistrationInstruction,
  decodeConfirmedSnapshotAccount,
  decodePublicKey,
  serializeUnsignedSnapshotRegistrationTransaction,
  verifyFinalizedSnapshotTransaction,
  type SolanaRpc
} from "@lifecycle-kase/solana-client";

import { SnapshotPreparationError } from "./snapshot-candidate.js";
import { uuidBytes } from "./snapshot-registration.js";

const CONFIRMABLE_STATUSES = ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConfirmationActor = { id: string; walletAddress: string; correlationId: string };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function recordTerminalFailure(
  database: PrismaClient,
  operationId: string,
  signature: string,
  code: string
): Promise<void> {
  await database.blockchainTransaction.updateMany({
    where: { id: operationId, status: { in: [...CONFIRMABLE_STATUSES] } },
    data: { signature, status: "FAILED", submittedAt: new Date(), lastErrorCode: code }
  });
}

/** Confirms the exact prepared transaction and its resulting Action PDA before database finalization. */
export async function confirmSnapshotRegistration(
  database: PrismaClient,
  rpc: SolanaRpc,
  actionId: string,
  operationId: string,
  transactionSignature: string,
  actor: ConfirmationActor,
  expectedGenesisHash: string,
  now: Date
) {
  if (!Number.isFinite(now.getTime()) || !UUID_PATTERN.test(actionId) || !UUID_PATTERN.test(operationId) ||
      !UUID_PATTERN.test(actor.id) || !UUID_PATTERN.test(actor.correlationId) ||
      typeof transactionSignature !== "string" || transactionSignature.length < 64 ||
      transactionSignature.length > 88 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(transactionSignature)) {
    throw new SnapshotPreparationError("INVALID_REQUEST", "Confirmation identifiers, signature, or time are invalid");
  }
  const operation = await database.blockchainTransaction.findUnique({
    where: { id: operationId },
    include: {
      corporateAction: { include: { instrument: true, snapshot: true } }
    }
  });
  const action = operation?.corporateAction;
  const snapshot = action?.snapshot;
  if (!operation || !action || action.id !== actionId || operation.operationType !== "REGISTER_SNAPSHOT" || !snapshot) {
    throw new SnapshotPreparationError("REGISTRATION_NOT_FOUND", "Snapshot registration attempt was not found");
  }
  if (operation.status === "FINALIZED") {
    if (operation.signature !== transactionSignature || snapshot.status !== "FINALIZED" ||
        action.status !== "SNAPSHOT_CREATED") {
      throw new SnapshotPreparationError("REGISTRATION_CONFLICT", "Finalized registration does not match the request");
    }
    return { operationId, signature: transactionSignature, snapshotId: snapshot.id, status: "FINALIZED" as const };
  }
  if (!CONFIRMABLE_STATUSES.includes(operation.status as typeof CONFIRMABLE_STATUSES[number]) ||
      (operation.signature && operation.signature !== transactionSignature) ||
      !operation.recentBlockhash || operation.lastValidBlockHeight === null ||
      snapshot.status !== "PENDING_REGISTRATION" || action.status !== "SCHEDULED" ||
      !action.instrument.programId || !action.instrument.mintAddress) {
    throw new SnapshotPreparationError("REGISTRATION_NOT_READY", "Snapshot registration attempt is not confirmable");
  }
  if (operation.lastValidBlockHeight < 0n || operation.lastValidBlockHeight > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SnapshotPreparationError("REGISTRATION_NOT_READY", "Prepared block height is invalid");
  }
  const genesisHash = await rpc.request("getGenesisHash", []);
  if (genesisHash !== expectedGenesisHash || snapshot.networkGenesisHash !== expectedGenesisHash) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "Confirmation RPC does not match the snapshot network");
  }
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: action.instrument.programId,
    instrumentId: uuidBytes(action.instrument.id),
    actionId: uuidBytes(action.id),
    issuerAuthority: action.instrument.issuerAuthority,
    bondMint: action.instrument.mintAddress,
    snapshotHash: Buffer.from(snapshot.snapshotHash).toString("hex"),
    snapshotSlot: snapshot.solanaSlot,
    investorCount: snapshot.investorCount,
    walletCount: snapshot.walletCount,
    totalBalance: snapshot.totalBalance,
    mintSupply: snapshot.mintSupply
  });
  const expectedTransaction = serializeUnsignedSnapshotRegistrationTransaction({
    instruction,
    feePayer: action.instrument.issuerAuthority,
    recentBlockhash: operation.recentBlockhash,
    lastValidBlockHeight: Number(operation.lastValidBlockHeight)
  });
  const rpcTransaction = await rpc.request("getTransaction", [transactionSignature, {
    commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0
  }]);
  if (rpcTransaction === null) {
    await database.blockchainTransaction.updateMany({
      where: { id: operationId, status: { in: [...CONFIRMABLE_STATUSES] } },
      data: { signature: transactionSignature, status: "UNKNOWN_CONFIRMATION", submittedAt: now,
        lastErrorCode: "TRANSACTION_NOT_FINALIZED" }
    });
    throw new SnapshotPreparationError("TRANSACTION_NOT_FINALIZED", "Transaction is not finalized yet");
  }
  const transactionResult = objectValue(rpcTransaction);
  const meta = objectValue(transactionResult?.["meta"]);
  const slot = transactionResult?.["slot"];
  if (!transactionResult || !meta || !Number.isSafeInteger(slot) || (slot as number) < Number(snapshot.solanaSlot)) {
    throw new SnapshotPreparationError("INVALID_RPC_RESPONSE", "Finalized transaction response is invalid");
  }
  if (meta["err"] !== null) {
    await recordTerminalFailure(database, operationId, transactionSignature, "TRANSACTION_FAILED");
    throw new SnapshotPreparationError("TRANSACTION_FAILED", "Snapshot registration transaction failed on chain");
  }
  const transactionTuple = transactionResult["transaction"];
  if (!Array.isArray(transactionTuple) || transactionTuple.length !== 2 ||
      typeof transactionTuple[0] !== "string" || transactionTuple[1] !== "base64") {
    throw new SnapshotPreparationError("INVALID_RPC_RESPONSE", "Finalized transaction bytes are missing");
  }
  try {
    verifyFinalizedSnapshotTransaction({
      expectedUnsignedTransactionBase64: expectedTransaction,
      finalizedTransactionBase64: transactionTuple[0],
      requiredSigner: action.instrument.issuerAuthority,
      signature: transactionSignature
    });
  } catch {
    throw new SnapshotPreparationError("TRANSACTION_MISMATCH", "Finalized transaction does not match the prepared registration");
  }
  const accountInfoResult = objectValue(await rpc.request("getAccountInfo", [instruction.actionAddress, {
    commitment: "finalized", encoding: "base64"
  }]));
  const context = objectValue(accountInfoResult?.["context"]);
  const account = objectValue(accountInfoResult?.["value"]);
  const accountData = account?.["data"];
  if (!context || !Number.isSafeInteger(context["slot"]) || (context["slot"] as number) < (slot as number) ||
      !account || account["owner"] !== action.instrument.programId || !Array.isArray(accountData) ||
      accountData.length !== 2 || typeof accountData[0] !== "string" || accountData[1] !== "base64") {
    throw new SnapshotPreparationError("ACTION_ACCOUNT_MISMATCH", "Finalized Action PDA response is invalid");
  }
  let confirmed;
  try {
    confirmed = decodeConfirmedSnapshotAccount(accountData[0]);
  } catch {
    throw new SnapshotPreparationError("ACTION_ACCOUNT_MISMATCH", "Finalized Action PDA cannot be verified");
  }
  if (!Buffer.from(confirmed.actionId).equals(Buffer.from(uuidBytes(action.id))) ||
      confirmed.instrumentAddress !== instruction.instrumentAddress ||
      confirmed.snapshotHash !== Buffer.from(snapshot.snapshotHash).toString("hex") ||
      confirmed.snapshotSlot !== snapshot.solanaSlot || confirmed.investorCount !== snapshot.investorCount ||
      confirmed.walletCount !== snapshot.walletCount || confirmed.totalBalance !== snapshot.totalBalance) {
    throw new SnapshotPreparationError("ACTION_ACCOUNT_MISMATCH", "Finalized Action PDA commitment differs from the snapshot");
  }
  await database.$transaction(async (transaction) => {
    const operationUpdate = await transaction.blockchainTransaction.updateMany({
      where: { id: operationId, status: { in: [...CONFIRMABLE_STATUSES] }, OR: [
        { signature: null }, { signature: transactionSignature }
      ] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now,
        finalizedAt: now, lastErrorCode: null }
    });
    const snapshotUpdate = await transaction.snapshot.updateMany({
      where: { id: snapshot.id, status: "PENDING_REGISTRATION" }, data: { status: "FINALIZED" }
    });
    const actionUpdate = await transaction.corporateAction.updateMany({
      where: { id: action.id, status: "SCHEDULED" },
      data: { status: "SNAPSHOT_CREATED", version: { increment: 1 } }
    });
    if (operationUpdate.count !== 1 || snapshotUpdate.count !== 1 || actionUpdate.count !== 1) {
      throw new SnapshotPreparationError("REGISTRATION_CONFLICT", "Snapshot registration state changed concurrently");
    }
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        actorWallet: actor.walletAddress,
        event: "SNAPSHOT_REGISTRATION_FINALIZED",
        entityType: "Snapshot",
        entityId: snapshot.id,
        correlationId: actor.correlationId,
        corporateActionId: action.id,
        blockchainTransactionId: operationId,
        metadataJson: {
          signature: transactionSignature,
          actionAddress: instruction.actionAddress,
          finalizedSlot: slot as number,
          snapshotHash: confirmed.snapshotHash
        }
      }
    });
  });
  return {
    operationId,
    signature: transactionSignature,
    snapshotId: snapshot.id,
    actionAddress: instruction.actionAddress,
    finalizedSlot: slot as number,
    status: "FINALIZED" as const
  };
}

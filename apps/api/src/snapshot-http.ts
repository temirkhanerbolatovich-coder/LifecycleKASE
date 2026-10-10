import { Prisma, type PrismaClient } from "@prisma/client";
import { decodePublicKey, type SolanaRpc } from "@lifecycle-kase/solana-client";

import { MAX_SNAPSHOT_GRACE_SECONDS, prepareSnapshotCandidate, SnapshotPreparationError } from "./snapshot-candidate.js";
import { persistSnapshotCandidate } from "./snapshot-persistence.js";
import { preparePendingSnapshotRegistration } from "./snapshot-registration.js";
import { requireActionIssuer, workflowDatabaseError } from "./corporate-action-registry.js";
import { checkSnapshotWindow } from "./snapshot-window.js";
import { ACTIVE_TRANSACTION_STATUSES, requireWorkflowNetwork, resumeWorkflowAttempt, rpcObject,
  TransactionWorkflowError } from "./transaction-workflow.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SnapshotHttpOptions = {
  cluster: "localnet" | "devnet";
  expectedGenesisHash: string;
  walletNetwork: string;
  graceSeconds: number;
  rpcEndpoint: string;
  rpcTimeoutMs: number;
};

function safeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", `${name} must be a positive integer`);
  }
  return parsed;
}

export function snapshotHttpOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): SnapshotHttpOptions {
  const cluster = environment.SOLANA_CLUSTER || "localnet";
  if (cluster !== "localnet" && cluster !== "devnet") {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", "SOLANA_CLUSTER must be localnet or devnet");
  }
  const expectedGenesisHash = environment.SOLANA_GENESIS_HASH;
  if (!expectedGenesisHash) {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", "SOLANA_GENESIS_HASH is required");
  }
  try {
    decodePublicKey(expectedGenesisHash);
  } catch {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", "SOLANA_GENESIS_HASH is invalid");
  }
  const graceSeconds = safeInteger(environment.SNAPSHOT_GRACE_SECONDS, 300, "SNAPSHOT_GRACE_SECONDS");
  if (graceSeconds > MAX_SNAPSHOT_GRACE_SECONDS) {
    throw new SnapshotPreparationError(
      "SNAPSHOT_CONFIGURATION_INVALID",
      `SNAPSHOT_GRACE_SECONDS cannot exceed ${MAX_SNAPSHOT_GRACE_SECONDS}`
    );
  }
  const rpcEndpoint = environment.SOLANA_RPC_URL;
  if (!rpcEndpoint) {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", "SOLANA_RPC_URL is required");
  }
  const expectedWalletNetwork = cluster === "devnet" ? "SOLANA_DEVNET" : "SOLANA_LOCALNET";
  const walletNetwork = environment.WALLET_NETWORK || expectedWalletNetwork;
  if (walletNetwork !== expectedWalletNetwork) {
    throw new SnapshotPreparationError(
      "SNAPSHOT_CONFIGURATION_INVALID",
      `WALLET_NETWORK must be ${expectedWalletNetwork} when SOLANA_CLUSTER is ${cluster}`
    );
  }
  return {
    cluster,
    expectedGenesisHash,
    walletNetwork,
    graceSeconds,
    rpcEndpoint,
    rpcTimeoutMs: safeInteger(environment.SOLANA_RPC_TIMEOUT_MS, 15_000, "SOLANA_RPC_TIMEOUT_MS")
  };
}

export async function prepareSnapshotRegistrationForAction(
  database: PrismaClient,
  rpc: SolanaRpc,
  actionId: string,
  actor: { id: string; walletAddress: string; correlationId: string },
  options: Omit<SnapshotHttpOptions, "rpcEndpoint" | "rpcTimeoutMs"> & { now: Date; programId: string }
): Promise<Awaited<ReturnType<typeof preparePendingSnapshotRegistration>> & {
  operationId: string; recordAt: string; effectiveBlockTime: string; effectiveSlot: string;
  recordPointMode: "DEMO_CAPTURE_SLOT"; transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64";
  signature: string | null; status: string; resumed: boolean;
}> {
  if (!UUID_PATTERN.test(actionId) || !UUID_PATTERN.test(actor.id) || !UUID_PATTERN.test(actor.correlationId)) {
    throw new SnapshotPreparationError("INVALID_REQUEST", "Action, actor, or correlation identifier is invalid");
  }
  const action = await database.corporateAction.findUnique({ where: { id: actionId }, include: { instrument: true } });
  if (!action) throw new SnapshotPreparationError("ACTION_NOT_FOUND", "Corporate action was not found");
  requireActionIssuer(action.instrument, actor);
  if (action.instrument.programId !== options.programId) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "Instrument program differs from configuration");
  }
  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const pendingCancellation = await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId,
    operationType: "ACTION_CANCEL", status: { in: [...ACTIVE_TRANSACTION_STATUSES] } } });
  if (pendingCancellation && await resumeWorkflowAttempt(database, rpc, pendingCancellation, actor, options.expectedGenesisHash)) {
    throw new TransactionWorkflowError("ACTION_CANCEL_PENDING", "Confirm the existing cancellation before snapshot capture");
  }
  const attempt = await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId,
    operationType: "REGISTER_SNAPSHOT", status: { in: [...ACTIVE_TRANSACTION_STATUSES] } }, orderBy: { createdAt: "desc" } });
  if (attempt && await resumeWorkflowAttempt(database, rpc, attempt, actor, options.expectedGenesisHash)) {
    const stored = rpcObject(attempt.preparedPayload);
    if (stored["corporateActionId"] !== actionId || stored["cluster"] !== options.cluster ||
        stored["requiredSigner"] !== actor.walletAddress || stored["networkGenesisHash"] !== options.expectedGenesisHash ||
        stored["serializedTransactionBase64"] !== attempt.preparedTransactionBase64) {
      throw new TransactionWorkflowError("PREPARED_ATTEMPT_INVALID", "Snapshot attempt payload differs from the stored message/network");
    }
    return { ...stored, operationId: attempt.id, signature: attempt.signature,
      status: attempt.status, resumed: true } as unknown as Awaited<ReturnType<typeof prepareSnapshotRegistrationForAction>>;
  }
  const existing = await database.snapshot.findUnique({
    where: { corporateActionId: actionId },
    select: { id: true, status: true, recordAt: true, blockTime: true, solanaSlot: true }
  });
  let snapshotId: string;
  let recordAt: string;
  let effectiveBlockTime: string;
  let effectiveSlot: string;
  let resumed: boolean;
  if (existing) {
    if (existing.status !== "PENDING_REGISTRATION") {
      throw new SnapshotPreparationError("SNAPSHOT_NOT_READY", "Existing snapshot is not pending registration");
    }
    snapshotId = existing.id;
    recordAt = existing.recordAt.toISOString();
    effectiveBlockTime = existing.blockTime.toISOString();
    effectiveSlot = existing.solanaSlot.toString();
    resumed = true;
  } else {
    try {
      const candidate = await prepareSnapshotCandidate(database, rpc, actionId, {
        cluster: options.cluster,
        expectedGenesisHash: options.expectedGenesisHash,
        walletNetwork: options.walletNetwork,
        graceSeconds: options.graceSeconds,
        now: options.now
      });
      const persisted = await persistSnapshotCandidate(database, candidate, {
        now: options.now,
        graceSeconds: options.graceSeconds,
        walletNetwork: options.walletNetwork,
        audit: {
          actorId: actor.id,
          actorWallet: actor.walletAddress,
          correlationId: actor.correlationId
        }
      });
      snapshotId = persisted.snapshotId;
      recordAt = candidate.snapshot.record_at;
      effectiveBlockTime = candidate.snapshot.block_time;
      effectiveSlot = candidate.snapshot.solana_slot;
      resumed = false;
    } catch (error) {
      if (error instanceof SnapshotPreparationError && error.code === "SNAPSHOT_WINDOW_MISSED") {
        await checkSnapshotWindow(database, rpc, actionId, { expectedVersion: action.version }, actor, options, options.now);
      }
      throw error;
    }
  }
  const registration = await preparePendingSnapshotRegistration(database, rpc, snapshotId, {
    expectedGenesisHash: options.expectedGenesisHash,
    now: options.now,
    graceSeconds: options.graceSeconds
  });
  if (registration.cluster !== options.cluster) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "Persisted snapshot cluster does not match configuration");
  }
  const prepared = await database.$transaction(async (transaction) => {
    const current = await transaction.corporateAction.findUnique({ where: { id: actionId }, include: { instrument: true } });
    if (!current || current.status !== "SCHEDULED" || current.instrument.issuerAuthority !== actor.walletAddress ||
        await transaction.blockchainTransaction.findFirst({ where: { corporateActionId: actionId,
          operationType: "ACTION_CANCEL", status: { in: [...ACTIVE_TRANSACTION_STATUSES] } } })) {
      throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed or cancellation is pending");
    }
    const operation = await transaction.blockchainTransaction.create({
      data: {
        corporateActionId: actionId,
        operationType: "REGISTER_SNAPSHOT",
        status: "PREPARED",
        createdAt: options.now,
        instrumentId: action.instrumentId,
        requiredSigner: registration.requiredSigner,
        networkGenesisHash: registration.networkGenesisHash,
        preparedTransactionBase64: registration.serializedTransactionBase64,
        preparedPayload: { ...registration, recordAt, effectiveBlockTime, effectiveSlot,
          recordPointMode: "DEMO_CAPTURE_SLOT", transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" },
        recentBlockhash: registration.recentBlockhash,
        lastValidBlockHeight: BigInt(registration.lastValidBlockHeight)
      },
      select: { id: true }
    });
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        actorWallet: actor.walletAddress,
        event: "SNAPSHOT_REGISTRATION_PREPARED",
        entityType: "BlockchainTransaction",
        entityId: operation.id,
        correlationId: actor.correlationId,
        corporateActionId: actionId,
        blockchainTransactionId: operation.id,
        metadataJson: {
          snapshotId,
          snapshotHash: registration.snapshotHash,
          recentBlockhash: registration.recentBlockhash,
          lastValidBlockHeight: registration.lastValidBlockHeight
        }
      }
    });
    return operation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(workflowDatabaseError);
  return {
    ...registration,
    operationId: prepared.id,
    recordAt,
    effectiveBlockTime,
    effectiveSlot,
    recordPointMode: "DEMO_CAPTURE_SLOT" as const,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    signature: null,
    status: "PREPARED",
    resumed
  };
}

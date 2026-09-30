import type { PrismaClient } from "@prisma/client";
import { decodePublicKey, type SolanaRpc } from "@lifecycle-kase/solana-client";

import { MAX_SNAPSHOT_GRACE_SECONDS, prepareSnapshotCandidate, SnapshotPreparationError } from "./snapshot-candidate.js";
import { persistSnapshotCandidate } from "./snapshot-persistence.js";
import { preparePendingSnapshotRegistration } from "./snapshot-registration.js";

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
  return {
    cluster,
    expectedGenesisHash,
    walletNetwork: environment.WALLET_NETWORK || (cluster === "devnet" ? "SOLANA_DEVNET" : "SOLANA_LOCALNET"),
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
  options: Omit<SnapshotHttpOptions, "rpcEndpoint" | "rpcTimeoutMs"> & { now: Date }
) {
  if (!UUID_PATTERN.test(actionId) || !UUID_PATTERN.test(actor.id) || !UUID_PATTERN.test(actor.correlationId)) {
    throw new SnapshotPreparationError("INVALID_REQUEST", "Action, actor, or correlation identifier is invalid");
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
  }
  const registration = await preparePendingSnapshotRegistration(database, rpc, snapshotId, {
    expectedGenesisHash: options.expectedGenesisHash,
    now: options.now,
    graceSeconds: options.graceSeconds
  });
  return {
    ...registration,
    recordAt,
    effectiveBlockTime,
    effectiveSlot,
    recordPointMode: "DEMO_CAPTURE_SLOT" as const,
    transactionFormat: "UNSIGNED_INSTRUCTION_PLAN" as const,
    resumed
  };
}

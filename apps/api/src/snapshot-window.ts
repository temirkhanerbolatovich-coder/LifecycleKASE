import { Prisma, type PrismaClient } from "@prisma/client";
import { deriveCorporateActionAddresses, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { verifyActionAccount } from "./corporate-action-operations.js";
import { actionInput, requireActionIssuer, workflowDatabaseError } from "./corporate-action-registry.js";
import type { InstrumentActor } from "./instrument-registry.js";
import { MAX_SNAPSHOT_GRACE_SECONDS, SnapshotPreparationError } from "./snapshot-candidate.js";
import { uuidBytes } from "./snapshot-registration.js";
import { ACTIVE_TRANSACTION_STATUSES, requireWorkflowNetwork, rpcNumber, rpcObject, TransactionWorkflowError,
  workflowProgramAccount, WORKFLOW_UUID, type WorkflowNetwork } from "./transaction-workflow.js";

const relations = { instrument: true, snapshot: true } as const;
const activeAttempts = { status: { in: [...ACTIVE_TRANSACTION_STATUSES] } };
const CLOCK_ADDRESS = "SysvarC1ock11111111111111111111111111111111";

async function finalizedClock(rpc: SolanaRpc) {
  const response = rpcObject(await rpc.request("getAccountInfo", [CLOCK_ADDRESS, { commitment: "finalized", encoding: "base64" }]));
  const slot = rpcNumber(rpcObject(response["context"])["slot"]);
  const account = rpcObject(response["value"]);
  const data = account["data"];
  if (account["owner"] !== "Sysvar1111111111111111111111111111111111111" || account["executable"] !== false ||
      !Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new TransactionWorkflowError("CLOCK_UNAVAILABLE", "Finalized Clock account is invalid; expiry is unverified", 503);
  }
  const bytes = Buffer.from(data[0], "base64");
  if (bytes.length !== 40 || bytes.toString("base64") !== data[0] || bytes.readBigUInt64LE(0) !== BigInt(slot) ||
      bytes.readBigInt64LE(32) < 0n) {
    throw new TransactionWorkflowError("CLOCK_UNAVAILABLE", "Finalized Clock data is invalid; expiry is unverified", 503);
  }
  return { slot, unixTimestamp: bytes.readBigInt64LE(32) };
}

/** Classifies an uncaptured action; only finalized expiry can write the orchestration status. */
export async function checkSnapshotWindow(database: PrismaClient, rpc: SolanaRpc, actionId: string,
  body: unknown, actor: InstrumentActor, options: WorkflowNetwork & { graceSeconds: number }, now = new Date()) {
  const input = actionInput(body, ["expectedVersion"]);
  const expectedVersion = input["expectedVersion"];
  if (!WORKFLOW_UUID.test(actionId) || !WORKFLOW_UUID.test(actor.id) || !WORKFLOW_UUID.test(actor.correlationId) ||
      !Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 0) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Action, actor, correlation UUID or expected version is invalid", 400);
  }
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(options.graceSeconds) ||
      options.graceSeconds < 1 || options.graceSeconds > MAX_SNAPSHOT_GRACE_SECONDS) {
    throw new SnapshotPreparationError("SNAPSHOT_CONFIGURATION_INVALID", "Snapshot time or grace window is invalid");
  }
  const action = await database.corporateAction.findUnique({ where: { id: actionId }, include: relations });
  if (!action) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  if (!Number.isFinite(action.recordAt.getTime()) || action.recordAt.getTime() % 1000 !== 0) {
    throw new TransactionWorkflowError("ACTION_NOT_READY", "Action record time must be an exact UTC second");
  }
  requireActionIssuer(action.instrument, actor);
  if (action.instrument.programId !== options.programId ||
      action.instrument.network !== (options.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET")) {
    throw new TransactionWorkflowError("WRONG_SOLANA_NETWORK", "Instrument program/network differs from configuration");
  }
  const result = (window: "NOT_STARTED" | "OPEN" | "AWAITING_CHAIN_WINDOW_END" | "RECOVERY_REQUIRED" | "MISSED", changed = false) => ({
    actionId, status: changed ? "SNAPSHOT_MISSED" : action.status, version: action.version + (changed ? 1 : 0),
    window, changed, recordAt: action.recordAt.toISOString(),
    captureClosesAt: new Date(action.recordAt.getTime() + options.graceSeconds * 1000).toISOString(),
    chainWindowClosesAt: new Date(action.recordAt.getTime() + MAX_SNAPSHOT_GRACE_SECONDS * 1000).toISOString(),
    onChainTransition: false as const
  });
  // A lost response can replay the check without creating another terminal event.
  if (action.status === "SNAPSHOT_MISSED") return result("MISSED");
  if (action.version !== expectedVersion) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed; reload before checking its window");
  if (action.status !== "SCHEDULED") throw new TransactionWorkflowError("ACTION_NOT_READY", "Only a scheduled action can miss snapshot capture");
  if (action.snapshot || await database.blockchainTransaction.findFirst({ where: { corporateActionId: actionId, ...activeAttempts } })) {
    return result("RECOVERY_REQUIRED");
  }
  const elapsedMs = now.getTime() - action.recordAt.getTime();
  if (elapsedMs < 0) return result("NOT_STARTED");
  if (elapsedMs <= options.graceSeconds * 1000) return result("OPEN");

  await requireWorkflowNetwork(rpc, options.expectedGenesisHash);
  const clock = await finalizedClock(rpc);
  // The server may use a shorter capture window or have clock skew. Neither proves
  // that a transaction can no longer land within the program's 300-second window.
  if (clock.unixTimestamp <= BigInt(action.recordAt.getTime() / 1000) + BigInt(MAX_SNAPSHOT_GRACE_SECONDS)) {
    return result("AWAITING_CHAIN_WINDOW_END");
  }
  const addresses = await deriveCorporateActionAddresses(options.programId, uuidBytes(action.instrumentId), uuidBytes(actionId));
  verifyActionAccount(await workflowProgramAccount(rpc, addresses.actionAddress, options.programId, clock.slot),
    action, addresses.instrumentAddress, "SCHEDULED");
  try {
    await database.$transaction(async tx => {
      const current = await tx.corporateAction.findUnique({ where: { id: actionId }, include: relations });
      if (!current || current.version !== action.version || current.status !== "SCHEDULED" || current.snapshot ||
          current.recordAt.getTime() !== action.recordAt.getTime() || current.instrument.version !== action.instrument.version ||
          current.instrumentId !== action.instrumentId || current.instrument.programId !== options.programId ||
          current.instrument.network !== action.instrument.network ||
          current.instrument.issuerAuthority !== actor.walletAddress ||
          await tx.blockchainTransaction.findFirst({ where: { corporateActionId: actionId, ...activeAttempts } })) {
        throw new TransactionWorkflowError("ACTION_CONFLICT", "Capture or an action operation changed concurrently; reload and recover");
      }
      const changed = await tx.corporateAction.updateMany({ where: { id: actionId, version: action.version, status: "SCHEDULED" },
        data: { status: "SNAPSHOT_MISSED", version: { increment: 1 } } });
      if (changed.count !== 1) throw new TransactionWorkflowError("ACTION_CONFLICT", "Action changed concurrently");
      await tx.auditLog.create({ data: {
        actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "CORPORATE_ACTION_SNAPSHOT_MISSED", entityType: "CorporateAction", entityId: actionId, corporateActionId: actionId,
        metadataJson: { recordAt: action.recordAt.toISOString(), checkedAt: now.toISOString(),
          captureGraceSeconds: options.graceSeconds, chainGraceSeconds: MAX_SNAPSHOT_GRACE_SECONDS,
          finalizedSlot: clock.slot, finalizedUnixTimestamp: clock.unixTimestamp.toString(), networkGenesisHash: options.expectedGenesisHash,
          programId: options.programId, actionAddress: addresses.actionAddress, onChainStatus: "SCHEDULED", onChainTransition: false,
          recovery: "CREATE_NEW_ACTION", previousVersion: action.version, version: action.version + 1 }
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { return workflowDatabaseError(error); }
  return { ...result("MISSED", true), finalizedSlot: clock.slot, finalizedUnixTimestamp: clock.unixTimestamp.toString() };
}

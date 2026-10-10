import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Prisma, type BlockchainTransaction, type PrismaClient, type ProgramUpgrade } from "@prisma/client";
import { buildProgramUpgrade, checkOwnerUpgrade, decodePublicKey, fundingMessageBase64,
  serializeUnsignedInstructionsTransaction, type OwnerUpgradePlan, type SolanaRpc } from "@lifecycle-kase/solana-client";
import type { InstrumentActor } from "./instrument-registry.js";
import { actionInput, workflowDatabaseError } from "./corporate-action-registry.js";
import { ACTIVE_TRANSACTION_STATUSES, requireAttemptSigner, requireWorkflowNetwork, rpcNumber, rpcObject,
  submitWorkflowTransaction, TransactionWorkflowError, verifyWorkflowFinalization, workflowBlockhash, WORKFLOW_UUID } from "./transaction-workflow.js";

export type ProgramUpgradeOptions = { plan: OwnerUpgradePlan; retained: Buffer; candidate: Buffer };
const active = { in: [...ACTIVE_TRANSACTION_STATUSES] };
const operations = ["PROGRAM_EXTEND", "PROGRAM_UPGRADE"];
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
type SignedBusinessAttempt = Pick<BlockchainTransaction,
  "status" | "signature" | "recentBlockhash" | "lastErrorCode" | "networkGenesisHash">;

function pendingBusinessTransaction(): TransactionWorkflowError {
  return new TransactionWorkflowError("UPGRADE_PENDING_BUSINESS_TRANSACTION", "Confirm signed business attempts before maintenance");
}

/**
 * A previously unavailable signed attempt may stop blocking maintenance only when
 * the same finalized network proves both that its signature is absent and that its
 * blockhash has expired. The historical UNKNOWN_CONFIRMATION row stays unchanged.
 */
export async function requireNoPendingSignedBusinessAttempts(rpc: SolanaRpc,
  attempts: SignedBusinessAttempt[], expectedGenesisHash: string) {
  if (attempts.length === 0) return;
  if (attempts.length > 100) throw pendingBusinessTransaction();
  if (attempts.some(attempt => attempt.status !== "UNKNOWN_CONFIRMATION" ||
      attempt.lastErrorCode !== "TRANSACTION_UNAVAILABLE" || !attempt.signature || !attempt.recentBlockhash ||
      attempt.networkGenesisHash !== expectedGenesisHash)) throw pendingBusinessTransaction();

  await requireWorkflowNetwork(rpc, expectedGenesisHash);
  const signatures = attempts.map(attempt => attempt.signature as string);
  const response = rpcObject(await rpc.request("getSignatureStatuses", [signatures, { searchTransactionHistory: true }]));
  const statuses = response["value"];
  if (!Array.isArray(statuses) || statuses.length !== attempts.length) {
    throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Invalid signature status", 503);
  }
  if (statuses.some(status => status !== null)) throw pendingBusinessTransaction();
  for (const attempt of attempts) {
    const validity = rpcObject(await rpc.request("isBlockhashValid", [attempt.recentBlockhash, { commitment: "finalized" }]));
    if (typeof validity["value"] !== "boolean") {
      throw new TransactionWorkflowError("INVALID_RPC_RESPONSE", "Invalid blockhash status", 503);
    }
    if (validity["value"]) throw pendingBusinessTransaction();
  }
  await requireWorkflowNetwork(rpc, expectedGenesisHash);
}

export function programUpgradeEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.LOCALNET_PROGRAM_UPGRADE_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value !== "true" || environment.SOLANA_CLUSTER !== "localnet" ||
      !["127.0.0.1", "localhost", "::1"].includes(environment.API_LISTEN_HOST ?? "") ||
      ![undefined, "false"].includes(environment.ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED)) {
    throw new TransactionWorkflowError("UPGRADE_CONFIGURATION_INVALID", "Upgrade requires loopback Localnet with entitlement registration disabled", 503);
  }
  return true;
}
/** HTTP never supplies a manifest, artifact path, RPC URL, authority or instruction list. */
export async function loadProgramUpgradeOptions(): Promise<ProgramUpgradeOptions> {
  if (!programUpgradeEnabled()) throw new TransactionWorkflowError("UPGRADE_DISABLED", "Program upgrade capability is disabled", 503);
  const root = new URL("../../../", import.meta.url);
  const plan = JSON.parse(await readFile(new URL("docs/deployment/owner-localnet-upgrade-plan.json", root), "utf8"));
  if (plan.rpcUrl !== process.env.SOLANA_RPC_URL || plan.programId !== process.env.PROGRAM_ID ||
      plan.expectedGenesisHash !== process.env.SOLANA_GENESIS_HASH) {
    throw new TransactionWorkflowError("UPGRADE_CONFIGURATION_INVALID", "API network differs from the reviewed manifest", 503);
  }
  return { plan, retained: await readFile(new URL(plan.retainedArtifact, root)), candidate: await readFile(new URL(plan.candidateArtifact, root)) };
}
function requireAuthority(actor: InstrumentActor, options: ProgramUpgradeOptions) {
  if (actor.walletAddress !== options.plan.upgradeAuthority) throw new TransactionWorkflowError("WALLET_MISMATCH", "Only the reviewed program upgrade authority may write", 403);
}
async function preflight(rpc: SolanaRpc, options: ProgramUpgradeOptions, buffer?: string, minimumSlot = 0, candidate = false) {
  try { return await checkOwnerUpgrade(options.plan, rpc, options.retained, options.candidate, buffer, minimumSlot, candidate); }
  catch (error) {
    if (error instanceof TransactionWorkflowError) throw error;
    throw new TransactionWorkflowError("UPGRADE_PREFLIGHT_FAILED", "Finalized program, artifact, buffer, authority or network differs from the reviewed upgrade", 409);
  }
}
/** Hash every program-owned account, including its metadata, in one finalized RPC context. */
export async function protectedProgramAccounts(rpc: SolanaRpc, programId: string, minimumSlot = 0) {
  const response = rpcObject(await rpc.request("getProgramAccounts", [programId,
    { commitment: "finalized", encoding: "base64", withContext: true, minContextSlot: minimumSlot }]));
  const slot = rpcNumber(rpcObject(response["context"])["slot"]); const rows = response["value"];
  if (slot < minimumSlot || !Array.isArray(rows) || rows.length > 10000) throw new TransactionWorkflowError("UPGRADE_ACCOUNT_SET_INVALID", "Program account set is incomplete or exceeds maintenance limits");
  const accounts = rows.map(value => {
    const row = rpcObject(value); const account = rpcObject(row["account"]); const data = account["data"];
    if (typeof row["pubkey"] !== "string" || account["owner"] !== programId || account["executable"] !== false ||
        !Array.isArray(data) || data.length !== 2 || data[1] !== "base64" || typeof data[0] !== "string") {
      throw new TransactionWorkflowError("UPGRADE_ACCOUNT_SET_INVALID", "Protected account metadata is invalid");
    }
    decodePublicKey(row["pubkey"]); const bytes = Buffer.from(data[0], "base64");
    if (bytes.toString("base64") !== data[0]) throw new TransactionWorkflowError("UPGRADE_ACCOUNT_SET_INVALID", "Protected account encoding is invalid");
    return { address: row["pubkey"], lamports: rpcNumber(account["lamports"]), bytes: bytes.length, sha256: hash(bytes) };
  }).sort((a, b) => a.address.localeCompare(b.address, "en"));
  if (new Set(accounts.map(row => row.address)).size !== accounts.length) throw new TransactionWorkflowError("UPGRADE_ACCOUNT_SET_INVALID", "Duplicate protected account");
  return { slot, accounts };
}
function requireSameSession(session: ProgramUpgrade, options: ProgramUpgradeOptions, actor?: InstrumentActor) {
  if (session.programId !== options.plan.programId || session.networkGenesisHash !== options.plan.expectedGenesisHash ||
      session.requiredSigner !== options.plan.upgradeAuthority || canonical(session.reviewedPlan) !== canonical(jsonPlan(options.plan))) {
    throw new TransactionWorkflowError("UPGRADE_MANIFEST_CHANGED", "Stored maintenance manifest differs; retain the lock and review recovery");
  }
  if (actor) requireAuthority(actor, options);
}
// Canonical field order also survives PostgreSQL JSONB key reordering.
function jsonPlan(plan: OwnerUpgradePlan): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(plan).sort(([a], [b]) => a.localeCompare(b, "en"))) as Prisma.InputJsonObject;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([key, field]) => JSON.stringify(key) + ":" + canonical(field)).join(",") + "}";
  return JSON.stringify(value);
}
async function verifyProtected(rpc: SolanaRpc, session: ProgramUpgrade, minimumSlot = 0) {
  const current = await protectedProgramAccounts(rpc, session.programId, minimumSlot);
  if (canonical(current.accounts) !== canonical(session.protectedAccounts)) throw new TransactionWorkflowError("UPGRADE_STATE_CHANGED", "Protected program accounts changed; maintenance stays locked");
  return current.slot;
}
function prepared(operation: BlockchainTransaction) {
  return { ...rpcObject(operation.preparedPayload), operationId: operation.id, requiredSigner: operation.requiredSigner,
    networkGenesisHash: operation.networkGenesisHash, serializedTransactionBase64: operation.preparedTransactionBase64,
    lastValidBlockHeight: Number(operation.lastValidBlockHeight), signature: operation.signature, status: operation.status,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" };
}
async function resumeUnsigned(database: PrismaClient, rpc: SolanaRpc, operation: BlockchainTransaction,
  actor: InstrumentActor, options: ProgramUpgradeOptions) {
  requireAttemptSigner(operation, actor.walletAddress, options.plan.expectedGenesisHash);
  if (operation.status !== "PREPARED") throw new TransactionWorkflowError("UPGRADE_ATTEMPT_INVALID", "Uncertain phase has no saved signature");
  if (rpcNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }])) <= Number(operation.lastValidBlockHeight)) return true;
  await database.$transaction(async tx => {
    const changed = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: "PREPARED", signature: null },
      data: { status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED" } });
    if (changed.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Expired phase changed concurrently; reload");
    await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
      event: "PROGRAM_UPGRADE_ATTEMPT_EXPIRED", entityType: "ProgramUpgrade", entityId: operation.programUpgradeId!, blockchainTransactionId: operation.id,
      metadataJson: { reason: "BLOCKHASH_EXPIRED", signatureAbsent: true, maintenanceReleased: false } } });
  });
  return false;
}
export async function getProgramUpgrade(database: PrismaClient, rpc: SolanaRpc, options: ProgramUpgradeOptions) {
  const session = await database.programUpgrade.findFirst({ orderBy: { createdAt: "desc" } });
  if (session) requireSameSession(session, options);
  const report = await preflight(rpc, options, session?.bufferAddress, 0, Boolean(session));
  const attempt = session && await database.blockchainTransaction.findFirst({ where: { programUpgradeId: session.id }, orderBy: { createdAt: "desc" } });
  return { enabled: true, ...report, maintenanceId: session?.id ?? null, maintenanceStatus: session?.status ?? null,
    attempt: attempt ? prepared(attempt) : null };
}
async function buildWire(options: ProgramUpgradeOptions, bufferAddress: string,
  phase: "EXTEND" | "UPGRADE", capacity: number, blockhash: { recentBlockhash: string; lastValidBlockHeight: number }) {
  const plan = await buildProgramUpgrade({ phase, programId: options.plan.programId, bufferAddress,
    authority: options.plan.upgradeAuthority, currentProgramCapacity: capacity, candidateBytes: options.plan.candidateBytes });
  return serializeUnsignedInstructionsTransaction({ feePayer: options.plan.upgradeAuthority, instructions: plan.instructions, ...blockhash });
}
export async function prepareProgramUpgrade(database: PrismaClient, rpc: SolanaRpc, body: unknown,
  actor: InstrumentActor, options: ProgramUpgradeOptions) {
  requireAuthority(actor, options);
  const input = actionInput(body, ["bufferAddress"]); const bufferAddress = input["bufferAddress"];
  try { if (typeof bufferAddress !== "string") throw new Error(); decodePublicKey(bufferAddress); }
  catch { throw new TransactionWorkflowError("INVALID_REQUEST", "Reviewed buffer address is required", 400); }
  const buffer = bufferAddress as string;
  let session = await database.programUpgrade.findFirst({ where: { status: "ACTIVE" } });
  if (session) {
    requireSameSession(session, options, actor);
    if (session.bufferAddress !== buffer) throw new TransactionWorkflowError("UPGRADE_BUFFER_CHANGED", "Resume the same reviewed buffer");
    const existing = await database.blockchainTransaction.findFirst({ where: { programUpgradeId: session.id, status: active } });
    if (existing) {
      await requireWorkflowNetwork(rpc, options.plan.expectedGenesisHash);
      // Preserve signed attempts even when the buffer has already been consumed on-chain.
      if (existing.signature) return prepared(existing);
      const current = await preflight(rpc, options, buffer); await verifyProtected(rpc, session);
      const payload = rpcObject(existing.preparedPayload);
      if (current.nextPhase !== payload["phase"] || current.currentProgramCapacity !== payload["currentProgramCapacity"] ||
          current.deployedAtSlot !== payload["deployedAtSlot"]) throw new TransactionWorkflowError("UPGRADE_STATE_CHANGED", "Saved unsigned phase differs from current ProgramData");
      if (await resumeUnsigned(database, rpc, existing, actor, options)) return prepared(existing);
    }
  }
  const report = await preflight(rpc, options, buffer);
  if (!report.nextPhase) throw new TransactionWorkflowError("UPGRADE_NOT_PREPARABLE", "Upgrade phase is unavailable");
  const blockhash = await workflowBlockhash(rpc);
  const wire = await buildWire(options, buffer, report.nextPhase, report.currentProgramCapacity, blockhash);
  const fee = rpcNumber(rpcObject(await rpc.request("getFeeForMessage", [fundingMessageBase64(wire), { commitment: "finalized" }]))["value"]);
  if (fee > report.feeReserveLamports || report.authorityLamports < report.extensionRentLamports + fee + report.feeReserveLamports) {
    throw new TransactionWorkflowError("UPGRADE_BUDGET_REQUIRED", "Exact phase fee, rent and policy reserve are not covered");
  }
  try {
    return await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(1940912000)`;
      if (!session) {
        if (await tx.programUpgrade.findFirst({ where: { status: "ACTIVE" } })) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Maintenance started concurrently; reload");
        const signedBusinessAttempts = await tx.blockchainTransaction.findMany({
          where: { status: active, signature: { not: null }, programUpgradeId: null },
          select: { status: true, signature: true, recentBlockhash: true, lastErrorCode: true, networkGenesisHash: true },
          orderBy: { createdAt: "asc" }, take: 101
        });
        await requireNoPendingSignedBusinessAttempts(rpc, signedBusinessAttempts, options.plan.expectedGenesisHash);
        const accounts = await protectedProgramAccounts(rpc, options.plan.programId, report.finalizedSlot);
        session = await tx.programUpgrade.create({ data: { programId: options.plan.programId, networkGenesisHash: options.plan.expectedGenesisHash,
          requiredSigner: actor.walletAddress, bufferAddress: buffer, reviewedPlan: jsonPlan(options.plan), protectedAccounts: accounts.accounts } });
      } else {
        requireSameSession(session, options, actor); await verifyProtected(rpc, session, report.finalizedSlot);
        const last = await tx.blockchainTransaction.findFirst({ where: { programUpgradeId: session.id }, orderBy: { createdAt: "desc" } });
        if (last && last.status !== "FAILED" && !(last.operationType === "PROGRAM_EXTEND" && last.status === "FINALIZED")) {
          throw new TransactionWorkflowError("UPGRADE_PHASE_PENDING", "Confirm the existing phase before another preparation");
        }
        if (report.nextPhase === "UPGRADE" && last?.operationType === "PROGRAM_EXTEND" && last.status !== "FINALIZED") {
          throw new TransactionWorkflowError("UPGRADE_EXTENSION_UNCONFIRMED", "Reconcile the saved extension before Upgrade");
        }
      }
      const payload = { ...report, phase: report.nextPhase, maintenanceId: session.id, phaseFeeLamports: fee };
      const operation = await tx.blockchainTransaction.create({ data: { programUpgradeId: session.id, operationType: `PROGRAM_${report.nextPhase}`,
        requiredSigner: actor.walletAddress, networkGenesisHash: options.plan.expectedGenesisHash, preparedTransactionBase64: wire,
        preparedPayload: payload, ...blockhash, lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight) } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "PROGRAM_UPGRADE_PREPARED", entityType: "ProgramUpgrade", entityId: session.id, blockchainTransactionId: operation.id,
        metadataJson: { ...payload, protectedAccountsSha256: hash(canonical(session.protectedAccounts)), transactionSubmitted: false } } });
      return prepared(operation);
    }, { timeout: 20000 });
  } catch (error) { return workflowDatabaseError(error); }
}
async function storedAttempt(database: PrismaClient, operationId: unknown, actor: InstrumentActor, options: ProgramUpgradeOptions) {
  requireAuthority(actor, options);
  if (typeof operationId !== "string" || !WORKFLOW_UUID.test(operationId)) throw new TransactionWorkflowError("INVALID_REQUEST", "Operation UUID is required", 400);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId } });
  if (!operation?.programUpgradeId || !operations.includes(operation.operationType)) throw new TransactionWorkflowError("UPGRADE_ATTEMPT_NOT_FOUND", "Upgrade attempt was not found", 404);
  const session = await database.programUpgrade.findUniqueOrThrow({ where: { id: operation.programUpgradeId } });
  requireSameSession(session, options, actor);
  const payload = rpcObject(operation.preparedPayload); const phase = payload["phase"];
  if (!["EXTEND", "UPGRADE"].includes(String(phase)) || operation.operationType !== `PROGRAM_${phase}` ||
      payload["bufferAddress"] !== session.bufferAddress || payload["maintenanceId"] !== session.id ||
      payload["candidateSha256"] !== options.plan.candidateSha256 || payload["retainedSha256"] !== options.plan.retainedSha256 ||
      payload["programId"] !== options.plan.programId || payload["programData"] !== options.plan.programData) {
    throw new TransactionWorkflowError("UPGRADE_ATTEMPT_INVALID", "Stored phase terms differ");
  }
  const expected = await buildWire(options, session.bufferAddress, phase as "EXTEND" | "UPGRADE",
    rpcNumber(payload["currentProgramCapacity"]), { recentBlockhash: operation.recentBlockhash!, lastValidBlockHeight: Number(operation.lastValidBlockHeight) });
  if (expected !== operation.preparedTransactionBase64) throw new TransactionWorkflowError("UPGRADE_ATTEMPT_INVALID", "Stored wire differs from its reviewed phase");
  return { operation, session, payload, phase };
}
export async function submitProgramUpgrade(database: PrismaClient, rpc: SolanaRpc, body: unknown,
  actor: InstrumentActor, options: ProgramUpgradeOptions) {
  const input = actionInput(body, ["operationId", "signedTransactionBase64"]);
  const { operation, session, phase, payload } = await storedAttempt(database, input["operationId"], actor, options);
  // A recorded signature is always confirmation-only, never a second API broadcast.
  if (operation.signature) throw new TransactionWorkflowError("UPGRADE_CONFIRMATION_ONLY", "A signature is already recorded; confirm it without broadcasting again");
  if (session.status !== "ACTIVE") throw new TransactionWorkflowError("UPGRADE_LOCK_REQUIRED", "Upgrade maintenance is not active");
  const report = await preflight(rpc, options, session.bufferAddress);
  if (report.nextPhase !== phase || report.currentProgramCapacity !== payload["currentProgramCapacity"] ||
      report.deployedAtSlot !== payload["deployedAtSlot"]) throw new TransactionWorkflowError("UPGRADE_STATE_CHANGED", "Program state changed after review; do not sign this phase");
  await verifyProtected(rpc, session, report.finalizedSlot);
  if (rpcNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }])) > Number(operation.lastValidBlockHeight)) {
    throw new TransactionWorkflowError("BLOCKHASH_EXPIRED", "Unsigned phase expired; prepare and review again");
  }
  return submitWorkflowTransaction(database, rpc, operation, input["signedTransactionBase64"] as string, actor,
    { cluster: "localnet", expectedGenesisHash: options.plan.expectedGenesisHash, programId: options.plan.programId, confirmationOnlyAfterSubmission: true });
}
export async function confirmProgramUpgrade(database: PrismaClient, rpc: SolanaRpc, body: unknown,
  actor: InstrumentActor, options: ProgramUpgradeOptions) {
  const input = actionInput(body, ["operationId", "signature"]);
  const { operation, session, phase, payload } = await storedAttempt(database, input["operationId"], actor, options);
  const signature = input["signature"];
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new TransactionWorkflowError("INVALID_REQUEST", "Signature is invalid", 400);
  if (operation.status === "FINALIZED") {
    if (operation.signature !== signature) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Finalized signature differs");
    await requireWorkflowNetwork(rpc, options.plan.expectedGenesisHash);
    return { operationId: operation.id, signature, status: "FINALIZED" as const, phase };
  }
  if (session.status !== "ACTIVE") throw new TransactionWorkflowError("UPGRADE_LOCK_REQUIRED", "Maintenance is not active");
  const slot = await verifyWorkflowFinalization(database, rpc, operation, signature, actor, options.plan.expectedGenesisHash);
  const report = await preflight(rpc, options, session.bufferAddress, slot + 1, phase === "UPGRADE");
  if (report.deployedAtSlot !== String(slot) ||
      phase === "EXTEND" && (report.currentProgramCapacity !== (payload["currentProgramCapacity"] as number) + (payload["additionalBytes"] as number) || report.nextPhase !== "UPGRADE") ||
      phase === "UPGRADE" && !report.candidateDeployed) {
    throw new TransactionWorkflowError("UPGRADE_POST_STATE_MISMATCH", "Finalized phase account state differs; maintenance stays locked");
  }
  await verifyProtected(rpc, session, slot + 1);
  try {
    await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(1940912000)`;
      const result = await tx.blockchainTransaction.updateMany({ where: { id: operation.id, status: active,
        OR: [{ signature: null }, { signature }] }, data: { signature, status: "FINALIZED", finalizedAt: new Date(), lastErrorCode: null } });
      if (result.count !== 1) throw new TransactionWorkflowError("TRANSACTION_CONFLICT", "Phase changed concurrently; reload");
      if (phase === "UPGRADE") await tx.programUpgrade.update({ where: { id: session.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "PROGRAM_UPGRADE_FINALIZED", entityType: "ProgramUpgrade", entityId: session.id, blockchainTransactionId: operation.id,
        metadataJson: { phase: String(phase), signature, finalizedSlot: slot, candidateSha256: options.plan.candidateSha256,
          protectedAccountsSha256: hash(canonical(session.protectedAccounts)), maintenanceReleased: phase === "UPGRADE" } } });
    });
  } catch (error) { return workflowDatabaseError(error); }
  return { operationId: operation.id, signature, status: "FINALIZED" as const, phase };
}

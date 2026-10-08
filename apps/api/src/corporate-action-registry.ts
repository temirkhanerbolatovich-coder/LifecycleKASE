import { Prisma, type PrismaClient, type CorporateActionType } from "@prisma/client";
import { ACTION_TYPES } from "@lifecycle-kase/solana-client";
import { instrumentNetworkFromEnvironment, type InstrumentActor } from "./instrument-registry.js";
import { TransactionWorkflowError, WORKFLOW_UUID } from "./transaction-workflow.js";

export const MIN_ACTION_LEAD_SECONDS = 60;
const SOURCES = ["MANUAL", "ISSUER_INSTRUCTION", "EXCHANGE_EVENT", "EXTERNAL_API", "SYSTEM"] as const;
export const actionInclude = {
  instrument: { select: { id: true, ticker: true, name: true, network: true, status: true,
    programId: true, mintAddress: true, issuerAuthority: true, corporateActionAuthority: true, issueAt: true, maturityAt: true } },
  snapshot: { select: { id: true, status: true, recordAt: true, blockTime: true, solanaSlot: true,
    snapshotHash: true, investorCount: true, walletCount: true, totalBalance: true } },
  blockchainTransactions: { orderBy: { createdAt: "desc" as const }, take: 20, select: {
    id: true, operationType: true, status: true, signature: true, lastErrorCode: true, createdAt: true, finalizedAt: true, preparedPayload: true
  } }
} satisfies Prisma.CorporateActionInclude;

export function serializeAction(action: Prisma.CorporateActionGetPayload<{ include: typeof actionInclude }>) {
  return { ...action, redemptionPriceMinor: action.redemptionPriceMinor?.toString() ?? null,
    totalEntitlementMinor: action.totalEntitlementMinor.toString(),
    blockchainTransactions: action.blockchainTransactions.map(({ preparedPayload, ...operation }) => ({ ...operation,
      reason: preparedPayload && typeof preparedPayload === "object" && !Array.isArray(preparedPayload) &&
        typeof preparedPayload["reason"] === "string" ? preparedPayload["reason"] : null })),
    snapshot: action.snapshot ? {
      ...action.snapshot, solanaSlot: action.snapshot.solanaSlot.toString(),
      snapshotHash: Buffer.from(action.snapshot.snapshotHash).toString("hex"), totalBalance: action.snapshot.totalBalance.toString()
    } : null };
}
export function actionInput(body: unknown, allowed: readonly string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !allowed.includes(key))) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "A JSON object with supported fields is required", 400);
  }
  return body as Record<string, unknown>;
}
export function actionText(value: unknown, field: string, max: number, required = true): string | null {
  if (!required && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TransactionWorkflowError("INVALID_REQUEST", `${field} must contain 3 to ${max} characters`, 400);
  }
  return value.trim();
}
function utcSeconds(value: unknown, field: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$/.test(value)) {
    throw new TransactionWorkflowError("INVALID_REQUEST", `${field} must be an exact UTC timestamp in whole seconds`, 400);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) {
    throw new TransactionWorkflowError("INVALID_REQUEST", `${field} is invalid`, 400);
  }
  return parsed;
}
export function requireFutureAction(recordAt: Date, now: Date) {
  if (recordAt.getTime() < now.getTime() + MIN_ACTION_LEAD_SECONDS * 1000) {
    throw new TransactionWorkflowError("ACTION_RECORD_TOO_SOON", "Record time must be at least 60 seconds ahead; create a new draft if this one has expired");
  }
}
export function requireActionIssuer(instrument: { issuerAuthority: string }, actor: InstrumentActor) {
  if (instrument.issuerAuthority !== actor.walletAddress) throw new TransactionWorkflowError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
}
export function workflowDatabaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
    throw new TransactionWorkflowError("ACTION_CONFLICT", "Concurrent action change; reload before continuing");
  }
  throw error;
}

export async function getCorporateAction(database: PrismaClient, id: string) {
  if (!WORKFLOW_UUID.test(id)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action UUID is invalid", 400);
  const row = await database.corporateAction.findUnique({ where: { id }, include: actionInclude });
  if (!row) throw new TransactionWorkflowError("ACTION_NOT_FOUND", "Corporate action was not found", 404);
  const events = await database.auditLog.findMany({ where: { corporateActionId: id }, orderBy: { createdAt: "asc" }, take: 100,
    select: { id: true, event: true, actorId: true, actorWallet: true, createdAt: true, metadataJson: true } });
  return { ...serializeAction(row), events };
}
export async function listCorporateActions(database: PrismaClient, query: { instrumentId?: string | undefined; limit?: string | undefined; cursor?: string | undefined }) {
  if (query.instrumentId !== undefined && !WORKFLOW_UUID.test(query.instrumentId) ||
      query.cursor !== undefined && !WORKFLOW_UUID.test(query.cursor) ||
      query.limit !== undefined && !/^[1-9][0-9]{0,2}$/.test(query.limit)) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Action filters or pagination are invalid", 400);
  }
  const take = query.limit === undefined ? 20 : Number(query.limit);
  if (take > 100) throw new TransactionWorkflowError("INVALID_REQUEST", "Limit must be 1 to 100", 400);
  const rows = await database.corporateAction.findMany({ include: actionInclude, take: take + 1,
    where: query.instrumentId ? { instrumentId: query.instrumentId } : {}, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  return { items: rows.slice(0, take).map(serializeAction), nextCursor: rows.length > take ? rows[take - 1]!.id : null };
}

/** requestId is the stable action UUID; a lost response can be retried without creating another draft. */
export async function createCorporateActionDraft(database: PrismaClient, body: unknown, actor: InstrumentActor,
  network = instrumentNetworkFromEnvironment(), now = new Date()) {
  const input = actionInput(body, ["requestId", "instrumentId", "type", "intent", "sourceType", "sourceReference",
    "sourceDocument", "sourceTimestamp", "recordAt", "executeAt", "redemptionPercentageBps", "redemptionPriceKzt"]);
  const id = input["requestId"]; const instrumentId = input["instrumentId"];
  if (typeof id !== "string" || !WORKFLOW_UUID.test(id) || typeof instrumentId !== "string" || !WORKFLOW_UUID.test(instrumentId)) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Request and instrument UUIDs are required", 400);
  }
  const type = input["type"] as CorporateActionType;
  if (!ACTION_TYPES.includes(type)) throw new TransactionWorkflowError("INVALID_REQUEST", "Action type is unsupported", 400);
  const sourceType = input["sourceType"] ?? "MANUAL";
  if (!SOURCES.includes(sourceType as typeof SOURCES[number])) throw new TransactionWorkflowError("INVALID_REQUEST", "Source type is unsupported", 400);
  const intent = actionText(input["intent"], "Intent", 500)!;
  const recordAt = utcSeconds(input["recordAt"], "Record time"); const executeAt = utcSeconds(input["executeAt"], "Execution time");
  const sourceReference = actionText(input["sourceReference"], "Source reference", 250, false);
  const sourceDocument = actionText(input["sourceDocument"], "Source document", 500, false);
  const sourceTimestamp = input["sourceTimestamp"] == null ? null : utcSeconds(input["sourceTimestamp"], "Source timestamp");
  let redemptionPercentageBps: number | null = null; let redemptionPriceMinor: bigint | null = null;
  if (type === "EARLY_REDEMPTION") {
    const percent = input["redemptionPercentageBps"]; const price = input["redemptionPriceKzt"];
    if (!Number.isSafeInteger(percent) || (percent as number) < 1 || (percent as number) > 10_000 ||
        typeof price !== "string" || !/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(price)) {
      throw new TransactionWorkflowError("INVALID_REQUEST", "Early redemption requires 1 to 10000 bps and a positive KZT-Test price with up to six decimals", 400);
    }
    const [whole, fraction = ""] = price.split(".");
    redemptionPercentageBps = percent as number; redemptionPriceMinor = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
    if (redemptionPriceMinor < 1n || redemptionPriceMinor > (1n << 63n) - 1n) throw new TransactionWorkflowError("INVALID_REQUEST", "Redemption price is outside the database range", 400);
  } else if (input["redemptionPercentageBps"] != null || input["redemptionPriceKzt"] != null) {
    throw new TransactionWorkflowError("INVALID_REQUEST", "Redemption parameters are only allowed for early redemption", 400);
  }
  const data = { id, instrumentId, type, intent, sourceType: sourceType as typeof SOURCES[number], sourceReference,
    sourceDocument, sourceTimestamp, recordAt, executeAt, redemptionPercentageBps, redemptionPriceMinor, createdById: actor.id };
  const sameDraft = (existing: Prisma.CorporateActionGetPayload<{ include: typeof actionInclude }>) => {
    if (Object.entries(data).some(([key, value]) => {
      const actual = existing[key as keyof typeof existing];
      return value instanceof Date ? !(actual instanceof Date) || actual.getTime() !== value.getTime() : actual !== value;
    })) throw new TransactionWorkflowError("ACTION_CONFLICT", "Request UUID already belongs to a different draft");
    return serializeAction(existing);
  };
  try {
    return await database.$transaction(async tx => {
      const instrument = await tx.instrument.findUnique({ where: { id: instrumentId } });
      if (!instrument) throw new TransactionWorkflowError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
      requireActionIssuer(instrument, actor);
      const existing = await tx.corporateAction.findUnique({ where: { id }, include: actionInclude });
      if (existing) return sameDraft(existing);
      if (instrument.status !== "ACTIVE" || !instrument.programId || !instrument.mintAddress || instrument.network !== network) {
        throw new TransactionWorkflowError("INSTRUMENT_NOT_ACTIVE", "An ACTIVE instrument on the configured network is required");
      }
      requireFutureAction(recordAt, now);
      if (recordAt < instrument.issueAt || recordAt > executeAt ||
          type === "COUPON_PAYMENT" && executeAt > instrument.maturityAt ||
          type === "BOND_REDEMPTION" && executeAt < instrument.maturityAt ||
          type === "EARLY_REDEMPTION" && executeAt >= instrument.maturityAt) {
        throw new TransactionWorkflowError("INVALID_ACTION_DATES", "Action dates do not match the instrument terms", 400);
      }
      const row = await tx.corporateAction.create({ data, include: actionInclude });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "CORPORATE_ACTION_DRAFT_CREATED", entityType: "CorporateAction", entityId: id, corporateActionId: id,
        metadataJson: { instrumentId, type, sourceType: data.sourceType, intent, recordAt: recordAt.toISOString(), executeAt: executeAt.toISOString(), onChain: false } } });
      return serializeAction(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      const existing = await database.corporateAction.findUnique({ where: { id }, include: actionInclude });
      if (existing) { requireActionIssuer(existing.instrument, actor); return sameDraft(existing); }
    }
    return workflowDatabaseError(error);
  }
}

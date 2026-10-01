import { Prisma, type PrismaClient } from "@prisma/client";
import { decodePublicKey } from "@lifecycle-kase/solana-client";

export const REGISTRY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class InvestorRegistryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "InvestorRegistryError";
  }
}
export type RegistryActor = { id: string; walletAddress: string; correlationId: string };
const walletSelect = { id: true, address: true, network: true, status: true, verifiedAt: true, revokedAt: true } as const;
const investorSelect = {
  id: true, externalReference: true, displayName: true, type: true, countryCode: true,
  kycStatus: true, eligibilityStatus: true, status: true, createdAt: true,
  _count: { select: { wallets: true } },
  wallets: { select: walletSelect, take: 20, orderBy: { id: "asc" as const } }
} satisfies Prisma.InvestorSelect;

function invalid(message: string): never {
  throw new InvestorRegistryError("INVALID_REQUEST", message, 400);
}
function payload(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("A JSON object is required");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Unsupported request field");
  return value;
}
function text(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(`${field} must contain 1 to ${max} characters without control characters`);
  }
  return value.trim();
}
function databaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") throw new InvestorRegistryError("REGISTRY_CONFLICT", "Reference or wallet is already registered", 409);
    if (error.code === "P2034") throw new InvestorRegistryError("REGISTRY_CONFLICT", "Concurrent change; refresh before retrying", 409);
  }
  throw error;
}

export async function listInvestors(database: PrismaClient, limit: unknown, cursor: unknown) {
  if (limit !== undefined && (typeof limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(limit))) invalid("Limit must be an integer between 1 and 100");
  const take = limit === undefined ? 20 : Number(limit);
  if (take > 100) invalid("Limit must be an integer between 1 and 100");
  if (cursor !== undefined && (typeof cursor !== "string" || !REGISTRY_UUID.test(cursor))) invalid("Cursor must be an investor UUID");
  const rows = await database.investor.findMany({
    select: investorSelect, take: take + 1, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(typeof cursor === "string" ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const items = rows.slice(0, take);
  return { items, nextCursor: rows.length > take ? items.at(-1)!.id : null };
}

export async function createInvestor(database: PrismaClient, body: unknown, actor: RegistryActor) {
  const input = payload(body, ["displayName", "type", "countryCode", "externalReference"]);
  const displayName = text(input["displayName"], 200, "Display name");
  const countryCode = text(input["countryCode"], 2, "Country code").toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) invalid("Country code must contain two ASCII letters");
  const type = input["type"];
  if (type !== "INDIVIDUAL" && type !== "INSTITUTIONAL") invalid("Investor type is invalid");
  const externalReference = input["externalReference"] === undefined ? undefined : text(input["externalReference"], 100, "External reference");
  try {
    return await database.$transaction(async tx => {
      const investor = await tx.investor.create({
        data: { displayName, countryCode, type, kycStatus: "NOT_STARTED", eligibilityStatus: "PENDING_REVIEW",
          ...(externalReference === undefined ? {} : { externalReference }) },
        select: investorSelect
      });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        correlationId: actor.correlationId, event: "INVESTOR_CREATED", entityType: "Investor", entityId: investor.id,
        metadataJson: { source: "administrator-api", kycStatus: "NOT_STARTED", eligibilityStatus: "PENDING_REVIEW" } } });
      return investor;
    }, { isolationLevel: "Serializable" });
  } catch (error) { databaseError(error); }
}

export async function attachPendingWallet(database: PrismaClient, investorId: string, body: unknown, actor: RegistryActor) {
  if (!REGISTRY_UUID.test(investorId)) invalid("Investor ID must be a UUID");
  const input = payload(body, ["address"]);
  const address = text(input["address"], 44, "Wallet address");
  try { decodePublicKey(address); } catch { invalid("Wallet address must be a Solana public key"); }
  try {
    return await database.$transaction(async tx => {
      const investor = await tx.investor.findUnique({ where: { id: investorId }, select: { status: true } });
      if (!investor) throw new InvestorRegistryError("INVESTOR_NOT_FOUND", "Investor not found", 404);
      if (investor.status !== "ACTIVE") throw new InvestorRegistryError("INVESTOR_INACTIVE", "Investor is not active", 409);
      if (await tx.wallet.findUnique({ where: { address }, select: { id: true } })) {
        throw new InvestorRegistryError("REGISTRY_CONFLICT", "Wallet is already registered; ownership cannot be reassigned", 409);
      }
      const wallet = await tx.wallet.create({ data: { address, investorId, network: "SOLANA_LOCALNET",
        status: "PENDING", verifiedAt: null, revokedAt: null }, select: walletSelect });
      await tx.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        correlationId: actor.correlationId, event: "INVESTOR_WALLET_ATTACHED", entityType: "Investor", entityId: investorId,
        metadataJson: { walletId: wallet.id, network: "SOLANA_LOCALNET", status: "PENDING" } } });
      return wallet;
    }, { isolationLevel: "Serializable" });
  } catch (error) { databaseError(error); }
}

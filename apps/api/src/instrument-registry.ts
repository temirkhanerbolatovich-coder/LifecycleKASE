import { Prisma, type PrismaClient } from "@prisma/client";
import { decodePublicKey } from "@lifecycle-kase/solana-client";
import { CONTROLLED_TOKEN_POLICY, ControlledRegistryError, controlledRegistryEnabled, LEGACY_TOKEN_POLICY, requireControlledRegistry } from "./controlled-policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCLAIMER = "SIMULATED ASSET. Not issued by the National Bank of Kazakhstan.";
const MINOR_UNITS_PER_KZT = 1_000_000n;
const MAX_FACE_VALUE_KZT = 9_223_372_036_854n;

export class InstrumentRegistryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "InstrumentRegistryError";
  }
}

export type InstrumentActor = { id: string; walletAddress: string; correlationId: string };

const instrumentSelect = {
  id: true, name: true, ticker: true, assetType: true, network: true, programId: true, mintAddress: true,
  issuerAuthority: true, complianceAuthority: true, corporateActionAuthority: true, tokenPolicy: true,
  faceValueMinor: true, currency: true, settlementDecimals: true, couponRateBps: true,
  paymentsPerYear: true, issueAt: true, maturityAt: true, totalSupply: true, circulatingSupply: true,
  status: true, createdAt: true,
  blockchainTransactions: { where: { operationType: "INSTRUMENT_MINT_SETUP", status: "FINALIZED" },
    orderBy: { createdAt: "desc" }, take: 1, select: { networkGenesisHash: true } },
  issuer: { select: { id: true, legalName: true } },
  settlementAsset: { select: { id: true, code: true, name: true, network: true, mintAddress: true,
    decimals: true, isSimulated: true, disclaimer: true } }
} satisfies Prisma.InstrumentSelect;

function invalid(message: string): never {
  throw new InstrumentRegistryError("INVALID_REQUEST", message, 400);
}

function objectPayload(body: unknown): Record<string, unknown> {
  const allowed = ["issuerLegalName", "name", "ticker", "faceValueKzt", "couponRateBps",
    "paymentsPerYear", "issueAt", "maturityAt", "tokenPolicy"];
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("A JSON object is required");
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Unsupported request field");
  return value;
}

function requiredText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) invalid(`${field} must contain 2 to ${max} characters`);
  return value.trim();
}

function utcDate(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.endsWith("Z")) invalid(`${field} must be a UTC timestamp`);
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) invalid(`${field} must be a valid UTC timestamp`);
  return result;
}

function serializeInstrument(instrument: Prisma.InstrumentGetPayload<{ select: typeof instrumentSelect }>) {
  const { blockchainTransactions, ...details } = instrument;
  return {
    ...details, networkGenesisHash: blockchainTransactions?.[0]?.networkGenesisHash ?? null,
    faceValueMinor: instrument.faceValueMinor.toString(),
    totalSupply: instrument.totalSupply.toString(),
    circulatingSupply: instrument.circulatingSupply.toString()
  };
}

function databaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new InstrumentRegistryError("INSTRUMENT_CONFLICT", "Issuer or ticker is already registered", 409);
    }
    if (error.code === "P2034") {
      throw new InstrumentRegistryError("INSTRUMENT_CONFLICT", "Concurrent change; refresh before retrying", 409);
    }
  }
  throw error;
}

export function instrumentNetworkFromEnvironment(environment: NodeJS.ProcessEnv = process.env): "SOLANA_LOCALNET" | "SOLANA_DEVNET" {
  const cluster = environment.SOLANA_CLUSTER || "localnet";
  if (cluster !== "localnet" && cluster !== "devnet") {
    throw new InstrumentRegistryError("INSTRUMENT_CONFIGURATION_INVALID", "SOLANA_CLUSTER must be localnet or devnet", 503);
  }
  const expected = cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET";
  if (environment.WALLET_NETWORK !== undefined && environment.WALLET_NETWORK !== expected) {
    throw new InstrumentRegistryError("INSTRUMENT_CONFIGURATION_INVALID", `WALLET_NETWORK must be ${expected}`, 503);
  }
  return expected;
}

export async function listInstruments(database: PrismaClient, limit: unknown, cursor: unknown) {
  if (limit !== undefined && (typeof limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(limit))) {
    invalid("Limit must be an integer between 1 and 100");
  }
  const take = limit === undefined ? 20 : Number(limit);
  if (take > 100) invalid("Limit must be an integer between 1 and 100");
  if (cursor !== undefined && (typeof cursor !== "string" || !UUID.test(cursor))) invalid("Cursor must be an instrument UUID");
  const rows = await database.instrument.findMany({
    select: instrumentSelect, take: take + 1, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(typeof cursor === "string" ? { cursor: { id: cursor }, skip: 1 } : {})
  });
  const page = rows.slice(0, take);
  const enabled = controlledRegistryEnabled();
  const candidateEnabled = enabled && (process.env.SOLANA_CLUSTER || "localnet") === "localnet" &&
    process.env.PROGRAM_ID === "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo" && Boolean(process.env.SOLANA_GENESIS_HASH);
  return { items: page.map(serializeInstrument), nextCursor: rows.length > take ? page.at(-1)!.id : null,
    controlledRegistryEnabled: candidateEnabled,
    controlledProgramId: candidateEnabled ? process.env.PROGRAM_ID! : null,
    controlledNetworkGenesisHash: candidateEnabled ? process.env.SOLANA_GENESIS_HASH! : null };
}

export async function createInstrumentDraft(
  database: PrismaClient,
  body: unknown,
  actor: InstrumentActor,
  network = instrumentNetworkFromEnvironment()
) {
  if (!UUID.test(actor.id) || !UUID.test(actor.correlationId)) invalid("Actor or correlation identifier is invalid");
  try { decodePublicKey(actor.walletAddress); } catch { invalid("Actor wallet must be a Solana public key"); }
  const input = objectPayload(body);
  const tokenPolicy = input["tokenPolicy"] ?? LEGACY_TOKEN_POLICY;
  if (tokenPolicy !== LEGACY_TOKEN_POLICY && tokenPolicy !== CONTROLLED_TOKEN_POLICY) invalid("Token policy is unsupported");
  if (tokenPolicy === CONTROLLED_TOKEN_POLICY) {
    try {
      if (network !== "SOLANA_LOCALNET") throw new ControlledRegistryError("CONTROLLED_REGISTRY_DISABLED", "Controlled instruments require Localnet", 503);
      requireControlledRegistry({ tokenPolicy }, { cluster: "localnet", programId: process.env.PROGRAM_ID || "",
        controlledRegistryEnabled: controlledRegistryEnabled() });
    } catch (error) {
      if (error instanceof ControlledRegistryError) throw new InstrumentRegistryError(error.code, error.message, error.status);
      throw error;
    }
  }
  const issuerLegalName = requiredText(input["issuerLegalName"], 250, "Issuer legal name");
  const name = requiredText(input["name"], 250, "Instrument name");
  const ticker = requiredText(input["ticker"], 20, "Ticker").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{1,19}$/.test(ticker)) invalid("Ticker must use 2 to 20 uppercase letters, digits, dots or hyphens");
  if (typeof input["faceValueKzt"] !== "string" || !/^[1-9][0-9]{0,12}$/.test(input["faceValueKzt"])) {
    invalid("Face value must be a positive whole KZT-Test amount");
  }
  const faceValueKzt = BigInt(input["faceValueKzt"]);
  if (faceValueKzt > MAX_FACE_VALUE_KZT) invalid("Face value is too large");
  const couponRateBps = input["couponRateBps"];
  if (!Number.isSafeInteger(couponRateBps) || (couponRateBps as number) < 0 || (couponRateBps as number) > 100_000) {
    invalid("Coupon rate must be an integer between 0 and 100000 bps");
  }
  const paymentsPerYear = input["paymentsPerYear"];
  if (paymentsPerYear !== 1 && paymentsPerYear !== 2 && paymentsPerYear !== 4) invalid("Payments per year must be 1, 2 or 4");
  const issueAt = utcDate(input["issueAt"], "Issue date");
  const maturityAt = utcDate(input["maturityAt"], "Maturity date");
  if (tokenPolicy === CONTROLLED_TOKEN_POLICY && (issueAt.getTime() % 1000 !== 0 || maturityAt.getTime() % 1000 !== 0)) {
    invalid("Controlled issuance dates must use whole UTC seconds");
  }
  if (issueAt >= maturityAt) invalid("Maturity date must be after issue date");

  try {
    const created = await database.$transaction(async transaction => {
      let settlementAsset = await transaction.settlementAsset.findUnique({ where: { code: "KZT_TEST" } });
      if (!settlementAsset) {
        settlementAsset = await transaction.settlementAsset.create({ data: {
          code: "KZT_TEST", name: "KZT-Test", network, decimals: 6, isSimulated: true,
          disclaimer: DISCLAIMER, active: true
        } });
      } else if (settlementAsset.network !== network || settlementAsset.decimals !== 6 ||
          !settlementAsset.isSimulated || settlementAsset.disclaimer !== DISCLAIMER || !settlementAsset.active) {
        throw new InstrumentRegistryError(
          "SETTLEMENT_ASSET_CONFLICT", "Existing KZT-Test configuration does not match this environment", 409
        );
      }
      const issuer = await transaction.issuer.upsert({
        where: { legalName: issuerLegalName }, update: {}, create: { legalName: issuerLegalName }
      });
      const instrument = await transaction.instrument.create({
        data: {
          issuerId: issuer.id, settlementAssetId: settlementAsset.id, name, ticker, network,
          issuerAuthority: actor.walletAddress, complianceAuthority: actor.walletAddress,
          corporateActionAuthority: actor.walletAddress, faceValueMinor: faceValueKzt * MINOR_UNITS_PER_KZT,
          couponRateBps: couponRateBps as number, paymentsPerYear, issueAt, maturityAt,
          totalSupply: 35n, circulatingSupply: 0n, status: "DRAFT", tokenPolicy
        },
        select: instrumentSelect
      });
      await transaction.auditLog.create({ data: {
        actorId: actor.id, actorWallet: actor.walletAddress, correlationId: actor.correlationId,
        event: "INSTRUMENT_DRAFT_CREATED", entityType: "Instrument", entityId: instrument.id,
        metadataJson: { ticker, network, status: "DRAFT", totalSupply: "35", onChain: false }
      } });
      return instrument;
    }, { isolationLevel: "Serializable" });
    return serializeInstrument(created);
  } catch (error) {
    if (error instanceof InstrumentRegistryError) throw error;
    databaseError(error);
  }
}

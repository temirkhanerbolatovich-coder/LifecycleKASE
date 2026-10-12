import type { PrismaClient } from "@prisma/client";
import {
  BOND_MINT_SIZE,
  CONTROLLED_BOND_MINT_SIZE,
  buildControlledMintSetup, buildControlledInstrumentInitialization, buildControlledInstrumentActivation,
  buildControlledHoldingRegistration, buildControlledTransfer, createAssociatedTokenAccountIdempotent,
  decodeControlledTokenPosition, decodeControlledPolicy, decodeControlledHolding,
  deriveControlledPolicyAddress, deriveControlledHoldingAddress,
  buildInstrumentActivation,
  buildInstrumentDistribution,
  buildInstrumentInitialization,
  buildInstrumentMintSetup,
  decodeConfirmedInstrumentAccount,
  decodePublicKey,
  deriveInstrumentLifecycleAddresses,
  encodePublicKey,
  serializeUnsignedInstructionsTransaction,
  SETTLEMENT_MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  verifyFinalizedTransaction,
  verifySignedPreparedTransaction,
  type SolanaRpc
} from "@lifecycle-kase/solana-client";

import type { InstrumentActor } from "./instrument-registry.js";
import { uuidBytes } from "./snapshot-registration.js";
import { CONTROLLED_TOKEN_POLICY, controlledRegistryEnabled, requireControlledRegistry } from "./controlled-policy.js";
export { controlledRegistryEnabled, requireControlledRegistry } from "./controlled-policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CONFIRMABLE = ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"] as const;

type StoredMintSetupAttempt = {
  id: string;
  status: string;
  signature?: string | null;
  lastErrorCode?: string | null;
  preparedTransactionBase64: string | null;
  requiredSigner: string | null;
  networkGenesisHash: string | null;
  recentBlockhash: string | null;
  lastValidBlockHeight: bigint | null;
  preparedPayload?: unknown;
  instrument?: { issuerAuthority: string; tokenPolicy?: string } | null;
};

type DistributionAllocation = {
  investorId: string;
  walletAddress: string;
  tokenAccount: string;
  amount: string;
};

type DistributionPayload = {
  bondMint: string;
  treasuryTokenAccount: string;
  allocations: DistributionAllocation[];
};

type InitializationPayload = { instrumentAddress: string };
type ActivationPayload = { instrumentAddress: string; allocations: DistributionAllocation[] };
export type InstrumentDeploymentPhase = "MINT_SETUP" | "DISTRIBUTION" | "INITIALIZE" | "ACTIVATE";

const OPERATION_TYPE_BY_PHASE: Record<InstrumentDeploymentPhase, string> = {
  MINT_SETUP: "INSTRUMENT_MINT_SETUP",
  DISTRIBUTION: "INSTRUMENT_DISTRIBUTION",
  INITIALIZE: "INSTRUMENT_INITIALIZE",
  ACTIVATE: "INSTRUMENT_ACTIVATE"
};

type DeploymentInstrument = NonNullable<Awaited<ReturnType<typeof readDeploymentInstrument>>>;

async function readDeploymentInstrument(database: PrismaClient, instrumentId: string) {
  return database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
}

async function controlledMetadata(instrument: DeploymentInstrument, options: InstrumentDeploymentOptions) {
  if (!requireControlledRegistry(instrument, options)) return {};
  const plan = await buildControlledMintSetup({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
    administrator: instrument.issuerAuthority, bondRentLamports: 1n, settlementRentLamports: 1n, totalSupply: instrument.totalSupply });
  return { tokenPolicy: CONTROLLED_TOKEN_POLICY, programId: options.programId, instrumentId: instrument.id,
    bondMint: plan.bondMint, settlementMint: plan.settlementMint, treasuryTokenAccount: plan.treasuryTokenAccount,
    instrumentAddress: plan.instrumentAddress, controlledPolicyAddress: await deriveControlledPolicyAddress(options.programId, plan.instrumentAddress),
    terms: { issuerAuthority: instrument.issuerAuthority, complianceAuthority: instrument.complianceAuthority,
      corporateActionAuthority: instrument.corporateActionAuthority, faceValueMinor: instrument.faceValueMinor.toString(),
      couponRateBps: instrument.couponRateBps, paymentsPerYear: instrument.paymentsPerYear,
      issueAt: instrument.issueAt.toISOString(), maturityAt: instrument.maturityAt.toISOString(), totalSupply: instrument.totalSupply.toString() } };
}

function resumeControlledMetadata(attempt: StoredMintSetupAttempt, options: InstrumentDeploymentOptions) {
  if (attempt.instrument) requireControlledRegistry(attempt.instrument, options);
  const payload = attempt.preparedPayload;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "tokenPolicy" in payload) {
    const value = payload as Record<string, unknown>;
    requireControlledRegistry({ tokenPolicy: String(value["tokenPolicy"]) }, options);
    if (value["programId"] !== options.programId) throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored controlled program identity is invalid");
    return value;
  }
  return {};
}

export class InstrumentDeploymentError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message); this.name = "InstrumentDeploymentError";
  }
}

export type InstrumentDeploymentOptions = {
  cluster: "localnet" | "devnet";
  rpcEndpoint: string;
  rpcTimeoutMs: number;
  expectedGenesisHash: string;
  programId: string;
  controlledRegistryEnabled?: boolean;
};

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new InstrumentDeploymentError("INSTRUMENT_CONFIGURATION_INVALID", `${name} must be positive`, 503);
  return parsed;
}

export function instrumentDeploymentOptions(environment: NodeJS.ProcessEnv = process.env): InstrumentDeploymentOptions {
  const cluster = environment.SOLANA_CLUSTER || "localnet";
  if (cluster !== "localnet" && cluster !== "devnet") throw new InstrumentDeploymentError("INSTRUMENT_CONFIGURATION_INVALID", "SOLANA_CLUSTER must be localnet or devnet", 503);
  const expectedGenesisHash = environment.SOLANA_GENESIS_HASH;
  const programId = environment.PROGRAM_ID;
  const rpcEndpoint = environment.SOLANA_RPC_URL;
  try {
    if (!expectedGenesisHash || !programId) throw new Error("missing");
    decodePublicKey(expectedGenesisHash); decodePublicKey(programId);
  } catch { throw new InstrumentDeploymentError("INSTRUMENT_CONFIGURATION_INVALID", "SOLANA_GENESIS_HASH and PROGRAM_ID must be valid public keys", 503); }
  if (!rpcEndpoint) throw new InstrumentDeploymentError("INSTRUMENT_CONFIGURATION_INVALID", "SOLANA_RPC_URL is required", 503);
  const expectedNetwork = cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET";
  if (environment.WALLET_NETWORK !== undefined && environment.WALLET_NETWORK !== expectedNetwork) {
    throw new InstrumentDeploymentError("INSTRUMENT_CONFIGURATION_INVALID", `WALLET_NETWORK must be ${expectedNetwork}`, 503);
  }
  const enabled = controlledRegistryEnabled(environment);
  if (enabled) requireControlledRegistry({ tokenPolicy: CONTROLLED_TOKEN_POLICY }, { cluster, programId, controlledRegistryEnabled: enabled });
  return { cluster, rpcEndpoint, expectedGenesisHash, programId, ...(enabled ? { controlledRegistryEnabled: true } : {}),
    rpcTimeoutMs: positiveInteger(environment.SOLANA_RPC_TIMEOUT_MS, 15_000, "SOLANA_RPC_TIMEOUT_MS") };
}

/**
 * Broadcasts an exact wallet-signed prepared transaction through the trusted Localnet RPC.
 * Localnet wallets sign, but the API owns transport because browser wallets do not expose
 * an arbitrary Localnet RPC. The prepared message, signer, and Ed25519 signature are all
 * verified before the RPC receives any bytes.
 */
export async function submitInstrumentDeployment(
  database: PrismaClient,
  rpc: SolanaRpc,
  instrumentId: string,
  operationId: string,
  phase: InstrumentDeploymentPhase,
  signedTransactionBase64: string,
  actor: InstrumentActor,
  options: InstrumentDeploymentOptions,
  now = new Date()
) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) ||
      typeof signedTransactionBase64 !== "string" || signedTransactionBase64.length > 2_000) {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signed transaction is invalid", 400);
  }
  if (options.cluster !== "localnet") {
    throw new InstrumentDeploymentError("TRUSTED_BROADCAST_NOT_AVAILABLE", "API broadcast is available only for Localnet", 409);
  }
  const operation = await database.blockchainTransaction.findUnique({
    where: { id: operationId }, include: { instrument: true }
  });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId ||
      operation.operationType !== OPERATION_TYPE_BY_PHASE[phase]) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Deployment attempt was not found", 404);
  }
  requireControlledRegistry(instrument, options);
  if (actor.walletAddress !== instrument.issuerAuthority || operation.requiredSigner !== actor.walletAddress) {
    throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (operation.status === "FINALIZED") {
    if (!operation.signature) throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Finalized deployment signature is missing");
    return { operationId, phase, signature: operation.signature, status: "FINALIZED" as const };
  }
  if (!CONFIRMABLE.includes(operation.status as typeof CONFIRMABLE[number]) ||
      !operation.preparedTransactionBase64 || operation.networkGenesisHash !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("DEPLOYMENT_NOT_SUBMITTABLE", "Deployment attempt is not submittable");
  }
  let transactionSignature: string;
  try {
    transactionSignature = verifySignedPreparedTransaction({
      expectedUnsignedTransactionBase64: operation.preparedTransactionBase64,
      signedTransactionBase64,
      requiredSigner: actor.walletAddress
    });
  } catch {
    throw new InstrumentDeploymentError("SIGNED_TRANSACTION_INVALID",
      "Signed transaction does not match the prepared transaction or signer", 400);
  }
  if (operation.signature && operation.signature !== transactionSignature) {
    throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Deployment attempt already has another signature");
  }
  if (await rpc.request("getGenesisHash", []) !== operation.networkGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Submission RPC is on another network", 503);
  }
  await database.$transaction(async transaction => {
    const updated = await transaction.blockchainTransaction.updateMany({
      where: { id: operationId, status: { in: [...CONFIRMABLE] },
        OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "SUBMITTED", submittedAt: now, lastErrorCode: null }
    });
    if (updated.count !== 1) {
      throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Deployment state changed concurrently");
    }
    await transaction.auditLog.create({ data: {
      actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_TRANSACTION_SUBMISSION_REQUESTED", entityType: "BlockchainTransaction",
      entityId: operationId, correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { instrumentId, phase, signature: transactionSignature, cluster: options.cluster }
    } });
  });
  let rpcSignature: unknown;
  try {
    rpcSignature = await rpc.request("sendTransaction", [signedTransactionBase64, {
      encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3
    }]);
  } catch (error) {
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: "SUBMITTED",
      signature: transactionSignature }, data: { status: "UNKNOWN_CONFIRMATION", lastErrorCode: "SUBMISSION_RESPONSE_UNKNOWN" } });
    throw error;
  }
  if (rpcSignature !== transactionSignature) {
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: "SUBMITTED",
      signature: transactionSignature }, data: { status: "UNKNOWN_CONFIRMATION", lastErrorCode: "INVALID_RPC_RESPONSE" } });
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Submission RPC returned another signature", 503);
  }
  return { operationId, phase, signature: transactionSignature, status: "SUBMITTED" as const };
}

function object(value: unknown, message = "Solana RPC response is invalid"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", message, 503);
  return value as Record<string, unknown>;
}

function safeNumber(value: unknown, message = "Solana RPC numeric value is invalid"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", message, 503);
  return value as number;
}

async function recordUnavailableTransaction(database: PrismaClient, rpc: SolanaRpc,
  operation: { id: string; recentBlockhash?: string | null }, transactionSignature: string): Promise<never> {
  const response = object(await rpc.request("getSignatureStatuses", [[transactionSignature], { searchTransactionHistory: true }]));
  const values = response["value"];
  if (!Array.isArray(values) || values.length !== 1) {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Signature status response is invalid", 503);
  }
  let code = "TRANSACTION_NOT_FINALIZED";
  if (values[0] !== null && object(values[0])["confirmationStatus"] === "finalized") {
    code = "TRANSACTION_HISTORY_UNAVAILABLE";
  } else if (values[0] === null && operation.recentBlockhash) {
    const validity = object(await rpc.request("isBlockhashValid", [operation.recentBlockhash, { commitment: "finalized" }]));
    if (typeof validity["value"] !== "boolean") {
      throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Blockhash validity response is invalid", 503);
    }
    if (!validity["value"]) code = "TRANSACTION_UNAVAILABLE";
  }
  // Missing history cannot prove failure: the transaction may already have changed accounts.
  const updated = await database.blockchainTransaction.updateMany({ where: { id: operation.id, status: { in: [...CONFIRMABLE] },
    OR: [{ signature: null }, { signature: transactionSignature }] },
    data: { signature: transactionSignature, status: "UNKNOWN_CONFIRMATION", lastErrorCode: code } });
  if (updated.count !== 1) {
    throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Deployment state changed concurrently");
  }
  throw new InstrumentDeploymentError(code, code === "TRANSACTION_NOT_FINALIZED"
    ? "Transaction is not finalized yet"
    : "Transaction bytes are unavailable; reconcile RPC history and on-chain state before any new submission");
}

function preparedResponse(existing: StoredMintSetupAttempt, cluster: "localnet" | "devnet", options?: InstrumentDeploymentOptions) {
  if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
      !existing.recentBlockhash || existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored mint setup attempt is incomplete");
  }
  return { operationId: existing.id, phase: "MINT_SETUP" as const, cluster,
    signature: existing.signature ?? null, status: existing.status,
    requiredSigner: existing.requiredSigner, networkGenesisHash: existing.networkGenesisHash,
    recentBlockhash: existing.recentBlockhash, lastValidBlockHeight: Number(existing.lastValidBlockHeight),
    serializedTransactionBase64: existing.preparedTransactionBase64,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    ...(options ? resumeControlledMetadata(existing, options) : {}), resumed: true };
}

async function activeAttemptCanResume(
  database: PrismaClient,
  rpc: SolanaRpc,
  existing: StoredMintSetupAttempt,
  expectedGenesisHash: string
): Promise<boolean> {
  if (existing.networkGenesisHash !== expectedGenesisHash) {
    await database.blockchainTransaction.updateMany({
      where: { id: existing.id, status: { in: [...CONFIRMABLE] } },
      data: { status: "FAILED", lastErrorCode: "NETWORK_GENESIS_CHANGED" }
    });
    return false;
  }
  if (existing.lastErrorCode === "TRANSACTION_UNAVAILABLE" || existing.lastErrorCode === "TRANSACTION_HISTORY_UNAVAILABLE") {
    throw new InstrumentDeploymentError("TRANSACTION_HISTORY_UNAVAILABLE",
      "Reconcile the existing transaction and on-chain state before preparing another attempt");
  }
  if (existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored deployment attempt is incomplete");
  }
  const currentHeight = safeNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }]));
  if (currentHeight <= Number(existing.lastValidBlockHeight)) return true;

  if (existing.status !== "PREPARED" && existing.signature) {
    const result = object(await rpc.request("getSignatureStatuses", [
      [existing.signature],
      { searchTransactionHistory: true }
    ]));
    const values = result["value"];
    if (!Array.isArray(values) || values.length !== 1) {
      throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Signature status response is invalid", 503);
    }
    if (values[0] !== null) return true;
  }

  await database.blockchainTransaction.updateMany({
    where: { id: existing.id, status: { in: [...CONFIRMABLE] } },
    data: { status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED_UNCONFIRMED" }
  });
  return false;
}

function distributionPayload(value: unknown): DistributionPayload {
  const payload = object(value, "Stored distribution payload is invalid");
  const bondMint = payload["bondMint"];
  const treasuryTokenAccount = payload["treasuryTokenAccount"];
  const allocations = payload["allocations"];
  if (typeof bondMint !== "string" || typeof treasuryTokenAccount !== "string" || !Array.isArray(allocations) || allocations.length !== 3) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution attempt is incomplete");
  }
  try { decodePublicKey(bondMint); decodePublicKey(treasuryTokenAccount); }
  catch { throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution addresses are invalid"); }
  const rows = allocations.map(value => {
    const row = object(value, "Stored distribution allocation is invalid");
    const result = {
      investorId: row["investorId"], walletAddress: row["walletAddress"],
      tokenAccount: row["tokenAccount"], amount: row["amount"]
    };
    if (typeof result.investorId !== "string" || !UUID.test(result.investorId) || typeof result.walletAddress !== "string" ||
        typeof result.tokenAccount !== "string" ||
        typeof result.amount !== "string" || !/^(5|10|20)$/.test(result.amount)) {
      throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution allocation is invalid");
    }
    try { decodePublicKey(result.walletAddress); decodePublicKey(result.tokenAccount); }
    catch { throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution allocation address is invalid"); }
    return result as DistributionAllocation;
  });
  if (new Set(rows.map(row => row.investorId)).size !== 3 || new Set(rows.map(row => row.walletAddress)).size !== 3 ||
      rows.map(row => row.amount).sort().join(",") !== "10,20,5") {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution allocation is not canonical");
  }
  return { bondMint, treasuryTokenAccount, allocations: rows };
}

function preparedDistributionResponse(existing: StoredMintSetupAttempt, cluster: "localnet" | "devnet", options?: InstrumentDeploymentOptions) {
  if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
      !existing.recentBlockhash || existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution attempt is incomplete");
  }
  const payload = distributionPayload(existing.preparedPayload);
  return { operationId: existing.id, phase: "DISTRIBUTION" as const, cluster,
    signature: existing.signature ?? null, status: existing.status,
    requiredSigner: existing.requiredSigner, networkGenesisHash: existing.networkGenesisHash,
    recentBlockhash: existing.recentBlockhash, lastValidBlockHeight: Number(existing.lastValidBlockHeight),
    serializedTransactionBase64: existing.preparedTransactionBase64,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const, ...payload,
    ...(options ? resumeControlledMetadata(existing, options) : {}), resumed: true };
}

function requestedDistribution(value: unknown): { walletAddress: string; amount: bigint }[] {
  const input = object(value, "Distribution request is invalid");
  if (Object.keys(input).some(key => key !== "allocations") || !Array.isArray(input["allocations"]) || input["allocations"].length !== 3) {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Distribution requires exactly three allocations", 400);
  }
  const allocations = input["allocations"].map(value => {
    const row = object(value, "Distribution allocation is invalid");
    if (Object.keys(row).some(key => !["walletAddress", "amount"].includes(key)) || typeof row["walletAddress"] !== "string" ||
        typeof row["amount"] !== "string" || !/^(5|10|20)$/.test(row["amount"])) {
      throw new InstrumentDeploymentError("INVALID_REQUEST", "Each allocation requires a wallet and canonical string amount", 400);
    }
    try { decodePublicKey(row["walletAddress"]); }
    catch { throw new InstrumentDeploymentError("INVALID_REQUEST", "Distribution wallet address is invalid", 400); }
    return { walletAddress: row["walletAddress"], amount: BigInt(row["amount"]) };
  });
  if (new Set(allocations.map(row => row.walletAddress)).size !== 3 ||
      allocations.map(row => row.amount).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).join(",") !== "5,10,20") {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Distribution must use three unique wallets and amounts 10, 20, and 5", 400);
  }
  return allocations;
}

async function planFor(database: PrismaClient, rpc: SolanaRpc, instrumentId: string, actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  if (!UUID.test(instrumentId)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument identifier is invalid", 400);
  const instrument = await database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
  if (!instrument) throw new InstrumentDeploymentError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
  if (instrument.issuerAuthority !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
  const controlled = requireControlledRegistry(instrument, options);
  if (instrument.status !== "DRAFT" || instrument.mintAddress || instrument.settlementAsset.mintAddress) {
    throw new InstrumentDeploymentError("MINT_SETUP_NOT_AVAILABLE", "Mint setup is available only for an untouched DRAFT instrument");
  }
  if (instrument.totalSupply !== 35n || instrument.circulatingSupply !== 0n) throw new InstrumentDeploymentError("INSTRUMENT_STATE_MISMATCH", "Canonical draft supply is invalid");
  const genesis = await rpc.request("getGenesisHash", []);
  if (genesis !== options.expectedGenesisHash) throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration", 503);
  const rent = await Promise.all([controlled ? CONTROLLED_BOND_MINT_SIZE : BOND_MINT_SIZE, SETTLEMENT_MINT_SIZE].map(async size =>
    BigInt(safeNumber(await rpc.request("getMinimumBalanceForRentExemption", [size, { commitment: "finalized" }])))));
  const plan = await (controlled ? buildControlledMintSetup : buildInstrumentMintSetup)({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
    administrator: actor.walletAddress, bondRentLamports: rent[0]!, settlementRentLamports: rent[1]!, totalSupply: instrument.totalSupply });
  const accounts = await Promise.all([plan.bondMint, plan.settlementMint, plan.treasuryTokenAccount].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }])));
  if (accounts.some(value => object(value)["value"] !== null)) throw new InstrumentDeploymentError("MINT_ADDRESS_OCCUPIED", "A deterministic mint or treasury address is already occupied");
  return { instrument, plan, rent };
}

export async function prepareInstrumentMintSetup(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  const existing = await database.blockchainTransaction.findFirst({ where: { instrumentId, operationType: "INSTRUMENT_MINT_SETUP",
    status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
  if (existing) {
    if (existing.instrument) requireControlledRegistry(existing.instrument, options);
    if (existing.requiredSigner !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match prepared signer", 403);
    if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
        !existing.recentBlockhash || existing.lastValidBlockHeight === null) throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored mint setup attempt is incomplete");
    if (await activeAttemptCanResume(database, rpc, existing, options.expectedGenesisHash)) {
      return preparedResponse(existing, options.cluster, options);
    }
  }
  const { instrument, plan, rent } = await planFor(database, rpc, instrumentId, actor, options);
  const metadata = requireControlledRegistry(instrument, options) ? {
    ...await controlledMetadata(instrument, options), bondMint: plan.bondMint, settlementMint: plan.settlementMint,
    treasuryTokenAccount: plan.treasuryTokenAccount, instrumentAddress: plan.instrumentAddress,
    controlledPolicyAddress: await deriveControlledPolicyAddress(options.programId, plan.instrumentAddress),
    rent: { bondRentLamports: rent[0]!.toString(), settlementRentLamports: rent[1]!.toString() }
  } : {};
  const latest = object(await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]));
  const value = object(latest["value"]);
  const recentBlockhash = value["blockhash"];
  const lastValidBlockHeight = safeNumber(value["lastValidBlockHeight"]);
  if (typeof recentBlockhash !== "string") throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Latest blockhash is invalid", 503);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions,
    feePayer: actor.walletAddress, recentBlockhash, lastValidBlockHeight });
  let operation: { id: string };
  try {
    operation = await database.$transaction(async transaction => {
      const row = await transaction.blockchainTransaction.create({ data: { instrumentId, operationType: "INSTRUMENT_MINT_SETUP",
        status: "PREPARED", recentBlockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64,
        ...(requireControlledRegistry(instrument, options) ? { preparedPayload: metadata } : {}) } });
      await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        event: "INSTRUMENT_MINT_SETUP_PREPARED", entityType: "BlockchainTransaction", entityId: row.id,
        correlationId: actor.correlationId, blockchainTransactionId: row.id,
        metadataJson: { instrumentId, bondMint: plan.bondMint, settlementMint: plan.settlementMint,
          treasuryTokenAccount: plan.treasuryTokenAccount, totalSupply: "35", onChain: false } } });
      return row;
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "P2002") throw error;
    const concurrent = await database.blockchainTransaction.findFirst({ where: { instrumentId,
      operationType: "INSTRUMENT_MINT_SETUP", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
    if (!concurrent) throw error;
    return preparedResponse(concurrent, options.cluster, options);
  }
  return { operationId: operation.id, phase: "MINT_SETUP" as const, cluster: options.cluster,
    requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
    lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    bondMint: plan.bondMint, settlementMint: plan.settlementMint, treasuryTokenAccount: plan.treasuryTokenAccount, ...metadata, resumed: false };
}

function accountData(response: unknown, minimumSlot: number): Buffer {
  const result = object(response); const context = object(result["context"]); const value = object(result["value"]);
  if (safeNumber(context["slot"]) < minimumSlot || value["owner"] !== TOKEN_2022_PROGRAM_ID || value["executable"] !== false) {
    throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Finalized mint account metadata is invalid");
  }
  const data = value["data"];
  if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Mint account data is invalid", 503);
  }
  return Buffer.from(data[0], "base64");
}

export function verifyMint(data: Buffer, input: { decimals: number; supply: bigint; permanentDelegate?: string; mintAuthority?: string }) {
  const expectedAuthorityTag = input.mintAuthority ? 1 : 0;
  if (data.length < 82 || data.readUInt32LE(0) !== expectedAuthorityTag ||
      (input.mintAuthority && encodePublicKey(data.subarray(4, 36)) !== input.mintAuthority) ||
      data.readBigUInt64LE(36) !== input.supply ||
      data[44] !== input.decimals || data[45] !== 1 || data.readUInt32LE(46) !== 0) {
    throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Finalized mint supply, decimals, or authorities do not match");
  }
  if (input.permanentDelegate) {
    if (data.length < 202 || data[165] !== 1 || data.readUInt16LE(166) !== 12 || data.readUInt16LE(168) !== 32 ||
        encodePublicKey(data.subarray(170, 202)) !== input.permanentDelegate) {
      throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Bond permanent delegate does not match the instrument PDA");
    }
  }
}

export function verifyControlledMint(data: Buffer, input: { supply: bigint; instrumentAuthority: string; mintAuthority?: string }) {
  if (data.length !== CONTROLLED_BOND_MINT_SIZE || data.readUInt32LE(0) !== (input.mintAuthority ? 1 : 0) ||
      (input.mintAuthority && encodePublicKey(data.subarray(4, 36)) !== input.mintAuthority) ||
      data.readBigUInt64LE(36) !== input.supply || data[44] !== 0 || data[45] !== 1 ||
      data.readUInt32LE(46) !== 1 || encodePublicKey(data.subarray(50, 82)) !== input.instrumentAuthority ||
      data[165] !== 1 || data.subarray(82, 165).some(byte => byte !== 0)) {
    throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Controlled mint supply, frozen policy or authorities do not match");
  }
  const extensions = new Map<number, Buffer>();
  for (let offset = 166; offset < data.length;) {
    if (offset + 4 > data.length) throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Controlled mint extensions are invalid");
    const kind = data.readUInt16LE(offset); const length = data.readUInt16LE(offset + 2); offset += 4;
    if (extensions.has(kind) || offset + length > data.length) throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Controlled mint extensions are invalid");
    extensions.set(kind, data.subarray(offset, offset + length)); offset += length;
  }
  const permanentDelegate = extensions.get(12); const defaultState = extensions.get(6);
  if (extensions.size !== 2 || permanentDelegate?.length !== 32 || encodePublicKey(permanentDelegate) !== input.instrumentAuthority ||
      defaultState?.length !== 1 || defaultState[0] !== 2) {
    throw new InstrumentDeploymentError("MINT_STATE_MISMATCH", "Controlled mint permanent delegate or default frozen state is invalid");
  }
}

function controlledTokenState(data: Buffer, tokenAccount: string, input: { mint: string; owner: string; amount: bigint }, code: string) {
  try {
    const decoded = decodeControlledTokenPosition({ address: tokenAccount, owner: TOKEN_2022_PROGRAM_ID,
      executable: false, dataBase64: data.toString("base64") }, input.mint);
    if (decoded.walletAddress !== input.owner || decoded.balance !== input.amount || decoded.state !== "FROZEN") throw new Error("mismatch");
  } catch { throw new InstrumentDeploymentError(code, "Controlled token account mint, owner, frozen state or balance does not match"); }
}

async function verifyControlledRegistryAccounts(rpc: SolanaRpc, instrument: Pick<DeploymentInstrument, "id" | "mintAddress" | "totalSupply">,
  options: InstrumentDeploymentOptions, minimumSlot: number, holders: readonly { tokenAccount: string; walletAddress: string }[] = []) {
  const { instrumentAddress, instrumentAuthority } = await deriveInstrumentLifecycleAddresses(options.programId, uuidBytes(instrument.id));
  const policyAddress = await deriveControlledPolicyAddress(options.programId, instrumentAddress);
  const holdingAddresses = await Promise.all(holders.map(row => deriveControlledHoldingAddress(options.programId, instrumentAddress, row.tokenAccount)));
  const responses = await Promise.all([policyAddress, instrument.mintAddress!, ...holdingAddresses].map(address => rpc.request("getAccountInfo",
    [address, { commitment: "finalized", encoding: "base64", minContextSlot: minimumSlot }])));
  try {
    const policy = decodeControlledPolicy({ address: policyAddress, owner: options.programId, executable: false,
      dataBase64: contextualProgramAccount(responses[0], minimumSlot, options.programId) },
    { accountAddress: policyAddress, programId: options.programId, instrumentAddress, mintAddress: instrument.mintAddress! });
    if (policy.captureAction !== "11111111111111111111111111111111" || policy.activeRedemption !== "11111111111111111111111111111111") throw new Error("busy policy");
    for (let index = 0; index < holders.length; index += 1) {
      const row = holders[index]!;
      const holding = decodeControlledHolding({ address: holdingAddresses[index]!, owner: options.programId, executable: false,
        dataBase64: contextualProgramAccount(responses[index + 2], minimumSlot, options.programId) },
      { accountAddress: holdingAddresses[index]!, programId: options.programId, instrumentAddress, mintAddress: instrument.mintAddress!,
        tokenAccount: row.tokenAccount, walletAddress: row.walletAddress });
      if (holding.reservedTokens !== 0n) throw new Error("reserved issuance holding");
    }
  } catch { throw new InstrumentDeploymentError("CONTROLLED_REGISTRY_STATE_MISMATCH", "Controlled policy or holdings do not match issuance"); }
  verifyControlledMint(accountData(responses[1], minimumSlot), { supply: instrument.totalSupply, instrumentAuthority });
}

function tokenAccountState(data: Buffer, input: { mint: string; owner: string; amount: bigint }, code: string) {
  if (data.length < 165 || encodePublicKey(data.subarray(0, 32)) !== input.mint ||
      encodePublicKey(data.subarray(32, 64)) !== input.owner || data.readBigUInt64LE(64) !== input.amount) {
    throw new InstrumentDeploymentError(code, "Token account mint, owner, or balance does not match the distribution plan");
  }
}

function uncontextualizedAccountData(response: unknown): Buffer | null {
  const result = object(response);
  if (result["value"] === null) return null;
  const value = object(result["value"]);
  if (value["owner"] !== TOKEN_2022_PROGRAM_ID || value["executable"] !== false) {
    throw new InstrumentDeploymentError("DISTRIBUTION_STATE_MISMATCH", "Distribution token account metadata is invalid");
  }
  const data = value["data"];
  if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Token account data is invalid", 503);
  }
  return Buffer.from(data[0], "base64");
}

export async function prepareInstrumentDistribution(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions, input: unknown) {
  if (!UUID.test(instrumentId)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument identifier is invalid", 400);
  const requested = requestedDistribution(input);
  const existing = await database.blockchainTransaction.findFirst({ where: { instrumentId, operationType: "INSTRUMENT_DISTRIBUTION",
    status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
  if (existing) {
    if (existing.instrument) requireControlledRegistry(existing.instrument, options);
    if (existing.requiredSigner !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match prepared signer", 403);
    if (await activeAttemptCanResume(database, rpc, existing, options.expectedGenesisHash)) {
      return preparedDistributionResponse(existing, options.cluster, options);
    }
  }
  const instrument = await database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
  if (!instrument) throw new InstrumentDeploymentError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
  if (instrument.issuerAuthority !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
  const controlled = requireControlledRegistry(instrument, options);
  if (instrument.status !== (controlled ? "DEPLOYING" : "DRAFT") || !instrument.mintAddress || !instrument.settlementAsset.mintAddress || instrument.circulatingSupply !== 0n) {
    throw new InstrumentDeploymentError("DISTRIBUTION_NOT_AVAILABLE", "Distribution requires a confirmed mint setup and zero circulating supply");
  }
  const finalizedSetup = await database.blockchainTransaction.findFirst({ where: {
    instrumentId, operationType: "INSTRUMENT_MINT_SETUP", status: "FINALIZED"
  }, select: { id: true } });
  if (!finalizedSetup) throw new InstrumentDeploymentError("MINT_SETUP_REQUIRED", "A finalized mint setup is required before distribution");
  if (controlled && !await database.blockchainTransaction.findFirst({ where: { instrumentId,
    operationType: "INSTRUMENT_INITIALIZE", status: "FINALIZED" }, select: { id: true } })) {
    throw new InstrumentDeploymentError("INITIALIZE_REQUIRED", "Controlled distribution requires finalized initialization");
  }
  if (await rpc.request("getGenesisHash", []) !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration", 503);
  }
  const wallets = await database.wallet.findMany({ where: { address: { in: requested.map(row => row.walletAddress) } },
    include: { investor: true } });
  const expectedNetwork = options.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET";
  if (wallets.length !== 3) throw new InstrumentDeploymentError("DISTRIBUTION_WALLET_NOT_ELIGIBLE", "Every distribution wallet must be registered", 409);
  const selected = requested.map(row => {
    const wallet = wallets.find(candidate => candidate.address === row.walletAddress);
    if (!wallet?.investor || wallet.network !== expectedNetwork || wallet.status !== "ACTIVE" || !wallet.verifiedAt || wallet.revokedAt ||
        wallet.investor.status !== "ACTIVE" || wallet.investor.eligibilityStatus !== "ELIGIBLE") {
      throw new InstrumentDeploymentError("DISTRIBUTION_WALLET_NOT_ELIGIBLE", "Every distribution wallet must be active, verified, eligible, and on the configured network", 409);
    }
    return { ...row, investorId: wallet.investor.id };
  });
  if (new Set(selected.map(row => row.investorId)).size !== 3) {
    throw new InstrumentDeploymentError("DISTRIBUTION_INVESTORS_NOT_UNIQUE", "The canonical allocation requires three different investors", 409);
  }
  const plan = await buildInstrumentDistribution({ administrator: actor.walletAddress, bondMint: instrument.mintAddress,
    allocations: selected.map(({ walletAddress, amount }) => ({ walletAddress, amount })) });
  const accountResponses = await Promise.all([plan.treasuryTokenAccount, ...plan.allocations.map(row => row.tokenAccount)].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }])));
  const treasury = uncontextualizedAccountData(accountResponses[0]);
  if (!treasury) throw new InstrumentDeploymentError("TREASURY_STATE_MISMATCH", "Bond treasury is missing");
  tokenAccountState(treasury, { mint: instrument.mintAddress, owner: actor.walletAddress, amount: instrument.totalSupply }, "TREASURY_STATE_MISMATCH");
  if (controlled) controlledTokenState(treasury, plan.treasuryTokenAccount,
    { mint: instrument.mintAddress, owner: actor.walletAddress, amount: instrument.totalSupply }, "TREASURY_STATE_MISMATCH");
  for (let index = 0; index < plan.allocations.length; index += 1) {
    const current = uncontextualizedAccountData(accountResponses[index + 1]);
    if (current) {
      tokenAccountState(current, { mint: instrument.mintAddress,
        owner: plan.allocations[index]!.walletAddress, amount: 0n }, "DISTRIBUTION_STATE_MISMATCH");
      if (controlled) controlledTokenState(current, plan.allocations[index]!.tokenAccount,
        { mint: instrument.mintAddress, owner: plan.allocations[index]!.walletAddress, amount: 0n }, "DISTRIBUTION_STATE_MISMATCH");
    }
  }
  const instructions = controlled ? [
    (await buildControlledHoldingRegistration({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
      corporateActionAuthority: actor.walletAddress, bondTokenAccount: plan.treasuryTokenAccount })).instruction
  ] : [...plan.instructions];
  if (controlled) {
    for (const allocation of plan.allocations) {
      instructions.push(createAssociatedTokenAccountIdempotent(actor.walletAddress, allocation.tokenAccount, allocation.walletAddress, instrument.mintAddress));
      instructions.push((await buildControlledHoldingRegistration({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
        corporateActionAuthority: actor.walletAddress, bondTokenAccount: allocation.tokenAccount })).instruction);
      instructions.push((await buildControlledTransfer({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
        corporateActionAuthority: actor.walletAddress, holder: actor.walletAddress, bondMint: instrument.mintAddress,
        sourceTokenAccount: plan.treasuryTokenAccount, destinationTokenAccount: allocation.tokenAccount, amount: allocation.amount })).instruction);
    }
  }
  const latest = object(await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]));
  const value = object(latest["value"]);
  const recentBlockhash = value["blockhash"];
  const lastValidBlockHeight = safeNumber(value["lastValidBlockHeight"]);
  if (typeof recentBlockhash !== "string") throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Latest blockhash is invalid", 503);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions,
    feePayer: actor.walletAddress, recentBlockhash, lastValidBlockHeight });
  const payload: DistributionPayload = { bondMint: instrument.mintAddress, treasuryTokenAccount: plan.treasuryTokenAccount,
    allocations: plan.allocations.map((allocation, index) => ({ investorId: selected[index]!.investorId,
      walletAddress: allocation.walletAddress, tokenAccount: allocation.tokenAccount,
      amount: allocation.amount.toString() })) };
  const metadata = await controlledMetadata(instrument, options);
  let operation: { id: string };
  try {
    operation = await database.$transaction(async transaction => {
      const row = await transaction.blockchainTransaction.create({ data: { instrumentId, operationType: "INSTRUMENT_DISTRIBUTION",
        status: "PREPARED", recentBlockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64, preparedPayload: { ...payload, ...metadata } } });
      await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        event: "INSTRUMENT_DISTRIBUTION_PREPARED", entityType: "BlockchainTransaction", entityId: row.id,
        correlationId: actor.correlationId, blockchainTransactionId: row.id,
        metadataJson: { instrumentId, bondMint: instrument.mintAddress, treasuryTokenAccount: plan.treasuryTokenAccount,
          allocations: payload.allocations, onChain: false } } });
      return row;
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "P2002") throw error;
    const concurrent = await database.blockchainTransaction.findFirst({ where: { instrumentId,
      operationType: "INSTRUMENT_DISTRIBUTION", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
    if (!concurrent) throw error;
    return preparedDistributionResponse(concurrent, options.cluster, options);
  }
  return { operationId: operation.id, phase: "DISTRIBUTION" as const, cluster: options.cluster,
    requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
    lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    ...payload, ...metadata, resumed: false };
}

export async function confirmInstrumentDistribution(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  operationId: string, transactionSignature: string, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) || !SIGNATURE.test(transactionSignature)) {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signature is invalid", 400);
  }
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId }, include: { instrument: true } });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId || operation.operationType !== "INSTRUMENT_DISTRIBUTION") {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Distribution attempt was not found", 404);
  }
  const controlled = requireControlledRegistry(instrument, options);
  if (actor.walletAddress !== instrument.issuerAuthority || operation.requiredSigner !== actor.walletAddress) {
    throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (operation.status === "FINALIZED") {
    if (operation.signature !== transactionSignature) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Finalized attempt has another signature");
    return { operationId, signature: transactionSignature, status: "FINALIZED" as const, phase: "DISTRIBUTION" as const };
  }
  if (!CONFIRMABLE.includes(operation.status as typeof CONFIRMABLE[number]) || !operation.preparedTransactionBase64 ||
      operation.networkGenesisHash !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("DEPLOYMENT_NOT_CONFIRMABLE", "Distribution attempt is not confirmable");
  }
  const payload = distributionPayload(operation.preparedPayload);
  if (payload.bondMint !== instrument.mintAddress || instrument.status !== (controlled ? "DEPLOYING" : "DRAFT") || instrument.circulatingSupply !== 0n) {
    throw new InstrumentDeploymentError("DISTRIBUTION_STATE_MISMATCH", "Instrument distribution state changed after preparation");
  }
  if (await rpc.request("getGenesisHash", []) !== operation.networkGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Confirmation RPC is on another network", 503);
  }
  const rpcTransaction = await rpc.request("getTransaction", [transactionSignature,
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (rpcTransaction === null) {
    return recordUnavailableTransaction(database, rpc, operation, transactionSignature);
  }
  const result = object(rpcTransaction);
  const meta = object(result["meta"]);
  const slot = safeNumber(result["slot"]);
  if (meta["err"] !== null) {
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: { in: [...CONFIRMABLE] } },
      data: { signature: transactionSignature, status: "FAILED", submittedAt: now, lastErrorCode: "TRANSACTION_FAILED" } });
    throw new InstrumentDeploymentError("TRANSACTION_FAILED", "Distribution transaction failed on chain");
  }
  const tuple = result["transaction"];
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Finalized transaction bytes are missing", 503);
  }
  try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: operation.preparedTransactionBase64,
    finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature: transactionSignature }); }
  catch { throw new InstrumentDeploymentError("TRANSACTION_MISMATCH", "Finalized transaction does not match the prepared distribution"); }
  const chainAccounts = await Promise.all([payload.treasuryTokenAccount, ...payload.allocations.map(row => row.tokenAccount)].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64", minContextSlot: slot }])));
  tokenAccountState(accountData(chainAccounts[0], slot), { mint: payload.bondMint, owner: actor.walletAddress, amount: 0n }, "TREASURY_STATE_MISMATCH");
  if (controlled) controlledTokenState(accountData(chainAccounts[0], slot), payload.treasuryTokenAccount,
    { mint: payload.bondMint, owner: actor.walletAddress, amount: 0n }, "TREASURY_STATE_MISMATCH");
  for (let index = 0; index < payload.allocations.length; index += 1) {
    const allocation = payload.allocations[index]!;
    tokenAccountState(accountData(chainAccounts[index + 1], slot), { mint: payload.bondMint,
      owner: allocation.walletAddress, amount: BigInt(allocation.amount) }, "DISTRIBUTION_STATE_MISMATCH");
    if (controlled) controlledTokenState(accountData(chainAccounts[index + 1], slot), allocation.tokenAccount,
      { mint: payload.bondMint, owner: allocation.walletAddress, amount: BigInt(allocation.amount) }, "DISTRIBUTION_STATE_MISMATCH");
  }
  if (controlled) await verifyControlledRegistryAccounts(rpc, instrument, options, slot,
    [{ tokenAccount: payload.treasuryTokenAccount, walletAddress: actor.walletAddress }, ...payload.allocations]);
  await database.$transaction(async transaction => {
    const attempt = await transaction.blockchainTransaction.updateMany({ where: { id: operationId,
      status: { in: [...CONFIRMABLE] }, OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now, finalizedAt: now, lastErrorCode: null } });
    const updated = await transaction.instrument.updateMany({ where: { id: instrument.id, status: controlled ? "DEPLOYING" : "DRAFT", circulatingSupply: 0n,
      mintAddress: payload.bondMint }, data: { circulatingSupply: instrument.totalSupply, version: { increment: 1 } } });
    if (attempt.count !== 1 || updated.count !== 1) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Distribution state changed concurrently");
    await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_DISTRIBUTION_FINALIZED", entityType: "Instrument", entityId: instrument.id,
      correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { signature: transactionSignature, finalizedSlot: slot, bondMint: payload.bondMint,
        treasuryTokenAccount: payload.treasuryTokenAccount, allocations: payload.allocations,
        circulatingSupply: instrument.totalSupply.toString(), status: controlled ? "DEPLOYING" : "DRAFT", nextPhase: controlled ? "ACTIVATE" : "INITIALIZE" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "DISTRIBUTION" as const, allocations: payload.allocations, nextPhase: controlled ? "ACTIVATE" as const : "INITIALIZE" as const };
}

export async function confirmInstrumentMintSetup(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  operationId: string, transactionSignature: string, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) || !SIGNATURE.test(transactionSignature)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signature is invalid", 400);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId }, include: { instrument: { include: { settlementAsset: true } } } });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId || operation.operationType !== "INSTRUMENT_MINT_SETUP") throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Mint setup attempt was not found", 404);
  const controlled = requireControlledRegistry(instrument, options);
  if (actor.walletAddress !== instrument.issuerAuthority || operation.requiredSigner !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  if (operation.status === "FINALIZED") {
    if (operation.signature !== transactionSignature) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Finalized attempt has another signature");
    return { operationId, signature: transactionSignature, status: "FINALIZED" as const, phase: "MINT_SETUP" as const };
  }
  if (!CONFIRMABLE.includes(operation.status as typeof CONFIRMABLE[number]) || !operation.preparedTransactionBase64 ||
      operation.networkGenesisHash !== options.expectedGenesisHash) throw new InstrumentDeploymentError("DEPLOYMENT_NOT_CONFIRMABLE", "Mint setup attempt is not confirmable");
  if (await rpc.request("getGenesisHash", []) !== operation.networkGenesisHash) throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Confirmation RPC is on another network", 503);
  const rpcTransaction = await rpc.request("getTransaction", [transactionSignature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (rpcTransaction === null) {
    return recordUnavailableTransaction(database, rpc, operation, transactionSignature);
  }
  const result = object(rpcTransaction); const meta = object(result["meta"]); const slot = safeNumber(result["slot"]);
  if (meta["err"] !== null) {
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: { in: [...CONFIRMABLE] } },
      data: { signature: transactionSignature, status: "FAILED", submittedAt: now, lastErrorCode: "TRANSACTION_FAILED" } });
    throw new InstrumentDeploymentError("TRANSACTION_FAILED", "Mint setup transaction failed on chain");
  }
  const tuple = result["transaction"];
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64") throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Finalized transaction bytes are missing", 503);
  try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: operation.preparedTransactionBase64,
    finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature: transactionSignature }); }
  catch { throw new InstrumentDeploymentError("TRANSACTION_MISMATCH", "Finalized transaction does not match the prepared mint setup"); }
  const plan = await (controlled ? buildControlledMintSetup : buildInstrumentMintSetup)({ programId: options.programId, instrumentId: uuidBytes(instrument.id), administrator: actor.walletAddress,
    bondRentLamports: controlled ? 1n : 0n, settlementRentLamports: controlled ? 1n : 0n, totalSupply: instrument.totalSupply });
  const [bondData, settlementData, treasuryData] = await Promise.all([plan.bondMint, plan.settlementMint, plan.treasuryTokenAccount].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64", minContextSlot: slot }])));
  if (controlled) verifyControlledMint(accountData(bondData, slot), { supply: 0n, instrumentAuthority: plan.instrumentAuthority, mintAuthority: actor.walletAddress });
  else verifyMint(accountData(bondData, slot), { decimals: 0, supply: instrument.totalSupply, permanentDelegate: plan.instrumentAuthority });
  // KZT-Test must retain the issuer authority so a later settlement can be test-funded.
  verifyMint(accountData(settlementData, slot), { decimals: 6, supply: 0n, mintAuthority: actor.walletAddress });
  const treasury = accountData(treasuryData, slot);
  if (treasury.length < 165 || encodePublicKey(treasury.subarray(0, 32)) !== plan.bondMint ||
      encodePublicKey(treasury.subarray(32, 64)) !== actor.walletAddress || treasury.readBigUInt64LE(64) !== (controlled ? 0n : instrument.totalSupply)) {
    throw new InstrumentDeploymentError("TREASURY_STATE_MISMATCH", "Finalized treasury does not contain the canonical supply");
  }
  if (controlled) controlledTokenState(treasury, plan.treasuryTokenAccount,
    { mint: plan.bondMint, owner: actor.walletAddress, amount: 0n }, "TREASURY_STATE_MISMATCH");
  await database.$transaction(async transaction => {
    const attempt = await transaction.blockchainTransaction.updateMany({ where: { id: operationId, status: { in: [...CONFIRMABLE] }, OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now, finalizedAt: now, lastErrorCode: null } });
    const updated = await transaction.instrument.updateMany({ where: { id: instrument.id, status: "DRAFT", mintAddress: null },
      data: { mintAddress: plan.bondMint, programId: options.programId, version: { increment: 1 } } });
    const asset = await transaction.settlementAsset.updateMany({ where: { id: instrument.settlementAssetId, mintAddress: null }, data: { mintAddress: plan.settlementMint } });
    if (attempt.count !== 1 || updated.count !== 1 || asset.count !== 1) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Mint setup state changed concurrently");
    await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_MINT_SETUP_FINALIZED", entityType: "Instrument", entityId: instrument.id,
      correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { signature: transactionSignature, finalizedSlot: slot, bondMint: plan.bondMint,
        settlementMint: plan.settlementMint, treasuryTokenAccount: plan.treasuryTokenAccount, status: "DRAFT", nextPhase: controlled ? "INITIALIZE" : "DISTRIBUTION" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "MINT_SETUP" as const, bondMint: plan.bondMint, settlementMint: plan.settlementMint,
    treasuryTokenAccount: plan.treasuryTokenAccount, nextPhase: controlled ? "INITIALIZE" as const : "DISTRIBUTION" as const };
}

function lifecyclePayload(value: unknown, phase: "INITIALIZE" | "ACTIVATE"): InitializationPayload | ActivationPayload {
  const payload = object(value, `Stored ${phase.toLowerCase()} payload is invalid`);
  const instrumentAddress = payload["instrumentAddress"];
  if (typeof instrumentAddress !== "string") {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", `Stored ${phase.toLowerCase()} attempt is incomplete`);
  }
  try { decodePublicKey(instrumentAddress); }
  catch { throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored instrument address is invalid"); }
  if (phase === "INITIALIZE") return { instrumentAddress };
  const distribution = distributionPayload({ bondMint: payload["bondMint"], treasuryTokenAccount: payload["treasuryTokenAccount"],
    allocations: payload["allocations"] });
  return { instrumentAddress, allocations: distribution.allocations };
}

function preparedLifecycleResponse(existing: StoredMintSetupAttempt, cluster: "localnet" | "devnet",
  phase: "INITIALIZE" | "ACTIVATE", options?: InstrumentDeploymentOptions) {
  if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
      !existing.recentBlockhash || existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", `Stored ${phase.toLowerCase()} attempt is incomplete`);
  }
  const payload = lifecyclePayload(existing.preparedPayload, phase);
  return { operationId: existing.id, phase, cluster, requiredSigner: existing.requiredSigner,
    signature: existing.signature ?? null, status: existing.status,
    networkGenesisHash: existing.networkGenesisHash, recentBlockhash: existing.recentBlockhash,
    lastValidBlockHeight: Number(existing.lastValidBlockHeight),
    serializedTransactionBase64: existing.preparedTransactionBase64,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const, ...payload,
    ...(options ? resumeControlledMetadata(existing, options) : {}), resumed: true };
}

async function expireOrResumeLifecycle(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions, phase: "INITIALIZE" | "ACTIVATE") {
  const operationType = `INSTRUMENT_${phase}`;
  const existing = await database.blockchainTransaction.findFirst({ where: { instrumentId, operationType,
    status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
  if (!existing) return null;
  if (existing.instrument) requireControlledRegistry(existing.instrument, options);
  if (existing.requiredSigner !== actor.walletAddress) {
    throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (existing.networkGenesisHash !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Stored attempt belongs to another network", 409);
  }
  if (await activeAttemptCanResume(database, rpc, existing, options.expectedGenesisHash)) {
    return preparedLifecycleResponse(existing, options.cluster, phase, options);
  }
  return null;
}

async function latestBlockhash(rpc: SolanaRpc) {
  const latest = object(await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]));
  const value = object(latest["value"]);
  const recentBlockhash = value["blockhash"];
  const lastValidBlockHeight = safeNumber(value["lastValidBlockHeight"]);
  if (typeof recentBlockhash !== "string") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Latest blockhash is invalid", 503);
  }
  return { recentBlockhash, lastValidBlockHeight };
}

async function requireEligibleDistribution(database: PrismaClient, payload: DistributionPayload,
  options: InstrumentDeploymentOptions) {
  const wallets = await database.wallet.findMany({ where: { address: { in: payload.allocations.map(row => row.walletAddress) } },
    include: { investor: true } });
  const expectedNetwork = options.cluster === "localnet" ? "SOLANA_LOCALNET" : "SOLANA_DEVNET";
  for (const allocation of payload.allocations) {
    const wallet = wallets.find(candidate => candidate.address === allocation.walletAddress);
    if (!wallet?.investor || wallet.investor.id !== allocation.investorId || wallet.network !== expectedNetwork ||
        wallet.status !== "ACTIVE" || !wallet.verifiedAt || wallet.revokedAt || wallet.investor.status !== "ACTIVE" ||
        wallet.investor.eligibilityStatus !== "ELIGIBLE") {
      throw new InstrumentDeploymentError("ACTIVATION_WALLET_NOT_ELIGIBLE",
        "Every distributed wallet must still be active, verified, eligible, and on the configured network", 409);
    }
  }
}

function contextualProgramAccount(response: unknown, minimumSlot: number, programId: string) {
  const result = object(response); const context = object(result["context"]); const value = object(result["value"]);
  if (safeNumber(context["slot"]) < minimumSlot || value["owner"] !== programId || value["executable"] !== false) {
    throw new InstrumentDeploymentError("INSTRUMENT_ACCOUNT_MISMATCH", "Finalized instrument account metadata is invalid");
  }
  const data = value["data"];
  if (!Array.isArray(data) || data.length !== 2 || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Instrument account data is invalid", 503);
  }
  return data[0];
}

export function verifyConfirmedInstrument(dataBase64: string, instrument: {
  id: string; issuerAuthority: string; complianceAuthority: string; corporateActionAuthority: string;
  mintAddress: string | null; faceValueMinor: bigint; couponRateBps: number; paymentsPerYear: number;
  issueAt: Date; maturityAt: Date; totalSupply: bigint; settlementAsset: { mintAddress: string | null }; tokenPolicy?: string;
  }, expectedStatus: "DEPLOYING" | "ACTIVE" | "PAUSED" | "REDEEMED") {
  let chain;
  try { chain = decodeConfirmedInstrumentAccount(dataBase64); }
  catch { throw new InstrumentDeploymentError("INSTRUMENT_ACCOUNT_MISMATCH", "Instrument PDA data is invalid"); }
  const id = Buffer.from(uuidBytes(instrument.id));
  if (chain.version !== (instrument.tokenPolicy === CONTROLLED_TOKEN_POLICY ? 2 : 1) || !Buffer.from(chain.instrumentId).equals(id) || chain.issuerAuthority !== instrument.issuerAuthority ||
      chain.complianceAuthority !== instrument.complianceAuthority ||
      chain.corporateActionAuthority !== instrument.corporateActionAuthority || chain.bondMint !== instrument.mintAddress ||
      chain.settlementMint !== instrument.settlementAsset.mintAddress || chain.faceValueMinor !== instrument.faceValueMinor ||
      chain.couponRateBps !== instrument.couponRateBps || chain.paymentsPerYear !== instrument.paymentsPerYear ||
      chain.issueAt !== BigInt(Math.floor(instrument.issueAt.getTime() / 1000)) ||
      chain.maturityAt !== BigInt(Math.floor(instrument.maturityAt.getTime() / 1000)) ||
      chain.totalSupply !== instrument.totalSupply || chain.status !== expectedStatus) {
    throw new InstrumentDeploymentError("INSTRUMENT_ACCOUNT_MISMATCH", "Instrument PDA does not match the database projection");
  }
}

export async function prepareInstrumentInitialization(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  if (!UUID.test(instrumentId)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument identifier is invalid", 400);
  const resumed = await expireOrResumeLifecycle(database, rpc, instrumentId, actor, options, "INITIALIZE");
  if (resumed) return resumed;
  const instrument = await database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
  if (!instrument) throw new InstrumentDeploymentError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
  if (instrument.issuerAuthority !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
  const controlled = requireControlledRegistry(instrument, options);
  if (instrument.status !== "DRAFT" || instrument.circulatingSupply !== (controlled ? 0n : instrument.totalSupply) ||
      !instrument.mintAddress || !instrument.settlementAsset.mintAddress || instrument.programId !== options.programId) {
    throw new InstrumentDeploymentError("INITIALIZE_NOT_AVAILABLE", "Initialization requires a fully distributed DRAFT instrument");
  }
  const distribution = await database.blockchainTransaction.findFirst({ where: { instrumentId,
    operationType: controlled ? "INSTRUMENT_MINT_SETUP" : "INSTRUMENT_DISTRIBUTION", status: "FINALIZED" }, select: { id: true } });
  if (!distribution) throw new InstrumentDeploymentError(controlled ? "MINT_SETUP_REQUIRED" : "DISTRIBUTION_REQUIRED", "The prior issuance phase must be finalized before initialization");
  if (await rpc.request("getGenesisHash", []) !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration", 503);
  }
  const plan = await (controlled ? buildControlledInstrumentInitialization : buildInstrumentInitialization)({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
    administrator: actor.walletAddress, bondMint: instrument.mintAddress, settlementMint: instrument.settlementAsset.mintAddress,
    complianceAuthority: instrument.complianceAuthority, corporateActionAuthority: instrument.corporateActionAuthority,
    faceValueMinor: instrument.faceValueMinor, couponRateBps: instrument.couponRateBps,
    paymentsPerYear: instrument.paymentsPerYear, issueAt: BigInt(Math.floor(instrument.issueAt.getTime() / 1000)),
    maturityAt: BigInt(Math.floor(instrument.maturityAt.getTime() / 1000)), totalSupply: instrument.totalSupply });
  const existingAccount = object(await rpc.request("getAccountInfo", [plan.instrumentAddress,
    { commitment: "finalized", encoding: "base64" }]));
  if (existingAccount["value"] !== null) throw new InstrumentDeploymentError("INSTRUMENT_ADDRESS_OCCUPIED", "Instrument PDA is already occupied");
  const { recentBlockhash, lastValidBlockHeight } = await latestBlockhash(rpc);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction],
    feePayer: actor.walletAddress, recentBlockhash, lastValidBlockHeight });
  const payload = { instrumentAddress: plan.instrumentAddress, ...await controlledMetadata(instrument, options),
    ...(controlled ? { bondMint: instrument.mintAddress, settlementMint: instrument.settlementAsset.mintAddress,
      controlledPolicyAddress: await deriveControlledPolicyAddress(options.programId, plan.instrumentAddress) } : {}) };
  try {
    const operation = await database.$transaction(async transaction => {
      const row = await transaction.blockchainTransaction.create({ data: { instrumentId, operationType: "INSTRUMENT_INITIALIZE",
        status: "PREPARED", recentBlockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64, preparedPayload: payload } });
      await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        event: "INSTRUMENT_INITIALIZE_PREPARED", entityType: "BlockchainTransaction", entityId: row.id,
        correlationId: actor.correlationId, blockchainTransactionId: row.id,
        metadataJson: { instrumentId, instrumentAddress: plan.instrumentAddress, onChain: false } } });
      return row;
    });
    return { operationId: operation.id, phase: "INITIALIZE" as const, cluster: options.cluster,
      requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
      lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
      ...payload, resumed: false };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "P2002") throw error;
    const concurrent = await database.blockchainTransaction.findFirst({ where: { instrumentId,
      operationType: "INSTRUMENT_INITIALIZE", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
    if (!concurrent) throw error;
    return preparedLifecycleResponse(concurrent, options.cluster, "INITIALIZE", options);
  }
}

async function finalizedTransaction(database: PrismaClient, rpc: SolanaRpc, operation: {
  id: string; status: string; signature: string | null; preparedTransactionBase64: string | null;
  networkGenesisHash: string | null;
  recentBlockhash?: string | null;
}, transactionSignature: string, actor: InstrumentActor, now: Date, failureLabel: string) {
  if (!CONFIRMABLE.includes(operation.status as typeof CONFIRMABLE[number]) || !operation.preparedTransactionBase64) {
    throw new InstrumentDeploymentError("DEPLOYMENT_NOT_CONFIRMABLE", `${failureLabel} attempt is not confirmable`);
  }
  if (await rpc.request("getGenesisHash", []) !== operation.networkGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Confirmation RPC is on another network", 503);
  }
  const response = await rpc.request("getTransaction", [transactionSignature,
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (response === null) {
    return recordUnavailableTransaction(database, rpc, operation, transactionSignature);
  }
  const result = object(response); const meta = object(result["meta"]); const slot = safeNumber(result["slot"]);
  if (meta["err"] !== null) {
    await database.blockchainTransaction.updateMany({ where: { id: operation.id, status: { in: [...CONFIRMABLE] } },
      data: { signature: transactionSignature, status: "FAILED", submittedAt: now, lastErrorCode: "TRANSACTION_FAILED" } });
    throw new InstrumentDeploymentError("TRANSACTION_FAILED", `${failureLabel} transaction failed on chain`);
  }
  const tuple = result["transaction"];
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || tuple[1] !== "base64") {
    throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Finalized transaction bytes are missing", 503);
  }
  try { verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: operation.preparedTransactionBase64,
    finalizedTransactionBase64: tuple[0], requiredSigner: actor.walletAddress, signature: transactionSignature }); }
  catch { throw new InstrumentDeploymentError("TRANSACTION_MISMATCH", `Finalized transaction does not match the prepared ${failureLabel.toLowerCase()}`); }
  return slot;
}

export async function confirmInstrumentInitialization(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  operationId: string, transactionSignature: string, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) || !SIGNATURE.test(transactionSignature)) {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signature is invalid", 400);
  }
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId },
    include: { instrument: { include: { settlementAsset: true } } } });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId || operation.operationType !== "INSTRUMENT_INITIALIZE") {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Initialization attempt was not found", 404);
  }
  const controlled = requireControlledRegistry(instrument, options);
  if (actor.walletAddress !== instrument.issuerAuthority || operation.requiredSigner !== actor.walletAddress) {
    throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (operation.status === "FINALIZED") {
    if (operation.signature !== transactionSignature) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Finalized attempt has another signature");
    return { operationId, signature: transactionSignature, status: "FINALIZED" as const, phase: "INITIALIZE" as const };
  }
  if (operation.networkGenesisHash !== options.expectedGenesisHash || instrument.status !== "DRAFT") {
    throw new InstrumentDeploymentError("INITIALIZE_STATE_MISMATCH", "Instrument initialization state changed after preparation");
  }
  const payload = lifecyclePayload(operation.preparedPayload, "INITIALIZE") as InitializationPayload;
  const expectedAddress = await deriveInstrumentLifecycleAddresses(options.programId, uuidBytes(instrument.id));
  if (payload.instrumentAddress !== expectedAddress.instrumentAddress) {
    throw new InstrumentDeploymentError("INITIALIZE_STATE_MISMATCH", "Stored Instrument PDA is not canonical");
  }
  const slot = await finalizedTransaction(database, rpc, operation, transactionSignature, actor, now, "Initialization");
  const response = await rpc.request("getAccountInfo", [payload.instrumentAddress,
    { commitment: "finalized", encoding: "base64", minContextSlot: slot }]);
  verifyConfirmedInstrument(contextualProgramAccount(response, slot, options.programId), instrument, "DEPLOYING");
  if (controlled) {
    const setup = await buildControlledMintSetup({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
      administrator: actor.walletAddress, bondRentLamports: 1n, settlementRentLamports: 1n, totalSupply: instrument.totalSupply });
    if (setup.bondMint !== instrument.mintAddress || setup.settlementMint !== instrument.settlementAsset.mintAddress) {
      throw new InstrumentDeploymentError("INITIALIZE_STATE_MISMATCH", "Controlled mint addresses are not canonical");
    }
    await verifyControlledRegistryAccounts(rpc, instrument, options, slot);
    const treasury = await rpc.request("getAccountInfo", [setup.treasuryTokenAccount, { commitment: "finalized", encoding: "base64", minContextSlot: slot }]);
    controlledTokenState(accountData(treasury, slot), setup.treasuryTokenAccount,
      { mint: instrument.mintAddress!, owner: actor.walletAddress, amount: instrument.totalSupply }, "TREASURY_STATE_MISMATCH");
  }
  await database.$transaction(async transaction => {
    const attempt = await transaction.blockchainTransaction.updateMany({ where: { id: operationId,
      status: { in: [...CONFIRMABLE] }, OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now, finalizedAt: now, lastErrorCode: null } });
    const updated = await transaction.instrument.updateMany({ where: { id: instrument.id, status: "DRAFT",
      circulatingSupply: controlled ? 0n : instrument.totalSupply }, data: { status: "DEPLOYING", version: { increment: 1 } } });
    if (attempt.count !== 1 || updated.count !== 1) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Initialization state changed concurrently");
    await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_INITIALIZED", entityType: "Instrument", entityId: instrument.id,
      correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { signature: transactionSignature, finalizedSlot: slot,
        instrumentAddress: payload.instrumentAddress, status: "DEPLOYING", nextPhase: controlled ? "DISTRIBUTION" : "ACTIVATE" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "INITIALIZE" as const, instrumentAddress: payload.instrumentAddress, nextPhase: controlled ? "DISTRIBUTION" as const : "ACTIVATE" as const };
}

export async function prepareInstrumentActivation(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  if (!UUID.test(instrumentId)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument identifier is invalid", 400);
  const resumed = await expireOrResumeLifecycle(database, rpc, instrumentId, actor, options, "ACTIVATE");
  if (resumed) return resumed;
  const instrument = await database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
  if (!instrument) throw new InstrumentDeploymentError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
  if (instrument.issuerAuthority !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
  if (instrument.status !== "DEPLOYING" || instrument.circulatingSupply !== instrument.totalSupply ||
      !instrument.mintAddress || instrument.programId !== options.programId) {
    throw new InstrumentDeploymentError("ACTIVATION_NOT_AVAILABLE", "Activation requires an initialized and fully distributed instrument");
  }
  const controlled = requireControlledRegistry(instrument, options);
  const initialized = await database.blockchainTransaction.findFirst({ where: { instrumentId,
    operationType: "INSTRUMENT_INITIALIZE", status: "FINALIZED" }, select: { id: true } });
  const distributionAttempt = await database.blockchainTransaction.findFirst({ where: { instrumentId,
    operationType: "INSTRUMENT_DISTRIBUTION", status: "FINALIZED" }, orderBy: { createdAt: "desc" }, select: { preparedPayload: true } });
  if (!initialized || !distributionAttempt) throw new InstrumentDeploymentError("ACTIVATION_PREREQUISITE_MISSING", "Finalized initialize and distribution phases are required");
  const distribution = distributionPayload(distributionAttempt.preparedPayload);
  if (distribution.bondMint !== instrument.mintAddress) throw new InstrumentDeploymentError("ACTIVATION_STATE_MISMATCH", "Distribution mint does not match the instrument");
  await requireEligibleDistribution(database, distribution, options);
  if (await rpc.request("getGenesisHash", []) !== options.expectedGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration", 503);
  }
  const chainAccounts = await Promise.all(distribution.allocations.map(allocation => rpc.request("getAccountInfo",
    [allocation.tokenAccount, { commitment: "finalized", encoding: "base64" }])));
  distribution.allocations.forEach((allocation, index) => {
    const data = uncontextualizedAccountData(chainAccounts[index]);
    if (!data) throw new InstrumentDeploymentError("ACTIVATION_STATE_MISMATCH", "A distributed holder account is missing");
    tokenAccountState(data, { mint: distribution.bondMint, owner: allocation.walletAddress,
      amount: BigInt(allocation.amount) }, "ACTIVATION_STATE_MISMATCH");
    if (controlled) controlledTokenState(data, allocation.tokenAccount,
      { mint: distribution.bondMint, owner: allocation.walletAddress, amount: BigInt(allocation.amount) }, "ACTIVATION_STATE_MISMATCH");
  });
  const plan = await (controlled ? buildControlledInstrumentActivation : buildInstrumentActivation)({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
    issuerAuthority: actor.walletAddress, bondMint: instrument.mintAddress,
    holderTokenAccounts: distribution.allocations.map(row => row.tokenAccount) });
  const { recentBlockhash, lastValidBlockHeight } = await latestBlockhash(rpc);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions: [plan.instruction],
    feePayer: actor.walletAddress, recentBlockhash, lastValidBlockHeight });
  const payload = { instrumentAddress: plan.instrumentAddress, bondMint: distribution.bondMint,
    treasuryTokenAccount: distribution.treasuryTokenAccount, allocations: distribution.allocations, ...await controlledMetadata(instrument, options) };
  try {
    const operation = await database.$transaction(async transaction => {
      const row = await transaction.blockchainTransaction.create({ data: { instrumentId, operationType: "INSTRUMENT_ACTIVATE",
        status: "PREPARED", recentBlockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64, preparedPayload: payload } });
      await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
        event: "INSTRUMENT_ACTIVATION_PREPARED", entityType: "BlockchainTransaction", entityId: row.id,
        correlationId: actor.correlationId, blockchainTransactionId: row.id,
        metadataJson: { instrumentId, instrumentAddress: plan.instrumentAddress,
          holderTokenAccounts: distribution.allocations.map(row => row.tokenAccount), onChain: false } } });
      return row;
    });
    return { operationId: operation.id, phase: "ACTIVATE" as const, cluster: options.cluster,
      requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
      lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
      instrumentAddress: plan.instrumentAddress, allocations: distribution.allocations, ...await controlledMetadata(instrument, options), resumed: false };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "P2002") throw error;
    const concurrent = await database.blockchainTransaction.findFirst({ where: { instrumentId,
      operationType: "INSTRUMENT_ACTIVATE", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" }, include: { instrument: true } });
    if (!concurrent) throw error;
    return preparedLifecycleResponse(concurrent, options.cluster, "ACTIVATE", options);
  }
}

export async function confirmInstrumentActivation(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  operationId: string, transactionSignature: string, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) || !SIGNATURE.test(transactionSignature)) {
    throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signature is invalid", 400);
  }
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId },
    include: { instrument: { include: { settlementAsset: true } } } });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId || operation.operationType !== "INSTRUMENT_ACTIVATE") {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Activation attempt was not found", 404);
  }
  const controlled = requireControlledRegistry(instrument, options);
  if (actor.walletAddress !== instrument.issuerAuthority || operation.requiredSigner !== actor.walletAddress) {
    throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet does not match the prepared signer", 403);
  }
  if (operation.status === "FINALIZED") {
    if (operation.signature !== transactionSignature) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Finalized attempt has another signature");
    return { operationId, signature: transactionSignature, status: "FINALIZED" as const, phase: "ACTIVATE" as const };
  }
  if (operation.networkGenesisHash !== options.expectedGenesisHash || instrument.status !== "DEPLOYING" || !instrument.mintAddress) {
    throw new InstrumentDeploymentError("ACTIVATION_STATE_MISMATCH", "Instrument activation state changed after preparation");
  }
  const payload = lifecyclePayload(operation.preparedPayload, "ACTIVATE") as ActivationPayload;
  const expectedAddress = await deriveInstrumentLifecycleAddresses(options.programId, uuidBytes(instrument.id));
  if (payload.instrumentAddress !== expectedAddress.instrumentAddress) {
    throw new InstrumentDeploymentError("ACTIVATION_STATE_MISMATCH", "Stored Instrument PDA is not canonical");
  }
  const distribution = { bondMint: instrument.mintAddress, treasuryTokenAccount: instrument.mintAddress,
    allocations: payload.allocations };
  await requireEligibleDistribution(database, distribution, options);
  const slot = await finalizedTransaction(database, rpc, operation, transactionSignature, actor, now, "Activation");
  const [instrumentResponse, ...holderResponses] = await Promise.all([
    rpc.request("getAccountInfo", [payload.instrumentAddress,
      { commitment: "finalized", encoding: "base64", minContextSlot: slot }]),
    ...payload.allocations.map(allocation => rpc.request("getAccountInfo", [allocation.tokenAccount,
      { commitment: "finalized", encoding: "base64", minContextSlot: slot }]))
  ]);
  verifyConfirmedInstrument(contextualProgramAccount(instrumentResponse, slot, options.programId), instrument, "ACTIVE");
  payload.allocations.forEach((allocation, index) => tokenAccountState(accountData(holderResponses[index], slot),
    { mint: instrument.mintAddress!, owner: allocation.walletAddress, amount: BigInt(allocation.amount) },
    "ACTIVATION_STATE_MISMATCH"));
  if (controlled) {
    payload.allocations.forEach((allocation, index) => controlledTokenState(accountData(holderResponses[index], slot), allocation.tokenAccount,
      { mint: instrument.mintAddress!, owner: allocation.walletAddress, amount: BigInt(allocation.amount) }, "ACTIVATION_STATE_MISMATCH"));
    await verifyControlledRegistryAccounts(rpc, instrument, options, slot, payload.allocations);
  }
  await database.$transaction(async transaction => {
    const attempt = await transaction.blockchainTransaction.updateMany({ where: { id: operationId,
      status: { in: [...CONFIRMABLE] }, OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now, finalizedAt: now, lastErrorCode: null } });
    const updated = await transaction.instrument.updateMany({ where: { id: instrument.id, status: "DEPLOYING",
      circulatingSupply: instrument.totalSupply }, data: { status: "ACTIVE", version: { increment: 1 } } });
    if (attempt.count !== 1 || updated.count !== 1) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Activation state changed concurrently");
    await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_ACTIVATED", entityType: "Instrument", entityId: instrument.id,
      correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { signature: transactionSignature, finalizedSlot: slot,
        instrumentAddress: payload.instrumentAddress, status: "ACTIVE" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "ACTIVATE" as const, instrumentAddress: payload.instrumentAddress };
}

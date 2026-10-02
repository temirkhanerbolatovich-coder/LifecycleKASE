import type { PrismaClient } from "@prisma/client";
import {
  BOND_MINT_SIZE,
  buildInstrumentDistribution,
  buildInstrumentMintSetup,
  decodePublicKey,
  encodePublicKey,
  serializeUnsignedInstructionsTransaction,
  SETTLEMENT_MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  verifyFinalizedTransaction,
  type SolanaRpc
} from "@lifecycle-kase/solana-client";

import type { InstrumentActor } from "./instrument-registry.js";
import { uuidBytes } from "./snapshot-registration.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const CONFIRMABLE = ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"] as const;

type StoredMintSetupAttempt = {
  id: string;
  status: string;
  preparedTransactionBase64: string | null;
  requiredSigner: string | null;
  networkGenesisHash: string | null;
  recentBlockhash: string | null;
  lastValidBlockHeight: bigint | null;
  preparedPayload?: unknown;
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
  return { cluster, rpcEndpoint, expectedGenesisHash, programId,
    rpcTimeoutMs: positiveInteger(environment.SOLANA_RPC_TIMEOUT_MS, 15_000, "SOLANA_RPC_TIMEOUT_MS") };
}

function object(value: unknown, message = "Solana RPC response is invalid"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", message, 503);
  return value as Record<string, unknown>;
}

function safeNumber(value: unknown, message = "Solana RPC numeric value is invalid"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", message, 503);
  return value as number;
}

function preparedResponse(existing: StoredMintSetupAttempt, cluster: "localnet" | "devnet") {
  if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
      !existing.recentBlockhash || existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored mint setup attempt is incomplete");
  }
  return { operationId: existing.id, phase: "MINT_SETUP" as const, cluster,
    requiredSigner: existing.requiredSigner, networkGenesisHash: existing.networkGenesisHash,
    recentBlockhash: existing.recentBlockhash, lastValidBlockHeight: Number(existing.lastValidBlockHeight),
    serializedTransactionBase64: existing.preparedTransactionBase64,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const, resumed: true };
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

function preparedDistributionResponse(existing: StoredMintSetupAttempt, cluster: "localnet" | "devnet") {
  if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
      !existing.recentBlockhash || existing.lastValidBlockHeight === null) {
    throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution attempt is incomplete");
  }
  const payload = distributionPayload(existing.preparedPayload);
  return { operationId: existing.id, phase: "DISTRIBUTION" as const, cluster,
    requiredSigner: existing.requiredSigner, networkGenesisHash: existing.networkGenesisHash,
    recentBlockhash: existing.recentBlockhash, lastValidBlockHeight: Number(existing.lastValidBlockHeight),
    serializedTransactionBase64: existing.preparedTransactionBase64,
    transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const, ...payload, resumed: true };
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
  if (instrument.status !== "DRAFT" || instrument.mintAddress || instrument.settlementAsset.mintAddress) {
    throw new InstrumentDeploymentError("MINT_SETUP_NOT_AVAILABLE", "Mint setup is available only for an untouched DRAFT instrument");
  }
  if (instrument.totalSupply !== 35n || instrument.circulatingSupply !== 0n) throw new InstrumentDeploymentError("INSTRUMENT_STATE_MISMATCH", "Canonical draft supply is invalid");
  const genesis = await rpc.request("getGenesisHash", []);
  if (genesis !== options.expectedGenesisHash) throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration", 503);
  const rent = await Promise.all([BOND_MINT_SIZE, SETTLEMENT_MINT_SIZE].map(async size =>
    BigInt(safeNumber(await rpc.request("getMinimumBalanceForRentExemption", [size, { commitment: "finalized" }])))));
  const plan = await buildInstrumentMintSetup({ programId: options.programId, instrumentId: uuidBytes(instrument.id),
    administrator: actor.walletAddress, bondRentLamports: rent[0]!, settlementRentLamports: rent[1]!, totalSupply: instrument.totalSupply });
  const accounts = await Promise.all([plan.bondMint, plan.settlementMint, plan.treasuryTokenAccount].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64" }])));
  if (accounts.some(value => object(value)["value"] !== null)) throw new InstrumentDeploymentError("MINT_ADDRESS_OCCUPIED", "A deterministic mint or treasury address is already occupied");
  return { instrument, plan };
}

export async function prepareInstrumentMintSetup(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  actor: InstrumentActor, options: InstrumentDeploymentOptions) {
  const existing = await database.blockchainTransaction.findFirst({ where: { instrumentId, operationType: "INSTRUMENT_MINT_SETUP",
    status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" } });
  if (existing) {
    if (!existing.preparedTransactionBase64 || !existing.requiredSigner || !existing.networkGenesisHash ||
        !existing.recentBlockhash || existing.lastValidBlockHeight === null) throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored mint setup attempt is incomplete");
    const lastValidBlockHeight = Number(existing.lastValidBlockHeight);
    if (existing.status !== "PREPARED" || safeNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }])) <= lastValidBlockHeight) {
      return preparedResponse(existing, options.cluster);
    }
    await database.blockchainTransaction.updateMany({ where: { id: existing.id, status: "PREPARED" },
      data: { status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED" } });
  }
  const { plan } = await planFor(database, rpc, instrumentId, actor, options);
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
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64 } });
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
      operationType: "INSTRUMENT_MINT_SETUP", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" } });
    if (!concurrent) throw error;
    return preparedResponse(concurrent, options.cluster);
  }
  return { operationId: operation.id, phase: "MINT_SETUP" as const, cluster: options.cluster,
    requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
    lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    bondMint: plan.bondMint, settlementMint: plan.settlementMint, treasuryTokenAccount: plan.treasuryTokenAccount, resumed: false };
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

function verifyMint(data: Buffer, input: { decimals: number; supply: bigint; permanentDelegate?: string }) {
  if (data.length < 82 || data.readUInt32LE(0) !== 0 || data.readBigUInt64LE(36) !== input.supply ||
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
    status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" } });
  if (existing) {
    const lastValidBlockHeight = existing.lastValidBlockHeight === null ? null : Number(existing.lastValidBlockHeight);
    if (lastValidBlockHeight === null) throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_INVALID", "Stored distribution attempt is incomplete");
    if (existing.status !== "PREPARED" || safeNumber(await rpc.request("getBlockHeight", [{ commitment: "finalized" }])) <= lastValidBlockHeight) {
      return preparedDistributionResponse(existing, options.cluster);
    }
    await database.blockchainTransaction.updateMany({ where: { id: existing.id, status: "PREPARED" },
      data: { status: "FAILED", lastErrorCode: "BLOCKHASH_EXPIRED" } });
  }
  const instrument = await database.instrument.findUnique({ where: { id: instrumentId }, include: { settlementAsset: true } });
  if (!instrument) throw new InstrumentDeploymentError("INSTRUMENT_NOT_FOUND", "Instrument was not found", 404);
  if (instrument.issuerAuthority !== actor.walletAddress) throw new InstrumentDeploymentError("WALLET_MISMATCH", "Session wallet is not the instrument issuer", 403);
  if (instrument.status !== "DRAFT" || !instrument.mintAddress || !instrument.settlementAsset.mintAddress || instrument.circulatingSupply !== 0n) {
    throw new InstrumentDeploymentError("DISTRIBUTION_NOT_AVAILABLE", "Distribution requires a confirmed mint setup and zero circulating supply");
  }
  const finalizedSetup = await database.blockchainTransaction.findFirst({ where: {
    instrumentId, operationType: "INSTRUMENT_MINT_SETUP", status: "FINALIZED"
  }, select: { id: true } });
  if (!finalizedSetup) throw new InstrumentDeploymentError("MINT_SETUP_REQUIRED", "A finalized mint setup is required before distribution");
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
  for (let index = 0; index < plan.allocations.length; index += 1) {
    const current = uncontextualizedAccountData(accountResponses[index + 1]);
    if (current) tokenAccountState(current, { mint: instrument.mintAddress,
      owner: plan.allocations[index]!.walletAddress, amount: 0n }, "DISTRIBUTION_STATE_MISMATCH");
  }
  const latest = object(await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]));
  const value = object(latest["value"]);
  const recentBlockhash = value["blockhash"];
  const lastValidBlockHeight = safeNumber(value["lastValidBlockHeight"]);
  if (typeof recentBlockhash !== "string") throw new InstrumentDeploymentError("INVALID_RPC_RESPONSE", "Latest blockhash is invalid", 503);
  const serializedTransactionBase64 = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions,
    feePayer: actor.walletAddress, recentBlockhash, lastValidBlockHeight });
  const payload: DistributionPayload = { bondMint: instrument.mintAddress, treasuryTokenAccount: plan.treasuryTokenAccount,
    allocations: plan.allocations.map((allocation, index) => ({ investorId: selected[index]!.investorId,
      walletAddress: allocation.walletAddress, tokenAccount: allocation.tokenAccount,
      amount: allocation.amount.toString() })) };
  let operation: { id: string };
  try {
    operation = await database.$transaction(async transaction => {
      const row = await transaction.blockchainTransaction.create({ data: { instrumentId, operationType: "INSTRUMENT_DISTRIBUTION",
        status: "PREPARED", recentBlockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight), requiredSigner: actor.walletAddress,
        networkGenesisHash: options.expectedGenesisHash, preparedTransactionBase64: serializedTransactionBase64, preparedPayload: payload } });
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
      operationType: "INSTRUMENT_DISTRIBUTION", status: { in: [...CONFIRMABLE] } }, orderBy: { createdAt: "desc" } });
    if (!concurrent) throw error;
    return preparedDistributionResponse(concurrent, options.cluster);
  }
  return { operationId: operation.id, phase: "DISTRIBUTION" as const, cluster: options.cluster,
    requiredSigner: actor.walletAddress, networkGenesisHash: options.expectedGenesisHash, recentBlockhash,
    lastValidBlockHeight, serializedTransactionBase64, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64" as const,
    ...payload, resumed: false };
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
  if (payload.bondMint !== instrument.mintAddress || instrument.status !== "DRAFT" || instrument.circulatingSupply !== 0n) {
    throw new InstrumentDeploymentError("DISTRIBUTION_STATE_MISMATCH", "Instrument distribution state changed after preparation");
  }
  if (await rpc.request("getGenesisHash", []) !== operation.networkGenesisHash) {
    throw new InstrumentDeploymentError("WRONG_SOLANA_NETWORK", "Confirmation RPC is on another network", 503);
  }
  const rpcTransaction = await rpc.request("getTransaction", [transactionSignature,
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  if (rpcTransaction === null) {
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: { in: [...CONFIRMABLE] } },
      data: { signature: transactionSignature, status: "UNKNOWN_CONFIRMATION", submittedAt: now, lastErrorCode: "TRANSACTION_NOT_FINALIZED" } });
    throw new InstrumentDeploymentError("TRANSACTION_NOT_FINALIZED", "Transaction is not finalized yet");
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
  for (let index = 0; index < payload.allocations.length; index += 1) {
    const allocation = payload.allocations[index]!;
    tokenAccountState(accountData(chainAccounts[index + 1], slot), { mint: payload.bondMint,
      owner: allocation.walletAddress, amount: BigInt(allocation.amount) }, "DISTRIBUTION_STATE_MISMATCH");
  }
  await database.$transaction(async transaction => {
    const attempt = await transaction.blockchainTransaction.updateMany({ where: { id: operationId,
      status: { in: [...CONFIRMABLE] }, OR: [{ signature: null }, { signature: transactionSignature }] },
      data: { signature: transactionSignature, status: "FINALIZED", submittedAt: now, finalizedAt: now, lastErrorCode: null } });
    const updated = await transaction.instrument.updateMany({ where: { id: instrument.id, status: "DRAFT", circulatingSupply: 0n,
      mintAddress: payload.bondMint }, data: { circulatingSupply: instrument.totalSupply, version: { increment: 1 } } });
    if (attempt.count !== 1 || updated.count !== 1) throw new InstrumentDeploymentError("DEPLOYMENT_CONFLICT", "Distribution state changed concurrently");
    await transaction.auditLog.create({ data: { actorId: actor.id, actorWallet: actor.walletAddress,
      event: "INSTRUMENT_DISTRIBUTION_FINALIZED", entityType: "Instrument", entityId: instrument.id,
      correlationId: actor.correlationId, blockchainTransactionId: operationId,
      metadataJson: { signature: transactionSignature, finalizedSlot: slot, bondMint: payload.bondMint,
        treasuryTokenAccount: payload.treasuryTokenAccount, allocations: payload.allocations,
        circulatingSupply: instrument.totalSupply.toString(), status: "DRAFT", nextPhase: "INITIALIZE" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "DISTRIBUTION" as const, allocations: payload.allocations, nextPhase: "INITIALIZE" as const };
}

export async function confirmInstrumentMintSetup(database: PrismaClient, rpc: SolanaRpc, instrumentId: string,
  operationId: string, transactionSignature: string, actor: InstrumentActor, options: InstrumentDeploymentOptions, now = new Date()) {
  if (!UUID.test(instrumentId) || !UUID.test(operationId) || !SIGNATURE.test(transactionSignature)) throw new InstrumentDeploymentError("INVALID_REQUEST", "Instrument, operation, or signature is invalid", 400);
  const operation = await database.blockchainTransaction.findUnique({ where: { id: operationId }, include: { instrument: { include: { settlementAsset: true } } } });
  const instrument = operation?.instrument;
  if (!operation || !instrument || instrument.id !== instrumentId || operation.operationType !== "INSTRUMENT_MINT_SETUP") throw new InstrumentDeploymentError("DEPLOYMENT_ATTEMPT_NOT_FOUND", "Mint setup attempt was not found", 404);
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
    await database.blockchainTransaction.updateMany({ where: { id: operationId, status: { in: [...CONFIRMABLE] } },
      data: { signature: transactionSignature, status: "UNKNOWN_CONFIRMATION", submittedAt: now, lastErrorCode: "TRANSACTION_NOT_FINALIZED" } });
    throw new InstrumentDeploymentError("TRANSACTION_NOT_FINALIZED", "Transaction is not finalized yet");
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
  const plan = await buildInstrumentMintSetup({ programId: options.programId, instrumentId: uuidBytes(instrument.id), administrator: actor.walletAddress,
    bondRentLamports: 0n, settlementRentLamports: 0n, totalSupply: instrument.totalSupply });
  const [bondData, settlementData, treasuryData] = await Promise.all([plan.bondMint, plan.settlementMint, plan.treasuryTokenAccount].map(address =>
    rpc.request("getAccountInfo", [address, { commitment: "finalized", encoding: "base64", minContextSlot: slot }])));
  verifyMint(accountData(bondData, slot), { decimals: 0, supply: instrument.totalSupply, permanentDelegate: plan.instrumentAuthority });
  verifyMint(accountData(settlementData, slot), { decimals: 6, supply: 0n });
  const treasury = accountData(treasuryData, slot);
  if (treasury.length < 165 || encodePublicKey(treasury.subarray(0, 32)) !== plan.bondMint ||
      encodePublicKey(treasury.subarray(32, 64)) !== actor.walletAddress || treasury.readBigUInt64LE(64) !== instrument.totalSupply) {
    throw new InstrumentDeploymentError("TREASURY_STATE_MISMATCH", "Finalized treasury does not contain the canonical supply");
  }
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
        settlementMint: plan.settlementMint, treasuryTokenAccount: plan.treasuryTokenAccount, status: "DRAFT", nextPhase: "DISTRIBUTION" } } });
  });
  return { operationId, signature: transactionSignature, finalizedSlot: slot, status: "FINALIZED" as const,
    phase: "MINT_SETUP" as const, bondMint: plan.bondMint, settlementMint: plan.settlementMint,
    treasuryTokenAccount: plan.treasuryTokenAccount, nextPhase: "DISTRIBUTION" as const };
}

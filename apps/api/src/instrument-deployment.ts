import type { PrismaClient } from "@prisma/client";
import {
  BOND_MINT_SIZE,
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
      data: { mintAddress: plan.bondMint, version: { increment: 1 } } });
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

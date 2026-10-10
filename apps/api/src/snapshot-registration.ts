import { isDeepStrictEqual } from "node:util";

import type { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment, type CanonicalSnapshotV2 } from "@lifecycle-kase/domain";
import {
  buildSnapshotRegistrationInstruction,
  decodePublicKey,
  serializeUnsignedSnapshotRegistrationTransaction,
  type SolanaRpc
} from "@lifecycle-kase/solana-client";

import { MAX_SNAPSHOT_GRACE_SECONDS, SnapshotPreparationError } from "./snapshot-candidate.js";

export type SnapshotRegistrationOptions = {
  expectedGenesisHash: string;
  now: Date;
  graceSeconds: number;
};

export function uuidBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SnapshotPreparationError("INVALID_SNAPSHOT", "Snapshot contains an invalid UUID");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function canonicalCommitment(raw: unknown) {
  try {
    const snapshot = raw as CanonicalSnapshotV2;
    return createSnapshotV2Commitment({
      actionId: snapshot.action_id,
      instrumentId: snapshot.instrument_id,
      cluster: snapshot.cluster,
      networkGenesisHash: snapshot.network_genesis_hash,
      mintAddress: snapshot.mint_address,
      recordAt: snapshot.record_at,
      solanaSlot: BigInt(snapshot.solana_slot),
      blockTime: snapshot.block_time,
      createdAt: snapshot.created_at,
      mintSupply: BigInt(snapshot.mint_supply),
      investors: snapshot.investors.map((investor) => ({
        investorId: investor.investor_id,
        eligibilityStatus: investor.eligibility_status,
        wallets: investor.wallets.map((wallet) => ({
          walletId: wallet.wallet_id,
          walletAddress: wallet.wallet_address,
          walletStatus: wallet.wallet_status,
          tokenAccounts: wallet.token_accounts.map((account) => ({
            address: account.address, balance: BigInt(account.balance)
          }))
        }))
      }))
    });
  } catch {
    throw new SnapshotPreparationError("INVALID_SNAPSHOT", "Persisted snapshot cannot be reconstructed");
  }
}

/** Returns an unsigned instruction plan for the issuer wallet; it neither signs nor sends. */
export async function preparePendingSnapshotRegistration(
  database: PrismaClient,
  rpc: SolanaRpc,
  snapshotId: string,
  options: SnapshotRegistrationOptions
) {
  if (!Number.isFinite(options.now.getTime()) || !Number.isSafeInteger(options.graceSeconds) ||
      options.graceSeconds < 0 || options.graceSeconds > MAX_SNAPSHOT_GRACE_SECONDS) {
    throw new SnapshotPreparationError("INVALID_REGISTRATION_TIME", "Registration time or grace window is invalid");
  }
  const stored = await database.snapshot.findUnique({
    where: { id: snapshotId },
    include: { corporateAction: { include: { instrument: true } } }
  });
  if (!stored) throw new SnapshotPreparationError("SNAPSHOT_NOT_FOUND", "Snapshot was not found");
  const action = stored.corporateAction;
  const instrument = action.instrument;
  if (stored.status !== "PENDING_REGISTRATION" || action.status !== "SCHEDULED" ||
      instrument.status !== "ACTIVE" || !instrument.programId || !instrument.mintAddress) {
    throw new SnapshotPreparationError("SNAPSHOT_NOT_READY", "Snapshot or action is not ready for registration");
  }
  const elapsed = options.now.getTime() - action.recordAt.getTime();
  if (elapsed < 0) {
    throw new SnapshotPreparationError("RECORD_DATE_NOT_REACHED", "Snapshot record-date window has not opened");
  }
  if (elapsed > options.graceSeconds * 1000) {
    throw new SnapshotPreparationError("SNAPSHOT_WINDOW_MISSED", "Registration is outside the record-date window");
  }
  const commitment = canonicalCommitment(stored.canonicalJson);
  const payload = commitment.snapshot;
  if (!isDeepStrictEqual(stored.canonicalJson, payload) ||
      commitment.sha256 !== Buffer.from(stored.snapshotHash).toString("hex") ||
      payload.action_id !== action.id || payload.instrument_id !== instrument.id ||
      payload.mint_address !== instrument.mintAddress ||
      payload.network_genesis_hash !== stored.networkGenesisHash ||
      payload.record_at !== action.recordAt.toISOString() ||
      payload.solana_slot !== stored.solanaSlot.toString() ||
      payload.block_time !== stored.blockTime.toISOString() ||
      payload.investor_count !== stored.investorCount || payload.wallet_count !== stored.walletCount ||
      payload.total_balance !== stored.totalBalance.toString() ||
      payload.mint_supply !== stored.mintSupply.toString()) {
    throw new SnapshotPreparationError("SNAPSHOT_CHANGED", "Persisted snapshot no longer matches its canonical commitment");
  }
  if (payload.network_genesis_hash !== options.expectedGenesisHash) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "Snapshot network does not match configuration");
  }
  const genesisHash = await rpc.request("getGenesisHash", []);
  if (genesisHash !== options.expectedGenesisHash) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration");
  }
  if (stored.solanaSlot < 1n || stored.solanaSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SnapshotPreparationError("INVALID_SNAPSHOT", "Snapshot slot cannot be queried safely");
  }
  const finalizedSlot = await rpc.request("getSlot", [{ commitment: "finalized" }]);
  if (!Number.isSafeInteger(finalizedSlot) || (finalizedSlot as number) < Number(stored.solanaSlot)) {
    throw new SnapshotPreparationError("SNAPSHOT_SLOT_UNFINALIZED", "Snapshot capture slot is not finalized");
  }
  const blockTime = await rpc.request("getBlockTime", [Number(stored.solanaSlot)]);
  if (!Number.isSafeInteger(blockTime) || new Date((blockTime as number) * 1000).toISOString() !== payload.block_time) {
    throw new SnapshotPreparationError("SNAPSHOT_BLOCK_TIME_CHANGED", "Finalized slot block time differs from snapshot");
  }
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: instrument.programId,
    instrumentId: uuidBytes(instrument.id),
    actionId: uuidBytes(action.id),
    issuerAuthority: instrument.issuerAuthority,
    bondMint: instrument.mintAddress,
    snapshotHash: commitment.sha256,
    snapshotSlot: stored.solanaSlot,
    investorCount: stored.investorCount,
    walletCount: stored.walletCount,
    totalBalance: stored.totalBalance,
    mintSupply: stored.mintSupply
  });
  const latest = await rpc.request("getLatestBlockhash", [{ commitment: "finalized" }]);
  const value = latest && typeof latest === "object" && "value" in latest ? latest.value : null;
  if (!value || typeof value !== "object" || !("blockhash" in value) ||
      !("lastValidBlockHeight" in value) || typeof value.blockhash !== "string" ||
      !Number.isSafeInteger(value.lastValidBlockHeight) || (value.lastValidBlockHeight as number) < 0) {
    throw new SnapshotPreparationError("INVALID_BLOCKHASH", "RPC returned an invalid finalized blockhash");
  }
  try {
    decodePublicKey(value.blockhash);
  } catch {
    throw new SnapshotPreparationError("INVALID_BLOCKHASH", "RPC returned an invalid finalized blockhash");
  }
  const serializedTransactionBase64 = serializeUnsignedSnapshotRegistrationTransaction({
    instruction,
    feePayer: instrument.issuerAuthority,
    recentBlockhash: value.blockhash,
    lastValidBlockHeight: value.lastValidBlockHeight as number
  });
  return {
    corporateActionId: action.id,
    cluster: payload.cluster,
    snapshotId,
    snapshotHash: commitment.sha256,
    requiredSigner: instrument.issuerAuthority,
    networkGenesisHash: options.expectedGenesisHash,
    recentBlockhash: value.blockhash,
    lastValidBlockHeight: value.lastValidBlockHeight as number,
    programId: instruction.programId,
    instrumentAddress: instruction.instrumentAddress,
    actionAddress: instruction.actionAddress,
    accounts: instruction.accounts,
    instructionDataBase64: Buffer.from(instruction.data).toString("base64"),
    serializedTransactionBase64,
    effect: "Register immutable snapshot commitment for corporate action " + action.id
  };
}

import type { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import {
  collectToken2022Holders,
  decodePublicKey,
  groupHoldersByInvestor,
  type SolanaRpc,
  type WalletMapping
} from "@lifecycle-kase/solana-client";

export class SnapshotPreparationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SnapshotPreparationError";
  }
}

export const MAX_SNAPSHOT_GRACE_SECONDS = 300;

export type SnapshotCandidateOptions = {
  cluster: "localnet" | "devnet";
  expectedGenesisHash: string;
  walletNetwork: string;
  graceSeconds: number;
  now: Date;
};

function validPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    decodePublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/** Builds a read-only snapshot candidate. It does not authorize, persist, or register a snapshot. */
export async function prepareSnapshotCandidate(
  database: PrismaClient,
  rpc: SolanaRpc,
  actionId: string,
  options: SnapshotCandidateOptions
) {
  if (!Number.isSafeInteger(options.graceSeconds) || options.graceSeconds < 0 ||
      options.graceSeconds > MAX_SNAPSHOT_GRACE_SECONDS) {
    throw new SnapshotPreparationError("INVALID_GRACE_WINDOW", "Snapshot grace window is invalid");
  }
  if (!Number.isFinite(options.now.getTime())) {
    throw new SnapshotPreparationError("INVALID_TIME", "Current time is invalid");
  }
  if (!validPublicKey(options.expectedGenesisHash)) {
    throw new SnapshotPreparationError("INVALID_GENESIS_HASH", "Expected genesis hash is invalid");
  }
  const action = await database.corporateAction.findUnique({
    where: { id: actionId },
    include: { instrument: true, snapshot: true }
  });
  if (!action) {
    throw new SnapshotPreparationError("ACTION_NOT_FOUND", "Corporate action was not found");
  }
  if (action.status !== "SCHEDULED" || action.snapshot) {
    throw new SnapshotPreparationError("ACTION_NOT_READY", "Corporate action is not ready for a snapshot");
  }
  if (action.instrument.status !== "ACTIVE" || !action.instrument.mintAddress) {
    throw new SnapshotPreparationError("INSTRUMENT_NOT_ACTIVE", "Instrument mint is not active");
  }
  const sinceRecordMs = options.now.getTime() - action.recordAt.getTime();
  if (sinceRecordMs < 0 || sinceRecordMs > options.graceSeconds * 1000) {
    throw new SnapshotPreparationError("SNAPSHOT_WINDOW_MISSED", "Snapshot is outside its record-date window");
  }
  const genesisHash = await rpc.request("getGenesisHash", []);
  if (genesisHash !== options.expectedGenesisHash) {
    throw new SnapshotPreparationError("WRONG_SOLANA_NETWORK", "RPC genesis hash does not match configuration");
  }

  const capture = await collectToken2022Holders(rpc, action.instrument.mintAddress);
  if (capture.supply !== action.instrument.circulatingSupply) {
    throw new SnapshotPreparationError("INSTRUMENT_SUPPLY_STALE", "Instrument supply differs from finalized mint supply");
  }
  const blockTimeSeconds = await rpc.request("getBlockTime", [capture.slot]);
  if (!Number.isSafeInteger(blockTimeSeconds) || (blockTimeSeconds as number) < 0) {
    throw new SnapshotPreparationError("BLOCK_TIME_UNAVAILABLE", "Finalized slot block time is unavailable");
  }
  const blockTime = new Date((blockTimeSeconds as number) * 1000);
  if (!Number.isFinite(blockTime.getTime())) {
    throw new SnapshotPreparationError("BLOCK_TIME_UNAVAILABLE", "Finalized slot block time is invalid");
  }
  if (blockTime < action.recordAt || blockTime > options.now) {
    throw new SnapshotPreparationError(
      "SNAPSHOT_SLOT_OUTSIDE_WINDOW",
      "Finalized capture slot is outside the elapsed record-date window"
    );
  }
  const walletRows = await database.wallet.findMany({
    where: { address: { in: capture.wallets.map((wallet) => wallet.address) } },
    include: { investor: true }
  });
  const mappings: WalletMapping[] = walletRows
    .filter((wallet) => wallet.investorId !== null)
    .map((wallet) => ({
      walletId: wallet.id,
      investorId: wallet.investorId!,
      address: wallet.address,
      status: wallet.status,
      verified: wallet.verifiedAt !== null &&
        wallet.verifiedAt <= blockTime &&
        wallet.network === options.walletNetwork
    }));
  const registry = groupHoldersByInvestor(capture, mappings);
  if (!registry.canCreateSnapshot) {
    throw new SnapshotPreparationError(
      "HOLDER_REGISTRY_INCOMPLETE",
      `Holder registry has ${registry.unregisteredWallets.length} unknown and ${registry.unverifiedWallets.length} unverified wallets`
    );
  }
  const investorById = new Map(walletRows
    .filter((wallet) => wallet.investor !== null)
    .map((wallet) => [wallet.investor!.id, wallet.investor!]));
  const candidate = createSnapshotV2Commitment({
    actionId: action.id,
    instrumentId: action.instrumentId,
    cluster: options.cluster,
    networkGenesisHash: options.expectedGenesisHash,
    mintAddress: action.instrument.mintAddress,
    recordAt: action.recordAt.toISOString(),
    solanaSlot: BigInt(capture.slot),
    blockTime: blockTime.toISOString(),
    createdAt: options.now.toISOString(),
    mintSupply: capture.supply,
    investors: registry.investors.map((holder) => {
      const investor = investorById.get(holder.investorId);
      if (!investor) {
        throw new SnapshotPreparationError("INVESTOR_NOT_FOUND", "Registered investor was not found");
      }
      return {
        investorId: holder.investorId,
        eligibilityStatus: investor.eligibilityStatus,
        wallets: holder.wallets.map((wallet) => ({
          walletId: wallet.walletId,
          walletAddress: wallet.address,
          walletStatus: wallet.status,
          tokenAccounts: wallet.tokenAccounts
        }))
      };
    })
  });
  return {
    ...candidate,
    captureSlot: capture.slot,
    actionVersion: action.version,
    instrumentVersion: action.instrument.version
  };
}

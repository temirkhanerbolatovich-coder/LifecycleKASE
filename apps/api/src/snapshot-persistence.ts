import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { prepareSnapshotCandidate, SnapshotPreparationError } from "./snapshot-candidate.js";

type SnapshotCandidate = Awaited<ReturnType<typeof prepareSnapshotCandidate>>;

export type SnapshotPersistenceOptions = {
  now: Date;
  graceSeconds: number;
  walletNetwork: string;
};

/** Persists a prepared candidate atomically; it never marks the on-chain action as registered. */
export async function persistSnapshotCandidate(
  database: PrismaClient,
  candidate: SnapshotCandidate,
  options: SnapshotPersistenceOptions
): Promise<{ snapshotId: string; snapshotHash: string; status: "PENDING_REGISTRATION" }> {
  const payload = candidate.snapshot;
  if (
    candidate.canonicalJson !== JSON.stringify(payload) ||
    createHash("sha256").update(candidate.canonicalJson, "utf8").digest("hex") !== candidate.sha256
  ) {
    throw new SnapshotPreparationError("CANDIDATE_CHANGED", "Snapshot candidate changed after preparation");
  }
  if (!Number.isFinite(options.now.getTime()) || !Number.isSafeInteger(options.graceSeconds) || options.graceSeconds < 0) {
    throw new SnapshotPreparationError("INVALID_PERSISTENCE_TIME", "Snapshot persistence time or window is invalid");
  }

  return database.$transaction(async (tx) => {
    const action = await tx.corporateAction.findUnique({
      where: { id: payload.action_id },
      include: { instrument: true, snapshot: true }
    });
    if (
      !action || action.status !== "SCHEDULED" || action.snapshot ||
      action.version !== candidate.actionVersion ||
      action.instrument.version !== candidate.instrumentVersion ||
      action.instrument.status !== "ACTIVE" ||
      action.instrument.mintAddress !== payload.mint_address ||
      action.instrument.circulatingSupply !== BigInt(payload.mint_supply) ||
      action.recordAt.toISOString() !== payload.record_at ||
      action.instrumentId !== payload.instrument_id
    ) {
      throw new SnapshotPreparationError("CANDIDATE_STALE", "Corporate action or instrument changed after capture");
    }
    const sinceRecordMs = options.now.getTime() - action.recordAt.getTime();
    if (sinceRecordMs < 0 || sinceRecordMs > options.graceSeconds * 1000) {
      throw new SnapshotPreparationError("SNAPSHOT_WINDOW_MISSED", "Snapshot is outside its record-date window");
    }

    const candidateWallets = payload.investors.flatMap((investor) =>
      investor.wallets.map((wallet) => ({ investor, wallet }))
    );
    const walletRows = await tx.wallet.findMany({
      where: { address: { in: candidateWallets.map(({ wallet }) => wallet.wallet_address) } },
      include: { investor: true }
    });
    const walletsByAddress = new Map(walletRows.map((wallet) => [wallet.address, wallet]));
    if (walletRows.length !== candidateWallets.length) {
      throw new SnapshotPreparationError("REGISTRY_CHANGED", "Holder wallet mapping changed after capture");
    }
    for (const { investor, wallet } of candidateWallets) {
      const current = walletsByAddress.get(wallet.wallet_address);
      if (
        !current || current.id !== wallet.wallet_id ||
        current.investorId !== investor.investor_id ||
        current.investor?.eligibilityStatus !== investor.eligibility_status ||
        current.verifiedAt === null || current.verifiedAt > action.recordAt ||
        current.network !== options.walletNetwork ||
        current.status !== wallet.wallet_status
      ) {
        throw new SnapshotPreparationError("REGISTRY_CHANGED", "Holder wallet or investor status changed after capture");
      }
    }

    const locked = await tx.corporateAction.updateMany({
      where: { id: action.id, version: candidate.actionVersion, status: "SCHEDULED" },
      data: { version: { increment: 1 } }
    });
    if (locked.count !== 1) {
      throw new SnapshotPreparationError("CANDIDATE_STALE", "Corporate action changed during snapshot persistence");
    }
    const snapshot = await tx.snapshot.create({
      data: {
        instrument: { connect: { id: payload.instrument_id } },
        corporateAction: { connect: { id: payload.action_id } },
        schemaVersion: payload.schema_version,
        recordAt: new Date(payload.record_at),
        networkGenesisHash: payload.network_genesis_hash,
        solanaSlot: BigInt(payload.solana_slot),
        blockTime: new Date(payload.block_time),
        createdAt: new Date(payload.created_at),
        canonicalJson: JSON.parse(candidate.canonicalJson) as Prisma.InputJsonValue,
        snapshotHash: Buffer.from(candidate.sha256, "hex"),
        investorCount: payload.investor_count,
        walletCount: payload.wallet_count,
        totalBalance: BigInt(payload.total_balance),
        mintSupply: BigInt(payload.mint_supply),
        status: "PENDING_REGISTRATION",
        investors: {
          create: payload.investors.map((investor) => ({
            investor: { connect: { id: investor.investor_id } },
            eligibilityStatus: investor.eligibility_status,
            balance: BigInt(investor.balance),
            wallets: {
              create: investor.wallets.map((wallet) => ({
                wallet: { connect: { id: wallet.wallet_id } },
                walletAddress: wallet.wallet_address,
                walletStatus: wallet.wallet_status,
                balance: BigInt(wallet.balance),
                tokenAccounts: {
                  create: wallet.token_accounts.map((account) => ({
                    address: account.address,
                    balance: BigInt(account.balance)
                  }))
                }
              }))
            }
          }))
        }
      },
      select: { id: true }
    });
    return { snapshotId: snapshot.id, snapshotHash: candidate.sha256, status: "PENDING_REGISTRATION" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

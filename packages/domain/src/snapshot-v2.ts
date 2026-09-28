import { createHash } from "node:crypto";

import { DomainValidationError } from "./errors.js";
import { assertU64 } from "./numeric.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;
const ELIGIBILITY_STATUSES = new Set([
  "ELIGIBLE",
  "NOT_ELIGIBLE",
  "PENDING_REVIEW",
  "SUSPENDED"
]);
const WALLET_STATUSES = new Set(["PENDING", "ACTIVE", "BLOCKED", "REVOKED"]);

export type SnapshotEligibilityStatus =
  | "ELIGIBLE"
  | "NOT_ELIGIBLE"
  | "PENDING_REVIEW"
  | "SUSPENDED";
export type SnapshotWalletStatus = "PENDING" | "ACTIVE" | "BLOCKED" | "REVOKED";

export interface SnapshotV2Input {
  actionId: string;
  instrumentId: string;
  cluster: "localnet" | "devnet";
  networkGenesisHash: string;
  mintAddress: string;
  recordAt: string;
  solanaSlot: bigint;
  blockTime: string;
  createdAt: string;
  mintSupply: bigint;
  investors: readonly {
    investorId: string;
    eligibilityStatus: SnapshotEligibilityStatus;
    wallets: readonly {
      walletId: string;
      walletAddress: string;
      walletStatus: SnapshotWalletStatus;
      tokenAccounts: readonly { address: string; balance: bigint }[];
    }[];
  }[];
}

export interface CanonicalSnapshotV2 {
  schema_version: "snapshot-v2";
  action_id: string;
  instrument_id: string;
  cluster: "localnet" | "devnet";
  network_genesis_hash: string;
  mint_address: string;
  record_at: string;
  solana_slot: string;
  block_time: string;
  created_at: string;
  investors: Array<{
    investor_id: string;
    eligibility_status: SnapshotEligibilityStatus;
    wallets: Array<{
      wallet_id: string;
      wallet_address: string;
      wallet_status: SnapshotWalletStatus;
      token_accounts: Array<{ address: string; balance: string }>;
      balance: string;
    }>;
    balance: string;
  }>;
  investor_count: number;
  wallet_count: number;
  total_balance: string;
  mint_supply: string;
}

function assertUuid(value: string, name: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new DomainValidationError("INVALID_UUID", name + " must be a canonical UUID");
  }
}

function assertPublicKey(value: string, name: string): void {
  if (value.length < 32 || value.length > 44 || !BASE58_PATTERN.test(value)) {
    throw new DomainValidationError("INVALID_PUBLIC_KEY", name + " must be a base58-encoded 32-byte public key");
  }
  let decoded = 0n;
  for (const character of value) {
    decoded = decoded * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  let byteLength = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    byteLength += 1;
  }
  byteLength += value.length - value.replace(/^1+/, "").length;
  if (byteLength !== 32) {
    throw new DomainValidationError("INVALID_PUBLIC_KEY", name + " must be a base58-encoded 32-byte public key");
  }
}

function normalizeUtcTimestamp(value: string, name: string): string {
  if (!value.endsWith("Z")) {
    throw new DomainValidationError("INVALID_TIMESTAMP", name + " must be a UTC timestamp ending in Z");
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new DomainValidationError("INVALID_TIMESTAMP", name + " must be a valid timestamp");
  }
  return timestamp.toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createSnapshotV2Commitment(input: SnapshotV2Input): {
  snapshot: CanonicalSnapshotV2;
  canonicalJson: string;
  canonicalBytes: Uint8Array;
  sha256: string;
} {
  assertUuid(input.actionId, "actionId");
  assertUuid(input.instrumentId, "instrumentId");
  assertPublicKey(input.networkGenesisHash, "networkGenesisHash");
  assertPublicKey(input.mintAddress, "mintAddress");
  assertU64(input.solanaSlot, "solanaSlot");
  assertU64(input.mintSupply, "mintSupply");

  const seenInvestors = new Set<string>();
  const seenWallets = new Set<string>();
  const seenWalletAddresses = new Set<string>();
  const seenTokenAccounts = new Set<string>();
  let walletCount = 0;
  const investors = input.investors.map((investor) => {
    assertUuid(investor.investorId, "investorId");
    if (!ELIGIBILITY_STATUSES.has(investor.eligibilityStatus)) {
      throw new DomainValidationError("INVALID_ELIGIBILITY_STATUS", "Invalid investor eligibility status");
    }
    const investorId = investor.investorId.toLowerCase();
    if (seenInvestors.has(investorId)) {
      throw new DomainValidationError("DUPLICATE_INVESTOR", "Duplicate investor " + investorId);
    }
    seenInvestors.add(investorId);
    if (investor.wallets.length === 0) {
      throw new DomainValidationError("EMPTY_INVESTOR", "Investor has no positive-balance wallets");
    }

    let investorBalance = 0n;
    const wallets = investor.wallets.map((wallet) => {
      assertUuid(wallet.walletId, "walletId");
      assertPublicKey(wallet.walletAddress, "walletAddress");
      if (!WALLET_STATUSES.has(wallet.walletStatus)) {
        throw new DomainValidationError("INVALID_WALLET_STATUS", "Invalid wallet status");
      }
      const walletId = wallet.walletId.toLowerCase();
      if (seenWallets.has(walletId) || seenWalletAddresses.has(wallet.walletAddress)) {
        throw new DomainValidationError("DUPLICATE_WALLET", "Duplicate wallet " + wallet.walletAddress);
      }
      seenWallets.add(walletId);
      seenWalletAddresses.add(wallet.walletAddress);
      walletCount += 1;
      if (wallet.tokenAccounts.length === 0) {
        throw new DomainValidationError("EMPTY_WALLET", "Wallet has no positive-balance token accounts");
      }

      let walletBalance = 0n;
      const tokenAccounts = wallet.tokenAccounts.map((account) => {
        assertPublicKey(account.address, "tokenAccount.address");
        if (seenTokenAccounts.has(account.address)) {
          throw new DomainValidationError("DUPLICATE_TOKEN_ACCOUNT", "Duplicate token account " + account.address);
        }
        seenTokenAccounts.add(account.address);
        assertU64(account.balance, "tokenAccount.balance");
        if (account.balance === 0n) {
          throw new DomainValidationError("ZERO_BALANCE_ACCOUNT", "Zero-balance token accounts must be excluded");
        }
        walletBalance += account.balance;
        assertU64(walletBalance, "wallet.balance");
        return { address: account.address, balance: account.balance.toString(10) };
      });
      tokenAccounts.sort((left, right) => compareText(left.address, right.address));
      investorBalance += walletBalance;
      assertU64(investorBalance, "investor.balance");
      return {
        wallet_id: walletId,
        wallet_address: wallet.walletAddress,
        wallet_status: wallet.walletStatus,
        token_accounts: tokenAccounts,
        balance: walletBalance.toString(10)
      };
    });
    wallets.sort((left, right) => compareText(left.wallet_address, right.wallet_address));
    return {
      investor_id: investorId,
      eligibility_status: investor.eligibilityStatus,
      wallets,
      balance: investorBalance.toString(10)
    };
  });
  investors.sort((left, right) => compareText(left.investor_id, right.investor_id));

  let totalBalance = 0n;
  for (const investor of investors) {
    totalBalance += BigInt(investor.balance);
    assertU64(totalBalance, "totalBalance");
  }
  if (totalBalance !== input.mintSupply) {
    throw new DomainValidationError(
      "SNAPSHOT_SUPPLY_MISMATCH",
      "Snapshot total " + totalBalance + " does not match mint supply " + input.mintSupply
    );
  }

  const recordAt = normalizeUtcTimestamp(input.recordAt, "recordAt");
  const blockTime = normalizeUtcTimestamp(input.blockTime, "blockTime");
  const createdAt = normalizeUtcTimestamp(input.createdAt, "createdAt");
  if (recordAt > blockTime || blockTime > createdAt) {
    throw new DomainValidationError(
      "INVALID_SNAPSHOT_TIMELINE",
      "Snapshot timestamps must satisfy recordAt <= blockTime <= createdAt"
    );
  }

  const snapshot: CanonicalSnapshotV2 = {
    schema_version: "snapshot-v2",
    action_id: input.actionId.toLowerCase(),
    instrument_id: input.instrumentId.toLowerCase(),
    cluster: input.cluster,
    network_genesis_hash: input.networkGenesisHash,
    mint_address: input.mintAddress,
    record_at: recordAt,
    solana_slot: input.solanaSlot.toString(10),
    block_time: blockTime,
    created_at: createdAt,
    investors,
    investor_count: investors.length,
    wallet_count: walletCount,
    total_balance: totalBalance.toString(10),
    mint_supply: input.mintSupply.toString(10)
  };
  const canonicalJson = JSON.stringify(snapshot);
  const canonicalBytes = new TextEncoder().encode(canonicalJson);
  return {
    snapshot,
    canonicalJson,
    canonicalBytes,
    sha256: createHash("sha256").update(canonicalBytes).digest("hex")
  };
}

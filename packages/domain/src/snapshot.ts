import { createHash } from "node:crypto";

import { DomainValidationError } from "./errors.js";
import { assertU64 } from "./numeric.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

export interface SnapshotTokenAccountInput {
  address: string;
  balance: bigint;
}

export interface SnapshotHolderInput {
  walletAddress: string;
  tokenAccounts: readonly SnapshotTokenAccountInput[];
}

export interface SnapshotV1Input {
  actionId: string;
  instrumentId: string;
  cluster: "localnet" | "devnet";
  networkGenesisHash: string;
  mintAddress: string;
  recordAt: string;
  solanaSlot: bigint;
  blockTime: string;
  createdAt: string;
  holders: readonly SnapshotHolderInput[];
  mintSupply: bigint;
}

export interface CanonicalSnapshotV1 {
  schema_version: "snapshot-v1";
  action_id: string;
  instrument_id: string;
  cluster: "localnet" | "devnet";
  network_genesis_hash: string;
  mint_address: string;
  record_at: string;
  solana_slot: string;
  block_time: string;
  created_at: string;
  holders: Array<{
    wallet_address: string;
    token_accounts: Array<{
      address: string;
      balance: string;
    }>;
    balance: string;
  }>;
  holder_count: number;
  total_balance: string;
  mint_supply: string;
}

export interface SnapshotCommitment {
  snapshot: CanonicalSnapshotV1;
  canonicalJson: string;
  canonicalBytes: Uint8Array;
  sha256: string;
}

function assertUuid(value: string, fieldName: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new DomainValidationError(
      "INVALID_UUID",
      `${fieldName} must be a canonical UUID`
    );
  }
}

function decodeBase58Length(value: string): number {
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) {
      return -1;
    }
    decoded = decoded * 58n + BigInt(digit);
  }

  let byteLength = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    byteLength += 1;
  }

  const leadingZeroBytes = value.length - value.replace(/^1+/, "").length;
  return leadingZeroBytes + byteLength;
}

function assertPublicKey(value: string, fieldName: string): void {
  if (
    value.length < 32 ||
    value.length > 44 ||
    !BASE58_PATTERN.test(value) ||
    decodeBase58Length(value) !== 32
  ) {
    throw new DomainValidationError(
      "INVALID_PUBLIC_KEY",
      `${fieldName} must be a base58-encoded 32-byte public key`
    );
  }
}

function normalizeUtcTimestamp(value: string, fieldName: string): string {
  if (!value.endsWith("Z")) {
    throw new DomainValidationError(
      "INVALID_TIMESTAMP",
      `${fieldName} must be a UTC timestamp ending in Z`
    );
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new DomainValidationError(
      "INVALID_TIMESTAMP",
      `${fieldName} must be a valid timestamp`
    );
  }

  return timestamp.toISOString();
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function createSnapshotV1Commitment(
  input: SnapshotV1Input
): SnapshotCommitment {
  assertUuid(input.actionId, "actionId");
  assertUuid(input.instrumentId, "instrumentId");
  assertPublicKey(input.networkGenesisHash, "networkGenesisHash");
  assertPublicKey(input.mintAddress, "mintAddress");
  assertU64(input.solanaSlot, "solanaSlot");
  assertU64(input.mintSupply, "mintSupply");

  const seenWallets = new Set<string>();
  const seenTokenAccounts = new Set<string>();
  const holders = input.holders.map((holder) => {
    assertPublicKey(holder.walletAddress, "holder.walletAddress");
    if (seenWallets.has(holder.walletAddress)) {
      throw new DomainValidationError(
        "DUPLICATE_HOLDER",
        `Duplicate holder wallet ${holder.walletAddress}`
      );
    }
    seenWallets.add(holder.walletAddress);

    if (holder.tokenAccounts.length === 0) {
      throw new DomainValidationError(
        "EMPTY_HOLDER",
        `Holder ${holder.walletAddress} has no positive-balance token accounts`
      );
    }

    let holderBalance = 0n;
    const tokenAccounts = holder.tokenAccounts.map((tokenAccount) => {
      assertPublicKey(tokenAccount.address, "tokenAccount.address");
      if (seenTokenAccounts.has(tokenAccount.address)) {
        throw new DomainValidationError(
          "DUPLICATE_TOKEN_ACCOUNT",
          `Duplicate token account ${tokenAccount.address}`
        );
      }
      seenTokenAccounts.add(tokenAccount.address);
      assertU64(tokenAccount.balance, "tokenAccount.balance");
      if (tokenAccount.balance === 0n) {
        throw new DomainValidationError(
          "ZERO_BALANCE_ACCOUNT",
          `Token account ${tokenAccount.address} must be excluded when its balance is zero`
        );
      }

      holderBalance += tokenAccount.balance;
      assertU64(holderBalance, "holder.balance");
      return {
        address: tokenAccount.address,
        balance: tokenAccount.balance.toString(10)
      };
    });

    tokenAccounts.sort((left, right) =>
      compareCanonicalText(left.address, right.address)
    );
    return {
      wallet_address: holder.walletAddress,
      token_accounts: tokenAccounts,
      balance: holderBalance.toString(10)
    };
  });

  holders.sort((left, right) =>
    compareCanonicalText(left.wallet_address, right.wallet_address)
  );

  let totalBalance = 0n;
  for (const holder of holders) {
    totalBalance += BigInt(holder.balance);
    assertU64(totalBalance, "totalBalance");
  }

  if (totalBalance !== input.mintSupply) {
    throw new DomainValidationError(
      "SNAPSHOT_SUPPLY_MISMATCH",
      `Snapshot total ${totalBalance} does not match mint supply ${input.mintSupply}`
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

  const snapshot: CanonicalSnapshotV1 = {
    schema_version: "snapshot-v1",
    action_id: input.actionId.toLowerCase(),
    instrument_id: input.instrumentId.toLowerCase(),
    cluster: input.cluster,
    network_genesis_hash: input.networkGenesisHash,
    mint_address: input.mintAddress,
    record_at: recordAt,
    solana_slot: input.solanaSlot.toString(10),
    block_time: blockTime,
    created_at: createdAt,
    holders,
    holder_count: holders.length,
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

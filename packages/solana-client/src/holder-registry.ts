import { decodePublicKey, encodePublicKey } from "./base58.js";
import { type SolanaRpc, SolanaRpcError } from "./rpc.js";

export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_ACCOUNT_BASE_SIZE = 165;
const MAX_U64 = (1n << 64n) - 1n;

type TokenAccount = {
  address: string;
  walletAddress: string;
  balance: bigint;
};

export type HolderRegistryCapture = {
  mintAddress: string;
  slot: number;
  supply: bigint;
  totalBalance: bigint;
  tokenAccounts: TokenAccount[];
  wallets: Array<{
    address: string;
    balance: bigint;
    tokenAccounts: Array<{ address: string; balance: bigint }>;
  }>;
};

export type WalletMapping = {
  walletId: string;
  investorId: string;
  address: string;
  status: "PENDING" | "ACTIVE" | "BLOCKED" | "REVOKED";
  verified: boolean;
};

export type InvestorHolderRegistry = {
  slot: number;
  supply: bigint;
  investors: Array<{
    investorId: string;
    balance: bigint;
    wallets: Array<{
      walletId: string;
      address: string;
      status: WalletMapping["status"];
      balance: bigint;
      tokenAccounts: Array<{ address: string; balance: bigint }>;
    }>;
  }>;
  unregisteredWallets: string[];
  unverifiedWallets: string[];
  canCreateSnapshot: boolean;
};

function compareAddress(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", name + " must be an object");
  }
  return value as Record<string, unknown>;
}

function slot(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", "RPC context slot is invalid");
  }
  return value as number;
}

function decimalAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Token amount is invalid");
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Token amount exceeds u64");
  }
  return amount;
}

function publicKey(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", name + " is invalid");
  }
  try {
    if (encodePublicKey(decodePublicKey(value)) !== value) {
      throw new Error("noncanonical");
    }
  } catch {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", name + " is invalid");
  }
  return value;
}

function supplyResponse(value: unknown): { slot: number; amount: bigint } {
  const result = record(value, "token supply response");
  const context = record(result["context"], "token supply context");
  const supply = record(result["value"], "token supply value");
  if (supply["decimals"] !== 0) {
    throw new SolanaRpcError("INVALID_MINT_DECIMALS", "Bond mint must have zero decimals");
  }
  return { slot: slot(context["slot"]), amount: decimalAmount(supply["amount"]) };
}

function decodeTokenAccount(value: unknown, expectedMint: Uint8Array): TokenAccount {
  const entry = record(value, "token account entry");
  const address = publicKey(entry["pubkey"], "token account address");
  const account = record(entry["account"], "token account");
  if (account["owner"] !== TOKEN_2022_PROGRAM_ID || account["executable"] !== false) {
    throw new SolanaRpcError("INVALID_TOKEN_ACCOUNT", "Account is not owned by Token-2022");
  }
  const data = account["data"];
  if (
    !Array.isArray(data) ||
    data.length !== 2 ||
    typeof data[0] !== "string" ||
    data[1] !== "base64" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data[0])
  ) {
    throw new SolanaRpcError("INVALID_TOKEN_ACCOUNT", "Token account encoding is invalid");
  }
  const bytes = Buffer.from(data[0], "base64");
  if (bytes.toString("base64") !== data[0] || bytes.length < TOKEN_ACCOUNT_BASE_SIZE) {
    throw new SolanaRpcError("INVALID_TOKEN_ACCOUNT", "Token account data is incomplete");
  }
  if (!Buffer.from(expectedMint).equals(bytes.subarray(0, 32))) {
    throw new SolanaRpcError("MINT_MISMATCH", "Token account mint differs from requested mint");
  }
  if (bytes[108] !== 1 && bytes[108] !== 2) {
    throw new SolanaRpcError("INVALID_TOKEN_ACCOUNT", "Token account is not initialized");
  }
  return {
    address,
    walletAddress: encodePublicKey(bytes.subarray(32, 64)),
    balance: bytes.readBigUInt64LE(64)
  };
}

export async function collectToken2022Holders(
  rpc: SolanaRpc,
  mintAddress: string
): Promise<HolderRegistryCapture> {
  let mint: Uint8Array;
  try {
    mint = decodePublicKey(mintAddress);
  } catch {
    throw new SolanaRpcError("INVALID_MINT_ADDRESS", "Bond mint address is invalid");
  }
  const before = supplyResponse(
    await rpc.request("getTokenSupply", [mintAddress, { commitment: "finalized" }])
  );
  const registry = record(
    await rpc.request("getProgramAccounts", [
      TOKEN_2022_PROGRAM_ID,
      {
        commitment: "finalized",
        encoding: "base64",
        withContext: true,
        filters: [{ memcmp: { offset: 0, bytes: mintAddress } }]
      }
    ]),
    "program accounts response"
  );
  const registryContext = record(registry["context"], "program accounts context");
  const registrySlot = slot(registryContext["slot"]);
  if (!Array.isArray(registry["value"])) {
    throw new SolanaRpcError("INVALID_RPC_RESPONSE", "Program accounts value is invalid");
  }
  const after = supplyResponse(
    await rpc.request("getTokenSupply", [mintAddress, { commitment: "finalized" }])
  );
  if (
    before.slot > registrySlot ||
    registrySlot > after.slot ||
    before.amount !== after.amount
  ) {
    throw new SolanaRpcError(
      "INCONSISTENT_FINALIZED_CONTEXT",
      "Finalized supply changed or RPC slots were not ordered during holder capture"
    );
  }
  if (after.amount === 0n) {
    throw new SolanaRpcError("EMPTY_MINT", "Bond mint has no circulating supply");
  }

  const seenAccounts = new Set<string>();
  const tokenAccounts: TokenAccount[] = [];
  let totalBalance = 0n;
  for (const value of registry["value"]) {
    const account = decodeTokenAccount(value, mint);
    if (seenAccounts.has(account.address)) {
      throw new SolanaRpcError("DUPLICATE_TOKEN_ACCOUNT", "RPC returned a duplicate token account");
    }
    seenAccounts.add(account.address);
    if (account.balance === 0n) continue;
    totalBalance += account.balance;
    if (totalBalance > MAX_U64) {
      throw new SolanaRpcError("SUPPLY_MISMATCH", "Token-account balances exceed u64");
    }
    tokenAccounts.push(account);
  }
  if (totalBalance !== after.amount) {
    throw new SolanaRpcError(
      "SUPPLY_MISMATCH",
      "Token-account balances do not match finalized mint supply"
    );
  }

  tokenAccounts.sort((left, right) => compareAddress(left.address, right.address));
  const walletsByAddress = new Map<string, HolderRegistryCapture["wallets"][number]>();
  for (const account of tokenAccounts) {
    let wallet = walletsByAddress.get(account.walletAddress);
    if (!wallet) {
      wallet = { address: account.walletAddress, balance: 0n, tokenAccounts: [] };
      walletsByAddress.set(account.walletAddress, wallet);
    }
    wallet.balance += account.balance;
    wallet.tokenAccounts.push({ address: account.address, balance: account.balance });
  }
  const wallets = [...walletsByAddress.values()].sort((left, right) =>
    compareAddress(left.address, right.address)
  );
  return {
    mintAddress,
    slot: registrySlot,
    supply: after.amount,
    totalBalance,
    tokenAccounts,
    wallets
  };
}

export function groupHoldersByInvestor(
  capture: HolderRegistryCapture,
  mappings: readonly WalletMapping[]
): InvestorHolderRegistry {
  const mappingByAddress = new Map<string, WalletMapping>();
  for (const mapping of mappings) {
    if (mappingByAddress.has(mapping.address)) {
      throw new SolanaRpcError("DUPLICATE_WALLET_MAPPING", "Wallet mapping is not unique");
    }
    mappingByAddress.set(mapping.address, mapping);
  }

  const investorsById = new Map<string, InvestorHolderRegistry["investors"][number]>();
  const unregisteredWallets: string[] = [];
  const unverifiedWallets: string[] = [];
  for (const wallet of capture.wallets) {
    const mapping = mappingByAddress.get(wallet.address);
    if (!mapping) {
      unregisteredWallets.push(wallet.address);
      continue;
    }
    if (!mapping.verified) {
      unverifiedWallets.push(wallet.address);
    }
    let investor = investorsById.get(mapping.investorId);
    if (!investor) {
      investor = { investorId: mapping.investorId, balance: 0n, wallets: [] };
      investorsById.set(mapping.investorId, investor);
    }
    investor.balance += wallet.balance;
    investor.wallets.push({
      walletId: mapping.walletId,
      address: wallet.address,
      status: mapping.status,
      balance: wallet.balance,
      tokenAccounts: wallet.tokenAccounts
    });
  }
  const investors = [...investorsById.values()].sort((left, right) =>
    compareAddress(left.investorId, right.investorId)
  );
  return {
    slot: capture.slot,
    supply: capture.supply,
    investors,
    unregisteredWallets,
    unverifiedWallets,
    canCreateSnapshot: unregisteredWallets.length === 0 && unverifiedWallets.length === 0
  };
}

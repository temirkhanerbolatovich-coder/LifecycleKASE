import { SolanaSignMessage } from "@solana/wallet-standard-features";
import type { WalletAccount } from "@wallet-standard/base";

export function messageAccounts(
  connectedAccounts: readonly WalletAccount[],
  walletAccounts: readonly WalletAccount[]
): readonly WalletAccount[] {
  const accountsByAddress = new Map<string, WalletAccount>();
  for (const account of [...connectedAccounts, ...walletAccounts]) {
    if (account.features.includes(SolanaSignMessage) && !accountsByAddress.has(account.address)) {
      accountsByAddress.set(account.address, account);
    }
  }
  return [...accountsByAddress.values()];
}

export function accountForAddress(
  accounts: readonly WalletAccount[],
  preferredAddress: string
): WalletAccount | undefined {
  if (preferredAddress) return accounts.find((account) => account.address === preferredAddress);
  return accounts.length === 1 ? accounts[0] : undefined;
}

export function reconcileAccountSelection(
  accounts: readonly WalletAccount[],
  currentAddress: string
): string {
  if (accounts.length === 1) return accounts[0]?.address ?? "";
  return accounts.some((account) => account.address === currentAddress) ? currentAddress : "";
}

export function accountOptionLabel(account: WalletAccount): string {
  const abbreviatedAddress = `${account.address.slice(0, 6)}…${account.address.slice(-6)}`;
  return account.label ? `${account.label} · ${abbreviatedAddress}` : abbreviatedAddress;
}

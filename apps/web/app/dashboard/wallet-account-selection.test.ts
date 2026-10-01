import assert from "node:assert/strict";
import test from "node:test";
import { SolanaSignMessage } from "@solana/wallet-standard-features";
import type { WalletAccount } from "@wallet-standard/base";
import { accountForAddress, accountOptionLabel, messageAccounts, reconcileAccountSelection, shortWalletAddress } from "./wallet-account-selection.js";

function account(address: string, label?: string, features = [SolanaSignMessage]): WalletAccount {
  return {
    address,
    publicKey: new Uint8Array(32),
    chains: ["solana:devnet"],
    features,
    ...(label ? { label } : {})
  } as WalletAccount;
}

test("requires an explicit address when a wallet exposes multiple signing accounts", () => {
  const first = account("11111111111111111111111111111111", "Account 1");
  const second = account("22222222222222222222222222222222", "Account 2");

  assert.equal(accountForAddress([first, second], ""), undefined);
  assert.equal(accountForAddress([first, second], second.address), second);
  assert.equal(accountForAddress([first, second], "unknown"), undefined);
});

test("automatically uses the sole signing account", () => {
  const only = account("11111111111111111111111111111111");
  assert.equal(accountForAddress([only], ""), only);
});

test("replaces a stale selection when Phantom exposes a different active account", () => {
  const first = account("11111111111111111111111111111111");
  const second = account("22222222222222222222222222222222");

  assert.equal(reconcileAccountSelection([second], first.address), second.address);
  assert.equal(reconcileAccountSelection([first, second], first.address), first.address);
  assert.equal(reconcileAccountSelection([first, second], "unknown"), "");
});

test("combines connected and registered accounts without duplicates or unsupported accounts", () => {
  const first = account("11111111111111111111111111111111");
  const duplicate = account(first.address, "Duplicate");
  const unsupported = account("22222222222222222222222222222222", undefined, ["solana:signTransaction"]);
  const second = account("33333333333333333333333333333333");

  assert.deepEqual(messageAccounts([first, unsupported], [duplicate, second]), [first, second]);
});

test("labels expose both the Phantom label and an address fingerprint", () => {
  const labeled = account("1234567890abcdefghijklmnopqrstuv", "Account 2");
  assert.equal(accountOptionLabel(labeled), "Account 2 · 123456…qrstuv");
  assert.equal(shortWalletAddress("short-address"), "short-address");
});

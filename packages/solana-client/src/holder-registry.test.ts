import assert from "node:assert/strict";
import test from "node:test";

import { decodePublicKey } from "./base58.js";
import {
  collectToken2022Holders,
  groupHoldersByInvestor,
  TOKEN_2022_PROGRAM_ID
} from "./holder-registry.js";
import { type SolanaRpc } from "./rpc.js";

const MINT = "So11111111111111111111111111111111111111112";
const SYSTEM = "11111111111111111111111111111111";
const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function tokenAccount(
  address: string,
  walletAddress: string,
  amount: bigint,
  length = 165
) {
  const bytes = Buffer.alloc(length);
  Buffer.from(decodePublicKey(MINT)).copy(bytes, 0);
  Buffer.from(decodePublicKey(walletAddress)).copy(bytes, 32);
  bytes.writeBigUInt64LE(amount, 64);
  bytes[108] = 1;
  return {
    pubkey: address,
    account: {
      owner: TOKEN_2022_PROGRAM_ID,
      executable: false,
      data: [bytes.toString("base64"), "base64"]
    }
  };
}

function rpcFixture(
  accounts: unknown[],
  beforeAmount = "35",
  afterAmount = "35",
  slots: [number, number, number] = [100, 101, 102]
): { rpc: SolanaRpc; requests: Array<{ method: string; params: readonly unknown[] }> } {
  const responses = [
    { context: { slot: slots[0] }, value: { amount: beforeAmount, decimals: 0 } },
    { context: { slot: slots[1] }, value: accounts },
    { context: { slot: slots[2] }, value: { amount: afterAmount, decimals: 0 } }
  ];
  const requests: Array<{ method: string; params: readonly unknown[] }> = [];
  return {
    requests,
    rpc: {
      async request(method, params) {
        requests.push({ method, params });
        return responses.shift();
      }
    }
  };
}

function accounts() {
  return [
    tokenAccount(SYSTEM, TOKEN_2022_PROGRAM_ID, 10n),
    tokenAccount(TOKEN_2022_PROGRAM_ID, ASSOCIATED, 20n, 200),
    tokenAccount(ASSOCIATED, SYSTEM, 5n)
  ];
}

test("collects all Token-2022 accounts, including extension accounts, at finalized context", async () => {
  const fixture = rpcFixture([...accounts()].reverse());
  const capture = await collectToken2022Holders(fixture.rpc, MINT);
  assert.equal(capture.slot, 101);
  assert.equal(capture.supply, 35n);
  assert.equal(capture.totalBalance, 35n);
  assert.equal(capture.tokenAccounts.length, 3);
  assert.equal(capture.wallets.length, 3);
  assert.deepEqual(fixture.requests.map((request) => request.method), [
    "getTokenSupply",
    "getProgramAccounts",
    "getTokenSupply"
  ]);
  const accountRequest = fixture.requests[1]!.params[1] as Record<string, unknown>;
  assert.equal(accountRequest["withContext"], true);
  assert.equal(accountRequest["commitment"], "finalized");
  assert.equal(accountRequest["encoding"], "base64");
  assert.deepEqual(accountRequest["filters"], [{ memcmp: { offset: 0, bytes: MINT } }]);
});

test("groups several wallets under one investor and flags missing mappings", async () => {
  const capture = await collectToken2022Holders(rpcFixture(accounts()).rpc, MINT);
  const mappings = [
    {
      walletId: "00000000-0000-4000-8000-000000000001",
      investorId: "00000000-0000-4000-8000-000000000011",
      address: TOKEN_2022_PROGRAM_ID,
      status: "ACTIVE" as const,
      verified: true
    },
    {
      walletId: "00000000-0000-4000-8000-000000000002",
      investorId: "00000000-0000-4000-8000-000000000011",
      address: ASSOCIATED,
      status: "ACTIVE" as const,
      verified: true
    },
    {
      walletId: "00000000-0000-4000-8000-000000000003",
      investorId: "00000000-0000-4000-8000-000000000012",
      address: SYSTEM,
      status: "BLOCKED" as const,
      verified: true
    }
  ];
  const grouped = groupHoldersByInvestor(capture, mappings);
  assert.equal(grouped.investors.length, 2);
  assert.equal(grouped.investors[0]?.balance, 30n);
  assert.equal(grouped.investors[0]?.wallets.length, 2);
  assert.equal(grouped.canCreateSnapshot, true);

  const incomplete = groupHoldersByInvestor(capture, mappings.slice(0, 2));
  assert.deepEqual(incomplete.unregisteredWallets, [SYSTEM]);
  assert.equal(incomplete.canCreateSnapshot, false);
  const unverified = groupHoldersByInvestor(capture, [
    { ...mappings[0]!, verified: false },
    mappings[1]!,
    mappings[2]!
  ]);
  assert.equal(unverified.canCreateSnapshot, false);
});

test("rejects changed supply, unordered slots, and incomplete account universe", async () => {
  await assert.rejects(
    collectToken2022Holders(rpcFixture(accounts(), "35", "34").rpc, MINT),
    /Finalized supply changed/
  );
  await assert.rejects(
    collectToken2022Holders(rpcFixture(accounts(), "35", "35", [102, 101, 103]).rpc, MINT),
    /slots were not ordered/
  );
  await assert.rejects(
    collectToken2022Holders(rpcFixture(accounts().slice(0, 2)).rpc, MINT),
    /do not match finalized mint supply/
  );
});

test("rejects malformed account ownership, mint, and duplicate accounts", async () => {
  const wrongOwner = accounts();
  wrongOwner[0]!.account.owner = SYSTEM;
  await assert.rejects(
    collectToken2022Holders(rpcFixture(wrongOwner).rpc, MINT),
    /not owned by Token-2022/
  );
  const wrongMint = accounts();
  const bytes = Buffer.from(wrongMint[0]!.account.data[0]!, "base64");
  Buffer.from(decodePublicKey(SYSTEM)).copy(bytes, 0);
  wrongMint[0]!.account.data[0] = bytes.toString("base64");
  await assert.rejects(
    collectToken2022Holders(rpcFixture(wrongMint).rpc, MINT),
    /mint differs/
  );
  await assert.rejects(
    collectToken2022Holders(rpcFixture([...accounts(), accounts()[0]!]).rpc, MINT),
    /duplicate token account/
  );
});

test("ignores zero-balance accounts but rejects uninitialized accounts", async () => {
  const zeroAccount = tokenAccount(MINT, SYSTEM, 0n, 200);
  const capture = await collectToken2022Holders(rpcFixture([...accounts(), zeroAccount]).rpc, MINT);
  assert.equal(capture.tokenAccounts.length, 3);
  assert.equal(capture.totalBalance, 35n);

  const invalidAccount = tokenAccount(MINT, SYSTEM, 0n);
  const bytes = Buffer.from(invalidAccount.account.data[0]!, "base64");
  bytes[108] = 0;
  invalidAccount.account.data[0] = bytes.toString("base64");
  await assert.rejects(
    collectToken2022Holders(rpcFixture([...accounts(), invalidAccount]).rpc, MINT),
    /not initialized/
  );
});

test("rejects a duplicate Investor Registry wallet mapping", async () => {
  const capture = await collectToken2022Holders(rpcFixture(accounts()).rpc, MINT);
  const mapping = {
    walletId: "00000000-0000-4000-8000-000000000001",
    investorId: "00000000-0000-4000-8000-000000000011",
    address: SYSTEM,
    status: "ACTIVE" as const,
    verified: true
  };
  assert.throws(() => groupHoldersByInvestor(capture, [mapping, mapping]), /not unique/);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { decodePublicKey, TOKEN_2022_PROGRAM_ID, type SolanaRpc } from "@lifecycle-kase/solana-client";

import { prepareSnapshotCandidate, SnapshotPreparationError } from "./snapshot-candidate.js";

const MINT = "So11111111111111111111111111111111111111112";
const SYSTEM = "11111111111111111111111111111111";
const ASSOCIATED = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const INVESTOR_ONE = "00000000-0000-4000-8000-000000000011";
const INVESTOR_TWO = "00000000-0000-4000-8000-000000000012";
const BLOCK_TIME = Date.parse("2026-09-29T00:01:00.000Z") / 1000;

function tokenAccount(address: string, owner: string, amount: bigint) {
  const data = Buffer.alloc(165);
  Buffer.from(decodePublicKey(MINT)).copy(data, 0);
  Buffer.from(decodePublicKey(owner)).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return {
    pubkey: address,
    account: {
      owner: TOKEN_2022_PROGRAM_ID,
      executable: false,
      data: [data.toString("base64"), "base64"]
    }
  };
}

function fixture(overrides: {
  missingWallet?: boolean;
  unverifiedWallet?: boolean;
  wrongGenesis?: boolean;
  supply?: bigint;
  blockTime?: number | null;
  now?: Date;
  actionStatus?: string;
  snapshotExists?: boolean;
} = {}) {
  const action = {
    id: ACTION_ID,
    instrumentId: INSTRUMENT_ID,
    status: overrides.actionStatus ?? "SCHEDULED",
    snapshot: overrides.snapshotExists ? { id: "existing" } : null,
    recordAt: new Date("2026-09-29T00:00:00.000Z"),
    instrument: {
      status: "ACTIVE",
      mintAddress: MINT,
      circulatingSupply: overrides.supply ?? 35n
    }
  };
  const wallets = [
    {
      id: "00000000-0000-4000-8000-000000000021",
      investorId: INVESTOR_ONE,
      address: TOKEN_2022_PROGRAM_ID,
      status: "ACTIVE",
      verifiedAt: new Date("2026-09-28T00:00:00.000Z"),
      network: "SOLANA_DEVNET",
      investor: { id: INVESTOR_ONE, eligibilityStatus: "ELIGIBLE" }
    },
    {
      id: "00000000-0000-4000-8000-000000000022",
      investorId: INVESTOR_ONE,
      address: ASSOCIATED,
      status: "ACTIVE",
      verifiedAt: overrides.unverifiedWallet ? null : new Date("2026-09-28T00:00:00.000Z"),
      network: "SOLANA_DEVNET",
      investor: { id: INVESTOR_ONE, eligibilityStatus: "ELIGIBLE" }
    },
    {
      id: "00000000-0000-4000-8000-000000000023",
      investorId: INVESTOR_TWO,
      address: SYSTEM,
      status: "BLOCKED",
      verifiedAt: new Date("2026-09-28T00:00:00.000Z"),
      network: "SOLANA_DEVNET",
      investor: { id: INVESTOR_TWO, eligibilityStatus: "SUSPENDED" }
    }
  ];
  const requestedMethods: string[] = [];
  let supplyRead = 0;
  const rpc: SolanaRpc = {
    async request(method, params) {
      requestedMethods.push(method);
      if (method === "getGenesisHash") return overrides.wrongGenesis ? MINT : SYSTEM;
      if (method === "getTokenSupply") {
        supplyRead += 1;
        return {
          context: { slot: supplyRead === 1 ? 100 : 102 },
          value: { amount: "35", decimals: 0 }
        };
      }
      if (method === "getProgramAccounts") {
        return {
          context: { slot: 101 },
          value: [
            tokenAccount(SYSTEM, TOKEN_2022_PROGRAM_ID, 10n),
            tokenAccount(TOKEN_2022_PROGRAM_ID, ASSOCIATED, 20n),
            tokenAccount(ASSOCIATED, SYSTEM, 5n)
          ]
        };
      }
      if (method === "getBlockTime") {
        assert.deepEqual(params, [101]);
        return overrides.blockTime === undefined ? BLOCK_TIME : overrides.blockTime;
      }
      throw new Error("Unexpected RPC method " + method);
    }
  };
  let walletQueryCount = 0;
  const database = {
    corporateAction: { findUnique: async () => action },
    wallet: {
      findMany: async () => {
        walletQueryCount += 1;
        return overrides.missingWallet ? wallets.slice(0, 2) : wallets;
      }
    }
  } as unknown as PrismaClient;
  const options = {
    cluster: "devnet" as const,
    expectedGenesisHash: SYSTEM,
    walletNetwork: "SOLANA_DEVNET",
    graceSeconds: 300,
    now: overrides.now ?? new Date("2026-09-29T00:02:00.000Z")
  };
  return { database, rpc, options, requestedMethods, get walletQueryCount() { return walletQueryCount; } };
}

test("builds a canonical investor-level candidate from DB mappings and finalized RPC", async () => {
  const setup = fixture();
  const candidate = await prepareSnapshotCandidate(setup.database, setup.rpc, ACTION_ID, setup.options);
  assert.equal(candidate.snapshot.schema_version, "snapshot-v2");
  assert.equal(candidate.snapshot.total_balance, "35");
  assert.equal(candidate.snapshot.investor_count, 2);
  assert.equal(candidate.snapshot.wallet_count, 3);
  assert.equal(candidate.snapshot.investors[0]?.balance, "30");
  assert.equal(candidate.snapshot.investors[1]?.eligibility_status, "SUSPENDED");
  assert.equal(candidate.captureSlot, 101);
  assert.match(candidate.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(setup.requestedMethods, [
    "getGenesisHash", "getTokenSupply", "getProgramAccounts", "getTokenSupply", "getBlockTime"
  ]);
  assert.equal(setup.walletQueryCount, 1);
});

test("stops before capture on wrong network or missed window", async () => {
  const wrongNetwork = fixture({ wrongGenesis: true });
  await assert.rejects(
    prepareSnapshotCandidate(wrongNetwork.database, wrongNetwork.rpc, ACTION_ID, wrongNetwork.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "WRONG_SOLANA_NETWORK"
  );
  assert.deepEqual(wrongNetwork.requestedMethods, ["getGenesisHash"]);

  const late = fixture({ now: new Date("2026-09-29T00:06:00.000Z") });
  await assert.rejects(
    prepareSnapshotCandidate(late.database, late.rpc, ACTION_ID, late.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "SNAPSHOT_WINDOW_MISSED"
  );
  assert.deepEqual(late.requestedMethods, []);

  const premature = fixture({ now: new Date("2026-09-28T23:59:59.000Z") });
  await assert.rejects(
    prepareSnapshotCandidate(premature.database, premature.rpc, ACTION_ID, premature.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "SNAPSHOT_WINDOW_MISSED"
  );
  const alreadyCaptured = fixture({ snapshotExists: true });
  await assert.rejects(
    prepareSnapshotCandidate(alreadyCaptured.database, alreadyCaptured.rpc, ACTION_ID, alreadyCaptured.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "ACTION_NOT_READY"
  );
  assert.deepEqual(alreadyCaptured.requestedMethods, []);
});

test("refuses unknown or unverified holder wallets and stale DB supply", async () => {
  for (const overrides of [{ missingWallet: true }, { unverifiedWallet: true }]) {
    const setup = fixture(overrides);
    await assert.rejects(
      prepareSnapshotCandidate(setup.database, setup.rpc, ACTION_ID, setup.options),
      (error: unknown) => error instanceof SnapshotPreparationError && error.code === "HOLDER_REGISTRY_INCOMPLETE"
    );
    assert.equal(setup.requestedMethods.includes("getBlockTime"), false);
  }
  const stale = fixture({ supply: 34n });
  await assert.rejects(
    prepareSnapshotCandidate(stale.database, stale.rpc, ACTION_ID, stale.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "INSTRUMENT_SUPPLY_STALE"
  );
  assert.equal(stale.walletQueryCount, 0);
});

test("refuses unavailable block time", async () => {
  const setup = fixture({ blockTime: null });
  await assert.rejects(
    prepareSnapshotCandidate(setup.database, setup.rpc, ACTION_ID, setup.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "BLOCK_TIME_UNAVAILABLE"
  );
});

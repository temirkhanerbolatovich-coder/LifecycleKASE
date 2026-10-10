import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import type { SolanaRpc } from "@lifecycle-kase/solana-client";

import { SnapshotPreparationError } from "./snapshot-candidate.js";
import { prepareSnapshotRegistrationForAction, snapshotHttpOptionsFromEnvironment } from "./snapshot-http.js";

const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000003";
const INVESTOR_ID = "00000000-0000-4000-8000-000000000004";
const WALLET_ID = "00000000-0000-4000-8000-000000000005";
const ACTOR_ID = "00000000-0000-4000-8000-000000000006";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000007";
const KEY = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const TOKEN_ACCOUNT = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function pendingFixture() {
  const commitment = createSnapshotV2Commitment({
    actionId: ACTION_ID,
    instrumentId: INSTRUMENT_ID,
    cluster: "devnet",
    networkGenesisHash: KEY,
    mintAddress: MINT,
    recordAt: "2026-09-30T10:00:00.000Z",
    solanaSlot: 101n,
    blockTime: "2026-09-30T10:01:00.000Z",
    createdAt: "2026-09-30T10:02:00.000Z",
    mintSupply: 10n,
    investors: [{
      investorId: INVESTOR_ID,
      eligibilityStatus: "ELIGIBLE",
      wallets: [{
        walletId: WALLET_ID,
        walletAddress: KEY,
        walletStatus: "ACTIVE",
        tokenAccounts: [{ address: TOKEN_ACCOUNT, balance: 10n }]
      }]
    }]
  });
  const stored = {
    id: SNAPSHOT_ID,
    status: "PENDING_REGISTRATION",
    recordAt: new Date(commitment.snapshot.record_at),
    blockTime: new Date(commitment.snapshot.block_time),
    solanaSlot: 101n,
    canonicalJson: commitment.snapshot,
    snapshotHash: Buffer.from(commitment.sha256, "hex"),
    networkGenesisHash: KEY,
    investorCount: 1,
    walletCount: 1,
    totalBalance: 10n,
    mintSupply: 10n,
    corporateAction: {
      id: ACTION_ID,
      status: "SCHEDULED",
      recordAt: new Date("2026-09-30T10:00:00.000Z"),
      instrument: {
        id: INSTRUMENT_ID,
        status: "ACTIVE",
        programId: PROGRAM,
        mintAddress: MINT,
        issuerAuthority: KEY
      }
    }
  };
  const auditEvents: unknown[] = [];
  const transaction = {
    corporateAction: { findUnique: async () => stored.corporateAction },
    blockchainTransaction: { findFirst: async () => null, create: async () => ({ id: CORRELATION_ID }) },
    auditLog: { create: async (args: unknown) => { auditEvents.push(args); return { id: "audit" }; } }
  };
  const database = {
    corporateAction: { findUnique: async () => stored.corporateAction },
    blockchainTransaction: { findFirst: async () => null },
    snapshot: { findUnique: async (args: any) => args.select ? {
      id: stored.id,
      status: stored.status,
      recordAt: stored.recordAt,
      blockTime: stored.blockTime,
      solanaSlot: stored.solanaSlot
    } : stored },
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)
  } as unknown as PrismaClient;
  const methods: string[] = [];
  const rpc: SolanaRpc = {
    async request(method) {
      methods.push(method);
      if (method === "getGenesisHash") return KEY;
      if (method === "getSlot") return 102;
      if (method === "getBlockTime") return Date.parse("2026-09-30T10:01:00.000Z") / 1000;
      if (method === "getLatestBlockhash") return { value: { blockhash: MINT, lastValidBlockHeight: 200 } };
      throw new Error("Unexpected RPC method " + method);
    }
  };
  return { database, rpc, methods, commitment, auditEvents };
}

test("resumes a pending snapshot without recapturing holder balances", async () => {
  const setup = pendingFixture();
  const result = await prepareSnapshotRegistrationForAction(
    setup.database,
    setup.rpc,
    ACTION_ID,
    { id: ACTOR_ID, walletAddress: KEY, correlationId: CORRELATION_ID },
    {
      cluster: "devnet",
      expectedGenesisHash: KEY,
      walletNetwork: "SOLANA_DEVNET",
      graceSeconds: 300,
      programId: PROGRAM,
      now: new Date("2026-09-30T10:03:00.000Z")
    }
  );
  assert.equal(result.resumed, true);
  assert.equal(result.cluster, "devnet");
  assert.equal(result.recordPointMode, "DEMO_CAPTURE_SLOT");
  assert.equal(result.transactionFormat, "SOLANA_V0_WIRE_TRANSACTION_BASE64");
  assert.equal(result.snapshotHash, setup.commitment.sha256);
  assert.equal(result.operationId, CORRELATION_ID);
  assert.equal(setup.auditEvents.length, 1);
  assert.deepEqual(setup.methods, ["getGenesisHash", "getGenesisHash", "getSlot", "getBlockTime", "getLatestBlockhash"]);
});

test("validates snapshot HTTP configuration without accepting mainnet or excessive windows", () => {
  assert.deepEqual(snapshotHttpOptionsFromEnvironment({
    SOLANA_CLUSTER: "devnet",
    SOLANA_GENESIS_HASH: KEY,
    SOLANA_RPC_URL: "https://api.devnet.solana.com"
  }), {
    cluster: "devnet",
    expectedGenesisHash: KEY,
    walletNetwork: "SOLANA_DEVNET",
    graceSeconds: 300,
    rpcEndpoint: "https://api.devnet.solana.com",
    rpcTimeoutMs: 15_000
  });
  assert.deepEqual(snapshotHttpOptionsFromEnvironment({
    SOLANA_CLUSTER: "localnet",
    SOLANA_GENESIS_HASH: KEY,
    SOLANA_RPC_URL: "http://127.0.0.1:8899"
  }), {
    cluster: "localnet",
    expectedGenesisHash: KEY,
    walletNetwork: "SOLANA_LOCALNET",
    graceSeconds: 300,
    rpcEndpoint: "http://127.0.0.1:8899",
    rpcTimeoutMs: 15_000
  });
  for (const environment of [
    { SOLANA_CLUSTER: "mainnet", SOLANA_GENESIS_HASH: KEY, SOLANA_RPC_URL: "https://example.com" },
    { SOLANA_CLUSTER: "devnet", SOLANA_GENESIS_HASH: KEY, SOLANA_RPC_URL: "https://example.com", SNAPSHOT_GRACE_SECONDS: "301" },
    { SOLANA_CLUSTER: "localnet", SOLANA_GENESIS_HASH: KEY, SOLANA_RPC_URL: "http://127.0.0.1:8899", WALLET_NETWORK: "SOLANA_DEVNET" },
    { SOLANA_CLUSTER: "devnet", SOLANA_GENESIS_HASH: KEY, SOLANA_RPC_URL: "https://api.devnet.solana.com", WALLET_NETWORK: "SOLANA_LOCALNET" }
  ]) {
    assert.throws(
      () => snapshotHttpOptionsFromEnvironment(environment),
      (error: unknown) => error instanceof SnapshotPreparationError &&
        error.code === "SNAPSHOT_CONFIGURATION_INVALID"
    );
  }
});

test("does not prepare an operation when a persisted snapshot belongs to another cluster", async () => {
  const setup = pendingFixture();
  await assert.rejects(
    prepareSnapshotRegistrationForAction(
      setup.database,
      setup.rpc,
      ACTION_ID,
      { id: ACTOR_ID, walletAddress: KEY, correlationId: CORRELATION_ID },
      {
        cluster: "localnet",
        expectedGenesisHash: KEY,
        walletNetwork: "SOLANA_LOCALNET",
        graceSeconds: 300,
        programId: PROGRAM,
        now: new Date("2026-09-30T10:03:00.000Z")
      }
    ),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "WRONG_SOLANA_NETWORK"
  );
  assert.equal(setup.auditEvents.length, 0);
});

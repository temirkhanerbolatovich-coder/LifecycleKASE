import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";
import { type SolanaRpc } from "@lifecycle-kase/solana-client";

import { preparePendingSnapshotRegistration, SnapshotPreparationError } from "./index.js";

const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000003";
const INVESTOR_ID = "00000000-0000-4000-8000-000000000004";
const WALLET_ID = "00000000-0000-4000-8000-000000000005";
const KEY = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const TOKEN_ACCOUNT = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function fixture(overrides: { status?: string; hash?: Uint8Array; genesis?: string; slot?: number; now?: Date } = {}) {
  const commitment = createSnapshotV2Commitment({
    actionId: ACTION_ID,
    instrumentId: INSTRUMENT_ID,
    cluster: "devnet",
    networkGenesisHash: KEY,
    mintAddress: MINT,
    recordAt: "2026-09-29T00:00:00.000Z",
    solanaSlot: 101n,
    blockTime: "2026-09-29T00:01:00.000Z",
    createdAt: "2026-09-29T00:02:00.000Z",
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
    status: overrides.status ?? "PENDING_REGISTRATION",
    canonicalJson: commitment.snapshot,
    snapshotHash: overrides.hash ?? Buffer.from(commitment.sha256, "hex"),
    networkGenesisHash: KEY,
    solanaSlot: 101n,
    blockTime: new Date("2026-09-29T00:01:00.000Z"),
    investorCount: 1,
    walletCount: 1,
    totalBalance: 10n,
    mintSupply: 10n,
    corporateAction: {
      id: ACTION_ID,
      status: "SCHEDULED",
      recordAt: new Date("2026-09-29T00:00:00.000Z"),
      instrument: {
        id: INSTRUMENT_ID,
        status: "ACTIVE",
        programId: PROGRAM,
        mintAddress: MINT,
        issuerAuthority: KEY
      }
    }
  };
  const database = { snapshot: { findUnique: async () => stored } } as unknown as PrismaClient;
  const methods: string[] = [];
  const rpc: SolanaRpc = {
    async request(method) {
      methods.push(method);
      if (method === "getGenesisHash") return overrides.genesis ?? KEY;
      if (method === "getSlot") return overrides.slot ?? 102;
      if (method === "getBlockTime") return Date.parse("2026-09-29T00:01:00.000Z") / 1000;
      if (method === "getLatestBlockhash") return {
        value: { blockhash: MINT, lastValidBlockHeight: 200 }
      };
      throw new Error("Unexpected RPC method " + method);
    }
  };
  const options = {
    expectedGenesisHash: KEY,
    now: overrides.now ?? new Date("2026-09-29T00:03:00.000Z"),
    graceSeconds: 300
  };
  return { stored, database, rpc, options, methods, commitment };
}

test("prepares a deterministic unsigned registration from a persisted snapshot", async () => {
  const setup = fixture();
  const result = await preparePendingSnapshotRegistration(setup.database, setup.rpc, SNAPSHOT_ID, setup.options);
  assert.equal(result.snapshotHash, setup.commitment.sha256);
  assert.equal(result.requiredSigner, KEY);
  assert.equal(result.accounts.length, 6);
  assert.equal(result.accounts[2]?.address, result.actionAddress);
  assert.equal(Buffer.from(result.instructionDataBase64, "base64").length, 72);
  assert.deepEqual(setup.methods, ["getGenesisHash", "getSlot", "getBlockTime", "getLatestBlockhash"]);
});

test("refuses altered, finalized, wrong-network, and late snapshots before instruction preparation", async () => {
  const alteredPayload = fixture();
  alteredPayload.stored.canonicalJson = { ...alteredPayload.commitment.snapshot, unexpected: true } as typeof alteredPayload.stored.canonicalJson;
  await assert.rejects(
    preparePendingSnapshotRegistration(alteredPayload.database, alteredPayload.rpc, SNAPSHOT_ID, alteredPayload.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "SNAPSHOT_CHANGED"
  );

  for (const [setup, code] of [
    [fixture({ hash: Buffer.alloc(32, 1) }), "SNAPSHOT_CHANGED"],
    [fixture({ status: "FINALIZED" }), "SNAPSHOT_NOT_READY"],
    [fixture({ genesis: MINT }), "WRONG_SOLANA_NETWORK"],
    [fixture({ slot: 100 }), "SNAPSHOT_SLOT_UNFINALIZED"],
    [fixture({ now: new Date("2026-09-29T00:06:00.000Z") }), "SNAPSHOT_WINDOW_MISSED"]
  ] as const) {
    await assert.rejects(
      preparePendingSnapshotRegistration(setup.database, setup.rpc, SNAPSHOT_ID, setup.options),
      (error: unknown) => error instanceof SnapshotPreparationError && error.code === code
    );
    assert.equal(setup.methods.includes("getLatestBlockhash"), false);
  }
});

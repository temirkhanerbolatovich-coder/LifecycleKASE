import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";
import { createSnapshotV2Commitment } from "@lifecycle-kase/domain";

import { persistSnapshotCandidate, SnapshotPreparationError } from "./index.js";

const ACTION_ID = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT_ID = "00000000-0000-4000-8000-000000000002";
const INVESTOR_ID = "00000000-0000-4000-8000-000000000011";
const WALLET_ID = "00000000-0000-4000-8000-000000000021";
const KEY = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const TOKEN_ACCOUNT = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function fixture(overrides: {
  actionVersion?: number;
  walletStatus?: string;
  verifiedAt?: Date;
  lockCount?: number;
  now?: Date;
} = {}) {
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
  const candidate = {
    ...commitment,
    captureSlot: 101,
    actionVersion: 3,
    instrumentVersion: 2
  };
  const action = {
    id: ACTION_ID,
    version: overrides.actionVersion ?? 3,
    status: "SCHEDULED",
    snapshot: null,
    instrumentId: INSTRUMENT_ID,
    recordAt: new Date("2026-09-29T00:00:00.000Z"),
    instrument: {
      version: 2,
      status: "ACTIVE",
      mintAddress: MINT,
      circulatingSupply: 10n
    }
  };
  const wallets = [{
    id: WALLET_ID,
    investorId: INVESTOR_ID,
    address: KEY,
    status: overrides.walletStatus ?? "ACTIVE",
    verifiedAt: overrides.verifiedAt ?? new Date("2026-09-28T00:00:00.000Z"),
    network: "SOLANA_DEVNET",
    investor: { id: INVESTOR_ID, eligibilityStatus: "ELIGIBLE" }
  }];
  const calls: { lock?: unknown; create?: unknown } = {};
  const tx = {
    corporateAction: {
      findUnique: async () => action,
      updateMany: async (args: unknown) => {
        calls.lock = args;
        return { count: overrides.lockCount ?? 1 };
      }
    },
    wallet: { findMany: async () => wallets },
    snapshot: {
      create: async (args: unknown) => {
        calls.create = args;
        return { id: "00000000-0000-4000-8000-000000000031" };
      }
    }
  };
  const database = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient;
  const options = {
    now: overrides.now ?? new Date("2026-09-29T00:02:30.000Z"),
    graceSeconds: 300,
    walletNetwork: "SOLANA_DEVNET"
  };
  return { candidate, database, options, calls };
}

test("persists all snapshot rows atomically while action stays scheduled", async () => {
  const setup = fixture();
  const result = await persistSnapshotCandidate(setup.database, setup.candidate, setup.options);
  assert.equal(result.status, "PENDING_REGISTRATION");
  assert.equal(result.snapshotHash, setup.candidate.sha256);
  assert.deepEqual(setup.calls.lock, {
    where: { id: ACTION_ID, version: 3, status: "SCHEDULED" },
    data: { version: { increment: 1 } }
  });
  const data = (setup.calls.create as { data: Record<string, any> }).data;
  assert.equal(data.status, "PENDING_REGISTRATION");
  assert.equal(data.investors.create[0].wallets.create[0].tokenAccounts.create[0].balance, 10n);
  assert.equal(data.snapshotHash.toString("hex"), setup.candidate.sha256);
});

test("rejects changed candidate, action, wallet, and compare-and-set conflict", async () => {
  const excessiveGrace = fixture();
  excessiveGrace.options.graceSeconds = 301;
  await assert.rejects(
    persistSnapshotCandidate(excessiveGrace.database, excessiveGrace.candidate, excessiveGrace.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "INVALID_PERSISTENCE_TIME"
  );
  assert.equal(excessiveGrace.calls.create, undefined);

  const changed = fixture();
  changed.candidate.snapshot.wallet_count = 99;
  await assert.rejects(
    persistSnapshotCandidate(changed.database, changed.candidate, changed.options),
    (error: unknown) => error instanceof SnapshotPreparationError && error.code === "CANDIDATE_CHANGED"
  );
  assert.equal(changed.calls.create, undefined);

  for (const [setup, code] of [
    [fixture({ actionVersion: 4 }), "CANDIDATE_STALE"],
    [fixture({ walletStatus: "REVOKED" }), "REGISTRY_CHANGED"],
    [fixture({ verifiedAt: new Date("2026-09-29T00:01:30.000Z") }), "REGISTRY_CHANGED"],
    [fixture({ lockCount: 0 }), "CANDIDATE_STALE"],
    [fixture({ now: new Date("2026-09-29T00:06:00.000Z") }), "SNAPSHOT_WINDOW_MISSED"]
  ] as const) {
    await assert.rejects(
      persistSnapshotCandidate(setup.database, setup.candidate, setup.options),
      (error: unknown) => error instanceof SnapshotPreparationError && error.code === code
    );
    assert.equal(setup.calls.create, undefined);
  }
});

test("accepts wallet verification between planned record time and effective finalized slot", async () => {
  const setup = fixture({ verifiedAt: new Date("2026-09-29T00:00:30.000Z") });
  const result = await persistSnapshotCandidate(setup.database, setup.candidate, setup.options);
  assert.equal(result.status, "PENDING_REGISTRATION");
});

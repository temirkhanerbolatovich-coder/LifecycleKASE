import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { decodePublicKey, deriveCorporateActionAddresses, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { checkSnapshotWindow } from "./snapshot-window.js";
import { prepareSnapshotRegistrationForAction } from "./snapshot-http.js";
import { uuidBytes } from "./snapshot-registration.js";

const ACTION = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT = "00000000-0000-4000-8000-000000000002";
const ACTOR = { id: "00000000-0000-4000-8000-000000000003", walletAddress: "11111111111111111111111111111111",
  correlationId: "00000000-0000-4000-8000-000000000004" };
const OPTIONS = { cluster: "localnet" as const, expectedGenesisHash: ACTOR.walletAddress,
  programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo", graceSeconds: 300 };
const RECORD = 1_790_000_000;
const NOW = new Date((RECORD + 301) * 1000);

async function fixture() {
  const addresses = await deriveCorporateActionAddresses(OPTIONS.programId, uuidBytes(INSTRUMENT), uuidBytes(ACTION));
  const action = { id: ACTION, instrumentId: INSTRUMENT, status: "SCHEDULED", version: 3,
    type: "COUPON_PAYMENT", recordAt: new Date(RECORD * 1000), executeAt: new Date((RECORD + 600) * 1000),
    redemptionPercentageBps: null, redemptionPriceMinor: null, snapshot: null as unknown,
    instrument: { id: INSTRUMENT, issuerAuthority: ACTOR.walletAddress, programId: OPTIONS.programId,
      status: "ACTIVE", mintAddress: ACTOR.walletAddress, network: "SOLANA_LOCALNET", version: 2 } };
  const bytes = Buffer.alloc(190);
  createHash("sha256").update("account:CorporateAction").digest().subarray(0, 8).copy(bytes);
  bytes[8] = 1; Buffer.from(uuidBytes(ACTION)).copy(bytes, 9);
  Buffer.from(decodePublicKey(addresses.instrumentAddress)).copy(bytes, 25);
  bytes.writeBigInt64LE(BigInt(RECORD), 58); bytes.writeBigInt64LE(BigInt(RECORD + 600), 66);
  // Coupon options are None, snapshot/counters are zero, SCHEDULED is tag 0.
  bytes.writeBigInt64LE(BigInt(RECORD - 60), 149); bytes[158] = 254;
  const clock = Buffer.alloc(40); clock.writeBigUInt64LE(100n); clock.writeBigInt64LE(BigInt(RECORD + 301), 32);
  const audit: unknown[] = []; const methods: string[] = [];
  let activeAttempt = false; let race = false; let failAudit = false;
  let wrongGenesis = false; let wrongOwner = false; let staleContext = false;
  const tx = {
    corporateAction: {
      findUnique: async () => ({ ...action, version: action.version + (race ? 1 : 0) }),
      updateMany: async () => { action.status = "SNAPSHOT_MISSED"; action.version += 1; return { count: 1 }; }
    },
    blockchainTransaction: { findFirst: async () => activeAttempt ? { id: "pending" } : null },
    auditLog: { create: async (value: unknown) => { if (failAudit) throw new Error("audit unavailable"); audit.push(value); } }
  };
  const database = {
    corporateAction: { findUnique: async () => ({ ...action }) },
    blockchainTransaction: tx.blockchainTransaction,
    snapshot: { findUnique: async () => null },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const previous = { status: action.status, version: action.version };
      try { return await callback(tx); } catch (error) { Object.assign(action, previous); throw error; }
    }
  } as unknown as PrismaClient;
  const rpc: SolanaRpc = { request: async (method, params) => {
    methods.push(method);
    if (method === "getGenesisHash") return wrongGenesis ? OPTIONS.programId : OPTIONS.expectedGenesisHash;
    assert.equal(method, "getAccountInfo");
    assert.equal((params[1] as { commitment: string }).commitment, "finalized");
    const isClock = params[0] === "SysvarC1ock11111111111111111111111111111111";
    if (!isClock) {
      assert.equal(params[0], addresses.actionAddress);
      assert.equal((params[1] as { minContextSlot: number }).minContextSlot, 100);
    }
    return { context: { slot: !isClock && staleContext ? 99 : 100 }, value: { executable: false,
      owner: wrongOwner ? ACTOR.walletAddress : isClock ? "Sysvar1111111111111111111111111111111111111" : OPTIONS.programId,
      data: [(isClock ? clock : bytes).toString("base64"), "base64"] } };
  } };
  return { database, rpc, action, bytes, clock, audit, methods,
    set active(value: boolean) { activeAttempt = value; }, set race(value: boolean) { race = value; },
    set failAudit(value: boolean) { failAudit = value; }, set wrongGenesis(value: boolean) { wrongGenesis = value; },
    set wrongOwner(value: boolean) { wrongOwner = value; }, set staleContext(value: boolean) { staleContext = value; } };
}
const check = (f: Awaited<ReturnType<typeof fixture>>, now = NOW, graceSeconds = 300) =>
  checkSnapshotWindow(f.database, f.rpc, ACTION, { expectedVersion: 3 }, ACTOR, { ...OPTIONS, graceSeconds }, now);

test("only finalized Clock expiry and an uncaptured scheduled PDA mark a missed snapshot", async () => {
  const f = await fixture();
  const result = await check(f);
  assert.equal(result.window, "MISSED"); assert.equal(result.changed, true);
  assert.equal(result.status, "SNAPSHOT_MISSED"); assert.equal(result.version, 4);
  assert.equal(result.onChainTransition, false); assert.equal(f.audit.length, 1);
  const event = f.audit[0] as { data: { event: string; metadataJson: Record<string, unknown> } };
  assert.equal(event.data.event, "CORPORATE_ACTION_SNAPSHOT_MISSED");
  assert.equal(event.data.metadataJson["onChainStatus"], "SCHEDULED");
  const replay = await check(f); assert.equal(replay.changed, false); assert.equal(f.audit.length, 1);
  assert.deepEqual(f.methods, ["getGenesisHash", "getAccountInfo", "getAccountInfo"]);
});

test("not-started and inclusive capture boundaries perform no expiry write or RPC", async () => {
  for (const [seconds, window] of [[-1, "NOT_STARTED"], [0, "OPEN"], [300, "OPEN"]] as const) {
    const f = await fixture(); const result = await check(f, new Date((RECORD + seconds) * 1000));
    assert.equal(result.window, window); assert.equal(f.action.status, "SCHEDULED");
    assert.equal(f.audit.length, 0); assert.deepEqual(f.methods, []);
  }
});

test("a short API window or fast server clock cannot expire the program's inclusive window", async () => {
  for (const [apiGrace, clockOffset] of [[60, 100], [300, 300], [300, 299]]) {
    const f = await fixture(); f.clock.writeBigInt64LE(BigInt(RECORD + clockOffset!), 32);
    assert.equal((await check(f, NOW, apiGrace)).window, "AWAITING_CHAIN_WINDOW_END");
    assert.equal(f.audit.length, 0); assert.equal(f.action.status, "SCHEDULED");
  }
});

test("captured snapshots and all active attempts preserve recovery before expiry", async () => {
  for (const captured of [true, false]) {
    const f = await fixture(); if (captured) f.action.snapshot = { status: "PENDING_REGISTRATION" }; else f.active = true;
    assert.equal((await check(f)).window, "RECOVERY_REQUIRED");
    assert.deepEqual(f.methods, []); assert.equal(f.action.status, "SCHEDULED");
  }
});

test("wrong issuer, version, identifiers and network cannot mutate the action", async () => {
  const f = await fixture();
  for (const [body, actor, options] of [
    [{ expectedVersion: 2 }, ACTOR, OPTIONS], [{ expectedVersion: "3" }, ACTOR, OPTIONS],
    [{ expectedVersion: 3, status: "SNAPSHOT_MISSED" }, ACTOR, OPTIONS],
    [{ expectedVersion: 3 }, { ...ACTOR, walletAddress: OPTIONS.programId }, OPTIONS],
    [{ expectedVersion: 3 }, { ...ACTOR, id: "invalid" }, OPTIONS],
    [{ expectedVersion: 3 }, ACTOR, { ...OPTIONS, programId: ACTOR.walletAddress }]
  ] as const) await assert.rejects(checkSnapshotWindow(f.database, f.rpc, ACTION, body, actor, options, NOW));
  assert.deepEqual(f.methods, []); assert.equal(f.audit.length, 0);
  f.wrongGenesis = true; await assert.rejects(check(f), /genesis differs/);
});

test("invalid Clock ownership, data or slot and stale action context leave expiry unverified", async () => {
  for (const change of ["owner", "clockSlot", "timestamp", "context"] as const) {
    const f = await fixture();
    if (change === "owner") f.wrongOwner = true;
    if (change === "clockSlot") f.clock.writeBigUInt64LE(99n);
    if (change === "timestamp") f.clock.writeBigInt64LE(-1n, 32);
    if (change === "context") f.staleContext = true;
    await assert.rejects(check(f)); assert.equal(f.action.status, "SCHEDULED"); assert.equal(f.audit.length, 0);
  }
});

test("on-chain capture, changed action terms and concurrent writes cannot be classified as missed", async () => {
  for (const change of ["captured", "recordAt", "race"] as const) {
    const f = await fixture();
    if (change === "captured") f.bytes[148] = 2;
    if (change === "recordAt") f.bytes.writeBigInt64LE(BigInt(RECORD + 1), 58);
    if (change === "race") f.race = true;
    await assert.rejects(check(f)); assert.equal(f.action.status, "SCHEDULED"); assert.equal(f.audit.length, 0);
  }
});

test("audit failure rolls back the terminal projection", async () => {
  const f = await fixture(); f.failAudit = true;
  await assert.rejects(check(f), /audit unavailable/);
  assert.equal(f.action.status, "SCHEDULED"); assert.equal(f.action.version, 3);
});

test("late HTTP workflow capture records finalized missed state before returning the blocking error", async () => {
  const f = await fixture();
  await assert.rejects(prepareSnapshotRegistrationForAction(f.database, f.rpc, ACTION, ACTOR,
    { ...OPTIONS, programId: ACTOR.walletAddress, walletNetwork: "SOLANA_LOCALNET", now: NOW }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "WRONG_SOLANA_NETWORK");
  assert.deepEqual(f.methods, []);
  await assert.rejects(prepareSnapshotRegistrationForAction(f.database, f.rpc, ACTION, ACTOR,
    { ...OPTIONS, walletNetwork: "SOLANA_LOCALNET", now: NOW }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "SNAPSHOT_WINDOW_MISSED");
  assert.equal(f.action.status, "SNAPSHOT_MISSED"); assert.equal(f.audit.length, 1);
});

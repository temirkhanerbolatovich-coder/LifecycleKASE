import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildControlledUnitReservation, decodePublicKey, encodePublicKey, TOKEN_2022_PROGRAM_ID,
  CONTROLLED_CAPTURE_BYTES, CONTROLLED_HOLDING_BYTES, CONTROLLED_POLICY_BYTES, CONTROLLED_UNIT_RESERVATION_BYTES, SYSTEM_PROGRAM_ID } from "@lifecycle-kase/solana-client";
import { controlledBurnAllocations, controlledCaptureState, controlledReservationState, requireControlledReservationProof } from "./controlled-settlement.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const key = (value: number) => encodePublicKey(Buffer.alloc(32, value));
const options = { cluster: "localnet" as const, programId: PROGRAM, controlledRegistryEnabled: true,
  expectedGenesisHash: key(91), rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000 };
const hash = "61".repeat(32);
function writer(name: string, size: number) {
  const data = Buffer.alloc(size); createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8); data[8] = 1; let offset = 9;
  return { data, key: (value: string) => { Buffer.from(decodePublicKey(value)).copy(data, offset); offset += 32; },
    bytes: (value: Buffer) => { value.copy(data, offset); offset += value.length; },
    byte: (value: number) => { data[offset++] = value; },
    u32: (value: number) => { data.writeUInt32LE(value, offset); offset += 4; },
    u64: (value: bigint) => { data.writeBigUInt64LE(value, offset); offset += 8; } };
}
async function fixture() {
  const sources = [key(11), key(12)].sort().map((address, index) => ({ address, wallet: key(20), balanceAtSnapshot: index === 0 ? 8n : 2n }));
  const action = { id: "11111111-1111-4111-8111-111111111111", instrumentId: "22222222-2222-4222-8222-222222222222", type: "EARLY_REDEMPTION",
    instrument: { tokenPolicy: "CONTROLLED_FROZEN_V2", mintAddress: key(30), corporateActionAuthority: key(40) },
    snapshot: { snapshotHash: Buffer.from(hash, "hex"), mintSupply: 10n, investors: [{ id: "snapshot-investor", balance: 10n,
      wallets: [{ walletAddress: key(20), tokenAccounts: sources.map(source => ({ address: source.address, balance: source.balanceAtSnapshot })) }] }] },
    entitlements: [{ investorId: "33333333-3333-4333-8333-333333333333", snapshotInvestorId: "snapshot-investor", tokensToRedeem: 2n, onchainPda: "" }] };
  const row = action.entitlements[0]!;
  const plan = await buildControlledUnitReservation({ programId: PROGRAM, instrumentId: Buffer.from(action.instrumentId.replaceAll("-", ""), "hex"),
    actionId: Buffer.from(action.id.replaceAll("-", ""), "hex"), investorId: Buffer.from(row.investorId.replaceAll("-", ""), "hex"),
    corporateActionAuthority: action.instrument.corporateActionAuthority, bondMint: action.instrument.mintAddress, tokenAccounts: sources, snapshotHash: hash });
  row.onchainPda = plan.entitlementAddress;
  const accounts = new Map<string, { owner: string; data: Buffer }>(); const reads: string[] = [];
  function policy(finished = false, completed = false) {
    const out = writer("ControlledPolicy", CONTROLLED_POLICY_BYTES); out.key(plan.instrumentAddress); out.key(action.instrument.mintAddress);
    out.key(finished ? SYSTEM_PROGRAM_ID : plan.actionAddress); out.key(completed ? SYSTEM_PROGRAM_ID : plan.actionAddress); out.byte(1);
    accounts.set(plan.controlledPolicyAddress, { owner: PROGRAM, data: out.data });
  }
  function capture(finished = false, reserved = false) {
    const out = writer("ControlledCapture", CONTROLLED_CAPTURE_BYTES); out.key(plan.instrumentAddress); out.key(plan.actionAddress); out.u64(77n); out.u64(100n);
    out.bytes(Buffer.from(hash, "hex")); out.byte(1); out.byte(finished ? 1 : 0); out.u32(sources.length);
    for (const source of sources) { out.key(source.address); out.key(source.wallet); out.u64(source.balanceAtSnapshot); }
    out.u32(sources.length); sources.forEach(() => out.byte(reserved ? 1 : 0)); out.u32(reserved ? 1 : 0); out.u64(reserved ? row.tokensToRedeem : 0n); out.byte(1);
    accounts.set(plan.controlledCaptureAddress, { owner: PROGRAM, data: out.data });
  }
  function reservation(consumed = false) {
    const out = writer("UnitReservation", CONTROLLED_UNIT_RESERVATION_BYTES); out.key(plan.actionAddress); out.key(plan.entitlementAddress);
    out.bytes(Buffer.from(hash, "hex")); out.bytes(Buffer.from(plan.sourceHash, "hex")); out.u32(sources.length); out.u64(2n); out.u64(0n); out.byte(consumed ? 1 : 0); out.byte(1);
    accounts.set(plan.unitReservationAddress, { owner: PROGRAM, data: out.data });
    sources.forEach((source, index) => {
      const holding = writer("ControlledHolding", CONTROLLED_HOLDING_BYTES); holding.key(plan.instrumentAddress); holding.key(action.instrument.mintAddress);
      holding.key(source.address); holding.key(source.wallet); holding.u64(index === 0 && !consumed ? 2n : 0n); holding.byte(1);
      accounts.set(plan.holdingAddresses[index]!, { owner: PROGRAM, data: holding.data });
    });
  }
  sources.forEach(source => {
    const data = Buffer.alloc(180); Buffer.from(decodePublicKey(action.instrument.mintAddress)).copy(data, 0); Buffer.from(decodePublicKey(source.wallet)).copy(data, 32);
    data.writeBigUInt64LE(source.balanceAtSnapshot, 64); data[108] = 2; data[165] = 2; data.writeUInt16LE(7, 166);
    data.writeUInt16LE(11, 170); data.writeUInt16LE(1, 172); data[174] = 1; data.writeUInt16LE(8, 175); data.writeUInt16LE(1, 177); data[179] = 1;
    accounts.set(source.address, { owner: TOKEN_2022_PROGRAM_ID, data });
  });
  policy(); capture(); reservation();
  const rpc = { request: async (method: string, parameters: unknown[]) => {
    assert.equal(method, "getAccountInfo"); const address = parameters[0] as string; reads.push(address);
    const value = accounts.get(address); return { context: { slot: 100 }, value: value ? { owner: value.owner, executable: false, data: [value.data.toString("base64"), "base64"] } : null };
  } };
  return { action, row, sources, plan, accounts, reads, policy, capture, reservation, rpc };
}

test("controlled calculation verifies complete frozen-capture sources and never substitutes supply-only evidence", async () => {
  const value = await fixture();
  assert.equal((await controlledCaptureState(value.rpc, value.action, options, "CAPTURING", 100))!.capture.holdings.length, 2);
  value.action.snapshot.investors[0]!.wallets[0]!.tokenAccounts[1]!.balance = 1n;
  await assert.rejects(controlledCaptureState(value.rpc, value.action, options, "CAPTURING"), { code: "CONTROLLED_RESERVATION_MISMATCH" });
});
test("controlled approval requires a finished capture and coverage of every source including zero markers", async () => {
  const value = await fixture();
  await assert.rejects(controlledCaptureState(value.rpc, value.action, options, "FINISHED"), { code: "CONTROLLED_RESERVATION_MISMATCH" });
  value.policy(true); value.capture(true, true);
  const state = await controlledCaptureState(value.rpc, value.action, options, "FINISHED"); assert.equal(state!.capture.reservedTokens, 2n);
  value.capture(true, false);
  await assert.rejects(controlledCaptureState(value.rpc, value.action, options, "FINISHED"), { code: "CONTROLLED_RESERVATION_MISMATCH" });
});
test("controlled action completion requires the active-redemption gate to clear", async () => {
  const value = await fixture(); value.policy(true); value.capture(true, true);
  await assert.rejects(controlledCaptureState(value.rpc, value.action, options, "COMPLETED"), { code: "CONTROLLED_RESERVATION_MISMATCH" });
  value.policy(true, true); assert.equal((await controlledCaptureState(value.rpc, value.action, options, "COMPLETED"))!.policy.activeRedemption, SYSTEM_PROGRAM_ID);
});
test("assigned-unit proof permits a closed/re-created zero-allocation source and accepts frozen owner guards", async () => {
  const value = await fixture(); value.accounts.delete(value.sources[1]!.address);
  const result = await controlledReservationState(value.rpc, value.action, value.row, options, false, 100);
  assert.deepEqual(result!.allocations, ["2", "0"]); assert.equal(result!.holdings[0]!.reservedTokens, "2");
  assert.equal(value.reads.includes(value.sources[1]!.address), false);
});
test("positive assigned source must stay frozen and cover its reserved burn before submission", async () => {
  for (const mutation of ["thawed", "insufficient", "wrongOwner", "unsupportedExtension"] as const) {
    const value = await fixture(); const account = value.accounts.get(value.sources[0]!.address)!;
    if (mutation === "thawed") account.data[108] = 1;
    if (mutation === "insufficient") account.data.writeBigUInt64LE(1n, 64);
    if (mutation === "wrongOwner") Buffer.from(decodePublicKey(key(99))).copy(account.data, 32);
    if (mutation === "unsupportedExtension") account.data.writeUInt16LE(15, 170);
    await assert.rejects(controlledReservationState(value.rpc, value.action, value.row, options, false), { code: "CONTROLLED_RESERVATION_MISMATCH" });
  }
});
test("finalized consumption relies on immutable burn history and sidecars even after the empty burned account closes", async () => {
  const value = await fixture(); value.reservation(true); value.accounts.delete(value.sources[0]!.address); value.accounts.delete(value.sources[1]!.address);
  const state = await controlledReservationState(value.rpc, value.action, value.row, options, true, 100);
  assert.equal(state!.consumed, true); assert.deepEqual(state!.holdings.map(holding => holding.reservedTokens), ["0", "0"]);
  assert.equal(value.reads.some(address => value.sources.some(source => source.address === address)), false);
  value.reservation(false);
  await assert.rejects(controlledReservationState(value.rpc, value.action, value.row, options, true), { code: "CONTROLLED_RESERVATION_MISMATCH" });
});
test("Holding owner and reserved amount remain bound even when its token source is untouched", async () => {
  for (const mutation of ["owner", "amount"] as const) {
    const value = await fixture(); const holding = value.accounts.get(value.plan.holdingAddresses[1]!)!;
    if (mutation === "owner") Buffer.from(decodePublicKey(key(99))).copy(holding.data, 105);
    else holding.data.writeBigUInt64LE(1n, 137);
    await assert.rejects(controlledReservationState(value.rpc, value.action, value.row, options, false));
  }
});
test("reservations are independently gated and legacy calculations do not touch controlled RPC accounts", async () => {
  const value = await fixture();
  await assert.rejects(controlledReservationState(value.rpc, value.action, value.row, { ...options, controlledRegistryEnabled: false }, false), { code: "CONTROLLED_REGISTRY_DISABLED" });
  value.action.instrument.tokenPolicy = "LEGACY_UNRESTRICTED_V1";
  assert.equal(await controlledReservationState(value.rpc, value.action, value.row, options, false), null); assert.equal(value.reads.length, 0);
});
test("persisted unit evidence rejects forged source, allocation, owner, consumption and uncleared counters", async () => {
  const value = await fixture(); const state = (await controlledReservationState(value.rpc, value.action, value.row, options, false))!;
  const expected = { unitReservationAddress: state.unitReservationAddress, sourceHash: state.sourceHash, allocations: ["2", "0"], holdingAddresses: state.holdingAddresses,
    tokenAccounts: value.sources, consumed: false };
  requireControlledReservationProof(state, expected);
  const mutations = [{ ...state, sourceHash: "62".repeat(32) }, { ...state, allocations: ["0", "2"] }, { ...state, consumed: true },
    { ...state, holdings: [{ ...state.holdings[0]!, walletAddress: key(99) }, state.holdings[1]!] },
    { ...state, holdings: [{ ...state.holdings[0]!, reservedTokens: "0" }, state.holdings[1]!] }, { ...state, holdings: state.holdings.slice(0, 1) }];
  for (const proof of mutations) assert.throws(() => requireControlledReservationProof(proof, expected), { code: "RECONCILIATION_REQUIRED" });
  assert.deepEqual(controlledBurnAllocations(value.sources, 0n).map(source => source.burnAmount), [0n, 0n]);
});

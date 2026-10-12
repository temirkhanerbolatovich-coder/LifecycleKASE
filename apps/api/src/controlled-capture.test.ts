import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { buildControlledCaptureBegin, CONTROLLED_CAPTURE_BYTES, CONTROLLED_POLICY_BYTES, decodePublicKey,
  deriveControlledCaptureAddress, deriveControlledPolicyAddress, deriveCorporateActionAddresses, SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, type SolanaRpc } from "@lifecycle-kase/solana-client";
import { confirmControlledCapture, getControlledCapture, prepareControlledCapture, readControlledCaptureState } from "./controlled-capture.js";
import { collectLockedControlledSnapshot, requireCapturedRowsMatch, requireControlledSnapshotEvidence } from "./controlled-snapshot.js";
import { assertRegistryMutationAllowed } from "./investor-registry.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MINT = "So11111111111111111111111111111111111111112";
const ACTION = "00000000-0000-4000-8000-000000000001";
const INSTRUMENT = "00000000-0000-4000-8000-000000000002";
const ACTOR = "00000000-0000-4000-8000-000000000003";
const options = { cluster: "localnet" as const, programId: PROGRAM, expectedGenesisHash: KEY, controlledRegistryEnabled: true };
const actor = { id: ACTOR, walletAddress: KEY, correlationId: ACTOR };
const disc = (name: string) => createHash("sha256").update("account:" + name).digest().subarray(0, 8);

async function fixture({ captured = false, committed = false, unlocked = false, stale = false, wrongOwner = false, changeLock = false } = {}) {
  const addresses = await deriveCorporateActionAddresses(PROGRAM, Buffer.from(INSTRUMENT.replaceAll("-", ""), "hex"), Buffer.from(ACTION.replaceAll("-", ""), "hex"));
  const policyAddress = await deriveControlledPolicyAddress(PROGRAM, addresses.instrumentAddress);
  const captureAddress = await deriveControlledCaptureAddress(PROGRAM, addresses.actionAddress);
  const instrument = { id: INSTRUMENT, issuerAuthority: KEY, corporateActionAuthority: KEY, mintAddress: MINT,
    programId: PROGRAM, tokenPolicy: "CONTROLLED_FROZEN_V2", status: "ACTIVE" };
  const action = { id: ACTION, instrumentId: INSTRUMENT, instrument, version: 0, type: "COUPON_PAYMENT",
    status: "SCHEDULED", recordAt: new Date(Date.now() - 10_000), snapshot: null };
  function policyBytes() {
    const bytes = Buffer.alloc(CONTROLLED_POLICY_BYTES); disc("ControlledPolicy").copy(bytes); bytes[8] = 1;
    [addresses.instrumentAddress, MINT, captured && !unlocked ? addresses.actionAddress : SYSTEM_PROGRAM_ID, SYSTEM_PROGRAM_ID].forEach((value, index) => Buffer.from(decodePublicKey(value)).copy(bytes, 9 + index * 32));
    return bytes;
  }
  let captureReads = 0;
  function captureBytes() {
    const bytes = Buffer.alloc(CONTROLLED_CAPTURE_BYTES); disc("ControlledCapture").copy(bytes); bytes[8] = 1;
    Buffer.from(decodePublicKey(addresses.instrumentAddress)).copy(bytes, 9); Buffer.from(decodePublicKey(addresses.actionAddress)).copy(bytes, 41);
    bytes.writeBigUInt64LE(changeLock && captureReads > 1 ? 101n : 100n, 73); bytes.writeBigInt64LE(1_791_765_939n, 81);
    if (committed) { bytes.fill(1, 89, 121); bytes[121] = 1; bytes.writeUInt32LE(1, 123);
      Buffer.from(decodePublicKey(TOKEN_2022_PROGRAM_ID)).copy(bytes, 127); Buffer.from(decodePublicKey(KEY)).copy(bytes, 159);
      bytes.writeBigUInt64LE(35n, 191); bytes.writeUInt32LE(1, 199); }
    return bytes;
  }
  const requests: { method: string; params: readonly unknown[] }[] = [];
  let mintReads = 0;
  const rpc: SolanaRpc = { async request(method, params) {
    requests.push({ method, params });
    if (method === "getGenesisHash") return KEY;
    if (method === "getBlockHeight") return 10;
    if (method === "getLatestBlockhash") return { value: { blockhash: KEY, lastValidBlockHeight: 100 } };
    if (method === "getProgramAccounts") { const data = Buffer.alloc(170);
      Buffer.from(decodePublicKey(MINT)).copy(data); Buffer.from(decodePublicKey(KEY)).copy(data, 32);
      data.writeBigUInt64LE(35n, 64); data[108] = 2; data[165] = 2; data.writeUInt16LE(7, 166);
      return { context: { slot: 102 }, value: [{ pubkey: TOKEN_2022_PROGRAM_ID, account: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [data.toString("base64"), "base64"] } }] }; }
    if (method === "getAccountInfo") {
      let bytes: Buffer | null = null;
      if (params[0] === policyAddress) bytes = policyBytes();
      if (params[0] === captureAddress && captured) { captureReads++; bytes = captureBytes(); }
      if (params[0] === MINT) { mintReads++; const mint = Buffer.alloc(207); mint.writeBigUInt64LE(35n, 36); mint[45] = 1; mint[165] = 1;
        return { context: { slot: mintReads === 1 ? 101 : 103 }, value: { owner: TOKEN_2022_PROGRAM_ID, executable: false, data: [mint.toString("base64"), "base64"] } }; }
      return { context: { slot: stale ? 99 : 104 }, value: bytes ? { owner: wrongOwner ? TOKEN_2022_PROGRAM_ID : PROGRAM, executable: false, data: [bytes.toString("base64"), "base64"] } : null };
    }
    throw new Error("Unexpected RPC " + method);
  } };
  let pending: any = null; const saved: any[] = []; let failAudit = false;
  const tx = { corporateAction: { findUnique: async () => action },
    blockchainTransaction: { findFirst: async () => pending, findMany: async () => saved,
      findUnique: async () => saved[0] ?? null,
      create: async ({ data }: any) => { const operation = { id: ACTOR, status: "PREPARED", ...data }; saved.push(operation); return operation; } },
    auditLog: { create: async () => { if (failAudit) throw new Error("synthetic capture audit failure"); } } };
  const database = { ...tx, $transaction: async (callback: any) => { const size = saved.length;
    try { return await callback(tx); } catch (error) { saved.splice(size); throw error; } } } as unknown as PrismaClient;
  return { rpc, database, instrument, action, requests, saved, setPending: (value: any) => { pending = value; }, failAudit: () => { failAudit = true; } };
}

test("controlled capture requires explicitly enabled Localnet policy before preparing any operation", async () => {
  const f = await fixture();
  for (const invalid of [{ ...options, controlledRegistryEnabled: false }, { ...options, cluster: "devnet" as const }]) {
    await assert.rejects(prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "BEGIN" }, actor, invalid), { code: "CONTROLLED_REGISTRY_DISABLED" });
  }
  assert.equal(f.saved.length, 0);
});
test("capture begin persists an independently reconstructed exact wire with atomic audit", async () => {
  const f = await fixture(); const plan = await prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "BEGIN" }, actor, options);
  assert.ok("phase" in plan && "serializedTransactionBase64" in plan && "controlledCaptureAddress" in plan);
  assert.equal(plan.phase, "BEGIN"); assert.equal(f.saved.length, 1); assert.equal(f.saved[0].operationType, "CONTROLLED_CAPTURE_BEGIN");
  assert.equal(f.saved[0].preparedTransactionBase64, plan.serializedTransactionBase64);
  const expected = await buildControlledCaptureBegin({ programId: PROGRAM, instrumentId: Buffer.from(INSTRUMENT.replaceAll("-", ""), "hex"),
    actionId: Buffer.from(ACTION.replaceAll("-", ""), "hex"), corporateActionAuthority: KEY });
  assert.equal(plan.controlledCaptureAddress, expected.controlledCaptureAddress);
  const rollback = await fixture(); rollback.failAudit();
  await assert.rejects(prepareControlledCapture(rollback.database, rollback.rpc, ACTION, { phase: "BEGIN" }, actor, options), /synthetic capture audit failure/);
  assert.equal(rollback.saved.length, 0);
});
test("signed capture resumes the original attempt and prevents competing abort", async () => {
  const f = await fixture(); const plan = await prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "BEGIN" }, actor, options);
  f.setPending({ ...f.saved[0], signature: "original", status: "UNKNOWN_CONFIRMATION" });
  const resumed = await prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "BEGIN" }, actor, options);
  assert.equal(resumed.signature, "original"); assert.equal(resumed.resumed, true); assert.equal(f.saved.length, 1);
  await assert.rejects(prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "ABORT" }, actor, options), { code: "CONTROLLED_CAPTURE_PENDING" });
  assert.ok(!f.requests.some(row => row.method === "sendTransaction"));
});
test("finalized capture replay still validates signer, saved network and signature format", async () => {
  const f = await fixture(); await prepareControlledCapture(f.database, f.rpc, ACTION, { phase: "BEGIN" }, actor, options);
  const signature = "A".repeat(88); Object.assign(f.saved[0], { status: "FINALIZED", signature });
  const body = { operationId: ACTOR, signature };
  assert.equal((await confirmControlledCapture(f.database, f.rpc, ACTION, body, actor, options)).status, "FINALIZED");
  f.saved[0].networkGenesisHash = MINT;
  await assert.rejects(confirmControlledCapture(f.database, f.rpc, ACTION, body, actor, options), { code: "PREPARED_ATTEMPT_INVALID" });
  f.saved[0].networkGenesisHash = KEY; f.saved[0].requiredSigner = MINT;
  await assert.rejects(confirmControlledCapture(f.database, f.rpc, ACTION, body, actor, options), { code: "WALLET_MISMATCH" });
  f.saved[0].requiredSigner = KEY;
  await assert.rejects(confirmControlledCapture(f.database, f.rpc, ACTION, { ...body, signature: "short" }, actor, options), { code: "INVALID_REQUEST" });
});
test("capture account metadata and minimum finalized context fail closed", async () => {
  const owner = await fixture({ captured: true, wrongOwner: true });
  await assert.rejects(readControlledCaptureState(owner.rpc, owner.instrument, ACTION), { code: "CONTROLLED_CAPTURE_MISMATCH" });
  const stale = await fixture({ captured: true, stale: true });
  await assert.rejects(readControlledCaptureState(stale.rpc, stale.instrument, ACTION, 100), { code: "CONTROLLED_CAPTURE_MISMATCH" });
});
test("complete controlled raw scan requires the original lock and preserves its actual cutoff", async () => {
  const f = await fixture({ captured: true }); const result = await collectLockedControlledSnapshot(f.rpc, f.instrument, ACTION, options);
  assert.equal(result.capture.slot, 100); assert.equal(result.capture.supply, 35n); assert.equal(result.captureEvidence.readSlot, 102);
  assert.equal(result.captureEvidence.startedAt, "1791765939"); assert.equal(result.captureEvidence.registrySha256.length, 64);
  assert.ok(f.requests.filter(row => row.method === "getProgramAccounts" || row.method === "getAccountInfo" && row.params[0] === MINT)
    .every(row => (row.params[1] as any).minContextSlot === 100));
  const unlocked = await fixture({ captured: true, unlocked: true });
  await assert.rejects(collectLockedControlledSnapshot(unlocked.rpc, unlocked.instrument, ACTION, options), { code: "CONTROLLED_CAPTURE_REQUIRED" });
  const changed = await fixture({ captured: true, changeLock: true });
  await assert.rejects(collectLockedControlledSnapshot(changed.rpc, changed.instrument, ACTION, options), { code: "CONTROLLED_CAPTURE_CHANGED" });
});
test("committed capture cannot abort and cannot finish before finalized snapshot", async () => {
  const f = await fixture({ captured: true, committed: true });
  for (const phase of ["ABORT", "FINISH"]) await assert.rejects(prepareControlledCapture(f.database, f.rpc, ACTION, { phase }, actor, options), { code: "CONTROLLED_CAPTURE_NOT_READY" });
  const state = await getControlledCapture(f.database, f.rpc, ACTION, options);
  assert.equal(state.readiness.abort, false); assert.equal(state.readiness.finish, false);
});
test("captured sources must match canonical wallet ownership and balances, not only addresses", () => {
  const canonical = { investors: [{ wallets: [{ wallet_address: KEY, token_accounts: [{ address: MINT, balance: "35" }] }] }] };
  requireCapturedRowsMatch([{ tokenAccount: MINT, walletAddress: KEY, balance: 35n }], canonical);
  for (const row of [{ tokenAccount: MINT, walletAddress: TOKEN_2022_PROGRAM_ID, balance: 35n }, { tokenAccount: MINT, walletAddress: KEY, balance: 34n }]) {
    assert.throws(() => requireCapturedRowsMatch([row], canonical), { code: "CONTROLLED_CAPTURE_MISMATCH" });
  }
});
test("registry mutation checks long-running locks and unsigned or unknown BEGIN attempts", async () => {
  let where: any;
  await assert.rejects(assertRegistryMutationAllowed({ corporateAction: { findFirst: async (args: any) => { where = args.where; return { id: ACTION }; } } } as any,
    { now: new Date(), graceSeconds: 300 }), { code: "REGISTRY_CAPTURE_LOCKED" });
  assert.equal(where.OR[1].controlledCaptureLocked, true);
  assert.deepEqual(where.OR[2].blockchainTransactions.some.status.in, ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"]);
});
test("raw evidence survives JSONB key reordering while exact serialized bytes remain hash-bound", async () => {
  const f = await fixture({ captured: true }); const result = await collectLockedControlledSnapshot(f.rpc, f.instrument, ACTION, options);
  const canonical = { mint_address: MINT, mint_supply: "35", solana_slot: "100", block_time: result.blockTime.toISOString(),
    investors: [{ wallets: [{ wallet_address: KEY, token_accounts: [{ address: TOKEN_2022_PROGRAM_ID, balance: "35" }] }] }] };
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ?
    Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  requireControlledSnapshotEvidence(reorder(result.captureEvidence), canonical);
  assert.throws(() => requireControlledSnapshotEvidence({ ...result.captureEvidence, registrySha256: "00".repeat(32) }, canonical), { code: "CONTROLLED_CAPTURE_MISMATCH" });
  const forged = structuredClone(result.captureEvidence);
  (forged.registry["positions"] as any[])[0].balance = "34";
  forged.registryCanonicalJson = JSON.stringify(forged.registry); forged.registrySha256 = createHash("sha256").update(forged.registryCanonicalJson).digest("hex");
  assert.throws(() => requireControlledSnapshotEvidence(forged, canonical), { code: "CONTROLLED_CAPTURE_MISMATCH" });
  assert.throws(() => requireControlledSnapshotEvidence(result.captureEvidence, { ...canonical, solana_slot: "99" }), { code: "CONTROLLED_CAPTURE_MISMATCH" });
});

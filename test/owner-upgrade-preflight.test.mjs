import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { checkOwnerUpgrade, verifyUpgradeArtifact } from "../scripts/check-owner-upgrade.mjs";
import { decodePublicKey } from "../packages/solana-client/dist/index.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const AUTHORITY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const PROGRAM_DATA = "7NagSKwRazhqVzfPm6wYJbMAUsb5Gaovz4AM5UpADukF";
const BUFFER = "QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6";
const GENESIS = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const retained = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]);
const candidate = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 3]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const program = Buffer.alloc(36); program.writeUInt32LE(2); program.set(decodePublicKey(PROGRAM_DATA), 4);
  const data = Buffer.alloc(45 + retained.length); data.writeUInt32LE(3); data.writeBigUInt64LE(2n, 4);
  data[12] = 1; data.set(decodePublicKey(AUTHORITY), 13); data.set(retained, 45);
  const buffer = Buffer.alloc(37 + candidate.length); buffer.writeUInt32LE(1); buffer[4] = 1;
  buffer.set(decodePublicKey(AUTHORITY), 5); buffer.set(candidate, 37);
  const account = (bytes, executable) => ({ owner: LOADER, executable, lamports: 100,
    data: [bytes.toString("base64"), "base64"] });
  const accounts = [account(program, true), account(data, false),
    { owner: "11111111111111111111111111111111", executable: false, lamports: 10_000_000 }, account(buffer, false)];
  const plan = { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899", expectedGenesisHash: GENESIS,
    programId: PROGRAM, programData: PROGRAM_DATA, upgradeAuthority: AUTHORITY, retainedBytes: retained.length,
    retainedSha256: sha(retained), candidateBytes: candidate.length, candidateSha256: sha(candidate), feeReserveLamports: 10000 };
  const calls = [];
  const rpc = { async request(method, params) {
    calls.push(method);
    if (method === "getGenesisHash") return GENESIS;
    if (method === "getMultipleAccounts") return { context: { slot: 20 }, value: accounts.slice(0, params[0].length) };
    if (method === "getMinimumBalanceForRentExemption") return 1000;
    throw new Error(`Unexpected mutation/read ${method}`);
  } };
  return { plan, accounts, rpc, calls, data, buffer };
}

test("owner preflight is read-only, requires staged bytes before emitting instructions and keeps authorization false", async () => {
  const f = fixture();
  const unstaged = await checkOwnerUpgrade(f.plan, f.rpc, retained, candidate);
  assert.equal(unstaged.stagingRequired, true); assert.deepEqual(unstaged.instructions, []);
  const report = await checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER);
  assert.equal(report.bufferVerified, true); assert.equal(report.additionalBytes, 10240);
  assert.equal(report.extensionRentLamports, 900); assert.equal(report.instructions.length, 1);
  assert.equal(report.nextPhase, "EXTEND");
  assert.equal(report.transactionSubmitted, false); assert.equal(report.upgradeAuthorized, false);
  const extended = Buffer.alloc(45 + report.currentProgramCapacity + report.additionalBytes);
  extended.set(f.data); extended.writeBigUInt64LE(19n, 4);
  f.accounts[1].data[0] = extended.toString("base64"); f.accounts[1].lamports = 1000;
  const next = await checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER);
  assert.equal(next.nextPhase, "UPGRADE"); assert.equal(next.additionalBytes, 0);
  assert.equal(next.extensionRentLamports, 0); assert.equal(next.instructions.length, 1);
  assert.equal(next.instructions[0].data, "03000000");
  extended.writeBigUInt64LE(20n, 4); f.accounts[1].data[0] = extended.toString("base64");
  await assert.rejects(checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER), /slot mismatch/);
  assert.ok(f.calls.every(method => ["getGenesisHash", "getMultipleAccounts", "getMinimumBalanceForRentExemption"].includes(method)));
});

test("preflight rejects altered artifacts, non-local origins, wrong genesis, pointer, authority, bytes and rent balance", async () => {
  for (const change of [
    f => { f.plan.rpcUrl = "https://api.devnet.solana.com"; },
    f => { f.plan.cluster = "devnet"; },
    f => { f.plan.rpcUrl = "http://127.0.0.1:8899/?token=hidden"; },
    f => { f.plan.expectedGenesisHash = BUFFER; },
    f => { f.plan.programData = BUFFER; },
    f => { f.accounts[0].owner = PROGRAM; },
    f => { f.accounts[1].executable = true; },
    f => { f.plan.upgradeAuthority = BUFFER; },
    f => { f.accounts[2].lamports = 1; },
    f => { f.buffer[4] = 0; f.accounts[3].data[0] = f.buffer.toString("base64"); },
    f => { f.buffer[37] = 0; f.accounts[3].data[0] = f.buffer.toString("base64"); },
    f => { f.accounts[3].data[0] = Buffer.concat([f.buffer, Buffer.from([0])]).toString("base64"); },
    f => { f.data[45] = 0; f.accounts[1].data[0] = f.data.toString("base64"); },
    f => { f.plan.candidateSha256 = "a".repeat(64); }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER));
  }
  assert.throws(() => verifyUpgradeArtifact(Buffer.alloc(5), 5, sha(Buffer.alloc(5))));
});

test("nonzero deployed/buffer tails and a changing genesis cannot be accepted as matching artifacts", async () => {
  for (const index of [1, 3]) {
    const f = fixture(); const bytes = Buffer.concat([Buffer.from(f.accounts[index].data[0], "base64"), Buffer.from([1])]);
    f.accounts[index].data[0] = bytes.toString("base64");
    await assert.rejects(checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER));
  }
  const f = fixture(); const request = f.rpc.request; let reads = 0;
  f.rpc.request = (method, params) => method === "getGenesisHash" && ++reads > 1 ? BUFFER : request(method, params);
  await assert.rejects(checkOwnerUpgrade(f.plan, f.rpc, retained, candidate, BUFFER), /genesis changed/);
});

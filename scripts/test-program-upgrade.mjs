import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { decodePublicKey, deriveUpgradeableProgramData, encodePublicKey, verifySignedPreparedTransaction }
  from "../packages/solana-client/dist/index.js";
import { confirmProgramUpgrade, getProgramUpgrade, prepareProgramUpgrade, submitProgramUpgrade }
  from "../apps/api/dist/program-upgrade.js";

const ownerGenesis = "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF";
const sha = value => createHash("sha256").update(value).digest("hex");
const sleep = () => new Promise(resolve => setTimeout(resolve, 500));

/** Runs against a generated database only; injected live RPC must be a disposable validator. */
export async function testProgramUpgradeFlow({ rpc, options, signWire, afterExtension = async () => {} }) {
  assert.notEqual(options.plan.expectedGenesisHash, ownerGenesis, "Never test maintenance on the retained owner ledger");
  const base = new URL(process.env.UPGRADE_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://lifecycle_kase:local_development_only@[::1]:55432/lifecycle_kase?schema=public");
  if (base.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.pathname !== "/lifecycle_kase" || !base.port) throw new Error("Upgrade tests require an explicit loopback lifecycle_kase base database");
  const name = `upgrades_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^upgrades_test_[a-f0-9]{32}$/);
  const url = new URL(base); url.pathname = "/" + name;
  const admin = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let created = false;
  const bufferAddress = options.bufferAddress;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
    const migration = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8" });
    if (migration.status !== 0) throw new Error("Isolated upgrade database migration failed");
    const user = await database.user.create({ data: { displayName: "Disposable upgrade authority", role: "ADMINISTRATOR" } });
    const actor = { id: user.id, walletAddress: options.plan.upgradeAuthority, correlationId: randomUUID() };
    const prepare = () => prepareProgramUpgrade(database, rpc, { bufferAddress }, actor, options);
    await assert.rejects(prepareProgramUpgrade(database, rpc, { bufferAddress, rpcUrl: "http://127.0.0.1:1" }, actor, options));
    await assert.rejects(prepareProgramUpgrade(database, rpc, { bufferAddress }, { ...actor, walletAddress: options.plan.programId }, options));
    const pendingBusiness = await database.blockchainTransaction.create({ data: { operationType: "SYNTHETIC_BUSINESS_TRANSACTION",
      status: "SUBMITTED", signature: "A".repeat(88), requiredSigner: actor.walletAddress } });
    await assert.rejects(prepare(), /Confirm signed business attempts/);
    assert.equal(await database.programUpgrade.count(), 0);
    await database.blockchainTransaction.delete({ where: { id: pendingBusiness.id } });
    async function auditFailure(event, task) {
      assert.ok(["PROGRAM_UPGRADE_PREPARED", "PROGRAM_UPGRADE_FINALIZED"].includes(event));
      await database.$executeRawUnsafe(`CREATE FUNCTION test_upgrade_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event = '${event}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
      await database.$executeRawUnsafe("CREATE TRIGGER test_upgrade_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_upgrade_audit_failure()");
      try { await assert.rejects(task()); }
      finally {
        await database.$executeRawUnsafe("DROP TRIGGER test_upgrade_audit_failure ON audit_logs");
        await database.$executeRawUnsafe("DROP FUNCTION test_upgrade_audit_failure()");
      }
    }
    await auditFailure("PROGRAM_UPGRADE_PREPARED", prepare);
    assert.equal(await database.programUpgrade.count(), 0); assert.equal(await database.blockchainTransaction.count(), 0);
    const results = await Promise.allSettled([prepare(), prepare()]);
    assert.ok(results.some(result => result.status === "fulfilled"), results.map(result => result.reason?.message).join("\n"));
    const initial = results.find(result => result.status === "fulfilled").value;
    assert.equal(await database.programUpgrade.count(), 1);
    assert.equal(await database.blockchainTransaction.count(), 1);
    assert.equal((await prepare()).operationId, initial.operationId);
    assert.equal(initial.phase, "EXTEND");
    await database.blockchainTransaction.update({ where: { id: initial.operationId }, data: { lastValidBlockHeight: 0n } });
    const refreshed = await prepare(); assert.notEqual(refreshed.operationId, initial.operationId);
    assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: initial.operationId } })).lastErrorCode, "BLOCKHASH_EXPIRED");
    assert.equal(await database.auditLog.count({ where: { event: "PROGRAM_UPGRADE_ATTEMPT_EXPIRED" } }), 1);
    const phases = [];
    for (const phase of ["EXTEND", "UPGRADE"]) {
      const prepared = await prepare(); assert.equal(prepared.phase, phase);
      await assert.rejects(database.issuer.create({ data: { legalName: "Blocked during maintenance" } }), /PROGRAM_UPGRADE_MAINTENANCE/);
      const signed = signWire(prepared.serializedTransactionBase64);
      const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: prepared.serializedTransactionBase64,
        signedTransactionBase64: signed, requiredSigner: actor.walletAddress });
      const changedAccounts = { request: async (method, params) => {
        const result = await rpc.request(method, params);
        if (method !== "getProgramAccounts") return result;
        const changed = structuredClone(result);
        assert.ok(changed.value.length > 0, "Preservation rejection needs an existing program account");
        const bytes = Buffer.from(changed.value[0].account.data[0], "base64"); bytes[bytes.length - 1] ^= 1;
        changed.value[0].account.data[0] = bytes.toString("base64"); return changed;
      } };
      await assert.rejects(submitProgramUpgrade(database, changedAccounts,
        { operationId: prepared.operationId, signedTransactionBase64: signed }, actor, options), /Protected program accounts changed/);
      let sends = 0;
      const lostResponse = { request: async (method, params) => {
        const response = await rpc.request(method, params);
        if (method === "sendTransaction") { sends++; throw new Error("synthetic lost broadcast response"); }
        return response;
      } };
      const changed = Buffer.from(signed, "base64"); changed[changed.length - 1] ^= 1;
      await assert.rejects(submitProgramUpgrade(database, rpc, { operationId: prepared.operationId, signedTransactionBase64: changed.toString("base64") }, actor, options), /does not match/);
      const submissions = await Promise.allSettled([1, 2].map(() => submitProgramUpgrade(database, lostResponse,
        { operationId: prepared.operationId, signedTransactionBase64: signed }, actor, options)));
      assert.ok(submissions.every(result => result.status === "rejected"));
      assert.ok(submissions.some(result => result.reason.message.includes("synthetic lost")));
      assert.equal(sends, 1);
      const saved = await prepare(); assert.equal(saved.operationId, prepared.operationId); assert.equal(saved.signature, signature);
      assert.equal(saved.status, "UNKNOWN_CONFIRMATION");
      await assert.rejects(submitProgramUpgrade(database, lostResponse, { operationId: prepared.operationId, signedTransactionBase64: signed }, actor, options), /confirm it/);
      assert.equal(sends, 1);
      async function confirm() {
        return confirmProgramUpgrade(database, rpc, { operationId: prepared.operationId, signature }, actor, options);
      }
      const deadline = Date.now() + 60000;
      while (!(await rpc.request("getTransaction", [signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }])) ||
          await rpc.request("getSlot", [{ commitment: "finalized" }]) <= Number((await rpc.request("getTransaction", [signature,
            { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }])).slot)) {
        if (Date.now() >= deadline) throw new Error("Disposable phase did not finalize"); await sleep();
      }
      // Reload recovery remains available even after Upgrade has consumed its buffer.
      assert.equal((await getProgramUpgrade(database, rpc, options)).attempt.signature, signature);
      await auditFailure("PROGRAM_UPGRADE_FINALIZED", confirm);
      assert.equal((await database.programUpgrade.findFirst()).status, "ACTIVE");
      assert.equal((await database.blockchainTransaction.findUniqueOrThrow({ where: { id: prepared.operationId } })).status, "UNKNOWN_CONFIRMATION");
      const confirmation = await confirm(); assert.equal(confirmation.status, "FINALIZED");
      assert.equal((await confirm()).status, "FINALIZED");
      assert.equal((await database.programUpgrade.findFirst()).status, phase === "EXTEND" ? "ACTIVE" : "VERIFIED");
      phases.push({ phase, operationId: prepared.operationId, signature });
      if (phase === "EXTEND") await afterExtension();
    }
    assert.equal(await database.auditLog.count({ where: { event: "PROGRAM_UPGRADE_PREPARED" } }), 3);
    assert.equal(await database.auditLog.count({ where: { event: "PROGRAM_UPGRADE_FINALIZED" } }), 2);
    await database.issuer.create({ data: { legalName: "Writes resume only after verified Upgrade" } });
    console.log("PASS durable upgrade service/PostgreSQL: concurrency, business lock, exact signed phases, lost-response/reload, no rebroadcast, audit rollback, preserved PDAs and verified release");
    return phases;
  } finally {
    await database.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}

async function syntheticFixture() {
  const pair = generateKeyPairSync("ed25519");
  const authority = encodePublicKey(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const programId = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
  const programData = await deriveUpgradeableProgramData(programId);
  const bufferAddress = "QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6";
  const genesis = encodePublicKey(Buffer.alloc(32, 9));
  const retained = Buffer.from([127, 69, 76, 70, 1]); const candidate = Buffer.from([127, 69, 76, 70, 2, 3]);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); program.set(decodePublicKey(programData), 4);
  let deployed = Buffer.alloc(45 + retained.length); deployed.writeUInt32LE(3); deployed.writeBigUInt64LE(2n, 4);
  deployed[12] = 1; deployed.set(decodePublicKey(authority), 13); deployed.set(retained, 45);
  const buffer = Buffer.alloc(37 + candidate.length); buffer.writeUInt32LE(1); buffer[4] = 1; buffer.set(decodePublicKey(authority), 5); buffer.set(candidate, 37);
  const loaderAccount = (bytes, executable) => ({ owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable, lamports: 1000, data: [bytes.toString("base64"), "base64"] });
  let consumed = false; const transactions = new Map(); let slot = 50;
  const rpc = { request: async (method, params) => {
    if (method === "getGenesisHash") return genesis;
    if (method === "getMultipleAccounts") return { context: { slot }, value: [loaderAccount(program, true), loaderAccount(deployed, false),
      { owner: "11111111111111111111111111111111", executable: false, lamports: 10000000 }, ...(params[0].length === 4 ? [consumed ? null : loaderAccount(buffer, false)] : [])] };
    if (method === "getProgramAccounts") return { context: { slot }, value: [{ pubkey: bufferAddress,
      account: { owner: programId, executable: false, lamports: 100, data: ["AQ==", "base64"] } }] };
    if (method === "getMinimumBalanceForRentExemption") return 1000;
    if (method === "getFeeForMessage") return { value: 5000 };
    if (method === "getLatestBlockhash") return { value: { blockhash: genesis, lastValidBlockHeight: 1000 } };
    if (method === "getBlockHeight") return 1;
    if (method === "getSlot") return slot;
    if (method === "getTransaction") return transactions.get(params[0]) ?? null;
    if (method === "sendTransaction") {
      const unsigned = Buffer.from(params[0], "base64"); unsigned.fill(0, 1, 65);
      const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: unsigned.toString("base64"),
        signedTransactionBase64: params[0], requiredSigner: authority });
      slot++;
      if (!consumed && deployed.length < 1000) { const extended = Buffer.alloc(deployed.length + 10240); deployed.copy(extended); deployed = extended; }
      else { deployed.fill(0, 45); deployed.set(candidate, 45); consumed = true; }
      deployed.writeBigUInt64LE(BigInt(slot), 4); transactions.set(signature, { slot, meta: { err: null }, transaction: [params[0], "base64"] }); slot++;
      return signature;
    }
    throw new Error("Unexpected synthetic method " + method);
  } };
  return { rpc, options: { bufferAddress, retained, candidate, plan: { cluster: "localnet", rpcUrl: "http://127.0.0.1:1",
    expectedGenesisHash: genesis, programId, programData, upgradeAuthority: authority, retainedBytes: retained.length, retainedSha256: sha(retained),
    candidateBytes: candidate.length, candidateSha256: sha(candidate), feeReserveLamports: 10000 } }, signWire: wire => {
      const bytes = Buffer.from(wire, "base64"); sign(null, bytes.subarray(65), pair.privateKey).copy(bytes, 1); return bytes.toString("base64");
    } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await testProgramUpgradeFlow(await syntheticFixture());
}

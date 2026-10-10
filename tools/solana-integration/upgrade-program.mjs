// Disposable runtime acceptance only. The production builder does not hold keys or submit.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { testProgramUpgradeFlow } from "../../scripts/test-program-upgrade.mjs";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import anchor from "@anchor-lang/core";
import { buildProgramUpgrade, decodeUpgradeableProgramData, decodeUpgradeableBuffer,
  serializeUnsignedInstructionsTransaction, verifySignedPreparedTransaction, verifyFinalizedTransaction, HttpSolanaRpc }
  from "../../packages/solana-client/dist/index.js";

const [rpcUrl, administratorPath, programId, bufferAddress, candidatePath] = process.argv.slice(2);
const url = new URL(rpcUrl);
assert.equal(url.protocol, "http:");
assert.ok(/^(127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)$/.test(url.hostname));
assert.ok(Number(url.port) >= 18890 && Number(url.port) <= 65532, "Only isolated test ports are allowed");
assert.ok(/\/tmp\/lifecycle-kase-integration\.[^/]+\/admin\.json$/.test(administratorPath.replaceAll("\\", "/")),
  "Only the wrapper's disposable administrator path is allowed");
const connection = new Connection(rpcUrl, "finalized");
assert.notEqual(await connection.getGenesisHash(), "B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF", "Never target the retained owner genesis");
const administrator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(administratorPath, "utf8"))));
const candidate = await readFile(candidatePath);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const [programData] = PublicKey.findProgramAddressSync([new PublicKey(programId).toBytes()], loader);
const before = await connection.getAccountInfo(programData, "finalized");
assert.ok(before); assert.equal(before.owner.toBase58(), loader.toBase58());
const decoded = decodeUpgradeableProgramData(before.data);
assert.equal(decoded.authority, administrator.publicKey.toBase58());
const bufferInfo = await connection.getAccountInfo(new PublicKey(bufferAddress), "finalized");
assert.ok(bufferInfo); assert.equal(bufferInfo.owner.toBase58(), loader.toBase58());
const buffer = decodeUpgradeableBuffer(bufferInfo.data);
assert.equal(buffer.authority, administrator.publicKey.toBase58());
assert.deepEqual(buffer.programBytes, candidate);
const extension = await buildProgramUpgrade({ phase: "EXTEND", programId, bufferAddress, authority: administrator.publicKey.toBase58(),
  currentProgramCapacity: decoded.programBytes.length, candidateBytes: candidate.length });
assert.ok(extension.additionalBytes > 0, "This runtime test must exercise extension");
const upgrade = await buildProgramUpgrade({ phase: "UPGRADE", programId, bufferAddress, authority: administrator.publicKey.toBase58(),
  currentProgramCapacity: extension.finalProgramCapacity, candidateBytes: candidate.length });

async function submit(instructions, failedInstruction = null) {
  const latest = await connection.getLatestBlockhash("finalized");
  const unsigned = serializeUnsignedInstructionsTransaction({ instructions, feePayer: administrator.publicKey.toBase58(),
    recentBlockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  const transaction = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64"));
  transaction.sign([administrator]);
  const signed = transaction.serialize();
  const signature = verifySignedPreparedTransaction({ expectedUnsignedTransactionBase64: unsigned,
    signedTransactionBase64: Buffer.from(signed).toString("base64"), requiredSigner: administrator.publicKey.toBase58() });
  assert.equal(await connection.sendRawTransaction(signed, { skipPreflight: failedInstruction !== null }), signature);
  const confirmation = await connection.confirmTransaction({ ...latest, signature }, "finalized");
  const finalized = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  assert.ok(finalized);
  const finalWire = new VersionedTransaction(finalized.transaction.message,
    finalized.transaction.signatures.map(value => Uint8Array.from(anchor.utils.bytes.bs58.decode(value))));
  verifyFinalizedTransaction({ expectedUnsignedTransactionBase64: unsigned,
    finalizedTransactionBase64: Buffer.from(finalWire.serialize()).toString("base64"),
    requiredSigner: administrator.publicKey.toBase58(), signature });
  if (failedInstruction !== null) {
    assert.ok(confirmation.value.err);
    assert.equal(finalized.meta.err.InstructionError[0], failedInstruction,
      `Failure must occur in the expected loader phase: ${JSON.stringify({ error: finalized.meta.err, logs: finalized.meta.logMessages })}`);
  } else { assert.equal(confirmation.value.err, null); assert.equal(finalized.meta.err, null); }
  return finalized.slot;
}

// Extend changes the deployment slot, so a combined valid Upgrade must fail and roll back.
await submit([...extension.instructions, ...upgrade.instructions], 3);
const rolledBack = await connection.getAccountInfo(programData, "finalized");
assert.deepEqual(rolledBack.data, before.data);
assert.equal(rolledBack.lamports, before.lamports);
console.log("PASS same-transaction Extend/Upgrade is rejected and rolls back allocation/rent; separate phases are required");

async function waitLater(slot) {
  const deadline = Date.now() + 30000;
  while (await connection.getSlot("finalized") <= slot) {
    if (Date.now() >= deadline) throw new Error("Next finalized slot did not arrive");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
// A loopback test proxy lets the production preflight enforce its real origin restriction.
// The upstream is the disposable validator already pinned above, never the owner network.
const proxy = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) { body += chunk; if (body.length > 10000) throw new Error("Oversized test RPC request"); }
    const upstream = await fetch(rpcUrl, { method: "POST", body, headers: { "content-type": "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15000) });
    response.statusCode = upstream.status; response.setHeader("Content-Type", "application/json"); response.end(await upstream.text());
  } catch { response.statusCode = 502; response.end("Disposable RPC proxy failure"); }
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
let phases;
try {
  const loopback = `http://127.0.0.1:${proxy.address().port}`;
  const retained = Buffer.from(decoded.programBytes);
  phases = await testProgramUpgradeFlow({ rpc: new HttpSolanaRpc(loopback, 15000), options: {
    bufferAddress, retained, candidate, plan: { cluster: "localnet", rpcUrl: loopback,
      expectedGenesisHash: await connection.getGenesisHash(), programId, programData: programData.toBase58(),
      upgradeAuthority: administrator.publicKey.toBase58(), retainedBytes: retained.length,
      retainedSha256: createHash("sha256").update(retained).digest("hex"), candidateBytes: candidate.length,
      candidateSha256: createHash("sha256").update(candidate).digest("hex"), feeReserveLamports: 5000000 }
  }, signWire: unsigned => {
    const transaction = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64")); transaction.sign([administrator]);
    return Buffer.from(transaction.serialize()).toString("base64");
  }, afterExtension: async () => {
    const extended = await connection.getAccountInfo(programData, "finalized");
    const state = decodeUpgradeableProgramData(extended.data);
    assert.equal(state.authority, decoded.authority); assert.equal(state.programBytes.length, extension.finalProgramCapacity);
    assert.deepEqual(state.programBytes.subarray(0, decoded.programBytes.length), decoded.programBytes);
    assert.ok(state.programBytes.subarray(decoded.programBytes.length).every(byte => byte === 0));
    console.log("PASS separate exact-v0 EXTEND preserves authority and old program bytes with zero padding");
    const broken = upgrade.instructions.map(i => ({ ...i, accounts: i.accounts.map(a => ({ ...a })) }));
    broken[0].accounts[2].address = administrator.publicKey.toBase58();
    await submit(broken, 2);
    const failed = await connection.getAccountInfo(programData, "finalized");
    assert.deepEqual(failed.data, extended.data); assert.equal(failed.lamports, extended.lamports);
    console.log("PASS failed separate Upgrade preserves extended retained ProgramData and rent for recovery");
  } });
} finally { await new Promise(resolve => proxy.close(resolve)); }
const upgradeTransaction = await connection.getTransaction(phases[1].signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
const upgradeSlot = upgradeTransaction.slot;
await waitLater(upgradeSlot);
const after = await connection.getAccountInfo(programData, "finalized");
assert.equal(after.owner.toBase58(), loader.toBase58());
const upgraded = decodeUpgradeableProgramData(after.data);
assert.equal(upgraded.authority, decoded.authority);
assert.deepEqual(upgraded.programBytes, candidate);
assert.equal(upgraded.deployedAtSlot, BigInt(upgradeSlot));
const consumed = await connection.getAccountInfo(new PublicKey(bufferAddress), "finalized");
assert.ok(!consumed || consumed.lamports === 0);
console.log(`PASS separate single-signer exact-v0 EXTEND/UPGRADE; candidate SHA-256 ${createHash("sha256").update(upgraded.programBytes).digest("hex")}`);

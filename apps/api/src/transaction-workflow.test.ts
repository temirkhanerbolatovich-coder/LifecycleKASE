import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { encodePublicKey, serializeUnsignedInstructionsTransaction } from "@lifecycle-kase/solana-client";
import { resumeWorkflowAttempt, submitWorkflowTransaction, TransactionWorkflowError,
  unavailableWorkflowTransaction, verifyWorkflowFinalization } from "./transaction-workflow.js";

const KEY = "11111111111111111111111111111111";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const walletAddress = encodePublicKey(pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const wire = serializeUnsignedInstructionsTransaction({ instructions: [{ programId: PROGRAM, accounts: [
    { address: walletAddress, isSigner: true, isWritable: true }], data: new Uint8Array([1]) }], feePayer: walletAddress,
    recentBlockhash: KEY, lastValidBlockHeight: 100 });
  const signed = Buffer.from(wire, "base64"); sign(null, signed.subarray(65), pair.privateKey).copy(signed, 1);
  const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + signed.subarray(1, 65).toString("hex")); let signature = "";
  while (value > 0n) { signature = base58[Number(value % 58n)] + signature; value /= 58n; }
  for (const byte of signed.subarray(1, 65)) { if (byte !== 0) break; signature = "1" + signature; }
  const operation = { id: "00000000-0000-4000-8000-000000000001", operationType: "ACTION_SCHEDULE", corporateActionId: "00000000-0000-4000-8000-000000000002",
    requiredSigner: walletAddress, networkGenesisHash: KEY, preparedTransactionBase64: wire, recentBlockhash: KEY,
    lastValidBlockHeight: 100n, signature: null as string | null, status: "PREPARED" };
  const writes: any[] = []; const events: any[] = []; const methods: string[] = [];
  const transaction = { blockchainTransaction: { updateMany: async (args: any) => { writes.push(args); return { count: 1 }; } },
    auditLog: { create: async (args: any) => { events.push(args); return args; } } };
  const database = { ...transaction, $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction) };
  let sendFails = false; let genesis = KEY; let transactionResult: unknown = { slot: 90, meta: { err: null }, transaction: [signed.toString("base64"), "base64"] };
  const rpc = { request: async (method: string) => {
    methods.push(method);
    if (method === "getGenesisHash") return genesis;
    if (method === "sendTransaction") { if (sendFails) throw new Error("transport unavailable"); return signature; }
    if (method === "getTransaction") return transactionResult;
    if (method === "getBlockHeight") return 999;
    throw new Error(method);
  } };
  const actor = { id: operation.id, walletAddress, correlationId: operation.corporateActionId };
  const options = { cluster: "localnet" as const, expectedGenesisHash: KEY, programId: PROGRAM };
  return { operation, signed, signature, database, rpc, actor, options, writes, events, methods,
    failSend: () => { sendFails = true; }, wrongNetwork: () => { genesis = PROGRAM; },
    changeTransaction: (value: unknown) => { transactionResult = value; } };
}
const code = (expected: string) => (error: unknown) => error instanceof TransactionWorkflowError && error.code === expected;

test("trusted action/snapshot transport verifies exact Ed25519 message and signer before broadcast", async () => {
  const f = fixture();
  const result = await submitWorkflowTransaction(f.database as never, f.rpc, f.operation as never, f.signed.toString("base64"), f.actor, f.options);
  assert.equal(result.signature, f.signature); assert.equal(result.status, "SUBMITTED");
  assert.equal(f.events[0].data.event, "TRANSACTION_SUBMISSION_REQUESTED");
  const changed = Buffer.from(f.signed); changed[changed.length - 1]! ^= 1;
  await assert.rejects(submitWorkflowTransaction(f.database as never, f.rpc, f.operation as never, changed.toString("base64"), f.actor, f.options), code("SIGNED_TRANSACTION_INVALID"));
  await assert.rejects(submitWorkflowTransaction(f.database as never, f.rpc, f.operation as never, f.signed.toString("base64"), { ...f.actor, walletAddress: KEY }, f.options), code("WALLET_MISMATCH"));
  await assert.rejects(submitWorkflowTransaction(f.database as never, f.rpc, f.operation as never, f.signed.toString("base64"), f.actor, { ...f.options, cluster: "devnet" }), code("TRUSTED_BROADCAST_NOT_AVAILABLE"));
  assert.equal(f.methods.filter(method => method === "sendTransaction").length, 1);
});
test("lost broadcast response preserves the original signature for confirmation", async () => {
  const f = fixture(); f.failSend();
  await assert.rejects(submitWorkflowTransaction(f.database as never, f.rpc, f.operation as never, f.signed.toString("base64"), f.actor, f.options), /transport unavailable/);
  assert.equal(f.writes.at(-1).data.status, "UNKNOWN_CONFIRMATION"); assert.equal(f.writes.at(-1).data.lastErrorCode, "SUBMISSION_RESPONSE_UNKNOWN");
  assert.equal(f.writes.at(-1).where.signature, f.signature);
});
test("signed attempts resume after expiry; unsigned attempts expire with a compare-and-set guard", async () => {
  const f = fixture(); f.operation.signature = f.signature; f.operation.status = "UNKNOWN_CONFIRMATION";
  assert.equal(await resumeWorkflowAttempt(f.database as never, f.rpc, f.operation as never, f.actor, KEY), true);
  assert.equal(f.methods.length, 0); assert.equal(f.writes.length, 0);
  f.operation.signature = null; f.operation.status = "PREPARED";
  assert.equal(await resumeWorkflowAttempt(f.database as never, f.rpc, f.operation as never, f.actor, KEY), false);
  assert.deepEqual(f.writes[0].where, { id: f.operation.id, status: "PREPARED", signature: null });
  assert.equal(f.writes[0].data.lastErrorCode, "BLOCKHASH_EXPIRED");
});
test("finalization rejects wrong network and unrelated messages before marking a transaction failed", async () => {
  const f = fixture();
  assert.equal(await verifyWorkflowFinalization(f.database as never, f.rpc, f.operation as never, f.signature, f.actor, KEY), 90);
  f.wrongNetwork();
  await assert.rejects(verifyWorkflowFinalization(f.database as never, f.rpc, f.operation as never, f.signature, f.actor, KEY), code("WRONG_SOLANA_NETWORK"));
  const g = fixture(); const changed = Buffer.from(g.signed); changed[changed.length - 1]! ^= 1;
  g.changeTransaction({ slot: 90, meta: { err: "failed" }, transaction: [changed.toString("base64"), "base64"] });
  await assert.rejects(verifyWorkflowFinalization(g.database as never, g.rpc, g.operation as never, g.signature, g.actor, KEY), code("TRANSACTION_MISMATCH"));
  assert.equal(g.writes.length, 0);
});
test("unavailable history never finalizes or overwrites a concurrently recorded signature", async () => {
  for (const [status, valid, expected] of [[null, true, "TRANSACTION_NOT_FINALIZED"], [null, false, "TRANSACTION_UNAVAILABLE"],
    [{ confirmationStatus: "finalized" }, false, "TRANSACTION_HISTORY_UNAVAILABLE"]] as const) {
    const f = fixture();
    const rpc = { request: async (method: string) => method === "getSignatureStatuses" ? { value: [status] } : { value: valid } };
    await assert.rejects(unavailableWorkflowTransaction(f.database as never, rpc, f.operation, f.signature), code(expected));
    assert.equal(f.writes[0].data.status, "UNKNOWN_CONFIRMATION"); assert.equal(f.writes[0].data.signature, f.signature);
    assert.deepEqual(f.writes[0].where.OR, [{ signature: null }, { signature: f.signature }]);
  }
});

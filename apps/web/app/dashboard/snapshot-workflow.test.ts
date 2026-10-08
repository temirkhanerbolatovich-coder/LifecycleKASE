import assert from "node:assert/strict";
import test from "node:test";
import { encodeBase58, isActionId, preparedSnapshot, requireFinalizedResponse, resumedDeploymentSignature, signedPreparedTransaction, transactionSignature, unsignedTransactionBytes, unsignedTransactionForSigner, walletChainForCluster } from "./snapshot-workflow.js";

const ACTION = "00000000-0000-4000-8000-000000000001";
const OPERATION = "00000000-0000-4000-8000-000000000002";
const KEY = "11111111111111111111111111111111";

test("resumed signed deployments recover their signature and cannot become a new signing prompt", () => {
  const signature = "2".repeat(64);
  assert.equal(resumedDeploymentSignature({ resumed: false }), null);
  assert.equal(resumedDeploymentSignature({ resumed: true, status: "PREPARED", signature: null }), null);
  for (const status of ["SUBMITTED", "UNKNOWN_CONFIRMATION"]) {
    assert.equal(resumedDeploymentSignature({ resumed: true, status, signature }), signature);
  }
  for (const payload of [
    { resumed: true }, { resumed: true, status: "SUBMITTED", signature: null },
    { resumed: true, status: "UNKNOWN_CONFIRMATION", signature: "invalid" },
    { resumed: true, status: "PREPARED", signature }, { resumed: true, status: "FAILED", signature }
  ]) assert.throws(() => resumedDeploymentSignature(payload), /повторная отправка остановлена/);
});
function fixture(): Record<string, unknown> {
  const wire = new Uint8Array(200);
  wire[0] = 1; wire[65] = 128; wire[66] = 1; wire[69] = 2;
  return { corporateActionId: ACTION, operationId: OPERATION, snapshotId: ACTION, cluster: "devnet",
    requiredSigner: KEY, programId: KEY, actionAddress: KEY, networkGenesisHash: KEY,
    snapshotHash: "ab".repeat(32), recordAt: "2026-09-30T10:00:00Z", effectiveBlockTime: "2026-09-30T10:01:00Z",
    effectiveSlot: "101", lastValidBlockHeight: 200, transactionFormat: "SOLANA_V0_WIRE_TRANSACTION_BASE64",
    recordPointMode: "DEMO_CAPTURE_SLOT", serializedTransactionBase64: Buffer.from(wire).toString("base64") };
}

test("validates action identifiers and accepts matching Localnet and Devnet plans", () => {
  assert.equal(isActionId(ACTION), true);
  assert.equal(isActionId("../../auth"), false);
  assert.equal(preparedSnapshot(fixture(), ACTION, KEY).operationId, OPERATION);
  assert.equal(preparedSnapshot({ ...fixture(), cluster: "localnet" }, ACTION, KEY).cluster, "localnet");
  assert.equal(walletChainForCluster("localnet"), "solana:localnet");
  assert.equal(walletChainForCluster("devnet"), "solana:devnet");
});
test("rejects wrong network, signer, action, format and malformed review fields", () => {
  for (const changes of [
    { cluster: "mainnet" }, { cluster: "testnet" }, { requiredSigner: "other" },
    { corporateActionId: OPERATION }, { operationId: "bad" }, { snapshotHash: "bad" },
    { recordPointMode: "HISTORICAL" }, { transactionFormat: "other" }, { effectiveSlot: "1.1" },
    { recordAt: "invalid" }, { lastValidBlockHeight: -1 }, { programId: "bad" }
  ]) assert.throws(() => preparedSnapshot({ ...fixture(), ...changes }, ACTION, KEY));
});
test("rejects transaction fee payer differing from the session signer", () => {
  const payload = fixture();
  const wire = Buffer.from(payload.serializedTransactionBase64 as string, "base64");
  assert.deepEqual([...unsignedTransactionForSigner(wire.toString("base64"), KEY)], [...wire]);
  wire[70] = 1;
  payload.serializedTransactionBase64 = wire.toString("base64");
  assert.throws(() => preparedSnapshot(payload, ACTION, KEY));
  assert.throws(() => unsignedTransactionForSigner(wire.toString("base64"), KEY), /Fee payer/);
  assert.throws(() => unsignedTransactionForSigner(fixture().serializedTransactionBase64 as string, "invalid"), /Fee payer/);
});
test("rejects signed, legacy, oversized and noncanonical transaction bytes", () => {
  const wire = Buffer.from(fixture().serializedTransactionBase64 as string, "base64");
  for (const [index, value] of [[0, 2], [1, 1], [65, 0], [69, 128]] as const) {
    const changed = Buffer.from(wire); changed[index] = value;
    assert.throws(() => unsignedTransactionBytes(changed.toString("base64")));
  }
  assert.throws(() => unsignedTransactionBytes(Buffer.alloc(1233).toString("base64")));
  assert.throws(() => unsignedTransactionBytes("%%"));
  assert.throws(() => unsignedTransactionBytes(wire.toString("base64") + "="));
});
test("encodes wallet signatures to base58 with leading zero preservation", () => {
  assert.equal(encodeBase58(new Uint8Array([0, 0, 1])), "112");
  assert.equal(encodeBase58(new Uint8Array([255])), "5Q");
  const signature = new Uint8Array(64); signature[63] = 1;
  assert.equal(transactionSignature(signature), "1".repeat(63) + "2");
  assert.throws(() => transactionSignature(new Uint8Array(32)));
  assert.throws(() => transactionSignature(new Uint8Array(64)));
});
test("accepts only a signature over the exact prepared transaction", () => {
  const unsignedBase64 = fixture().serializedTransactionBase64 as string;
  const signed = Buffer.from(unsignedBase64, "base64");
  signed.fill(7, 1, 65);
  const result = signedPreparedTransaction(signed, unsignedBase64, KEY);
  assert.equal(result.signedTransactionBase64, signed.toString("base64"));
  assert.equal(result.signature, encodeBase58(signed.subarray(1, 65)));
  const changed = Buffer.from(signed); changed[changed.length - 1]! ^= 1;
  assert.throws(() => signedPreparedTransaction(changed, unsignedBase64, KEY), /изменил/);
  signed.fill(0, 1, 65);
  assert.throws(() => signedPreparedTransaction(signed, unsignedBase64, KEY), /подпись/);
});
test("submission is not treated as finalization; response must match operation and signature", () => {
  const response = { status: "FINALIZED", operationId: OPERATION, signature: "signed" };
  requireFinalizedResponse(response, OPERATION, "signed");
  for (const changes of [{ status: "SUBMITTED" }, { status: "UNKNOWN_CONFIRMATION" }, { operationId: ACTION }, { signature: "other" }]) {
    assert.throws(() => requireFinalizedResponse({ ...response, ...changes }, OPERATION, "signed"));
  }
});

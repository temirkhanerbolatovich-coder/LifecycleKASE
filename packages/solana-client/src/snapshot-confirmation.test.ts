import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";

import { buildSnapshotRegistrationInstruction } from "./snapshot-registration.js";
import { decodeConfirmedSnapshotAccount, verifyFinalizedSnapshotTransaction,
  verifySignedPreparedTransaction } from "./snapshot-confirmation.js";
import { encodePublicKey } from "./base58.js";
import { serializeUnsignedSnapshotRegistrationTransaction } from "./snapshot-transaction.js";

const KEY = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";

async function transactionFixture() {
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: PROGRAM,
    instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2),
    issuerAuthority: KEY,
    bondMint: MINT,
    snapshotHash: "ab".repeat(32),
    snapshotSlot: 101n,
    investorCount: 1,
    walletCount: 1,
    totalBalance: 10n,
    mintSupply: 10n
  });
  const unsigned = serializeUnsignedSnapshotRegistrationTransaction({
    instruction,
    feePayer: KEY,
    recentBlockhash: MINT,
    lastValidBlockHeight: 200
  });
  const signed = Buffer.from(unsigned, "base64");
  signed.fill(7, 1, 65);
  const signature = getBase58Decoder().decode(signed.subarray(1, 65));
  return { unsigned, signed: signed.toString("base64"), signature };
}

test("accepts only the signed form of the prepared snapshot transaction", async () => {
  const fixture = await transactionFixture();
  assert.doesNotThrow(() => verifyFinalizedSnapshotTransaction({
    expectedUnsignedTransactionBase64: fixture.unsigned,
    finalizedTransactionBase64: fixture.signed,
    requiredSigner: KEY,
    signature: fixture.signature
  }));
  const changed = Buffer.from(fixture.signed, "base64");
  changed[changed.length - 1]! ^= 1;
  assert.throws(() => verifyFinalizedSnapshotTransaction({
    expectedUnsignedTransactionBase64: fixture.unsigned,
    finalizedTransactionBase64: changed.toString("base64"),
    requiredSigner: KEY,
    signature: fixture.signature
  }), /prepared message/);
  assert.throws(() => verifyFinalizedSnapshotTransaction({
    expectedUnsignedTransactionBase64: fixture.unsigned,
    finalizedTransactionBase64: fixture.signed,
    requiredSigner: KEY,
    signature: "1".repeat(64)
  }), /signature/);
});

test("cryptographically verifies a wallet-signed prepared transaction", async () => {
  const keypair = generateKeyPairSync("ed25519");
  const publicDer = keypair.publicKey.export({ type: "spki", format: "der" });
  const signer = encodePublicKey(publicDer.subarray(-32));
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: PROGRAM,
    instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2),
    issuerAuthority: signer,
    bondMint: MINT,
    snapshotHash: "ab".repeat(32),
    snapshotSlot: 101n,
    investorCount: 1,
    walletCount: 1,
    totalBalance: 10n,
    mintSupply: 10n
  });
  const unsigned = serializeUnsignedSnapshotRegistrationTransaction({
    instruction,
    feePayer: signer,
    recentBlockhash: MINT,
    lastValidBlockHeight: 200
  });
  const wire = Buffer.from(unsigned, "base64");
  const decoded = getTransactionDecoder().decode(wire);
  sign(null, Buffer.from(decoded.messageBytes), keypair.privateKey).copy(wire, 1);
  const signature = verifySignedPreparedTransaction({
    expectedUnsignedTransactionBase64: unsigned,
    signedTransactionBase64: wire.toString("base64"),
    requiredSigner: signer
  });
  assert.equal(signature, getBase58Decoder().decode(wire.subarray(1, 65)));
  const changedFee = Buffer.from(serializeUnsignedSnapshotRegistrationTransaction({
    instruction, feePayer: signer, recentBlockhash: MINT, lastValidBlockHeight: 200,
    computeUnitPriceMicroLamports: 1n
  }), "base64");
  sign(null, changedFee.subarray(65), keypair.privateKey).copy(changedFee, 1);
  assert.throws(() => verifySignedPreparedTransaction({
    expectedUnsignedTransactionBase64: unsigned, signedTransactionBase64: changedFee.toString("base64"),
    requiredSigner: signer
  }), /prepared message/, "Even a valid signer cannot silently change the persisted priority fee");
  wire[1]! ^= 1;
  assert.throws(() => verifySignedPreparedTransaction({
    expectedUnsignedTransactionBase64: unsigned,
    signedTransactionBase64: wire.toString("base64"),
    requiredSigner: signer
  }), /signature/);
});

test("decodes the snapshot commitment from a SnapshotCreated action account", () => {
  const data = Buffer.alloc(8 + 1 + 16 + 32 + 1 + 8 + 8 + 1 + 1 + 32 + 8 + 4 + 4 + 8 + 8 + 4 + 4 + 1 + 8 + 1 + 1);
  createHash("sha256").update("account:CorporateAction").digest().copy(data, 0, 0, 8);
  let offset = 8;
  data[offset++] = 1;
  data.fill(2, offset, offset + 16); offset += 16;
  offset += 32;
  data[offset++] = 0;
  offset += 8 + 8;
  data[offset++] = 0;
  data[offset++] = 0;
  data.fill(0xab, offset, offset + 32); offset += 32;
  data.writeBigUInt64LE(101n, offset); offset += 8;
  data.writeUInt32LE(1, offset); offset += 4;
  data.writeUInt32LE(2, offset); offset += 4;
  data.writeBigUInt64LE(10n, offset); offset += 8;
  offset += 8 + 4 + 4;
  data[offset] = 2;
  const decoded = decodeConfirmedSnapshotAccount(data.toString("base64"));
  assert.equal(decoded.snapshotHash, "ab".repeat(32));
  assert.equal(decoded.snapshotSlot, 101n);
  assert.equal(decoded.investorCount, 1);
  assert.equal(decoded.walletCount, 2);
  assert.equal(decoded.totalBalance, 10n);
  assert.equal(decoded.status, "SNAPSHOT_CREATED");
  const wrongStatus = Buffer.from(data);
  wrongStatus[offset] = 1;
  assert.throws(() => decodeConfirmedSnapshotAccount(wrongStatus.toString("base64")), /SnapshotCreated/);
});

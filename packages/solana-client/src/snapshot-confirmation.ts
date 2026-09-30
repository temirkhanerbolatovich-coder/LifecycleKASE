import { createHash } from "node:crypto";

import { getSignatureFromTransaction, getTransactionDecoder, signature } from "@solana/kit";

import { decodePublicKey, encodePublicKey } from "./base58.js";

export type ConfirmedSnapshotAccount = {
  actionId: Uint8Array;
  instrumentAddress: string;
  snapshotHash: string;
  snapshotSlot: bigint;
  investorCount: number;
  walletCount: number;
  totalBalance: bigint;
  status: "SNAPSHOT_CREATED";
};

function decodeBase64(value: string, name: string): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(name + " is not valid base64");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(name + " is not canonical base64");
  return decoded;
}

/** Verifies that a finalized wire transaction is the signed form of the prepared transaction. */
export function verifyFinalizedSnapshotTransaction(input: {
  expectedUnsignedTransactionBase64: string;
  finalizedTransactionBase64: string;
  requiredSigner: string;
  signature: string;
}): void {
  decodePublicKey(input.requiredSigner);
  signature(input.signature);
  const decoder = getTransactionDecoder();
  const expected = decoder.decode(decodeBase64(input.expectedUnsignedTransactionBase64, "Prepared transaction"));
  const finalized = decoder.decode(decodeBase64(input.finalizedTransactionBase64, "Finalized transaction"));
  if (!Buffer.from(expected.messageBytes).equals(Buffer.from(finalized.messageBytes))) {
    throw new Error("Finalized transaction does not match the prepared message");
  }
  if (Object.keys(expected.signatures).length !== 1 ||
      !Object.hasOwn(expected.signatures, input.requiredSigner) ||
      Object.keys(finalized.signatures).length !== 1 ||
      !Object.hasOwn(finalized.signatures, input.requiredSigner)) {
    throw new Error("Finalized transaction has an unexpected signer set");
  }
  if (getSignatureFromTransaction(finalized) !== input.signature) {
    throw new Error("Finalized transaction signature does not match the request");
  }
}

function requireBytes(data: Buffer, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new Error("Corporate action account data is truncated");
  }
}

function readOption(data: Buffer, offset: number, valueLength: number): number {
  requireBytes(data, offset, 1);
  const tag = data[offset];
  if (tag === 0) return offset + 1;
  if (tag !== 1) throw new Error("Corporate action account contains an invalid option tag");
  requireBytes(data, offset + 1, valueLength);
  return offset + 1 + valueLength;
}

/** Decodes and validates the immutable snapshot fields written by the Anchor program. */
export function decodeConfirmedSnapshotAccount(dataBase64: string): ConfirmedSnapshotAccount {
  const data = decodeBase64(dataBase64, "Corporate action account");
  const discriminator = createHash("sha256").update("account:CorporateAction").digest().subarray(0, 8);
  requireBytes(data, 0, 8);
  if (!data.subarray(0, 8).equals(discriminator)) {
    throw new Error("Corporate action account discriminator is invalid");
  }
  let offset = 8;
  requireBytes(data, offset, 1 + 16 + 32 + 1 + 8 + 8);
  offset += 1; // account version
  const actionId = data.subarray(offset, offset + 16); offset += 16;
  const instrumentAddress = encodePublicKey(data.subarray(offset, offset + 32)); offset += 32;
  offset += 1 + 8 + 8; // action type, record_at, execute_at
  offset = readOption(data, offset, 2);
  offset = readOption(data, offset, 8);
  requireBytes(data, offset, 32 + 8 + 4 + 4 + 8 + 8 + 4 + 4 + 1);
  const snapshotHash = data.subarray(offset, offset + 32).toString("hex"); offset += 32;
  const snapshotSlot = data.readBigUInt64LE(offset); offset += 8;
  const investorCount = data.readUInt32LE(offset); offset += 4;
  const walletCount = data.readUInt32LE(offset); offset += 4;
  const totalBalance = data.readBigUInt64LE(offset); offset += 8;
  offset += 8 + 4 + 4; // total amount, registered entitlements, processed entitlements
  const status = data[offset];
  if (status !== 2) throw new Error("Corporate action account is not in SnapshotCreated state");
  return {
    actionId: Uint8Array.from(actionId),
    instrumentAddress,
    snapshotHash,
    snapshotSlot,
    investorCount,
    walletCount,
    totalBalance,
    status: "SNAPSHOT_CREATED"
  };
}

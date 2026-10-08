import assert from "node:assert/strict";
import test from "node:test";

import { decodePublicKey } from "./base58.js";
import { getTransactionDecoder, getCompiledTransactionMessageDecoder } from "@solana/kit";

import { buildSnapshotRegistrationInstruction } from "./snapshot-registration.js";
import { COMPUTE_BUDGET_PROGRAM_ID, serializeUnsignedInstructionsTransaction,
  serializeUnsignedSnapshotRegistrationTransaction } from "./snapshot-transaction.js";

const FEE_PAYER = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";

test("serializes a wallet-signable v0 snapshot registration transaction", async () => {
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: PROGRAM,
    instrumentId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
    actionId: Uint8Array.from({ length: 16 }, (_, index) => index + 17),
    issuerAuthority: FEE_PAYER,
    bondMint: MINT,
    snapshotHash: "11".repeat(32),
    snapshotSlot: 101n,
    investorCount: 2,
    walletCount: 3,
    totalBalance: 35n,
    mintSupply: 35n
  });
  const encoded = serializeUnsignedSnapshotRegistrationTransaction({
    instruction,
    feePayer: FEE_PAYER,
    recentBlockhash: MINT,
    lastValidBlockHeight: 200
  });
  const decoded = getTransactionDecoder().decode(Buffer.from(encoded, "base64"));
  assert.deepEqual(Object.values(decoded.signatures), [null]);
  assert.notEqual(Buffer.from(decoded.messageBytes).indexOf(Buffer.from(decodePublicKey(MINT))), -1);
  assert.equal(decoded.messageBytes.length > instruction.data.length, true);
});

test("persists explicit compute budget and zero demo priority price before wallet signing", () => {
  const input = { instructions: [{ programId: PROGRAM,
    accounts: [{ address: FEE_PAYER, isSigner: true, isWritable: true }], data: Uint8Array.from([9]) }],
    feePayer: FEE_PAYER, recentBlockhash: MINT, lastValidBlockHeight: 200 };
  const decoded = getTransactionDecoder().decode(Buffer.from(serializeUnsignedInstructionsTransaction(input), "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  if (message.version !== 0) throw new Error("Expected a v0 message");
  assert.equal(message.instructions.length, 3);
  for (const instruction of message.instructions.slice(0, 2)) {
    assert.equal(message.staticAccounts[instruction.programAddressIndex], COMPUTE_BUDGET_PROGRAM_ID);
  }
  assert.equal(Buffer.from(message.instructions[0]!.data!).readUInt32LE(1), 400_000);
  assert.equal(Buffer.from(message.instructions[1]!.data!).readBigUInt64LE(1), 0n);
  assert.throws(() => serializeUnsignedInstructionsTransaction({ ...input, computeUnitLimit: 1_400_001 }), /Compute/);
  assert.throws(() => serializeUnsignedInstructionsTransaction({ ...input, computeUnitPriceMicroLamports: -1n }), /Compute/);
  assert.throws(() => serializeUnsignedInstructionsTransaction({ ...input, instructions: [...input.instructions,
    { programId: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: Uint8Array.from([2]) }] }), /serializer options/);
});

test("rejects a different fee payer or invalid block height", async () => {
  const instruction = await buildSnapshotRegistrationInstruction({
    programId: PROGRAM,
    instrumentId: new Uint8Array(16).fill(1),
    actionId: new Uint8Array(16).fill(2),
    issuerAuthority: FEE_PAYER,
    bondMint: MINT,
    snapshotHash: "22".repeat(32),
    snapshotSlot: 1n,
    investorCount: 1,
    walletCount: 1,
    totalBalance: 1n,
    mintSupply: 1n
  });
  assert.throws(() => serializeUnsignedSnapshotRegistrationTransaction({
    instruction, feePayer: MINT, recentBlockhash: MINT, lastValidBlockHeight: 200
  }));
  assert.throws(() => serializeUnsignedSnapshotRegistrationTransaction({
    instruction, feePayer: FEE_PAYER, recentBlockhash: MINT, lastValidBlockHeight: -1
  }));
});

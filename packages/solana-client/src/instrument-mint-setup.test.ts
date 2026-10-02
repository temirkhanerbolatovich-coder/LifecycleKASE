import assert from "node:assert/strict";
import test from "node:test";
import { getTransactionDecoder } from "@solana/kit";

import { buildInstrumentMintSetup } from "./instrument-mint-setup.js";
import { serializeUnsignedInstructionsTransaction } from "./snapshot-transaction.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const ADMIN = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";

test("builds deterministic single-signer mint setup with canonical supply and revoked authority", async () => {
  const plan = await buildInstrumentMintSetup({ programId: PROGRAM,
    instrumentId: Uint8Array.from({ length: 16 }, (_, index) => index + 1), administrator: ADMIN,
    bondRentLamports: 2_000_000n, settlementRentLamports: 1_500_000n, totalSupply: 35n });
  assert.equal(plan.bondMint, "5PXKatp7FuZjMkgc9w8N4nP8o7vEjFfdK5PY9gt9Fgd9");
  assert.equal(plan.settlementMint, "6fTrvHgM4SaNR67mhUCWBBQSWC1k8wZfuo6bupZ6Mbaz");
  assert.equal(plan.treasuryTokenAccount, "FbCaQHM2nCe1gLoqBLciC86socdSmHvnN9MiiFa8t2Mj");
  assert.equal(plan.instructions.length, 8);
  assert.equal(Buffer.from(plan.instructions[6]!.data).toString("hex"), "072300000000000000");
  assert.equal(Buffer.from(plan.instructions[7]!.data).toString("hex"), "060000000000");
  const encoded = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: ADMIN,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 3 });
  const decoded = getTransactionDecoder().decode(Buffer.from(encoded, "base64"));
  assert.deepEqual(Object.keys(decoded.signatures), [ADMIN]);
  assert.equal(decoded.messageBytes.length < 1232, true);
});

test("rejects another required signer and invalid supply", async () => {
  await assert.rejects(buildInstrumentMintSetup({ programId: PROGRAM, instrumentId: new Uint8Array(16),
    administrator: ADMIN, bondRentLamports: 1n, settlementRentLamports: 1n, totalSupply: 0n }));
  const plan = await buildInstrumentMintSetup({ programId: PROGRAM, instrumentId: new Uint8Array(16),
    administrator: ADMIN, bondRentLamports: 1n, settlementRentLamports: 1n, totalSupply: 35n });
  const altered = [...plan.instructions, { programId: PROGRAM,
    accounts: [{ address: PROGRAM, isSigner: true, isWritable: false }], data: new Uint8Array() }];
  assert.throws(() => serializeUnsignedInstructionsTransaction({ instructions: altered, feePayer: ADMIN,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 3 }), /exactly the external fee payer/);
});

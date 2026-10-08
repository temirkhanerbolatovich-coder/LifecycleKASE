import assert from "node:assert/strict";
import test from "node:test";
import { buildProgramUpgrade, decodeUpgradeableBuffer, decodeUpgradeableProgram,
  decodeUpgradeableProgramData, programUpgradeCapacity } from "./program-upgrade.js";
import { decodePublicKey } from "./base58.js";
import { serializeUnsignedInstructionsTransaction } from "./snapshot-transaction.js";
import { getTransactionDecoder } from "@solana/kit";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const AUTHORITY = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const BUFFER = "QZYBisMjqfcWA2Vk4Ygvt8SZ4Vt9rTXfnmu6DkrKFh6";

test("each extension/upgrade phase has one wallet signer and preserves canonical ProgramData", async () => {
  const plan = await buildProgramUpgrade({ phase: "EXTEND", programId: PROGRAM, bufferAddress: BUFFER, authority: AUTHORITY,
    currentProgramCapacity: 290136, candidateBytes: 344640 });
  assert.equal(plan.programData, "7NagSKwRazhqVzfPm6wYJbMAUsb5Gaovz4AM5UpADukF");
  assert.equal(plan.additionalBytes, 54504);
  assert.equal(plan.finalProgramCapacity, 344640);
  assert.equal(plan.spillAddress, AUTHORITY);
  assert.deepEqual(plan.instructions.map(i => Buffer.from(i.data).toString("hex")), ["06000000e8d40000"]);
  assert.ok(plan.instructions.every(i => i.accounts.filter(a => a.isSigner).every(a => a.address === AUTHORITY)));
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: AUTHORITY,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10 });
  assert.deepEqual(Object.keys(getTransactionDecoder().decode(Buffer.from(wire, "base64")).signatures), [AUTHORITY]);
  assert.ok(Buffer.from(wire, "base64").length < 1232);
  await assert.rejects(buildProgramUpgrade({ phase: "UPGRADE", programId: PROGRAM, bufferAddress: BUFFER, authority: AUTHORITY,
    currentProgramCapacity: 290136, candidateBytes: 344640 }), /separate transaction/);
});

test("capacity skips unnecessary extension and enforces minimum increment and loader bounds", async () => {
  assert.deepEqual(programUpgradeCapacity(100, 101), { additionalBytes: 10240, finalProgramCapacity: 10340 });
  const maximum = 10 * 1024 * 1024 - 45;
  assert.deepEqual(programUpgradeCapacity(maximum - 1, maximum), { additionalBytes: 1, finalProgramCapacity: maximum });
  for (const n of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN]) assert.throws(() => programUpgradeCapacity(n, 10));
  const plan = await buildProgramUpgrade({ phase: "UPGRADE", programId: PROGRAM, bufferAddress: BUFFER, authority: AUTHORITY,
    currentProgramCapacity: 344640, candidateBytes: 290136 });
  assert.equal(plan.instructions.length, 1);
  assert.equal(Buffer.from(plan.instructions[0]!.data).toString("hex"), "03000000");
  assert.equal(plan.instructions[0]!.accounts[2]!.address, BUFFER);
  assert.equal(plan.additionalBytes, 0);
  await assert.rejects(buildProgramUpgrade({ phase: "EXTEND", programId: PROGRAM, bufferAddress: AUTHORITY, authority: AUTHORITY,
    currentProgramCapacity: 10, candidateBytes: 20 }));
  await assert.rejects(buildProgramUpgrade({ phase: "EXTEND", programId: PROGRAM, bufferAddress: BUFFER, authority: AUTHORITY,
    currentProgramCapacity: 344640, candidateBytes: 290136 }), /sufficient capacity/);
});

test("loader metadata distinguishes program pointer, live authority, immutable state and malformed bytes", () => {
  const program = Buffer.alloc(36); program.writeUInt32LE(2); program.set(decodePublicKey(BUFFER), 4);
  assert.equal(decodeUpgradeableProgram(program), BUFFER);
  const data = Buffer.alloc(50); data.writeUInt32LE(3); data.writeBigUInt64LE(100n, 4); data[12] = 1;
  data.set(decodePublicKey(AUTHORITY), 13);
  assert.equal(decodeUpgradeableProgramData(data).authority, AUTHORITY);
  assert.equal(decodeUpgradeableProgramData(data).deployedAtSlot, 100n);
  assert.equal(decodeUpgradeableProgramData(data).programBytes.length, 5);
  data[12] = 0; assert.equal(decodeUpgradeableProgramData(data).authority, null);
  data[12] = 2; assert.throws(() => decodeUpgradeableProgramData(data));
  const buffer = Buffer.alloc(40); buffer.writeUInt32LE(1); buffer[4] = 1; buffer.set(decodePublicKey(AUTHORITY), 5);
  assert.equal(decodeUpgradeableBuffer(buffer).authority, AUTHORITY);
  for (const bad of [Buffer.alloc(0), Buffer.alloc(44), program]) assert.throws(() => decodeUpgradeableProgramData(bad));
  assert.throws(() => decodeUpgradeableBuffer(data));
  assert.throws(() => decodeUpgradeableProgram(Buffer.concat([program, Buffer.alloc(1)])));
});

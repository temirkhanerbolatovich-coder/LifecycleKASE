import assert from "node:assert/strict";
import test from "node:test";

import { buildSnapshotRegistrationInstruction } from "./snapshot-registration.js";

const base = {
  programId: "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo",
  instrumentId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
  actionId: Uint8Array.from({ length: 16 }, (_, index) => index + 33),
  issuerAuthority: "11111111111111111111111111111111",
  bondMint: "So11111111111111111111111111111111111111112",
  snapshotHash: "ab".repeat(32),
  snapshotSlot: 100n,
  investorCount: 2,
  walletCount: 3,
  totalBalance: 35n,
  mintSupply: 35n
};

test("encodes the complete registration commitment with stable PDAs", async () => {
  const first = await buildSnapshotRegistrationInstruction(base);
  const second = await buildSnapshotRegistrationInstruction(base);
  assert.equal(first.instrumentAddress, second.instrumentAddress);
  assert.equal(first.actionAddress, second.actionAddress);
  assert.deepEqual(first.data, second.data);
  const data = Buffer.from(first.data);
  assert.equal(data.length, 72);
  assert.equal(data.subarray(8, 40).toString("hex"), base.snapshotHash);
  assert.equal(data.readBigUInt64LE(40), 100n);
  assert.equal(data.readUInt32LE(48), 2);
  assert.equal(data.readUInt32LE(52), 3);
  assert.equal(data.readBigUInt64LE(56), 35n);
  assert.equal(data.readBigUInt64LE(64), 35n);
});

test("rejects invalid registration values before deriving an instruction", async () => {
  for (const invalid of [
    { snapshotHash: "00".repeat(32) },
    { snapshotSlot: 0n },
    { walletCount: 1 },
    { totalBalance: 34n },
    { totalBalance: 1n << 64n },
    { actionId: new Uint8Array(15) }
  ]) {
    await assert.rejects(buildSnapshotRegistrationInstruction({ ...base, ...invalid }));
  }
});

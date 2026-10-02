import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { decodePublicKey } from "./base58.js";
import { buildInstrumentActivation, buildInstrumentInitialization,
  decodeConfirmedInstrumentAccount } from "./instrument-lifecycle.js";

const ADMIN = "5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM";
const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const BOND = "9bHwb1ghrc3e1ntCyrgccNHVAppbtRJu1bAwHybjpAWK";
const SETTLEMENT = "6heq5Nw2ErTWsaAYxWS8ZKtzorgpNdwNNeH4QMXWD3Bk";
const ID = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

test("builds canonical initialize and activate instructions", async () => {
  const initialized = await buildInstrumentInitialization({ programId: PROGRAM, instrumentId: ID,
    administrator: ADMIN, bondMint: BOND, settlementMint: SETTLEMENT,
    complianceAuthority: ADMIN, corporateActionAuthority: ADMIN, faceValueMinor: 1_000_000n,
    couponRateBps: 1000, paymentsPerYear: 2, issueAt: 1_700_000_000n,
    maturityAt: 1_800_000_000n, totalSupply: 35n });
  assert.equal(initialized.instruction.accounts.length, 9);
  assert.deepEqual(Buffer.from(initialized.instruction.data).subarray(0, 8),
    createHash("sha256").update("global:initialize_instrument").digest().subarray(0, 8));
  assert.equal(initialized.instruction.data.length, 125);

  const activated = await buildInstrumentActivation({ programId: PROGRAM, instrumentId: ID,
    issuerAuthority: ADMIN, bondMint: BOND, holderTokenAccounts: [BOND, SETTLEMENT, ADMIN] });
  assert.equal(activated.instrumentAddress, initialized.instrumentAddress);
  assert.equal(activated.instruction.accounts.length, 8);
  assert.deepEqual(Buffer.from(activated.instruction.data),
    createHash("sha256").update("global:activate_instrument").digest().subarray(0, 8));
});

test("decodes and rejects invalid instrument accounts", () => {
  const data = Buffer.alloc(225);
  createHash("sha256").update("account:Instrument").digest().copy(data, 0, 0, 8);
  let offset = 8; data[offset++] = 1; Buffer.from(ID).copy(data, offset); offset += 16;
  for (const key of [ADMIN, ADMIN, ADMIN, BOND, SETTLEMENT]) {
    Buffer.from(decodePublicKey(key)).copy(data, offset); offset += 32;
  }
  data.writeBigUInt64LE(1_000_000n, offset); offset += 8;
  data.writeUInt32LE(1000, offset); offset += 4; data[offset++] = 2;
  data.writeBigInt64LE(1_700_000_000n, offset); offset += 8;
  data.writeBigInt64LE(1_800_000_000n, offset); offset += 8;
  data.writeBigUInt64LE(35n, offset); offset += 8; data[offset] = 1;
  const decoded = decodeConfirmedInstrumentAccount(data.toString("base64"));
  assert.equal(decoded.status, "ACTIVE");
  assert.equal(decoded.bondMint, BOND);
  assert.equal(decoded.totalSupply, 35n);
  assert.throws(() => decodeConfirmedInstrumentAccount(Buffer.alloc(225).toString("base64")));
});

test("rejects invalid lifecycle inputs", async () => {
  await assert.rejects(buildInstrumentActivation({ programId: PROGRAM, instrumentId: ID,
    issuerAuthority: ADMIN, bondMint: BOND, holderTokenAccounts: [BOND, BOND] }));
  await assert.rejects(buildInstrumentInitialization({ programId: PROGRAM, instrumentId: ID,
    administrator: ADMIN, bondMint: BOND, settlementMint: BOND, complianceAuthority: ADMIN,
    corporateActionAuthority: ADMIN, faceValueMinor: 1n, couponRateBps: 0, paymentsPerYear: 1,
    issueAt: 2n, maturityAt: 1n, totalSupply: 35n }));
});

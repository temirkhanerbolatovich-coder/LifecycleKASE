import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCorporateActionSchedule, buildCorporateActionCancellation, decodeConfirmedCorporateAction,
  deriveCorporateActionAddresses, ACTION_TYPES } from "./corporate-action.js";
import { decodePublicKey } from "./base58.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "11111111111111111111111111111111";
const id = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const actionId = Uint8Array.from({ length: 16 }, (_, i) => i + 17);
const input = { programId: PROGRAM, instrumentId: id, actionId, issuerAuthority: KEY,
  recordAt: 1_790_000_000n, executeAt: 1_790_000_060n };

test("action builders encode all three Anchor term variants and cancellation account privileges", async () => {
  const addresses = await deriveCorporateActionAddresses(PROGRAM, id, actionId);
  for (const [index, type] of ACTION_TYPES.entries()) {
    const plan = await buildCorporateActionSchedule({ ...input, type,
      redemptionPercentageBps: type === "EARLY_REDEMPTION" ? 2000 : null,
      redemptionPriceMinor: type === "EARLY_REDEMPTION" ? 1_000_000_000n : null });
    assert.equal(plan.actionAddress, addresses.actionAddress);
    const bytes = Buffer.from(plan.instruction.data);
    assert.deepEqual(bytes.subarray(0, 8), createHash("sha256").update("global:create_corporate_action").digest().subarray(0, 8));
    assert.equal(bytes[24], index); assert.equal(bytes.readBigInt64LE(25), input.recordAt);
    assert.equal(bytes.readBigInt64LE(33), input.executeAt);
    assert.equal(bytes.length, type === "EARLY_REDEMPTION" ? 53 : 43);
  }
  const cancel = await buildCorporateActionCancellation(input);
  assert.equal(cancel.actionAddress, addresses.actionAddress);
  assert.deepEqual(cancel.instruction.accounts.map(account => [account.isSigner, account.isWritable]), [[true, false], [false, false], [false, true]]);
  assert.deepEqual(Buffer.from(cancel.instruction.data), createHash("sha256").update("global:cancel_action").digest().subarray(0, 8));
});

test("action builder rejects malformed dates, IDs, type and redemption terms before signing", async () => {
  const coupon = { ...input, type: "COUPON_PAYMENT" as const, redemptionPercentageBps: null, redemptionPriceMinor: null };
  for (const override of [{ recordAt: input.executeAt + 1n }, { actionId: new Uint8Array(16) }, { type: "OTHER" },
    { redemptionPercentageBps: 20 }, { type: "EARLY_REDEMPTION", redemptionPercentageBps: 0, redemptionPriceMinor: 1n },
    { type: "EARLY_REDEMPTION", redemptionPercentageBps: 2000, redemptionPriceMinor: (1n << 64n) }]) {
    await assert.rejects(buildCorporateActionSchedule({ ...coupon, ...override } as never));
  }
});

test("action decoder reads optional financial terms and completion, rejects malformed/truncated accounts", async () => {
  const { instrumentAddress } = await deriveCorporateActionAddresses(PROGRAM, id, actionId);
  const data = Buffer.alloc(200);
  createHash("sha256").update("account:CorporateAction").digest().copy(data, 0, 0, 8);
  let offset = 8; data[offset++] = 1; Buffer.from(actionId).copy(data, offset); offset += 16;
  Buffer.from(decodePublicKey(instrumentAddress)).copy(data, offset); offset += 32; data[offset++] = 2;
  data.writeBigInt64LE(input.recordAt, offset); offset += 8; data.writeBigInt64LE(input.executeAt, offset); offset += 8;
  data[offset++] = 1; data.writeUInt16LE(2000, offset); offset += 2;
  data[offset++] = 1; data.writeBigUInt64LE(1_000_000_000n, offset); offset += 8;
  offset += 32 + 8 + 4 + 4 + 8 + 8 + 4 + 4;
  const statusOffset = offset;
  data[offset++] = 1; data.writeBigInt64LE(input.recordAt - 10n, offset); offset += 8;
  data[offset++] = 1; data.writeBigInt64LE(input.recordAt + 1n, offset); offset += 8; data[offset++] = 254;
  const chain = decodeConfirmedCorporateAction(data.toString("base64"));
  assert.equal(chain.type, "EARLY_REDEMPTION"); assert.equal(chain.status, "CANCELLED");
  assert.equal(chain.redemptionPercentageBps, 2000); assert.equal(chain.redemptionPriceMinor, 1_000_000_000n);
  assert.equal(chain.completedAt, input.recordAt + 1n); assert.equal(chain.instrumentAddress, instrumentAddress);
  for (const [index, status] of ["SCHEDULED", "CANCELLED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW"].entries()) {
    const transitioned = Buffer.from(data); transitioned[statusOffset] = index;
    assert.equal(decodeConfirmedCorporateAction(transitioned.toString("base64")).status, status);
  }
  assert.throws(() => decodeConfirmedCorporateAction(data.subarray(0, offset - 1).toString("base64")));
  const changed = Buffer.from(data); changed[8] = 2;
  assert.throws(() => decodeConfirmedCorporateAction(changed.toString("base64")));
});

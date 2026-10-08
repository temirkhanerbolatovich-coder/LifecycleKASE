import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { buildCouponFunding, decodeFundingMint, decodeFundingTreasury, fundingMessageBase64, fundingTreasuryIndex } from "./coupon-funding.js";
import { encodePublicKey, decodePublicKey } from "./base58.js";
import { serializeUnsignedInstructionsTransaction } from "./snapshot-transaction.js";

const issuer = encodePublicKey(randomBytes(32)); const mint = encodePublicKey(randomBytes(32));
test("coupon funding builds the issuer ATA and MintToChecked with exactly six decimals and positive integer units", async () => {
  const plan = await buildCouponFunding({ issuer, settlementMint: mint, amountMinor: 1_750_000_000n });
  assert.equal(plan.instructions.length, 2); assert.equal(plan.instructions[0]!.data[0], 1);
  const instruction = plan.instructions[1]!; const data = Buffer.from(instruction.data);
  assert.equal(data[0], 14); assert.equal(data.readBigUInt64LE(1), 1_750_000_000n); assert.equal(data[9], 6);
  assert.equal(instruction.accounts[1]!.address, plan.treasury); assert.equal(instruction.accounts[2]!.address, issuer);
  const wire = serializeUnsignedInstructionsTransaction({ instructions: plan.instructions, feePayer: issuer,
    recentBlockhash: mint, lastValidBlockHeight: 10 });
  assert.ok(fundingTreasuryIndex(wire, plan.treasury) > 0); assert.ok(fundingMessageBase64(wire).length > 100);
  assert.throws(() => fundingTreasuryIndex(wire, encodePublicKey(randomBytes(32))));
  for (const amountMinor of [0n, -1n, 1n << 63n]) await assert.rejects(buildCouponFunding({ issuer, settlementMint: mint, amountMinor }));
});
test("funding mint rejects changed precision, authority, freeze or extension layout", () => {
  const data = Buffer.alloc(82); data.writeUInt32LE(1, 0); data.set(decodePublicKey(issuer), 4);
  data.writeBigUInt64LE(123n, 36); data[44] = 6; data[45] = 1;
  assert.equal(decodeFundingMint(data, issuer), 123n);
  for (const offset of [0, 4, 44, 45, 46]) { const changed = Buffer.from(data); changed[offset] = changed[offset]! ^ 1; assert.throws(() => decodeFundingMint(changed, issuer)); }
  assert.throws(() => decodeFundingMint(Buffer.concat([data, Buffer.from([0])]), issuer));
});
test("treasury rejects frozen, delegated, foreign, native, close-authority and unknown-extension accounts", () => {
  const data = Buffer.alloc(170); data.set(decodePublicKey(mint)); data.set(decodePublicKey(issuer), 32);
  data.writeBigUInt64LE(1_750_000_000n, 64); data[108] = 1; data[165] = 2; data.writeUInt16LE(7, 166);
  assert.equal(decodeFundingTreasury(data, mint, issuer), 1_750_000_000n);
  for (const offset of [0, 32, 72, 108, 109, 121, 129, 165, 166, 168]) {
    const changed = Buffer.from(data); changed[offset] = changed[offset]! ^ 1; assert.throws(() => decodeFundingTreasury(changed, mint, issuer));
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { decodePublicKey, encodePublicKey } from "./base58.js";

test("round-trips Solana public keys including leading zero bytes", () => {
  const keys = [
    "11111111111111111111111111111111",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "So11111111111111111111111111111111111111112"
  ];
  for (const key of keys) {
    assert.equal(encodePublicKey(decodePublicKey(key)), key);
  }
});

test("rejects invalid public keys", () => {
  assert.throws(() => decodePublicKey("0".repeat(32)), /base58/);
  assert.throws(() => decodePublicKey("111"), /base58/);
  assert.throws(() => encodePublicKey(new Uint8Array(31)), /32 bytes/);
});

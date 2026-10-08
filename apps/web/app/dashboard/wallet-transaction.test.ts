import assert from "node:assert/strict";
import test from "node:test";
import { SolanaSignTransaction } from "@solana/wallet-standard-features";
import { signAndSubmitPrepared } from "./wallet-transaction.js";

const KEY = "11111111111111111111111111111111";
const wire = new Uint8Array(200); wire[0] = 1; wire[65] = 128; wire[66] = 1; wire[69] = 2;
const plan = { operationId: "operation", cluster: "localnet" as const, requiredSigner: KEY, serializedTransactionBase64: Buffer.from(wire).toString("base64") };
function walletFixture(changed = false) {
  const signed = Uint8Array.from(wire); signed.fill(7, 1, 65); if (changed) signed[199] = 1;
  return { chains: ["solana:localnet"], features: {
    "standard:connect": { connect: async () => ({ accounts: [{ address: KEY, chains: ["solana:localnet"], features: [SolanaSignTransaction] }] }) },
    [SolanaSignTransaction]: { supportedTransactionVersions: [0], signTransaction: async () => [{ signedTransaction: signed }] }
  } };
}
test("Localnet saves the wallet signature before a failed API request and never retries a submission", async () => {
  let signature = ""; let requests = 0; let signing = 0;
  await assert.rejects(signAndSubmitPrepared({ wallet: walletFixture() as never, walletAddress: KEY, plan,
    request: async () => { requests += 1; assert.ok(signature.length >= 64); throw new Error("SESSION_REQUIRED"); }, submitPath: "/submit",
    onSigning: () => { signing += 1; }, onSignature: value => { signature = value; } }), /SESSION_REQUIRED/);
  assert.equal(requests, 1); assert.equal(signing, 1); assert.ok(signature.length >= 64);
});
test("Localnet never broadcasts wallet-mutated messages or a mismatched session wallet", async () => {
  let requests = 0; let signatures = 0;
  for (const [wallet, walletAddress] of [[walletFixture(true), KEY], [walletFixture(), "other"]] as const) {
    await assert.rejects(signAndSubmitPrepared({ wallet: wallet as never, walletAddress, plan,
      request: async () => { requests += 1; return {}; }, submitPath: "/submit", onSigning() {}, onSignature() { signatures += 1; } }));
  }
  assert.equal(requests, 0); assert.equal(signatures, 0);
});

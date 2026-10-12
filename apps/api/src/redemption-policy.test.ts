import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { decodePublicKey, deriveCorporateActionAddresses, deriveExactRedemptionTargetAddress,
  type SolanaRpc } from "@lifecycle-kase/solana-client";
import { exactTargetRedemptionEnabled, onchainActionVersion, redemptionAllocationPolicy,
  verifyExactRedemptionTarget, type RedemptionPolicyAction } from "./redemption-policy.js";
import { TransactionWorkflowError } from "./transaction-workflow.js";

const PROGRAM = "6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo";
const KEY = "11111111111111111111111111111111";
const INSTRUMENT_ID = new Uint8Array(16).fill(1);
const ACTION_ID = new Uint8Array(16).fill(2);
const LEGACY: RedemptionPolicyAction = { type: "EARLY_REDEMPTION", redemptionPercentageBps: 2000,
  redemptionPriceMinor: 1_000_000_000n };
const EXACT: RedemptionPolicyAction = { ...LEGACY, redemptionAllocationPolicy: "exact-target-largest-remainder-v2",
  redemptionPercentageBps: null, redemptionTargetTokens: 7n };
const enabledEnvironment = { EXACT_TARGET_REDEMPTION_ENABLED: "true", REDEMPTION_EXECUTION_ENABLED: "true",
  ACTION_APPROVAL_RESERVE_ENABLED: "true", ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED: "true" };

const hasCode = (code: string) => (error: unknown) => error instanceof TransactionWorkflowError && error.code === code;

async function targetFixture(options: {
  owner?: string; executable?: boolean; slot?: number; encoding?: string; missing?: boolean;
} = {}) {
  const { actionAddress } = await deriveCorporateActionAddresses(PROGRAM, INSTRUMENT_ID, ACTION_ID);
  const targetAddress = await deriveExactRedemptionTargetAddress(PROGRAM, actionAddress);
  const bytes = Buffer.alloc(50);
  createHash("sha256").update("account:ExactRedemptionTarget").digest().copy(bytes, 0, 0, 8);
  bytes[8] = 2; Buffer.from(decodePublicKey(actionAddress)).copy(bytes, 9);
  bytes.writeBigUInt64LE(7n, 41); bytes[49] = 253;
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const rpc: SolanaRpc = { request: async (method, params) => {
    requests.push({ method, params });
    assert.equal(method, "getAccountInfo"); assert.equal(params[0], targetAddress);
    assert.deepEqual(params[1], { commitment: "finalized", encoding: "base64", minContextSlot: 101 });
    return { context: { slot: options.slot ?? 101 }, value: options.missing ? null : {
      owner: options.owner ?? PROGRAM, executable: options.executable ?? false,
      data: [bytes.toString("base64"), options.encoding ?? "base64"] } };
  } };
  return { actionAddress, targetAddress, bytes, rpc, requests };
}

test("allocation metadata selects matching on-chain versions and preserves historical legacy actions", () => {
  assert.equal(redemptionAllocationPolicy(LEGACY), "integer-entitlements-v1");
  assert.equal(onchainActionVersion(LEGACY), 1);
  assert.equal(onchainActionVersion({ ...LEGACY, redemptionAllocationPolicy: "integer-entitlements-v1", redemptionTargetTokens: null }), 1);
  assert.equal(redemptionAllocationPolicy(EXACT), "exact-target-largest-remainder-v2");
  assert.equal(onchainActionVersion(EXACT), 2);
  assert.equal(onchainActionVersion({ ...LEGACY, type: "COUPON_PAYMENT", redemptionPercentageBps: null, redemptionPriceMinor: null }), 1);
});

test("invalid or ambiguous allocation metadata cannot select a program version", () => {
  const invalid: RedemptionPolicyAction[] = [
    { ...EXACT, type: "COUPON_PAYMENT" }, { ...EXACT, type: "BOND_REDEMPTION" },
    { ...EXACT, redemptionAllocationPolicy: "UNKNOWN" }, { ...EXACT, redemptionAllocationPolicy: "integer-entitlements-v1" },
    { ...EXACT, redemptionPercentageBps: 2000 }, { ...EXACT, redemptionTargetTokens: null },
    { ...EXACT, redemptionTargetTokens: 0n }, { ...EXACT, redemptionTargetTokens: -1n },
    { ...EXACT, redemptionTargetTokens: 1n << 64n }, { ...EXACT, redemptionPriceMinor: 0n },
    { ...EXACT, redemptionPriceMinor: null }, { ...EXACT, redemptionPriceMinor: 1n << 64n }
  ];
  for (const action of invalid) assert.throws(() => onchainActionVersion(action), hasCode("INVALID_REDEMPTION_POLICY"));
  assert.throws(() => onchainActionVersion({ ...LEGACY, redemptionTargetTokens: 7n }), hasCode("INVALID_REDEMPTION_POLICY"));
});

test("exact target is disabled by default and requires every existing financial capability explicitly", () => {
  assert.equal(exactTargetRedemptionEnabled({}), false);
  assert.equal(exactTargetRedemptionEnabled({ EXACT_TARGET_REDEMPTION_ENABLED: "false" }), false);
  assert.equal(exactTargetRedemptionEnabled(enabledEnvironment), true);
  for (const flag of ["REDEMPTION_EXECUTION_ENABLED", "ACTION_APPROVAL_RESERVE_ENABLED", "ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED"]) {
    for (const value of [undefined, "false", "TRUE", "1"]) {
      const environment: NodeJS.ProcessEnv = { ...enabledEnvironment };
      if (value === undefined) delete environment[flag]; else environment[flag] = value;
      assert.throws(() => exactTargetRedemptionEnabled(environment), hasCode("EXACT_TARGET_CONFIGURATION_INVALID"));
    }
  }
  for (const value of ["TRUE", "1", "yes", ""]) {
    assert.throws(() => exactTargetRedemptionEnabled({ ...enabledEnvironment, EXACT_TARGET_REDEMPTION_ENABLED: value }),
      hasCode("EXACT_TARGET_CONFIGURATION_INVALID"));
  }
});

test("only the finalized bound target PDA verifies exact-target immutable terms", async () => {
  const fixture = await targetFixture();
  assert.equal(await verifyExactRedemptionTarget(fixture.rpc, EXACT, fixture.actionAddress, PROGRAM, 101), fixture.targetAddress);
  assert.equal(fixture.requests.length, 1);
});

test("legacy verification does not require an absent target account or issue RPC calls", async () => {
  const fixture = await targetFixture();
  assert.equal(await verifyExactRedemptionTarget(fixture.rpc, LEGACY, fixture.actionAddress, PROGRAM, 101), null);
  assert.equal(fixture.requests.length, 0);
});

test("foreign owner, stale context, executable, absent and malformed target metadata fail closed", async () => {
  for (const options of [{ owner: KEY }, { slot: 100 }, { executable: true }, { missing: true }, { encoding: "json" }]) {
    const fixture = await targetFixture(options);
    await assert.rejects(verifyExactRedemptionTarget(fixture.rpc, EXACT, fixture.actionAddress, PROGRAM, 101),
      hasCode("REDEMPTION_TARGET_MISMATCH"));
  }
});

test("target version, discriminator, action binding and quantity must match exactly", async () => {
  for (const changed of ["version1", "version3", "discriminator", "action", "target", "zero"] as const) {
    const fixture = await targetFixture();
    if (changed === "version1") fixture.bytes[8] = 1;
    if (changed === "version3") fixture.bytes[8] = 3;
    if (changed === "discriminator") fixture.bytes[0]! ^= 1;
    if (changed === "action") Buffer.from(decodePublicKey(KEY)).copy(fixture.bytes, 9);
    if (changed === "target") fixture.bytes.writeBigUInt64LE(8n, 41);
    if (changed === "zero") fixture.bytes.writeBigUInt64LE(0n, 41);
    await assert.rejects(verifyExactRedemptionTarget(fixture.rpc, EXACT, fixture.actionAddress, PROGRAM, 101),
      hasCode("REDEMPTION_TARGET_MISMATCH"));
  }
});

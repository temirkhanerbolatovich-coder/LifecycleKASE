import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkDevnetReadiness } from "../scripts/check-devnet-readiness.mjs";

const plan = JSON.parse(await readFile(new URL("../docs/deployment/devnet-plan.json", import.meta.url), "utf8"));
function fixture(overrides = {}) {
  const calls = [];
  const responses = {
    getGenesisHash: plan.expectedGenesisHash,
    getBalance: { context: { slot: 100 }, value: 0 },
    getAccountInfo: { context: { slot: 101 }, value: null },
    ...overrides
  };
  return { calls, request: async (method, params) => {
    calls.push({ method, params });
    assert.ok(Object.hasOwn(responses, method), "Only the three read-only RPC methods are allowed");
    return responses[method];
  } };
}
test("reports missing funding without implying deployment authorization", async () => {
  const rpc = fixture();
  const report = await checkDevnetReadiness(plan, rpc);
  assert.equal(report.fundingRequired, true);
  assert.equal(report.transactionSubmitted, false);
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.upgradeAuthority, plan.upgradeAuthority);
  assert.deepEqual(rpc.calls[1].params, [plan.feePayer, { commitment: "finalized" }]);
  assert.equal(rpc.calls[2].params[1].commitment, "finalized");
});
test("rejects another network before reading accounts", async () => {
  const rpc = fixture({ getGenesisHash: "another-network" });
  await assert.rejects(checkDevnetReadiness(plan, rpc), /not the expected Devnet/);
  assert.equal(rpc.calls.length, 1);
});
test("rejects invalid or conflated identities before RPC", async () => {
  for (const invalid of [{ ...plan, programId: "invalid" },
    { ...plan, feePayer: plan.upgradeAuthority }, { ...plan, expectedGenesisHash: "other" }]) {
    const rpc = fixture();
    await assert.rejects(checkDevnetReadiness(invalid, rpc));
    assert.equal(rpc.calls.length, 0);
  }
});
test("rejects malformed balance, missing context and occupied program addresses", async () => {
  for (const overrides of [
    { getBalance: { context: { slot: 1 }, value: -1 } },
    { getBalance: { value: 10 } },
    { getAccountInfo: { context: { slot: 1 } } },
    { getAccountInfo: { context: { slot: 1 }, value: {} } }
  ]) await assert.rejects(checkDevnetReadiness(plan, fixture(overrides)));
});
test("a nonzero balance still does not authorize a deployment", async () => {
  const report = await checkDevnetReadiness(plan, fixture({ getBalance: { context: { slot: 3 }, value: 1 } }));
  assert.equal(report.fundingRequired, false);
  assert.equal(report.deploymentAuthorized, false);
});

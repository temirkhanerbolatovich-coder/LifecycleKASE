import assert from "node:assert/strict";
import test from "node:test";
import { couponExecutionEnabled, prepareCouponExecution } from "./coupon-execution.js";
import type { PrismaClient } from "@prisma/client";
const options = { enabled: false, cluster: "localnet" as const, expectedGenesisHash: "", programId: "", rpcEndpoint: "http://127.0.0.1:1", rpcTimeoutMs: 1000 };
test("coupon execution stays off by default and requires the separately reviewed approval capability", () => {
  assert.equal(couponExecutionEnabled({}), false);
  for (const value of ["1", "TRUE", "true"]) assert.throws(() => couponExecutionEnabled({ COUPON_EXECUTION_ENABLED: value }));
  assert.equal(couponExecutionEnabled({ COUPON_EXECUTION_ENABLED: "true", ACTION_APPROVAL_RESERVE_ENABLED: "true" }), true);
});
test("disabled execution rejects before database or network access", async () => {
  const database = new Proxy({}, { get: () => { throw new Error("Database must not be accessed"); } }) as PrismaClient;
  const rpc = { request: async () => { throw new Error("RPC must not be accessed"); } };
  await assert.rejects(prepareCouponExecution(database, rpc, "", {}, { id: "", walletAddress: "", correlationId: "" }, options), { code: "COUPON_EXECUTION_DISABLED" });
});

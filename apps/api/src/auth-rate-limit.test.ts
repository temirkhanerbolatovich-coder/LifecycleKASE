import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthRateLimitError,
  FixedWindowRateLimiter,
  authRateLimitOptionsFromEnvironment,
  authenticationClientKey,
  trustedProxyHopsFromEnvironment
} from "./auth-rate-limit.js";

test("limits each client independently and reports the retry window", () => {
  const limiter = new FixedWindowRateLimiter(2, 60_000, 10);
  limiter.consume("client-a", 1_000);
  limiter.consume("client-a", 2_000);
  limiter.consume("client-b", 2_000);
  assert.throws(
    () => limiter.consume("client-a", 3_000),
    (error: unknown) => error instanceof AuthRateLimitError && error.retryAfterSeconds === 58
  );
  assert.doesNotThrow(() => limiter.consume("client-a", 61_000));
});

test("bounds tracked clients and validates configuration", () => {
  const limiter = new FixedWindowRateLimiter(1, 60_000, 2);
  limiter.consume("client-a", 0);
  limiter.consume("client-b", 1);
  assert.doesNotThrow(() => limiter.consume("client-c", 2));
  assert.doesNotThrow(() => limiter.consume("client-a", 3));

  assert.deepEqual(authRateLimitOptionsFromEnvironment({}), {
    challengeAttempts: 5,
    verifyAttempts: 10,
    mutationAttempts: 20,
    windowSeconds: 60,
    maxTrackedClients: 10_000
  });
  assert.throws(
    () => authRateLimitOptionsFromEnvironment({ AUTH_CHALLENGE_RATE_LIMIT: "0" }),
    /AUTH_CHALLENGE_RATE_LIMIT must be a positive integer/
  );
  assert.equal(trustedProxyHopsFromEnvironment({}), 0);
  assert.equal(trustedProxyHopsFromEnvironment({ TRUST_PROXY_HOPS: "1" }), 1);
  assert.throws(
    () => trustedProxyHopsFromEnvironment({ TRUST_PROXY_HOPS: "6" }),
    /TRUST_PROXY_HOPS must be an integer between 0 and 5/
  );
});

test("uses the trusted request address without retaining unbounded input", () => {
  assert.equal(authenticationClientKey({ ip: " 203.0.113.7 " }), "203.0.113.7");
  assert.equal(authenticationClientKey({ socket: { remoteAddress: "::1" } }), "::1");
  assert.equal(authenticationClientKey({}), "unknown");
  assert.equal(authenticationClientKey({ ip: "x".repeat(200) }).length, 128);
});

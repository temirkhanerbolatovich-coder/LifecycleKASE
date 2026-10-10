import assert from "node:assert/strict";
import test from "node:test";

import { apiRequest, createOperatorRequest, OperatorApiError } from "./operator-api.js";

test("expired or missing sessions trigger recovery without replaying a signed submission", async () => {
  for (const code of ["SESSION_REQUIRED", "SESSION_INVALID"]) {
    let requests = 0;
    let recoveries = 0;
    const fetchRequest: typeof fetch = async (_url, options) => {
      requests += 1;
      assert.equal(options?.method, "POST");
      assert.equal(options?.credentials, "include");
      assert.equal(options?.body, '{"signedTransactionBase64":"signed-wire"}');
      return Response.json({ code, message: "Internal English error" }, { status: 401 });
    };
    const request = createOperatorRequest(() => { recoveries += 1; }, fetchRequest);
    await assert.rejects(request("/api/v1/instruments/test/deploy/submit", {
      method: "POST", body: '{"signedTransactionBase64":"signed-wire"}'
    }), (error: unknown) => error instanceof OperatorApiError && error.code === code &&
      error.status === 401 && /Войдите снова тем же кошельком/.test(error.message));
    assert.equal(requests, 1);
    assert.equal(recoveries, 1);
  }
});

test("other errors never trigger authentication recovery or automatic request retries", async () => {
  for (const [status, code] of [[403, "ROLE_FORBIDDEN"], [409, "TRANSACTION_NOT_FINALIZED"],
    [503, "RPC_TRANSPORT_FAILED"], [401, "OTHER_ERROR"]] as const) {
    let requests = 0;
    const request = createOperatorRequest(() => { assert.fail("unexpected session recovery"); }, async () => {
      requests += 1; return Response.json({ code }, { status });
    });
    await assert.rejects(request("/api/v1/instruments/test/deploy/confirm"),
      (error: unknown) => error instanceof OperatorApiError && error.code === code && error.status === status);
    assert.equal(requests, 1);
  }
});

test("successful requests preserve the response and caller cancellation without session recovery", async () => {
  const controller = new AbortController();
  const payload = { operationId: "operation", signature: "signature", status: "FINALIZED" };
  const fetchRequest: typeof fetch = async (_url, options) => {
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.cache, "no-store");
    return Response.json(payload);
  };
  const request = createOperatorRequest(() => { assert.fail("unexpected session recovery"); }, fetchRequest);
  assert.deepEqual(await request("/api/v1/instruments/test/deploy/confirm", { signal: controller.signal }), payload);
  assert.deepEqual(await apiRequest("/api/v1/auth/session", { signal: controller.signal }, fetchRequest), payload);
});

test("connection loss reports a recoverable state without replaying a signed POST", async () => {
  let calls = 0;
  const changes: boolean[] = [];
  const request = createOperatorRequest(() => assert.fail("no auth recovery"), async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network unavailable");
    return Response.json({ status: "UNKNOWN_CONFIRMATION", signature: "original" });
  }, lost => changes.push(lost));
  await assert.rejects(request("/api/v1/corporate-actions/test/submit", { method: "POST", body: "signed" }),
    (error: unknown) => error instanceof OperatorApiError && error.code === "CONNECTION_UNAVAILABLE");
  assert.equal(calls, 1);
  assert.deepEqual(changes, [true]);
  await request("/api/v1/corporate-actions/test");
  assert.deepEqual(changes, [true, false]);
  assert.equal(calls, 2);
});

test("caller cancellation is preserved and does not report connection loss", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = new DOMException("cancelled", "AbortError");
  const request = createOperatorRequest(() => assert.fail(), async () => { throw cancelled; }, () => assert.fail("intentional abort"));
  await assert.rejects(request("/api/v1/investors", { signal: controller.signal }), error => error === cancelled);
});

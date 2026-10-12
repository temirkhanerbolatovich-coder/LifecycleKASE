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
    assert.notEqual(options?.signal, controller.signal);
    assert.equal(options?.signal?.aborted, false);
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

test("caller cancellation and the 15-second API timeout both remain active on registry reads", async context => {
  const timeout = new AbortController(); const caller = new AbortController();
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 15_000); return timeout.signal;
  });
  let calls = 0; const connectionChanges: boolean[] = [];
  const request = createOperatorRequest(() => assert.fail("unexpected auth recovery"), async (_url, options) => {
    calls++; const signal = options?.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      timeout.abort(new DOMException("deadline reached", "TimeoutError"));
    });
  }, lost => connectionChanges.push(lost));
  await assert.rejects(request("/api/v1/investors", { signal: caller.signal }),
    (error: unknown) => error instanceof OperatorApiError && error.code === "CONNECTION_UNAVAILABLE");
  assert.equal(caller.signal.aborted, false); assert.equal(calls, 1); assert.deepEqual(connectionChanges, [true]);
});

test("an active caller signal cancels the combined transport without connection loss or retry", async () => {
  const caller = new AbortController(); let calls = 0;
  const cancelled = new DOMException("caller cancelled", "AbortError");
  const request = createOperatorRequest(() => assert.fail("unexpected auth recovery"), async (_url, options) => {
    calls++; const signal = options?.signal!;
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }); caller.abort(cancelled);
    });
  }, () => assert.fail("intentional cancellation is not a transport outage"));
  await assert.rejects(request("/api/v1/investors", { signal: caller.signal }), error => error === cancelled);
  assert.equal(calls, 1);
});

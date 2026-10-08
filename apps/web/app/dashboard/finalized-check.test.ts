import assert from "node:assert/strict";
import test from "node:test";
import { OperatorApiError } from "./operator-api";
import { waitForFinalizedCheck } from "./finalized-check";

const operationId = "00000000-0000-4000-8000-000000000001";
const signature = "2".repeat(88);
const response = { operationId, signature, status: "FINALIZED" };
test("finalized lag retries the identical confirmation until exact finalized evidence arrives", async () => {
  let calls = 0; let pauses = 0;
  assert.deepEqual(await waitForFinalizedCheck(async () => {
    if (++calls < 3) throw new OperatorApiError("TRANSACTION_NOT_FINALIZED", 409, "Pending"); return response;
  }, operationId, signature, () => {}, { attempts: 4, pause: async () => { pauses++; } }), response);
  assert.equal(calls, 3); assert.equal(pauses, 2);
});
test("confirmation is bounded and stops immediately for session, history, rate, transport or message errors", async () => {
  for (const code of ["SESSION_REQUIRED", "TRANSACTION_UNAVAILABLE", "AUTH_RATE_LIMITED", "TRANSACTION_MISMATCH"]) {
    let calls = 0;
    await assert.rejects(waitForFinalizedCheck(async () => { calls++; throw new OperatorApiError(code, 409, code); }, operationId, signature,
      () => {}, { attempts: 3, pause: async () => {} })); assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(waitForFinalizedCheck(async () => { calls++; throw new OperatorApiError("TRANSACTION_NOT_FINALIZED", 409, "Pending"); },
    operationId, signature, () => {}, { attempts: 3, pause: async () => {} })); assert.equal(calls, 3);
  await assert.rejects(waitForFinalizedCheck(async () => ({ ...response, signature: "3".repeat(88) }), operationId, signature, () => {}));
});

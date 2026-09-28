import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCorporateActionTransition,
  canTransitionCorporateAction
} from "./corporate-action-state.js";

test("allows the canonical happy-path state sequence", () => {
  const sequence = [
    "DRAFT",
    "SCHEDULED",
    "SNAPSHOT_CREATED",
    "CALCULATED",
    "READY_FOR_EXECUTION",
    "PROCESSING",
    "PARTIALLY_COMPLETED",
    "PROCESSING",
    "COMPLETED"
  ] as const;

  for (let index = 0; index < sequence.length - 1; index += 1) {
    assert.equal(canTransitionCorporateAction(sequence[index]!, sequence[index + 1]!), true);
  }
});

test("allows cancellation only before snapshot", () => {
  assert.equal(canTransitionCorporateAction("DRAFT", "CANCELLED"), true);
  assert.equal(canTransitionCorporateAction("SCHEDULED", "CANCELLED"), true);
  assert.equal(canTransitionCorporateAction("SNAPSHOT_CREATED", "CANCELLED"), false);
});

test("keeps terminal states terminal", () => {
  for (const terminalStatus of [
    "COMPLETED",
    "FAILED_FINAL",
    "SNAPSHOT_MISSED",
    "CANCELLED"
  ] as const) {
    assert.throws(
      () => assertCorporateActionTransition(terminalStatus, "PROCESSING"),
      /cannot transition/
    );
  }
});

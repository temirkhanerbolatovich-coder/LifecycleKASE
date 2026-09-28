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
    "UNDER_REVIEW",
    "APPROVED",
    "EXECUTING",
    "PARTIALLY_SETTLED",
    "EXECUTING",
    "SETTLED",
    "RECONCILING",
    "FINALIZED"
  ] as const;

  for (let index = 0; index < sequence.length - 1; index += 1) {
    assert.equal(canTransitionCorporateAction(sequence[index]!, sequence[index + 1]!), true);
  }
});

test("allows ordinary cancellation before snapshot", () => {
  assert.equal(canTransitionCorporateAction("DRAFT", "CANCELLED"), true);
  assert.equal(canTransitionCorporateAction("SCHEDULED", "CANCELLED"), true);
  assert.equal(canTransitionCorporateAction("SNAPSHOT_CREATED", "CANCELLED"), false);
});

test("review can return calculations for revision without changing the snapshot", () => {
  assert.equal(canTransitionCorporateAction("UNDER_REVIEW", "RETURNED_FOR_REVISION"), true);
  assert.equal(canTransitionCorporateAction("RETURNED_FOR_REVISION", "CALCULATED"), true);
  assert.equal(canTransitionCorporateAction("RETURNED_FOR_REVISION", "CANCELLED"), true);
  assert.equal(canTransitionCorporateAction("RETURNED_FOR_REVISION", "DRAFT"), false);
  assert.equal(canTransitionCorporateAction("CALCULATED", "EXECUTING"), false);
  assert.equal(canTransitionCorporateAction("REJECTED", "EXECUTING"), false);
});

test("keeps terminal states terminal", () => {
  for (const terminalStatus of [
    "FINALIZED",
    "REJECTED",
    "FAILED_FINAL",
    "SNAPSHOT_MISSED",
    "CANCELLED"
  ] as const) {
    assert.throws(
      () => assertCorporateActionTransition(terminalStatus, "EXECUTING"),
      /cannot transition/
    );
  }
});

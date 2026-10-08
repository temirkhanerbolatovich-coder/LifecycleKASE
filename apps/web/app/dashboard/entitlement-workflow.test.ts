import assert from "node:assert/strict";
import test from "node:test";
import { formatMinorKzt, reviewChoices } from "./entitlement-workflow";
test("money formatting preserves all minor units including values beyond Number precision", () => {
  assert.equal(formatMinorKzt("500000000"), "500.00 KZT-Test");
  assert.equal(formatMinorKzt("1"), "0.000001 KZT-Test");
  assert.equal(formatMinorKzt("9223372036854775807"), "9223372036854.775807 KZT-Test");
  for (const value of ["1e6", "0.1", "-1", "NaN"]) assert.throws(() => formatMinorKzt(value));
});
test("approval cannot skip review and terminal/approved actions offer no editing decisions", () => {
  assert.deepEqual(reviewChoices("CALCULATED"), ["SUBMIT"]);
  assert.deepEqual(reviewChoices("UNDER_REVIEW"), ["APPROVE", "RETURN", "REJECT"]);
  for (const status of ["SNAPSHOT_CREATED", "RETURNED_FOR_REVISION", "REJECTED", "APPROVED", "FINALIZED"]) assert.deepEqual(reviewChoices(status), []);
});

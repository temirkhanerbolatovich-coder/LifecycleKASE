import assert from "node:assert/strict";
import test from "node:test";
import { overviewPeriod } from "./operator-overview.js";

test("overview defaults to seven past and seven future days in UTC with an exclusive upper boundary", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");
  assert.deepEqual(overviewPeriod({}, now), { from: new Date("2026-10-05T10:00:00.000Z"), to: new Date("2026-10-19T10:00:00.000Z") });
  assert.deepEqual(overviewPeriod({ from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00.000Z" }), {
    from: new Date("2026-10-12T00:00:00Z"), to: new Date("2026-10-13T00:00:00Z") });
});
test("overview rejects ambiguous, normalized-invalid and unbounded date ranges", () => {
  for (const from of [null, 0, "2026-10-12", "2026-10-12T10:00:00+05:00", "2026-02-30T10:00:00Z", "invalid"]) {
    assert.throws(() => overviewPeriod({ from }), /UTC|invalid/);
  }
  for (const to of ["2026-10-12T00:00:00Z", "2026-10-11T00:00:00Z", "2028-10-12T00:00:00Z"]) {
    assert.throws(() => overviewPeriod({ from: "2026-10-12T00:00:00Z", to }), /positive and at most/);
  }
});

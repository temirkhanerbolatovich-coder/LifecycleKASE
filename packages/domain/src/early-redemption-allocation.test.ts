import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DomainValidationError } from "./errors.js";
import {
  allocateEarlyRedemption,
  calculateEarlyRedemptionTarget,
  type EarlyRedemptionAllocationInputRow
} from "./early-redemption-allocation.js";
import { MAX_U64 } from "./numeric.js";

const ADDRESSES = [
  "11111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
];

function createRows(balances: readonly bigint[]): EarlyRedemptionAllocationInputRow[] {
  return balances.map((balance, index) => ({
    investorId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    tieAddress: ADDRESSES[index]!,
    balance
  }));
}

test("allocates the exact 10/20/5 target of 7 and preserves canonical holder balances", () => {
  const result = allocateEarlyRedemption({ rows: createRows([10n, 20n, 5n]), targetTokens: 7n });
  assert.equal(result.policy, "exact-target-largest-remainder-v2");
  assert.equal(result.totalBalance, 35n);
  assert.equal(result.targetTokens, 7n);
  assert.equal(result.denominator, 35n);
  assert.deepEqual(result.rows.map(row => [row.redeemedTokens, row.remainingTokens, row.quotaRemainder]), [
    [2n, 8n, 0n],
    [4n, 16n, 0n],
    [1n, 4n, 0n]
  ]);
});

test("awards the token lost by per-holder flooring for 1/1/1 and target 1", () => {
  const result = allocateEarlyRedemption({ rows: createRows([1n, 1n, 1n]), targetTokens: 1n });
  assert.deepEqual(result.rows.map(row => row.redeemedTokens), [1n, 0n, 0n]);
  assert.deepEqual(result.rows.map(row => row.quotaRemainder), [1n, 1n, 1n]);
});

test("prioritizes larger remainders and uses ASCII address order for equal remainders", () => {
  const unequal = allocateEarlyRedemption({ rows: createRows([2n, 1n, 3n]), targetTokens: 2n });
  assert.deepEqual(unequal.rows.map(row => row.redeemedTokens), [1n, 0n, 1n]);
  const rows = createRows([1n, 1n]);
  rows[0]!.tieAddress = "a" + "1".repeat(42);
  rows[1]!.tieAddress = "Z" + "1".repeat(42);
  const tied = allocateEarlyRedemption({ rows, targetTokens: 1n });
  assert.deepEqual(tied.rows.map(row => [row.tieAddress, row.redeemedTokens]), [
    ["Z" + "1".repeat(42), 1n],
    ["a" + "1".repeat(42), 0n]
  ]);
});

test("is permutation invariant and does not mutate input, including frozen input", () => {
  const rows = createRows([5n, 3n, 7n]);
  const original = structuredClone(rows);
  const expected = allocateEarlyRedemption({ rows, targetTokens: 8n });
  const permutations = [
    [rows[0]!, rows[2]!, rows[1]!],
    [rows[1]!, rows[0]!, rows[2]!],
    [rows[1]!, rows[2]!, rows[0]!],
    [rows[2]!, rows[0]!, rows[1]!],
    [rows[2]!, rows[1]!, rows[0]!]
  ];
  for (const permutation of permutations) {
    assert.deepEqual(allocateEarlyRedemption({ rows: permutation, targetTokens: 8n }), expected);
  }
  assert.deepEqual(rows, original);
  Object.freeze(rows);
  rows.forEach(Object.freeze);
  assert.deepEqual(allocateEarlyRedemption({ rows, targetTokens: 8n }), expected);
});

test("supports zero targets, full targets, zero-balance rows and empty input", () => {
  const rows = createRows([0n, 2n, 1n]);
  const zero = allocateEarlyRedemption({ rows, targetTokens: 0n });
  assert.deepEqual(zero.rows.map(row => [row.redeemedTokens, row.remainingTokens, row.quotaRemainder]), [
    [0n, 0n, 0n], [0n, 2n, 0n], [0n, 1n, 0n]
  ]);
  const partial = allocateEarlyRedemption({ rows, targetTokens: 1n });
  assert.deepEqual(partial.rows.map(row => row.redeemedTokens), [0n, 1n, 0n]);
  const full = allocateEarlyRedemption({ rows, targetTokens: 3n });
  assert.deepEqual(full.rows.map(row => [row.redeemedTokens, row.remainingTokens]), [
    [0n, 0n], [2n, 0n], [1n, 0n]
  ]);
  assert.deepEqual(allocateEarlyRedemption({ rows: [], targetTokens: 0n }), {
    policy: "exact-target-largest-remainder-v2",
    rows: [], totalBalance: 0n, targetTokens: 0n, denominator: 0n
  });
  const emptyBalance = allocateEarlyRedemption({ rows: createRows([0n, 0n, 0n]), targetTokens: 0n });
  assert.equal(emptyBalance.denominator, 0n);
  assert.deepEqual(emptyBalance.rows.map(row => row.quotaRemainder), [0n, 0n, 0n]);
});

test("normalizes UUID case and rejects duplicate investor IDs or tie addresses", () => {
  const rows = createRows([1n]);
  rows[0]!.investorId = "ABCDEF01-ABCD-4000-8000-000000000001";
  assert.equal(allocateEarlyRedemption({ rows, targetTokens: 1n }).rows[0]!.investorId,
    "abcdef01-abcd-4000-8000-000000000001");
  assert.throws(() => allocateEarlyRedemption({
    rows: [rows[0]!, { ...rows[0]!, investorId: rows[0]!.investorId.toLowerCase(), tieAddress: ADDRESSES[1]! }],
    targetTokens: 0n
  }), error => error instanceof DomainValidationError && error.code === "DUPLICATE_INVESTOR");
  assert.throws(() => allocateEarlyRedemption({
    rows: createRows([1n, 1n]).map(row => ({ ...row, tieAddress: ADDRESSES[0]! })), targetTokens: 0n
  }), error => error instanceof DomainValidationError && error.code === "DUPLICATE_TIE_ADDRESS");
});

test("rejects noncanonical UUIDs and invalid base58 encodings or decoded lengths", () => {
  for (const investorId of ["", "holder-a", "00000000-0000-0000-0000-000000000001", " " + createRows([1n])[0]!.investorId]) {
    assert.throws(() => allocateEarlyRedemption({
      rows: [{ ...createRows([1n])[0]!, investorId }], targetTokens: 0n
    }), error => error instanceof DomainValidationError && error.code === "INVALID_UUID");
  }
  for (const tieAddress of ["", "0".repeat(32), "1".repeat(31), "1".repeat(33), "z".repeat(44), " " + ADDRESSES[1]]) {
    assert.throws(() => allocateEarlyRedemption({
      rows: [{ ...createRows([1n])[0]!, tieAddress }], targetTokens: 0n
    }), error => error instanceof DomainValidationError && error.code === "INVALID_PUBLIC_KEY");
  }
});

test("rejects negative/out-of-range/non-bigint balances and targets, totals over u64 and overdraw", () => {
  for (const balance of [-1n, MAX_U64 + 1n, 1 as unknown as bigint]) {
    assert.throws(() => allocateEarlyRedemption({ rows: createRows([balance]), targetTokens: 0n }), DomainValidationError);
  }
  for (const targetTokens of [-1n, MAX_U64 + 1n, 1 as unknown as bigint]) {
    assert.throws(() => allocateEarlyRedemption({ rows: createRows([1n]), targetTokens }), DomainValidationError);
  }
  assert.throws(() => allocateEarlyRedemption({ rows: createRows([MAX_U64, 1n]), targetTokens: 1n }), /u64 storage/);
  for (const rows of [createRows([1n, 1n]), createRows([0n]), []]) {
    assert.throws(() => allocateEarlyRedemption({ rows, targetTokens: 3n }),
      error => error instanceof DomainValidationError && error.code === "TARGET_EXCEEDS_BALANCE");
  }
  assert.throws(() => allocateEarlyRedemption({ rows: null as unknown as [], targetTokens: 0n }), DomainValidationError);
  assert.throws(() => allocateEarlyRedemption({ rows: [null] as unknown as [], targetTokens: 0n }), DomainValidationError);
  assert.throws(() => allocateEarlyRedemption(null as unknown as Parameters<typeof allocateEarlyRedemption>[0]), DomainValidationError);
});

test("keeps u64 boundaries and near-u128 quota products exact above Number precision", () => {
  const full = allocateEarlyRedemption({ rows: createRows([MAX_U64]), targetTokens: MAX_U64 });
  assert.equal(full.rows[0]!.redeemedTokens, MAX_U64);
  assert.equal(full.rows[0]!.quotaRemainder, 0n);
  const partial = allocateEarlyRedemption({
    rows: createRows([MAX_U64 - 1n, 1n]), targetTokens: MAX_U64 - 1n
  });
  assert.deepEqual(partial.rows.map(row => [row.redeemedTokens, row.remainingTokens, row.quotaRemainder]), [
    [MAX_U64 - 2n, 1n, 1n],
    [1n, 0n, MAX_U64 - 1n]
  ]);
  assert.equal(partial.rows.reduce((sum, row) => sum + row.redeemedTokens, 0n), MAX_U64 - 1n);
});

test("derives an explicit percentage target once from the aggregate with exact rounding evidence", () => {
  assert.deepEqual(calculateEarlyRedemptionTarget({ totalBalance: 3n, percentageBps: 5_000 }), {
    policy: "floor-total-percentage-v2", targetTokens: 1n,
    percentageBps: 5_000, denominator: 10_000n, remainder: 5_000n
  });
  assert.equal(calculateEarlyRedemptionTarget({ totalBalance: MAX_U64, percentageBps: 10_000 }).targetTokens, MAX_U64);
  assert.equal(calculateEarlyRedemptionTarget({ totalBalance: 35n, percentageBps: 2_000 }).targetTokens, 7n);
  assert.equal(calculateEarlyRedemptionTarget({ totalBalance: 35n, percentageBps: 0 }).targetTokens, 0n);
  assert.equal(calculateEarlyRedemptionTarget({ totalBalance: 0n, percentageBps: 10_000 }).targetTokens, 0n);
});

test("rejects invalid percentage targets and unsupported bps values", () => {
  for (const percentageBps of [-1, 10_001, 1.5, NaN, Infinity]) {
    assert.throws(() => calculateEarlyRedemptionTarget({ totalBalance: 1n, percentageBps }), DomainValidationError);
  }
  for (const totalBalance of [-1n, MAX_U64 + 1n, 1 as unknown as bigint]) {
    assert.throws(() => calculateEarlyRedemptionTarget({ totalBalance, percentageBps: 1 }), DomainValidationError);
  }
  assert.throws(() => calculateEarlyRedemptionTarget(null as unknown as Parameters<typeof calculateEarlyRedemptionTarget>[0]), DomainValidationError);
});

test("matches shared TypeScript/Rust exact-target allocation vectors", () => {
  const lines = readFileSync(new URL("../../../test/fixtures/early-redemption-allocation-parity.tsv", import.meta.url), "utf8")
    .trim().split(/\r?\n/).slice(1);
  const groups = new Map<string, {
    rows: EarlyRedemptionAllocationInputRow[];
    targetTokens: bigint;
    expected: string[][];
  }>();
  for (const line of lines) {
    const [name, investorId, tieAddress, balance, target, redeemed, remaining, remainder, denominator] = line.split("\t");
    let group = groups.get(name!);
    if (group === undefined) {
      group = { rows: [], targetTokens: BigInt(target!), expected: [] };
      groups.set(name!, group);
    }
    assert.equal(group.targetTokens, BigInt(target!), name);
    group.rows.push({ investorId: investorId!, tieAddress: tieAddress!, balance: BigInt(balance!) });
    group.expected.push([investorId!, tieAddress!, redeemed!, remaining!, remainder!, denominator!]);
  }
  for (const [name, group] of groups) {
    const result = allocateEarlyRedemption({ rows: [...group.rows].reverse(), targetTokens: group.targetTokens });
    assert.deepEqual(result.rows.map(row => [row.investorId, row.tieAddress,
      String(row.redeemedTokens), String(row.remainingTokens), String(row.quotaRemainder), String(result.denominator)]),
      group.expected, name);
  }
});

// Independent bounded oracle: enumerate every feasible allocation and minimize
// total squared distance from exact quotas, preferring earlier addresses on ties.
function exhaustiveClosestAllocation(balances: number[], target: number): number[] {
  const total = balances.reduce((sum, balance) => sum + balance, 0);
  let bestDistance = Infinity;
  let best: number[] = [];
  function visit(index: number, remaining: number, candidate: number[], distance: number): void {
    if (index === balances.length) {
      if (remaining === 0 && distance < bestDistance) {
        bestDistance = distance;
        best = [...candidate];
      }
      return;
    }
    // Descending visits make equal-distance results choose the earliest address.
    for (let amount = Math.min(balances[index]!, remaining); amount >= 0; amount -= 1) {
      const deviation = amount * total - balances[index]! * target;
      visit(index + 1, remaining - amount, [...candidate, amount], distance + deviation * deviation);
    }
  }
  visit(0, target, [], 0);
  return best;
}

test("matches an independent exhaustive allocation oracle for every small balance/target", () => {
  for (let first = 0; first <= 4; first += 1) {
    for (let second = 0; second <= 4; second += 1) {
      for (let third = 0; third <= 4; third += 1) {
        const balances = [first, second, third];
        const total = first + second + third;
        for (let target = 0; target <= total; target += 1) {
          const allocation = allocateEarlyRedemption({ rows: createRows(balances.map(BigInt)), targetTokens: BigInt(target) });
          assert.deepEqual(allocation.rows.map(row => Number(row.redeemedTokens)), exhaustiveClosestAllocation(balances, target),
            `balances=${balances}, target=${target}`);
          assert.equal(allocation.rows.reduce((sum, row) => sum + row.redeemedTokens, 0n), BigInt(target));
          for (const row of allocation.rows) {
            assert.equal(row.redeemedTokens + row.remainingTokens, row.balance);
            assert.ok(row.redeemedTokens >= 0n && row.redeemedTokens <= row.balance);
            if (total > 0) {
              const quota = row.balance * BigInt(target) / BigInt(total);
              assert.ok(row.redeemedTokens === quota || row.redeemedTokens === quota + 1n);
            }
          }
        }
      }
    }
  }
});

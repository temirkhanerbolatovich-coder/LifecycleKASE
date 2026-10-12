import { DomainValidationError } from "./errors.js";
import { assertResultU64, assertU64, multiplyU128 } from "./numeric.js";

export const EARLY_REDEMPTION_ALLOCATION_POLICY = "exact-target-largest-remainder-v2";
export const EARLY_REDEMPTION_TARGET_POLICY = "floor-total-percentage-v2";

const BASIS_POINTS_DENOMINATOR = 10_000n;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

export interface EarlyRedemptionAllocationInputRow {
  investorId: string;
  /** Immutable snapshot address used to break equal quota remainders. */
  tieAddress: string;
  balance: bigint;
}

export interface EarlyRedemptionAllocationRow extends EarlyRedemptionAllocationInputRow {
  redeemedTokens: bigint;
  remainingTokens: bigint;
  quotaRemainder: bigint;
}

export interface EarlyRedemptionAllocation {
  policy: typeof EARLY_REDEMPTION_ALLOCATION_POLICY;
  rows: EarlyRedemptionAllocationRow[];
  totalBalance: bigint;
  targetTokens: bigint;
  /** Zero for an empty/zero-balance allocation; its rows then have zero remainders. */
  denominator: bigint;
}

function assertAllocationU64(value: bigint, fieldName: string): void {
  if (typeof value !== "bigint") {
    throw new DomainValidationError("INVALID_INTEGER", `${fieldName} must be a bigint`);
  }
  assertU64(value, fieldName);
}

function normalizeInvestorId(value: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new DomainValidationError("INVALID_UUID", "investorId must be a canonical UUID");
  }
  return value.toLowerCase();
}

function assertTieAddress(value: string): void {
  const message = "tieAddress must be a base58-encoded 32-byte public key";
  if (typeof value !== "string" || value.length < 32 || value.length > 44 || !BASE58_PATTERN.test(value)) {
    throw new DomainValidationError("INVALID_PUBLIC_KEY", message);
  }
  let decoded = 0n;
  for (const character of value) {
    decoded = decoded * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  }
  let byteLength = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    byteLength += 1;
  }
  byteLength += value.length - value.replace(/^1+/, "").length;
  if (byteLength !== 32) {
    throw new DomainValidationError("INVALID_PUBLIC_KEY", message);
  }
}

function compareRows(
  left: EarlyRedemptionAllocationInputRow,
  right: EarlyRedemptionAllocationInputRow
): number {
  if (left.tieAddress !== right.tieAddress) {
    return left.tieAddress < right.tieAddress ? -1 : 1;
  }
  return left.investorId < right.investorId ? -1 : left.investorId > right.investorId ? 1 : 0;
}

/**
 * Derives the target once from the total snapshot balance using floor rounding.
 * The allocation function accepts that explicit integer target independently.
 */
export function calculateEarlyRedemptionTarget(input: {
  totalBalance: bigint;
  percentageBps: number;
}): {
  policy: typeof EARLY_REDEMPTION_TARGET_POLICY;
  targetTokens: bigint;
  percentageBps: number;
  denominator: bigint;
  remainder: bigint;
} {
  if (input === null || typeof input !== "object") {
    throw new DomainValidationError("INVALID_ALLOCATION_INPUT", "Target input must be an object");
  }
  assertAllocationU64(input.totalBalance, "totalBalance");
  if (!Number.isSafeInteger(input.percentageBps) || input.percentageBps < 0 || input.percentageBps > 10_000) {
    throw new DomainValidationError(
      "VALUE_OUT_OF_RANGE",
      "percentageBps must be an integer between 0 and 10000"
    );
  }
  const numerator = multiplyU128(
    input.totalBalance,
    BigInt(input.percentageBps),
    "early redemption target calculation"
  );
  return {
    policy: EARLY_REDEMPTION_TARGET_POLICY,
    targetTokens: numerator / BASIS_POINTS_DENOMINATOR,
    percentageBps: input.percentageBps,
    denominator: BASIS_POINTS_DENOMINATOR,
    remainder: numerator % BASIS_POINTS_DENOMINATOR
  };
}

/**
 * Allocates exactly targetTokens proportionally, awarding remaining integer
 * tokens by descending quota remainder, then ascending base58 ASCII address/ID.
 * Inputs are not mutated. Investor IDs are normalized as in snapshot-v2.
 * Zero-balance rows never receive tokens; empty input is valid only for target 0.
 */
export function allocateEarlyRedemption(input: {
  rows: readonly EarlyRedemptionAllocationInputRow[];
  targetTokens: bigint;
}): EarlyRedemptionAllocation {
  if (input === null || typeof input !== "object") {
    throw new DomainValidationError("INVALID_ALLOCATION_INPUT", "Allocation input must be an object");
  }
  assertAllocationU64(input.targetTokens, "targetTokens");
  if (!Array.isArray(input.rows)) {
    throw new DomainValidationError("INVALID_ALLOCATION_INPUT", "rows must be an array");
  }

  const seenInvestors = new Set<string>();
  const seenAddresses = new Set<string>();
  const rows: EarlyRedemptionAllocationRow[] = [];
  let totalBalance = 0n;
  for (const row of input.rows) {
    if (row === null || typeof row !== "object") {
      throw new DomainValidationError("INVALID_ALLOCATION_INPUT", "Each allocation row must be an object");
    }
    const investorId = normalizeInvestorId(row.investorId);
    assertTieAddress(row.tieAddress);
    assertAllocationU64(row.balance, "balance");
    if (seenInvestors.has(investorId)) {
      throw new DomainValidationError("DUPLICATE_INVESTOR", "Duplicate investor " + investorId);
    }
    if (seenAddresses.has(row.tieAddress)) {
      throw new DomainValidationError("DUPLICATE_TIE_ADDRESS", "Duplicate tieAddress " + row.tieAddress);
    }
    seenInvestors.add(investorId);
    seenAddresses.add(row.tieAddress);
    totalBalance = assertResultU64(totalBalance + row.balance, "early redemption total balance");
    rows.push({
      investorId,
      tieAddress: row.tieAddress,
      balance: row.balance,
      redeemedTokens: 0n,
      remainingTokens: row.balance,
      quotaRemainder: 0n
    });
  }
  if (input.targetTokens > totalBalance) {
    throw new DomainValidationError("TARGET_EXCEEDS_BALANCE", "targetTokens must not exceed totalBalance");
  }
  rows.sort(compareRows);

  if (totalBalance > 0n) {
    let allocatedTokens = 0n;
    for (const row of rows) {
      const numerator = multiplyU128(row.balance, input.targetTokens, "early redemption quota calculation");
      row.redeemedTokens = numerator / totalBalance;
      row.remainingTokens = row.balance - row.redeemedTokens;
      row.quotaRemainder = numerator % totalBalance;
      allocatedTokens += row.redeemedTokens;
    }

    // Only positive fractional quotas can receive a token above their floor.
    const rankedRows = rows.filter(row => row.quotaRemainder > 0n);
    rankedRows.sort((left, right) => {
      if (left.quotaRemainder !== right.quotaRemainder) {
        return left.quotaRemainder > right.quotaRemainder ? -1 : 1;
      }
      return compareRows(left, right);
    });
    let tokensLeft = input.targetTokens - allocatedTokens;
    for (const row of rankedRows) {
      if (tokensLeft === 0n) break;
      row.redeemedTokens += 1n;
      row.remainingTokens -= 1n;
      tokensLeft -= 1n;
    }
    if (tokensLeft !== 0n) {
      throw new DomainValidationError("ALLOCATION_MISMATCH", "Could not allocate the exact redemption target");
    }
  }

  return {
    policy: EARLY_REDEMPTION_ALLOCATION_POLICY,
    rows,
    totalBalance,
    targetTokens: input.targetTokens,
    denominator: totalBalance
  };
}

import { DomainValidationError } from "./errors.js";

export const MAX_U64 = (1n << 64n) - 1n;
export const MAX_U128 = (1n << 128n) - 1n;

export function assertU64(value: bigint, fieldName: string): void {
  if (value < 0n || value > MAX_U64) {
    throw new DomainValidationError(
      "VALUE_OUT_OF_RANGE",
      `${fieldName} must be between 0 and ${MAX_U64}`
    );
  }
}

export function assertPositiveU64(value: bigint, fieldName: string): void {
  assertU64(value, fieldName);
  if (value === 0n) {
    throw new DomainValidationError(
      "VALUE_MUST_BE_POSITIVE",
      `${fieldName} must be greater than zero`
    );
  }
}

export function multiplyU128(
  left: bigint,
  right: bigint,
  operationName: string
): bigint {
  if (left < 0n || right < 0n) {
    throw new DomainValidationError(
      "NEGATIVE_VALUE",
      `${operationName} does not accept negative values`
    );
  }

  const result = left * right;
  if (result > MAX_U128) {
    throw new DomainValidationError(
      "ARITHMETIC_OVERFLOW",
      `${operationName} exceeds the u128 intermediate range`
    );
  }

  return result;
}

export function assertResultU64(value: bigint, operationName: string): bigint {
  if (value > MAX_U64) {
    throw new DomainValidationError(
      "ARITHMETIC_OVERFLOW",
      `${operationName} result exceeds the u64 storage range`
    );
  }

  return value;
}

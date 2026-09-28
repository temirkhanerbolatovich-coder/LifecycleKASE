import { DomainValidationError } from "./errors.js";

export const CORPORATE_ACTION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "SNAPSHOT_CREATED",
  "CALCULATED",
  "READY_FOR_EXECUTION",
  "PROCESSING",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "SNAPSHOT_MISSED",
  "CANCELLED"
] as const;

export type CorporateActionStatus = (typeof CORPORATE_ACTION_STATUSES)[number];

const ALLOWED_TRANSITIONS: Readonly<
  Record<CorporateActionStatus, ReadonlySet<CorporateActionStatus>>
> = {
  DRAFT: new Set(["SCHEDULED", "CANCELLED"]),
  SCHEDULED: new Set(["SNAPSHOT_CREATED", "SNAPSHOT_MISSED", "CANCELLED"]),
  SNAPSHOT_CREATED: new Set(["CALCULATED"]),
  CALCULATED: new Set(["READY_FOR_EXECUTION"]),
  READY_FOR_EXECUTION: new Set(["PROCESSING"]),
  PROCESSING: new Set([
    "PARTIALLY_COMPLETED",
    "COMPLETED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL"
  ]),
  PARTIALLY_COMPLETED: new Set(["PROCESSING"]),
  FAILED_RETRYABLE: new Set(["PROCESSING"]),
  COMPLETED: new Set(),
  FAILED_FINAL: new Set(),
  SNAPSHOT_MISSED: new Set(),
  CANCELLED: new Set()
};

export function canTransitionCorporateAction(
  currentStatus: CorporateActionStatus,
  nextStatus: CorporateActionStatus
): boolean {
  return ALLOWED_TRANSITIONS[currentStatus].has(nextStatus);
}

export function assertCorporateActionTransition(
  currentStatus: CorporateActionStatus,
  nextStatus: CorporateActionStatus
): void {
  if (!canTransitionCorporateAction(currentStatus, nextStatus)) {
    throw new DomainValidationError(
      "INVALID_STATE_TRANSITION",
      `Corporate action cannot transition from ${currentStatus} to ${nextStatus}`
    );
  }
}

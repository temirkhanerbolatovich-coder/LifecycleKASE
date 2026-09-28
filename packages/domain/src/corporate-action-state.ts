import { DomainValidationError } from "./errors.js";

export const CORPORATE_ACTION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "SNAPSHOT_CREATED",
  "CALCULATED",
  "UNDER_REVIEW",
  "RETURNED_FOR_REVISION",
  "APPROVED",
  "EXECUTING",
  "PARTIALLY_SETTLED",
  "SETTLED",
  "RECONCILING",
  "FINALIZED",
  "REJECTED",
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
  CALCULATED: new Set(["UNDER_REVIEW"]),
  UNDER_REVIEW: new Set(["APPROVED", "REJECTED", "RETURNED_FOR_REVISION"]),
  RETURNED_FOR_REVISION: new Set(["CALCULATED", "CANCELLED"]),
  APPROVED: new Set(["EXECUTING"]),
  EXECUTING: new Set([
    "PARTIALLY_SETTLED",
    "SETTLED",
    "FAILED_RETRYABLE",
    "FAILED_FINAL"
  ]),
  PARTIALLY_SETTLED: new Set(["EXECUTING", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  SETTLED: new Set(["RECONCILING"]),
  RECONCILING: new Set(["FINALIZED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  FAILED_RETRYABLE: new Set(["EXECUTING", "RECONCILING"]),
  FINALIZED: new Set(),
  REJECTED: new Set(),
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

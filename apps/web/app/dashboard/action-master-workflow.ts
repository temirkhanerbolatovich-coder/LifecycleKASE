import type { CorporateActionView } from "./action-workflow";
import type { EntitlementsView } from "./entitlement-workflow";
import type { ApprovalView } from "./action-approval-workflow";
import type { ControlledCaptureView } from "./controlled-capture-workflow";
import type { CouponBudget } from "./coupon-workflow";
import type { CouponExecutionView } from "./coupon-execution-workflow";
import type { RedemptionExecutionView } from "./redemption-execution-workflow";
import { createTranslator, getDisplayLocale, type Locale } from "./locale";

export const ACTION_MASTER_STEPS = ["terms", "snapshot", "calculation", "readiness", "approval", "execution"] as const;
export type ActionMasterStep = typeof ACTION_MASTER_STEPS[number];
export type ActionMasterState = "not_started" | "active" | "completed" | "blocked";
export type ActionMasterFacts = {
  entitlements?: EntitlementsView | null; approval?: ApprovalView | null; capture?: ControlledCaptureView | null;
  budget?: CouponBudget | null; execution?: CouponExecutionView | RedemptionExecutionView | null;
};
const positiveInteger = (value: string) => /^[1-9][0-9]*$/.test(value);
/** A read-only projection. Navigation never prepares, signs, submits or confirms a transaction. */
export function actionMaster(action: CorporateActionView, facts: ActionMasterFacts = {}, locale: Locale = getDisplayLocale()) {
  const t = createTranslator(locale);
  const finalized = (type: string) => action.blockchainTransactions.some(tx => tx.operationType === type && tx.status === "FINALIZED" && Boolean(tx.signature));
  const current = <T extends { actionId?: string; corporateActionId?: string; actionVersion: number }>(value: T | null | undefined) =>
    value && (value.actionId ?? value.corporateActionId) === action.id && value.actionVersion === action.version ? value : null;
  const entitlements = current(facts.entitlements); const approval = current(facts.approval); const execution = current(facts.execution);
  const budget = current(facts.budget);
  const controlled = action.instrument.tokenPolicy === "CONTROLLED_FROZEN_V2";
  const redemption = action.type === "EARLY_REDEMPTION" || action.type === "BOND_REDEMPTION";
  const terminal = ["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"].includes(action.status);
  const snapshot = action.snapshot?.status === "FINALIZED";
  const scheduled = snapshot || finalized("ACTION_SCHEDULE") || ["SCHEDULED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "RETURNED_FOR_REVISION", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "RECONCILING", "FINALIZED"].includes(action.status);
  const registered = finalized("CALCULATION_FINALIZE") || entitlements?.onchainCalculationFinalized === true;
  const unitReservations = !controlled || !redemption || Boolean(entitlements?.items.length && entitlements.items.every(row => row.unitReservationConfirmed)) ||
    Boolean(action.snapshot?.investorCount && action.blockchainTransactions.filter(tx => tx.operationType === "CONTROLLED_UNIT_RESERVATION" && tx.status === "FINALIZED" && tx.signature).length === action.snapshot.investorCount);
  const approved = finalized("ACTION_APPROVAL") || approval?.approved === true;
  const released = !controlled || finalized("CONTROLLED_CAPTURE_FINISH") || Boolean(facts.capture?.actionId === action.id && facts.capture.capture?.finished);
  const reserved = approved || Boolean(approval?.reserveExists && positiveInteger(approval.amountMinor) && BigInt(approval.reservedMinor) >= BigInt(approval.amountMinor));
  const receipt = finalized(redemption ? "REDEMPTION_FINALIZE" : "COUPON_FINALIZE") && action.status === "FINALIZED";
  const completed = [scheduled, Boolean(snapshot), registered && unitReservations && action.status !== "RETURNED_FOR_REVISION", reserved && released, approved, receipt];
  const details = [t("master.schedule.help"), t("master.snapshot.help"), t("master.calculation.help"), t("master.readiness.help"), t("master.approval.help"), t("master.execution.help")];
  const steps = ACTION_MASTER_STEPS.map((id, index) => ({ id, label: t(`master.${id}`), state: completed[index] ? "completed" as ActionMasterState : "not_started" as ActionMasterState,
    detail: details[index]!, target: id as ActionMasterStep }));
  const first = completed.findIndex(value => !value);
  if (first >= 0) {
    const step = steps[first]!; step.state = terminal ? "blocked" : "active";
    if (terminal) step.detail = t("master.terminal");
    else if (first === 2) {
      if (action.status === "RETURNED_FOR_REVISION") step.detail = t("master.revision");
      else if (entitlements?.items.length && entitlements.totalEntitlementMinor === "0") { step.state = "blocked"; step.detail = t("master.zero"); }
      else if (entitlements?.investors.some(row => row.receiverWallets.length === 0) || entitlements?.items.some(row => !row.currentEligibility.eligible)) { step.state = "blocked"; step.detail = t("master.eligibility"); }
      else if (entitlements?.onchainRegistrationEnabled === false && !registered) { step.state = "blocked"; step.detail = t("master.registration.disabled"); }
      else if (registered && !unitReservations) step.detail = t("master.units");
    } else if (first === 3) {
      if (!released) { step.state = "blocked"; step.detail = t("master.capture.finish"); step.target = "snapshot"; }
      else if (budget && !budget.budgetReady) { step.state = "blocked"; step.detail = t("master.funding"); }
      else step.detail = t("master.budget");
    } else if (first === 4) step.detail = t("master.approver");
    else if (first === 5) {
      if (execution?.enabled === false || !(redemption ? action.redemptionExecutionEnabled : action.couponExecutionEnabled)) { step.state = "blocked"; step.detail = t("master.execution.disabled"); }
      else if (execution?.paid === execution?.payable && execution?.payable !== undefined) step.detail = t("master.receipt.next");
      else if (execution) step.detail = t("master.execution.progress", { paid: execution.paid, payable: execution.payable });
    }
  }
  for (const step of steps) if (step.state === "not_started") step.detail = terminal ? t("master.terminal") : t("master.wait.previous");
  if (receipt) steps[5]!.detail = t("master.receipt.done");
  const pending = action.blockchainTransactions.find(tx => tx.status === "UNKNOWN_CONFIRMATION") ??
    action.blockchainTransactions.find(tx => tx.status === "SUBMITTED") ?? action.blockchainTransactions.find(tx => tx.status === "PREPARED");
  const pendingStep = pending ? masterStepForOperation(pending.operationType) : null;
  if (pending && pendingStep) { const step = steps.find(step => step.id === pendingStep)!; step.state = "active"; step.target = pendingStep;
    step.detail = t(pending.signature || pending.status !== "PREPARED" ? "master.pending.signed" : "master.pending.unsigned"); }
  return { steps, pending, recommended: pendingStep ?? steps[first < 0 ? 5 : first]!.target, terminal };
}
export function masterStepForOperation(operation: string): ActionMasterStep {
  if (operation.startsWith("ACTION_SCHEDULE") || operation === "ACTION_CANCEL") return "terms";
  if (operation.startsWith("SNAPSHOT") || operation.startsWith("CONTROLLED_CAPTURE")) return "snapshot";
  if (operation.startsWith("ENTITLEMENT_") || operation.startsWith("CALCULATION_") || operation === "CONTROLLED_UNIT_RESERVATION") return "calculation";
  if (["COUPON_FUNDING", "ACTION_APPROVER_ASSIGN", "ACTION_RESERVE_FUND", "ACTION_RESERVE_RELEASE"].includes(operation)) return "readiness";
  if (operation === "ACTION_APPROVAL") return "approval";
  return "execution";
}

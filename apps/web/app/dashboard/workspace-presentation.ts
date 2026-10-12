import { createTranslator, formatLocaleDate, getDisplayLocale, LOCALE_FORMATS, translateStoredMessage, type Locale } from "./locale";
import type { CorporateActionView } from "./action-workflow";

export const ACTION_TYPES: Record<string, string> = { COUPON_PAYMENT: "Купон", BOND_REDEMPTION: "Погашение по сроку", EARLY_REDEMPTION: "Досрочное погашение" };
export const ACTION_STATUSES: Record<string, string> = { DRAFT: "Черновик", SCHEDULED: "Запланировано", SNAPSHOT_MISSED: "Окно фиксации пропущено", SNAPSHOT_CREATED: "Держатели зафиксированы", CALCULATED: "Рассчитано", UNDER_REVIEW: "На согласовании", RETURNED_FOR_REVISION: "Возвращено на доработку", APPROVED: "Согласовано", EXECUTING: "Выполняется", PARTIALLY_SETTLED: "Часть выплат подтверждена", SETTLED: "Выплаты подтверждены", RECONCILING: "Сверяется", FINALIZED: "Завершено", REJECTED: "Отклонено", CANCELLED: "Отменено" };
export type RegistryFilters = { query: string; status: string; sort: string };
export const INITIAL_FILTERS: RegistryFilters = { query: "", status: "", sort: "asc" };

export function workspaceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Display only: never changes the UTC values used by workflow requests. */
export function formatWorkspaceDate(value: string | null | undefined, timeZone = workspaceTimeZone(), dateOnly = false, locale: Locale = getDisplayLocale()): string {
  return formatLocaleDate(value, locale, timeZone, dateOnly);
}

/** Search and sort only the records already returned by the existing paginated API. */
export function filterRegistry<T>(rows: readonly T[], filters: RegistryFilters, text: (row: T) => string, status: (row: T) => string, order: (row: T) => string = text, locale: Locale = getDisplayLocale()): T[] {
  const query = filters.query.trim().toLocaleLowerCase(LOCALE_FORMATS[locale]);
  return rows.filter(row => (!filters.status || status(row) === filters.status) && text(row).toLocaleLowerCase(LOCALE_FORMATS[locale]).includes(query))
    .sort((a, b) => order(a).localeCompare(order(b), LOCALE_FORMATS[locale], { numeric: true }) * (filters.sort === "desc" ? -1 : 1));
}
export function statusTone(status: string): "ready" | "wait" | "muted" {
  if (["FINALIZED", "ACTIVE", "APPROVED", "ELIGIBLE"].includes(status)) return "ready";
  return ["CANCELLED", "REJECTED", "REVOKED", "FAILED"].includes(status) ? "muted" : "wait";
}
export type ActionStep = { label: string; state: "done" | "current" | "blocked" | "unavailable"; detail: string };
export function actionPresentation(action: CorporateActionView, canWrite: boolean, locale: Locale = getDisplayLocale()) {
  const t = createTranslator(locale);
  const transactions = action.blockchainTransactions ?? [];
  const pending = transactions.find(tx => tx.status === "UNKNOWN_CONFIRMATION") ?? transactions.find(tx => tx.status === "SUBMITTED") ?? transactions.find(tx => tx.status === "PREPARED");
  const snapshot = action.snapshot?.status === "FINALIZED";
  const calculated = ["CALCULATED", "UNDER_REVIEW", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(action.status);
  const registered = transactions.some(tx => tx.operationType === "CALCULATION_FINALIZE" && tx.status === "FINALIZED");
  const approved = transactions.some(tx => tx.operationType === "ACTION_APPROVAL" && tx.status === "FINALIZED");
  const scheduled = ["SCHEDULED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "APPROVED"].includes(action.status) || transactions.some(tx => tx.operationType === "ACTION_SCHEDULE" && tx.status === "FINALIZED");
  const terminal = ["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"].includes(action.status);
  const redemption = ["EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(action.type);
  const receiptType = redemption ? "REDEMPTION_FINALIZE" : "COUPON_FINALIZE";
  const paymentType = redemption ? "REDEMPTION_PAYMENT" : "COUPON_PAYMENT";
  const receipt = transactions.some(tx => tx.operationType === receiptType && tx.status === "FINALIZED");
  const payments = transactions.filter(tx => tx.operationType === paymentType && tx.status === "FINALIZED").length;
  const execution = redemption ? Boolean(action.redemptionExecutionEnabled) : action.type === "COUPON_PAYMENT" && Boolean(action.couponExecutionEnabled);
  const paid = payments > 0 && payments === (action.eligibleHolders ?? action.snapshot?.investorCount);
  const steps: ActionStep[] = [
    { label: t("core.scheduling"), state: scheduled ? "done" : action.status === "DRAFT" ? "current" : "blocked", detail: scheduled ? t("core.status.reported.by.the.api") : t("core.the.draft.is.not.on.solana.yet") },
    { label: t("core.holders"), state: snapshot ? "done" : action.status === "SCHEDULED" ? "current" : "blocked", detail: snapshot ? t("core.capture.finalized.on.chain") : t("core.window.checked.against.network.time") },
    { label: t("core.entitlements"), state: calculated ? "done" : snapshot ? "current" : "blocked", detail: calculated ? t("core.calculation.saved") : t("core.a.finalized.snapshot.is.required") },
    { label: t("core.registration"), state: registered ? "done" : calculated ? "current" : "blocked", detail: registered ? t("core.finalize.confirmed") : t("core.check.availability.in.entitlements") },
    { label: t("core.approval"), state: approved ? "done" : registered ? "current" : "blocked", detail: approved ? "Finalized approval" : action.status === "APPROVED" ? t("core.database.approval.exists.on.chain.proof.is.absent") : t("core.authority.and.budget.are.checked.separately") },
    { label: t("core.execution"), state: paid || receipt ? "done" : execution && approved ? "current" : "unavailable", detail: receipt ? t("core.result.committed.on.chain") : payments ? t("core.confirmedOperations", { kind: redemption ? t("core.redemptions") : t("core.payments"), count: payments }) : execution ? redemption ? t("core.payment.and.token.burn.in.one.transaction") : t("core.payment.from.the.action.reserve") : t("core.an.accepted.program.candidate.is.required") },
    { label: t("core.final.receipt"), state: receipt ? "done" : execution && paid ? "current" : "unavailable", detail: receipt ? t("core.json.and.hash.verified") : t("core.after.reconciling.every.payment") }
  ];
  if (terminal) for (const step of steps) if (step.state === "current") step.state = "blocked";
  let next = t("core.check.saved.results");
  let explanation = t("core.history.and.evidence.are.separate.from.operation.controls");
  if (pending) {
    next = pending.signature ? t("core.check.the.existing.signature") : t("core.recover.the.prepared.attempt");
    explanation = t("core.pendingAttempt", { operation: pending.operationType, status: pending.status });
  } else if (receipt) {
    next = t("core.download.final.receipt");
    explanation = redemption ? t("core.payments.burns.and.supply.reconciled.the.final.receipt.hash.is.committed.to.solana") : t("core.payments.reconciled.the.final.receipt.hash.is.committed.to.solana");
  } else if (terminal) {
    next = t("core.the.action.has.ended.or.needs.a.new.scenario");
    explanation = action.status === "SNAPSHOT_MISSED" ? t("core.create.a.new.action.with.a.future.date.this.action.s.history.is") : t("core.review.the.reason.and.decision.history");
  } else if (action.status === "DRAFT") next = t("core.prepare.scheduling");
  else if (action.status === "SCHEDULED") next = t("core.check.the.holder.capture.window");
  else if (snapshot && !calculated) next = t("core.check.recipients.and.calculate.entitlements");
  else if (action.status === "CALCULATED") next = t("core.submit.calculation.for.approval");
  else if (calculated && !registered) next = t("core.check.registration.and.finalize");
  else if (registered && !approved) next = t("core.check.budget.and.separate.approval");
  else if (execution && paid) next = t("core.prepare.final.confirmation");
  else if (execution && approved) next = redemption ? t("core.continue.payments.and.token.redemption") : t("core.continue.coupon.payments");
  if (!canWrite) explanation += t("core.read.only.operations.require.the.assigned.signer.and.appropriate.permissions");
  return { steps, next, explanation, pending, terminal };
}

/** Unknown signed outcomes take priority over unsigned work; completed history stays in the registry. */
export function attentionActions(actions: readonly CorporateActionView[]) {
  const priority = (action: CorporateActionView) => action.blockchainTransactions.some(tx => tx.status === "UNKNOWN_CONFIRMATION") ? 0 :
    action.blockchainTransactions.some(tx => ["SUBMITTED", "PREPARED"].includes(tx.status)) ? 1 : action.status === "SCHEDULED" ? 3 : 2;
  return actions.filter(action => !["CANCELLED", "REJECTED", "FINALIZED", "FAILED_FINAL"].includes(action.status)).sort((a, b) => priority(a) - priority(b));
}

export function getActionTypes(locale: Locale = getDisplayLocale()): Record<string, string> {
  return Object.fromEntries(Object.entries(ACTION_TYPES).map(([code, label]) => [code, translateStoredMessage(label, locale)]));
}
export function getActionStatuses(locale: Locale = getDisplayLocale()): Record<string, string> {
  return Object.fromEntries(Object.entries(ACTION_STATUSES).map(([code, label]) => [code, translateStoredMessage(label, locale)]));
}
export function statusLabel(status: string, locale: Locale = getDisplayLocale()): string { return getActionStatuses(locale)[status] ?? status; }

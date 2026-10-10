import type { CorporateActionView } from "./action-workflow";

export const ACTION_TYPES: Record<string, string> = { COUPON_PAYMENT: "Купон", BOND_REDEMPTION: "Погашение по сроку", EARLY_REDEMPTION: "Досрочное погашение" };
export const ACTION_STATUSES: Record<string, string> = { DRAFT: "Черновик", SCHEDULED: "Запланировано", SNAPSHOT_MISSED: "Окно фиксации пропущено", SNAPSHOT_CREATED: "Держатели зафиксированы", CALCULATED: "Рассчитано", UNDER_REVIEW: "На согласовании", APPROVED: "Согласовано", EXECUTING: "Выполняется", PARTIALLY_SETTLED: "Часть выплат подтверждена", SETTLED: "Выплаты подтверждены", RECONCILING: "Сверяется", FINALIZED: "Завершено", REJECTED: "Отклонено", CANCELLED: "Отменено" };
export type RegistryFilters = { query: string; status: string; sort: string };
export const INITIAL_FILTERS: RegistryFilters = { query: "", status: "", sort: "asc" };

export function workspaceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Display only: never changes the UTC values used by workflow requests. */
export function formatWorkspaceDate(value: string | null | undefined, timeZone = workspaceTimeZone(), dateOnly = false): string {
  if (!value) return "Не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата неизвестна";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(date);
}

/** Search and sort only the records already returned by the existing paginated API. */
export function filterRegistry<T>(rows: readonly T[], filters: RegistryFilters, text: (row: T) => string, status: (row: T) => string, order: (row: T) => string = text): T[] {
  const query = filters.query.trim().toLocaleLowerCase("ru-RU");
  return rows.filter(row => (!filters.status || status(row) === filters.status) && text(row).toLocaleLowerCase("ru-RU").includes(query))
    .sort((a, b) => order(a).localeCompare(order(b), "ru-RU", { numeric: true }) * (filters.sort === "desc" ? -1 : 1));
}
export function statusTone(status: string): "ready" | "wait" | "muted" {
  if (["FINALIZED", "ACTIVE", "APPROVED", "ELIGIBLE"].includes(status)) return "ready";
  return ["CANCELLED", "REJECTED", "REVOKED", "FAILED"].includes(status) ? "muted" : "wait";
}
export type ActionStep = { label: string; state: "done" | "current" | "blocked" | "unavailable"; detail: string };
export function actionPresentation(action: CorporateActionView, canWrite: boolean) {
  const transactions = action.blockchainTransactions ?? [];
  const pending = transactions.find(tx => tx.status === "UNKNOWN_CONFIRMATION") ?? transactions.find(tx => tx.status === "SUBMITTED") ?? transactions.find(tx => tx.status === "PREPARED");
  const snapshot = action.snapshot?.status === "FINALIZED";
  const calculated = ["CALCULATED", "UNDER_REVIEW", "APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(action.status);
  const registered = transactions.some(tx => tx.operationType === "CALCULATION_FINALIZE" && tx.status === "FINALIZED");
  const approved = transactions.some(tx => tx.operationType === "ACTION_APPROVAL" && tx.status === "FINALIZED");
  const scheduled = ["SCHEDULED", "SNAPSHOT_CREATED", "CALCULATED", "UNDER_REVIEW", "APPROVED"].includes(action.status) || transactions.some(tx => tx.operationType === "ACTION_SCHEDULE" && tx.status === "FINALIZED");
  const terminal = ["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"].includes(action.status);
  const receipt = transactions.some(tx => tx.operationType === "COUPON_FINALIZE" && tx.status === "FINALIZED");
  const payments = transactions.filter(tx => tx.operationType === "COUPON_PAYMENT" && tx.status === "FINALIZED").length;
  const execution = action.type === "COUPON_PAYMENT" && Boolean(action.couponExecutionEnabled);
  const paid = payments > 0 && payments === (action.eligibleHolders ?? action.snapshot?.investorCount);
  const steps: ActionStep[] = [
    { label: "Планирование", state: scheduled ? "done" : action.status === "DRAFT" ? "current" : "blocked", detail: scheduled ? "Статус по данным API" : "Черновик ещё не в Solana" },
    { label: "Держатели", state: snapshot ? "done" : action.status === "SCHEDULED" ? "current" : "blocked", detail: snapshot ? "Фиксация подтверждена сетью" : "Окно проверяется по времени сети" },
    { label: "Начисления", state: calculated ? "done" : snapshot ? "current" : "blocked", detail: calculated ? "Расчёт сохранён" : "Нужен finalized snapshot" },
    { label: "Регистрация", state: registered ? "done" : calculated ? "current" : "blocked", detail: registered ? "FINALIZE подтверждён" : "Проверьте доступность в начислениях" },
    { label: "Согласование", state: approved ? "done" : registered ? "current" : "blocked", detail: approved ? "Finalized approval" : action.status === "APPROVED" ? "Есть решение БД; on-chain proof отсутствует" : "Полномочия и бюджет проверяются отдельно" },
    { label: "Исполнение", state: paid || receipt ? "done" : execution && approved ? "current" : "unavailable", detail: receipt ? "Результат закреплён в сети" : payments ? `Подтверждено выплат: ${payments}` : execution ? "Выплата из резерва действия" : "Требуется принятый кандидат программы" },
    { label: "Итоговый документ", state: receipt ? "done" : execution && paid ? "current" : "unavailable", detail: receipt ? "JSON и hash подтверждены" : "После сверки всех выплат" }
  ];
  if (terminal) for (const step of steps) if (step.state === "current") step.state = "blocked";
  let next = "Проверьте сохранённые результаты";
  let explanation = "История и доказательства доступны отдельно от рабочих кнопок.";
  if (pending) {
    next = pending.signature ? "Проверить существующую подпись" : "Восстановить подготовленную попытку";
    explanation = `${pending.operationType} · ${pending.status}. Используйте исходный UUID; неизвестный результат не разрешает повторную отправку.`;
  } else if (receipt) {
    next = "Скачать итоговый документ";
    explanation = "Выплаты сверены, hash итогового документа закреплён в Solana.";
  } else if (terminal) {
    next = "Действие завершено или требует нового сценария";
    explanation = action.status === "SNAPSHOT_MISSED" ? "Создайте новое действие с будущей датой. История этого действия сохранена." : "Изучите причину и историю решения.";
  } else if (action.status === "DRAFT") next = "Подготовить планирование";
  else if (action.status === "SCHEDULED") next = "Проверить окно фиксации держателей";
  else if (snapshot && !calculated) next = "Проверить получателей и рассчитать начисления";
  else if (action.status === "CALCULATED") next = "Передать расчёт на согласование";
  else if (calculated && !registered) next = "Проверить регистрацию и FINALIZE";
  else if (registered && !approved) next = "Проверить бюджет и отдельное согласование";
  else if (execution && paid) next = "Подготовить итоговое подтверждение";
  else if (execution && approved) next = "Продолжить выплаты купона";
  if (!canWrite) explanation += " Режим чтения: операции доступны только назначенному подписанту с нужными правами.";
  return { steps, next, explanation, pending, terminal };
}

/** Unknown signed outcomes take priority over unsigned work; completed history stays in the registry. */
export function attentionActions(actions: readonly CorporateActionView[]) {
  const priority = (action: CorporateActionView) => action.blockchainTransactions.some(tx => tx.status === "UNKNOWN_CONFIRMATION") ? 0 :
    action.blockchainTransactions.some(tx => ["SUBMITTED", "PREPARED"].includes(tx.status)) ? 1 : action.status === "SCHEDULED" ? 3 : 2;
  return actions.filter(action => !["CANCELLED", "REJECTED", "FINALIZED", "FAILED_FINAL"].includes(action.status)).sort((a, b) => priority(a) - priority(b));
}

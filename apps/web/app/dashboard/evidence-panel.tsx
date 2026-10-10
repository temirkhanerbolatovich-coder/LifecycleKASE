"use client";
import { formatWorkspaceDate } from "./workspace-presentation";
import { useEffect, useRef, useState } from "react";
import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone } from "./workspace-presentation";
import { shortWalletAddress } from "./wallet-account-selection";
type RecordRow = { id: string; createdAt: string; corporateActionId: string | null; instrumentId?: string | null; operationType?: string; status?: string;
  signature?: string | null; lastErrorCode?: string | null; requiredSigner?: string | null; event?: string; entityType?: string;
  entityId?: string; actorWallet?: string | null; metadataJson?: unknown };
export function EvidencePanel({ kind, request, onOpenAction, onOpenInstrument, onOpenInvestor }: { kind: "transactions" | "audit";
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>; onOpenAction: (id: string) => void;
  onOpenInstrument: (id: string) => void; onOpenInvestor: (id: string) => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState({ ...INITIAL_FILTERS, sort: "desc" }); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function load(more = false, signal?: AbortSignal) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request(`/api/v1/${kind}?limit=20${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal ? { signal } : undefined);
      if (!Array.isArray(result["items"]) || result["nextCursor"] !== null && typeof result["nextCursor"] !== "string") throw new Error("Не удалось прочитать журнал.");
      if (!signal?.aborted) { setRows(previous => more ? [...previous, ...result["items"] as RecordRow[]].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index) : result["items"] as RecordRow[]); setCursor(result["nextCursor"] as string | null); }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Журнал недоступен."); }
    finally { inFlight.current = false; if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { void load(); }, [kind, request]);
  const labels: Record<string, string> = kind === "transactions" ? { PREPARED: "Подготовлено", SUBMITTED: "Отправлено", UNKNOWN_CONFIRMATION: "Результат неизвестен", FINALIZED: "Подтверждено", FAILED: "Ошибка" } : {};
  const shown = filterRegistry(rows, filters, row => [evidenceLabel(row.operationType ?? row.event ?? ""), row.operationType, row.event, row.id, row.corporateActionId, row.instrumentId, row.entityId, row.signature, row.actorWallet].join(" "), row => row.status ?? "", row => row.createdAt);
  return <section aria-label={kind === "transactions" ? "Журнал транзакций" : "Журнал аудита"}>
    <div className="registry-heading"><div><h3>{kind === "transactions" ? "История транзакций" : "История решений"}</h3><p>{kind === "transactions" ? "Сначала проверяйте попытки с неизвестным результатом." : "Кто, когда и для какого объекта выполнил операцию."}</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void load()}>Обновить</button></div>
    <RegistryToolbar label="журнал" loaded={rows.length} shown={shown.length} filters={filters} onChange={setFilters} statuses={labels} sortLabel="Дата" />
    {busy && rows.length === 0 && <RegistrySkeleton />}
    {shown.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="Записи журнала"><table className="registry-table"><thead><tr>
      <th>Дата</th><th>Операция</th><th>{kind === "transactions" ? "Результат" : "Исполнитель"}</th><th>Действие / реквизиты</th></tr></thead>
      <tbody>{shown.map(row => <tr key={row.id}><td className="whitespace-nowrap">{formatWorkspaceDate(row.createdAt)}</td>
        <td><strong>{evidenceLabel(row.operationType ?? row.event ?? "")}</strong></td>
        <td>{kind === "transactions" ? <span className={`status-${statusTone(row.status ?? "")}`}>{labels[row.status ?? ""] ?? row.status}</span> : <span title={row.actorWallet ?? ""}>{row.actorWallet ? shortWalletAddress(row.actorWallet) : "Система"}</span>}</td>
        <td>{row.corporateActionId && <button className="table-object-link" onClick={() => onOpenAction(row.corporateActionId!)}>Открыть действие →</button>}
          {!row.corporateActionId && (row.instrumentId || row.entityType === "Instrument") && <button className="table-object-link" onClick={() => onOpenInstrument(row.instrumentId ?? row.entityId!)}>Открыть инструмент →</button>}
          {!row.corporateActionId && row.entityType === "Investor" && row.entityId && <button className="table-object-link" onClick={() => onOpenInvestor(row.entityId!)}>Открыть инвестора →</button>}
          <details className="term-help"><summary>Реквизиты записи</summary><p className="technical-id">{row.operationType ?? row.event} · UUID: {row.id}</p>
            {row.signature && <CopyValue value={row.signature} label="Исходная подпись" />}{row.lastErrorCode && <p>Причина: {row.lastErrorCode}</p>}
            {row.entityId && <p className="technical-id">{row.entityType}: {row.entityId}</p>}
            {row.metadataJson !== undefined && <pre className="technical-id whitespace-pre-wrap">{JSON.stringify(row.metadataJson, null, 2)}</pre>}</details></td></tr>)}</tbody></table></div>}
    {!busy && !error && shown.length === 0 && <p className="empty-state">{rows.length ? "По выбранным фильтрам записей нет." : "В журнале пока нет записей."}</p>}
    {cursor && <button className="secondary-button mt-4" disabled={busy} onClick={() => void load(true)}>Показать ещё</button>}
    <RequestNotice busy={busy} message="" error={error} onRetry={() => void load()} />
  </section>;
}

function evidenceLabel(value: string) {
  const labels: Record<string, string> = { COUPON_PAYMENT: "Выплата купона", COUPON_FINALIZE: "Итоговый документ", COUPON_FUNDING: "Пополнение бюджета",
    ACTION_APPROVAL: "Согласование действия", ACTION_RESERVE: "Резервирование бюджета", ACTION_RELEASE: "Возврат резерва", ACTION_APPROVAL_POLICY: "Назначение согласующего",
    ENTITLEMENT_REGISTER: "Регистрация начисления", CALCULATION_FINALIZE: "Подтверждение расчёта", CALCULATION_RESET: "Сброс регистрации",
    SNAPSHOT_REGISTER: "Регистрация держателей", SNAPSHOT_REGISTRATION: "Регистрация держателей", ACTION_SCHEDULE: "Планирование действия", ACTION_CANCEL: "Отмена действия",
    COUPON_EXECUTION_PREPARED: "Подготовлен план выплаты", COUPON_PAYMENT_FINALIZED: "Выплата подтверждена", COUPON_ACTION_FINALIZED: "Действие завершено",
    ACTION_RECEIPT_ACCESSED: "Открыт итоговый документ", ENTITLEMENTS_REVIEW_DECIDED: "Решение по расчёту", ENTITLEMENTS_CALCULATED: "Начисления рассчитаны",
    CORPORATE_ACTION_DRAFT_CREATED: "Создан черновик действия", CORPORATE_ACTION_DRAFT_CANCELLED: "Черновик отменён",
    ACTION_APPROVAL_PREPARED: "Подготовлено согласование", ACTION_APPROVAL_FINALIZED: "Согласование подтверждено",
    COUPON_FUNDING_PREPARED: "Подготовлено пополнение", COUPON_FUNDING_FINALIZED: "Бюджет пополнен",
    SNAPSHOT_CAPTURED: "Держатели зафиксированы", SNAPSHOT_REGISTRATION_PREPARED: "Подготовлена регистрация держателей",
    SNAPSHOT_REGISTERED: "Держатели зарегистрированы", INSTRUMENT_DRAFT_CREATED: "Создан черновик инструмента",
    INSTRUMENT_MINT_SETUP_PREPARED: "Подготовлен выпуск токенов", INSTRUMENT_MINT_SETUP_FINALIZED: "Токены выпущены",
    INSTRUMENT_DISTRIBUTION_PREPARED: "Подготовлено распределение", INSTRUMENT_DISTRIBUTION_FINALIZED: "Токены распределены",
    INSTRUMENT_INITIALIZE_PREPARED: "Подготовлена регистрация инструмента", INSTRUMENT_INITIALIZED: "Инструмент зарегистрирован",
    INSTRUMENT_ACTIVATION_PREPARED: "Подготовлена активация", INSTRUMENT_ACTIVATED: "Инструмент активирован",
    INVESTOR_CREATED: "Добавлен инвестор", INVESTOR_WALLET_ATTACHED: "Добавлен кошелёк инвестора", INVESTOR_WALLET_REVOKED: "Кошелёк отозван",
    INVESTOR_ELIGIBILITY_DECIDED: "Зафиксирован допуск инвестора", OPERATOR_PROVISIONED: "Зарегистрирован оператор",
    PROGRAM_UPGRADE_PREPARED: "Подготовлено обновление программы", PROGRAM_UPGRADE_FINALIZED: "Программа обновлена", PROGRAM_UPGRADE_ATTEMPT_EXPIRED: "Срок попытки обновления истёк" };
  return labels[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("ru-RU");
}

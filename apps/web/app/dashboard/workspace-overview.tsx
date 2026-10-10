"use client";
import { useEffect, useState } from "react";
import type { CorporateActionView } from "./action-workflow";
import { ACTION_STATUSES, ACTION_TYPES, actionPresentation, attentionActions, formatWorkspaceDate, workspaceTimeZone, statusTone } from "./workspace-presentation";
import { RegistrySkeleton, RequestNotice } from "./workspace-controls";

export function WorkspaceOverview({ request, onOpen, walletAddress, administrator }: {
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onOpen: (id: string) => void; walletAddress: string; administrator: boolean;
}) {
  const [actions, setActions] = useState<CorporateActionView[]>([]);
  const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  async function load(signal?: AbortSignal) {
    setBusy(true); setError(null);
    try {
      const result = await request("/api/v1/corporate-actions?limit=20", signal ? { signal } : undefined);
      if (!Array.isArray(result["items"])) throw new Error("API не вернул рабочие задачи.");
      if (!signal?.aborted) setActions(result["items"] as CorporateActionView[]);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Не удалось загрузить задачи."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [request]);
  const attention = attentionActions(actions);
  const unknown = attention.filter(action => action.blockchainTransactions.some(tx => tx.status === "UNKNOWN_CONFIRMATION")).length;
  return <section className="surface-card task-queue" aria-label="Рабочие задачи">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
      <h2>Требует внимания</h2>
      <p className="text-sm text-[#65707a]">Последние {actions.length} загруженных действий · время {workspaceTimeZone()}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>Обновить задачи</button></div>
    {!busy && !error && actions.length > 0 && <div className="queue-summary"><span><strong>{unknown}</strong> с неизвестным результатом</span><span><strong>{attention.length}</strong> незавершённых в выборке</span><span>Показаны первые {Math.min(attention.length, 6)} · очередь ограничена выборкой</span></div>}
    {busy && actions.length === 0 && <RegistrySkeleton />}
    {!error && !busy && attention.length === 0 && <p className="empty-state">В загруженных записях нет открытых задач. Перейдите в реестр действий для создания или просмотра истории.</p>}
    <div className="task-queue-list">{attention.slice(0, 6).map(action => {
      const context = actionPresentation(action, administrator && action.instrument.issuerAuthority === walletAddress);
      return <button type="button" key={action.id} className="task-queue-item" onClick={() => onOpen(action.id)}>
        <span><strong>{action.instrument.ticker} · {ACTION_TYPES[action.type] ?? action.type}</strong><span className="block text-sm">{context.next}</span><span className="task-date">{context.pending?.status === "UNKNOWN_CONFIRMATION" ? "Результат отправки неизвестен · Фиксация: " : "Фиксация: "}{formatWorkspaceDate(action.recordAt)}</span></span>
        <span className={`status-${context.pending?.status === "UNKNOWN_CONFIRMATION" ? "wait" : statusTone(action.status)}`}>{context.pending?.status === "UNKNOWN_CONFIRMATION" ? "Проверить подпись" : ACTION_STATUSES[action.status] ?? action.status}</span><span aria-hidden="true">→</span>
      </button>;
    })}</div>
    {(busy || error) && <RequestNotice busy={busy} message="Загрузка задач…" error={error} onRetry={() => void load()} />}
  </section>;
}

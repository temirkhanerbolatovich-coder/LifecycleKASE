"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import { useEffect, useState } from "react";
import type { CorporateActionView } from "./action-workflow";
import { getActionStatuses, getActionTypes, actionPresentation, attentionActions, formatWorkspaceDate, workspaceTimeZone, statusTone } from "./workspace-presentation";
import { RegistrySkeleton, RequestNotice } from "./workspace-controls";

export function WorkspaceOverview({ request, onOpen, walletAddress, administrator, qaMode = false }: {
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onOpen: (id: string) => void; walletAddress: string; administrator: boolean; qaMode?: boolean;
}) {
  const { t, locale, displayMessage, formatAmount, formatDate } = useLocale();
  const TYPES = getActionTypes(locale), STATUS_LABELS = getActionStatuses(locale);
  const [actions, setActions] = useState<CorporateActionView[]>([]);
  const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  async function load(signal?: AbortSignal) {
    setBusy(true); setError(null);
    try {
      const result = await request("/api/v1/corporate-actions?limit=20", signal ? { signal } : undefined);
      if (!Array.isArray(result["items"])) throw new Error(t("core.the.api.did.not.return.work.items"));
      if (!signal?.aborted) setActions(result["items"] as CorporateActionView[]);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : t("core.could.not.load.work.items")); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [request]);
  const attention = attentionActions(actions);
  const unknown = attention.filter(action => action.blockchainTransactions.some(tx => tx.status === "UNKNOWN_CONFIRMATION")).length;
  return <section className="surface-card task-queue" aria-label={t("core.work.items")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
      <h2>{t("core.needs.attention")}</h2>
      <p className="text-sm text-[#65707a]">{t("core.latest")} {actions.length} {t("core.loaded.actions.time.zone")} {workspaceTimeZone()}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{t("core.refresh.work.items")}</button></div>
    {!busy && !error && actions.length > 0 && <div className="queue-summary"><span><strong>{unknown}</strong> {t("core.with.an.unknown.outcome")}</span><span><strong>{attention.length}</strong> {t("core.unfinished.in.this.selection")}</span><span>{t("core.showing.the.first")} {Math.min(attention.length, 6)} {t("core.queue.is.limited.to.loaded.records")}</span></div>}
    {busy && actions.length === 0 && <RegistrySkeleton />}
    {!error && !busy && attention.length === 0 && <p className="empty-state">{t("core.no.open.tasks.in.the.loaded.records.open.the.actions.registry.to.create")}</p>}
    <div className="task-queue-list">{attention.slice(0, 6).map(action => {
      const context = actionPresentation(action, administrator && action.instrument.issuerAuthority === walletAddress);
      return <button type="button" key={action.id} className="task-queue-item" onClick={() => onOpen(action.id)}>
        <span><strong>{action.instrument.ticker} · {TYPES[action.type] ?? action.type}</strong><span className="block text-sm">{qaMode ? t("core.continue.simulation.steps") : context.next}</span><span className="task-date">{context.pending?.status === "UNKNOWN_CONFIRMATION" ? t("core.submission.outcome.unknown.capture") : t("core.capture")}{formatDate(action.recordAt)}</span></span>
        <span className={`status-${context.pending?.status === "UNKNOWN_CONFIRMATION" ? "wait" : statusTone(action.status)}`}>{context.pending?.status === "UNKNOWN_CONFIRMATION" ? t("core.check.signature") : STATUS_LABELS[action.status] ?? action.status}</span><span aria-hidden="true">→</span>
      </button>;
    })}</div>
    {(busy || error) && <RequestNotice busy={busy} message={t("core.loading.work.items")} error={error} onRetry={() => void load()} />}
  </section>;
}

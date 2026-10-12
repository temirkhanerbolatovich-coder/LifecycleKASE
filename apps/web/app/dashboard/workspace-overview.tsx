"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import { useEffect, useRef, useState } from "react";
import type { CorporateActionView } from "./action-workflow";
import { getActionStatuses, getActionTypes, actionPresentation, attentionActions, formatWorkspaceDate, workspaceTimeZone, statusTone } from "./workspace-presentation";
import { RegistrySkeleton, RequestNotice } from "./workspace-controls";
import { overviewMessages } from "./overview-messages";
import { formatOverviewAmount, validatedOverviewSummary, type OverviewSummary } from "./overview-summary";

export function WorkspaceOverview({ request, onOpen, walletAddress, administrator, qaMode = false }: {
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onOpen: (id: string) => void; walletAddress: string; administrator: boolean; qaMode?: boolean;
}) {
  const { t, locale, displayMessage, formatAmount, formatDate } = useLocale();
  const TYPES = getActionTypes(locale), STATUS_LABELS = getActionStatuses(locale);
  const copy = overviewMessages(locale);
  const [actions, setActions] = useState<CorporateActionView[]>([]);
  const [summary, setSummary] = useState<OverviewSummary | null>(null);
  const loadVersion = useRef(0);
  const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  async function load(signal?: AbortSignal) {
    const version = ++loadVersion.current;
    setBusy(true); setError(null);
    try {
      const result = await request(qaMode ? "/api/v1/corporate-actions?limit=20" : "/api/v1/operator-overview", signal ? { signal } : undefined);
      if (signal?.aborted || version !== loadVersion.current) return;
      if (qaMode) {
        if (!Array.isArray(result["items"])) throw new Error(t("core.the.api.did.not.return.work.items"));
        setActions(result["items"] as CorporateActionView[]); setSummary(null);
      } else {
        const next = validatedOverviewSummary(result);
        setSummary(next); setActions(next.queue.items);
      }
    } catch (error) { if (!signal?.aborted && version === loadVersion.current) setError(error instanceof Error ? error.message : t("core.could.not.load.work.items")); }
    finally { if (!signal?.aborted && version === loadVersion.current) setBusy(false); }
  }
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort(); }, [request]);
  const attention = qaMode ? attentionActions(actions) : actions;
  const unknown = attention.filter(action => action.blockchainTransactions.some(tx => tx.status === "UNKNOWN_CONFIRMATION")).length;
  return <div className="space-y-4">
    {!qaMode && summary && <section className="surface-card" aria-label={copy.scope}>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ label: copy.active, value: summary.activeInstruments }, { label: copy.open, value: summary.openActions }, { label: copy.unknown, value: summary.unknownOperations }].map(metric =>
          <div key={metric.label} className="rounded-xl border border-[#dde5e1] p-4"><p className="text-sm text-[#52665f]">{metric.label}</p><strong className="mt-1 block text-3xl text-[#172a25]">{metric.value}</strong></div>)}
      </div>
      <p className="mt-3 text-xs text-[#52665f]">{copy.scope} · {summary.network === "SOLANA_LOCALNET" ? "Localnet" : "Devnet"} · {copy.updated} {formatDate(summary.asOf)}</p>
      <p className="mt-1 text-xs text-[#52665f]">{copy.period}: {formatDate(summary.period.from)} — {formatDate(summary.period.toExclusive)} · {workspaceTimeZone()}</p>
      {summary.assets.length === 0 && <p className="empty-state">{copy.noAssets}</p>}
      <div className="mt-3 grid gap-3 xl:grid-cols-2">{summary.assets.map(asset => <div key={asset.assetId} className="rounded-xl border border-[#dde5e1] p-4">
        <strong>{asset.code}</strong>{asset.isSimulated && <span className="ml-2 rounded bg-[#fff8e9] px-2 py-1 text-xs">{copy.simulatedAsset}</span>}
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm"><dt>{copy.payable}</dt><dd className="text-right font-semibold">{asset.payableMinor === null ? copy.noAmount : formatOverviewAmount(asset.payableMinor, asset.decimals, asset.code, locale)}</dd>
          <dt>{copy.paid}</dt><dd className="text-right">{asset.paidMinor === null ? copy.noAmount : formatOverviewAmount(asset.paidMinor, asset.decimals, asset.code, locale)}</dd>
          <dt>{copy.uncalculated}</dt><dd className="text-right">{asset.uncalculatedActions}</dd></dl>
        {asset.uncalculatedActions > 0 && <p className="mt-2 text-xs text-[#52665f]">{copy.partial}</p>}
      </div>)}</div>
      <p className="mt-3 text-xs text-[#52665f]">{copy.coverage}</p>
      {error && <p role="status" className="mt-2 text-sm text-[#765d38]">{copy.stale}</p>}
    </section>}
    <section className="surface-card task-queue" aria-label={t("core.work.items")}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
      <h2>{qaMode ? t("core.needs.attention") : copy.queue}</h2>
      <p className="text-sm text-[#65707a]">{qaMode ? <>{t("core.latest")} {actions.length} {t("core.loaded.actions.time.zone")} {workspaceTimeZone()}</> : <>{copy.bounded}: {actions.length} {copy.of} {summary?.queue.total ?? "—"}</>}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{t("core.refresh.work.items")}</button></div>
    {qaMode && !busy && !error && actions.length > 0 && <div className="queue-summary"><span><strong>{unknown}</strong> {t("core.with.an.unknown.outcome")}</span><span><strong>{attention.length}</strong> {t("core.unfinished.in.this.selection")}</span><span>{t("core.showing.the.first")} {Math.min(attention.length, 6)} {t("core.queue.is.limited.to.loaded.records")}</span></div>}
    {busy && actions.length === 0 && <RegistrySkeleton />}
    {!error && !busy && attention.length === 0 && <p className="empty-state">{qaMode ? t("core.no.open.tasks.in.the.loaded.records.open.the.actions.registry.to.create") : copy.empty}</p>}
    <div className="task-queue-list">{attention.slice(0, qaMode ? 6 : 7).map(action => {
      const context = actionPresentation(action, administrator && action.instrument.issuerAuthority === walletAddress);
      const hasUnknown = "hasUnknownConfirmation" in action && action.hasUnknownConfirmation === true || context.pending?.status === "UNKNOWN_CONFIRMATION";
      return <button type="button" key={action.id} className="task-queue-item" onClick={() => onOpen(action.id)}>
        <span><strong>{action.instrument.ticker} · {TYPES[action.type] ?? action.type}</strong><span className="block text-sm">{qaMode ? t("core.continue.simulation.steps") : hasUnknown ? copy.unknownNext : context.next}</span><span className="task-date">{hasUnknown ? t("core.submission.outcome.unknown.capture") : t("core.capture")}{formatDate(action.recordAt)}</span></span>
        <span className={`status-${hasUnknown ? "wait" : statusTone(action.status)}`}>{hasUnknown ? t("core.check.signature") : STATUS_LABELS[action.status] ?? action.status}</span><span aria-hidden="true">→</span>
      </button>;
    })}</div>
    {(busy || error) && <RequestNotice busy={busy} message={t("core.loading.work.items")} error={error === "OVERVIEW_RESPONSE_INVALID" ? copy.invalid : error} onRetry={() => void load()} />}
    </section>
  </div>;
}

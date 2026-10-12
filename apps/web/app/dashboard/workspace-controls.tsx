"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import { useState } from "react";
import type { RegistryFilters } from "./workspace-presentation";

export function RegistryToolbar({ label, filters, onChange, statuses, loaded, shown, sortLabel = "Название", serverSearch = false }: {
  label: string; filters: RegistryFilters; onChange: (value: RegistryFilters) => void; statuses: Record<string, string>;
  loaded: number; shown: number; sortLabel?: string; serverSearch?: boolean;
}) {
  const { t, locale, displayMessage } = useLocale();
  const displayedSortLabel = displayMessage(sortLabel);
  return <div className={`registry-toolbar${Object.keys(statuses).length ? "" : " registry-toolbar-no-status"}`}>
    <label>{t("core.search")} {label}<input type="search" value={filters.query} maxLength={serverSearch ? 200 : undefined} placeholder={t("core.name.code.or.uuid")} onChange={event => onChange({ ...filters, query: event.target.value })} /></label>
    {Object.keys(statuses).length > 0 && <label>{t("core.status")}<select value={filters.status} onChange={event => onChange({ ...filters, status: event.target.value })}>
      <option value="">{t("core.all.statuses")}</option>{Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
      </label>}
    <label>{t("core.sort")}<select value={filters.sort} onChange={event => onChange({ ...filters, sort: event.target.value })}><option value="asc">{displayedSortLabel === t("core.date") ? t("core.oldest.first") : `${displayedSortLabel} ↑`}</option><option value="desc">{displayedSortLabel === t("core.date") ? t("core.newest.first") : `${displayedSortLabel} ↓`}</option></select></label>
    <div className="registry-scope"><p aria-live="polite">{t("core.showing")} {shown} {t("core.of")} {loaded} {serverSearch ? t("registry.investor.serverSearchScope") : t("core.loaded.records.search.and.filters.apply.to.this.selection")}</p>
      {(filters.query || filters.status) && <button type="button" className="filter-reset" onClick={() => onChange({ ...filters, query: "", status: "" })}>{t("core.reset.filters")}</button>}
    </div>
  </div>;
}
export function RequestNotice({ busy, message, error, onRetry }: { busy: boolean; message: string; error?: string | null; onRetry?: () => void }) {
  const { t, locale, displayMessage } = useLocale();
  if (!busy && !error && !message) return null;
  return <div className={`request-notice ${error ? "request-notice-error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-busy={busy}>
    <p>{busy ? t("core.request.in.progress") : displayMessage(error || message)}</p>
    {error && onRetry && <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>{t("core.refresh.data")}</button>}
    {error && <p className="notice-hint">{t("core.your.input.is.preserved.for.a.submission.request.check.the.original.attempt.and")}</p>}
  </div>;
}

/** Full identifiers remain selectable even when clipboard access is denied. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const { t, locale, displayMessage } = useLocale();
  const [result, setResult] = useLocalizedTextState();
  async function copy() {
    try { await navigator.clipboard.writeText(value); setResult(t("core.copied")); }
    catch { setResult(t("core.could.not.copy.select.the.value.manually")); }
  }
  return <span className="copy-value"><span className="technical-id">{value}</span>
    <button type="button" className="copy-button" aria-label={t("core.copyLabel", { label })} onClick={() => void copy()}>{t("core.copy")}</button>
    <span className="copy-result" role="status">{result}</span>
  </span>;
}

export function RegistrySkeleton() {
  const { t, locale, displayMessage } = useLocale();
  return <div className="registry-skeleton" role="status" aria-label={t("core.loading.records")} aria-busy="true">
    {[0, 1, 2].map(row => <div key={row} aria-hidden="true"><span /><span /><span /></div>)}
    <span className="sr-only">{t("core.loading.records.2")}</span>
  </div>;
}

export function DetailTabs({ tabs, selected, onChange, idPrefix }: { tabs: { id: string; label: string }[]; selected: string; onChange: (id: string) => void; idPrefix: string }) {
  const { t, locale, displayMessage } = useLocale();
  return <div className="detail-tabs" role="tablist" aria-label={t("core.detail.sections")}>
    {tabs.map((tab, index) => <button key={tab.id} id={`${idPrefix}-${tab.id}-tab`} aria-controls={`${idPrefix}-${tab.id}`} type="button" role="tab" aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)} onKeyDown={event => {
        const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (target === null) return;
        event.preventDefault(); onChange(tabs[target]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[target]?.focus();
      }}>{tab.label}</button>)}
  </div>;
}

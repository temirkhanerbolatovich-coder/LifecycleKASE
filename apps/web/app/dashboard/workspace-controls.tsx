"use client";
import { useState } from "react";
import type { RegistryFilters } from "./workspace-presentation";

export function RegistryToolbar({ label, filters, onChange, statuses, loaded, shown, sortLabel = "Название" }: {
  label: string; filters: RegistryFilters; onChange: (value: RegistryFilters) => void; statuses: Record<string, string>;
  loaded: number; shown: number; sortLabel?: string;
}) {
  return <div className={`registry-toolbar${Object.keys(statuses).length ? "" : " registry-toolbar-no-status"}`}>
    <label>Поиск: {label}<input type="search" value={filters.query} placeholder="Название, код или UUID" onChange={event => onChange({ ...filters, query: event.target.value })} /></label>
    {Object.keys(statuses).length > 0 && <label>Статус<select value={filters.status} onChange={event => onChange({ ...filters, status: event.target.value })}>
      <option value="">Все статусы</option>{Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
      </label>}
    <label>Сортировка<select value={filters.sort} onChange={event => onChange({ ...filters, sort: event.target.value })}><option value="asc">{sortLabel === "Дата" ? "Сначала старые" : `${sortLabel} ↑`}</option><option value="desc">{sortLabel === "Дата" ? "Сначала новые" : `${sortLabel} ↓`}</option></select></label>
    <div className="registry-scope"><p aria-live="polite">Показано {shown} из {loaded} загруженных записей · поиск и фильтры в этой выборке</p>
      {(filters.query || filters.status) && <button type="button" className="filter-reset" onClick={() => onChange({ ...filters, query: "", status: "" })}>Сбросить фильтры</button>}
    </div>
  </div>;
}
export function RequestNotice({ busy, message, error, onRetry }: { busy: boolean; message: string; error?: string | null; onRetry?: () => void }) {
  if (!busy && !error && !message) return null;
  return <div className={`request-notice ${error ? "request-notice-error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-busy={busy}>
    <p>{busy ? "Выполняется запрос…" : error || message}</p>
    {error && onRetry && <button type="button" className="secondary-button" disabled={busy} onClick={onRetry}>Обновить данные</button>}
    {error && <p className="notice-hint">Введённые значения сохранены. Если запрос связан с отправкой, проверьте исходную попытку и подпись; повторной отправки здесь нет.</p>}
  </div>;
}

/** Full identifiers remain selectable even when clipboard access is denied. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(value); setResult("Скопировано"); }
    catch { setResult("Не удалось скопировать. Выделите значение вручную."); }
  }
  return <span className="copy-value"><span className="technical-id">{value}</span>
    <button type="button" className="copy-button" aria-label={`Копировать: ${label}`} onClick={() => void copy()}>Копировать</button>
    <span className="copy-result" role="status">{result}</span>
  </span>;
}

export function RegistrySkeleton() {
  return <div className="registry-skeleton" role="status" aria-label="Загрузка записей" aria-busy="true">
    {[0, 1, 2].map(row => <div key={row} aria-hidden="true"><span /><span /><span /></div>)}
    <span className="sr-only">Загрузка записей…</span>
  </div>;
}

export function DetailTabs({ tabs, selected, onChange, idPrefix }: { tabs: { id: string; label: string }[]; selected: string; onChange: (id: string) => void; idPrefix: string }) {
  return <div className="detail-tabs" role="tablist" aria-label="Разделы карточки">
    {tabs.map((tab, index) => <button key={tab.id} id={`${idPrefix}-${tab.id}-tab`} aria-controls={`${idPrefix}-${tab.id}`} type="button" role="tab" aria-selected={selected === tab.id} tabIndex={selected === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)} onKeyDown={event => {
        const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (target === null) return;
        event.preventDefault(); onChange(tabs[target]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[target]?.focus();
      }}>{tab.label}</button>)}
  </div>;
}

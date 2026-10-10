"use client";
import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { actionTimeUtc, futureLocalTime, type CorporateActionView } from "./action-workflow";
import { isActionId } from "./snapshot-workflow";
import { OperatorApiError } from "./operator-api";
import { CorporateActionDetail } from "./corporate-action-detail";
import { ACTION_TYPES as TYPES, ACTION_STATUSES as STATUS_LABELS, filterRegistry, INITIAL_FILTERS, statusTone, actionPresentation, formatWorkspaceDate, workspaceTimeZone } from "./workspace-presentation";
import { RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { workspaceSelectionFromHash, workspaceSectionHash } from "./workspace-navigation";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type ActiveInstrument = { id: string; name: string; ticker: string; status: string; issuerAuthority: string };
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const date = formatWorkspaceDate;


export function CorporateActionPanel({ role, request, wallet, walletAddress, onBusyChange }: {role: string; request: Request; wallet: Wallet | undefined; walletAddress: string; onBusyChange: (busy: boolean) => void}) {
  const [items, setItems] = useState<CorporateActionView[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<ActiveInstrument[]>([]);
  const [selectedId, setSelectedId] = useState(""); const [opened, setOpened] = useState<Record<string, CorporateActionView>>({});
  const [filters, setFilters] = useState(INITIAL_FILTERS); const [type, setType] = useState("COUPON_PAYMENT");
  const [recordAt, setRecordAt] = useState(() => futureLocalTime(5)); const [executeAt, setExecuteAt] = useState(() => futureLocalTime(15));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null); const [pendingDraftId, setPendingDraftId] = useState("");
  const pendingDraft = useRef<Record<string, unknown> | null>(null); const inFlight = useRef(false);
  const listView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      if (selectedId) document.getElementById(`action-${selectedId}`)?.focus({ preventScroll: true });
      else listView.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    });
  }, [selectedId]);
  const listPosition = useRef(0); const chosen = useRef(""); const administrator = role === "ADMINISTRATOR";
  // Each visited detail stays mounted. Its exact plan/signature survives returning to the list.
  function rememberAction(action: CorporateActionView) { setOpened(previous => ({...previous,[action.id]:action})); setSelectedId(action.id); chosen.current = action.id; window.history.replaceState(null,"",workspaceSectionHash("actions",action.id)); }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null); onBusyChange(true);
    try { await task(); } catch(error) { setError(error instanceof Error ? error.message : "Не удалось выполнить запрос."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(cursor?: string) {
    const result = await request(`/api/v1/corporate-actions?limit=20${cursor ? "&cursor="+encodeURIComponent(cursor):""}`);
    if (!Array.isArray(result["items"])) throw new Error("API не вернул список действий.");
    setItems(previous => cursor ? [...previous,...result["items"] as CorporateActionView[]] : result["items"] as CorporateActionView[]);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
  }
  async function openAction(id: string) { const action = await request("/api/v1/corporate-actions/"+id); if (action["id"] !== id) throw new Error("API вернул другое действие."); rememberAction(action as unknown as CorporateActionView); }
  function backToList() { setSelectedId(""); chosen.current=""; window.history.replaceState(null,"",workspaceSectionHash("actions")); requestAnimationFrame(()=>window.scrollTo({top:listPosition.current,behavior:"instant"})); }
  useEffect(()=> {
    const sync = () => { const id = workspaceSelectionFromHash(window.location.hash,"actions"); if (id && id !== chosen.current) void run(()=>openAction(id)); };
    void run(async()=>{await load(); const result=await request("/api/v1/instruments?limit=100"); const rows=Array.isArray(result["items"])?result["items"] as ActiveInstrument[]:[]; setInstruments(rows.filter(row=>row.status==="ACTIVE"&&row.issuerAuthority===walletAddress)); const id=workspaceSelectionFromHash(window.location.hash,"actions"); if(id) await openAction(id); setMessage("");});
    window.addEventListener("hashchange",sync); return ()=>window.removeEventListener("hashchange",sync);
  },[request,walletAddress]);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(async () => {
      if (!pendingDraft.current) {
        const id = crypto.randomUUID();
        pendingDraft.current = { requestId: id, instrumentId: form.get("instrumentId"), type,
          intent: form.get("intent"), sourceType: form.get("sourceType"), sourceReference: form.get("sourceReference") || null,
          sourceDocument: form.get("sourceDocument") || null, recordAt: actionTimeUtc(recordAt), executeAt: actionTimeUtc(executeAt),
          ...(type === "EARLY_REDEMPTION" ? { redemptionPercentageBps: Number(form.get("redemptionPercentageBps")), redemptionPriceKzt: form.get("redemptionPriceKzt") } : {}) };
        setPendingDraftId(id);
      }
      let response;
      try { response = await request("/api/v1/corporate-actions", { method: "POST", body: JSON.stringify(pendingDraft.current) }); }
      catch (error) {
        if (error instanceof OperatorApiError && (error.status === 400 || error.code === "ACTION_RECORD_TOO_SOON")) {
          pendingDraft.current = null; setPendingDraftId("");
        }
        throw error;
      }
      if (typeof response["id"] !== "string" || !isActionId(response["id"])) throw new Error("API не вернул UUID действия.");
      pendingDraft.current = null; setPendingDraftId("");
      rememberAction(response as unknown as CorporateActionView);
      setMessage("Черновик создан. Проверьте условия и подготовьте планирование; DRAFT ещё не в сети.");
      try { await load(); }
      catch { setMessage("Черновик создан и открыт. Список не обновился — обновите данные, не создавайте действие повторно."); }
    });
  }

  const visible = filterRegistry(items,filters,row=>[row.instrument.ticker,row.intent,TYPES[row.type]??row.type,row.id].join(" "),row=>row.status,row=>row.recordAt);
  return <section aria-label="Корпоративные действия">
    <div className="registry-heading" hidden={Boolean(selectedId)}>
      <div>
      <h3>Реестр действий</h3>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await load();if(selectedId)await openAction(selectedId);})}>Обновить действия</button>
      </div>
    <div ref={listView} hidden={Boolean(selectedId)}>
    {administrator && <details className="advanced-details mt-4">
      <summary className="cursor-pointer text-sm font-semibold">Создать корпоративное действие</summary>
      <form className="mt-4" onSubmit={create}>
        <fieldset disabled={busy || Boolean(pendingDraftId)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">Активный инструмент *<select required name="instrumentId" className={inputClass} defaultValue="">
            <option value="" disabled>Выберите инструмент своего issuer-кошелька</option>{instruments.map(row => <option key={row.id} value={row.id}>{row.ticker} · {row.name}</option>)}</select></label>
          <label className="text-sm">Тип<select className={inputClass} value={type} onChange={event => setType(event.target.value)}>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">Источник<select name="sourceType" className={inputClass} defaultValue="MANUAL">
      <option value="MANUAL">Ручное действие</option>
      <option value="ISSUER_INSTRUCTION">Поручение эмитента</option>
      <option value="EXCHANGE_EVENT">Биржевое событие</option>
      <option value="EXTERNAL_API">Внешний источник</option>
      <option value="SYSTEM">Системное правило</option>
      </select>
      </label>
          <label className="text-sm sm:col-span-2">Основание *<textarea name="intent" required minLength={3} maxLength={500} placeholder="Купон за второй период по поручению эмитента" className={inputClass} /></label>
          <label className="text-sm">Ссылка на источник<input name="sourceReference" maxLength={250} className={inputClass} /></label>
          <label className="text-sm">Документ / описание<input name="sourceDocument" maxLength={500} className={inputClass} /></label>
          <label className="text-sm">Дата фиксации * · {workspaceTimeZone()}<input required type="datetime-local" className={inputClass} value={recordAt} onChange={event => setRecordAt(event.target.value)} /></label>
          <label className="text-sm">Дата исполнения * · {workspaceTimeZone()}<input required type="datetime-local" className={inputClass} value={executeAt} onChange={event => setExecuteAt(event.target.value)} /></label>
          {type === "EARLY_REDEMPTION" && <><label className="text-sm">Доля · bps (2000 = 20%)<input name="redemptionPercentageBps" type="number" min={1} max={10000} step={1} defaultValue={2000} required className={inputClass} /></label>
            <label className="text-sm">Цена одного bond · KZT-Test<input name="redemptionPriceKzt" inputMode="decimal" defaultValue="1000" required className={inputClass} /></label></>}
        </fieldset>
        <p className="mt-3 text-xs text-[#61746a]">До record date при подготовке плана должно оставаться минимум 60 секунд. Окно регистрации snapshot — до 5 минут после record date. Время передаётся в UTC.</p>
        <button type="button" disabled={busy || Boolean(pendingDraftId)} className={`mt-3 ${buttonClass}`} onClick={() => { setRecordAt(futureLocalTime(5)); setExecuteAt(futureLocalTime(15)); }}>Фиксация через 5 минут, исполнение через 15</button>
        <button type="submit" disabled={busy || instruments.length === 0} className="primary-button ml-2 mt-3">{pendingDraftId ? "Повторить сохранённый запрос" : "Создать черновик"}</button>
        <button type="button" disabled={busy || Boolean(pendingDraftId)} className="secondary-button ml-2 mt-3" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Отмена</button>
        {instruments.length === 0 && <p className="access-note mt-2">Нужен активный инструмент текущего issuer-кошелька. Проверьте выпуск в разделе «Инструменты».</p>}
        {error && <p role="alert" className="form-error">{error} Значения сохранены.</p>}
        {pendingDraftId && <p className="mt-2 break-all text-xs">UUID запроса: {pendingDraftId}. Повтор использует те же условия и не создаёт второе действие.</p>}
      </form>
    </details>}

    {!administrator && <p className="access-note">Режим аудитора: просмотр условий, статусов и доказательств.</p>}
    <RegistryToolbar label="действия" filters={filters} onChange={setFilters} statuses={STATUS_LABELS} loaded={items.length} shown={visible.length} sortLabel="Дата фиксации" />
    {busy && items.length === 0 && <RegistrySkeleton />}
    <div className="table-scroll" hidden={items.length === 0} tabIndex={0} role="region" aria-label="Таблица действий">
      <table className="registry-table">
      <thead>
      <tr>
      <th>Инструмент / действие</th>
      <th>Статус</th>
      <th>Дата фиксации</th>
      <th>Исполнение</th>
      <th>Следующий шаг</th>
      </tr>
      </thead>
      <tbody>{visible.map(action=>
      <tr key={action.id}>
      <td>
      <button type="button" className="table-object-link" disabled={busy} onClick={() => { listPosition.current = window.scrollY; void run(() => openAction(action.id)); }}>{action.instrument.ticker}</button>
      <span className="table-secondary">{TYPES[action.type]??action.type}</span>
      <span className="table-secondary truncate-intent" title={action.intent}>{action.intent}</span>
      </td>
      <td>
      <span className={"status-"+statusTone(action.status)}>{STATUS_LABELS[action.status]??action.status}</span>
      </td>
      <td>{date(action.recordAt)}</td>
      <td>{date(action.executeAt)}</td>
      <td>
      <span className="table-secondary">{actionPresentation(action, administrator && action.instrument.issuerAuthority === walletAddress).next}</span>
      </td>
      </tr>)}</tbody>
      </table>
      </div>
    {!busy && !error && visible.length===0 && <p className="empty-state">{items.length===0?"Действий пока нет. Администратор может создать черновик на активном инструменте.":"По этим условиям ничего не найдено. Измените поиск или статус."}</p>}
    {nextCursor&&<button type="button" className="secondary-button mt-3" disabled={busy} onClick={()=>void run(()=>load(nextCursor))}>Показать ещё действия</button>}
    </div>
    {Object.values(opened).map(action=>
      <div key={action.id} hidden={selectedId!==action.id}>
      <CorporateActionDetail action={action} role={role} request={request} wallet={wallet} walletAddress={walletAddress} onBusyChange={value => { setBusy(value); onBusyChange(value); }} onBack={backToList} onReload={async()=>{await openAction(action.id);await load();}} />
      </div>)}
    <RequestNotice busy={busy} message={message} error={error} onRetry={()=>void run(()=>load())} />
  </section>;
}

"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { actionTimeUtc, earlyRedemptionDraftTerms, futureLocalTime, type CorporateActionView, type RedemptionAllocationPolicy } from "./action-workflow";
import { isActionId } from "./snapshot-workflow";
import { OperatorApiError } from "./operator-api";
import { CorporateActionDetail } from "./corporate-action-detail";
import { getActionTypes, getActionStatuses, filterRegistry, INITIAL_FILTERS, statusTone, actionPresentation, formatWorkspaceDate, workspaceTimeZone } from "./workspace-presentation";
import { RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { workspaceSelectionFromHash, workspaceSectionFromHash, workspaceSectionHash } from "./workspace-navigation";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type ActiveInstrument = { id: string; name: string; ticker: string; status: string; issuerAuthority: string };
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";



export function CorporateActionPanel({ role, request, wallet, walletAddress, onBusyChange, renderQaControls }: {role: string; request: Request; wallet: Wallet | undefined; walletAddress: string; onBusyChange: (busy: boolean) => void;
  renderQaControls?: ((action: CorporateActionView, onChanged: () => Promise<void>) => ReactNode) | undefined }) {
  const { t, locale, displayMessage, formatAmount, formatDate } = useLocale();
  const TYPES = getActionTypes(locale), STATUS_LABELS = getActionStatuses(locale);
  const [items, setItems] = useState<CorporateActionView[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<ActiveInstrument[]>([]);
  const [selectedId, setSelectedId] = useState(""); const [opened, setOpened] = useState<Record<string, CorporateActionView>>({});
  const [filters, setFilters] = useState(INITIAL_FILTERS); const [type, setType] = useState("COUPON_PAYMENT");
  const [redemptionPolicy, setRedemptionPolicy] = useState<RedemptionAllocationPolicy>(renderQaControls ? "exact-target-largest-remainder-v2" : "integer-entitlements-v1");
  const [recordAt, setRecordAt] = useState(() => futureLocalTime(5)); const [executeAt, setExecuteAt] = useState(() => futureLocalTime(15));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useLocalizedTextState("");
  const [error, setError] = useState<string | null>(null); const [pendingDraftId, setPendingDraftId] = useState("");
  const pendingDraft = useRef<Record<string, unknown> | null>(null); const inFlight = useRef(false);
  const listView = useRef<HTMLDivElement>(null);
  const openedRef = useRef<Record<string, CorporateActionView>>({});
  useEffect(() => {
    requestAnimationFrame(() => {
      if (selectedId) document.getElementById(`action-${selectedId}`)?.focus({ preventScroll: true });
      else listView.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    });
  }, [selectedId]);
  const listPosition = useRef(0); const chosen = useRef(""); const administrator = role === "ADMINISTRATOR";
  // Each visited detail stays mounted. Its exact plan/signature survives returning to the list.
  function rememberAction(action: CorporateActionView) {
    openedRef.current = { ...openedRef.current, [action.id]: action };
    setOpened(previous => ({...previous,[action.id]:action})); setSelectedId(action.id); chosen.current = action.id;
    if (workspaceSelectionFromHash(window.location.hash, "actions") !== action.id) window.history.pushState(null,"",workspaceSectionHash("actions",action.id));
  }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null); onBusyChange(true);
    try { await task(); } catch(error) { setError(error instanceof Error ? error.message : t("core.request.failed")); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(cursor?: string) {
    const result = await request(`/api/v1/corporate-actions?limit=20${cursor ? "&cursor="+encodeURIComponent(cursor):""}`);
    if (!Array.isArray(result["items"])) throw new Error(t("core.the.api.did.not.return.an.action.list"));
    setItems(previous => cursor ? [...previous,...result["items"] as CorporateActionView[]] : result["items"] as CorporateActionView[]);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
  }
  async function openAction(id: string) { const action = await request("/api/v1/corporate-actions/"+id); if (action["id"] !== id) throw new Error(t("core.the.api.returned.a.different.action")); rememberAction(action as unknown as CorporateActionView); }
  function backToList() { setSelectedId(""); chosen.current=""; window.history.pushState(null,"",workspaceSectionHash("actions")); requestAnimationFrame(()=>window.scrollTo({top:listPosition.current,behavior:"instant"})); }
  useEffect(()=> {
    const sync = () => {
      if (workspaceSectionFromHash(window.location.hash) !== "actions") return;
      const id = workspaceSelectionFromHash(window.location.hash,"actions");
      if (!id) { setSelectedId(""); chosen.current = ""; return; }
      if (id !== chosen.current) {
        const retained = openedRef.current[id];
        if (retained) { setSelectedId(id); chosen.current = id; } else void run(()=>openAction(id));
      }
    };
    void run(async()=>{await load(); const result=await request("/api/v1/instruments?limit=100"); const rows=Array.isArray(result["items"])?result["items"] as ActiveInstrument[]:[]; setInstruments(rows.filter(row=>row.status==="ACTIVE"&&row.issuerAuthority===walletAddress)); const id=workspaceSelectionFromHash(window.location.hash,"actions"); if(id) await openAction(id); setMessage("");});
    window.addEventListener("hashchange",sync); window.addEventListener("popstate",sync);
    return ()=>{ window.removeEventListener("hashchange",sync); window.removeEventListener("popstate",sync); };
  },[request,walletAddress]);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void run(async () => {
      if (!pendingDraft.current) {
        const id = crypto.randomUUID();
        pendingDraft.current = { requestId: id, instrumentId: form.get("instrumentId"), type,
          intent: form.get("intent"), sourceType: form.get("sourceType"), sourceReference: form.get("sourceReference") || null,
          sourceDocument: form.get("sourceDocument") || null, recordAt: actionTimeUtc(recordAt), executeAt: actionTimeUtc(executeAt),
          ...(type === "EARLY_REDEMPTION" ? earlyRedemptionDraftTerms(redemptionPolicy, { percentageBps: form.get("redemptionPercentageBps"),
            targetTokens: form.get("redemptionTargetTokens"), priceKzt: form.get("redemptionPriceKzt") }) : {}) };
        setPendingDraftId(id);
      }
      let response;
      try { response = await request("/api/v1/corporate-actions", { method: "POST", body: JSON.stringify(pendingDraft.current) }); }
      catch (error) {
        if (error instanceof OperatorApiError && (error.status === 400 || error.code === "ACTION_RECORD_TOO_SOON" || error.code === "EXACT_TARGET_REDEMPTION_DISABLED")) {
          pendingDraft.current = null; setPendingDraftId("");
        }
        if (error instanceof OperatorApiError && error.code === "EXACT_TARGET_REDEMPTION_DISABLED") throw new Error(t("financial.redemption.exact.disabled"));
        throw error;
      }
      if (typeof response["id"] !== "string" || !isActionId(response["id"])) throw new Error(t("core.the.api.did.not.return.an.action.uuid"));
      pendingDraft.current = null; setPendingDraftId("");
      rememberAction(response as unknown as CorporateActionView);
      setMessage(t("core.draft.created.review.its.terms.and.prepare.scheduling.draft.is.not.on.chain"));
      try { await load(); }
      catch { setMessage(t("core.draft.created.and.opened.the.list.did.not.refresh.refresh.the.data.without")); }
    });
  }

  const visible = filterRegistry(items,filters,row=>[row.instrument.ticker,row.intent,TYPES[row.type]??row.type,row.id].join(" "),row=>row.status,row=>row.recordAt);
  return <section aria-label={t("core.corporate.actions")}>
    <div className="registry-heading" hidden={Boolean(selectedId)}>
      <div>
      <h3>{t("core.action.registry")}</h3>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{await load();if(selectedId)await openAction(selectedId);})}>{t("core.refresh.actions")}</button>
      </div>
    <div ref={listView} hidden={Boolean(selectedId)}>
    {administrator && <details className="advanced-details mt-4">
      <summary className="cursor-pointer text-sm font-semibold">{t("core.create.corporate.action")}</summary>
      <form className="mt-4" onSubmit={create}>
        <fieldset disabled={busy || Boolean(pendingDraftId)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">{t("core.active.instrument")}<select required name="instrumentId" className={inputClass} defaultValue="">
            <option value="" disabled>{t("core.select.an.instrument.issued.by.your.wallet")}</option>{instruments.map(row => <option key={row.id} value={row.id}>{row.ticker} · {row.name}</option>)}</select></label>
          <label className="text-sm">{t("core.type")}<select className={inputClass} value={type} onChange={event => setType(event.target.value)}>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">{t("core.source")}<select name="sourceType" className={inputClass} defaultValue="MANUAL">
      <option value="MANUAL">{t("core.manual.action")}</option>
      <option value="ISSUER_INSTRUCTION">{t("core.issuer.instruction")}</option>
      <option value="EXCHANGE_EVENT">{t("core.exchange.event")}</option>
      <option value="EXTERNAL_API">{t("core.external.source")}</option>
      <option value="SYSTEM">{t("core.system.rule")}</option>
      </select>
      </label>
          <label className="text-sm sm:col-span-2">{t("core.purpose")}<textarea name="intent" required minLength={3} maxLength={500} placeholder={t("core.second.period.coupon.per.issuer.instruction")} className={inputClass} /></label>
          <label className="text-sm">{t("core.source.reference")}<input name="sourceReference" maxLength={250} className={inputClass} /></label>
          <label className="text-sm">{t("core.document.description")}<input name="sourceDocument" maxLength={500} className={inputClass} /></label>
          <label className="text-sm">{t("core.planned.record.date")} {workspaceTimeZone()}<input required type="datetime-local" className={inputClass} value={recordAt} onChange={event => setRecordAt(event.target.value)} /></label>
          <label className="text-sm">{t("core.execution.date")} {workspaceTimeZone()}<input required type="datetime-local" className={inputClass} value={executeAt} onChange={event => setExecuteAt(event.target.value)} /></label>
          {type === "EARLY_REDEMPTION" && <><label className="text-sm sm:col-span-2">{t("financial.redemption.allocation.method")}<select className={inputClass} value={redemptionPolicy} onChange={event => setRedemptionPolicy(event.target.value as RedemptionAllocationPolicy)}>
              <option value="integer-entitlements-v1">{t("financial.redemption.legacy.option")}</option><option value="exact-target-largest-remainder-v2">{t("financial.redemption.exact.option")}</option></select></label>
            {redemptionPolicy === "exact-target-largest-remainder-v2" ? <label className="text-sm">{t("financial.redemption.target.tokens")}<input name="redemptionTargetTokens" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={19} defaultValue="7" required className={inputClass} /></label> :
              <label className="text-sm">{t("core.share.bps.2000.20")}<input name="redemptionPercentageBps" type="number" min={1} max={10000} step={1} defaultValue={2000} required className={inputClass} /></label>}
            <label className="text-sm">{t("core.price.per.bond.kzt.test")}<input name="redemptionPriceKzt" inputMode="decimal" defaultValue="1000" required className={inputClass} /></label></>}
        </fieldset>
        {type === "EARLY_REDEMPTION" && redemptionPolicy === "exact-target-largest-remainder-v2" && <p className="access-note mt-2">{t("financial.redemption.exact.draft.help")} {!renderQaControls && t("financial.redemption.exact.gate.help")}</p>}
        <p className="mt-3 text-xs text-[#61746a]">{t("core.the.planned.record.date.must.be.at.least.60.seconds.away.when.preparing")}</p>
        <button type="button" disabled={busy || Boolean(pendingDraftId)} className={`mt-3 ${buttonClass}`} onClick={() => { setRecordAt(futureLocalTime(5)); setExecuteAt(futureLocalTime(15)); }}>{t("core.capture.in.5.minutes.execute.in.15")}</button>
        <button type="submit" disabled={busy || instruments.length === 0} className="primary-button ml-2 mt-3">{pendingDraftId ? t("core.retry.the.saved.request") : t("core.create.draft")}</button>
        <button type="button" disabled={busy || Boolean(pendingDraftId)} className="secondary-button ml-2 mt-3" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{t("core.cancel")}</button>
        {instruments.length === 0 && <p className="access-note mt-2">{t("core.an.active.instrument.for.the.current.issuer.wallet.is.required.check.issuance.in")}</p>}
        {error && <p role="alert" className="form-error">{displayMessage(error)} {t("core.values.preserved")}</p>}
        {pendingDraftId && <p className="mt-2 break-all text-xs">{t("core.request.uuid")} {pendingDraftId}{t("core.retrying.uses.the.same.terms.and.does.not.create.a.second.action")}</p>}
      </form>
    </details>}

    {!administrator && <p className="access-note">{t("core.auditor.mode.read.terms.statuses.and.evidence")}</p>}
    <RegistryToolbar label={t("core.actions")} filters={filters} onChange={setFilters} statuses={STATUS_LABELS} loaded={items.length} shown={visible.length} sortLabel={t("core.planned.record.date.2")} />
    {busy && items.length === 0 && <RegistrySkeleton />}
    <div className="table-scroll" hidden={items.length === 0} tabIndex={0} role="region" aria-label={t("core.action.table")}>
      <table className="registry-table">
      <thead>
      <tr>
      <th>{t("core.instrument.action")}</th>
      <th>{t("core.status")}</th>
      <th>{t("core.planned.record.date.2")}</th>
      <th>{t("core.execution")}</th>
      <th>{t("core.next.step")}</th>
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
      <td>{formatDate(action.recordAt)}</td>
      <td>{formatDate(action.executeAt)}</td>
      <td>
      <span className="table-secondary">{renderQaControls ? action.status === "FINALIZED" ? t("core.review.simulation.result") : ["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"].includes(action.status) ? t("core.review.stopped.scenario") : t("core.continue.simulation.steps") : actionPresentation(action, administrator && action.instrument.issuerAuthority === walletAddress).next}</span>
      </td>
      </tr>)}</tbody>
      </table>
      </div>
    {!busy && !error && visible.length===0 && <p className="empty-state">{items.length===0?t("core.no.actions.yet.an.administrator.can.create.a.draft.for.an.active.instrument"):t("core.no.matches.change.the.search.or.status")}</p>}
    {nextCursor&&<button type="button" className="secondary-button mt-3" disabled={busy} onClick={()=>void run(()=>load(nextCursor))}>{t("core.load.more.actions")}</button>}
    </div>
    {Object.values(opened).map(action=>
      <div key={action.id} hidden={selectedId!==action.id}>
      {renderQaControls?.(action, async () => { await openAction(action.id); await load(); })}
      <CorporateActionDetail action={action} qaMode={Boolean(renderQaControls)} role={renderQaControls ? "AUDITOR" : role} request={request} wallet={wallet} walletAddress={walletAddress} onBusyChange={value => { setBusy(value); onBusyChange(value); }} onBack={backToList} onReload={async()=>{await openAction(action.id);await load();}} />
      </div>)}
    <RequestNotice busy={busy} message={message} error={error} onRetry={()=>void run(()=>load())} />
  </section>;
}

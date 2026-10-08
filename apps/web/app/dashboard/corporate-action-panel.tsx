"use client";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { actionTimeUtc, futureLocalTime, preparedActionPlan, type CorporateActionView, type PreparedAction } from "./action-workflow";
import { SnapshotPanel } from "./snapshot-panel";
import { EntitlementPanel } from "./entitlement-panel";
import { CouponFundingPanel } from "./coupon-funding-panel";
import { isActionId, requireFinalizedResponse, resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { OperatorApiError } from "./operator-api";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type ActiveInstrument = { id: string; name: string; ticker: string; status: string; issuerAuthority: string };
const TYPES: Record<string, string> = { COUPON_PAYMENT: "Купон", BOND_REDEMPTION: "Погашение по сроку", EARLY_REDEMPTION: "Досрочное погашение" };
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const date = (value: string) => new Date(value).toLocaleString("ru-RU");

export function CorporateActionPanel({ role, request, wallet, walletAddress, onBusyChange }: {
  role: string; request: Request; wallet: Wallet | undefined; walletAddress: string; onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<CorporateActionView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [instruments, setInstruments] = useState<ActiveInstrument[]>([]);
  const [selected, setSelected] = useState<CorporateActionView | null>(null);
  const [type, setType] = useState("COUPON_PAYMENT");
  const [recordAt, setRecordAt] = useState(() => futureLocalTime(5));
  const [executeAt, setExecuteAt] = useState(() => futureLocalTime(15));
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<PreparedAction | null>(null);
  const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Загрузка корпоративных действий…");
  const [pendingDraftId, setPendingDraftId] = useState("");
  const pendingDraft = useRef<Record<string, unknown> | null>(null);
  const inFlight = useRef(false);
  const administrator = role === "ADMINISTRATOR";
  const canWrite = administrator && selected?.instrument.issuerAuthority === walletAddress;

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Операция действия не выполнена."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load(cursor?: string) {
    const response = await request(`/api/v1/corporate-actions?limit=20${cursor ? `&cursor=${cursor}` : ""}`);
    if (!Array.isArray(response["items"])) throw new Error("API не вернул список действий.");
    const rows = response["items"] as CorporateActionView[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof response["nextCursor"] === "string" ? response["nextCursor"] : null);
  }
  async function openAction(id: string) {
    const response = await request(`/api/v1/corporate-actions/${id}`);
    const action = response as unknown as CorporateActionView;
    setSelected(action);
    const pendingCancel = action.blockchainTransactions.find(tx => tx.operationType === "ACTION_CANCEL" && ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(tx.status));
    if (pendingCancel?.reason) setReason(pendingCancel.reason);
  }
  useEffect(() => {
    void run(async () => {
      await load();
      const response = await request("/api/v1/instruments?limit=100");
      const rows = Array.isArray(response["items"]) ? response["items"] as ActiveInstrument[] : [];
      setInstruments(rows.filter(row => row.status === "ACTIVE" && row.issuerAuthority === walletAddress));
      setMessage("Выберите действие или создайте новый черновик на ACTIVE инструменте.");
    });
    // Preserve signed workflow state when the parent renews the same operator session.
  }, [request, walletAddress]);

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
      setSelected(response as unknown as CorporateActionView); await load();
      setMessage("Черновик создан. Проверьте условия и подготовьте планирование; DRAFT ещё не в сети.");
    });
  }
  async function prepare(phase: "SCHEDULE" | "CANCEL") {
    if (!selected) return;
    const response = await request(`/api/v1/corporate-actions/${selected.id}/prepare`, { method: "POST",
      body: JSON.stringify({ phase, ...(phase === "CANCEL" ? { reason } : {}) }) });
    const prepared = preparedActionPlan(response, selected, walletAddress);
    const restored = resumedDeploymentSignature(response);
    setPlan(prepared); setSignature(restored ?? ""); setSendAttempted(restored !== null); setReviewed(restored !== null);
    if (prepared.reason) setReason(prepared.reason);
    setMessage(restored ? "Восстановлена прежняя подпись. Повторите только finalized-проверку." : "План подготовлен. Проверьте параметры перед подписью Phantom.");
  }
  async function send() {
    if (!plan || !reviewed || sendAttempted) throw new Error("Сначала проверьте план.");
    await signAndSubmitPrepared({ wallet, walletAddress, plan, request, submitFields: { phase: plan.phase },
      submitPath: `/api/v1/corporate-actions/${plan.corporateActionId}/submit`,
      onSigning: () => { setSendAttempted(true); setMessage("Проверьте запрос Phantom. Повторная отправка отключена; при ошибке используйте проверку подписи."); },
      onSignature: setSignature });
    setMessage("Подпись сохранена. Проверьте finalized; проверка не отправляет транзакцию повторно.");
  }
  async function confirm() {
    if (!plan || !signature) throw new Error("Нужны подготовленная попытка и подпись.");
    const response = await request(`/api/v1/corporate-actions/${plan.corporateActionId}/confirm`, { method: "POST",
      body: JSON.stringify({ operationId: plan.operationId, phase: plan.phase, signature }) });
    requireFinalizedResponse(response, plan.operationId, signature);
    await openAction(plan.corporateActionId); await load();
    setMessage(plan.phase === "SCHEDULE" ? "SCHEDULED: finalized-транзакция и Action PDA сверены. Snapshot доступен в окно record date." : "CANCELLED: отмена подтверждена в сети и базе.");
    setPlan(null); setSignature(""); setSendAttempted(false); setReviewed(false);
  }
  async function cancelDraft() {
    if (!selected) return;
    await request(`/api/v1/corporate-actions/${selected.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    await openAction(selected.id); await load(); setMessage("Неподписанный черновик отменён; причина сохранена в audit.");
  }

  return <section className="mt-6 border-t border-[#dbe5df] pt-6" aria-label="Корпоративные действия">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Корпоративные действия</h3>
      <button className={buttonClass} disabled={busy} onClick={() => void run(async () => { await load(); if (selected) await openAction(selected.id); })}>Обновить действия</button></div>
    <p className="mt-2 text-xs text-[#61746a]">Планирование и snapshot фиксируют условия и держателей. Выплаты и погашение токенов пока не выполняются.</p>
    {administrator && <details className="mt-4 rounded-xl border border-[#dbe5df] p-4">
      <summary className="cursor-pointer text-sm font-semibold">Создать корпоративное действие</summary>
      <form className="mt-4" onSubmit={create}>
        <fieldset disabled={busy || Boolean(pendingDraftId) || plan !== null} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">ACTIVE инструмент<select required name="instrumentId" className={inputClass} defaultValue="">
            <option value="" disabled>Выберите инструмент своего issuer-кошелька</option>{instruments.map(row => <option key={row.id} value={row.id}>{row.ticker} · {row.name}</option>)}</select></label>
          <label className="text-sm">Тип<select className={inputClass} value={type} onChange={event => setType(event.target.value)}>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">Источник<select name="sourceType" className={inputClass} defaultValue="MANUAL"><option value="MANUAL">Ручное действие</option><option value="ISSUER_INSTRUCTION">Поручение эмитента</option><option value="EXCHANGE_EVENT">Биржевое событие</option><option value="EXTERNAL_API">Внешний источник</option><option value="SYSTEM">Системное правило</option></select></label>
          <label className="text-sm sm:col-span-2">Основание / intent<textarea name="intent" required minLength={3} maxLength={500} className={inputClass} /></label>
          <label className="text-sm">Ссылка на источник<input name="sourceReference" maxLength={250} className={inputClass} /></label>
          <label className="text-sm">Документ / описание<input name="sourceDocument" maxLength={500} className={inputClass} /></label>
          <label className="text-sm">Record date · местное время<input required type="datetime-local" className={inputClass} value={recordAt} onChange={event => setRecordAt(event.target.value)} /></label>
          <label className="text-sm">Дата исполнения · местное время<input required type="datetime-local" className={inputClass} value={executeAt} onChange={event => setExecuteAt(event.target.value)} /></label>
          {type === "EARLY_REDEMPTION" && <><label className="text-sm">Доля · bps (2000 = 20%)<input name="redemptionPercentageBps" type="number" min={1} max={10000} step={1} defaultValue={2000} required className={inputClass} /></label>
            <label className="text-sm">Цена одного bond · KZT-Test<input name="redemptionPriceKzt" inputMode="decimal" defaultValue="1000" required className={inputClass} /></label></>}
        </fieldset>
        <p className="mt-3 text-xs text-[#61746a]">До record date при подготовке плана должно оставаться минимум 60 секунд. Окно регистрации snapshot — до 5 минут после record date. Время передаётся в UTC.</p>
        <button type="button" disabled={busy || Boolean(pendingDraftId) || plan !== null} className={`mt-3 ${buttonClass}`} onClick={() => { setRecordAt(futureLocalTime(5)); setExecuteAt(futureLocalTime(15)); }}>Record через 5 минут, исполнение через 15</button>
        <button type="submit" disabled={busy || plan !== null || instruments.length === 0} className={`ml-2 mt-3 ${buttonClass}`}>{pendingDraftId ? "Повторить сохранённый запрос" : "Создать DRAFT"}</button>
        {pendingDraftId && <p className="mt-2 break-all text-xs">UUID запроса: {pendingDraftId}. Повтор использует те же условия и не создаёт второе действие.</p>}
      </form>
    </details>}
    <div className="mt-4 space-y-3">{items.map(action => <div key={action.id} className="rounded-xl border border-[#dbe5df] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{action.instrument.ticker} · {TYPES[action.type] ?? action.type}</strong><span className="text-xs font-bold">{action.status}</span></div>
      <p className="mt-2 text-sm">{action.intent}</p><p className="mt-2 text-xs text-[#61746a]">Record: {date(action.recordAt)} · Исполнение: {date(action.executeAt)}</p>
      <button className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null} onClick={() => void run(async () => { setReason(""); await openAction(action.id); })}>Открыть действие</button>
    </div>)}{items.length === 0 && <p className="text-sm text-[#61746a]">Действий пока нет.</p>}</div>
    {nextCursor && <button className={`mt-3 ${buttonClass}`} disabled={busy} onClick={() => void run(() => load(nextCursor))}>Ещё действия</button>}
    {selected && <div className="mt-5 rounded-xl border border-[#b9dec8] bg-[#f7fbf8] p-4">
      <h4 className="font-semibold">{selected.instrument.ticker} · {TYPES[selected.type]} · {selected.status}</h4>
      <p className="mt-2 break-all font-mono text-xs">UUID: {selected.id}</p><p className="mt-3 text-sm">{selected.intent}</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt>Плановое record time</dt><dd>{date(selected.recordAt)}</dd></div><div><dt>Исполнение</dt><dd>{date(selected.executeAt)}</dd></div>
        <div><dt>Источник</dt><dd className="break-all">{selected.sourceType} · {selected.sourceReference ?? "—"}</dd></div><div><dt>Документ</dt><dd className="break-all">{selected.sourceDocument ?? "—"}</dd></div>
        {selected.type === "EARLY_REDEMPTION" && <div><dt>Досрочное погашение</dt><dd>{selected.redemptionPercentageBps} bps · {selected.redemptionPriceMinor} minor units за bond</dd></div>}</dl>
      {canWrite && !plan && selected.status === "DRAFT" && <button className={`mt-4 ${buttonClass}`} disabled={busy} onClick={() => void run(() => prepare("SCHEDULE"))}>Подготовить планирование SCHEDULE</button>}
      {canWrite && !plan && !selected.snapshot && ["DRAFT", "SCHEDULED"].includes(selected.status) && <div className="mt-4">
        <label className="text-sm">Причина отмены<textarea className={inputClass} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || reason.trim().length < 3} onClick={() => void run(selected.status === "DRAFT" ? cancelDraft : () => prepare("CANCEL"))}>{selected.status === "DRAFT" ? "Отменить неподписанный DRAFT" : "Подготовить отмену CANCEL"}</button></div>}
      {selected.reviewNote && <p className="mt-3 text-sm">Причина: {selected.reviewNote}</p>}
      {plan && <div className="mt-4 rounded-xl border border-[#efd29d] bg-[#fff8eb] p-4">
        <strong>Проверка {plan.phase}</strong><p className="mt-2 text-sm">Сеть: {plan.cluster}. {plan.phase === "SCHEDULE" ? "Будет создан Action PDA с выбранными условиями." : "Действие будет отменено в сети."}</p>
        <dl className="mt-3 space-y-2 text-xs">{Object.entries({ Signer: plan.requiredSigner, Genesis: plan.networkGenesisHash, Program: plan.programId, "Action PDA": plan.actionAddress,
          Record: selected.recordAt, Execute: selected.executeAt, "UUID попытки": plan.operationId, "Причина отмены": plan.reason ?? "—" }).map(([label, value]) => <div key={label}><dt className="text-[#61746a]">{label}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={event => setReviewed(event.target.checked)} />Проверил сеть, signer, условия и эффект транзакции</label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || !supportsPreparedTransaction(wallet, plan.cluster)} onClick={() => void run(send)}>Подписать и отправить {plan.phase}</button>
        {!supportsPreparedTransaction(wallet, plan.cluster) && <p className="mt-2 text-xs">Кошелёк должен поддерживать выбранную тестовую сеть и подпись v0. Проверьте подключение Phantom.</p>}
        <label className="mt-3 block text-sm">Подпись транзакции<input className={inputClass} maxLength={88} value={signature} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>Проверить finalized и Action PDA</button>
      </div>}
      {selected.snapshot && <div className="mt-4 text-xs"><strong>Snapshot · {selected.snapshot.status}</strong><p>План: {date(selected.snapshot.recordAt)} · Фактический capture: {date(selected.snapshot.blockTime)}</p><p>Slot: {selected.snapshot.solanaSlot} · Investors: {selected.snapshot.investorCount} · Wallets: {selected.snapshot.walletCount} · Balance: {selected.snapshot.totalBalance}</p><p className="break-all font-mono">SHA-256: {selected.snapshot.snapshotHash}</p></div>}
      {canWrite && !plan && selected.status === "SCHEDULED" && <SnapshotPanel key={selected.id} selectedActionId={selected.id} wallet={wallet} walletAddress={walletAddress} request={request} onBusyChange={value => { setBusy(value); onBusyChange(value); }}
        onConfirmed={() => void run(async () => { await openAction(selected.id); await load(); setMessage("SNAPSHOT_CREATED: finalized commitment и база сверены. Выплат не было."); })} />}
      {selected.snapshot?.status === "FINALIZED" && !plan && <EntitlementPanel key={`entitlements-${selected.id}`} actionId={selected.id} canWrite={Boolean(canWrite)} request={request}
        canOnchainWrite={administrator && selected.instrument.corporateActionAuthority === walletAddress}
        corporateActionAuthority={selected.instrument.corporateActionAuthority} wallet={wallet} walletAddress={walletAddress}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await openAction(selected.id); await load(); }} />}
      {selected.type === "COUPON_PAYMENT" && ["UNDER_REVIEW", "APPROVED"].includes(selected.status) && !plan && <CouponFundingPanel
        key={`funding-${selected.id}`} actionId={selected.id} canWrite={Boolean(canWrite)} wallet={wallet} walletAddress={walletAddress} request={request}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await openAction(selected.id); await load(); }} />}
      <details className="mt-4 text-xs"><summary className="cursor-pointer font-semibold">Транзакции и audit</summary>
        {selected.blockchainTransactions.map(tx => <p key={tx.id} className="mt-2 break-all font-mono">{tx.operationType} · {tx.status} · {tx.id}<br />{tx.signature ?? "без подписи"}{tx.lastErrorCode ? ` · ${tx.lastErrorCode}` : ""}</p>)}
        {selected.events?.map(event => <p key={event.id} className="mt-2">{date(event.createdAt)} · {event.event} · {event.actorWallet}</p>)}</details>
    </div>}
    <p role="status" aria-live="polite" className="mt-4 text-sm">{busy ? "Операция выполняется… " : ""}{message}</p>
  </section>;
}

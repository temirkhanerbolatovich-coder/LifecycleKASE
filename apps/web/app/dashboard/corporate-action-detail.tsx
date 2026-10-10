"use client";
import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState } from "react";
import { preparedActionPlan, snapshotWindowMessage, type CorporateActionView, type PreparedAction } from "./action-workflow";
import { SnapshotPanel } from "./snapshot-panel";
import { EntitlementPanel } from "./entitlement-panel";
import { CouponFundingPanel } from "./coupon-funding-panel";
import { CouponExecutionPanel } from "./coupon-execution-panel";
import { requireFinalizedResponse, resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { actionPresentation, statusTone, ACTION_TYPES as TYPES, ACTION_STATUSES as STATUS_LABELS, formatWorkspaceDate } from "./workspace-presentation";
import { CopyValue, DetailTabs, RequestNotice } from "./workspace-controls";
import { formatMinorKzt } from "./entitlement-workflow";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const date = formatWorkspaceDate;


export function CorporateActionDetail({ action: selected, role, wallet, walletAddress, request, onBusyChange, onReload, onBack }: {
  action: CorporateActionView; role: string; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onReload: () => Promise<void>; onBack: () => void;
}) {
  const administrator = role === "ADMINISTRATOR";
  const canWrite = administrator && selected.instrument.issuerAuthority === walletAddress;
  const couponExecutionStage = selected.type === "COUPON_PAYMENT" && Boolean(selected.couponExecutionEnabled) &&
    ["APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(selected.status);
  const [reason, setReason] = useState(() => selected.blockchainTransactions.find(tx => tx.operationType === "ACTION_CANCEL" && ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(tx.status))?.reason ?? "");
  const [plan, setPlan] = useState<PreparedAction | null>(null);
  const [signature, setSignature] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null); const [tab, setTab] = useState("workflow");
  const [amountMinor, setAmountMinor] = useState<string | null>(null);
  const inFlight = useRef(false);
  const progress = useRef<HTMLOListElement>(null);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null); onBusyChange(true);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : "Операция не выполнена."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function checkWindow() {
    if (!selected) return;
    const response = await request(`/api/v1/corporate-actions/${selected.id}/snapshot/check-window`, {
      method: "POST", body: JSON.stringify({ expectedVersion: selected.version })
    });
    const resultMessage = snapshotWindowMessage(response, selected.id);
    await onReload(); setMessage(resultMessage);
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
    await onReload();
    setMessage(plan.phase === "SCHEDULE" ? "SCHEDULED: finalized-транзакция и Action PDA сверены. Snapshot доступен в окно record date." : "CANCELLED: отмена подтверждена в сети и базе.");
    setPlan(null); setSignature(""); setSendAttempted(false); setReviewed(false);
  }
  async function cancelDraft() {
    if (!selected) return;
    await request(`/api/v1/corporate-actions/${selected.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    await onReload(); setMessage("Неподписанный черновик отменён; причина сохранена в audit.");
  }


  const context = actionPresentation(selected, canWrite);
  const activeStep = context.steps.findIndex(step => step.state === "current");
  const currentStep = activeStep >= 0 ? activeStep : context.steps.reduce((last, step, index) => step.state === "done" ? index : last, 0);
  useEffect(() => {
    const strip = progress.current;
    if (!strip) return;
    const showCurrent = () => {
      const target = strip.children[currentStep];
      if (!target || strip.clientWidth === 0) return;
      const bounds = target.getBoundingClientRect(); const container = strip.getBoundingClientRect();
      strip.scrollLeft += bounds.left + bounds.width / 2 - container.left - container.width / 2;
    };
    showCurrent();
    const resize = new ResizeObserver(showCurrent); resize.observe(strip);
    return () => resize.disconnect();
  }, [selected.id, currentStep]);
  const nextStep = plan ? signature ? "Проверить finalized по сохранённой подписи" : reviewed ? "Подписать подготовленный план" : "Проверить подготовленный план" : context.next;
  return <article id={`action-${selected.id}`} tabIndex={-1} className="action-detail" aria-label={selected.instrument.ticker + " · карточка действия"}>
    <div className="object-toolbar"><button type="button" className="secondary-button" disabled={busy} onClick={onBack}>← К списку действий</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(onReload)}>Обновить карточку</button></div>
    <div className="object-heading">
      <div>
      <p className="section-kicker">{selected.instrument.ticker} · {selected.instrument.name}</p>
      <h2>{TYPES[selected.type] ?? selected.type}</h2>
      <p>{selected.intent}</p>
      </div>
      <span className={`status-${statusTone(selected.status)}`}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
      </div>
    <dl className="object-facts">
      <div>
      <dt>Дата фиксации</dt>
      <dd>{date(selected.recordAt)}</dd>
      </div>
      <div>
      <dt>Дата исполнения</dt>
      <dd>{date(selected.executeAt)}</dd>
      </div>
      <div>
      <dt>Зафиксировано держателей</dt>
      <dd>{selected.snapshot?.investorCount ?? "Ещё не зафиксированы"}</dd>
      </div>
      <div>
      <dt>Начислено</dt>
      <dd>{amountMinor !== null ? formatMinorKzt(amountMinor) : ["CALCULATED", "UNDER_REVIEW", "APPROVED"].includes(selected.status) ? "Сумма ещё не загружена" : "После расчёта"}</dd>
      </div>
      </dl>
    <ol ref={progress} className="action-progress" aria-label="Этапы действия" tabIndex={0}>{context.steps.map((step, index) => <li key={step.label} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
      <span className="progress-number">{step.state === "done" ? "✓" : index + 1}</span>
      <strong>{step.label}</strong>
      <span>{({done:"Выполнено",current:"Текущий этап",blocked:"Заблокировано",unavailable:"Недоступно"})[step.state]}</span>
      <small>{step.detail}</small>
      </li>)}</ol>
    <div className="next-step"><p className="section-kicker">Следующий шаг</p><strong>{nextStep}</strong><p>{context.explanation}</p>
      {context.pending && <><p className="technical-id">UUID попытки: {context.pending.id}</p><button type="button" className="secondary-button mt-2" onClick={() => setTab("history")}>Открыть доказательства этой попытки</button></>}
    </div>
    <DetailTabs idPrefix={`action-${selected.id}`} selected={tab} onChange={setTab} tabs={[{id:"workflow",label:"Работа с действием"},{id:"terms",label:"Условия и источник"},{id:"history",label:"История и доказательства"}]} />
    <div id={`action-${selected.id}-workflow`} aria-labelledby={`action-${selected.id}-workflow-tab`} hidden={tab !== "workflow"} role="tabpanel" aria-label="Работа с действием">
      {canWrite && !plan && selected.status === "DRAFT" && <button className="primary-button mt-4" disabled={busy} onClick={() => void run(() => prepare("SCHEDULE"))}>Подготовить транзакцию планирования</button>}
      {canWrite && !plan && !selected.snapshot && ["DRAFT", "SCHEDULED"].includes(selected.status) && <details className="danger-details mt-4"><summary>Отмена действия</summary>
        <label className="text-sm">Причина отмены<textarea className={inputClass} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || reason.trim().length < 3} onClick={() => void run(selected.status === "DRAFT" ? cancelDraft : () => prepare("CANCEL"))}>{selected.status === "DRAFT" ? "Отменить неподписанный DRAFT" : "Подготовить отмену CANCEL"}</button>
      </details>}
      {selected.reviewNote && ["RETURNED_FOR_REVISION", "REJECTED"].includes(selected.status) && <p className="mt-3 text-sm">Причина: {selected.reviewNote}</p>}
      {selected.status === "SNAPSHOT_MISSED" && <div role="status" className="mt-4 rounded-lg border border-[#efd29d] bg-[#fff8eb] p-4 text-sm">
        <strong>Snapshot в этом действии больше не создаётся</strong>
        <p className="mt-2">Создайте новое действие с будущим record date через «К списку действий». История и audit этого действия сохранены. Статус пропуска относится к приложению; Action PDA в Solana остаётся SCHEDULED.</p>
      </div>}
      {canWrite && !plan && selected.status === "SCHEDULED" && <button type="button" className={`mt-4 ${buttonClass}`} disabled={busy}
        onClick={() => void run(checkWindow)}>Проверить окно фиксации держателей</button>}
      {plan && <div className="transaction-review mt-4">
        <strong>{plan.phase === "SCHEDULE" ? "Планирование действия" : "Отмена действия"}</strong><p className="mt-2 text-sm">Сеть: {plan.cluster}. {plan.phase === "SCHEDULE" ? "Условия действия будут зарегистрированы в сети. Выплат и движения токенов нет." : "Действие будет отменено в сети."}</p>
        <p className="mt-2">{selected.instrument.ticker} · {TYPES[selected.type]} · {selected.intent}</p>
        <dl className="mt-3 space-y-2 text-xs">{Object.entries({ "Подписант": plan.requiredSigner, "Фиксация держателей": date(selected.recordAt), "Исполнение": date(selected.executeAt), ...(plan.phase === "CANCEL" ? { "Причина отмены": plan.reason ?? "—" } : {}) }).map(([label, value]) => <div key={label}>
      <dt className="text-[#61746a]">{label}</dt>
      <dd className="break-all font-mono">{value}</dd>
      </div>)}</dl>
        <details className="term-help"><summary>Технические реквизиты</summary><dl>{Object.entries({ "UUID попытки": plan.operationId, Genesis: plan.networkGenesisHash, Program: plan.programId, "Action PDA": plan.actionAddress }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><CopyValue value={value} label={label} /></dd></div>)}</dl></details>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={event => setReviewed(event.target.checked)} />Проверил сеть, signer, условия и эффект транзакции</label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || !supportsPreparedTransaction(wallet, plan.cluster)} onClick={() => void run(send)}>Подписать и отправить {plan.phase}</button>
        {!supportsPreparedTransaction(wallet, plan.cluster) && <p className="mt-2 text-xs">Кошелёк должен поддерживать выбранную тестовую сеть и подпись v0. Проверьте подключение Phantom.</p>}
        <label className="mt-3 block text-sm">Подпись транзакции<input className={inputClass} maxLength={88} value={signature} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>Проверить результат в сети и базе</button>
      </div>}
      {canWrite && !plan && selected.status === "SCHEDULED" && <SnapshotPanel key={selected.id} selectedActionId={selected.id} wallet={wallet} walletAddress={walletAddress} request={request} onBusyChange={value => { setBusy(value); onBusyChange(value); }}
        onWindowMissed={async () => { await onReload(); setMessage("Capture закрыт. Проверьте окно snapshot или восстановите сохранённую попытку."); }}
        onConfirmed={() => void run(async () => { await onReload(); setMessage("SNAPSHOT_CREATED: finalized commitment и база сверены. Выплат не было."); })} />}
      {selected.snapshot?.status === "FINALIZED" && !plan && <details className="term-help workflow-section" open={!couponExecutionStage}><summary>Начисления и согласование</summary><EntitlementPanel key={`entitlements-${selected.id}`} actionId={selected.id} canWrite={Boolean(canWrite)} administrator={administrator} request={request} onSummary={setAmountMinor}
        canOnchainWrite={administrator && selected.instrument.corporateActionAuthority === walletAddress}
        corporateActionAuthority={selected.instrument.corporateActionAuthority} wallet={wallet} walletAddress={walletAddress}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await onReload(); }} /></details>}
      {selected.type === "COUPON_PAYMENT" && selected.status === "UNDER_REVIEW" && !plan && <details className="term-help workflow-section"><summary>Бюджет и пополнение тестовых средств</summary><CouponFundingPanel
        key={`funding-${selected.id}`} actionId={selected.id} canWrite={Boolean(canWrite)} wallet={wallet} walletAddress={walletAddress} request={request}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await onReload(); }} /></details>}

      {couponExecutionStage && !plan &&
        <CouponExecutionPanel actionId={selected.id} administrator={administrator} wallet={wallet} walletAddress={walletAddress} request={request}
          onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={onReload} />}

    </div>
    <div id={`action-${selected.id}-terms`} aria-labelledby={`action-${selected.id}-terms-tab`} hidden={tab !== "terms"} role="tabpanel" aria-label="Условия и источник"><CopyValue label="UUID действия" value={selected.id} />
      {selected.snapshot && <div className="evidence-row">
      <strong>Snapshot · {selected.snapshot.status}</strong>
      <p>План: {date(selected.snapshot.recordAt)} · Фактическая фиксация: {date(selected.snapshot.blockTime)}</p>
      <p>Slot: {selected.snapshot.solanaSlot} · Инвесторы: {selected.snapshot.investorCount} · Кошельки: {selected.snapshot.walletCount} · Баланс: {selected.snapshot.totalBalance}</p>
      <p className="technical-id">SHA-256: {selected.snapshot.snapshotHash}</p>
      </div>}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt>Плановое record time</dt><dd>{date(selected.recordAt)}</dd></div><div><dt>Исполнение</dt><dd>{date(selected.executeAt)}</dd></div>
        <div><dt>Источник</dt><dd className="break-all">{selected.sourceType} · {selected.sourceReference ?? "—"}</dd></div><div><dt>Документ</dt><dd className="break-all">{selected.sourceDocument ?? "—"}</dd></div>
        {selected.type === "EARLY_REDEMPTION" && <div><dt>Досрочное погашение</dt><dd>{selected.redemptionPercentageBps} bps · {selected.redemptionPriceMinor} minor units за bond</dd></div>}</dl>

    </div>
    <div id={`action-${selected.id}-history`} aria-labelledby={`action-${selected.id}-history-tab`} hidden={tab !== "history"} role="tabpanel" aria-label="История и доказательства">
      <h3>Транзакции</h3>{selected.blockchainTransactions.length === 0 && <p className="empty-state">Транзакций для действия пока нет.</p>}
      {selected.blockchainTransactions.map(tx => <div key={tx.id} className="evidence-row">
      <strong>{tx.operationType} · {tx.status}</strong>
      <p className="technical-id">Попытка: {tx.id}</p>
      {tx.signature ? <CopyValue label="Исходная подпись транзакции" value={tx.signature} /> : <p>Без подписи</p>}{tx.lastErrorCode && <p>{tx.lastErrorCode}</p>}{tx.status === "UNKNOWN_CONFIRMATION" && <p>Результат неизвестен. Сверьте исходную подпись; повторная отправка не разрешена.</p>}</div>)}
      <h3 className="mt-5">История решений</h3>{!selected.events?.length && <p className="empty-state">Событий аудита в ответе нет.</p>}{selected.events?.map(event => <div key={event.id} className="evidence-row">
      <strong>{event.event}</strong>
      <p>{date(event.createdAt)}</p>
      <p className="technical-id">{event.actorWallet ?? "Система"}</p>
      </div>)}
    </div>
    <RequestNotice busy={busy} message={message} error={error} onRetry={() => void run(onReload)} />
  </article>;
}

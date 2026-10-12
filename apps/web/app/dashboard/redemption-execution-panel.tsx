"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { useEffect, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { finalizedRedemptionReceipt, preparedRedemptionExecution, redemptionExecutionSignature, redemptionExecutionView,
  redemptionReviewChanged, type RedemptionExecutionPlan, type RedemptionExecutionView } from "./redemption-execution-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { CopyValue, RequestNotice } from "./workspace-controls";
import { shortWalletAddress } from "./wallet-account-selection";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

export function RedemptionExecutionPanel({ actionId, actionType, administrator, wallet, walletAddress, request, onBusyChange, onChanged, onState }: {
  actionId: string; actionType: string; administrator: boolean; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
  onState?: (view: RedemptionExecutionView) => void;
}) {
  const { t, locale, displayMessage: financialCopy, formatAmount, formatDate } = useLocale();
  const path = `/api/v1/corporate-actions/${actionId}/redemption-execution`;
  const [view, setView] = useState<RedemptionExecutionView | null>(null);
  const [plan, setPlan] = useState<RedemptionExecutionPlan | null>(null); const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useLocalizedTextState(""); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const canWrite = administrator && view?.requiredSigner === walletAddress;
  async function run(task: () => Promise<unknown>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true); setError(null);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : "Не удалось выполнить погашение."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load() {
    const current = redemptionExecutionView(await request(path), actionId, actionType); setView(current); onState?.(current);
    if (administrator && current.enabled && current.pending && current.requiredSigner === walletAddress) {
      const restored = await preparedRedemptionExecution(current.pending, current, walletAddress);
      const saved = redemptionExecutionSignature(current.pending);
      if (!plan || redemptionReviewChanged(plan, restored)) setReviewed(false);
      setPlan(restored); setSignature(previous => saved ?? previous); setSent(previous => previous || Boolean(saved));
      if (saved) setMessage("Исходная подпись восстановлена. Доступна только проверка выплаты и сжигания.");
    }
    return current;
  }
  useEffect(() => { void run(load); }, [actionId, actionType, request, walletAddress, administrator]);
  async function prepare(phase: "PAY" | "FINALIZE", entitlementId?: string) {
    if (!canWrite || sent) return;
    const current = await load();
    const response = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase, version: current.actionVersion,
      idempotencyKey: crypto.randomUUID(), ...(entitlementId ? { entitlementId } : {}) }) });
    setPlan(await preparedRedemptionExecution(response, current, walletAddress));
    const saved = redemptionExecutionSignature(response); setSignature(saved ?? ""); setSent(Boolean(saved)); setReviewed(false); setMessage("");
  }
  async function send() {
    if (!canWrite || !plan || !reviewed || sent || signature) return;
    const reviewedPlan = plan;
    const current = await load();
    const response = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase: reviewedPlan.phase, version: current.actionVersion,
      idempotencyKey: reviewedPlan.idempotencyKey, ...(reviewedPlan.entitlementId ? { entitlementId: reviewedPlan.entitlementId } : {}) }) });
    const refreshed = await preparedRedemptionExecution(response, current, walletAddress); setPlan(refreshed);
    const saved = redemptionExecutionSignature(response);
    if (saved) { setSent(true); setSignature(saved); setReviewed(false); setMessage("Подпись уже существует. Проверьте только исходную транзакцию."); return; }
    if (redemptionReviewChanged(reviewedPlan, refreshed)) { setReviewed(false); throw new Error("Сумма, сжигание, остатки или supply изменились. Проверьте обновлённый план."); }
    await signAndSubmitPrepared({ wallet, walletAddress, plan: refreshed, request, submitPath: path + "/submit",
      onSigning: () => { setSent(true); setMessage("Проверьте выплату и сжигание в Phantom. После запроса подписи повторная отправка отключена."); }, onSignature: setSignature });
    setMessage("Подпись сохранена. Проверьте finalized, выплату, сжигание и supply по той же транзакции.");
  }
  async function confirm() {
    if (!canWrite || !plan || !signature) return;
    const phase = plan.phase;
    await waitForFinalizedCheck(() => request(path + "/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }),
      plan.operationId, signature, () => setMessage("Ожидается finalized исходной подписи. Повторного исполнения нет."));
    setPlan(null); setSignature(""); setSent(false); setReviewed(false); await load(); await onChanged();
    setMessage(phase === "PAY" ? "Погашение подтверждено: выплата и сжигание атомарны, остатки и supply сверены." : "Все выплаты и погашения сверены. Hash итогового документа закреплён в Solana.");
  }
  async function downloadReceipt() {
    if (!view) return;
    const json = await finalizedRedemptionReceipt(await request(`/api/v1/corporate-actions/${actionId}/receipt`), view);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `redemption-${actionId}.json`; anchor.click(); }
    finally { URL.revokeObjectURL(url); }
    setMessage("Проверенный итоговый документ JSON скачан.");
  }
  if (view && !view.enabled) return <p className="access-note mt-4">{financialCopy("Исполнение погашений не включено в текущей среде. Расчёт доступен в карточке действия.")}</p>;
  return <section className="workflow-section" aria-label={financialCopy("Выплаты и погашение токенов")}>
    <div className="registry-heading"><div><h3>{actionType === "BOND_REDEMPTION" ? financialCopy("Погашение по сроку") : financialCopy("Частичное досрочное погашение")}</h3>
      <p>{view ? `${t("master.execution.progress", { paid: view.paid, payable: view.payable })} · ${formatAmount(view.totalAmountMinor)} · Supply: ${view.currentTokenSupply}` : financialCopy("Загрузка погашений…")}</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void run(load)}>{financialCopy("Обновить")}</button></div>
    <p className="mt-3 text-sm">{financialCopy("Одна транзакция переводит KZT-Test из резерва и сжигает указанное количество bond-токенов. При ошибке выплата и сжигание отменяются вместе.")}</p>
    {view && !canWrite && <div className="access-note mt-3"><p>{administrator ? financialCopy("Погашение подписывает назначенный кошелёк corporate action authority.") : financialCopy("Аудитор просматривает выплаты, погашение и доказательства. Подготовка и подпись недоступны.")}</p><CopyValue label={financialCopy("Подписант погашения")} value={view.requiredSigner} /></div>}
    {view && <div className="payment-list">{view.items.filter(row => row.tokensToRedeem !== "0").map((row, index) => <div className="payment-row" key={row.id}>
      <div><strong>{row.displayName ?? financialCopy(`Инвестор ${index + 1}`)}</strong><span className="table-secondary" title={row.receiver}>{shortWalletAddress(row.receiver)}</span></div>
      <div className="numeric"><strong>{formatAmount(row.amountMinor)}</strong><span className="table-secondary">{financialCopy("Сжечь")} {row.tokensToRedeem} {financialCopy("токенов")}</span></div>
      {row.status === "REDEEMED" ? <span className="status-ready">{financialCopy("Погашено")}</span> : !row.burnAvailable ? <span className="status-wait">{financialCopy("Проверьте остатки и исходную подпись")}</span> : <button className="secondary-button" disabled={busy || !canWrite || Boolean(plan) || Boolean(view.pending) || sent} onClick={() => void run(() => prepare("PAY", row.id))}>{financialCopy("Подготовить погашение")}</button>}
    </div>)}</div>}
    {view && view.paid === view.payable && view.status !== "FINALIZED" && <button className="primary-button mt-4" disabled={busy || !canWrite || Boolean(plan) || Boolean(view.pending) || sent} onClick={() => void run(() => prepare("FINALIZE"))}>{financialCopy("Подготовить итоговое подтверждение")}</button>}
    {view?.status === "FINALIZED" && <button className="primary-button mt-4" disabled={busy} onClick={() => void run(downloadReceipt)}>{financialCopy("Скачать итоговый документ JSON")}</button>}
    {plan && <div className="transaction-review mt-4">
      <h4>{plan.phase === "PAY" ? financialCopy(`Выплатить ${formatAmount(plan.amountMinor)} и сжечь ${plan.tokensToRedeem} токенов`) : financialCopy("Закрепить итог погашения")}</h4>
      <p>{financialCopy("Localnet · KZT-Test — тестовый расчётный актив")}</p>
      <div className="mt-3"><CopyValue label={financialCopy("Подписант")} value={plan.requiredSigner} /><CopyValue label="Bond mint" value={plan.tokenMint} /><CopyValue label="Settlement mint" value={plan.settlementMint} /></div>
      {plan.phase === "PAY" ? <><CopyValue label={financialCopy("Получатель выплаты")} value={plan.settlementWallet!} />
        <p className="mt-3 font-semibold">Supply: {plan.supplyBefore} → {plan.supplyAfter} {financialCopy("· Сжигание:")} {plan.tokensToRedeem}</p>
        <div className="mt-3 space-y-3">{plan.tokenAccounts?.map(source => <div className="evidence-row" key={source.address}>
          <CopyValue label={financialCopy("Счёт bond-токенов")} value={source.address} /><CopyValue label={financialCopy("Владелец счёта")} value={source.walletAddress} />
          <p>{financialCopy("В snapshot:")} {source.balanceAtSnapshot} {source.sourceUntouched ? (locale === "en" ? "· Zero assignment: account untouched; original commitment preserved." : "· Нулевое назначение: счёт не изменяется; исходные факты сохранены.") : <>{financialCopy("· До:")} {source.balanceBefore} {financialCopy("→ После:")} {source.expectedBalanceAfter} {financialCopy("· Сжечь:")} {source.burnAmount}</>}</p>
        </div>)}</div></> : <p className="mt-3 font-semibold">{financialCopy("Погашено:")} {plan.totalTokensRedeemed} {financialCopy("токенов · Итоговый supply:")} {plan.finalSupply}{financialCopy(". Все начисления входят в итоговый документ.")}</p>}
      <details className="term-help"><summary>{financialCopy("Реквизиты сохранённой попытки")}</summary><CopyValue label="Genesis" value={plan.networkGenesisHash} /><CopyValue label="Snapshot SHA-256" value={plan.snapshotHash} /><CopyValue label={financialCopy("UUID попытки")} value={plan.operationId} />{plan.receiptHash && <CopyValue label="Receipt SHA-256" value={plan.receiptHash} />}</details>
      {!sent && !signature && <><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || !canWrite} onChange={event => setReviewed(event.target.checked)} />{financialCopy("Проверил сеть, подписанта, получателя, сумму, каждый счёт сжигания, остатки и supply")}</label>
        <button className="primary-button mt-3" disabled={busy || !reviewed || !canWrite || !supportsPreparedTransaction(wallet, "localnet")} onClick={() => void run(send)}>{financialCopy("Подписать в Phantom")}</button></>}
      {(sent || signature) && <><p className="technical-id mt-3">{financialCopy("Исходная подпись:")} {signature || financialCopy("Проверьте историю кошелька и восстановите исходную подпись")}</p>
        <button className="primary-button mt-3" disabled={busy || !canWrite || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>{financialCopy("Проверить выплату и погашение")}</button></>}
      {canWrite && <details className="term-help"><summary>{financialCopy("Восстановить исходную подпись вручную")}</summary><label>{financialCopy("Подпись исходной транзакции")}<input className="mt-2 w-full rounded border p-2" value={signature} maxLength={88} disabled={busy} onChange={event => { setSignature(event.target.value.trim()); setSent(true); setReviewed(false); }} /></label></details>}
    </div>}
    <RequestNotice busy={busy} error={error} message={message} onRetry={() => void run(load)} />
  </section>;
}

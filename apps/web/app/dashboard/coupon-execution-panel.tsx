"use client";
import { useEffect, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { preparedCouponExecution, couponReviewChanged, type CouponExecutionPlan, type CouponExecutionView } from "./coupon-execution-workflow";
import { resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { CopyValue, RequestNotice } from "./workspace-controls";
import { formatMinorKzt } from "./entitlement-workflow";
import { shortWalletAddress } from "./wallet-account-selection";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
export function CouponExecutionPanel({ actionId, administrator, wallet, walletAddress, request, onBusyChange, onChanged }: {
  actionId: string; administrator: boolean; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
}) {
  const path = `/api/v1/corporate-actions/${actionId}/coupon/execution`;
  const [view, setView] = useState<CouponExecutionView | null>(null);
  const [plan, setPlan] = useState<CouponExecutionPlan | null>(null); const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const canWrite = administrator && view?.requiredSigner === walletAddress;
  async function run(task: () => Promise<unknown>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true); setError(null);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : "Не удалось выполнить операцию."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function load() {
    const current = await request(path) as unknown as CouponExecutionView; setView(current);
    if (current.pending && current.requiredSigner === walletAddress) {
      const restored = await preparedCouponExecution(current.pending, current, walletAddress);
      const savedSignature = resumedDeploymentSignature(current.pending);
      setPlan(restored); setSignature(previous => savedSignature ?? previous); setSent(previous => previous || Boolean(savedSignature));
    }
    return current;
  }
  useEffect(() => { void run(load); }, [actionId, request]);
  async function prepare(phase: "PAY" | "FINALIZE", entitlementId?: string) {
    const current = await load();
    const response = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase, version: current.actionVersion,
      idempotencyKey: crypto.randomUUID(), ...(entitlementId ? { entitlementId } : {}) }) });
    setPlan(await preparedCouponExecution(response, current, walletAddress)); setSignature(resumedDeploymentSignature(response) ?? "");
    setReviewed(false); setSent(Boolean(response["signature"])); setMessage("");
  }
  async function send() {
    if (!plan || !reviewed || sent) return;
    const current = await load();
    const response = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase: plan.phase, version: current.actionVersion,
      idempotencyKey: plan.idempotencyKey, ...(plan.entitlementId ? { entitlementId: plan.entitlementId } : {}) }) });
    const refreshed = await preparedCouponExecution(response, current, walletAddress); setPlan(refreshed);
    const existing = resumedDeploymentSignature(response);
    if (existing) { setSent(true); setSignature(existing); setMessage("Подпись восстановлена. Доступна проверка результата."); return; }
    if (couponReviewChanged(plan, refreshed)) { setReviewed(false); throw new Error("Условия изменились. Проверьте обновлённый план."); }
    await signAndSubmitPrepared({ wallet, walletAddress, plan: refreshed, request, submitPath: path + "/submit",
      onSigning: () => setSent(true), onSignature: setSignature });
    setMessage("Транзакция отправлена. Проверьте результат по сохранённой подписи.");
  }
  async function confirm() {
    if (!plan) return;
    await waitForFinalizedCheck(() => request(path + "/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }),
      plan.operationId, signature, () => setMessage("Ожидается подтверждение сети. Проверяется та же подпись."));
    setPlan(null); setSignature(""); setSent(false); setReviewed(false); await load(); await onChanged();
    setMessage(plan.phase === "PAY" ? "Выплата подтверждена. Сумма и квитанция сверены с сетью." : "Все выплаты сверены. Итоговый документ закреплён в Solana.");
  }
  async function downloadReceipt() {
    const result = await request(`/api/v1/corporate-actions/${actionId}/receipt`);
    if (result["status"] !== "FINALIZED" || typeof result["canonicalJson"] !== "string") throw new Error("Итоговый документ ещё не подтверждён.");
    const url = URL.createObjectURL(new Blob([result["canonicalJson"]], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `coupon-${actionId}.json`; anchor.click(); URL.revokeObjectURL(url);
    setMessage("Итоговый документ JSON скачан.");
  }
  if (view && !view.enabled) return <p className="access-note mt-4">Исполнение купона недоступно в текущей конфигурации. Начисления и доказательства доступны в карточке.</p>;
  return <section className="workflow-section" aria-label="Выплаты купона">
    <div className="registry-heading"><div><h3>Выплаты купона</h3><p>{view ? `Подтверждено ${view.paid} из ${view.payable} · ${formatMinorKzt(view.totalAmountMinor)}` : "Загрузка выплат…"}</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void run(load)}>Обновить</button></div>
    {view?.pending && !canWrite && <p className="access-note mt-3">Есть сохранённая попытка. Её проверяет назначенный подписант.</p>}
    {view && !canWrite && <div className="access-note mt-3"><p>{administrator ? "Выплаты подписывает назначенный кошелёк. Роль администратора не заменяет эти полномочия." : "Аудитор просматривает выплаты. Подготовка и подпись доступны назначенному администратору."}</p><CopyValue label="Подписант выплат" value={view.requiredSigner} /></div>}
    {view && <div className="payment-list">{view.items.filter(row => row.amountMinor !== "0").map((row, index) => <div className="payment-row" key={row.id}>
      <div><strong>{row.displayName ?? `Получатель ${index + 1}`}</strong><span className="table-secondary" title={row.receiver}>{shortWalletAddress(row.receiver)}</span></div>
      <strong className="numeric">{formatMinorKzt(row.amountMinor)}</strong>
      {row.status === "PAID" ? <span className="status-ready">Выплачено</span> : <button className="secondary-button" disabled={busy || !canWrite || Boolean(plan) || Boolean(view.pending)} onClick={() => void run(() => prepare("PAY", row.id))}>Подготовить выплату</button>}
    </div>)}</div>}
    {view && view.paid === view.payable && view.status !== "FINALIZED" && <button className="primary-button mt-4" disabled={busy || !canWrite || Boolean(plan)} onClick={() => void run(() => prepare("FINALIZE"))}>Подготовить итоговое подтверждение</button>}
    {view?.status === "FINALIZED" && <button className="primary-button mt-4" disabled={busy} onClick={() => void run(downloadReceipt)}>Скачать итоговый документ JSON</button>}
    {plan && <div className="transaction-review mt-4">
      <h4>{plan.phase === "PAY" ? `Выплата ${formatMinorKzt(plan.amountMinor)}` : "Закрепление итогового документа"}</h4>
      <p>Localnet · {plan.phase === "PAY" ? `Получатель ${plan.settlementWallet}` : "Суммы всех выплат сверены; hash документа будет записан в Solana."}</p>
      <p className="technical-id mt-2">Подписант: {plan.requiredSigner}</p>
      <details className="term-help"><summary>Технические реквизиты</summary><dl>{Object.entries({ Genesis: plan.networkGenesisHash, "UUID попытки": plan.operationId, "Receipt hash": plan.receiptHash ?? "После выплаты" }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="technical-id">{value}</dd></div>)}</dl></details>
      {!sent && <><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />Проверил сеть, подписанта и результат операции</label>
        <button className="primary-button mt-3" disabled={busy || !reviewed || !canWrite || !supportsPreparedTransaction(wallet, "localnet")} onClick={() => void run(send)}>Подписать в Phantom</button></>}
      {(sent || signature) && <><p className="technical-id mt-3">Подпись: {signature || "Проверьте историю кошелька"}</p>
        <button className="primary-button mt-3" disabled={busy || !canWrite || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>Проверить результат</button></>}
      <details className="term-help"><summary>Восстановить подпись вручную</summary><label>Подпись исходной транзакции<input className="mt-2 w-full rounded border p-2" value={signature} maxLength={88} disabled={busy} onChange={event => { setSignature(event.target.value.trim()); setSent(true); }} /></label></details>
    </div>}
    <RequestNotice busy={busy} error={error} message={message} onRetry={() => void run(load)} />
  </section>;
}

"use client";
import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState } from "react";
import type { CorporateActionView } from "./action-workflow";
import { controlledCaptureView, preparedControlledCapture, recoverCaptureAttempt, type CapturePhase, type ControlledCaptureView, type PreparedCapture } from "./controlled-capture-workflow";
import { SnapshotPanel } from "./snapshot-panel";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { CopyValue, RequestNotice } from "./workspace-controls";
import { useLocale, useLocalizedTextState } from "./locale-context";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
export function ControlledCapturePanel({ action, administrator, wallet, walletAddress, request, onBusyChange, onChanged }: {
  action: CorporateActionView; administrator: boolean; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
}) {
  const { locale } = useLocale(); const copy = (ru: string, en: string) => locale === "en" ? en : ru;
  const path = `/api/v1/corporate-actions/${action.id}/snapshot/capture`;
  const [view, setView] = useState<ControlledCaptureView | null>(null); const [plan, setPlan] = useState<PreparedCapture | null>(null);
  const [signature, setSignature] = useState(""); const [sent, setSent] = useState(false); const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useLocalizedTextState("");
  const inFlight = useRef(false); const canWrite = administrator && view?.requiredSigner === walletAddress && view.enabled;
  async function run(task: () => Promise<unknown>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true); setError(null);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : copy("Не удалось проверить фиксацию держателей.", "Holder capture could not be verified.")); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function finishInvestors(current: ControlledCaptureView): Promise<string[]> {
    if (action.type === "COUPON_PAYMENT") return [];
    const entitlements = await request(`/api/v1/corporate-actions/${action.id}/entitlements`);
    if (entitlements["actionId"] !== action.id || entitlements["onchainCalculationFinalized"] !== true || !Array.isArray(entitlements["items"])) {
      throw new Error(copy("Сначала подтвердите расчёт и резерв каждой назначенной облигации.", "Finalize calculation and reserve every assigned bond first."));
    }
    const ids = (entitlements["items"] as Record<string, unknown>[]).map(row => String(row["investorId"]));
    if (ids.length !== current.investorIds.length) throw new Error(copy("Начисления не покрывают всех зафиксированных держателей.", "Entitlements do not cover every captured holder."));
    return ids;
  }
  async function accept(payload: Record<string, unknown>, current: ControlledCaptureView) {
    const prepared = await preparedControlledCapture(payload, current, walletAddress, payload["phase"] === "FINISH" ? await finishInvestors(current) : []);
    const recovered = recoverCaptureAttempt(payload, plan ? { operationId: plan.operationId, wire: plan.serializedTransactionBase64, signature, sent } : null);
    setPlan(prepared); setSignature(recovered.signature); setSent(recovered.sent); setReviewed(false);
    if (recovered.sent) setMessage(copy("Исходная подпись восстановлена. Проверьте только финализацию.", "Original signature restored. Check finalization only."));
  }
  async function load() {
    const current = await controlledCaptureView(await request(path), action); setView(current);
    if (administrator && current.enabled && current.pending && current.requiredSigner === walletAddress) await accept(current.pending, current);
    return current;
  }
  useEffect(() => { void run(load); }, [action.id, action.status, action.version, request, walletAddress, administrator]);
  async function prepare(phase: CapturePhase) {
    if (!canWrite || sent || signature) return;
    const current = await load();
    await accept(await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase }) }), current);
  }
  async function send() {
    if (!canWrite || !plan || !view || !reviewed || sent || signature) return;
    await preparedControlledCapture(plan as unknown as Record<string, unknown>, view, walletAddress, plan.phase === "FINISH" ? await finishInvestors(view) : []);
    await signAndSubmitPrepared({ wallet, walletAddress, plan, request, submitPath: path + "/submit",
      onSigning: () => setSent(true), onSignature: setSignature });
    setMessage(copy("Подпись сохранена. Проверьте результат по этой же подписи.", "Signature saved. Verify the result using the same signature."));
  }
  async function confirm() {
    if (!plan || !signature) return;
    await waitForFinalizedCheck(() => request(path + "/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }), plan.operationId, signature,
      () => setMessage(copy("Проверяем финализацию исходной подписи без повторной отправки.", "Checking the original signature without resending.")));
    setPlan(null); setSignature(""); setSent(false); setReviewed(false); await load(); await onChanged();
    setMessage(copy("Фиксация проверена в finalized-состоянии сети.", "Capture verified against finalized network state."));
  }
  return <section className="workflow-section" aria-label={copy("Фиксация держателей и защита погашения", "Holder capture and redemption protection")}>
    <div className="registry-heading"><div><h3>{copy("Фиксация держателей", "Holder capture")}</h3>
      <p>{copy("Переводы временно закрываются для полного снимка. После резервирования назначенных единиц свободные облигации снова доступны.", "Transfers pause for a complete snapshot. Free bonds become available after assigned redemption units are reserved.")}</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void run(load)}>{copy("Обновить", "Refresh")}</button></div>
    {view && !view.enabled && <p className="access-note mt-3">{copy("Контролируемая фиксация отключена в текущей среде.", "Governed capture is disabled in this environment.")}</p>}
    {view?.capture && <p className="mt-3 text-sm">{view.capture.finished ? copy("Фиксация завершена; свободные облигации доступны к переводу.", "Capture complete; free bonds can be transferred.") : view.capture.committed ? copy("Держатели зафиксированы; завершите резервирование погашения и откройте свободные остатки.", "Holders captured; finish redemption reservations and release free balances.") : copy("Переводы закрыты; теперь зарегистрируйте полный снимок держателей.", "Transfers paused; record the complete holder snapshot now.")}</p>}
    {canWrite && !plan && !sent && <div className="mt-3 flex flex-wrap gap-2">
      {view.readiness.begin && <button className="primary-button" disabled={busy} onClick={() => void run(() => prepare("BEGIN"))}>{copy("Начать фиксацию держателей", "Begin holder capture")}</button>}
      {view.readiness.finish && <button className="primary-button" disabled={busy} onClick={() => void run(() => prepare("FINISH"))}>{copy("Завершить фиксацию и открыть свободные остатки", "Finish capture and release free balances")}</button>}
      {view.readiness.abort && <button className="secondary-button" disabled={busy} onClick={() => void run(() => prepare("ABORT"))}>{copy("Отменить незавершённую фиксацию", "Abort uncommitted capture")}</button>}
    </div>}
    {canWrite && view.capture && action.snapshot?.status !== "FINALIZED" && !view.capture.finished && !plan && <SnapshotPanel wallet={wallet} walletAddress={walletAddress} request={request}
      selectedActionId={action.id} controlledCapture={view} onBusyChange={value => { setBusy(value); onBusyChange(value); }}
      onConfirmed={() => void run(async () => { await load(); await onChanged(); })} onWindowMissed={onChanged} />}
    {plan && <div className="transaction-review mt-4"><h4>{({ BEGIN: copy("Закрыть переводы для снимка", "Pause transfers for capture"), FINISH: copy("Открыть свободные облигации", "Release free bonds"), ABORT: copy("Отменить незавершённую фиксацию", "Abort uncommitted capture") })[plan.phase]}</h4>
      <p>{plan.cluster} · {copy("Выплата и сжигание не выполняются.", "No payment or burn occurs.")}</p>
      <CopyValue label={copy("Подписант", "Signer")} value={plan.requiredSigner} /><CopyValue label={copy("UUID попытки", "Attempt UUID")} value={plan.operationId} />
      {!sent && !signature && <><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />{copy("Проверил действие, сеть, подписанта и последствия для переводов", "Reviewed action, network, signer and transfer restrictions")}</label>
        <button className="primary-button mt-3" disabled={busy || !reviewed || !supportsPreparedTransaction(wallet, plan.cluster)} onClick={() => void run(send)}>{copy("Подписать в Phantom", "Sign in Phantom")}</button></>}
      {(sent || signature) && <><p className="technical-id mt-3">{signature || copy("Восстановите исходную подпись из кошелька.", "Recover the original signature from your wallet.")}</p>
        <button className="primary-button mt-3" disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>{copy("Проверить финализацию", "Check finalization")}</button></>}
      <details className="term-help"><summary>{copy("Восстановить исходную подпись", "Recover original signature")}</summary><input className="mt-2 w-full rounded border p-2" value={signature} maxLength={88} disabled={busy} onChange={event => { setSignature(event.target.value.trim()); setSent(true); setReviewed(false); }} /></details>
    </div>}
    <RequestNotice busy={busy} error={error} message={message} onRetry={() => void run(load)} />
  </section>;
}

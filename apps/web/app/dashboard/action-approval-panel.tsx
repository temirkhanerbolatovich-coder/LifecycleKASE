"use client";
import { useEffect, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { approvalView, preparedActionApproval, type ApprovalPhase, type ApprovalPlan, type ApprovalView } from "./action-approval-workflow";
import { formatMinorKzt } from "./entitlement-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { resumedDeploymentSignature } from "./snapshot-workflow";
import { CopyValue, RequestNotice } from "./workspace-controls";
const button = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const input = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm";
const labels = { ASSIGN_APPROVER: "Назначить отдельного согласующего", RESERVE: "Зарезервировать бюджет действия", RELEASE: "Вернуть резерв до согласования", APPROVE: "Согласовать в Solana" };
export function ActionApprovalPanel({ actionId, administrator, walletAddress, wallet, request, onBusyChange, onChanged }: {
  actionId: string; administrator: boolean; walletAddress: string; wallet: Wallet | undefined;
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onBusyChange: (value: boolean) => void; onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<ApprovalView | null>(null); const [plan, setPlan] = useState<ApprovalPlan | null>(null);
  const [approver, setApprover] = useState(""); const [note, setNote] = useState(""); const [signature, setSignature] = useState("");
  const [sendInvoked, setSendInvoked] = useState(false);
  const [reviewed, setReviewed] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("Загрузка резерва…");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const path = `/api/v1/corporate-actions/${actionId}/approval`;
  useEffect(() => {
    let active = true;
    request(path).then(payload => {
      if (!active) return; const current = approvalView(payload); setView(current); setMessage("");
      if (current.pending?.["requiredSigner"] === walletAddress) {
        const pending = preparedActionApproval(current.pending, current, walletAddress, String(current.pending["approver"]));
        setPlan(pending); setSignature(resumedDeploymentSignature(current.pending) ?? "");
        setSendInvoked(Boolean(pending.signature) || pending.status !== "PREPARED");
      }
    }).catch(error => { if (active) { setMessage(""); setError(error instanceof Error ? error.message : "Не удалось прочитать резерв."); } });
    return () => { active = false; };
  }, [path, request, walletAddress]);
  async function refresh() { setView(approvalView(await request(path))); }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true;
    setBusy(true); onBusyChange(true); setError(null);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : "Операция не завершена."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function prepare(phase: ApprovalPhase) {
    if (!view) return;
    const result = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ phase, version: view.actionVersion, ...(phase === "ASSIGN_APPROVER" ? { approver } : {}), ...(phase === "APPROVE" ? { note } : {}) }) });
    const next = preparedActionApproval(result, view, walletAddress, approver);
    setPlan(next); setSignature(resumedDeploymentSignature(result) ?? ""); setSendInvoked(Boolean(next.signature) || next.status !== "PREPARED"); setReviewed(false);
    setMessage("Проверьте сеть, полномочия, сумму, хранилище и расходы перед подписью.");
  }
  async function sign() {
    if (!plan || !view || !reviewed || signature || sendInvoked) return;
    preparedActionApproval(plan as unknown as Record<string, unknown>, view, walletAddress, plan.approver ?? undefined);
    setSendInvoked(true);
    await signAndSubmitPrepared({ wallet, walletAddress, plan, request, submitPath: path + "/submit", onSigning: () => setMessage("Подпишите проверенную транзакцию в Phantom."), onSignature: setSignature });
    setMessage("Подпись сохранена. Подтвердите finalized и состояние резерва.");
  }
  async function confirm() {
    if (!plan) return;
    await waitForFinalizedCheck(() => request(path + "/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }), plan.operationId, signature,
      () => setMessage("Ожидаем finalized той же подписи…"));
    setPlan(null); setSignature(""); setSendInvoked(false); setReviewed(false); await refresh(); await onChanged();
    setMessage("Транзакция FINALIZED, on-chain состояние и audit подтверждены.");
  }
  const issuer = administrator && view?.issuer === walletAddress;
  const canApprove = administrator && view?.approver === walletAddress;
  return <section className="mt-4 rounded-xl border border-[#b9dec8] bg-[#f7fbf8] p-4" aria-label="Согласование и резерв действия">
    <h5 className="font-semibold">Согласование и резерв действия</h5>
    <p className="mt-2 text-sm">Резерв закрепляет бюджет за действием. Отдельный кошелёк подтверждает согласование; выплаты выполняются следующим этапом.</p>
    {view && <>
      <p className="mt-3 text-sm">Бюджет: {formatMinorKzt(view.amountMinor)} · В резерве: {formatMinorKzt(view.reservedMinor)} · Treasury: {formatMinorKzt(view.treasuryBalanceMinor)}</p>
      <div className="mt-2"><p>Согласующий</p>{view.approver ? <CopyValue value={view.approver} label="Кошелёк согласующего" /> : <p>Не назначен</p>}</div>
      <details className="term-help"><summary>Реквизиты резерва</summary><CopyValue value={view.reserveAddress} label="Резерв" /><CopyValue value={view.vaultAddress} label="Хранилище" /></details>
      {view.approved && <p className="mt-2 font-semibold">Согласовано в Solana. Бюджет закреплён за действием.</p>}
      {!plan && !view.approved && <div className="mt-3 space-y-3">
        {issuer && !view.approver && <label className="block text-sm">Кошелёк отдельного согласующего<input className={input} value={approver} maxLength={44} onChange={event => setApprover(event.target.value)} /></label>}
        {canApprove && <label className="block text-sm">Основание согласования<textarea className={input} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>}
        <div className="flex flex-wrap gap-2">
          {issuer && !view.approver && <button className={button} disabled={busy || Boolean(view.pending) || approver.length < 32} onClick={() => void run(() => prepare("ASSIGN_APPROVER"))}>{labels.ASSIGN_APPROVER}</button>}
          {issuer && view.approver && <button className={button} disabled={busy || Boolean(view.pending)} onClick={() => void run(() => prepare(view.reserveExists ? "RELEASE" : "RESERVE"))}>{labels[view.reserveExists ? "RELEASE" : "RESERVE"]}</button>}
          {canApprove && <button className={button} disabled={busy || Boolean(view.pending) || !view.reserveExists || BigInt(view.reservedMinor) < BigInt(view.amountMinor) || note.trim().length < 3} onClick={() => void run(() => prepare("APPROVE"))}>{labels.APPROVE}</button>}
          <button className={button} disabled={busy} onClick={() => void run(refresh)}>Обновить резерв</button>
        </div>
        {view.pending && <p className="text-xs">Сохранённая попытка: {String(view.pending["operationId"])} · {String(view.pending["status"])}. Требуется её исходный signer.</p>}
      </div>}
    </>}
    {plan && <div className="mt-4 rounded-lg border border-[#e2d7b8] bg-[#fffaf0] p-3 text-xs">
      <p className="mb-2">Localnet · KZT-Test, тестовый актив</p>
      <strong>{labels[plan.phase]}</strong><p className="mt-2 break-all">Signer: {plan.requiredSigner}<br />Genesis: {plan.networkGenesisHash}<br />Snapshot: {plan.snapshotHash}<br />Сумма: {formatMinorKzt(plan.amountMinor)}<br />Резерв: {plan.reserveAddress}<br />Хранилище: {plan.vaultAddress}<br />Попытка: {plan.operationId}</p>
      <p className="mt-2">Комиссия: {plan.feeLamports} lamports · Rent: {plan.creationRentLamports} · Будущий rent получателей: {plan.recipientRentLamports} · Оценка комиссий исполнения: {plan.estimatedExecutionFeeLamports} · Буфер SOL: {plan.networkReserveLamports}</p>
      {plan.note && <p className="mt-2">Основание: {plan.note}</p>}
      <label className="mt-3 flex gap-2"><input type="checkbox" disabled={busy || Boolean(signature)} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Проверил полномочия, сеть, snapshot, сумму, резерв и расходы</label>
      <button className={button + " mt-3"} disabled={busy || sendInvoked || Boolean(signature) || !reviewed || !supportsPreparedTransaction(wallet, "localnet")} onClick={() => void run(sign)}>Подписать {plan.phase} в Phantom</button>
      <label className="mt-3 block">Подпись транзакции<input className={input} disabled={busy} value={signature} onChange={event => setSignature(event.target.value)} /></label>
      <button className={button + " mt-3"} disabled={busy || signature.length < 64} onClick={() => void run(confirm)}>Подтвердить finalized и резерв</button>
    </div>}
    <RequestNotice busy={busy} message={message} error={error} onRetry={() => void run(refresh)} />
  </section>;
}

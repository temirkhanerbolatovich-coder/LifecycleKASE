"use client";
import { formatWorkspaceDate } from "./workspace-presentation";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState } from "react";
import { formatMinorKzt, reviewChoices, type EntitlementsView } from "./entitlement-workflow";
import { preparedOnchainCalculation, type PreparedOnchainCalculation } from "./onchain-entitlement-workflow";
import { resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { ActionApprovalPanel } from "./action-approval-panel";
import { CopyValue, RequestNotice } from "./workspace-controls";
import { ACTION_STATUSES } from "./workspace-presentation";
import { shortWalletAddress } from "./wallet-account-selection";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const labels = { SUBMIT: "Передать на согласование", APPROVE: "Согласовать начисления", RETURN: "Вернуть на доработку", REJECT: "Отклонить действие" };
const entitlementLabels: Record<string, string> = { CALCULATED: "Рассчитано", READY: "К выплате", PAID: "Выплачено", REDEEMED: "Погашено", NOT_ELIGIBLE_ZERO_ROUNDING: "Нулевая сумма" };

export function EntitlementPanel({ actionId, canWrite, canOnchainWrite, administrator, corporateActionAuthority, wallet, walletAddress, request, onBusyChange, onChanged, onSummary }: {
  actionId: string; canWrite: boolean; canOnchainWrite: boolean; corporateActionAuthority: string;
  wallet: Wallet | undefined; walletAddress: string; request: Request;
  administrator: boolean;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
  onSummary?: (amountMinor: string | null) => void;
}) {
  const [view, setView] = useState<EntitlementsView | null>(null);
  const [receivers, setReceivers] = useState<Record<string, string>>({});
  const [note, setNote] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState<string | null>(null);
  const [onchainPlan, setOnchainPlan] = useState<PreparedOnchainCalculation | null>(null);
  const [onchainSignature, setOnchainSignature] = useState(""); const [onchainReviewed, setOnchainReviewed] = useState(false);
  const [onchainSendInvoked, setOnchainSendInvoked] = useState(false);
  const inFlight = useRef(false);
  const path = `/api/v1/corporate-actions/${actionId}/entitlements`;
  async function refresh() {
    const payload = await request(path); const result = payload as unknown as EntitlementsView;
    if (result.actionId !== actionId || !Number.isSafeInteger(result.actionVersion) || !Array.isArray(result.items) || !Array.isArray(result.investors)) {
      throw new Error("API не вернул начисления выбранного действия.");
    }
    setView(result); setReviewed(false);
    if (canOnchainWrite && result.onchainPending) {
      const saved = preparedOnchainCalculation(result.onchainPending, result, corporateActionAuthority, walletAddress);
      const savedSignature = resumedDeploymentSignature(result.onchainPending);
      setOnchainPlan(saved); setOnchainSignature(previous => savedSignature ?? previous);
      setOnchainSendInvoked(previous => previous || Boolean(savedSignature)); setOnchainReviewed(false);
    }
    onSummary?.(result.items.length ? result.totalEntitlementMinor : null);
    setReceivers(Object.fromEntries(result.investors.map(row => [row.investorId,
      result.items.find(item => item.investorId === row.investorId)?.settlementWalletAddress ?? (row.receiverWallets.length === 1 ? row.receiverWallets[0]! : "")])));
  }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true); setError(null);
    try { await task(); }
    catch (error) { setError(error instanceof Error ? error.message : "Начисления не обновлены."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  useEffect(() => { void run(refresh); }, [actionId, request]);
  async function calculate() {
    if (!view) return;
    await request(path + "/calculate", { method: "POST", body: JSON.stringify({ version: view.actionVersion, receivers }) });
    await refresh(); await onChanged(); setMessage("Начисления сохранены. Следующий шаг — передать их на согласование. Выплат не было.");
  }
  async function review(decision: keyof typeof labels) {
    if (!view || decision === "APPROVE" && !reviewed) return;
    await request(path + "/review", { method: "POST", body: JSON.stringify({ version: view.actionVersion, decision, note }) });
    await refresh(); await onChanged(); setNote("");
    setMessage(decision === "APPROVE" ? "APPROVED: решение, автор и время сохранены. Начисления READY; выплат пока не было." : "Решение сохранено в audit.");
  }
  async function prepareOnchain(phase: "REGISTER" | "FINALIZE" | "RESET", entitlementId?: string) {
    if (!view) return;
    const response = await request(path + "/onchain/prepare", { method: "POST", body: JSON.stringify({
      phase, version: view.actionVersion, ...(entitlementId ? { entitlementId } : {})
    }) });
    const prepared = preparedOnchainCalculation(response, view, corporateActionAuthority, walletAddress);
    const restored = resumedDeploymentSignature(response);
    setOnchainPlan(prepared); setOnchainSignature(restored ?? ""); setOnchainReviewed(false); setOnchainSendInvoked(Boolean(restored));
    setMessage(restored ? "Подпись on-chain операции восстановлена. Повторите только finalized-проверку." :
      phase === "REGISTER" ? "Проверьте entitlement, signer, snapshot и сумму перед подписью." :
        phase === "FINALIZE" ? "Проверьте полный итог расчёта перед переводом Action PDA в UNDER_REVIEW." :
          "Проверьте полный список закрываемых PDA. Reset удалит только частичную on-chain регистрацию и не изменит snapshot.");
  }
  async function sendOnchain() {
    if (!onchainPlan || !onchainReviewed || onchainSendInvoked) return;
    await signAndSubmitPrepared({ wallet, walletAddress, plan: onchainPlan, request, submitPath: path + "/onchain/submit",
      submitFields: { phase: onchainPlan.phase }, onSigning: () => setOnchainSendInvoked(true), onSignature: setOnchainSignature });
    setMessage("Подпись сохранена. Проверьте finalized и точное on-chain состояние.");
  }
  async function confirmOnchain() {
    if (!onchainPlan) return;
    await waitForFinalizedCheck(() => request(path + "/onchain/confirm", { method: "POST", body: JSON.stringify({
      phase: onchainPlan.phase, operationId: onchainPlan.operationId, signature: onchainSignature
    }) }), onchainPlan.operationId, onchainSignature,
    () => setMessage("Операция ещё финализируется. Проверяю ту же подпись без повторной отправки."));
    const phase = onchainPlan.phase; setOnchainPlan(null); setOnchainSignature(""); setOnchainReviewed(false); setOnchainSendInvoked(false);
    await refresh(); await onChanged();
    setMessage(phase === "REGISTER" ? "Entitlement FINALIZED: PDA и сохранённые факты сверены." : phase === "FINALIZE" ?
      "Расчёт FINALIZED: Action PDA перешёл в UNDER_REVIEW. Теперь доступно согласование." :
      "CALCULATION_RESET FINALIZED: частичные entitlement PDA закрыты, snapshot сохранён, можно пересчитать или зарегистрировать заново.");
  }
  const canCalculate = canWrite && view && ["SNAPSHOT_CREATED", "RETURNED_FOR_REVISION"].includes(view.status);
  return <section className="mt-5 border-t border-[#dbe5df] pt-5" aria-label="Начисления и согласование">
    <div className="flex flex-wrap justify-between gap-3"><h4 className="font-semibold">Начисления и согласование</h4>
      <button className={buttonClass} disabled={busy} onClick={() => void run(async () => { await refresh(); await onChanged(); setMessage("Данные обновлены. Повторная финансовая операция не отправлялась."); })}>Обновить начисления</button></div>
    {view && <>
      <p className="mt-3 text-sm"><strong>{ACTION_STATUSES[view.status] ?? view.status}</strong> · Всего: {formatMinorKzt(view.totalEntitlementMinor)} · Получателей: {view.eligibleHolders}</p>
      {canCalculate && <div className="mt-3 space-y-3">{view.investors.map(row => <label key={row.investorId} className="block text-sm">
        {row.displayName} · {row.balance} bond · {row.snapshotEligibility}
        <select className={inputClass} disabled={busy} value={receivers[row.investorId] ?? ""} onChange={event => setReceivers(previous => ({ ...previous, [row.investorId]: event.target.value }))}>
          <option value="">Выберите проверенный кошелёк получателя</option>{row.receiverWallets.map(address => <option key={address} value={address}>{address}</option>)}</select>
        {row.receiverWallets.length === 0 && <span className="text-xs text-[#8a5b18]">Активного проверенного кошелька нет — расчёт заблокирован.</span>}
      </label>)}<button className={buttonClass} disabled={busy || view.investors.length === 0 || view.investors.some(row => !receivers[row.investorId])} onClick={() => void run(calculate)}>
        {view.status === "RETURNED_FOR_REVISION" ? "Пересчитать по прежнему snapshot" : "Рассчитать и сохранить начисления"}</button></div>}
      {view.items.length > 0 && <div className="table-scroll mt-4" tabIndex={0} role="region" aria-label="Начисления получателей"><table className="registry-table"><thead><tr>
        {["Инвестор / получатель", "Баланс snapshot", "Начисление", ...(view.actionType === "COUPON_PAYMENT" ? [] : ["К погашению"]), "Статус / допуск"].map(label => <th key={label} className={`border-b border-[#dbe5df] p-2${["Баланс snapshot", "Начисление", "К погашению"].includes(label) ? " numeric" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>{view.items.map(row => <tr key={row.id}><td className="max-w-64 p-2"><strong>{view.investors.find(investor => investor.investorId === row.investorId)?.displayName ?? row.investorId}</strong><details><summary className="table-secondary">Кошелёк {shortWalletAddress(row.settlementWalletAddress)}</summary><p className="technical-id">{row.settlementWalletAddress}</p></details></td>
          <td className="p-2 numeric">{row.balanceAtRecordDate}</td><td className="p-2 numeric"><span className="whitespace-nowrap">{formatMinorKzt(row.amountMinor)}</span>
            <details className="mt-1"><summary>Формула и округление</summary><p>{row.formulaVersion}</p><p>Номинал: {formatMinorKzt(row.calculationInputs.faceValueMinor)} · Ставка: {row.calculationInputs.couponRateBps} bps · Выплат/год: {row.calculationInputs.paymentsPerYear}</p>
              {row.calculationInputs.redemptionPercentageBps !== null && <p>Доля: {row.calculationInputs.redemptionPercentageBps} bps · Цена: {formatMinorKzt(row.calculationInputs.redemptionPriceMinor!)}</p>}
              <p>Округление вниз: остаток {row.calculationInputs.roundingRemainder} / {row.calculationInputs.denominator}</p></details></td>{view.actionType !== "COUPON_PAYMENT" && <td className="p-2 numeric">{row.tokensToRedeem}</td>}
          <td className="p-2">{entitlementLabels[row.status] ?? row.status}<span className="table-secondary">{row.currentEligibility.eligible ? "Допуск подтверждён" : row.currentEligibility.reason}</span>{row.onchainPda && <details><summary className="table-secondary">Запись в Solana</summary><p className="technical-id">{row.onchainPda}</p></details>}{!row.currentEligibility.eligible && <strong className="block text-[#8a5b18]">Выплата заблокирована</strong>}</td></tr>)}</tbody></table></div>}
      {view.onchainRegistrationEnabled && view.status === "UNDER_REVIEW" && <div className="mt-4 rounded-xl border border-[#b9dec8] bg-[#f7fbf8] p-4">
        <h5 className="font-semibold">Регистрация расчёта в Solana</h5>
        <p className="mt-2 text-xs text-[#61746a]">Каждый entitlement регистрируется отдельной точной транзакцией. Финальный шаг сверяет количество и общую сумму и переводит Action PDA в UNDER_REVIEW.</p>
        <div className="mt-3 flex flex-wrap gap-2">{view.items.filter(row => !row.onchainPda).map(row => <button key={row.id} className={buttonClass}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("REGISTER", row.id))}>
          Зарегистрировать {view.investors.find(investor => investor.investorId === row.investorId)?.displayName ?? row.investorId}</button>)}</div>
        {!view.onchainCalculationFinalized && view.items.length > 0 && view.items.every(row => row.onchainPda) && <button className={`mt-3 ${buttonClass}`}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("FINALIZE"))}>Финализировать on-chain расчёт</button>}
        {!view.onchainCalculationFinalized && view.items.some(row => row.onchainPda) && <details className="danger-details mt-3"><summary>Сброс регистрации</summary><p className="text-sm">Закрывает зарегистрированные начисления. Snapshot сохраняется. Сначала необходимо проверить все подписанные попытки.</p><button className={`mt-3 ${buttonClass}`}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("RESET"))}>Подготовить сброс регистрации</button></details>}
        {view.onchainCalculationFinalized && <p className="mt-3 text-sm font-semibold text-[#18794e]">CALCULATION_FINALIZE подтверждён finalized.</p>}
        {!canOnchainWrite && <p className="mt-2 text-xs text-[#8a5b18]">Для этих транзакций подключите кошелёк corporate action authority.</p>}
      </div>}
      {onchainPlan && <div className="mt-4 rounded-xl border border-[#efd29d] bg-[#fff8eb] p-4">
        <strong>Проверка {onchainPlan.phase === "REGISTER" ? "ENTITLEMENT_REGISTER" : onchainPlan.phase === "FINALIZE" ? "CALCULATION_FINALIZE" : "CALCULATION_RESET"}</strong>
        <p className="mt-2 text-sm">Сеть: {onchainPlan.cluster}. {onchainPlan.phase === "RESET" ? "Закрытие записей начислений" : "Регистрация расчёта"}; без выплаты и сжигания.</p>
        <p className="technical-id mt-2">Подписант: {onchainPlan.requiredSigner}</p>
        <p className="mt-2">Сумма регистрации: {onchainPlan.paymentAmountMinor !== undefined ? formatMinorKzt(onchainPlan.paymentAmountMinor) : onchainPlan.totalAmountMinor !== undefined ? formatMinorKzt(onchainPlan.totalAmountMinor) : "Не применимо"}</p>
        {onchainPlan.settlementWallet && <div className="mt-2"><p>Получатель начисления</p><CopyValue value={onchainPlan.settlementWallet} label="Получатель начисления" /></div>}
        {onchainSignature && <p className="mt-2 text-sm">Сохранённая подпись восстановлена. Проверьте её результат.</p>}
        <details className="term-help"><summary>Реквизиты сохранённой попытки</summary><dl className="mt-3 space-y-2 text-xs">{Object.entries({ Genesis: onchainPlan.networkGenesisHash,
          Program: onchainPlan.programId, "Action PDA": onchainPlan.actionAddress, "Entitlement PDA": onchainPlan.entitlementAddress ?? "—",
          Snapshot: onchainPlan.snapshotHash, "Сумма": onchainPlan.paymentAmountMinor ?? onchainPlan.totalAmountMinor ?? "—",
          "Количество": onchainPlan.entitlementCount ?? "—", "UUID попытки": onchainPlan.operationId }).map(([label, value]) => <div key={label}>
            <dt className="text-[#61746a]">{label}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl></details>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={onchainReviewed} disabled={busy || onchainSendInvoked}
          onChange={event => setOnchainReviewed(event.target.checked)} />Проверил сеть, signer, snapshot, PDA и финансовые значения</label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !onchainReviewed || onchainSendInvoked || !supportsPreparedTransaction(wallet, onchainPlan.cluster)}
          onClick={() => void run(sendOnchain)}>Подписать и отправить {onchainPlan.phase}</button>
        <label className="mt-3 block text-sm">Подпись транзакции<input className={inputClass} maxLength={88} value={onchainSignature} disabled={busy}
          onChange={event => setOnchainSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(onchainSignature)}
          onClick={() => void run(confirmOnchain)}>Проверить finalized и PDA</button>
      </div>}
      {view.actionApprovalEnabled && view.onchainCalculationFinalized && ["UNDER_REVIEW", "APPROVED"].includes(view.status) && <ActionApprovalPanel actionId={actionId} administrator={administrator} wallet={wallet} walletAddress={walletAddress} request={request} onBusyChange={value => { inFlight.current = value; setBusy(value); onBusyChange(value); }} onChanged={async () => { await refresh(); await onChanged(); }} />}
      {view.actionApprovalEnabled && !view.onchainCalculationFinalized && <p className="mt-3 text-sm">Согласование и резерв доступны после подтверждённого FINALIZE расчёта.</p>}
      {canWrite && reviewChoices(view.status).length > 0 && (!view.actionApprovalEnabled || view.status === "CALCULATED") && <div className="mt-4">
        <label className="block text-sm">Комментарий к решению<textarea className={inputClass} minLength={3} maxLength={1000} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label>
        {view.status === "UNDER_REVIEW" && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Проверил источник, snapshot, допуск, получателей, суммы и ожидаемые выплаты/погашение</label>}
        <div className="mt-3 flex flex-wrap gap-2">{reviewChoices(view.status).map(decision => <button key={decision} className={buttonClass}
          disabled={busy || note.trim().length < 3 || decision === "APPROVE" && (!reviewed || view.items.some(row => !row.currentEligibility.eligible) ||
            view.onchainRegistrationEnabled && !view.onchainCalculationFinalized)}
          onClick={() => void run(() => review(decision))}>{labels[decision]}</button>)}</div></div>}
      {view.reviewNote && <p className="mt-3 text-xs">Решение: {view.reviewNote}</p>}
      {view.approvedAt && <p className="mt-2 text-xs">Согласовал: {view.approvedById} · {formatWorkspaceDate(view.approvedAt)}</p>}
    </>}
    <RequestNotice busy={busy} message={message} error={error} onRetry={() => void run(refresh)} />
  </section>;
}

"use client";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState } from "react";
import { formatMinorKzt, reviewChoices, type EntitlementsView } from "./entitlement-workflow";
import { preparedOnchainCalculation, type PreparedOnchainCalculation } from "./onchain-entitlement-workflow";
import { resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const labels = { SUBMIT: "Передать на согласование", APPROVE: "Согласовать начисления", RETURN: "Вернуть на доработку", REJECT: "Отклонить действие" };

export function EntitlementPanel({ actionId, canWrite, canOnchainWrite, corporateActionAuthority, wallet, walletAddress, request, onBusyChange, onChanged }: {
  actionId: string; canWrite: boolean; canOnchainWrite: boolean; corporateActionAuthority: string;
  wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<EntitlementsView | null>(null);
  const [receivers, setReceivers] = useState<Record<string, string>>({});
  const [note, setNote] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("Загрузка начислений…");
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
    setReceivers(Object.fromEntries(result.investors.map(row => [row.investorId,
      result.items.find(item => item.investorId === row.investorId)?.settlementWalletAddress ?? (row.receiverWallets.length === 1 ? row.receiverWallets[0]! : "")])));
  }
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Начисления не обновлены."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  useEffect(() => { void run(async () => { await refresh(); setMessage("Расчёт использует неизменяемый finalized snapshot. Проверьте получателей и суммы."); }); }, [actionId, request]);
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
    <p className="mt-2 text-xs text-[#61746a]">Для Localnet действует явный synthetic demo-допуск. Согласование фиксирует решение; перевод KZT-Test и погашение выполняются отдельным этапом.</p>
    {view && <>
      <p className="mt-3 text-sm"><strong>{view.status}</strong> · Всего: {formatMinorKzt(view.totalEntitlementMinor)} · Получателей: {view.eligibleHolders}</p>
      {canCalculate && <div className="mt-3 space-y-3">{view.investors.map(row => <label key={row.investorId} className="block text-sm">
        {row.displayName} · {row.balance} bond · {row.snapshotEligibility}
        <select className={inputClass} disabled={busy} value={receivers[row.investorId] ?? ""} onChange={event => setReceivers(previous => ({ ...previous, [row.investorId]: event.target.value }))}>
          <option value="">Выберите проверенный кошелёк получателя</option>{row.receiverWallets.map(address => <option key={address} value={address}>{address}</option>)}</select>
        {row.receiverWallets.length === 0 && <span className="text-xs text-[#8a5b18]">Активного проверенного кошелька нет — расчёт заблокирован.</span>}
      </label>)}<button className={buttonClass} disabled={busy || view.investors.length === 0 || view.investors.some(row => !receivers[row.investorId])} onClick={() => void run(calculate)}>
        {view.status === "RETURNED_FOR_REVISION" ? "Пересчитать по прежнему snapshot" : "Рассчитать и сохранить начисления"}</button></div>}
      {view.items.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>
        {["Инвестор / получатель", "Баланс snapshot", "Начисление", "К погашению", "Статус / допуск"].map(label => <th key={label} className="border-b border-[#dbe5df] p-2">{label}</th>)}</tr></thead>
        <tbody>{view.items.map(row => <tr key={row.id}><td className="max-w-64 break-all p-2">{view.investors.find(investor => investor.investorId === row.investorId)?.displayName ?? row.investorId}<br />{row.settlementWalletAddress}</td>
          <td className="p-2">{row.balanceAtRecordDate}</td><td className="p-2"><span className="whitespace-nowrap">{formatMinorKzt(row.amountMinor)}</span>
            <details className="mt-1"><summary>Формула и округление</summary><p>{row.formulaVersion}</p><p>Номинал: {formatMinorKzt(row.calculationInputs.faceValueMinor)} · Ставка: {row.calculationInputs.couponRateBps} bps · Выплат/год: {row.calculationInputs.paymentsPerYear}</p>
              {row.calculationInputs.redemptionPercentageBps !== null && <p>Доля: {row.calculationInputs.redemptionPercentageBps} bps · Цена: {formatMinorKzt(row.calculationInputs.redemptionPriceMinor!)}</p>}
              <p>Округление вниз: остаток {row.calculationInputs.roundingRemainder} / {row.calculationInputs.denominator}</p></details></td><td className="p-2">{row.tokensToRedeem}</td>
          <td className="p-2">{row.status}<br />{row.currentEligibility.reason}{row.onchainPda && <span className="mt-1 block break-all font-mono text-[10px] text-[#18794e]">PDA: {row.onchainPda}</span>}{!row.currentEligibility.eligible && <strong className="block text-[#8a5b18]">Выплата заблокирована</strong>}</td></tr>)}</tbody></table></div>}
      {view.onchainRegistrationEnabled && view.status === "UNDER_REVIEW" && <div className="mt-4 rounded-xl border border-[#b9dec8] bg-[#f7fbf8] p-4">
        <h5 className="font-semibold">Регистрация расчёта в Solana</h5>
        <p className="mt-2 text-xs text-[#61746a]">Каждый entitlement регистрируется отдельной точной транзакцией. Финальный шаг сверяет количество и общую сумму и переводит Action PDA в UNDER_REVIEW.</p>
        <div className="mt-3 flex flex-wrap gap-2">{view.items.filter(row => !row.onchainPda).map(row => <button key={row.id} className={buttonClass}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("REGISTER", row.id))}>
          Зарегистрировать {view.investors.find(investor => investor.investorId === row.investorId)?.displayName ?? row.investorId}</button>)}</div>
        {!view.onchainCalculationFinalized && view.items.length > 0 && view.items.every(row => row.onchainPda) && <button className={`mt-3 ${buttonClass}`}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("FINALIZE"))}>Финализировать on-chain расчёт</button>}
        {!view.onchainCalculationFinalized && view.items.some(row => row.onchainPda) && <button className={`mt-3 ml-2 ${buttonClass}`}
          disabled={busy || !canOnchainWrite || onchainPlan !== null} onClick={() => void run(() => prepareOnchain("RESET"))}>Сбросить частичную регистрацию</button>}
        {view.onchainCalculationFinalized && <p className="mt-3 text-sm font-semibold text-[#18794e]">CALCULATION_FINALIZE подтверждён finalized.</p>}
        {!canOnchainWrite && <p className="mt-2 text-xs text-[#8a5b18]">Для этих транзакций подключите кошелёк corporate action authority.</p>}
      </div>}
      {onchainPlan && <div className="mt-4 rounded-xl border border-[#efd29d] bg-[#fff8eb] p-4">
        <strong>Проверка {onchainPlan.phase === "REGISTER" ? "ENTITLEMENT_REGISTER" : onchainPlan.phase === "FINALIZE" ? "CALCULATION_FINALIZE" : "CALCULATION_RESET"}</strong>
        <dl className="mt-3 space-y-2 text-xs">{Object.entries({ Signer: onchainPlan.requiredSigner, Genesis: onchainPlan.networkGenesisHash,
          Program: onchainPlan.programId, "Action PDA": onchainPlan.actionAddress, "Entitlement PDA": onchainPlan.entitlementAddress ?? "—",
          Snapshot: onchainPlan.snapshotHash, "Сумма": onchainPlan.paymentAmountMinor ?? onchainPlan.totalAmountMinor ?? "—",
          "Количество": onchainPlan.entitlementCount ?? "—", "UUID попытки": onchainPlan.operationId }).map(([label, value]) => <div key={label}>
            <dt className="text-[#61746a]">{label}</dt><dd className="break-all font-mono">{value}</dd></div>)}</dl>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={onchainReviewed} disabled={busy || onchainSendInvoked}
          onChange={event => setOnchainReviewed(event.target.checked)} />Проверил сеть, signer, snapshot, PDA и финансовые значения</label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !onchainReviewed || onchainSendInvoked || !supportsPreparedTransaction(wallet, onchainPlan.cluster)}
          onClick={() => void run(sendOnchain)}>Подписать и отправить {onchainPlan.phase}</button>
        <label className="mt-3 block text-sm">Подпись транзакции<input className={inputClass} maxLength={88} value={onchainSignature} disabled={busy}
          onChange={event => setOnchainSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(onchainSignature)}
          onClick={() => void run(confirmOnchain)}>Проверить finalized и PDA</button>
      </div>}
      {canWrite && reviewChoices(view.status).length > 0 && <div className="mt-4">
        <label className="block text-sm">Комментарий к решению<textarea className={inputClass} minLength={3} maxLength={1000} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label>
        {view.status === "UNDER_REVIEW" && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Проверил источник, snapshot, допуск, получателей, суммы и ожидаемые выплаты/погашение</label>}
        <div className="mt-3 flex flex-wrap gap-2">{reviewChoices(view.status).map(decision => <button key={decision} className={buttonClass}
          disabled={busy || note.trim().length < 3 || decision === "APPROVE" && (!reviewed || view.items.some(row => !row.currentEligibility.eligible) ||
            view.onchainRegistrationEnabled && !view.onchainCalculationFinalized)}
          onClick={() => void run(() => review(decision))}>{labels[decision]}</button>)}</div></div>}
      {view.reviewNote && <p className="mt-3 text-xs">Решение: {view.reviewNote}</p>}
      {view.approvedAt && <p className="mt-2 text-xs">Согласовал: {view.approvedById} · {new Date(view.approvedAt).toLocaleString("ru-RU")}</p>}
    </>}
    <p role="status" aria-live="polite" className="mt-3 text-sm">{busy ? "Операция выполняется… " : ""}{message}</p>
  </section>;
}

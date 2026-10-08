"use client";

import { useEffect, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { formatMinorKzt } from "./entitlement-workflow";
import { couponBudget, couponFundingReviewChanged, couponFundingSignature, preparedCouponFunding,
  refreshCouponFundingPlan, unsignedFundingPlanIsStale, type CouponBudget, type CouponFundingPlan } from "./coupon-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const button = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
export function CouponFundingPanel({ actionId, canWrite, wallet, walletAddress, request, onBusyChange, onChanged }: {
  actionId: string; canWrite: boolean; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onChanged: () => Promise<void>;
}) {
  const [budget, setBudget] = useState<CouponBudget | null>(null); const [plan, setPlan] = useState<CouponFundingPlan | null>(null);
  const [signature, setSignature] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [sendInvoked, setSendInvoked] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Проверьте finalized бюджет всего купона перед финансированием."); const inFlight = useRef(false);
  const path = `/api/v1/corporate-actions/${actionId}/coupon`;
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true);
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "Финансирование не подтверждено."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function refreshBudget() {
    const result = await request(path + "/budget");
    const current = couponBudget(result, actionId); setBudget(current);
    if (canWrite && current.fundingAttempt) {
      if (unsignedFundingPlanIsStale(current.fundingAttempt, current)) {
        // Preserve any locally signed attempt after a lost response; it still needs confirmation.
        if (!sendInvoked && !signature) { setPlan(null); setReviewed(false); }
        setMessage("Неподписанный план устарел. Подготовьте актуальный план и проверьте его заново. Сервер заменит попытку только после finalized истечения blockhash.");
        return current;
      }
      const saved = preparedCouponFunding(current.fundingAttempt, current, walletAddress);
      const restored = couponFundingSignature(saved);
      setPlan(saved); setSignature(previous => restored ?? previous); if (restored) setSendInvoked(true);
    }
    return current;
  }
  useEffect(() => { void run(async () => { await refreshBudget(); }); }, [actionId, request]);
  async function prepare() {
    const { budget: current, plan: next } = await refreshCouponFundingPlan(request, path, actionId, walletAddress);
    setBudget(current); const restored = couponFundingSignature(next);
    setPlan(next); setSignature(restored ?? ""); setSendInvoked(Boolean(restored)); setReviewed(false);
    setMessage(restored ? "Сохранённая подпись восстановлена. Повторите только проверку finalized." : "План пополняет treasury ровно на показанную сумму. Выплат инвесторам не будет.");
    await onChanged();
  }
  async function send() {
    if (!plan || !reviewed || sendInvoked) return;
    // Refresh only an unsigned attempt immediately before the already-reviewed wallet prompt.
    const { budget: current, plan: refreshed } = await refreshCouponFundingPlan(request, path, actionId, walletAddress);
    setBudget(current); const restored = couponFundingSignature(refreshed);
    setPlan(refreshed);
    if (restored) { setSignature(restored); setSendInvoked(true); setMessage("Подпись уже существует. Выполните только finalized-проверку."); return; }
    if (couponFundingReviewChanged(plan, refreshed)) {
      setReviewed(false); throw new Error("Условия изменились после проверки. Проверьте обновлённый план перед подписью.");
    }
    await signAndSubmitPrepared({ wallet, walletAddress, plan: refreshed, request, submitPath: path + "/funding/submit",
      onSigning: () => setSendInvoked(true), onSignature: setSignature });
    setMessage("Подпись сохранена. Проверьте finalized и точный прирост treasury.");
  }
  async function confirm() {
    if (!plan) return;
    await waitForFinalizedCheck(() => request(path + "/funding/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }),
      plan.operationId, signature, () => setMessage("Финансирование ещё финализируется. Проверяю ту же подпись; повторного выпуска нет."));
    setSendInvoked(true); await refreshBudget(); await onChanged();
    setMessage("Финансирование FINALIZED: точный прирост treasury подтверждён. Купон инвесторам ещё не выплачен.");
  }
  return <section className="mt-5 border-t border-[#dbe5df] pt-5" aria-label="Финансирование купона">
    <h4 className="font-semibold">Бюджет и финансирование купона · Localnet</h4>
    <p className="mt-2 text-xs text-[#61746a]">KZT-Test — SIMULATED ASSET. Not issued by the National Bank of Kazakhstan. Финансирование выпускает тестовые токены в treasury; согласование и выплаты выполняются отдельно.</p>
    <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(async () => { await refreshBudget(); setMessage("Текущий finalized бюджет получен; транзакций не отправлял."); })}>Проверить бюджет</button>
      {canWrite && <button className={button} disabled={busy || sendInvoked} onClick={() => void run(prepare)}>Подготовить / восстановить финансирование</button>}</div>
    {budget && <div className="mt-3 text-sm"><p>Весь купон: <strong>{formatMinorKzt(budget.totalCouponMinor)}</strong> · Treasury: {formatMinorKzt(budget.treasuryBalanceMinor)}</p>
      <p>Не хватает: {formatMinorKzt(budget.deficitMinor)} · Slot: {budget.finalizedSlot}</p><p className="break-all font-mono text-xs">Mint: {budget.settlementMint}<br />Treasury: {budget.treasuryTokenAccount}</p>
      <p className="mt-2">{budget.hasNetworkBudget ? "Сетевой бюджет достаточен" : "Не хватает SOL для финансирования и резерва"} · {budget.hasCouponBudget ? "Купон обеспечен тестовыми токенами" : "Требуется финансирование"}</p>
      <details className="mt-2 text-xs"><summary>Сетевой бюджет</summary><p>SOL в lamports: {budget.payerLamports}; требуется: {budget.requiredLamports}; резерв: {budget.networkReserveLamports}. Резерв — установленный запас; средства не заблокированы. Исполнение отдельно проверит собственные комиссии и rent.</p></details></div>}
    {plan && canWrite && <div className="mt-4 rounded-lg border border-[#e4b45f] bg-[#fffaf0] p-4 text-sm"><p>Проверка COUPON_FUNDING: выпустить {formatMinorKzt(plan.amountMinor)} в treasury</p>
      <p className="mt-2 break-all text-xs">Signer: {plan.requiredSigner}<br />Genesis: {plan.networkGenesisHash}<br />Попытка: {plan.operationId}</p>
      <label className="mt-3 flex gap-2"><input type="checkbox" checked={reviewed} disabled={busy || sendInvoked} onChange={event => setReviewed(event.target.checked)} />Проверил Localnet, mint, treasury и сумму тестового выпуска</label>
      <button className={`mt-3 ${button}`} disabled={busy || sendInvoked || !reviewed || !supportsPreparedTransaction(wallet, "localnet")} onClick={() => void run(send)}>Подписать финансирование в Phantom</button>
      <label className="mt-3 block text-xs">Подпись транзакции<input className="mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white p-2" disabled={busy} maxLength={88} value={signature} onChange={event => setSignature(event.target.value.trim())} /></label>
      <button className={`mt-3 ${button}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>Проверить finalized и прирост treasury</button></div>}
    <p role="status" aria-live="polite" className="mt-3 text-sm">{busy ? "Операция выполняется… " : ""}{message}</p>
  </section>;
}

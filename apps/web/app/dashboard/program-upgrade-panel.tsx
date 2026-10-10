"use client";

import { useEffect, useRef, useState } from "react";
import type { Wallet } from "@wallet-standard/base";
import { preparedProgramUpgrade, recoverProgramUpgrade, type ProgramUpgradePlan } from "./program-upgrade-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const path = "/api/v1/program-upgrade";
const button = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
export function ProgramUpgradePanel({ role, wallet, walletAddress, request, onBusyChange }: {
  role: string; wallet: Wallet | undefined; walletAddress: string; request: Request; onBusyChange: (value: boolean) => void;
}) {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [plan, setPlan] = useState<ProgramUpgradePlan | null>(null); const [buffer, setBuffer] = useState("");
  const [signature, setSignature] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState(""); const inFlight = useRef(false);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusyChange(true);
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "Обновление не подтверждено."); }
    finally { setBusy(false); onBusyChange(false); inFlight.current = false; }
  }
  function restore(next: ProgramUpgradePlan) {
    const saved = next.signature ?? sessionStorage.getItem(`program-upgrade:${next.operationId}`) ?? "";
    setPlan(next); setBuffer(next.bufferAddress); setSignature(saved); setAttempted(Boolean(saved) || next.status !== "PREPARED"); setReviewed(false);
  }
  function recover(payload: Record<string, unknown>, current: Record<string, unknown>) {
    const local = typeof payload["operationId"] === "string" ? sessionStorage.getItem(`program-upgrade:${payload["operationId"]}`) : null;
    return recoverProgramUpgrade(payload, current, walletAddress, local);
  }
  async function refresh() {
    const current = await request(path); setReport(current);
    if (current["attempt"] && typeof current["attempt"] === "object" && current["upgradeAuthority"] === walletAddress) {
      restore(recover(current["attempt"] as Record<string, unknown>, current));
    }
    return current;
  }
  useEffect(() => { void run(async () => { await refresh(); }); }, [request, walletAddress]);
  async function prepare() {
    const current = await refresh();
    if (current["attempt"] && typeof current["attempt"] === "object") {
      const saved = recover(current["attempt"] as Record<string, unknown>, current);
      if (saved.signature && ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(saved.status)) {
        restore(saved); setMessage("Подпись уже существует, включая сохранённую до ответа API. Выполните только finalized-проверку."); return;
      }
    }
    const payload = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ bufferAddress: buffer }) });
    restore(preparedProgramUpgrade(payload, current, walletAddress));
    setMessage("Проверьте этап, hash, адреса и стоимость. Прикладные изменения блокируются до подтверждения обновления.");
  }
  async function sign() {
    if (!plan || !reviewed || attempted) return;
    const current = await request(path);
    const payload = await request(path + "/prepare", { method: "POST", body: JSON.stringify({ bufferAddress: plan.bufferAddress }) });
    const next = preparedProgramUpgrade(payload, current, walletAddress);
    if (next.signature) { restore(next); setMessage("Подпись восстановлена. Выполните только finalized-проверку."); return; }
    if (next.serializedTransactionBase64 !== plan.serializedTransactionBase64 || next.operationId !== plan.operationId) {
      restore(next); throw new Error("План истёк или изменился. Проверьте новый план перед подписью.");
    }
    await signAndSubmitPrepared({ wallet, walletAddress, plan: next, request, submitPath: path + "/submit",
      onSigning: () => setAttempted(true), onSignature: value => {
        setSignature(value); sessionStorage.setItem(`program-upgrade:${next.operationId}`, value);
      } });
    setMessage("Подпись сохранена. Проверьте finalized той же попытки.");
  }
  async function confirm() {
    if (!plan) return;
    await waitForFinalizedCheck(() => request(path + "/confirm", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature }) }),
      plan.operationId, signature, () => setMessage("Ожидаю finalized исходной подписи."));
    await refresh(); setMessage(plan.phase === "EXTEND" ? "EXTEND подтверждён. Подготовьте и отдельно проверьте UPGRADE." :
      "UPGRADE проверен: hash кандидата, полномочия и сохранённые PDA совпадают. Блокировка снята; регистрацию начислений включают отдельно.");
  }
  if (!report?.["enabled"]) return null;
  const canWrite = role === "ADMINISTRATOR" && report["upgradeAuthority"] === walletAddress;
  return <details className="mt-6 rounded-xl border border-[#e4b45f] bg-[#fffaf0] p-4">
    <summary className="cursor-pointer font-semibold">Обновление программы · Localnet</summary>
    <p className="mt-3 text-sm">EXTEND увеличивает место для кода. UPGRADE устанавливает проверенный код отдельной подписью. Выпуск и сохранённые PDA проверяются после каждого этапа.</p>
    <p className="mt-3 break-all font-mono text-xs">Genesis: {String(report["genesisHash"])}<br />Program: {String(report["programId"])}<br />ProgramData: {String(report["programData"])}<br />Authority / payer / возврат rent: {String(report["upgradeAuthority"])}<br />Hash кандидата: {String(report["candidateSha256"])}</p>
    <p className="mt-2 text-sm">Состояние обслуживания: {String(report["maintenanceStatus"] ?? "не начато")}</p>
    <button className={`mt-3 ${button}`} disabled={busy} onClick={() => void run(async () => { await refresh(); })}>Проверить / восстановить</button>
    {canWrite && report["maintenanceStatus"] !== "VERIFIED" && <div className="mt-3">
      <label className="block text-sm">Адрес проверенного буфера<input className="mt-1 w-full rounded border p-2" value={buffer} disabled={busy || Boolean(report["maintenanceId"])} maxLength={44} onChange={event => setBuffer(event.target.value.trim())} /></label>
      <button className={`mt-3 ${button}`} disabled={busy || !buffer} onClick={() => void run(prepare)}>Подготовить / восстановить этап</button>
    </div>}
    {plan && canWrite && <div className="mt-4 border-t pt-3 text-sm">
      <p><strong>{plan.phase}</strong> · {plan.status} · {plan.additionalBytes} дополнительных байт</p>
      <p className="mt-1">Rent: {plan.extensionRentLamports} lamports · Комиссия: {plan.phaseFeeLamports} · Резерв: {plan.feeReserveLamports}</p>
      <p className="mt-2 break-all text-xs">Buffer: {plan.bufferAddress}<br />Попытка: {plan.operationId}<br />Hash исходного кода: {plan.retainedSha256}</p>
      <label className="mt-3 flex gap-2"><input type="checkbox" checked={reviewed} disabled={busy || attempted} onChange={event => setReviewed(event.target.checked)} />Проверил этап, сеть, программу, буфер, hash и стоимость</label>
      <button className={`mt-3 ${button}`} disabled={busy || attempted || !reviewed || !supportsPreparedTransaction(wallet, "localnet")} onClick={() => void run(sign)}>Подписать {plan.phase} в Phantom</button>
      <label className="mt-3 block">Сохранённая подпись<input className="mt-1 w-full rounded border p-2" value={signature} maxLength={88} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
      <button className={`mt-3 ${button}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>Проверить finalized и сохранённые PDA</button>
    </div>}
    <p role="status" className="mt-3 text-sm">{busy ? "Проверка… " : ""}{message}</p>
  </details>;
}

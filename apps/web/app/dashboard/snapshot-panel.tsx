"use client";

import type { Wallet } from "@wallet-standard/base";
import { useRef, useState } from "react";
import { isActionId, preparedSnapshot, requireFinalizedResponse, resumedDeploymentSignature, walletChainForCluster, type PreparedSnapshot, type SupportedSnapshotCluster } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { waitForFinalizedCheck } from "./finalized-check";
import { OperatorApiError } from "./operator-api";

type Props = {
  wallet: Wallet | undefined;
  walletAddress: string;
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onBusyChange: (busy: boolean) => void;
  selectedActionId?: string;
  onConfirmed?: () => void;
  onWindowMissed?: () => Promise<void>;
};

function networkDescription(cluster: SupportedSnapshotCluster): string {
  return cluster === "localnet"
    ? "Localnet — локальная тестовая сеть; публичный SOL не используется."
    : "Devnet — публичная тестовая сеть; комиссия оплачивается тестовым SOL.";
}

export function SnapshotPanel({ wallet, walletAddress, request, onBusyChange, selectedActionId, onConfirmed, onWindowMissed }: Props) {
  const [actionId, setActionId] = useState(selectedActionId ?? "");
  const [plan, setPlan] = useState<PreparedSnapshot | null>(null);
  const [operationId, setOperationId] = useState("");
  const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Укажите UUID существующего SCHEDULED действия. Сеть будет взята из проверенного плана API.");
  const inFlight = useRef(false);

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    try { await task(); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Операция не выполнена.");
      if (error instanceof OperatorApiError && error.code === "SNAPSHOT_WINDOW_MISSED" && onWindowMissed) {
        try { await onWindowMissed(); }
        catch { setMessage("Capture закрыт; обновить карточку не удалось. Обновите данные перед продолжением."); }
      }
    }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }

  async function prepare() {
    if (!isActionId(actionId)) throw new Error("Введите корректный UUID корпоративного действия.");
    const response = await request(`/api/v1/corporate-actions/${actionId}/snapshot/prepare`, { method: "POST", body: "{}" });
    const prepared = preparedSnapshot(response, actionId, walletAddress);
    const existingSignature = resumedDeploymentSignature(response);
    setPlan(prepared);
    setOperationId(prepared.operationId);
    setSignature(existingSignature ?? "");
    setReviewed(existingSignature !== null);
    setSendAttempted(existingSignature !== null);
    setFinalized(false);
    setMessage(existingSignature ? "Восстановлена подписанная попытка. Повторите только finalized-проверку." : "План подготовлен. Проверьте параметры и окно record date перед подписью.");
  }

  async function send() {
    if (!plan || !reviewed || sendAttempted || !supportsPreparedTransaction(wallet, plan.cluster)) {
      throw new Error("Нужен проверенный план и кошелёк с поддержкой его сети и транзакций v0.");
    }
    try {
      await signAndSubmitPrepared({ wallet, walletAddress, plan, request,
        submitPath: `/api/v1/corporate-actions/${actionId}/snapshot/submit`,
        onSigning: () => { setSendAttempted(true); setMessage("Проверьте запрос Phantom. При ошибке повторяйте только finalized-проверку."); },
        onSignature: setSignature
      });
      setMessage("Подпись получена. Сохраните UUID попытки и подпись; затем проверьте финализацию через API.");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : "Нет результата кошелька."} Проверьте историю кошелька и используйте восстановление ниже. Повторная отправка отключена.`);
    }
  }

  async function confirm() {
    if (!isActionId(actionId) || !isActionId(operationId) || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      throw new Error("Для проверки нужны UUID действия, UUID попытки и подпись транзакции из кошелька.");
    }
    const response = await waitForFinalizedCheck(() => request(`/api/v1/corporate-actions/${actionId}/snapshot/confirm`, {
      method: "POST", body: JSON.stringify({ operationId, signature })
    }), operationId, signature, () => setMessage("Ожидаем finalized по прежней подписи. Транзакция повторно не отправляется; проверка может занять около минуты."));
    requireFinalizedResponse(response, operationId, signature);
    setFinalized(true);
    onConfirmed?.();
    setMessage("FINALIZED: API проверил точную транзакцию и Action PDA. Snapshot подтверждён; выплат не было.");
  }

  const inputClass = "mt-2 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm";
  const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
  return (
    <section className="mt-6 border-t border-[#dbe5df] pt-6" aria-label="Регистрация snapshot">
      <h3 className="font-semibold">Регистрация snapshot · Localnet / Devnet</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-[#61746a]">
        <li>Укажите UUID уже запланированного действия.</li>
        <li>Проверьте сеть, signer и параметры снимка.</li>
        <li>Подпишите транзакцию и отдельно подтвердите finalized через API.</li>
      </ol>
      <p className="mt-2 text-xs leading-5 text-[#8a5b18]">DEMO_CAPTURE_SLOT фиксирует фактический finalized slot, а не доказывает владение на более раннюю дату. Регистрация не выполняет выплату.</p>
      <label className="mt-4 block text-sm">UUID корпоративного действия
        <input className={inputClass} value={actionId} maxLength={36} disabled={Boolean(selectedActionId) || busy || finalized || plan !== null} onChange={(event) => setActionId(event.target.value.trim())} />
      </label>
      <button className={`mt-3 ${buttonClass}`} disabled={busy || sendAttempted || finalized || signature !== "" || !plan && operationId !== "" || !isActionId(actionId)} onClick={() => void run(prepare)}>Подготовить / обновить неподписанный план</button>
      {plan && (
        <div className="mt-4 rounded-lg bg-[#f4f7f5] p-4">
          <p className="mb-3 rounded-md border border-[#cbd8d0] bg-white px-3 py-2 text-xs font-semibold">{networkDescription(plan.cluster)}</p>
          <dl className="space-y-2 text-xs">
            {Object.entries({ "Сеть": plan.cluster, "Genesis": plan.networkGenesisHash, "Signer / fee payer": plan.requiredSigner,
              "Программа": plan.programId, "Action PDA": plan.actionAddress, "Snapshot UUID": plan.snapshotId,
              "SHA-256": plan.snapshotHash, "Плановая дата": plan.recordAt, "Фактическое время": plan.effectiveBlockTime,
              "Finalized slot": plan.effectiveSlot, "Last valid block height": String(plan.lastValidBlockHeight) }).map(([label, value]) => (
              <div key={label}><dt className="text-[#61746a]">{label}</dt><dd className="break-all font-mono">{value}</dd></div>
            ))}
          </dl>
          <label className="mt-4 flex gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={(event) => setReviewed(event.target.checked)} />Проверил параметры, тестовую сеть и окно регистрации</label>
          <button className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || finalized || !supportsPreparedTransaction(wallet, plan.cluster)} onClick={() => void run(send)}>Подписать и отправить через Phantom</button>
          {!supportsPreparedTransaction(wallet, plan.cluster) && <p className="mt-2 text-xs">Нужен кошелёк с поддержкой {walletChainForCluster(plan.cluster)}, v0 и подписи транзакций.</p>}
        </div>
      )}
      <details className="mt-4" open={signature !== "" || sendAttempted}>
        <summary className="cursor-pointer text-sm font-medium">Подтверждение / восстановление отправленной операции</summary>
        <p className="mt-2 text-xs leading-5">Сохраните эти значения до закрытия страницы. После перезагрузки введите тот же UUID действия, попытку и подпись из истории кошелька. Проверка не отправляет транзакцию заново.</p>
        <label className="mt-3 block text-sm">UUID попытки<input className={inputClass} value={operationId} maxLength={36} disabled={busy || finalized || signature !== "" && plan !== null} onChange={(event) => setOperationId(event.target.value.trim())} /></label>
        <label className="mt-3 block text-sm">Подпись транзакции<input className={inputClass} value={signature} maxLength={88} disabled={busy || finalized} onChange={(event) => setSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || finalized} onClick={() => void run(confirm)}>Проверить finalized через API</button>
      </details>
      <p role="status" aria-live="polite" className="mt-4 text-xs leading-5">{busy ? "Операция выполняется… " : ""}{message}</p>
    </section>
  );
}

"use client";

import { SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { useRef, useState } from "react";
import { isActionId, preparedSnapshot, requireFinalizedResponse, transactionSignature, unsignedTransactionBytes, type PreparedSnapshot } from "./snapshot-workflow";

type TransactionWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignAndSendTransactionFeature>;
type Props = {
  wallet: Wallet | undefined;
  walletAddress: string;
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  onBusyChange: (busy: boolean) => void;
};

function transactionWallet(wallet: Wallet | undefined): wallet is TransactionWallet {
  const feature = wallet?.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;
  return typeof feature?.signAndSendTransaction === "function" && feature.supportedTransactionVersions.includes(0) &&
    wallet?.chains.includes("solana:devnet") === true;
}

export function SnapshotPanel({ wallet, walletAddress, request, onBusyChange }: Props) {
  const [actionId, setActionId] = useState("");
  const [plan, setPlan] = useState<PreparedSnapshot | null>(null);
  const [operationId, setOperationId] = useState("");
  const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Укажите UUID существующего SCHEDULED действия. Интерфейс поддерживает только Devnet.");
  const inFlight = useRef(false);

  async function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Операция не выполнена."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }

  async function prepare() {
    if (!isActionId(actionId)) throw new Error("Введите корректный UUID корпоративного действия.");
    const response = await request(`/api/v1/corporate-actions/${actionId}/snapshot/prepare`, { method: "POST", body: "{}" });
    const prepared = preparedSnapshot(response, actionId, walletAddress);
    setPlan(prepared);
    setOperationId(prepared.operationId);
    setSignature("");
    setReviewed(false);
    setSendAttempted(false);
    setFinalized(false);
    setMessage("План подготовлен. Проверьте параметры и окно record date перед подписью.");
  }

  async function send() {
    if (!plan || !reviewed || sendAttempted || !transactionWallet(wallet)) throw new Error("Нужен проверенный план и кошелёк с поддержкой Devnet / v0.");
    const connected = await wallet.features[StandardConnect].connect();
    const account = connected.accounts.find((candidate) => candidate.address === walletAddress &&
      candidate.chains.includes("solana:devnet") && candidate.features.includes(SolanaSignAndSendTransaction));
    if (!account || account.address !== plan.requiredSigner) throw new Error("Выбранный аккаунт не совпадает с кошельком сессии и issuer signer.");
    // Once the wallet is invoked, a failure can mean submission succeeded but its response was lost.
    setSendAttempted(true);
    setMessage("Проверьте запрос кошелька. При ошибке проверьте его историю; не отправляйте транзакцию повторно вслепую.");
    try {
      const [output] = await wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
        account, chain: "solana:devnet", transaction: unsignedTransactionBytes(plan.serializedTransactionBase64),
        options: { preflightCommitment: "confirmed", skipPreflight: false }
      });
      if (!output) throw new Error("Кошелёк не вернул результат отправки.");
      setSignature(transactionSignature(output.signature));
      setMessage("Подпись получена. Сохраните UUID попытки и подпись; затем проверьте финализацию через API.");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : "Нет результата кошелька."} Проверьте историю кошелька и используйте восстановление ниже. Повторная отправка отключена.`);
    }
  }

  async function confirm() {
    if (!isActionId(actionId) || !isActionId(operationId) || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      throw new Error("Для проверки нужны UUID действия, UUID попытки и подпись транзакции из кошелька.");
    }
    const response = await request(`/api/v1/corporate-actions/${actionId}/snapshot/confirm`, {
      method: "POST", body: JSON.stringify({ operationId, signature })
    });
    requireFinalizedResponse(response, operationId, signature);
    setFinalized(true);
    setMessage("FINALIZED: API проверил точную транзакцию и Action PDA. Snapshot подтверждён; выплат не было.");
  }

  const inputClass = "mt-2 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm";
  const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";
  return (
    <section className="mt-6 border-t border-[#dbe5df] pt-6" aria-label="Регистрация snapshot">
      <h3 className="font-semibold">Регистрация snapshot · Devnet</h3>
      <p className="mt-2 text-xs leading-5 text-[#8a5b18]">DEMO_CAPTURE_SLOT — снимок на фактическом finalized slot, а не доказательство владения на более раннюю дату. Транзакция расходует тестовый SOL, но не выполняет выплату.</p>
      <label className="mt-4 block text-sm">UUID корпоративного действия
        <input className={inputClass} value={actionId} maxLength={36} disabled={busy || finalized || plan !== null} onChange={(event) => setActionId(event.target.value.trim())} />
      </label>
      <button className={`mt-3 ${buttonClass}`} disabled={busy || sendAttempted || finalized || signature !== "" || !plan && operationId !== "" || !isActionId(actionId)} onClick={() => void run(prepare)}>Подготовить / обновить неподписанный план</button>
      {plan && (
        <div className="mt-4 rounded-lg bg-[#f4f7f5] p-4">
          <dl className="space-y-2 text-xs">
            {Object.entries({ "Сеть": plan.cluster, "Genesis": plan.networkGenesisHash, "Signer / fee payer": plan.requiredSigner,
              "Программа": plan.programId, "Action PDA": plan.actionAddress, "Snapshot UUID": plan.snapshotId,
              "SHA-256": plan.snapshotHash, "Плановая дата": plan.recordAt, "Фактическое время": plan.effectiveBlockTime,
              "Finalized slot": plan.effectiveSlot, "Last valid block height": String(plan.lastValidBlockHeight) }).map(([label, value]) => (
              <div key={label}><dt className="text-[#61746a]">{label}</dt><dd className="break-all font-mono">{value}</dd></div>
            ))}
          </dl>
          <label className="mt-4 flex gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={(event) => setReviewed(event.target.checked)} />Проверил параметры, тестовую сеть и окно регистрации</label>
          <button className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || finalized || !transactionWallet(wallet)} onClick={() => void run(send)}>Подписать и отправить через кошелёк</button>
          {!transactionWallet(wallet) && <p className="mt-2 text-xs">Нужен кошелёк с solana:signAndSendTransaction, Devnet и v0.</p>}
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

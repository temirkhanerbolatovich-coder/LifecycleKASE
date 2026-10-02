"use client";

import { SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { transactionSignature, unsignedTransactionForSigner, walletChainForCluster, type SupportedSnapshotCluster } from "./snapshot-workflow";

type Instrument = {
  id: string; name: string; ticker: string; network: string; status: string; issuerAuthority: string;
  faceValueMinor: string; couponRateBps: number; paymentsPerYear: number; issueAt: string; maturityAt: string;
  totalSupply: string; circulatingSupply: string; programId: string | null; mintAddress: string | null;
  issuer: { legalName: string };
  settlementAsset: { code: string; name: string; mintAddress: string | null; disclaimer: string };
};
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type TransactionWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignAndSendTransactionFeature>;
type DeploymentPlan = { operationId: string; phase: "MINT_SETUP"; cluster: SupportedSnapshotCluster;
  requiredSigner: string; networkGenesisHash: string; serializedTransactionBase64: string;
  bondMint?: string; settlementMint?: string; treasuryTokenAccount?: string };

function transactionWallet(wallet: Wallet | undefined, cluster: SupportedSnapshotCluster): wallet is TransactionWallet {
  const feature = wallet?.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;
  return typeof feature?.signAndSendTransaction === "function" && feature.supportedTransactionVersions.includes(0) &&
    wallet?.chains.includes(walletChainForCluster(cluster)) === true;
}

function deploymentPlan(value: Record<string, unknown>, instrument: Instrument, walletAddress: string): DeploymentPlan {
  const cluster = value["cluster"];
  const result = value as unknown as DeploymentPlan;
  if (value["phase"] !== "MINT_SETUP" || (cluster !== "localnet" && cluster !== "devnet") ||
      typeof value["operationId"] !== "string" || typeof value["serializedTransactionBase64"] !== "string" ||
      value["requiredSigner"] !== walletAddress || instrument.issuerAuthority !== walletAddress) {
    throw new Error("Сервер вернул несовместимый план выпуска или другой issuer signer.");
  }
  unsignedTransactionForSigner(result.serializedTransactionBase64, walletAddress);
  return result;
}

function shortAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

function formatMinor(value: string): string {
  if (!/^[0-9]+$/.test(value)) return value;
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function InstrumentPanel({ role, request, wallet, walletAddress, onBusyChange }: {
  role: string; request: Request; wallet: Wallet | undefined; walletAddress: string; onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<Instrument[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Загрузка инструментов…");
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [deployInstrumentId, setDeployInstrumentId] = useState("");
  const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false);
  const inFlight = useRef(false);

  async function runDeployment(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusyChange(true);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Операция выпуска не выполнена."); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }

  async function prepareDeployment(instrument: Instrument) {
    const response = await request(`/api/v1/instruments/${instrument.id}/deploy/prepare`, { method: "POST", body: "{}" });
    const prepared = deploymentPlan(response, instrument, walletAddress);
    setPlan(prepared); setDeployInstrumentId(instrument.id); setSignature(""); setReviewed(false); setSendAttempted(false);
    setMessage("Фаза MINT_SETUP подготовлена. Проверьте сеть и адреса перед подписью Phantom.");
  }

  async function sendDeployment() {
    if (!plan || !reviewed || sendAttempted || !transactionWallet(wallet, plan.cluster)) throw new Error("Нужен проверенный план и совместимый кошелёк транзакций v0.");
    const chain = walletChainForCluster(plan.cluster);
    const connected = await wallet.features[StandardConnect].connect();
    const account = connected.accounts.find(candidate => candidate.address === walletAddress && candidate.chains.includes(chain) && candidate.features.includes(SolanaSignAndSendTransaction));
    if (!account) throw new Error("Выбранный аккаунт Phantom не совпадает с issuer кошельком сессии.");
    setSendAttempted(true);
    setMessage("Проверьте транзакцию MINT_SETUP в Phantom. При неясном результате не отправляйте её повторно вслепую.");
    const [output] = await wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
      account, chain, transaction: unsignedTransactionForSigner(plan.serializedTransactionBase64, walletAddress),
      options: { preflightCommitment: "confirmed", skipPreflight: false }
    });
    if (!output) throw new Error("Кошелёк не вернул подпись. Проверьте историю Phantom.");
    setSignature(transactionSignature(output.signature));
    setMessage("Транзакция отправлена. Теперь отдельно подтвердите finalized через API.");
  }

  async function confirmDeployment() {
    if (!plan || !signature) throw new Error("Нет подготовленной попытки и подписи транзакции.");
    const response = await request(`/api/v1/instruments/${deployInstrumentId}/deploy/confirm`, {
      method: "POST", body: JSON.stringify({ operationId: plan.operationId, signature })
    });
    if (response["status"] !== "FINALIZED" || response["operationId"] !== plan.operationId || response["signature"] !== signature) {
      throw new Error("API не подтвердил точную finalized-транзакцию.");
    }
    setPlan(null); setDeployInstrumentId(""); setSignature(""); setReviewed(false); setSendAttempted(false);
    await load();
    setMessage("MINT_SETUP FINALIZED: два mint проверены, bond supply 35, mint authority отозвана. Следующая фаза — распределение 10/20/5.");
  }

  async function load(cursor?: string, signal?: AbortSignal) {
    const result = await request(`/api/v1/instruments?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (!Array.isArray(result["items"])) throw new Error("Некорректный ответ реестра инструментов.");
    const rows = result["items"] as Instrument[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
    setMessage(rows.length === 0 && !cursor
      ? "Инструментов пока нет. Администратор может создать безопасный database draft."
      : "Реестр инструментов загружен.");
  }

  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    void load(undefined, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Инструменты недоступны.");
    }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [request]);

  async function refresh(cursor?: string) {
    setBusy(true);
    try { await load(cursor); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить инструменты."); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const issueDate = String(data.get("issueDate"));
    const maturityDate = String(data.get("maturityDate"));
    setBusy(true);
    try {
      await request("/api/v1/instruments", { method: "POST", body: JSON.stringify({
        issuerLegalName: data.get("issuerLegalName"), name: data.get("name"), ticker: data.get("ticker"),
        faceValueKzt: data.get("faceValueKzt"), couponRateBps: Number(data.get("couponRateBps")),
        paymentsPerYear: Number(data.get("paymentsPerYear")),
        issueAt: `${issueDate}T00:00:00.000Z`, maturityAt: `${maturityDate}T00:00:00.000Z`
      }) });
      form.reset();
      try {
        await load();
        setMessage("Draft создан и записан в аудит. Токены ещё не выпущены, on-chain адреса отсутствуют.");
      } catch {
        setMessage("Draft создан, но список не обновился. Нажмите «Обновить» и не создавайте его повторно.");
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Не удалось создать draft."} При потере ответа сначала обновите список.`);
    } finally { setBusy(false); }
  }

  const inputClass = "mt-1.5 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2.5 text-sm";
  const buttonClass = "rounded-lg border border-[#b9c9c0] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return <section className="mt-6 border-t border-[#dbe5df] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#28744a]">Инструменты</p>
        <h3 className="mt-1 text-lg font-semibold">Тестовые облигации</h3>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-[#8a5b18]">Статус DRAFT означает только запись в PostgreSQL. Он не подтверждает mint, выпуск токенов или регистрацию в Solana.</p>
      </div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}>Обновить</button>
    </div>

    {role === "ADMINISTRATOR" && <form className="mt-5 grid gap-3 rounded-xl border border-[#dbe5df] p-4 lg:grid-cols-2" onSubmit={event => void create(event)}>
      <div className="lg:col-span-2"><p className="text-xs font-bold text-[#28744a]">ШАГ 1</p><h4 className="mt-1 font-semibold">Создать database draft</h4><p className="mt-1 text-xs leading-5 text-[#61746a]">Кошелёк текущей сессии станет issuer authority. Supply фиксирован: 35 неделимых bond tokens; circulating supply до выпуска равен 0.</p></div>
      <label className="block text-sm">Эмитент<input className={inputClass} name="issuerLegalName" required minLength={2} maxLength={250} placeholder="LifecycleKASE Demo Issuer" disabled={busy} /></label>
      <label className="block text-sm">Название облигации<input className={inputClass} name="name" required minLength={2} maxLength={250} placeholder="Canonical Demo Bond" disabled={busy} /></label>
      <label className="block text-sm">Тикер<input className={`${inputClass} uppercase`} name="ticker" required minLength={2} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9.-]+" placeholder="KDB26" disabled={busy} /></label>
      <label className="block text-sm">Номинал, целых KZT-Test<input className={inputClass} name="faceValueKzt" type="number" required min="1" max="9223372036854" step="1" defaultValue="1000" disabled={busy} /></label>
      <label className="block text-sm">Купон, bps<input className={inputClass} name="couponRateBps" type="number" required min="0" max="100000" step="1" defaultValue="1000" disabled={busy} /><span className="mt-1 block text-xs text-[#61746a]">1000 bps = 10%</span></label>
      <label className="block text-sm">Выплат в год<select className={inputClass} name="paymentsPerYear" defaultValue="2" disabled={busy}><option value="1">1</option><option value="2">2</option><option value="4">4</option></select></label>
      <label className="block text-sm">Дата выпуска<input className={inputClass} name="issueDate" type="date" required disabled={busy} /></label>
      <label className="block text-sm">Дата погашения<input className={inputClass} name="maturityDate" type="date" required disabled={busy} /></label>
      <div className="lg:col-span-2"><button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy}>Создать draft</button></div>
    </form>}

    <div className="mt-5 space-y-3">
      {items.length === 0 && !busy && <div className="rounded-xl border border-dashed border-[#cbd8d0] p-5 text-sm text-[#61746a]">Пока нет ни одного инструмента.</div>}
      {items.map(instrument => <article className="rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" key={instrument.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{instrument.ticker} · {instrument.name}</p><p className="mt-1 text-xs text-[#61746a]">Эмитент: {instrument.issuer.legalName}</p></div>
          <span className="status-wait">{instrument.status === "DRAFT" ? "Draft · не в сети" : instrument.status}</span>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-[#61746a]">Сеть</dt><dd>{instrument.network}</dd></div>
          <div><dt className="text-[#61746a]">Issuer authority</dt><dd className="font-mono" title={instrument.issuerAuthority}>{shortAddress(instrument.issuerAuthority)}</dd></div>
          <div><dt className="text-[#61746a]">Номинал</dt><dd>{formatMinor(instrument.faceValueMinor)} KZT-Test</dd></div>
          <div><dt className="text-[#61746a]">Купон</dt><dd>{instrument.couponRateBps} bps · {instrument.paymentsPerYear} выплат/год</dd></div>
          <div><dt className="text-[#61746a]">Supply</dt><dd>{instrument.circulatingSupply} / {instrument.totalSupply}</dd></div>
          <div><dt className="text-[#61746a]">Срок</dt><dd>{instrument.issueAt.slice(0, 10)} → {instrument.maturityAt.slice(0, 10)}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-[#8a5b18]">{instrument.programId && instrument.mintAddress
          ? `Program: ${shortAddress(instrument.programId)} · Mint: ${shortAddress(instrument.mintAddress)}`
          : "Следующий этап: подготовить mint/distribution/authority revocation и подписать deploy-транзакции кошельком."}</p>
        {role === "ADMINISTRATOR" && instrument.status === "DRAFT" && !instrument.mintAddress && (
          <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null}
            onClick={() => void runDeployment(() => prepareDeployment(instrument))}>Подготовить фазу MINT_SETUP</button>
        )}
        {instrument.mintAddress && <p className="mt-2 text-xs text-[#28744a]">Mint setup подтверждён: {shortAddress(instrument.mintAddress)}. Инструмент остаётся DRAFT до распределения, initialize и activate.</p>}
      </article>)}
    </div>
    {plan && <div className="mt-4 rounded-xl border border-[#d3b779] bg-[#fffaf0] p-4 text-sm">
      <p className="font-semibold">Проверка фазы MINT_SETUP</p>
      <p className="mt-2 text-xs leading-5">Сеть: <strong>{plan.cluster}</strong>. Будут созданы тестовые bond и KZT-Test mint, выпущено 35 bond tokens в treasury и отозвана mint authority. Распределение инвесторам и активация ещё не выполняются.</p>
      <dl className="mt-3 space-y-1 text-xs"><div><dt className="text-[#61746a]">Signer</dt><dd className="break-all font-mono">{plan.requiredSigner}</dd></div>
        {plan.bondMint && <div><dt className="text-[#61746a]">Bond mint</dt><dd className="break-all font-mono">{plan.bondMint}</dd></div>}
        {plan.settlementMint && <div><dt className="text-[#61746a]">KZT-Test mint</dt><dd className="break-all font-mono">{plan.settlementMint}</dd></div>}</dl>
      <label className="mt-3 flex gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={event => setReviewed(event.target.checked)} />Проверил тестовую сеть, signer и необратимый отзыв mint authority</label>
      <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || !transactionWallet(wallet, plan.cluster)}
        onClick={() => void runDeployment(sendDeployment)}>Подписать и отправить MINT_SETUP</button>
      {sendAttempted && <div className="mt-3"><p className="text-xs">UUID попытки: <span className="font-mono">{plan.operationId}</span></p>
        <label className="mt-2 block text-xs">Подпись из Phantom<input className={inputClass} value={signature} maxLength={88} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
        <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || signature.length < 64}
          onClick={() => void runDeployment(confirmDeployment)}>Проверить finalized и состояние mint</button></div>}
    </div>}
    {nextCursor && <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy} onClick={() => void refresh(nextCursor)}>Загрузить ещё</button>}
    <p role="status" aria-live="polite" className="mt-4 text-xs leading-5 text-[#61746a]">{busy ? "Операция выполняется… " : ""}{message}</p>
  </section>;
}

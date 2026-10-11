"use client";

import { SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature,
  SolanaSignTransaction, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletWithFeatures } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { resumedDeploymentSignature, signedPreparedTransaction, transactionSignature, unsignedTransactionForSigner, walletChainForCluster,
  type SupportedSnapshotCluster } from "./snapshot-workflow";

import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone } from "./workspace-presentation";
import { workspaceSelectionFromHash, workspaceSectionHash, workspaceSectionFromHash } from "./workspace-navigation";

import { useLocale, useLocalizedTextState } from "./locale-context";

type Instrument = {
  id: string; name: string; ticker: string; network: string; status: string; issuerAuthority: string;
  faceValueMinor: string; couponRateBps: number; paymentsPerYear: number; issueAt: string; maturityAt: string;
  totalSupply: string; circulatingSupply: string; programId: string | null; mintAddress: string | null;
  issuer: { legalName: string };
  settlementAsset: { code: string; name: string; mintAddress: string | null; disclaimer: string };
};
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const INSTRUMENT_STATUS_LABELS: Record<string, string> = { DRAFT: "Черновик", DEPLOYING: "Выпуск", ACTIVE: "Активен", PAUSED: "Приостановлен", REDEEMED: "Погашен" };
type SendingWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignAndSendTransactionFeature>;
type SigningWallet = WalletWithFeatures<StandardConnectFeature & SolanaSignTransactionFeature>;
type DistributionAllocation = { investorId: string; walletAddress: string; tokenAccount: string; amount: string };
type DistributionCandidate = { investorId: string; displayName: string; walletAddress: string };
type DistributionDraft = { instrument: Instrument; candidates: DistributionCandidate[]; selections: Record<string, string> };
type DeploymentPhase = "MINT_SETUP" | "DISTRIBUTION" | "INITIALIZE" | "ACTIVATE";
type DeploymentPlan = { operationId: string; phase: DeploymentPhase; cluster: SupportedSnapshotCluster;
  requiredSigner: string; networkGenesisHash: string; serializedTransactionBase64: string;
  bondMint?: string; settlementMint?: string; treasuryTokenAccount?: string; instrumentAddress?: string;
  allocations?: DistributionAllocation[] };

function transactionWallet(wallet: Wallet | undefined, cluster: SupportedSnapshotCluster): boolean {
  const connectFeature = wallet?.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect] | undefined;
  if (!wallet?.chains.includes(walletChainForCluster(cluster)) || typeof connectFeature?.connect !== "function") return false;
  if (cluster === "localnet") {
    const feature = wallet.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction] | undefined;
    return typeof feature?.signTransaction === "function" && feature.supportedTransactionVersions.includes(0);
  }
  const feature = wallet.features[SolanaSignAndSendTransaction] as SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction] | undefined;
  return typeof feature?.signAndSendTransaction === "function" && feature.supportedTransactionVersions.includes(0);
}

function deploymentPlan(value: Record<string, unknown>, instrument: Instrument, walletAddress: string): DeploymentPlan {
  const cluster = value["cluster"];
  const result = value as unknown as DeploymentPlan;
  if (!["MINT_SETUP", "DISTRIBUTION", "INITIALIZE", "ACTIVATE"].includes(String(value["phase"])) ||
      (cluster !== "localnet" && cluster !== "devnet") ||
      typeof value["operationId"] !== "string" || typeof value["serializedTransactionBase64"] !== "string" ||
      value["requiredSigner"] !== walletAddress || instrument.issuerAuthority !== walletAddress) {
    throw new Error("Сервер вернул несовместимый план выпуска или другой issuer signer.");
  }
  if ((value["phase"] === "DISTRIBUTION" || value["phase"] === "ACTIVATE") &&
      (!Array.isArray(value["allocations"]) || value["allocations"].length !== 3)) {
    throw new Error("Сервер вернул неполный план держателей.");
  }
  if ((value["phase"] === "INITIALIZE" || value["phase"] === "ACTIVATE") && typeof value["instrumentAddress"] !== "string") {
    throw new Error("Сервер не вернул Instrument PDA.");
  }
  unsignedTransactionForSigner(result.serializedTransactionBase64, walletAddress);
  return result;
}

function shortAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

function phaseSummary(phase: DeploymentPhase): string {
  if (phase === "MINT_SETUP") return "Будут созданы два mint, выпущено 35 bond tokens в treasury и необратимо отозвана mint authority.";
  if (phase === "DISTRIBUTION") return "35 bond tokens будут переведены трём проверенным инвесторам в долях 10/20/5.";
  if (phase === "INITIALIZE") return "Будет создан Instrument PDA со статусом Deploying и точными условиями инструмента.";
  return "После повторной проверки eligibility и балансов Instrument PDA перейдёт из Deploying в Active.";
}

function phaseReview(phase: DeploymentPhase): string {
  if (phase === "MINT_SETUP") return "Проверил сеть, signer и необратимый отзыв mint authority";
  if (phase === "DISTRIBUTION") return "Проверил сеть, signer, три кошелька и доли 10/20/5";
  if (phase === "INITIALIZE") return "Проверил сеть, signer, Instrument PDA и неизменяемые условия инструмента";
  return "Проверил signer, актуальный eligibility и полное покрытие supply балансами держателей";
}

export function InstrumentPanel({ role, request, wallet, walletAddress, onBusyChange, renderQaControls }: {
  role: string; request: Request; wallet: Wallet | undefined; walletAddress: string; onBusyChange: (busy: boolean) => void;
  renderQaControls?: ((instrument: { id: string; status: string }, onChanged: () => Promise<void>) => ReactNode) | undefined;
}) {
  const { t, formatDate, formatAmount, displayMessage } = useLocale();
  const statusLabels = Object.fromEntries(Object.entries(INSTRUMENT_STATUS_LABELS)
    .map(([status, label]) => [status, displayMessage(label)]));
  const [items, setItems] = useState<Instrument[]>([]);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [detailId, setDetailId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      if (detailId) document.getElementById(`instrument-${detailId}`)?.focus({ preventScroll: true });
      else listView.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    });
  }, [detailId]);
  const listPosition = useRef(0);
  function chooseRecord(id: string) { listPosition.current = window.scrollY; setDetailId(id); window.history.replaceState(null,"",workspaceSectionHash("instruments",id)); }
  function backToList() { setDetailId(""); window.history.replaceState(null,"",workspaceSectionHash("instruments")); requestAnimationFrame(()=>window.scrollTo({top:listPosition.current,behavior:"instant"})); }
  useEffect(()=>{ const sync=()=>{if(workspaceSectionFromHash(window.location.hash)==="instruments") setDetailId(workspaceSelectionFromHash(window.location.hash,"instruments")??"");}; sync();window.addEventListener("hashchange",sync);return()=>window.removeEventListener("hashchange",sync); },[]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useLocalizedTextState();
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [deployInstrumentId, setDeployInstrumentId] = useState("");
  const [signature, setSignature] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false);
  const [distributionDraft, setDistributionDraft] = useState<DistributionDraft | null>(null);
  const inFlight = useRef(false);

  async function runDeployment(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setError(null); setBusy(true); onBusyChange(true);
    try { await task(); }
    catch (error) { setError(error instanceof Error ? error.message : t("registry.instrument.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.instrument.deploymentFailed")); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }

  function acceptPreparedPlan(response: Record<string, unknown>, instrument: Instrument): boolean {
    const prepared = deploymentPlan(response, instrument, walletAddress);
    const previousSignature = resumedDeploymentSignature(response);
    setPlan(prepared); setDeployInstrumentId(instrument.id); setSignature(previousSignature ?? "");
    setReviewed(previousSignature !== null); setSendAttempted(previousSignature !== null);
    return previousSignature !== null;
  }

  async function prepareDeployment(instrument: Instrument) {
    const response = await request(`/api/v1/instruments/${instrument.id}/deploy/prepare`, {
      method: "POST", body: JSON.stringify({ phase: "MINT_SETUP" })
    });
    if (acceptPreparedPlan(response, instrument)) {
      setMessage(t("registry.instrument.resumed"));
      return;
    }
    setMessage(t("registry.instrument.mintPrepared"));
  }

  async function prepareLifecycle(instrument: Instrument, phase: "INITIALIZE" | "ACTIVATE") {
    const response = await request(`/api/v1/instruments/${instrument.id}/deploy/prepare`, {
      method: "POST", body: JSON.stringify({ phase })
    });
    if (acceptPreparedPlan(response, instrument)) {
      setMessage(t("registry.instrument.resumed"));
      return;
    }
    setMessage(phase === "INITIALIZE"
      ? t("registry.instrument.initializePrepared")
      : t("registry.instrument.activatePrepared"));
  }

  async function startDistribution(instrument: Instrument) {
    const response = await request("/api/v1/investors?limit=100");
    if (!Array.isArray(response["items"])) throw new Error(t("registry.instrument.invalidInvestorResponse"));
    const candidates: DistributionCandidate[] = [];
    for (const value of response["items"] as Record<string, unknown>[]) {
      if (value["status"] !== "ACTIVE" || value["eligibilityStatus"] !== "ELIGIBLE" ||
          typeof value["id"] !== "string" || typeof value["displayName"] !== "string" || !Array.isArray(value["wallets"])) continue;
      for (const wallet of value["wallets"] as Record<string, unknown>[]) {
        if (wallet["status"] === "ACTIVE" && typeof wallet["verifiedAt"] === "string" &&
            wallet["revokedAt"] === null && typeof wallet["address"] === "string") {
          candidates.push({ investorId: value["id"], displayName: value["displayName"], walletAddress: wallet["address"] });
        }
      }
    }
    const firstByInvestor = [...new Map(candidates.map(candidate => [candidate.investorId, candidate])).values()];
    if (firstByInvestor.length < 3) throw new Error(t("registry.instrument.threeInvestorsRequired"));
    setDistributionDraft({ instrument, candidates, selections: {
      "10": firstByInvestor[0]!.walletAddress, "20": firstByInvestor[1]!.walletAddress, "5": firstByInvestor[2]!.walletAddress
    } });
    setMessage(t("registry.instrument.selectAllocations"));
  }

  async function prepareDistribution() {
    if (!distributionDraft) throw new Error(t("registry.instrument.selectInstrumentFirst"));
    const selected = Object.values(distributionDraft.selections);
    if (new Set(selected).size !== 3) throw new Error(t("registry.instrument.separateInvestor"));
    const selectedInvestors = selected.map(address => distributionDraft.candidates.find(candidate => candidate.walletAddress === address)?.investorId);
    if (selectedInvestors.some(value => value === undefined) || new Set(selectedInvestors).size !== 3) {
      throw new Error(t("registry.instrument.distinctInvestors"));
    }
    const response = await request(`/api/v1/instruments/${distributionDraft.instrument.id}/deploy/prepare`, {
      method: "POST", body: JSON.stringify({ phase: "DISTRIBUTION", allocations: ["10", "20", "5"].map(amount => ({
        walletAddress: distributionDraft.selections[amount], amount
      })) })
    });
    const resumed = acceptPreparedPlan(response, distributionDraft.instrument);
    setDistributionDraft(null);
    if (resumed) {
      setMessage(t("registry.instrument.distributionResumed"));
      return;
    }
    setMessage(t("registry.instrument.distributionPrepared"));
  }

  async function sendDeployment() {
    if (!plan || !reviewed || sendAttempted || !transactionWallet(wallet, plan.cluster)) throw new Error(t("registry.instrument.reviewedPlanRequired"));
    const chain = walletChainForCluster(plan.cluster);
    const connected = await (wallet as WalletWithFeatures<StandardConnectFeature>).features[StandardConnect].connect();
    const requiredFeature = plan.cluster === "localnet" ? SolanaSignTransaction : SolanaSignAndSendTransaction;
    const account = connected.accounts.find(candidate => candidate.address === walletAddress &&
      candidate.chains.includes(chain) && candidate.features.includes(requiredFeature));
    if (!account) throw new Error(t("registry.instrument.phantomIssuerMismatch"));
    setMessage(t("registry.instrument.phantomReview", { phase: plan.phase }));
    const unsignedTransaction = unsignedTransactionForSigner(plan.serializedTransactionBase64, walletAddress);
    if (plan.cluster === "localnet") {
      const signingWallet = wallet as SigningWallet;
      const [output] = await signingWallet.features[SolanaSignTransaction].signTransaction({
        account, chain, transaction: unsignedTransaction, options: { preflightCommitment: "confirmed" }
      });
      if (!output) throw new Error(t("registry.instrument.missingSignedTransaction"));
      const signed = signedPreparedTransaction(output.signedTransaction, plan.serializedTransactionBase64, walletAddress);
      setSignature(signed.signature); setSendAttempted(true);
      const response = await request(`/api/v1/instruments/${deployInstrumentId}/deploy/submit`, {
        method: "POST", body: JSON.stringify({ phase: plan.phase, operationId: plan.operationId,
          signedTransactionBase64: signed.signedTransactionBase64 })
      });
      if (response["operationId"] !== plan.operationId || response["signature"] !== signed.signature ||
          !["SUBMITTED", "FINALIZED"].includes(String(response["status"]))) {
        throw new Error(t("registry.instrument.exactSubmissionMissing"));
      }
      setMessage(t("registry.instrument.localnetSubmitted"));
      return;
    }
    const sendingWallet = wallet as SendingWallet;
    const [output] = await sendingWallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
      account, chain, transaction: unsignedTransaction,
      options: { preflightCommitment: "confirmed", skipPreflight: false }
    });
    if (!output) throw new Error(t("registry.instrument.missingSignature"));
    setSignature(transactionSignature(output.signature)); setSendAttempted(true);
    setMessage(t("registry.instrument.walletSubmitted"));
  }

  async function confirmDeployment() {
    if (!plan || !signature) throw new Error(t("registry.instrument.missingAttempt"));
    const response = await request(`/api/v1/instruments/${deployInstrumentId}/deploy/confirm`, {
      method: "POST", body: JSON.stringify({ phase: plan.phase, operationId: plan.operationId, signature })
    });
    if (response["status"] !== "FINALIZED" || response["operationId"] !== plan.operationId || response["signature"] !== signature) {
      throw new Error(t("registry.instrument.exactFinalizedMissing"));
    }
    const completedPhase = plan.phase;
    setPlan(null); setDeployInstrumentId(""); setSignature(""); setReviewed(false); setSendAttempted(false);
    await load();
    const messages: Record<DeploymentPhase, string> = {
      MINT_SETUP: t("registry.instrument.mintFinalized"),
      DISTRIBUTION: t("registry.instrument.distributionFinalized"),
      INITIALIZE: t("registry.instrument.initializeFinalized"),
      ACTIVATE: t("registry.instrument.activateFinalized")
    };
    setMessage(messages[completedPhase]);
  }

  async function load(cursor?: string, signal?: AbortSignal) {
    const result = await request(`/api/v1/instruments?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (!Array.isArray(result["items"])) throw new Error(t("registry.instrument.invalidRegistryResponse"));
    const rows = result["items"] as Instrument[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
    setMessage("");
  }

  useEffect(() => {
    const abort = new AbortController();
    setError(null); setBusy(true);
    void load(undefined, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t("registry.instrument.registryUnavailable"));
    }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [request]);

  async function refresh(cursor?: string) {
    setError(null); setBusy(true);
    try { await load(cursor); }
    catch (error) { setError(error instanceof Error ? error.message : t("registry.instrument.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.instrument.loadFailed")); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const issueDate = String(data.get("issueDate"));
    const maturityDate = String(data.get("maturityDate"));
    setCreateError(null); setError(null); setBusy(true);
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
        setMessage(renderQaControls ? t("registry.instrument.qaDraftCreated") : t("registry.instrument.draftCreated"));
      } catch {
        setMessage(t("registry.instrument.draftCreatedRefreshFailed"));
      }
    } catch (error) { setCreateError(error instanceof Error ? error.message : t("registry.instrument.requestFailed")); setError(error instanceof Error ? error.message : t("registry.instrument.requestFailed"));
      setMessage(t("registry.instrument.createRecovery"));
    } finally { setBusy(false); }
  }

  const visible = filterRegistry(items, filters, row=>[row.ticker,row.name,row.issuer.legalName,row.id].join(" "),row=>row.status,row=>row.ticker);
  const inputClass = "mt-1.5 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2.5 text-sm";
  const buttonClass = "rounded-lg border border-[#b9c9c0] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return <section className="mt-6 border-t border-[#dbe5df] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="mt-1 text-lg font-semibold">{t("registry.instrument.title")}</h3>
        <details className="term-help"><summary>{t("registry.instrument.deploymentHelp")}</summary><p>{renderQaControls ? t("registry.instrument.qaDraftHelp") : t("registry.instrument.draftHelp")}</p></details>
      </div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}>{t("registry.instrument.refresh")}</button>
    </div>
    {role !== "ADMINISTRATOR" && <p className="access-note mt-3">{t("registry.instrument.readOnly")}</p>}

    {role === "ADMINISTRATOR" && <details className="advanced-details mt-5">
      <summary>{t("registry.instrument.newInstrument")}</summary>
      <form className="mb-4 grid gap-3 lg:grid-cols-2" onSubmit={event => void create(event)}>
        <div className="lg:col-span-2">
      <h4 className="mt-1 font-semibold">{t("registry.instrument.createDraftTitle")}</h4>
      <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.instrument.supplyHelp")}</p>
      </div>
        <label className="block text-sm">{t("registry.instrument.issuerField")}<input className={inputClass} name="issuerLegalName" required minLength={2} maxLength={250} placeholder="LifecycleKASE Demo Issuer" disabled={busy} /></label>
        <label className="block text-sm">{t("registry.instrument.bondNameField")}<input className={inputClass} name="name" required minLength={2} maxLength={250} placeholder={t("registry.instrument.bondNamePlaceholder")} disabled={busy} /></label>
        <label className="block text-sm">{t("registry.instrument.tickerField")}<input className={`${inputClass} uppercase`} name="ticker" required minLength={2} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9.-]+" placeholder="KDB26" disabled={busy} /></label>
        <label className="block text-sm">{t("registry.instrument.faceValueField")}<input className={inputClass} name="faceValueKzt" type="number" required min="1" max="9223372036854" step="1" defaultValue="1000" disabled={busy} /></label>
        <label className="block text-sm">{t("registry.instrument.couponField")}<input className={inputClass} name="couponRateBps" type="number" required min="0" max="100000" step="1" defaultValue="1000" disabled={busy} />
      <span className="mt-1 block text-xs text-[#61746a]">1000 bps = 10%</span>
      </label>
        <label className="block text-sm">{t("registry.instrument.frequencyField")}<select className={inputClass} name="paymentsPerYear" defaultValue="2" disabled={busy}><option value="1">1</option><option value="2">2</option><option value="4">4</option></select></label>
        <label className="block text-sm">{t("registry.instrument.issueDateField")}<input className={inputClass} name="issueDate" type="date" required disabled={busy} /></label>
        <label className="block text-sm">{t("registry.instrument.maturityDateField")}<input className={inputClass} name="maturityDate" type="date" required disabled={busy} /></label>
        {createError && <p role="alert" className="form-error lg:col-span-2">{displayMessage(createError)}{" "}{t("registry.instrument.fieldsPreserved")}</p>}
        <div className="lg:col-span-2"><button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy}>{t("registry.instrument.createDraft")}</button><button type="button" disabled={busy} className="secondary-button ml-2" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{t("registry.instrument.cancel")}</button></div>
      </form>
    </details>}


    <div ref={listView} hidden={Boolean(detailId)}>
      <RegistryToolbar label={t("registry.instrument.registryLabel")} filters={filters} onChange={setFilters} statuses={statusLabels} loaded={items.length} shown={visible.length} sortLabel={t("registry.instrument.ticker")} />
      {busy && items.length === 0 && <RegistrySkeleton />}
      <div className="table-scroll" hidden={items.length === 0} tabIndex={0} role="region" aria-label={t("registry.instrument.tableLabel")}>
      <table className="registry-table">
      <thead>
      <tr>
      <th>{t("registry.instrument.instrument")}</th>
      <th>{t("registry.instrument.status")}</th>
      <th className="numeric">{t("registry.instrument.circulatingTotal")}</th>
      <th>{t("registry.instrument.maturity")}</th>
      </tr>
      </thead>
      <tbody>{visible.map(instrument=>
      <tr key={instrument.id}>
      <td>
      <button type="button" className="table-object-link" disabled={busy} onClick={() => chooseRecord(instrument.id)}>{instrument.name}</button>
      <span className="table-secondary">{instrument.ticker}</span>
      </td>
      <td>
      <span className={"status-"+statusTone(instrument.status)}>{statusLabels[instrument.status]??instrument.status}</span>
      </td>
      <td className="numeric">{instrument.circulatingSupply} / {instrument.totalSupply}</td>
      <td>{formatDate(instrument.maturityAt, "UTC", true)}</td>
      </tr>)}</tbody>
      </table>
      </div>
      {!busy&&!error&&visible.length===0&&<p className="empty-state">{items.length===0?t("registry.instrument.noInstruments"):t("registry.instrument.noMatches")}</p>}
    </div>
    {detailId&&<button type="button" className="secondary-button mt-4" disabled={busy} onClick={backToList}>{t("registry.instrument.back")}</button>}
    {detailId&&!items.some(row=>row.id===detailId)&&<p className="empty-state">{t("registry.instrument.missingRecord")}</p>}
    <div className="mt-5 space-y-3">
      {items.length === 0 && !busy && <div className="rounded-xl border border-dashed border-[#cbd8d0] p-5 text-sm text-[#61746a]">{t("registry.instrument.emptyRegistry")}</div>}
      {items.map(instrument => <article className="record-detail rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" id={`instrument-${instrument.id}`} tabIndex={-1} key={instrument.id} hidden={detailId!==instrument.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold">{instrument.ticker} · {instrument.name}</p><p className="mt-1 text-xs text-[#61746a]">{t("registry.instrument.issuerLabel")}{" "}{instrument.issuer.legalName}</p></div>
          <span className={`status-${statusTone(instrument.status)}`}>{instrument.status === "DRAFT" ? t("registry.instrument.draftOffline") : statusLabels[instrument.status] ?? instrument.status}</span>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div><dt className="text-[#61746a]">{t("registry.instrument.network")}</dt><dd>{instrument.network}</dd></div>
          <div><dt className="text-[#61746a]">{t("registry.instrument.issuerWallet")}</dt><dd><CopyValue value={instrument.issuerAuthority} label={t("registry.instrument.issuerWallet")} /></dd></div>
          <div><dt className="text-[#61746a]">{t("registry.instrument.faceValue")}</dt><dd>{formatAmount(instrument.faceValueMinor)}</dd></div>
          <div><dt className="text-[#61746a]">{t("registry.instrument.coupon")}</dt><dd>{instrument.couponRateBps} bps · {instrument.paymentsPerYear}{" "}{t("registry.instrument.paymentsPerYear")}</dd></div>
          <div><dt className="text-[#61746a]">{t("registry.instrument.circulatingSupply")}</dt><dd>{instrument.circulatingSupply} / {instrument.totalSupply}</dd></div>
          <div><dt className="text-[#61746a]">{t("registry.instrument.term")}</dt><dd>{formatDate(instrument.issueAt, "UTC", true)} → {formatDate(instrument.maturityAt, "UTC", true)}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-[#8a5b18]">{renderQaControls ? t("registry.instrument.qaState") : instrument.programId && instrument.mintAddress
          ? `Program: ${shortAddress(instrument.programId)} · Mint: ${shortAddress(instrument.mintAddress)}`
          : t("registry.instrument.nextDeployment")}</p>
        {renderQaControls?.(instrument, async () => { await load(); })}
        {!renderQaControls && role === "ADMINISTRATOR" && instrument.status === "DRAFT" && !instrument.mintAddress && (
          <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null}
            onClick={() => void runDeployment(() => prepareDeployment(instrument))}>{t("registry.instrument.prepareMint")}</button>
        )}
        {!renderQaControls && instrument.status === "DRAFT" && instrument.mintAddress && instrument.circulatingSupply === "0" && <>
          <p className="mt-2 text-xs text-[#28744a]">{t("registry.instrument.mintConfirmed")}{" "}{shortAddress(instrument.mintAddress)}{t("registry.instrument.tokensInTreasury")}</p>
          {!renderQaControls && role === "ADMINISTRATOR" && <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null || distributionDraft !== null}
            onClick={() => void runDeployment(() => startDistribution(instrument))}>{t("registry.instrument.chooseInvestors")}</button>}
        </>}
        {!renderQaControls && instrument.status === "DRAFT" && instrument.mintAddress && instrument.circulatingSupply === instrument.totalSupply && <>
          <p className="mt-2 text-xs text-[#28744a]">{t("registry.instrument.distributionConfirmed")}</p>
          {!renderQaControls && role === "ADMINISTRATOR" && <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null}
            onClick={() => void runDeployment(() => prepareLifecycle(instrument, "INITIALIZE"))}>{t("registry.instrument.prepareInitialize")}</button>}
        </>}
        {!renderQaControls && instrument.status === "DEPLOYING" && <>
          <p className="mt-2 text-xs text-[#28744a]">{t("registry.instrument.initialized")}</p>
          {!renderQaControls && role === "ADMINISTRATOR" && <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || plan !== null}
            onClick={() => void runDeployment(() => prepareLifecycle(instrument, "ACTIVATE"))}>{t("registry.instrument.prepareActivate")}</button>}
        </>}
        {!renderQaControls && instrument.status === "ACTIVE" &&
          <p className="mt-2 text-xs font-semibold text-[#28744a]">{t("registry.instrument.activeConfirmed")}</p>}
      </article>)}
    </div>
    {distributionDraft && <div className="mt-4 rounded-xl border border-[#d3b779] bg-[#fffaf0] p-4 text-sm">
      <p className="font-semibold">{t("registry.instrument.distributionPhase")}{" "}{distributionDraft.instrument.ticker}</p>
      <p className="mt-2 text-xs leading-5">{t("registry.instrument.allocationHelp")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">{["10", "20", "5"].map(amount => <label className="text-xs" key={amount}>{t("registry.instrument.allocation")}{" "}{amount} bond
        <select className={inputClass} value={distributionDraft.selections[amount]} disabled={busy}
          onChange={event => setDistributionDraft(current => current ? { ...current,
            selections: { ...current.selections, [amount]: event.target.value } } : null)}>
          {distributionDraft.candidates.map(candidate => <option key={candidate.walletAddress} value={candidate.walletAddress}>
            {candidate.displayName} · {shortAddress(candidate.walletAddress)}
          </option>)}
        </select>
      </label>)}</div>
      <div className="mt-3 flex gap-2"><button type="button" className={buttonClass} disabled={busy}
        onClick={() => void runDeployment(prepareDistribution)}>{t("registry.instrument.prepareDistribution")}</button>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => setDistributionDraft(null)}>{t("registry.instrument.cancel")}</button></div>
    </div>}
    {plan && <div className="mt-4 rounded-xl border border-[#d3b779] bg-[#fffaf0] p-4 text-sm">
      <p className="font-semibold">{items.find(row => row.id === deployInstrumentId)?.ticker ?? deployInstrumentId}{" "}{t("registry.instrument.phaseReviewLabel")}{" "}{plan.phase}</p>
      <p className="mt-2 text-xs leading-5">{t("registry.instrument.networkLabel")}{" "}<strong>{plan.cluster}</strong>. {displayMessage(phaseSummary(plan.phase))}</p>
      <dl className="mt-3 space-y-1 text-xs"><div><dt className="text-[#61746a]">{t("registry.instrument.signer")}</dt><dd><CopyValue value={plan.requiredSigner} label={t("registry.instrument.deploymentSigner")} /></dd></div>
        {plan.bondMint && <div><dt className="text-[#61746a]">Bond mint</dt><dd className="break-all font-mono">{plan.bondMint}</dd></div>}
        {plan.settlementMint && <div><dt className="text-[#61746a]">KZT-Test mint</dt><dd className="break-all font-mono">{plan.settlementMint}</dd></div>}
        {plan.instrumentAddress && <div><dt className="text-[#61746a]">Instrument PDA</dt><dd className="break-all font-mono">{plan.instrumentAddress}</dd></div>}
        {plan.allocations?.map(allocation => <div key={allocation.tokenAccount}><dt className="text-[#61746a]">{allocation.amount} bond · investor {allocation.investorId.slice(0, 8)}</dt>
          <dd className="break-all font-mono">{allocation.walletAddress}</dd></div>)}</dl>
      <label className="mt-3 flex gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={event => setReviewed(event.target.checked)} />
        {displayMessage(phaseReview(plan.phase))}</label>
      <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || !transactionWallet(wallet, plan.cluster)}
        onClick={() => void runDeployment(sendDeployment)}>{t("registry.instrument.signAndSend")}{" "}{plan.phase}</button>
      {sendAttempted && <div className="mt-3"><p className="text-xs">{t("registry.instrument.attemptUuid")}{" "}<span className="font-mono">{plan.operationId}</span></p>
        <label className="mt-2 block text-xs">{t("registry.instrument.phantomSignature")}<input className={inputClass} value={signature} maxLength={88} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
        <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy || signature.length < 64}
          onClick={() => void runDeployment(confirmDeployment)}>{t("registry.instrument.checkFinalized")}</button></div>}
    </div>}
    {!detailId && nextCursor && <button type="button" className={`mt-3 ${buttonClass}`} disabled={busy} onClick={() => void refresh(nextCursor)}>{t("registry.instrument.loadMore")}</button>}
    <RequestNotice busy={busy} message={message} error={error === null ? null : displayMessage(error)} onRetry={() => void refresh()} />
  </section>;
}

"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone } from "./workspace-presentation";
import { workspaceSelectionFromHash, workspaceSectionHash, workspaceSectionFromHash } from "./workspace-navigation";
import { encodeBase58 } from "./snapshot-workflow";

import { useLocale, useLocalizedTextState } from "./locale-context";

type Investor = {
  id: string; displayName: string; externalReference: string | null; countryCode: string; type?: string; status?: string;
  kycStatus: string; eligibilityStatus: string; eligibilityReasonCode: string | null;
  eligibilityReviewedAt: string | null; _count: { wallets: number };
  wallets: { id: string; address: string; status: string; network: string; revokedAt: string | null;
    revocationReasonCode: string | null }[];
};
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type VerificationChallenge = {
  challengeId: string; walletId: string; walletAddress: string; message: string; nonce: string;
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Подтверждён",
  PENDING: "Ожидает подписи",
  NOT_STARTED: "Не начат",
  PENDING_REVIEW: "Ожидает проверки",
  ELIGIBLE: "Допущен",
  NOT_ELIGIBLE: "Не допущен",
  SUSPENDED: "Приостановлен",
  BLOCKED: "Заблокирован",
  REVOKED: "Отозван"
};

const REASON_LABELS: Record<string, string> = {
  DEMO_CRITERIA_MET: "Демо-критерии выполнены",
  DEMO_CRITERIA_NOT_MET: "Демо-критерии не выполнены",
  LEGACY_STATUS_IMPORT: "Перенесено из прежней версии"
};

const REVOCATION_REASON_LABELS: Record<string, string> = {
  OWNER_REQUEST: "По запросу владельца",
  SECURITY_CONCERN: "Подозрение на компрометацию",
  WALLET_REPLACEMENT: "Замена кошелька",
  REGISTRY_CORRECTION: "Исправление записи реестра",
  LEGACY_STATUS_IMPORT: "Перенесено из прежней версии"
};

function shortAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}


export function InvestorPanel({ role, request, signWalletMessage, activeWalletAddress, qaMode = false }: {
  role: string;
  request: Request;
  signWalletMessage?: ((address: string, message: string) => Promise<string>) | undefined;
  activeWalletAddress?: string | undefined;
  qaMode?: boolean;
}) {
  const { t, formatDate, displayMessage } = useLocale();
  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ? displayMessage(STATUS_LABELS[status]) : status;
  }
  const [items, setItems] = useState<Investor[]>([]);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [detailId, setDetailId] = useState("");
  const [formError, setFormError] = useState<{ form: "create" | "attach"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    requestAnimationFrame(() => {
      if (detailId) document.getElementById(`investor-${detailId}`)?.focus({ preventScroll: true });
      else listView.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({ preventScroll: true });
    });
  }, [detailId]);
  const listPosition = useRef(0);
  function chooseRecord(id: string) { listPosition.current = window.scrollY; setDetailId(id); window.history.replaceState(null,"",workspaceSectionHash("investors",id)); }
  function backToList() { setDetailId(""); window.history.replaceState(null,"",workspaceSectionHash("investors")); requestAnimationFrame(()=>window.scrollTo({top:listPosition.current,behavior:"instant"})); }
  useEffect(()=>{ const sync=()=>{if(workspaceSectionFromHash(window.location.hash)==="investors") setDetailId(workspaceSelectionFromHash(window.location.hash,"investors")??"");}; sync();window.addEventListener("hashchange",sync);return()=>window.removeEventListener("hashchange",sync); },[]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useLocalizedTextState();
  const [selected, setSelected] = useState("");
  const [eligibilityChoices, setEligibilityChoices] = useState<Record<string, string>>({});
  const [revocationChoices, setRevocationChoices] = useState<Record<string, string>>({});

  async function load(cursor?: string, signal?: AbortSignal) {
    const result = await request(`/api/v1/investors?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (!Array.isArray(result["items"])) throw new Error(t("registry.investor.invalidRegistryResponse"));
    const rows = result["items"] as Investor[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
    setMessage("");
  }
  useEffect(() => {
    const abort = new AbortController();
    setError(null); setBusy(true);
    void load(undefined, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t("registry.investor.registryUnavailable"));
    }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [request]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setFormError(null); setError(null); setBusy(true);
    try {
      await request("/api/v1/investors", { method: "POST", body: JSON.stringify({
        displayName: data.get("displayName"), externalReference: data.get("externalReference"),
        countryCode: data.get("countryCode"), type: data.get("type")
      }) });
      form.reset();
      setSelected("");
      try { await load(); }
      catch { setMessage(t("registry.investor.createdRefreshFailed")); }
    } catch (error) { setFormError({ form: "create", message: error instanceof Error ? error.message : t("registry.investor.requestFailed") }); setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.createRecovery"));
    } finally { setBusy(false); }
  }
  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const address = new FormData(form).get("address");
    setFormError(null); setError(null); setBusy(true);
    try {
      await request(`/api/v1/investors/${selected}/wallets`, { method: "POST", body: JSON.stringify({ address }) });
      form.reset();
      setSelected("");
      try { await load(); }
      catch { setMessage(t("registry.investor.walletAddedRefreshFailed")); }
    } catch (error) { setFormError({ form: "attach", message: error instanceof Error ? error.message : t("registry.investor.requestFailed") }); setError(error instanceof Error ? error.message : t("registry.investor.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.investor.attachFailed")); }
    finally { setBusy(false); }
  }
  async function refresh(cursor?: string) {
    setError(null); setBusy(true);
    try { await load(cursor); }
    catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.investor.loadFailed")); }
    finally { setBusy(false); }
  }
  async function decideEligibility(investorId: string) {
    const decision = eligibilityChoices[investorId];
    if (decision !== "ELIGIBLE" && decision !== "NOT_ELIGIBLE") return;
    setError(null); setBusy(true);
    try {
      await request(`/api/v1/investors/${investorId}/eligibility`, { method: "POST", body: JSON.stringify({
        decision,
        reasonCode: decision === "ELIGIBLE" ? "DEMO_CRITERIA_MET" : "DEMO_CRITERIA_NOT_MET"
      }) });
      setEligibilityChoices(previous => ({ ...previous, [investorId]: "" }));
      try {
        await load();
        setMessage(decision === "ELIGIBLE"
          ? t("registry.investor.eligibleDemo")
          : t("registry.investor.notEligibleDemo"));
      } catch {
        setMessage(t("registry.investor.decisionRefreshFailed"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(error instanceof Error ? error.message : t("registry.investor.decisionFailed"));
    } finally { setBusy(false); }
  }
  async function revokeWallet(investorId: string, wallet: Investor["wallets"][number]) {
    const reasonCode = revocationChoices[wallet.id];
    if (!reasonCode) return;
    if (!window.confirm(t(qaMode ? "registry.investor.qaRevokeConfirm" : "registry.investor.revokeConfirm", { address: shortAddress(wallet.address) }))) return;
    setError(null); setBusy(true);
    try {
      await request(`/api/v1/investors/${investorId}/wallets/${wallet.id}/revoke`, {
        method: "POST", body: JSON.stringify({ reasonCode })
      });
      setRevocationChoices(previous => ({ ...previous, [wallet.id]: "" }));
      try {
        await load();
        setMessage(t("registry.investor.walletRevoked"));
      } catch {
        setMessage(t("registry.investor.revokedRefreshFailed"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(error instanceof Error ? error.message : t("registry.investor.revokeFailed"));
    } finally { setBusy(false); }
  }
  async function verifyWallet(investorId: string, wallet: Investor["wallets"][number]) {
    if (!signWalletMessage) return;
    setError(null); setBusy(true);
    try {
      const raw = await request(`/api/v1/investors/${investorId}/wallets/${wallet.id}/verification/challenge`, {
        method: "POST", body: "{}"
      });
      const challenge = raw as VerificationChallenge;
      if (typeof challenge.challengeId !== "string" || typeof challenge.nonce !== "string" ||
          typeof challenge.message !== "string" || challenge.walletId !== wallet.id ||
          challenge.walletAddress !== wallet.address) {
        throw new Error(t("registry.investor.invalidChallenge"));
      }
      setMessage(qaMode ? t("registry.investor.qaVerifying") : t("registry.investor.signMessage"));
      const signature = await signWalletMessage(wallet.address, challenge.message);
      await request(`/api/v1/investors/${investorId}/wallets/${wallet.id}/verification/verify`, {
        method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, nonce: challenge.nonce, signature })
      });
      try {
        await load();
        setMessage(qaMode ? t("registry.investor.qaVerified") : t("registry.investor.ownershipVerified"));
      } catch {
        setMessage(t("registry.investor.verifiedRefreshFailed"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.verifyRecovery"));
    } finally { setBusy(false); }
  }
  const visible = filterRegistry(items, filters, row=>[row.displayName,row.externalReference??"",row.id,...row.wallets.map(wallet=>wallet.address)].join(" "),row=>row.eligibilityStatus,row=>row.displayName);
  const inputClass = "mt-1.5 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2.5 text-sm";
  const buttonClass = "rounded-lg border border-[#b9c9c0] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return <section className="mt-6 border-t border-[#dbe5df] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="mt-1 text-lg font-semibold">{t("registry.investor.title")}</h3>
        <details className="term-help"><summary>{t("registry.investor.walletEligibilityHelp")}</summary><p>{t("registry.investor.syntheticHelp")}</p></details>
      </div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}>{t("registry.investor.refresh")}</button>
    </div>
    {role !== "ADMINISTRATOR" && <p className="access-note mt-3">{t("registry.investor.readOnly")}</p>}

    {role === "ADMINISTRATOR" && <details className="advanced-details mt-5"><summary>{t("registry.investor.addInvestorWallet")}</summary>
    <details className="term-help"><summary>{t("registry.investor.recipientHelp")}</summary><p>{t("registry.investor.recipientSteps")}</p></details>

    {role === "ADMINISTRATOR" && <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void create(event)}>
        <h4 className="mt-1 font-semibold">{t("registry.investor.createInvestor")}</h4>
        <label className="block text-sm">{t("registry.investor.nameField")}<input className={inputClass} name="displayName" required maxLength={200} placeholder={t("registry.investor.namePlaceholder")} disabled={busy} /></label>
        <label className="block text-sm">{t("registry.investor.referenceField")}<input className={inputClass} name="externalReference" required maxLength={100} placeholder="DEMO-A" disabled={busy} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("registry.investor.typeField")}<select className={inputClass} name="type" disabled={busy}><option value="INDIVIDUAL">{t("registry.investor.individualTest")}</option><option value="INSTITUTIONAL">{t("registry.investor.institutionTest")}</option></select></label>
          <label className="block text-sm">{t("registry.investor.countryField")}<input className={inputClass} name="countryCode" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="KZ" disabled={busy} /></label>
        </div>
        {formError?.form === "create" && <p role="alert" className="form-error">{displayMessage(formError.message)}{" "}{t("registry.investor.fieldsPreserved")}</p>}
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy}>{t("registry.investor.createInvestor")}</button>
        <button type="button" className="secondary-button ml-2" disabled={busy} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{t("registry.investor.cancel")}</button>
      </form>
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void attach(event)}>
        <h4 className="mt-1 font-semibold">{t("registry.investor.attachWallet")}</h4>
        <p className="text-xs leading-5 text-[#61746a]">{qaMode ? t("registry.investor.qaAttachHelp") : t("registry.investor.attachHelp")}</p>
        <label className="block text-sm">{t("registry.investor.investorField")}<select className={inputClass} required value={selected} disabled={busy || items.length === 0} onChange={event => setSelected(event.target.value)}>
      <option value="">{items.length === 0 ? t("registry.investor.createFirst") : t("registry.investor.selectInvestor")}</option>{items.map(investor => <option key={investor.id} value={investor.id}>{investor.displayName}</option>)}</select>
      </label>
        <label className="block text-sm">{t("registry.investor.addressField")}<input className={`${inputClass} font-mono`} name="address" required minLength={32} maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]+" placeholder={t("registry.investor.addressPlaceholder")} disabled={busy || items.length === 0} />
      </label>
        {formError?.form === "attach" && <p role="alert" className="form-error">{displayMessage(formError.message)}{" "}{t("registry.investor.addressPreserved")}</p>}
        {qaMode && <button type="button" className="secondary-button" disabled={busy || !selected} onClick={event => {
          const addressInput = event.currentTarget.form?.elements.namedItem("address");
          if (addressInput instanceof HTMLInputElement) addressInput.value = encodeBase58(crypto.getRandomValues(new Uint8Array(32)));
        }}>{t("registry.investor.generateQaAddress")}</button>}
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy || !selected}>{t("registry.investor.attachWallet")}</button>
        <button type="button" className="secondary-button ml-2" disabled={busy} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>{t("registry.investor.cancel")}</button>
      </form>
    </div>}

    </details>}

    <div ref={listView} hidden={Boolean(detailId)}>
      <RegistryToolbar label={t("registry.investor.registryLabel")} filters={filters} onChange={setFilters} statuses={{ELIGIBLE:t("registry.investor.statusEligible"),PENDING_REVIEW:t("registry.investor.statusAwaitingDecision"),NOT_ELIGIBLE:t("registry.investor.statusNotEligible")}} loaded={items.length} shown={visible.length} />
      {busy && items.length === 0 && <RegistrySkeleton />}
      <div className="table-scroll" hidden={items.length === 0} tabIndex={0} role="region" aria-label={t("registry.investor.tableLabel")}>
      <table className="registry-table">
      <thead>
      <tr>
      <th>{t("registry.investor.investorReference")}</th>
      <th>{t("registry.investor.eligibility")}</th>
      <th>KYC</th>
      <th className="numeric">{t("registry.investor.wallets")}</th>
      </tr>
      </thead>
      <tbody>{visible.map(investor=>
      <tr key={investor.id}>
      <td>
      <button type="button" className="table-object-link" disabled={busy} onClick={() => chooseRecord(investor.id)}>{investor.displayName}</button>
      <span className="table-secondary">{investor.externalReference??t("registry.investor.noReference")}</span>
      </td>
      <td>
      <span className={"status-"+statusTone(investor.eligibilityStatus)}>{statusLabel(investor.eligibilityStatus)}</span>
      </td>
      <td>{statusLabel(investor.kycStatus)}</td>
      <td className="numeric">{investor._count.wallets}</td>
      </tr>)}</tbody>
      </table>
      </div>
      {!busy&&!error&&visible.length===0&&<p className="empty-state">{items.length===0?t("registry.investor.emptyRegistry"):t("registry.investor.noMatches")}</p>}
    </div>
    {detailId&&<button type="button" className="secondary-button mt-4" disabled={busy} onClick={backToList}>{t("registry.investor.back")}</button>}
    {detailId&&!items.some(row=>row.id===detailId)&&<p className="empty-state">{t("registry.investor.missingRecord")}</p>}
    <div className="mt-6" hidden={!detailId}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{t("registry.investor.walletsEligibility")}</h4>
      </div>
      {items.length === 0 && !busy && <div className="mt-3 rounded-xl border border-dashed border-[#cbd8d0] p-5 text-sm text-[#61746a]">{t("registry.investor.startAtStepOne")}</div>}
      <ul className="mt-3 space-y-3">
        {items.map(investor => <li className="record-detail rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" id={`investor-${investor.id}`} tabIndex={-1} key={investor.id} hidden={detailId !== investor.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold">{investor.displayName}</p><p className="mt-1 text-xs text-[#61746a]">{t("registry.investor.referenceLabel")}{" "}{investor.externalReference ?? t("registry.investor.referenceMissing")}{" "}{t("registry.investor.countryLabel")}{" "}{investor.countryCode}</p></div>
          </div>
          <dl className="object-facts mt-4"><div><dt>{t("registry.investor.investorType")}</dt><dd>{investor.type === "INDIVIDUAL" ? t("registry.investor.individual") : investor.type === "INSTITUTIONAL" ? t("registry.investor.institution") : t("registry.investor.typeMissing")}</dd></div><div><dt>{t("registry.investor.account")}</dt><dd>{investor.status === "ACTIVE" ? t("registry.investor.accountActive") : investor.status ?? t("registry.investor.missing")}</dd></div><div><dt>{t("registry.investor.eligibility")}</dt><dd>{statusLabel(investor.eligibilityStatus)}</dd></div><div><dt>KYC</dt><dd>{statusLabel(investor.kycStatus)}</dd></div></dl>
          <p className="mt-3 text-xs font-semibold text-[#52675b]">{t("registry.investor.walletsLabel")}{" "}{investor._count.wallets}{investor._count.wallets > 20 ? t("registry.investor.firstTwenty") : ""}</p>
          {investor.wallets.map(wallet => {
            const readyToVerify = qaMode || activeWalletAddress === wallet.address;
            return <div className="mt-2 rounded-lg border border-[#e3eae6] bg-[#f8faf9] p-3" key={wallet.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CopyValue value={wallet.address} label={t("registry.investor.walletCopyLabel", { name: investor.displayName })} />
                <span className={wallet.status === "ACTIVE" ? "status-ready" : "status-wait"}>{statusLabel(wallet.status)}</span>
              </div>
              <p className="mt-1 text-xs text-[#708278]">{t("registry.investor.networkLabel")}{" "}{wallet.network === "SOLANA_LOCALNET" ? "Solana Localnet" : wallet.network}</p>
              {role === "ADMINISTRATOR" && wallet.status === "PENDING" && signWalletMessage && <div className="mt-3 border-t border-[#e3eae6] pt-3">
                <p className={`text-xs leading-5 ${readyToVerify ? "text-[#176a38]" : "text-[#8a5b18]"}`}>{readyToVerify
                  ? qaMode ? t("registry.investor.qaVerifyHelp") : t("registry.investor.phantomReady")
                  : t("registry.investor.phantomSwitch", { address: shortAddress(wallet.address) })}</p>
                <button type="button" className={`${buttonClass} mt-2 ${readyToVerify ? "border-[#163f2b] bg-[#163f2b] text-white" : "bg-white"}`}
                  disabled={busy || !readyToVerify} onClick={() => void verifyWallet(investor.id, wallet)}>{qaMode ? t("registry.investor.simulateVerification") : readyToVerify ? t("registry.investor.verifyOwnership") : t("registry.investor.awaitingPhantom")}</button>
              </div>}
              {role === "ADMINISTRATOR" && wallet.status !== "REVOKED" && <details className="mt-3 border-t border-[#e3eae6] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#7b3e28]">{t("registry.investor.revokeWallet")}</summary>
                <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.revocationHelp")}</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select className={`${inputClass} mt-0 sm:max-w-xs`} value={revocationChoices[wallet.id] ?? ""} disabled={busy}
                    aria-label={t("registry.investor.revocationReasonLabel", { address: shortAddress(wallet.address) })}
                    onChange={event => setRevocationChoices(previous => ({ ...previous, [wallet.id]: event.target.value }))}>
                    <option value="">{t("registry.investor.chooseReason")}</option>
                    <option value="OWNER_REQUEST">{t("registry.investor.ownerRequest")}</option>
                    <option value="SECURITY_CONCERN">{t("registry.investor.securityConcern")}</option>
                    <option value="WALLET_REPLACEMENT">{t("registry.investor.walletReplacement")}</option>
                    <option value="REGISTRY_CORRECTION">{t("registry.investor.registryCorrection")}</option>
                  </select>
                  <button type="button" className={`danger-button ${buttonClass} border-[#9b4b32] bg-white text-[#7b3e28]`}
                    disabled={busy || !revocationChoices[wallet.id]}
                    onClick={() => void revokeWallet(investor.id, wallet)}>{t("registry.investor.revokeWallet")}</button>
                </div>
              </details>}
              {wallet.status === "REVOKED" && wallet.revocationReasonCode && <p className="mt-2 text-xs text-[#7b3e28]">{t("registry.investor.reasonLabel")}{" "}{displayMessage(REVOCATION_REASON_LABELS[wallet.revocationReasonCode] ?? wallet.revocationReasonCode)}{wallet.revokedAt ? ` · ${formatDate(wallet.revokedAt)}` : ""}</p>}
            </div>;
          })}
          {role === "ADMINISTRATOR" && investor.eligibilityStatus === "PENDING_REVIEW" && (() => {
            const hasVerifiedWallet = investor.wallets.some(wallet => wallet.status === "ACTIVE");
            const choice = eligibilityChoices[investor.id] ?? "";
            return <div className="mt-3 rounded-lg border border-[#d9e3dd] bg-[#f7faf8] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#28744a]">{t("registry.investor.eligibilityDecision")}</p>
              <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.decisionHelp")}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select className={`${inputClass} mt-0 sm:max-w-xs`} value={choice} disabled={busy}
                  aria-label={t("registry.investor.eligibilityLabel", { name: investor.displayName })} onChange={event => setEligibilityChoices(previous => ({ ...previous, [investor.id]: event.target.value }))}>
                  <option value="">{t("registry.investor.chooseDecision")}</option>
                  <option value="ELIGIBLE" disabled={!hasVerifiedWallet}>{t("registry.investor.approveDemo")}</option>
                  <option value="NOT_ELIGIBLE">{t("registry.investor.rejectDemo")}</option>
                </select>
                <button type="button" className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`}
                  disabled={busy || !choice} onClick={() => void decideEligibility(investor.id)}>{t("registry.investor.saveDecision")}</button>
              </div>
              {!hasVerifiedWallet && <p className="mt-2 text-xs text-[#8a5b18]">{t("registry.investor.verifyFirst")}</p>}
            </div>;
          })()}
          {investor.eligibilityStatus !== "PENDING_REVIEW" && investor.eligibilityReasonCode && <p className="mt-3 text-xs text-[#61746a]">{t("registry.investor.basisLabel")}{" "}{displayMessage(REASON_LABELS[investor.eligibilityReasonCode] ?? investor.eligibilityReasonCode)}{investor.eligibilityReviewedAt ? ` · ${formatDate(investor.eligibilityReviewedAt)}` : ""}</p>}
        </li>)}
      </ul>
    </div>
    {!detailId && nextCursor && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh(nextCursor)}>{t("registry.investor.showMore")}</button>}
    <RequestNotice busy={busy} message={message} error={error === null ? null : displayMessage(error)} onRetry={()=>void refresh()} />
  </section>;
}

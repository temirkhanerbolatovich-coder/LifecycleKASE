"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone } from "./workspace-presentation";
import { workspaceSelectionFromHash, workspaceSectionHash, workspaceSectionFromHash } from "./workspace-navigation";
import { encodeBase58 } from "./snapshot-workflow";

import { useLocale, useLocalizedTextState } from "./locale-context";
import type { MessageKey } from "./locale";
import {
  canChangeWalletStatus, canReviewEligibility, eligibilityReviewCommand, hasActiveVerifiedWallet,
  canEditInvestorProfile, createRegistryRequestScope, investorProfileCommand, investorRegistryPath, investorWalletsPath, mergeRegistryRows,
  readInvestorRegistryDetail,
  REGISTRY_REVIEW_REASONS, remainingRegistryRefreshLocks, saveRegistryChange, walletStatusCommand,
  type RegistryRefreshLock, type RegistryReviewReason, type RegistryProfileDraft
} from "./investor-registry-workflow";

type Investor = {
  id: string; displayName: string; externalReference: string | null; countryCode: string; type?: string; status?: string;
  kycStatus: string; eligibilityStatus: string; eligibilityReasonCode: string | null;
  eligibilityReviewedAt: string | null; registryVersion: number; _count: { wallets: number };
  wallets: { id: string; address: string; status: string; network: string; verifiedAt: string | null;
    registryVersion: number; revokedAt: string | null;
    revocationReasonCode: string | null }[];
};
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type VerificationChallenge = {
  challengeId: string; walletId: string; walletAddress: string; message: string; nonce: string;
};

const STATUS_KEYS: Record<string, MessageKey> = {
  ACTIVE: "registry.investor.statusVerified",
  PENDING: "registry.investor.statusPending",
  NOT_STARTED: "registry.investor.statusNotStarted",
  PENDING_REVIEW: "registry.investor.statusPendingReview",
  ELIGIBLE: "registry.investor.statusEligible",
  NOT_ELIGIBLE: "registry.investor.statusNotEligible",
  SUSPENDED: "registry.investor.statusSuspended",
  BLOCKED: "registry.investor.statusBlocked",
  REVOKED: "registry.investor.statusRevoked"
};

const REASON_LABELS: Record<string, string> = {
  DEMO_CRITERIA_MET: "Демо-критерии выполнены",
  DEMO_CRITERIA_NOT_MET: "Демо-критерии не выполнены",
  DEMO_ELIGIBILITY_SUSPENDED: "Тестовый допуск приостановлен",
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
    const key = STATUS_KEYS[status];
    return key ? t(key) : status;
  }
  const [items, setItems] = useState<Investor[]>([]);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [detailId, setDetailId] = useState("");
  const detailIdRef = useRef(detailId); detailIdRef.current = detailId;
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
  useEffect(()=>{ const sync=()=>{if(workspaceSectionFromHash(window.location.hash)==="investors") setDetailId(workspaceSelectionFromHash(window.location.hash,"investors")?.toLowerCase()??"");}; sync();window.addEventListener("hashchange",sync);return()=>window.removeEventListener("hashchange",sync); },[]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [writeBusy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const busy = writeBusy || listBusy || detailBusy || walletBusy;
  const [detailRecords, setDetailRecords] = useState<Record<string, Investor>>({});
  const detailRecordsRef = useRef<Record<string, Investor>>({});
  const [walletCursors, setWalletCursors] = useState<Record<string, string | null>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const listRequests = useRef(createRegistryRequestScope());
  const detailRequests = useRef(createRegistryRequestScope());
  const backgroundRequests = useRef(createRegistryRequestScope());
  const walletRequests = useRef(createRegistryRequestScope());
  const [profileDrafts, setProfileDrafts] = useState<Record<string, RegistryProfileDraft>>({});
  const [message, setMessage] = useLocalizedTextState();
  const [selected, setSelected] = useState("");
  const [eligibilityChoices, setEligibilityChoices] = useState<Record<string, string>>({});
  const [revocationChoices, setRevocationChoices] = useState<Record<string, string>>({});
  const [reviewChoices, setReviewChoices] = useState<Record<string, { decision: string; reason: string }>>({});
  const [walletStatusReasons, setWalletStatusReasons] = useState<Record<string, string>>({});
  const [refreshLocks, setRefreshLocks] = useState<RegistryRefreshLock[]>([]);
  const [registryChangeError, setRegistryChangeError] = useState<{ kind: "review" | "wallet" | "profile"; id: string } | null>(null);
  const reviewReasonLabels: Record<RegistryReviewReason, string> = {
    REGISTRY_CORRECTION: t("registry.investor.registryCorrection"),
    PERIODIC_REVIEW: t("registry.investor.periodicReview"),
    SECURITY_CONCERN: t("registry.investor.securityConcern"),
    OWNER_REQUEST: t("registry.investor.ownerRequest")
  };
  function investorLocked(investor: Investor): boolean {
    return refreshLocks.some(lock => lock.kind === "investor" ? lock.id === investor.id : investor.wallets.some(wallet => wallet.id === lock.id));
  }

  async function load(cursor?: string) {
    const read = listRequests.current.begin(); setListBusy(true);
    try {
      const result = await request(investorRegistryPath(filters.query, cursor), { signal: read.signal });
      if (!read.current()) return;
      if (!Array.isArray(result["items"])) throw new Error(t("registry.investor.invalidRegistryResponse"));
      const rows = result["items"] as Investor[];
      setItems(previous => cursor ? mergeRegistryRows(previous, rows) : rows);
      setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
      return rows;
    } catch (error) { if (read.current()) throw error; }
    finally { if (read.current()) setListBusy(false); }
  }
  useEffect(() => {
    setError(null); setItems([]); setNextCursor(null);
    void load().catch((error: unknown) => {
      setError(error instanceof Error ? error.message : t("registry.investor.registryUnavailable"));
    });
    return () => listRequests.current.cancel();
  }, [request, filters.query]);

  function storeDetail(record: Investor, cursor: string | null) {
    detailRecordsRef.current = { ...detailRecordsRef.current, [record.id]: record };
    setDetailRecords(detailRecordsRef.current);
    setWalletCursors(previous => ({ ...previous, [record.id]: cursor }));
    setItems(previous => previous.map(row => row.id === record.id ? record : row));
    setRefreshLocks(previous => remainingRegistryRefreshLocks(previous, [record]));
  }
  async function loadDetail(id: string, background = false) {
    const read = (background ? backgroundRequests : detailRequests).current.begin();
    if (!background) {
      walletRequests.current.cancel();
      setDetailBusy(true); setWalletBusy(false); setDetailError(null); setWalletError(null);
    }
    try {
      const visibleWallets = detailRecordsRef.current[id]?.wallets.length ?? 0;
      const { record, nextCursor } = await readInvestorRegistryDetail<Investor>(request, id, visibleWallets, read.signal);
      if (!read.current()) return;
      storeDetail(record, nextCursor);
      return record;
    } catch (error) {
      if (read.current()) { if (!background) setDetailError(error instanceof Error ? error.message : t("registry.investor.loadFailed")); throw error; }
    } finally { if (!background && read.current()) setDetailBusy(false); }
  }
  useEffect(() => () => backgroundRequests.current.cancel(), []);
  useEffect(() => {
    if (detailId) void loadDetail(detailId).catch(() => {});
    else { setDetailBusy(false); setWalletBusy(false); setDetailError(null); setWalletError(null); }
    return () => { detailRequests.current.cancel(); walletRequests.current.cancel(); };
  }, [detailId, request]);
  async function loadMoreWallets(investor: Investor) {
    const cursor = walletCursors[investor.id]; if (!cursor || busy) return;
    const read = walletRequests.current.begin(); setWalletBusy(true); setWalletError(null);
    try {
      const result = await request(investorWalletsPath(investor.id, cursor), { signal: read.signal });
      if (!read.current()) return;
      if (!Array.isArray(result["items"])) throw new Error(t("registry.investor.invalidRegistryResponse"));
      const next = typeof result["nextCursor"] === "string" ? result["nextCursor"] : null;
      if (next === cursor) throw new Error(t("registry.investor.invalidRegistryResponse"));
      storeDetail({ ...investor, wallets: mergeRegistryRows(investor.wallets, result["items"] as Investor["wallets"]) }, next);
    } catch (error) {
      if (read.current()) setWalletError(error instanceof Error ? error.message : t("registry.investor.loadFailed"));
    } finally { if (read.current()) setWalletBusy(false); }
  }
  async function refreshInvestor(id: string) {
    const record = await loadDetail(id, detailIdRef.current !== id);
    if (!record) throw new Error(t("registry.investor.loadFailed"));
    return [record];
  }
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
    const attachedInvestorId = selected;
    const form = event.currentTarget;
    const address = new FormData(form).get("address");
    setFormError(null); setError(null); setBusy(true);
    try {
      await request(`/api/v1/investors/${attachedInvestorId}/wallets`, { method: "POST", body: JSON.stringify({ address }) });
      form.reset();
      setSelected("");
      try { await load(); if (detailRecordsRef.current[attachedInvestorId]) await refreshInvestor(attachedInvestorId); }
      catch { setMessage(t("registry.investor.walletAddedRefreshFailed")); }
    } catch (error) { setFormError({ form: "attach", message: error instanceof Error ? error.message : t("registry.investor.requestFailed") }); setError(error instanceof Error ? error.message : t("registry.investor.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.investor.attachFailed")); }
    finally { setBusy(false); }
  }
  async function refresh(cursor?: string) {
    setError(null); setMessage("");
    try { if (detailId && !cursor) await loadDetail(detailId); else await load(cursor); }
    catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed")); setMessage(error instanceof Error ? error.message : t("registry.investor.loadFailed")); }
  }
  async function decideEligibility(investorId: string) {
    const investor = detailRecords[investorId];
    if (busy || !investor || investorLocked(investor)) return;
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
        await refreshInvestor(investorId);
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
    const investor = detailRecords[investorId];
    if (busy || !investor || investorLocked(investor)) return;
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
        await refreshInvestor(investorId);
        setMessage(t("registry.investor.walletRevoked"));
      } catch {
        setMessage(t("registry.investor.revokedRefreshFailed"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(error instanceof Error ? error.message : t("registry.investor.revokeFailed"));
    } finally { setBusy(false); }
  }
  async function verifyWallet(investorId: string, wallet: Investor["wallets"][number]) {
    const investor = detailRecords[investorId];
    if (busy || !investor || investorLocked(investor)) return;
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
        await refreshInvestor(investorId);
        setMessage(qaMode ? t("registry.investor.qaVerified") : t("registry.investor.ownershipVerified"));
      } catch {
        setMessage(t("registry.investor.verifiedRefreshFailed"));
      }
    } catch (error) { setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.verifyRecovery"));
    } finally { setBusy(false); }
  }
  async function reviewEligibility(investor: Investor) {
    if (busy || investorLocked(investor)) return;
    const choice = reviewChoices[investor.id];
    const command = eligibilityReviewCommand(investor, role, choice?.decision ?? "", choice?.reason ?? "");
    if (!command || !choice) return;
    if (!window.confirm(t("registry.investor.reviewConfirm", {
      name: investor.displayName, decision: statusLabel(choice.decision),
      reason: reviewReasonLabels[choice.reason as RegistryReviewReason], version: investor.registryVersion
    }))) return;
    setRegistryChangeError(null); setError(null); setMessage(""); setBusy(true);
    const lock: RegistryRefreshLock = { kind: "investor", id: investor.id, version: investor.registryVersion };
    try {
      const result = await saveRegistryChange(request, command, () => {
        setRefreshLocks(previous => [...previous, lock]);
        setReviewChoices(previous => ({ ...previous, [investor.id]: { decision: "", reason: "" } }));
      }, async () => {
        const rows = await refreshInvestor(investor.id);
        if (!rows || remainingRegistryRefreshLocks([lock], rows).length) throw new Error("Current record not loaded");
      });
      setMessage(t(result.refreshed ? "registry.investor.reviewSaved" : "registry.investor.reviewRefreshFailed"));
    } catch (error) {
      setRegistryChangeError({ kind: "review", id: investor.id });
      setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.reviewFailed"));
    } finally { setBusy(false); }
  }
  async function changeWalletStatus(investor: Investor, wallet: Investor["wallets"][number]) {
    if (busy || investorLocked(investor)) return;
    const reason = walletStatusReasons[wallet.id] ?? "";
    const command = walletStatusCommand(investor, wallet, role, reason);
    if (!command) return;
    if (!window.confirm(t(wallet.status === "ACTIVE" ? "registry.investor.blockConfirm" : "registry.investor.unblockConfirm", {
      address: wallet.address, reason: reviewReasonLabels[reason as RegistryReviewReason], version: wallet.registryVersion
    }))) return;
    setRegistryChangeError(null); setError(null); setMessage(""); setBusy(true);
    const lock: RegistryRefreshLock = { kind: "wallet", id: wallet.id, version: wallet.registryVersion };
    try {
      const result = await saveRegistryChange(request, command, () => {
        setRefreshLocks(previous => [...previous, lock]);
        setWalletStatusReasons(previous => ({ ...previous, [wallet.id]: "" }));
      }, async () => {
        const rows = await refreshInvestor(investor.id);
        if (!rows || remainingRegistryRefreshLocks([lock], rows).length) throw new Error("Current record not loaded");
      });
      setMessage(t(!result.refreshed ? "registry.investor.walletStatusRefreshFailed"
        : wallet.status === "ACTIVE" ? "registry.investor.walletBlocked" : "registry.investor.walletUnblocked"));
    } catch (error) {
      setRegistryChangeError({ kind: "wallet", id: wallet.id });
      setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.walletStatusFailed"));
    } finally { setBusy(false); }
  }
  async function saveProfile(investor: Investor, draft: RegistryProfileDraft) {
    if (busy || investorLocked(investor) || !investor.type) return;
    const command = investorProfileCommand({ ...investor, type: investor.type }, role, draft);
    if (!command) return;
    if (!window.confirm(t("registry.investor.profileConfirm", {
      name: investor.displayName, displayName: command.body["displayName"] ?? "", type: command.body["type"] ?? "",
      country: command.body["countryCode"] ?? "", reference: command.body["externalReference"] ?? t("registry.investor.referenceMissing"),
      reason: reviewReasonLabels[draft.reason as RegistryReviewReason], version: investor.registryVersion
    }))) return;
    setRegistryChangeError(null); setError(null); setMessage(""); setBusy(true);
    const lock: RegistryRefreshLock = { kind: "investor", id: investor.id, version: investor.registryVersion };
    try {
      const result = await saveRegistryChange(request, command, () => {
        setRefreshLocks(previous => [...previous, lock]);
        setProfileDrafts(previous => { const next = { ...previous }; delete next[investor.id]; return next; });
      }, async () => {
        const rows = await refreshInvestor(investor.id);
        if (remainingRegistryRefreshLocks([lock], rows).length) throw new Error("Current record not loaded");
      });
      setMessage(t(result.refreshed ? "registry.investor.profileSaved" : "registry.investor.profileRefreshFailed"));
    } catch (error) {
      setRegistryChangeError({ kind: "profile", id: investor.id });
      setError(error instanceof Error ? error.message : t("registry.investor.requestFailed"));
      setMessage(t("registry.investor.profileFailed"));
    } finally { setBusy(false); }
  }
  const visible = filterRegistry(items, { ...filters, query: "" }, row=>row.displayName,row=>row.eligibilityStatus,row=>row.displayName);
  const attachmentItems = mergeRegistryRows(items, Object.values(detailRecords));
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
        <label className="block text-sm">{t("registry.investor.investorField")}<select className={inputClass} required value={selected} disabled={busy || attachmentItems.length === 0} onChange={event => setSelected(event.target.value)}>
      <option value="">{attachmentItems.length === 0 ? t("registry.investor.createFirst") : t("registry.investor.selectInvestor")}</option>{attachmentItems.map(investor => <option key={investor.id} value={investor.id}>{investor.displayName}</option>)}</select>
      </label>
        <label className="block text-sm">{t("registry.investor.addressField")}<input className={`${inputClass} font-mono`} name="address" required minLength={32} maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]+" placeholder={t("registry.investor.addressPlaceholder")} disabled={busy || attachmentItems.length === 0} />
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
      <RegistryToolbar label={t("registry.investor.registryLabel")} filters={filters} onChange={setFilters} serverSearch statuses={{ELIGIBLE:t("registry.investor.statusEligible"),PENDING_REVIEW:t("registry.investor.statusAwaitingDecision"),NOT_ELIGIBLE:t("registry.investor.statusNotEligible"),SUSPENDED:t("registry.investor.statusSuspended")}} loaded={items.length} shown={visible.length} />
      {listBusy && items.length === 0 && <RegistrySkeleton />}
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
      {!listBusy&&!error&&visible.length===0&&<p className="empty-state">{items.length===0&&!filters.query&&!filters.status?t("registry.investor.emptyRegistry"):t("registry.investor.noMatches")}</p>}
    </div>
    {detailId&&<button type="button" className="secondary-button mt-4" disabled={busy} onClick={backToList}>{t("registry.investor.back")}</button>}
    {detailId && detailBusy && !detailRecords[detailId] && <RegistrySkeleton />}
    {detailId && detailError && <RequestNotice busy={detailBusy} message="" error={displayMessage(detailError)} onRetry={() => void refresh()} />}
    <div className="mt-6" hidden={!detailId}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{t("registry.investor.walletsEligibility")}</h4>
      </div>
      <ul className="mt-3 space-y-3">
        {Object.values(detailRecords).map(investor => <li className="record-detail rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" id={`investor-${investor.id}`} tabIndex={-1} key={investor.id} hidden={detailId !== investor.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold">{investor.displayName}</p><p className="mt-1 text-xs text-[#61746a]">{t("registry.investor.referenceLabel")}{" "}{investor.externalReference ?? t("registry.investor.referenceMissing")}{" "}{t("registry.investor.countryLabel")}{" "}{investor.countryCode}</p></div>
          </div>
          <dl className="object-facts mt-4"><div><dt>{t("registry.investor.investorType")}</dt><dd>{investor.type === "INDIVIDUAL" ? t("registry.investor.individual") : investor.type === "INSTITUTIONAL" ? t("registry.investor.institution") : t("registry.investor.typeMissing")}</dd></div><div><dt>{t("registry.investor.account")}</dt><dd>{investor.status === "ACTIVE" ? t("registry.investor.accountActive") : investor.status ?? t("registry.investor.missing")}</dd></div><div><dt>{t("registry.investor.eligibility")}</dt><dd>{statusLabel(investor.eligibilityStatus)}</dd></div><div><dt>KYC</dt><dd>{statusLabel(investor.kycStatus)}</dd></div></dl>
          {investorLocked(investor) && <p role="status" className="access-note mt-3">{t("registry.investor.refreshBeforeChange")}</p>}
          {role === "ADMINISTRATOR" && (!Number.isSafeInteger(investor.registryVersion) || investor.registryVersion < 1) && <p className="access-note mt-3">{t("registry.investor.missingRegistryVersion")}</p>}
          {canEditInvestorProfile(investor, role) && (() => {
            const draft = profileDrafts[investor.id] ?? { displayName: investor.displayName, type: investor.type ?? "",
              countryCode: investor.countryCode, externalReference: investor.externalReference, reason: "", expectedVersion: investor.registryVersion };
            const stale = draft.expectedVersion !== investor.registryVersion;
            const locked = busy || investorLocked(investor) || stale;
            const updateDraft = (field: keyof RegistryProfileDraft, value: string) => setProfileDrafts(previous => ({ ...previous, [investor.id]: { ...draft, [field]: value } }));
            return <details className="mt-3 rounded-lg border border-[#d9e3dd] bg-[#f7faf8] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#28744a]">{t("registry.investor.profileTitle")}</summary>
              <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.profileHelp")}</p>
              <p className="mt-1 text-xs text-[#61746a]">{t("registry.investor.registryVersion", { version: investor.registryVersion })}</p>
              {stale && <p role="alert" className="access-note mt-2">{t("registry.investor.profileStaleDraft", { version: draft.expectedVersion })}</p>}
              <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void saveProfile(investor, draft); }}>
                <label className="block text-sm">{t("registry.investor.nameField")}<input className={inputClass} required maxLength={200} value={draft.displayName} disabled={locked} onChange={event => updateDraft("displayName", event.target.value)} /></label>
                <label className="block text-sm">{t("registry.investor.profileReference")}<input className={inputClass} maxLength={100} value={draft.externalReference ?? ""} disabled={locked} onChange={event => updateDraft("externalReference", event.target.value)} /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">{t("registry.investor.typeField")}<select className={inputClass} value={draft.type} disabled={locked} onChange={event => updateDraft("type", event.target.value)}><option value="INDIVIDUAL">{t("registry.investor.individualTest")}</option><option value="INSTITUTIONAL">{t("registry.investor.institutionTest")}</option></select></label>
                  <label className="block text-sm">{t("registry.investor.countryField")}<input className={inputClass} required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" value={draft.countryCode} disabled={locked} onChange={event => updateDraft("countryCode", event.target.value)} /></label>
                </div>
                <label className="block text-sm">{t("registry.investor.reasonLabel")}<select className={inputClass} value={draft.reason} required disabled={locked} onChange={event => updateDraft("reason", event.target.value)}><option value="">{t("registry.investor.chooseReason")}</option>{REGISTRY_REVIEW_REASONS.map(reason => <option key={reason} value={reason}>{reviewReasonLabels[reason]}</option>)}</select></label>
                <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={locked || !investor.type || !investorProfileCommand({ ...investor, type: investor.type }, role, draft)}>{t("registry.investor.profileSave")}</button>
                {stale && <button type="button" className="secondary-button ml-2" disabled={busy || investorLocked(investor)} onClick={() => setProfileDrafts(previous => { const next = { ...previous }; delete next[investor.id]; return next; })}>{t("registry.investor.profileResetDraft")}</button>}
                {registryChangeError?.kind === "profile" && registryChangeError.id === investor.id && <p role="alert" className="form-error">{t("registry.investor.profileFailed")}</p>}
              </form>
            </details>;
          })()}
          <p className="mt-3 text-xs font-semibold text-[#52675b]">{t("registry.investor.walletsLoaded", { shown: investor.wallets.length, total: investor._count.wallets })}</p>
          {investor.wallets.map(wallet => {
            const readyToVerify = qaMode || activeWalletAddress === wallet.address;
            return <div className="mt-2 rounded-lg border border-[#e3eae6] bg-[#f8faf9] p-3" key={wallet.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CopyValue value={wallet.address} label={t("registry.investor.walletCopyLabel", { name: investor.displayName })} />
                <span className={wallet.status === "ACTIVE" ? "status-ready" : "status-wait"}>{statusLabel(wallet.status)}</span>
              </div>
              <p className="mt-1 text-xs text-[#708278]">{t("registry.investor.networkLabel")}{" "}{wallet.network === "SOLANA_LOCALNET" ? "Solana Localnet" : wallet.network}</p>
              {role === "ADMINISTRATOR" && ["ACTIVE", "BLOCKED"].includes(wallet.status) && (!Number.isSafeInteger(wallet.registryVersion) || wallet.registryVersion < 1) && <p className="access-note mt-2">{t("registry.investor.missingRegistryVersion")}</p>}
              {role === "ADMINISTRATOR" && wallet.status === "PENDING" && signWalletMessage && <div className="mt-3 border-t border-[#e3eae6] pt-3">
                <p className={`text-xs leading-5 ${readyToVerify ? "text-[#176a38]" : "text-[#8a5b18]"}`}>{readyToVerify
                  ? qaMode ? t("registry.investor.qaVerifyHelp") : t("registry.investor.phantomReady")
                  : t("registry.investor.phantomSwitch", { address: shortAddress(wallet.address) })}</p>
                <button type="button" className={`${buttonClass} mt-2 ${readyToVerify ? "border-[#163f2b] bg-[#163f2b] text-white" : "bg-white"}`}
                  disabled={busy || investorLocked(investor) || !readyToVerify} onClick={() => void verifyWallet(investor.id, wallet)}>{qaMode ? t("registry.investor.simulateVerification") : readyToVerify ? t("registry.investor.verifyOwnership") : t("registry.investor.awaitingPhantom")}</button>
              </div>}
              {canChangeWalletStatus(investor, wallet, role) && <details className="mt-3 border-t border-[#e3eae6] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#52675b]">{t("registry.investor.walletStatusTitle")}</summary>
                <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.walletStatusHelp")}</p>
                <p className="mt-1 text-xs text-[#61746a]">{t("registry.investor.registryVersion", { version: wallet.registryVersion })}</p>
                <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void changeWalletStatus(investor, wallet); }}>
                  <select className={`${inputClass} mt-0 sm:max-w-xs`} value={walletStatusReasons[wallet.id] ?? ""}
                    required disabled={busy || investorLocked(investor)} aria-label={t("registry.investor.walletStatusReason", { address: shortAddress(wallet.address) })}
                    onChange={event => setWalletStatusReasons(previous => ({ ...previous, [wallet.id]: event.target.value }))}>
                    <option value="">{t("registry.investor.chooseReason")}</option>
                    {REGISTRY_REVIEW_REASONS.map(reason => <option key={reason} value={reason}>{reviewReasonLabels[reason]}</option>)}
                  </select>
                  <button className={buttonClass} disabled={busy || investorLocked(investor) || !walletStatusCommand(investor, wallet, role, walletStatusReasons[wallet.id] ?? "")}>
                    {t(wallet.status === "ACTIVE" ? "registry.investor.blockWallet" : "registry.investor.unblockWallet")}
                  </button>
                </form>
                {registryChangeError?.kind === "wallet" && registryChangeError.id === wallet.id && <p role="alert" className="form-error mt-2">{t("registry.investor.walletStatusFailed")}</p>}
              </details>}
              {role === "ADMINISTRATOR" && wallet.status !== "REVOKED" && <details className="mt-3 border-t border-[#e3eae6] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#7b3e28]">{t("registry.investor.revokeWallet")}</summary>
                <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.revocationHelp")}</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select className={`${inputClass} mt-0 sm:max-w-xs`} value={revocationChoices[wallet.id] ?? ""} disabled={busy || investorLocked(investor)}
                    aria-label={t("registry.investor.revocationReasonLabel", { address: shortAddress(wallet.address) })}
                    onChange={event => setRevocationChoices(previous => ({ ...previous, [wallet.id]: event.target.value }))}>
                    <option value="">{t("registry.investor.chooseReason")}</option>
                    <option value="OWNER_REQUEST">{t("registry.investor.ownerRequest")}</option>
                    <option value="SECURITY_CONCERN">{t("registry.investor.securityConcern")}</option>
                    <option value="WALLET_REPLACEMENT">{t("registry.investor.walletReplacement")}</option>
                    <option value="REGISTRY_CORRECTION">{t("registry.investor.registryCorrection")}</option>
                  </select>
                  <button type="button" className={`danger-button ${buttonClass} border-[#9b4b32] bg-white text-[#7b3e28]`}
                    disabled={busy || investorLocked(investor) || !revocationChoices[wallet.id]}
                    onClick={() => void revokeWallet(investor.id, wallet)}>{t("registry.investor.revokeWallet")}</button>
                </div>
              </details>}
              {wallet.status === "REVOKED" && wallet.revocationReasonCode && <p className="mt-2 text-xs text-[#7b3e28]">{t("registry.investor.reasonLabel")}{" "}{displayMessage(REVOCATION_REASON_LABELS[wallet.revocationReasonCode] ?? wallet.revocationReasonCode)}{wallet.revokedAt ? ` · ${formatDate(wallet.revokedAt)}` : ""}</p>}
            </div>;
          })}
          {walletCursors[investor.id] && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void loadMoreWallets(investor)}>{t("registry.investor.loadMoreWallets")}</button>}
          {detailId === investor.id && <RequestNotice busy={walletBusy} message="" error={walletError === null ? null : displayMessage(walletError)} onRetry={() => void loadMoreWallets(investor)} />}
          {role === "ADMINISTRATOR" && investor.eligibilityStatus === "PENDING_REVIEW" && (() => {
            const hasVerifiedWallet = hasActiveVerifiedWallet(investor);
            const choice = eligibilityChoices[investor.id] ?? "";
            return <div className="mt-3 rounded-lg border border-[#d9e3dd] bg-[#f7faf8] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#28744a]">{t("registry.investor.eligibilityDecision")}</p>
              <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.decisionHelp")}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select className={`${inputClass} mt-0 sm:max-w-xs`} value={choice} disabled={busy || investorLocked(investor)}
                  aria-label={t("registry.investor.eligibilityLabel", { name: investor.displayName })} onChange={event => setEligibilityChoices(previous => ({ ...previous, [investor.id]: event.target.value }))}>
                  <option value="">{t("registry.investor.chooseDecision")}</option>
                  <option value="ELIGIBLE" disabled={!hasVerifiedWallet}>{t("registry.investor.approveDemo")}</option>
                  <option value="NOT_ELIGIBLE">{t("registry.investor.rejectDemo")}</option>
                </select>
                <button type="button" className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`}
                  disabled={busy || investorLocked(investor) || !choice} onClick={() => void decideEligibility(investor.id)}>{t("registry.investor.saveDecision")}</button>
              </div>
              {!hasVerifiedWallet && <p className="mt-2 text-xs text-[#8a5b18]">{t("registry.investor.verifyFirst")}</p>}
            </div>;
          })()}
          {canReviewEligibility(investor, role) && (() => {
            const choice = reviewChoices[investor.id] ?? { decision: "", reason: "" };
            const locked = investorLocked(investor);
            return <details className="mt-3 rounded-lg border border-[#d9e3dd] bg-[#f7faf8] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#28744a]">{t("registry.investor.reviewTitle")}</summary>
              <p className="mt-1 text-xs leading-5 text-[#61746a]">{t("registry.investor.reviewHelp")}</p>
              <p className="mt-1 text-xs text-[#61746a]">{t("registry.investor.registryVersion", { version: investor.registryVersion })}</p>
              <form className="mt-2 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void reviewEligibility(investor); }}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select className={`${inputClass} mt-0`} value={choice.decision} required disabled={busy || locked}
                    aria-label={t("registry.investor.eligibilityLabel", { name: investor.displayName })}
                    onChange={event => setReviewChoices(previous => ({ ...previous, [investor.id]: { ...choice, decision: event.target.value } }))}>
                    <option value="">{t("registry.investor.chooseDecision")}</option>
                    <option value="ELIGIBLE" disabled={investor.eligibilityStatus === "ELIGIBLE" || !hasActiveVerifiedWallet(investor)}>{t("registry.investor.approveDemo")}</option>
                    <option value="NOT_ELIGIBLE" disabled={investor.eligibilityStatus === "NOT_ELIGIBLE"}>{t("registry.investor.rejectDemo")}</option>
                    <option value="SUSPENDED" disabled={investor.eligibilityStatus === "SUSPENDED"}>{t("registry.investor.suspendDecision")}</option>
                  </select>
                  <select className={`${inputClass} mt-0`} value={choice.reason} required disabled={busy || locked}
                    aria-label={t("registry.investor.reviewReason", { name: investor.displayName })}
                    onChange={event => setReviewChoices(previous => ({ ...previous, [investor.id]: { ...choice, reason: event.target.value } }))}>
                    <option value="">{t("registry.investor.chooseReason")}</option>
                    {REGISTRY_REVIEW_REASONS.map(reason => <option key={reason} value={reason}>{reviewReasonLabels[reason]}</option>)}
                  </select>
                </div>
                <button className={`${buttonClass} self-start border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy || locked || !eligibilityReviewCommand(investor, role, choice.decision, choice.reason)}>{t("registry.investor.reviewSave")}</button>
              </form>
              {!hasActiveVerifiedWallet(investor) && <p className="mt-2 text-xs text-[#8a5b18]">{t("registry.investor.verifyFirst")}</p>}
              {registryChangeError?.kind === "review" && registryChangeError.id === investor.id && <p role="alert" className="form-error mt-2">{t("registry.investor.reviewFailed")}</p>}
            </details>;
          })()}
          {investor.eligibilityStatus !== "PENDING_REVIEW" && investor.eligibilityReasonCode && <p className="mt-3 text-xs text-[#61746a]">{t("registry.investor.basisLabel")}{" "}{displayMessage(REASON_LABELS[investor.eligibilityReasonCode] ?? investor.eligibilityReasonCode)}{investor.eligibilityReviewedAt ? ` · ${formatDate(investor.eligibilityReviewedAt)}` : ""}</p>}
        </li>)}
      </ul>
    </div>
    {!detailId && nextCursor && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh(nextCursor)}>{t("registry.investor.showMore")}</button>}
    <RequestNotice busy={busy} message={message} error={error === null ? null : displayMessage(error)} onRetry={()=>void refresh()} />
  </section>;
}

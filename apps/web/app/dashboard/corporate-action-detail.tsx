"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState } from "react";
import { preparedActionPlan, requireCorporateActionTransaction, snapshotWindowMessage, type CorporateActionView, type PreparedAction } from "./action-workflow";
import { SnapshotPanel } from "./snapshot-panel";
import { EntitlementPanel } from "./entitlement-panel";
import { CouponFundingPanel } from "./coupon-funding-panel";
import { CouponExecutionPanel } from "./coupon-execution-panel";
import { RedemptionExecutionPanel } from "./redemption-execution-panel";
import { ControlledCapturePanel } from "./controlled-capture-panel";
import { requireFinalizedResponse, resumedDeploymentSignature } from "./snapshot-workflow";
import { signAndSubmitPrepared, supportsPreparedTransaction } from "./wallet-transaction";
import { statusTone, getActionTypes, getActionStatuses, formatWorkspaceDate } from "./workspace-presentation";
import { CopyValue, DetailTabs, RequestNotice } from "./workspace-controls";
import { formatMinorKzt } from "./entitlement-workflow";
import { actionMaster, ACTION_MASTER_STEPS, type ActionMasterFacts, type ActionMasterStep } from "./action-master-workflow";
import { workspaceActionStepFromHash, workspaceSectionHash, workspaceSelectionFromHash } from "./workspace-navigation";
import { downloadActionEvidence } from "./action-evidence-download";
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60";
const buttonClass = "rounded-lg border border-[#cbd8d0] px-4 py-2 text-sm font-semibold disabled:opacity-50";



export function CorporateActionDetail({ action: selected, role, wallet, walletAddress, request, onBusyChange, onReload, onBack, qaMode = false }: {
  action: CorporateActionView; role: string; wallet: Wallet | undefined; walletAddress: string; request: Request;
  onBusyChange: (busy: boolean) => void; onReload: () => Promise<void>; onBack: () => void;
  qaMode?: boolean;
}) {
  const { t, locale, displayMessage, formatAmount, formatDate } = useLocale();
  const TYPES = getActionTypes(locale), STATUS_LABELS = getActionStatuses(locale);
  const administrator = !qaMode && role === "ADMINISTRATOR";
  const canWrite = administrator && selected.instrument.issuerAuthority === walletAddress;
  const couponExecutionStage = selected.type === "COUPON_PAYMENT" && Boolean(selected.couponExecutionEnabled) &&
    ["APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(selected.status);
  const redemption = ["EARLY_REDEMPTION", "BOND_REDEMPTION"].includes(selected.type);
  const redemptionExecutionStage = redemption && Boolean(selected.redemptionExecutionEnabled) &&
    ["APPROVED", "EXECUTING", "PARTIALLY_SETTLED", "SETTLED", "FINALIZED"].includes(selected.status);
  const [reason, setReason] = useState(() => selected.blockchainTransactions.find(tx => tx.operationType === "ACTION_CANCEL" && ["PREPARED", "SUBMITTED", "UNKNOWN_CONFIRMATION"].includes(tx.status))?.reason ?? "");
  const [plan, setPlan] = useState<PreparedAction | null>(null);
  const [signature, setSignature] = useState(""); const [reviewed, setReviewed] = useState(false);
  const [sendAttempted, setSendAttempted] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useLocalizedTextState("");
  const [error, setError] = useState<string | null>(null); const [tab, setTab] = useState("workflow");
  const [amountMinor, setAmountMinor] = useState<string | null>(null);
  const [masterFacts, setMasterFacts] = useState<ActionMasterFacts>({});
  const [chosenStep, setChosenStep] = useState<ActionMasterStep | null>(null);
  const fundingMounted = useRef(false);
  if (selected.status === "UNDER_REVIEW" && (selected.instrument.tokenPolicy !== "CONTROLLED_FROZEN_V2" ||
      selected.blockchainTransactions.some(tx => tx.operationType === "CONTROLLED_CAPTURE_FINISH" && tx.status === "FINALIZED"))) fundingMounted.current = true;
  const inFlight = useRef(false);
  async function run(task: () => Promise<void>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null); onBusyChange(true);
    try { await task(); } catch (error) { setError(error instanceof Error ? error.message : t("core.operation.did.not.complete")); }
    finally { inFlight.current = false; setBusy(false); onBusyChange(false); }
  }
  async function checkWindow() {
    if (!selected) return;
    const response = await request(`/api/v1/corporate-actions/${selected.id}/snapshot/check-window`, {
      method: "POST", body: JSON.stringify({ expectedVersion: selected.version })
    });
    const resultMessage = snapshotWindowMessage(response, selected.id);
    await onReload(); setMessage(resultMessage);
  }
  async function prepare(phase: "SCHEDULE" | "CANCEL") {
    if (!selected) return;
    const response = await request(`/api/v1/corporate-actions/${selected.id}/prepare`, { method: "POST",
      body: JSON.stringify({ phase, ...(phase === "CANCEL" ? { reason } : {}) }) });
    const prepared = preparedActionPlan(response, selected, walletAddress);
    await requireCorporateActionTransaction(prepared, selected);
    const restored = resumedDeploymentSignature(response);
    setPlan(prepared); setSignature(restored ?? ""); setSendAttempted(restored !== null); setReviewed(restored !== null);
    if (prepared.reason) setReason(prepared.reason);
    setMessage(restored ? t("core.original.signature.restored.run.only.the.finalized.check") : t("core.plan.prepared.review.the.parameters.before.signing.in.phantom"));
  }
  async function send() {
    if (!plan || !reviewed || sendAttempted) throw new Error(t("core.review.the.plan.first"));
    await requireCorporateActionTransaction(plan, selected);
    await signAndSubmitPrepared({ wallet, walletAddress, plan, request, submitFields: { phase: plan.phase },
      submitPath: `/api/v1/corporate-actions/${plan.corporateActionId}/submit`,
      onSigning: () => { setSendAttempted(true); setMessage(t("core.review.the.phantom.request.resending.is.disabled.check.the.signature.if.an.error")); },
      onSignature: setSignature });
    setMessage(t("core.signature.saved.check.finalization.the.check.never.sends.the.transaction.again"));
  }
  async function confirm() {
    if (!plan || !signature) throw new Error(t("core.a.prepared.attempt.and.signature.are.required"));
    const response = await request(`/api/v1/corporate-actions/${plan.corporateActionId}/confirm`, { method: "POST",
      body: JSON.stringify({ operationId: plan.operationId, phase: plan.phase, signature }) });
    requireFinalizedResponse(response, plan.operationId, signature);
    await onReload();
    setMessage(plan.phase === "SCHEDULE" ? t("core.scheduled.the.finalized.transaction.and.action.pda.match.capture.is.available.in.the") : t("core.cancelled.cancellation.is.verified.in.the.network.and.database"));
    setPlan(null); setSignature(""); setSendAttempted(false); setReviewed(false);
  }
  async function cancelDraft() {
    if (!selected) return;
    await request(`/api/v1/corporate-actions/${selected.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
    await onReload(); setMessage(t("core.unsigned.draft.cancelled.the.reason.is.saved.in.the.audit"));
  }


  const master = actionMaster(selected, masterFacts, locale);
  const selectedStep = chosenStep ?? master.recommended;
  const currentStep = ACTION_MASTER_STEPS.indexOf(selectedStep);
  const currentMasterStep = master.steps[currentStep]!;
  const nextStep = master.pending ? master.recommended : currentMasterStep.state === "completed" && currentStep < 5 ? master.steps[currentStep + 1]!.target : master.recommended;
  function openStep(step: ActionMasterStep) {
    setChosenStep(step); setTab("workflow");
    window.history.pushState(null, "", workspaceSectionHash("actions", selected.id, step));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  useEffect(() => {
    const sync = () => {
      if (workspaceSelectionFromHash(window.location.hash, "actions")?.toLowerCase() !== selected.id.toLowerCase()) return;
      setChosenStep(workspaceActionStepFromHash(window.location.hash, selected.id));
    };
    sync(); window.addEventListener("hashchange", sync); window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, [selected.id]);
  return <article id={`action-${selected.id}`} tabIndex={-1} className="action-detail" aria-label={selected.instrument.ticker + t("core.action.details.2")}>
    <div className="object-toolbar"><button type="button" className="secondary-button" disabled={busy} onClick={onBack}>{t("core.back.to.actions")}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(onReload)}>{t("core.refresh.details")}</button></div>
    <div className="object-heading">
      <div>
      <p className="section-kicker">{selected.instrument.ticker} · {selected.instrument.name}</p>
      <h2>{TYPES[selected.type] ?? selected.type}</h2>
      <p>{selected.intent}</p>
      </div>
      <span className={`status-${statusTone(selected.status)}`}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
      </div>
    <dl className="object-facts">
      <div>
      <dt>{t("core.planned.record.date.2")}</dt>
      <dd>{formatDate(selected.recordAt)}</dd>
      </div>
      <div>
      <dt>{t("core.execution.date.2")}</dt>
      <dd>{formatDate(selected.executeAt)}</dd>
      </div>
      <div>
      <dt>{t("core.captured.holders")}</dt>
      <dd>{selected.snapshot?.investorCount ?? t("core.not.captured.yet")}</dd>
      </div>
      <div>
      <dt>{t("core.entitlement.total")}</dt>
      <dd>{amountMinor !== null ? formatAmount(amountMinor) : ["CALCULATED", "UNDER_REVIEW", "APPROVED"].includes(selected.status) ? t("core.amount.not.loaded.yet") : t("core.after.calculation")}</dd>
      </div>
      </dl>
    {!qaMode && <nav className="action-master" aria-label={t("master.title")}>
      <h3>{t("master.title")}</h3><p>{t("master.help")}</p>
      <ol className="master-steps">{master.steps.map((step, index) => <li key={step.id} data-state={step.state}>
        <button type="button" disabled={busy} aria-current={selectedStep === step.id ? "step" : undefined} onClick={() => openStep(step.id)}>
          <span className="progress-number">{step.state === "completed" ? "✓" : index + 1}</span>
          <strong>{step.label}</strong><span>{t(`master.${step.state}`)}</span>
        </button>
      </li>)}</ol>
      <p className="master-navigation-note">{t("master.navigation.only")}</p>
    </nav>}
    {qaMode ? <p className="access-note mt-4">{t("core.simulation.steps.are.in.the.qa.panel.above.this.card.shows.test.terms")}</p> : <div className="next-step" data-master-step={selectedStep}>
      <p className="section-kicker">{t("master.step", { current: currentStep + 1, total: master.steps.length })} · {t(`master.${currentMasterStep.state}`)}</p>
      <strong>{currentMasterStep.label}</strong><p>{currentMasterStep.detail}</p>
      {!administrator && <p>{t("master.read.only")}</p>}
      <div className="master-actions">
        {currentStep > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => openStep(ACTION_MASTER_STEPS[currentStep - 1]!)}>{t("master.previous")}</button>}
        <button type="button" className="primary-button" disabled={busy} onClick={() => openStep(nextStep)}>
          {!master.pending && currentMasterStep.state === "completed" && currentStep < 5 && nextStep === ACTION_MASTER_STEPS[currentStep + 1] ? t("master.continue") : t("master.open.required", { step: master.steps.find(step => step.id === nextStep)!.label })}
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setTab("history")}>{t("master.open.history")}</button>
      </div>
      {master.pending && <><p className="technical-id">{t("core.attempt.uuid")} {master.pending.id}</p>{master.pending.signature && <CopyValue label={t("core.original.transaction.signature")} value={master.pending.signature} />}</>}
    </div>}
    <DetailTabs idPrefix={`action-${selected.id}`} selected={tab} onChange={setTab} tabs={[{id:"workflow",label:t("core.action.workflow")},{id:"terms",label:t("core.terms.and.source")},{id:"history",label:qaMode ? t("core.simulation.history") : t("core.history.and.evidence")}]} />
    <div id={`action-${selected.id}-workflow`} aria-labelledby={`action-${selected.id}-workflow-tab`} hidden={tab !== "workflow"} role="tabpanel" aria-label={t("core.action.workflow")}>
      <div hidden={!qaMode && selectedStep !== "terms"} data-master-panel="terms">
      {canWrite && !plan && selected.status === "DRAFT" && <button className="primary-button mt-4" disabled={busy} onClick={() => void run(() => prepare("SCHEDULE"))}>{t("core.prepare.scheduling.transaction")}</button>}
      {canWrite && !plan && !selected.snapshot && (selected.status === "DRAFT" || selected.status === "SCHEDULED" && selected.instrument.tokenPolicy !== "CONTROLLED_FROZEN_V2") && <details className="danger-details mt-4"><summary>{t("core.cancel.action")}</summary>
        <label className="text-sm">{t("core.cancellation.reason")}<textarea className={inputClass} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || reason.trim().length < 3} onClick={() => void run(selected.status === "DRAFT" ? cancelDraft : () => prepare("CANCEL"))}>{selected.status === "DRAFT" ? t("core.cancel.unsigned.draft") : t("core.prepare.cancel.transaction")}</button>
      </details>}
      {selected.reviewNote && ["RETURNED_FOR_REVISION", "REJECTED"].includes(selected.status) && <p className="mt-3 text-sm">{t("core.reason")} {selected.reviewNote}</p>}
      {selected.status === "SNAPSHOT_MISSED" && <div role="status" className="mt-4 rounded-lg border border-[#efd29d] bg-[#fff8eb] p-4 text-sm">
        <strong>{t("core.this.action.can.no.longer.capture.a.snapshot")}</strong>
        <p className="mt-2">{qaMode ? t("core.the.missed.window.is.simulated.create.a.new.test.action.through.back.to") : t("core.create.a.new.action.with.a.future.record.date.through.back.to.actions")}</p>
      </div>}
      {plan && <div className="transaction-review mt-4">
        <strong>{plan.phase === "SCHEDULE" ? t("core.schedule.action") : t("core.cancel.action")}</strong><p className="mt-2 text-sm">{t("core.network")} {plan.cluster}. {plan.phase === "SCHEDULE" ? t("core.action.terms.will.be.registered.on.chain.no.payment.or.token.movement.occurs") : t("core.the.action.will.be.cancelled.on.chain")}</p>
        <p className="mt-2">{selected.instrument.ticker} · {TYPES[selected.type]} · {selected.intent}</p>
        {selected.type === "EARLY_REDEMPTION" && <p className="mt-2 text-sm">{selected.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" ?
          <>{t("financial.redemption.target.tokens")}: <strong>{selected.redemptionTargetTokens}</strong> · {t("financial.redemption.exact.option")}</> : <>{selected.redemptionPercentageBps} bps · {t("financial.redemption.legacy.option")}</>}</p>}
        <dl className="mt-3 space-y-2 text-xs">{Object.entries({ [t("core.signer")]: plan.requiredSigner, [t("core.holder.capture")]: formatDate(selected.recordAt), [t("core.execution")]: formatDate(selected.executeAt), ...(plan.phase === "CANCEL" ? { [t("core.cancellation.reason")]: plan.reason ?? "—" } : {}) }).map(([label, value]) => <div key={label}>
      <dt className="text-[#61746a]">{label}</dt>
      <dd className="break-all font-mono">{value}</dd>
      </div>)}</dl>
        <details className="term-help"><summary>{t("core.technical.details")}</summary><dl>{Object.entries({ [t("core.attempt.uuid.2")]: plan.operationId, Genesis: plan.networkGenesisHash, Program: plan.programId, "Action PDA": plan.actionAddress }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd><CopyValue value={value} label={label} /></dd></div>)}</dl></details>
        <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy || sendAttempted} onChange={event => setReviewed(event.target.checked)} />{t("core.i.checked.the.network.signer.terms.and.transaction.effect")}</label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !reviewed || sendAttempted || !supportsPreparedTransaction(wallet, plan.cluster)} onClick={() => void run(send)}>{t("core.sign.and.submit")} {plan.phase}</button>
        {!supportsPreparedTransaction(wallet, plan.cluster) && <p className="mt-2 text-xs">{t("core.the.wallet.must.support.the.selected.test.network.and.v0.signing.check.the")}</p>}
        <label className="mt-3 block text-sm">{t("core.transaction.signature")}<input className={inputClass} maxLength={88} value={signature} disabled={busy} onChange={event => setSignature(event.target.value.trim())} /></label>
        <button className={`mt-3 ${buttonClass}`} disabled={busy || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)} onClick={() => void run(confirm)}>{t("core.verify.the.network.and.database.result")}</button>
      </div>}
      </div>
      <div hidden={!qaMode && selectedStep !== "snapshot"} data-master-panel="snapshot">
      {canWrite && !plan && selected.status === "SCHEDULED" && <button type="button" className={`mt-4 ${buttonClass}`} disabled={busy}
        onClick={() => void run(checkWindow)}>{t("core.check.the.holder.capture.window")}</button>}
      {!qaMode && selected.instrument.tokenPolicy === "CONTROLLED_FROZEN_V2" && !["DRAFT", "CANCELLED", "REJECTED"].includes(selected.status) && <ControlledCapturePanel
        action={selected} administrator={administrator} wallet={wallet} walletAddress={walletAddress} request={request}
        onState={capture => setMasterFacts(previous => ({ ...previous, capture }))}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={onReload} />}
      {canWrite && selected.status === "SCHEDULED" && selected.instrument.tokenPolicy !== "CONTROLLED_FROZEN_V2" && <SnapshotPanel key={selected.id} selectedActionId={selected.id} wallet={wallet} walletAddress={walletAddress} request={request} onBusyChange={value => { setBusy(value); onBusyChange(value); }}
        onWindowMissed={async () => { await onReload(); setMessage(t("core.capture.closed.check.the.snapshot.window.or.recover.the.saved.attempt")); }}
        onConfirmed={() => void run(async () => { await onReload(); setMessage(t("core.snapshot.created.finalized.commitment.and.database.match.no.payments.occurred")); })} />}
      {selected.snapshot?.status === "FINALIZED" && <p className="access-note mt-3">{t("core.capture.finalized.on.chain")}</p>}
      </div>
      <div hidden={!qaMode && !["calculation", "readiness", "approval"].includes(selectedStep)} data-master-panel="calculation-readiness-approval">
      {selected.snapshot?.status === "FINALIZED" && <EntitlementPanel key={`entitlements-${selected.id}${qaMode ? `-${selected.version}` : ""}`} actionId={selected.id} canWrite={Boolean(canWrite)} administrator={administrator} request={request} onSummary={setAmountMinor}
        displayStage={qaMode ? "all" : selectedStep === "readiness" ? "readiness" : selectedStep === "approval" ? "approval" : "calculation"}
        onState={entitlements => setMasterFacts(previous => ({ ...previous, entitlements }))}
        onApprovalState={approval => setMasterFacts(previous => ({ ...previous, approval }))}
        canOnchainWrite={administrator && selected.instrument.corporateActionAuthority === walletAddress}
        corporateActionAuthority={selected.instrument.corporateActionAuthority} wallet={wallet} walletAddress={walletAddress}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await onReload(); }} />}
      <div hidden={selectedStep !== "readiness"}>
      {!qaMode && (selected.type === "COUPON_PAYMENT" || redemption && selected.redemptionExecutionEnabled) && fundingMounted.current && <CouponFundingPanel
        key={`funding-${selected.id}`} actionId={selected.id} canWrite={Boolean(canWrite && selected.status === "UNDER_REVIEW")} wallet={wallet} walletAddress={walletAddress} request={request}
        onState={budget => setMasterFacts(previous => ({ ...previous, budget }))}
        redemption={redemption}
        onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={async () => { await onReload(); }} />}
      </div></div>
      <div hidden={!qaMode && selectedStep !== "execution"} data-master-panel="execution">
      {!qaMode && couponExecutionStage &&
        <CouponExecutionPanel actionId={selected.id} administrator={administrator} wallet={wallet} walletAddress={walletAddress} request={request}
          onState={execution => setMasterFacts(previous => ({ ...previous, execution }))}
          onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={onReload} />}
      {!qaMode && redemptionExecutionStage &&
        <RedemptionExecutionPanel actionId={selected.id} actionType={selected.type} administrator={administrator} wallet={wallet} walletAddress={walletAddress} request={request}
          onState={execution => setMasterFacts(previous => ({ ...previous, execution }))}
          onBusyChange={value => { setBusy(value); onBusyChange(value); }} onChanged={onReload} />}
      {!qaMode && !couponExecutionStage && !redemptionExecutionStage && <p className="access-note mt-4">{t("master.details.unavailable")}</p>}
      {!qaMode && <div className="workflow-section">
        <h3>{t("core.history.and.evidence")}</h3><p className="access-note">{t("core.history.and.evidence.are.separate.from.operation.controls")}</p>
        <div className="master-actions">
          {(["json", "csv"] as const).map(format => <button type="button" className="secondary-button" disabled={busy} key={format}
            onClick={() => void run(async () => { const downloaded = await downloadActionEvidence(selected.id, format);
              setMessage(t("master.export.done", { filename: downloaded.filename, hash: downloaded.sha256 })); })}>{t(format === "json" ? "master.export.json" : "master.export.csv")}</button>)}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setTab("history")}>{t("master.open.history")}</button>
        </div>
      </div>}
      </div>
    </div>
    <div id={`action-${selected.id}-terms`} aria-labelledby={`action-${selected.id}-terms-tab`} hidden={tab !== "terms"} role="tabpanel" aria-label={t("core.terms.and.source")}><CopyValue label={t("core.action.uuid")} value={selected.id} />
      {selected.snapshot && <div className="evidence-row">
      <strong>{qaMode ? t("core.qa.snapshot.simulated.capture") : `Snapshot · ${selected.snapshot.status}`}</strong>
      <p>{t("core.planned")} {formatDate(selected.snapshot.recordAt)} · {qaMode ? t("core.simulated.date") : t("core.effective.capture")}: {formatDate(selected.snapshot.blockTime)}</p>
      <p>{!qaMode && <>Slot: {selected.snapshot.solanaSlot} · </>}{t("core.investors")} {selected.snapshot.investorCount} {t("core.wallets")} {selected.snapshot.walletCount} {t("core.balance")} {selected.snapshot.totalBalance}</p>
      {qaMode ? <p>{t("core.the.holder.set.is.synthetic.this.screen.creates.no.slot.network.confirmation.or")}</p> : <p className="technical-id">SHA-256: {selected.snapshot.snapshotHash}</p>}
      </div>}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt>{t("core.planned.record.time")}</dt><dd>{formatDate(selected.recordAt)}</dd></div><div><dt>{t("core.execution")}</dt><dd>{formatDate(selected.executeAt)}</dd></div>
        <div><dt>{t("core.source")}</dt><dd className="break-all">{selected.sourceType} · {selected.sourceReference ?? "—"}</dd></div><div><dt>{t("core.document")}</dt><dd className="break-all">{selected.sourceDocument ?? "—"}</dd></div>
        {selected.type === "EARLY_REDEMPTION" && <div><dt>{t("core.early.redemption")}</dt><dd>{selected.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" ?
          <>{t("financial.redemption.target.tokens")}: {selected.redemptionTargetTokens} · {t("financial.redemption.exact.option")}</> : <>{selected.redemptionPercentageBps} bps · {t("financial.redemption.legacy.option")}</>} · {selected.redemptionPriceMinor} {t("core.minor.units.per.bond")}</dd>
          {!qaMode && selected.redemptionAllocationPolicy === "exact-target-largest-remainder-v2" && !selected.exactTargetRedemptionEnabled && <p className="access-note">{t("financial.redemption.exact.disabled")}</p>}</div>}</dl>

    </div>
    <div id={`action-${selected.id}-history`} aria-labelledby={`action-${selected.id}-history-tab`} hidden={tab !== "history"} role="tabpanel" aria-label={qaMode ? t("core.simulation.history") : t("core.history.and.evidence")}>
      <h3>{qaMode ? t("core.simulation.steps") : t("core.transactions")}</h3>{selected.blockchainTransactions.length === 0 && <p className="empty-state">{qaMode ? t("core.no.simulation.steps.for.this.action.yet") : t("core.no.transactions.for.this.action.yet")}</p>}
      {selected.blockchainTransactions.map(tx => <div key={tx.id} className="evidence-row">
      <strong>{tx.operationType} · {qaMode ? t("core.simulated.locally") : tx.status}</strong>
      <p className="technical-id">{t("core.attempt")} {tx.id}</p>
      {qaMode ? <p>{t("core.qa.no.solana.signatures.or.transactions.exist")}</p> : tx.signature ? <CopyValue label={t("core.original.transaction.signature")} value={tx.signature} /> : <p>{t("core.unsigned")}</p>}{tx.lastErrorCode && <p>{tx.lastErrorCode}</p>}{!qaMode && tx.status === "UNKNOWN_CONFIRMATION" && <p>{t("core.outcome.unknown.check.the.original.signature.resending.is.not.permitted")}</p>}</div>)}
      <h3 className="mt-5">{t("core.decision.history")}</h3>{!selected.events?.length && <p className="empty-state">{t("core.no.audit.events.in.the.response")}</p>}{selected.events?.map(event => <div key={event.id} className="evidence-row">
      <strong>{event.event}</strong>
      <p>{formatDate(event.createdAt)}</p>
      <p className="technical-id">{event.actorWallet ?? t("core.system")}</p>
      </div>)}
    </div>
    <RequestNotice busy={busy} message={message} error={error} onRetry={() => void run(onReload)} />
  </article>;
}

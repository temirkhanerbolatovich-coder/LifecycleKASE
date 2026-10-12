"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";
import { createTranslator, getDisplayLocale, translateStoredMessage } from "./locale";
import { formatWorkspaceDate } from "./workspace-presentation";
import { useEffect, useRef, useState } from "react";
import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone } from "./workspace-presentation";
import { shortWalletAddress } from "./wallet-account-selection";
type RecordRow = { id: string; createdAt: string; corporateActionId: string | null; instrumentId?: string | null; operationType?: string; status?: string;
  signature?: string | null; lastErrorCode?: string | null; requiredSigner?: string | null; event?: string; entityType?: string;
  entityId?: string; actorWallet?: string | null; metadataJson?: unknown };
export function EvidencePanel({ kind, request, onOpenAction, onOpenInstrument, onOpenInvestor }: { kind: "transactions" | "audit";
  request: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>; onOpenAction: (id: string) => void;
  onOpenInstrument: (id: string) => void; onOpenInvestor: (id: string) => void;
}) {
  const { t, locale, displayMessage } = useLocale();
  const [rows, setRows] = useState<RecordRow[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState({ ...INITIAL_FILTERS, sort: "desc" }); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function load(more = false, signal?: AbortSignal) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await request(`/api/v1/${kind}?limit=20${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal ? { signal } : undefined);
      if (!Array.isArray(result["items"]) || result["nextCursor"] !== null && typeof result["nextCursor"] !== "string") throw new Error(t("core.could.not.read.the.journal"));
      if (!signal?.aborted) { setRows(previous => more ? [...previous, ...result["items"] as RecordRow[]].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index) : result["items"] as RecordRow[]); setCursor(result["nextCursor"] as string | null); }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : t("core.journal.unavailable")); }
    finally { inFlight.current = false; if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { void load(); }, [kind, request]);
  const labels: Record<string, string> = kind === "transactions" ? { PREPARED: t("core.prepared"), SUBMITTED: t("core.submitted"), UNKNOWN_CONFIRMATION: t("core.outcome.unknown"), FINALIZED: t("core.finalized"), FAILED: t("core.error"), QA_SIMULATED: t("core.qa.simulation") } : {};
  const shown = filterRegistry(rows, filters, row => [evidenceLabel(row.operationType ?? row.event ?? ""), row.operationType, row.event, row.id, row.corporateActionId, row.instrumentId, row.entityId, row.signature, row.actorWallet].join(" "), row => row.status ?? "", row => row.createdAt);
  return <section aria-label={kind === "transactions" ? t("core.transaction.journal") : t("core.audit.journal")}>
    <div className="registry-heading"><div><h3>{kind === "transactions" ? t("core.transaction.history") : t("core.decision.history")}</h3><p>{kind === "transactions" ? t("core.check.attempts.with.an.unknown.outcome.first") : t("core.who.performed.an.operation.when.and.for.which.entity")}</p></div>
      <button className="secondary-button" disabled={busy} onClick={() => void load()}>{t("core.refresh")}</button></div>
    <RegistryToolbar label={t("core.journal")} loaded={rows.length} shown={shown.length} filters={filters} onChange={setFilters} statuses={labels} sortLabel={t("core.date")} />
    {busy && rows.length === 0 && <RegistrySkeleton />}
    {shown.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label={t("core.journal.entries")}><table className="registry-table"><thead><tr>
      <th>{t("core.date")}</th><th>{t("core.operation")}</th><th>{kind === "transactions" ? t("core.outcome") : t("core.actor")}</th><th>{t("core.action.details")}</th></tr></thead>
      <tbody>{shown.map(row => <tr key={row.id}><td className="whitespace-nowrap">{formatWorkspaceDate(row.createdAt)}</td>
        <td><strong>{evidenceLabel(row.operationType ?? row.event ?? "")}</strong></td>
        <td>{kind === "transactions" ? <span className={`status-${statusTone(row.status ?? "")}`}>{displayMessage(labels[row.status ?? ""] ?? row.status ?? "")}</span> : <span title={row.actorWallet ?? ""}>{row.actorWallet ? shortWalletAddress(row.actorWallet) : t("core.system")}</span>}</td>
        <td>{row.corporateActionId && <button className="table-object-link" onClick={() => onOpenAction(row.corporateActionId!)}>{t("core.open.action")}</button>}
          {!row.corporateActionId && (row.instrumentId || row.entityType === "Instrument") && <button className="table-object-link" onClick={() => onOpenInstrument(row.instrumentId ?? row.entityId!)}>{t("core.open.instrument")}</button>}
          {!row.corporateActionId && row.entityType === "Investor" && row.entityId && <button className="table-object-link" onClick={() => onOpenInvestor(row.entityId!)}>{t("core.open.investor")}</button>}
          <details className="term-help"><summary>{t("core.entry.details")}</summary><p className="technical-id">{row.operationType ?? row.event} · UUID: {row.id}</p>
            {row.signature && <CopyValue value={row.signature} label={t("core.original.signature")} />}{row.lastErrorCode && <p>{t("core.reason")} {row.lastErrorCode}</p>}
            {row.entityId && <p className="technical-id">{row.entityType}: {row.entityId}</p>}
            {row.metadataJson !== undefined && <pre className="technical-id whitespace-pre-wrap">{JSON.stringify(row.metadataJson, null, 2)}</pre>}</details></td></tr>)}</tbody></table></div>}
    {!busy && !error && shown.length === 0 && <p className="empty-state">{rows.length ? t("core.no.records.match.the.selected.filters") : t("core.the.journal.has.no.entries.yet")}</p>}
    {cursor && <button className="secondary-button mt-4" disabled={busy} onClick={() => void load(true)}>{t("core.load.more")}</button>}
    <RequestNotice busy={busy} message="" error={error} onRetry={() => void load()} />
  </section>;
}

function evidenceLabel(value: string) {
  const t = createTranslator(getDisplayLocale());
  const labels: Record<string, string> = { COUPON_PAYMENT: t("core.coupon.payment"), COUPON_FINALIZE: t("core.final.receipt"), COUPON_FUNDING: t("core.budget.funding"),
    ACTION_APPROVAL: t("core.action.approval"), ACTION_RESERVE: t("core.budget.reservation"), ACTION_RELEASE: t("core.reserve.refund"), ACTION_APPROVAL_POLICY: t("core.approver.assignment"),
    ENTITLEMENT_REGISTER: t("core.entitlement.registration"), CALCULATION_FINALIZE: t("core.calculation.finalization"), CALCULATION_RESET: t("core.reset.registration"),
    SNAPSHOT_REGISTER: t("core.holder.registration"), SNAPSHOT_REGISTRATION: t("core.holder.registration"), ACTION_SCHEDULE: t("core.schedule.action"), ACTION_CANCEL: t("core.cancel.action"),
    COUPON_EXECUTION_PREPARED: t("core.payment.plan.prepared"), COUPON_PAYMENT_FINALIZED: t("core.payment.finalized"), COUPON_ACTION_FINALIZED: t("core.action.completed"),
    ACTION_RECEIPT_ACCESSED: t("core.final.receipt.opened"), ENTITLEMENTS_REVIEW_DECIDED: t("core.calculation.decision"), ENTITLEMENTS_CALCULATED: t("core.entitlements.calculated"),
    CORPORATE_ACTION_DRAFT_CREATED: t("core.action.draft.created"), CORPORATE_ACTION_DRAFT_CANCELLED: t("core.draft.cancelled"),
    ACTION_APPROVAL_PREPARED: t("core.approval.prepared"), ACTION_APPROVAL_FINALIZED: t("core.approval.finalized"),
    COUPON_FUNDING_PREPARED: t("core.funding.prepared"), COUPON_FUNDING_FINALIZED: t("core.budget.funded"),
    SNAPSHOT_CAPTURED: t("core.holders.captured"), SNAPSHOT_REGISTRATION_PREPARED: t("core.holder.registration.prepared"),
    SNAPSHOT_REGISTERED: t("core.holders.registered"), INSTRUMENT_DRAFT_CREATED: t("core.instrument.draft.created"),
    INSTRUMENT_MINT_SETUP_PREPARED: t("core.token.issuance.prepared"), INSTRUMENT_MINT_SETUP_FINALIZED: t("core.tokens.issued"),
    INSTRUMENT_DISTRIBUTION_PREPARED: t("core.distribution.prepared"), INSTRUMENT_DISTRIBUTION_FINALIZED: t("core.tokens.distributed"),
    INSTRUMENT_INITIALIZE_PREPARED: t("core.instrument.registration.prepared"), INSTRUMENT_INITIALIZED: t("core.instrument.registered"),
    INSTRUMENT_ACTIVATION_PREPARED: t("core.activation.prepared"), INSTRUMENT_ACTIVATED: t("core.instrument.activated"),
    INVESTOR_CREATED: t("core.investor.added"), INVESTOR_WALLET_ATTACHED: t("core.investor.wallet.added"), INVESTOR_WALLET_REVOKED: t("core.wallet.revoked"),
    INVESTOR_ELIGIBILITY_DECIDED: t("core.investor.eligibility.recorded"), OPERATOR_PROVISIONED: t("core.operator.registered"),
    PROGRAM_UPGRADE_PREPARED: t("core.program.upgrade.prepared"), PROGRAM_UPGRADE_FINALIZED: t("core.program.upgraded"), PROGRAM_UPGRADE_ATTEMPT_EXPIRED: t("core.upgrade.attempt.expired") };
  return labels[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("ru-RU");
}

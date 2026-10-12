"use client";
import { useLocale, useLocalizedTextState } from "./locale-context";

import { useId, useRef, useState } from "react";
import type { CorporateActionView } from "./action-workflow";
import type { QaActor, QaActionStep } from "./qa-sandbox";

type QaAction = CorporateActionView & {
  qa?: {
    reservedMinor: string;
    treasuryBalanceMinor: string;
    totalAmountMinor: string;
    paid: number;
    payable: number;
    simulation: true;
  };
};

type ActionControl = {
  step: QaActionStep;
  label: string;
  actor: QaActor;
  requiresReason?: boolean;
};

const ACTION_CONTROLS: Record<string, ActionControl[]> = {
  DRAFT: [
    { step: "SCHEDULE", label: "Запланировать действие", actor: "ISSUER" },
    { step: "CANCEL", label: "Отменить черновик", actor: "ISSUER", requiresReason: true }
  ],
  SCHEDULED: [
    { step: "SNAPSHOT", label: "Зафиксировать держателей", actor: "ISSUER" },
    { step: "MISS_WINDOW", label: "Смоделировать пропуск окна", actor: "ISSUER" },
    { step: "CANCEL", label: "Отменить действие", actor: "ISSUER", requiresReason: true }
  ],
  SNAPSHOT_CREATED: [{ step: "CALCULATE", label: "Рассчитать начисления", actor: "ISSUER" }],
  RETURNED_FOR_REVISION: [{ step: "CALCULATE", label: "Пересчитать по прежнему snapshot", actor: "ISSUER" }],
  CALCULATED: [{ step: "SUBMIT", label: "Передать на согласование", actor: "ISSUER" }],
  UNDER_REVIEW: [
    { step: "FUND", label: "Пополнить тестовый бюджет", actor: "ISSUER" },
    { step: "RESERVE", label: "Зарезервировать бюджет", actor: "ISSUER" },
    { step: "APPROVE", label: "Согласовать расчёт", actor: "APPROVER" },
    { step: "RETURN", label: "Вернуть на доработку", actor: "APPROVER", requiresReason: true },
    { step: "REJECT", label: "Отклонить расчёт", actor: "APPROVER", requiresReason: true }
  ],
  APPROVED: [{ step: "PAY", label: "Выплатить следующему держателю", actor: "ISSUER" }],
  EXECUTING: [{ step: "PAY", label: "Выплатить следующему держателю", actor: "ISSUER" }],
  PARTIALLY_SETTLED: [{ step: "PAY", label: "Выплатить следующему держателю", actor: "ISSUER" }],
  SETTLED: [{ step: "FINALIZE", label: "Завершить действие и создать документ", actor: "ISSUER" }]
};

const ACTOR_LABELS: Record<QaActor, string> = {
  ISSUER: "эмитент",
  APPROVER: "согласующий",
  AUDITOR: "аудитор"
};

/** These controls call only the per-tab QA simulation, never operator endpoints or a wallet. */
export function QaActionControls({ action, actor, sandbox, onChanged }: {
  action: QaAction;
  actor: QaActor;
  sandbox: { advanceAction: (id: string, step: QaActionStep, note?: string) => Promise<Record<string, unknown>>;
    actionReceipt: (id: string) => Record<string, unknown> };
  onChanged: () => Promise<void>;
}) {
  const { t, displayMessage, formatAmount } = useLocale();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedLabel, setCompletedLabel] = useState("");
  const message = completedLabel ? t("core.simulationCompleted", { step: displayMessage(completedLabel) }) : "";
  const inFlight = useRef(false);
  const controls = ACTION_CONTROLS[action.status] ?? [];
  const reasonNeeded = controls.some(control => control.requiresReason);
  const validReason = note.trim().length >= 3;

  function blockedReason(control: ActionControl): string | null {
    if (actor !== control.actor) return t("core.availableRole", { role: displayMessage(ACTOR_LABELS[control.actor]) });
    if (control.requiresReason && !validReason) return t("core.provide.a.reason.of.at.least.3.characters");
    if (!action.qa) return null;
    const total = BigInt(action.qa.totalAmountMinor);
    const reserved = BigInt(action.qa.reservedMinor);
    const treasury = BigInt(action.qa.treasuryBalanceMinor);
    if (control.step === "SUBMIT" && total === 0n) return displayMessage("Все начисления округлились до нуля. Согласование и резерв недоступны. Расчёт сохранён; проверьте условия и округление.");
    if (control.step === "FUND" && treasury >= total - reserved) return t("core.the.test.budget.already.covers.the.entitlements");
    if (control.step === "RESERVE" && reserved >= total) return t("core.the.budget.is.already.reserved");
    if (control.step === "RESERVE" && treasury < total - reserved) return t("core.fund.the.test.budget.first");
    if (control.step === "APPROVE" && reserved < total) return t("core.the.issuer.must.reserve.the.budget.first");
    return null;
  }

  async function advance(control: ActionControl): Promise<void> {
    if (inFlight.current || blockedReason(control)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setCompletedLabel("");
    try {
      await sandbox.advanceAction(action.id, control.step, note.trim() || undefined);
      // Refresh errors must not replay an already applied simulation transition.
      setCompletedLabel(control.label);
      try { await onChanged(); }
      catch { setError(t("core.simulation.step.completed.but.the.card.did.not.refresh.refresh.the.card.without")); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("core.simulation.step.failed"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="surface-card mb-5 border-[#edcf98] bg-[#fff8e9]" aria-label={t("core.qa.corporate.action.simulation")} aria-busy={busy}>
    <p className="section-kicker">{t("core.qa.simulation")}</p>
    <h3 className="mt-1 text-lg font-semibold">{t("core.test.the.workflow.without.a.wallet")}</h3>
    <p className="mt-2 text-sm leading-6 text-[#765d38]">{t("core.every.step.changes.only.this.tab.s.test.data.payments.redemptions.and.the")}</p>
    {actor === "AUDITOR" && <p className="access-note mt-3">{t("core.auditors.inspect.results.select.issuer.or.approver.in.the.qa.panel.to.change")}</p>}
    {action.qa && <dl className="object-facts mt-3">
      <div><dt>{t("core.test.amount")}</dt><dd>{formatAmount(action.qa.totalAmountMinor)}</dd></div>
      <div><dt>{t("core.reserved")}</dt><dd>{formatAmount(action.qa.reservedMinor)}</dd></div>
      <div><dt>{t("core.holders.paid")}</dt><dd>{action.qa.paid} {t("core.of")} {action.qa.payable}</dd></div>
    </dl>}
    {controls.length > 0 && <>
      {(reasonNeeded || action.status === "UNDER_REVIEW" || action.status === "CALCULATED") && <label htmlFor={noteId} className="mt-4 block text-sm font-medium">
        {t("core.comment.reason")}
        <textarea id={noteId} className="mt-1 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2 text-sm disabled:opacity-60" rows={2}
          maxLength={1000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
        <span className="mt-1 block text-xs font-normal text-[#765d38]">{t("core.cancellation.return.and.rejection.require.a.3.1000.character.reason.input.is.preserved")}</span>
      </label>}
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {controls.map(control => {
          const reason = blockedReason(control);
          return <div key={control.step} className="max-w-xs">
            <button type="button" className="secondary-button" disabled={busy || Boolean(reason)} title={reason ?? undefined}
              onClick={() => void advance(control)}>{displayMessage(control.label)}</button>
            {reason && <p className="mt-1 text-xs leading-5 text-[#765d38]">{reason}</p>}
          </div>;
        })}
      </div>
    </>}
    {action.status === "FINALIZED" && <div className="mt-3"><p className="text-sm font-semibold text-[#173426]">{t("core.simulation.completed.the.receipt.contains.test.results.only.without.on.chain.evidence")}</p>
      <button className="secondary-button mt-3" onClick={() => {
        const receipt = sandbox.actionReceipt(action.id);
        const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `qa-${action.type.toLowerCase()}-${action.id}.json`;
        link.click(); URL.revokeObjectURL(url);
      }}>{t("core.download.qa.receipt")}</button></div>}
    {["CANCELLED", "REJECTED", "SNAPSHOT_MISSED"].includes(action.status) && <p className="mt-3 text-sm leading-6 text-[#765d38]">{t("core.scenario.stopped.create.a.new.test.action.or.reset.the.sandbox.in.the")}</p>}
    {message && <p role="status" className="mt-3 text-sm leading-6">{message}</p>}
    {error && <p role="alert" className="form-error mt-3">{displayMessage(error)}</p>}
    {busy && <p role="status" className="mt-3 text-sm">{t("core.running.simulation.step")}</p>}
  </section>;
}

export function QaInstrumentControls({ instrument, actor, sandbox, onChanged }: {
  instrument: { id: string; status: string };
  actor: QaActor;
  sandbox: { activateInstrument: (id: string) => Promise<Record<string, unknown>> };
  onChanged: () => Promise<void>;
}) {
  const { t, locale, displayMessage } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useLocalizedTextState("");
  const inFlight = useRef(false);

  async function activate(): Promise<void> {
    if (inFlight.current || actor !== "ISSUER" || instrument.status !== "DRAFT") return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await sandbox.activateInstrument(instrument.id);
      setMessage(t("core.simulation.instrument.activated.35.test.bonds.distributed.to.holders"));
      try { await onChanged(); }
      catch { setError(t("core.simulation.activation.completed.but.the.card.did.not.refresh.refresh.the.card.without")); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("core.test.instrument.activation.failed"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="surface-card mt-4 border-[#edcf98] bg-[#fff8e9]" aria-label={t("core.qa.instrument.issuance.simulation")} aria-busy={busy}>
    <p className="section-kicker">{t("core.qa.simulated.issuance")}</p>
    <p className="mt-2 text-sm leading-6 text-[#765d38]">{t("core.activation.simulates.issuance.and.distribution.of.35.test.bonds.in.this.tab")}</p>
    {instrument.status === "DRAFT" ? <>
      <button type="button" className="secondary-button mt-3" disabled={busy || actor !== "ISSUER"} onClick={() => void activate()}>{t("core.activate.test.instrument")}</button>
      {actor !== "ISSUER" && <p className="mt-2 text-xs text-[#765d38]">{t("core.activation.requires.the.issuer.role.select.it.in.the.qa.panel")}</p>}
    </> : <p className="mt-3 text-sm">{t("core.the.instrument.has.already.completed.simulated.activation")}</p>}
    {message && <p role="status" className="mt-3 text-sm leading-6">{message}</p>}
    {error && <p role="alert" className="form-error mt-3">{displayMessage(error)}</p>}
    {busy && <p role="status" className="mt-3 text-sm">{t("core.running.simulated.activation")}</p>}
  </section>;
}

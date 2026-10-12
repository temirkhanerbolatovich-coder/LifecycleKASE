"use client";
import { LanguageSelector, useLocale, useLocalizedTextState } from "../dashboard/locale-context";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { OperatorWorkspace } from "../dashboard/operator-workspace";
import { QaActionControls, QaInstrumentControls } from "../dashboard/qa-controls";
import { createQaSandbox, QA_APPROVER, QA_ISSUER, type QaActor } from "../dashboard/qa-sandbox";

const actorLabels: Record<QaActor, string> = {
  ISSUER: "Эмитент · администратор", APPROVER: "Согласующий · администратор", AUDITOR: "Аудитор · только просмотр"
};

export function QaWorkspace() {
  const { displayMessage } = useLocale();
  const [sandbox, setSandbox] = useState<ReturnType<typeof createQaSandbox> | null>(null);
  const [actor, setActor] = useState<QaActor>("ISSUER");
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useLocalizedTextState("Тестовые данные готовы. Начните с реестров или корпоративных действий.");
  const failNext = useRef(false);
  const [failureArmed, setFailureArmed] = useState(false);

  // Fast Refresh repeats effects; preserve the isolated model during source updates.
  useEffect(() => { setSandbox(current => current ?? createQaSandbox()); }, []);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    if (!sandbox) throw new Error("QA-песочница ещё загружается.");
    if (failNext.current) {
      failNext.current = false; setFailureArmed(false);
      throw new Error("QA: симулирован сбой этого запроса. Обновите данные; уже выполненный шаг не повторяется автоматически.");
    }
    return sandbox.request(path, init);
  }, [sandbox]);

  function changeActor(next: QaActor) {
    sandbox?.setActor(next); setActor(next); setGeneration(value => value + 1);
    setMessage("Тестовая роль изменена.");
  }

  function reset() {
    sandbox?.reset(); sandbox?.setActor(actor); failNext.current = false; setFailureArmed(false);
    setGeneration(value => value + 1); setMessage("QA-данные сброшены. Рабочая база и сохранённые подписи не затрагиваются.");
  }

  function downloadState() {
    if (!sandbox) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(sandbox.exportState(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "lifecyclekase-qa-simulation.json";
    link.click(); URL.revokeObjectURL(url);
  }

  const walletAddress = actor === "APPROVER" ? QA_APPROVER : QA_ISSUER;

  return <div className="dashboard-shell text-[#14291f]">
    <header className="exchange-topbar px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Image src="/brand/lifecyclekase-mark.png" width={26} height={26} alt="LifecycleKASE" />
          <div><p className="font-bold text-white">LifecycleKASE</p><p className="text-xs text-[#9da6ae]">{displayMessage("QA-песочница без кошелька")}</p></div></div>
        <LanguageSelector /><a href="/dashboard" className="text-sm text-white underline underline-offset-4">{displayMessage("Вход оператора")}</a>
      </div>
    </header>
    <section className="border-b border-[#edcf98] bg-[#fff8e9] px-4 py-4 sm:px-6" aria-label={displayMessage("Настройки QA-песочницы")}>
      <p className="font-semibold text-[#6e4510]">{displayMessage("QA · все данные и финансовые действия симулируются")}</p>
      <p className="mt-1 text-sm text-[#765d38]">{displayMessage("Можно создавать записи и проходить сценарии. Данные изолированы в этой странице и сбрасываются при её обновлении. Настоящих подписей, выплат и сжиганий нет.")}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">{displayMessage("Тестовая роль")}<select className="ml-2 rounded-lg border border-[#cbd8d0] bg-white px-3 py-2" value={actor}
          disabled={busy || !sandbox} onChange={event => changeActor(event.target.value as QaActor)}>
          {Object.entries(actorLabels).map(([value, label]) => <option key={value} value={value}>{displayMessage(label)}</option>)}</select></label>
        <button className="secondary-button" disabled={busy || !sandbox} onClick={reset}>{displayMessage("Сбросить QA-данные")}</button>
        <button className="secondary-button" disabled={busy || !sandbox} onClick={downloadState}>{displayMessage("Скачать результаты QA")}</button>
        <button className="secondary-button" disabled={busy || !sandbox || failureArmed} onClick={() => {
          failNext.current = true; setFailureArmed(true);
        }}>{failureArmed ? displayMessage("Следующий запрос завершится ошибкой") : displayMessage("Сбой следующего запроса")}</button>
      </div>
    </section>
    {!sandbox ? <p role="status" className="p-6">{displayMessage("Загрузка тестовой среды…")}</p> : <OperatorWorkspace
      key={`qa-${actor}-${generation}`} qaMode user={{ id: `qa-${actor}-${generation}`, displayName: `QA · ${displayMessage(actorLabels[actor])}`, role: actor === "AUDITOR" ? "AUDITOR" : "ADMINISTRATOR" }}
      walletAddress={walletAddress} selectedAccountAddress={walletAddress} sessionExpired={false} busy={busy} message={message}
      wallet={undefined} request={request} apiState="ready" connectionSettings={<p className="mt-3 text-sm">{displayMessage("Песочница работает без API, кошелька и блокчейна. Используйте переключатель роли сверху для отдельного согласования.")}</p>}
      signWalletMessage={async () => "QA_SIMULATED_PROOF"} onBusyChange={setBusy} onRecover={() => {}} onLogout={() => { window.location.assign("/dashboard"); }}
      renderQaActionControls={(action, onChanged) => <QaActionControls action={action} actor={actor} sandbox={sandbox} onChanged={onChanged} />}
      renderQaInstrumentControls={(instrument, onChanged) => <QaInstrumentControls instrument={instrument} actor={actor} sandbox={sandbox} onChanged={onChanged} />}
    />}
    <footer className="dashboard-footer">{displayMessage("QA-результат проверяет интерфейс и симуляцию. Для приёмки API, Phantom и Solana используйте отдельные тесты проекта.")}</footer>
  </div>;
}

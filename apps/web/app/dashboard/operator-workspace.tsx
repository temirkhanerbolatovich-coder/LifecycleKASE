"use client";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceOverview } from "./workspace-overview";
import { CorporateActionPanel } from "./corporate-action-panel";
import { InstrumentPanel } from "./instrument-panel";
import { InvestorPanel } from "./investor-panel";
import { EvidencePanel } from "./evidence-panel";
import { ProgramUpgradePanel } from "./program-upgrade-panel";
import { SnapshotPanel } from "./snapshot-panel";
import { workspaceTimeZone } from "./workspace-presentation";
import { shortWalletAddress } from "./wallet-account-selection";
import { WORKSPACE_SECTIONS, workspaceSectionFromHash, workspaceSectionHash, workspaceSelectionFromHash, type WorkspaceSection } from "./workspace-navigation";

type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type OperatorUser = { id: string; displayName: string; role: string };

const icons: Record<WorkspaceSection, ReactNode> = {
  overview: <path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" />,
  actions: <path d="M7 3h10v3h3v15H4V6h3V3Zm2 3h6V5H9v1Zm-2 4v8h10v-8H7Zm2 2h6v2H9v-2Z" />,
  instruments: <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L17.7 7 12 9.7 6.3 7 12 4.3ZM5 8.6l6 2.9v7.8l-6-3V8.6Zm8 10.7v-7.8l6-2.9v7.7l-6 3Z" />,
  investors: <path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-3c0-3.3 2.7-6 6-6s6 2.7 6 6v3H2Zm13-8.5c3.5.5 6 2.7 6 5.5v3h-5v-3c0-2-.6-3.9-1.7-5.4l.7-.1Z" />,
  transactions: <path d="M4 7h13l-3-3 1.4-1.4L21 8l-5.6 5.4L14 12l3-3H4V7Zm16 10H7l3 3-1.4 1.4L3 16l5.6-5.4L10 12l-3 3h13v2Z" />,
  audit: <path d="M5 2h14v20H5V2Zm2 2v16h10V4H7Zm2 3h6v2H9V7Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z" />,
  system: <path d="m19.4 13 .1-1-.1-1 2-1.6-2-3.4-2.5 1a8 8 0 0 0-1.7-1L15 3h-4l-.4 2.8a8 8 0 0 0-1.7 1L6.4 6 4.4 9.4l2.1 1.7-.1.9.1 1-2.1 1.6 2 3.4 2.5-1a8 8 0 0 0 1.7 1l.4 3h4l.4-2.8a8 8 0 0 0 1.7-1l2.5.8 2-3.4-2.2-1.6ZM13 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
};

function NavIcon({ section }: { section: WorkspaceSection }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">{icons[section]}</svg>;
}

export function OperatorWorkspace({ user, walletAddress, selectedAccountAddress, sessionExpired, busy, message,
  wallet, request, apiState, connectionLost = false, connectionSettings, signWalletMessage, onBusyChange, onRecover, onLogout }: {
  user: OperatorUser; walletAddress: string; selectedAccountAddress: string; sessionExpired: boolean; busy: boolean;
  message: string; wallet: Wallet | undefined; request: Request; apiState: "ready" | "unavailable";
  connectionSettings: ReactNode; signWalletMessage?: (address: string, message: string) => Promise<string>;
  connectionLost?: boolean;
  onBusyChange: (busy: boolean) => void; onRecover: () => void; onLogout: () => void;
}) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("overview");
  const [visitedSections, setVisitedSections] = useState<Set<WorkspaceSection>>(() => new Set(["overview"]));
  const sectionSelections = useRef<Partial<Record<WorkspaceSection, string>>>({});
  const menu = useRef<HTMLDetailsElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const sync = () => {
      const section = workspaceSectionFromHash(window.location.hash);
      setActiveSection(section);
      setVisitedSections(previous => new Set(previous).add(section));
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function navigate(section: WorkspaceSection, selected?: string) {
    const previousSection = workspaceSectionFromHash(window.location.hash);
    const previousSelection = workspaceSelectionFromHash(window.location.hash, previousSection);
    if (previousSelection) sectionSelections.current[previousSection] = previousSelection;
    else delete sectionSelections.current[previousSection];
    setActiveSection(section);
    setVisitedSections(previous => new Set(previous).add(section));
    window.history.replaceState(null, "", workspaceSectionHash(section, selected ?? sectionSelections.current[section]));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    if (menu.current) menu.current.open = false;
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
  }

  const active = WORKSPACE_SECTIONS.find(section => section.id === activeSection)!;
  const administrator = user.role === "ADMINISTRATOR";
  const accountMatches = selectedAccountAddress === walletAddress;
  const roleLabel = administrator ? "Администратор" : "Аудитор";

  return <div className="operator-workspace exchange-workspace overflow-hidden">
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Перейти к содержимому</a>
    <header className="workspace-account-bar flex flex-wrap items-center justify-between gap-4 px-5 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="workspace-avatar">{(user.displayName || "О").slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{user.displayName || "Оператор"}</p>
          <p className="truncate text-xs text-[#8e99a4]">{roleLabel} · <span className="font-mono" title={walletAddress}>{shortWalletAddress(walletAddress)}</span></p></div>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-2 font-medium text-[#d9e1e8]"><span className={`h-2 w-2 rounded-full ${sessionExpired ? "bg-[#f0b90b]" : "bg-[#00c087]"}`} />
          {sessionExpired ? "Восстановите вход" : "Сессия активна"}</span>
      </div>
    </header>

    {sessionExpired && <div role="alert" className="mx-4 mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-[#edcf98] bg-[#fff8e9] p-4 text-sm sm:mx-6 sm:flex-row sm:items-center">
      <div><p className="font-semibold text-[#6e4510]">Сессия истекла</p><p className="mt-1 text-[#765d38]">Подпишите только сообщение входа тем же кошельком. Уже отправленные транзакции повторяться не будут.</p></div>
      <button className="primary-button whitespace-nowrap" disabled={busy} onClick={onRecover}>Восстановить вход</button>
    </div>}

    {connectionLost && <div role="alert" className="connection-warning">Потеряна связь с API. Значения и подписи сохранены. Обновите данные в нужном разделе; отправка автоматически не повторяется.</div>}
    {!accountMatches && <div className="access-note mx-4 mt-3">{selectedAccountAddress ? "В Phantom выбран другой адрес." : "Кошелёк сейчас не подключён."} Для подписи выберите кошелёк текущей сессии. Читать данные можно без новой подписи.</div>}
    <details ref={menu} className="workspace-mobile-menu lg:hidden" onKeyDown={event => { if (event.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
      <summary><span className="flex items-center gap-2"><NavIcon section={activeSection} />{active.shortLabel}</span><span>Разделы ▾</span></summary>
      <nav aria-label="Разделы рабочего места">
        {WORKSPACE_SECTIONS.map(section => <button key={section.id} type="button" disabled={busy} aria-current={activeSection === section.id ? "page" : undefined}
          className={`workspace-mobile-nav ${activeSection === section.id ? "workspace-mobile-nav-active" : ""}`} onClick={() => navigate(section.id)}>
          <NavIcon section={section.id} />{section.shortLabel}</button>)}
      </nav>
    </details>

    <div className="workspace-layout lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="workspace-sidebar hidden lg:block">
        <div className="workspace-sidebar-content p-3">
        <nav aria-label="Разделы рабочего места" className="space-y-1">
          {[{ label: "Работа", ids: ["overview", "actions", "instruments", "investors"] }, { label: "История", ids: ["transactions", "audit"] }, { label: "Настройки", ids: ["system"] }].map(group => <div key={group.label} className="workspace-nav-group"><p className="nav-group-label">{group.label}</p>{WORKSPACE_SECTIONS.filter(section => group.ids.includes(section.id)).map(section => <button key={section.id} type="button" disabled={busy} aria-current={activeSection === section.id ? "page" : undefined}
            className={`workspace-nav ${activeSection === section.id ? "workspace-nav-active" : ""}`} onClick={() => navigate(section.id)}>
            <NavIcon section={section.id} /><span>{section.shortLabel}</span></button>)}</div>)}
        </nav>
        </div>
      </aside>

      <main ref={main} id="workspace-main" tabIndex={-1} className="workspace-content min-w-0 px-4 py-5 sm:px-6 sm:py-6 lg:px-7">
        {activeSection !== "overview" && <div className="workspace-page-heading">
          <div><p className="section-kicker">Рабочее место / {active.shortLabel}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-[#161a1e]">{active.label}</h1>
          </div><p className="section-kicker">Время: {workspaceTimeZone()}</p>
        </div>}

        <section hidden={activeSection !== "overview"} aria-label="Обзор рабочего места">
          <div className="terminal-overview-head">
            <div className="max-w-2xl">
              <p className="section-kicker">Рабочее место оператора</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#111418]">Обзор</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#65707a]">Проверка результатов и действия, которые нужно продолжить.</p></div>
            <button className="primary-button whitespace-nowrap" disabled={busy} onClick={() => navigate("actions")}>Открыть действия <span aria-hidden="true">→</span></button>
          </div>

          <WorkspaceOverview request={request} walletAddress={walletAddress} administrator={administrator} onOpen={id => navigate("actions", id)} />
        </section>

        {visitedSections.has("actions") && <div className="workspace-panel" hidden={activeSection !== "actions"}><CorporateActionPanel key={`actions-${user.id}`} role={user.role} request={request} wallet={wallet} walletAddress={walletAddress} onBusyChange={onBusyChange} /></div>}
        {visitedSections.has("instruments") && <div className="workspace-panel" hidden={activeSection !== "instruments"}><InstrumentPanel key={`instruments-${user.id}`} role={user.role} request={request} wallet={wallet} walletAddress={walletAddress} onBusyChange={onBusyChange} /></div>}
        {(["transactions", "audit"] as const).map(kind => visitedSections.has(kind) && <div key={kind} className="workspace-panel" hidden={activeSection !== kind}>
          <EvidencePanel kind={kind} request={request} onOpenAction={id => navigate("actions", id)} onOpenInstrument={id => navigate("instruments", id)} onOpenInvestor={id => navigate("investors", id)} /></div>)}
        {visitedSections.has("investors") && <div className="workspace-panel" hidden={activeSection !== "investors"}><InvestorPanel key={`investors-${user.id}`} role={user.role} request={request} activeWalletAddress={selectedAccountAddress}
          signWalletMessage={administrator ? signWalletMessage : undefined} /></div>}
        {visitedSections.has("system") && <div className="workspace-panel" hidden={activeSection !== "system"}>
          <div className="grid gap-4 xl:grid-cols-2"><div className="surface-card"><p className="section-kicker">Подключение</p><h2 className="mt-1 text-lg font-semibold">Кошелёк и сессия</h2>{connectionSettings}
              <p aria-live="polite" className="mt-4 rounded-xl bg-[#f3f6f4] p-3 text-xs leading-5 text-[#5f7067]">{message}</p>
              <button className="secondary-button mt-4" disabled={busy} onClick={onLogout}>Выйти из рабочего места</button></div>
            <div className="surface-card"><p className="section-kicker">Безопасность</p><h2 className="mt-1 text-lg font-semibold">Что означает подпись</h2><ul className="mt-4 space-y-3 text-sm leading-6 text-[#5d6d64]"><li>Вход — подпись сообщения для сессии оператора.</li><li>Подтверждение адреса инвестора — доказательство владения, без допуска и выплат.</li><li>Подпись транзакции — разрешение указанной операции в сети.</li><li>Результат подтверждён после проверки сети, базы и аудита. Проверка не отправляет транзакцию снова.</li></ul></div></div>
          <ProgramUpgradePanel key={`upgrade-${user.id}`} role={user.role} request={request} wallet={wallet} walletAddress={walletAddress} onBusyChange={onBusyChange} />
          {administrator && <details className="advanced-details mt-5"><summary>Служебная регистрация snapshot по UUID</summary><p>Используйте только для заранее подготовленного действия. Обычный сценарий доступен внутри «Корпоративных действий».</p>
            <SnapshotPanel key={walletAddress} wallet={wallet} walletAddress={walletAddress} request={request} onBusyChange={onBusyChange} /></details>}
        </div>}
      </main>
    </div>
  </div>;
}

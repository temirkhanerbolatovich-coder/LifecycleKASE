"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CopyValue, RegistrySkeleton, RegistryToolbar, RequestNotice } from "./workspace-controls";
import { filterRegistry, INITIAL_FILTERS, statusTone, formatWorkspaceDate } from "./workspace-presentation";
import { workspaceSelectionFromHash, workspaceSectionHash, workspaceSectionFromHash } from "./workspace-navigation";

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

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function shortAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}


export function InvestorPanel({ role, request, signWalletMessage, activeWalletAddress }: {
  role: string;
  request: Request;
  signWalletMessage?: ((address: string, message: string) => Promise<string>) | undefined;
  activeWalletAddress?: string | undefined;
}) {
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
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const [eligibilityChoices, setEligibilityChoices] = useState<Record<string, string>>({});
  const [revocationChoices, setRevocationChoices] = useState<Record<string, string>>({});

  async function load(cursor?: string, signal?: AbortSignal) {
    const result = await request(`/api/v1/investors?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (!Array.isArray(result["items"])) throw new Error("Некорректный ответ реестра.");
    const rows = result["items"] as Investor[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
    setMessage("");
  }
  useEffect(() => {
    const abort = new AbortController();
    setError(null); setBusy(true);
    void load(undefined, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "Реестр недоступен.");
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
      catch { setMessage("Инвестор создан, но обновление списка не удалось. Нажмите «Обновить», не создавайте повторно."); }
    } catch (error) { setFormError({ form: "create", message: error instanceof Error ? error.message : "Запрос не выполнен." }); setError(error instanceof Error ? error.message : "Запрос не выполнен.");
      setMessage(`${error instanceof Error ? error.message : "Запрос не выполнен."} При потере ответа обновите список и проверьте код перед повтором.`);
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
      catch { setMessage("Кошелёк добавлен как PENDING. Обновите список; не повторяйте привязку."); }
    } catch (error) { setFormError({ form: "attach", message: error instanceof Error ? error.message : "Запрос не выполнен." }); setError(error instanceof Error ? error.message : "Запрос не выполнен."); setMessage(error instanceof Error ? error.message : "Не удалось привязать кошелёк."); }
    finally { setBusy(false); }
  }
  async function refresh(cursor?: string) {
    setError(null); setBusy(true);
    try { await load(cursor); }
    catch (error) { setError(error instanceof Error ? error.message : "Запрос не выполнен."); setMessage(error instanceof Error ? error.message : "Не удалось загрузить реестр."); }
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
          ? "Инвестор допущен для локального demo. Это не является реальным KYC или юридическим одобрением."
          : "Инвестор отмечен как не допущенный для локального demo.");
      } catch {
        setMessage("Решение сохранено, но список не обновился. Нажмите «Обновить реестр»; не отправляйте решение повторно.");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Запрос не выполнен.");
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить решение по допуску.");
    } finally { setBusy(false); }
  }
  async function revokeWallet(investorId: string, wallet: Investor["wallets"][number]) {
    const reasonCode = revocationChoices[wallet.id];
    if (!reasonCode) return;
    if (!window.confirm(`Отозвать кошелёк ${shortAddress(wallet.address)}? Это действие нельзя отменить.`)) return;
    setError(null); setBusy(true);
    try {
      await request(`/api/v1/investors/${investorId}/wallets/${wallet.id}/revoke`, {
        method: "POST", body: JSON.stringify({ reasonCode })
      });
      setRevocationChoices(previous => ({ ...previous, [wallet.id]: "" }));
      try {
        await load();
        setMessage("Кошелёк отозван и больше не может использоваться для выплаты. Допуск инвестора автоматически не изменён.");
      } catch {
        setMessage("Кошелёк отозван, но список не обновился. Нажмите «Обновить»; не отправляйте отзыв повторно.");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Запрос не выполнен.");
      setMessage(error instanceof Error ? error.message : "Не удалось отозвать кошелёк.");
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
        throw new Error("Сервер вернул некорректный запрос подтверждения.");
      }
      setMessage("Подпишите сообщение указанным инвесторским кошельком. Это не транзакция и не допуск к выплате.");
      const signature = await signWalletMessage(wallet.address, challenge.message);
      await request(`/api/v1/investors/${investorId}/wallets/${wallet.id}/verification/verify`, {
        method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, nonce: challenge.nonce, signature })
      });
      try {
        await load();
        setMessage("Владение кошельком подтверждено. Eligibility остаётся PENDING_REVIEW.");
      } catch {
        setMessage("Сервер подтвердил владение, но список не обновился. Нажмите «Обновить»; не подписывайте повторно.");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Запрос не выполнен.");
      setMessage(`${error instanceof Error ? error.message : "Не удалось подтвердить владение кошельком."} При потере ответа обновите список перед повтором.`);
    } finally { setBusy(false); }
  }
  const visible = filterRegistry(items, filters, row=>[row.displayName,row.externalReference??"",row.id,...row.wallets.map(wallet=>wallet.address)].join(" "),row=>row.eligibilityStatus,row=>row.displayName);
  const inputClass = "mt-1.5 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2.5 text-sm";
  const buttonClass = "rounded-lg border border-[#b9c9c0] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return <section className="mt-6 border-t border-[#dbe5df] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="mt-1 text-lg font-semibold">Реестр инвесторов</h3>
        <details className="term-help"><summary>Кошелёк, допуск и KYC</summary><p>Используйте только синтетические данные. Подтверждение кошелька доказывает владение адресом; оно не является KYC, допуском к выплатам или блокчейн-транзакцией.</p></details>
      </div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}>Обновить реестр</button>
    </div>
    {role !== "ADMINISTRATOR" && <p className="access-note mt-3">Режим чтения: добавление инвесторов, подтверждение и отзыв кошельков доступны администратору.</p>}

    {role === "ADMINISTRATOR" && <details className="advanced-details mt-5"><summary>Добавить инвестора или кошелёк</summary>
    <details className="term-help"><summary>Как подготовить получателя</summary><p>Создайте инвестора, добавьте адрес и подтвердите владение сообщением из этого кошелька. Затем отдельно сохраните решение о тестовом допуске в карточке инвестора.</p></details>

    {role === "ADMINISTRATOR" && <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void create(event)}>
        <h4 className="mt-1 font-semibold">Создать инвестора</h4>
        <label className="block text-sm">Имя или название *<input className={inputClass} name="displayName" required maxLength={200} placeholder="Тестовый инвестор А" disabled={busy} /></label>
        <label className="block text-sm">Учётный код *<input className={inputClass} name="externalReference" required maxLength={100} placeholder="DEMO-A" disabled={busy} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Тип<select className={inputClass} name="type" disabled={busy}><option value="INDIVIDUAL">Физлицо (тест)</option><option value="INSTITUTIONAL">Организация (тест)</option></select></label>
          <label className="block text-sm">Страна *<input className={inputClass} name="countryCode" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="KZ" disabled={busy} /></label>
        </div>
        {formError?.form === "create" && <p role="alert" className="form-error">{formError.message} Поля сохранены.</p>}
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy}>Создать инвестора</button>
        <button type="button" className="secondary-button ml-2" disabled={busy} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Отмена</button>
      </form>
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void attach(event)}>
        <h4 className="mt-1 font-semibold">Добавить кошелёк</h4>
        <p className="text-xs leading-5 text-[#61746a]">Адрес сначала получит статус «Ожидает подписи». Подтвердите владение отдельно в карточке инвестора.</p>
        <label className="block text-sm">Инвестор *<select className={inputClass} required value={selected} disabled={busy || items.length === 0} onChange={event => setSelected(event.target.value)}>
      <option value="">{items.length === 0 ? "Сначала создайте инвестора" : "Выберите инвестора"}</option>{items.map(investor => <option key={investor.id} value={investor.id}>{investor.displayName}</option>)}</select>
      </label>
        <label className="block text-sm">Публичный адрес Solana *<input className={`${inputClass} font-mono`} name="address" required minLength={32} maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]+" placeholder="Вставьте публичный адрес" disabled={busy || items.length === 0} />
      </label>
        {formError?.form === "attach" && <p role="alert" className="form-error">{formError.message} Адрес сохранён.</p>}
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy || !selected}>Добавить кошелёк</button>
        <button type="button" className="secondary-button ml-2" disabled={busy} onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>Отмена</button>
      </form>
    </div>}

    </details>}

    <div ref={listView} hidden={Boolean(detailId)}>
      <RegistryToolbar label="инвесторы" filters={filters} onChange={setFilters} statuses={{ELIGIBLE:"Допущен",PENDING_REVIEW:"Ожидает решения",NOT_ELIGIBLE:"Не допущен"}} loaded={items.length} shown={visible.length} />
      {busy && items.length === 0 && <RegistrySkeleton />}
      <div className="table-scroll" hidden={items.length === 0} tabIndex={0} role="region" aria-label="Таблица инвесторов">
      <table className="registry-table">
      <thead>
      <tr>
      <th>Инвестор / код</th>
      <th>Допуск</th>
      <th>KYC</th>
      <th className="numeric">Кошельки</th>
      </tr>
      </thead>
      <tbody>{visible.map(investor=>
      <tr key={investor.id}>
      <td>
      <button type="button" className="table-object-link" disabled={busy} onClick={() => chooseRecord(investor.id)}>{investor.displayName}</button>
      <span className="table-secondary">{investor.externalReference??"Без кода"}</span>
      </td>
      <td>
      <span className={"status-"+statusTone(investor.eligibilityStatus)}>{statusLabel(investor.eligibilityStatus)}</span>
      </td>
      <td>{statusLabel(investor.kycStatus)}</td>
      <td className="numeric">{investor._count.wallets}</td>
      </tr>)}</tbody>
      </table>
      </div>
      {!busy&&!error&&visible.length===0&&<p className="empty-state">{items.length===0?"Реестр пуст. Администратор может добавить тестового инвестора.":"По заданному поиску и статусу ничего не найдено."}</p>}
    </div>
    {detailId&&<button type="button" className="secondary-button mt-4" disabled={busy} onClick={backToList}>← К списку инвесторов</button>}
    {detailId&&!items.some(row=>row.id===detailId)&&<p className="empty-state">UUID отсутствует в загруженных записях. Вернитесь к списку и загрузите следующую страницу.</p>}
    <div className="mt-6" hidden={!detailId}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Кошельки и допуск</h4>
      </div>
      {items.length === 0 && !busy && <div className="mt-3 rounded-xl border border-dashed border-[#cbd8d0] p-5 text-sm text-[#61746a]">Реестр пуст. Начните с шага 1.</div>}
      <ul className="mt-3 space-y-3">
        {items.map(investor => <li className="record-detail rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" id={`investor-${investor.id}`} tabIndex={-1} key={investor.id} hidden={detailId !== investor.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold">{investor.displayName}</p><p className="mt-1 text-xs text-[#61746a]">Код: {investor.externalReference ?? "не указан"} · Страна: {investor.countryCode}</p></div>
          </div>
          <dl className="object-facts mt-4"><div><dt>Тип инвестора</dt><dd>{investor.type === "INDIVIDUAL" ? "Физическое лицо" : investor.type === "INSTITUTIONAL" ? "Организация" : "Не указан"}</dd></div><div><dt>Учётная запись</dt><dd>{investor.status === "ACTIVE" ? "Активна" : investor.status ?? "Не указано"}</dd></div><div><dt>Допуск</dt><dd>{statusLabel(investor.eligibilityStatus)}</dd></div><div><dt>KYC</dt><dd>{statusLabel(investor.kycStatus)}</dd></div></dl>
          <p className="mt-3 text-xs font-semibold text-[#52675b]">Кошельки: {investor._count.wallets}{investor._count.wallets > 20 ? " · показаны первые 20" : ""}</p>
          {investor.wallets.map(wallet => {
            const readyToVerify = activeWalletAddress === wallet.address;
            return <div className="mt-2 rounded-lg border border-[#e3eae6] bg-[#f8faf9] p-3" key={wallet.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CopyValue value={wallet.address} label={`Кошелёк ${investor.displayName}`} />
                <span className={wallet.status === "ACTIVE" ? "status-ready" : "status-wait"}>{statusLabel(wallet.status)}</span>
              </div>
              <p className="mt-1 text-xs text-[#708278]">Сеть: {wallet.network === "SOLANA_LOCALNET" ? "Solana Localnet" : wallet.network}</p>
              {role === "ADMINISTRATOR" && wallet.status === "PENDING" && signWalletMessage && <div className="mt-3 border-t border-[#e3eae6] pt-3">
                <p className={`text-xs leading-5 ${readyToVerify ? "text-[#176a38]" : "text-[#8a5b18]"}`}>{readyToVerify
                  ? "Нужный аккаунт выбран в Phantom. Можно подписывать подтверждение."
                  : `В Phantom переключитесь на ${shortAddress(wallet.address)}. Кнопка станет доступна автоматически.`}</p>
                <button type="button" className={`${buttonClass} mt-2 ${readyToVerify ? "border-[#163f2b] bg-[#163f2b] text-white" : "bg-white"}`}
                  disabled={busy || !readyToVerify} onClick={() => void verifyWallet(investor.id, wallet)}>{readyToVerify ? "Подтвердить владение" : "Ожидается нужный аккаунт Phantom"}</button>
              </div>}
              {role === "ADMINISTRATOR" && wallet.status !== "REVOKED" && <details className="mt-3 border-t border-[#e3eae6] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#7b3e28]">Отозвать кошелёк</summary>
                <p className="mt-1 text-xs leading-5 text-[#61746a]">Необратимо запрещает использовать адрес для выплаты. Баланс адреса может остаться в snapshot для сверки; допуск инвестора автоматически не меняется.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <select className={`${inputClass} mt-0 sm:max-w-xs`} value={revocationChoices[wallet.id] ?? ""} disabled={busy}
                    aria-label={`Причина отзыва ${shortAddress(wallet.address)}`}
                    onChange={event => setRevocationChoices(previous => ({ ...previous, [wallet.id]: event.target.value }))}>
                    <option value="">Выберите причину</option>
                    <option value="OWNER_REQUEST">По запросу владельца</option>
                    <option value="SECURITY_CONCERN">Подозрение на компрометацию</option>
                    <option value="WALLET_REPLACEMENT">Замена кошелька</option>
                    <option value="REGISTRY_CORRECTION">Исправление записи реестра</option>
                  </select>
                  <button type="button" className={`danger-button ${buttonClass} border-[#9b4b32] bg-white text-[#7b3e28]`}
                    disabled={busy || !revocationChoices[wallet.id]}
                    onClick={() => void revokeWallet(investor.id, wallet)}>Отозвать кошелёк</button>
                </div>
              </details>}
              {wallet.status === "REVOKED" && wallet.revocationReasonCode && <p className="mt-2 text-xs text-[#7b3e28]">Причина: {REVOCATION_REASON_LABELS[wallet.revocationReasonCode] ?? wallet.revocationReasonCode}{wallet.revokedAt ? ` · ${formatWorkspaceDate(wallet.revokedAt)}` : ""}</p>}
            </div>;
          })}
          {role === "ADMINISTRATOR" && investor.eligibilityStatus === "PENDING_REVIEW" && (() => {
            const hasVerifiedWallet = investor.wallets.some(wallet => wallet.status === "ACTIVE");
            const choice = eligibilityChoices[investor.id] ?? "";
            return <div className="mt-3 rounded-lg border border-[#d9e3dd] bg-[#f7faf8] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#28744a]">Решение по допуску</p>
              <p className="mt-1 text-xs leading-5 text-[#61746a]">Одноразовое решение для локального demo. Оно не заменяет реальный KYC/AML. Для допуска требуется подтверждённый кошелёк.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select className={`${inputClass} mt-0 sm:max-w-xs`} value={choice} disabled={busy}
                  aria-label={`Решение по допуску ${investor.displayName}`} onChange={event => setEligibilityChoices(previous => ({ ...previous, [investor.id]: event.target.value }))}>
                  <option value="">Выберите решение</option>
                  <option value="ELIGIBLE" disabled={!hasVerifiedWallet}>Допустить · демо-критерии выполнены</option>
                  <option value="NOT_ELIGIBLE">Не допустить · критерии не выполнены</option>
                </select>
                <button type="button" className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`}
                  disabled={busy || !choice} onClick={() => void decideEligibility(investor.id)}>Сохранить решение</button>
              </div>
              {!hasVerifiedWallet && <p className="mt-2 text-xs text-[#8a5b18]">Сначала подтвердите хотя бы один кошелёк инвестора.</p>}
            </div>;
          })()}
          {investor.eligibilityStatus !== "PENDING_REVIEW" && investor.eligibilityReasonCode && <p className="mt-3 text-xs text-[#61746a]">Основание: {REASON_LABELS[investor.eligibilityReasonCode] ?? investor.eligibilityReasonCode}{investor.eligibilityReviewedAt ? ` · ${formatWorkspaceDate(investor.eligibilityReviewedAt)}` : ""}</p>}
        </li>)}
      </ul>
    </div>
    {!detailId && nextCursor && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh(nextCursor)}>Показать ещё</button>}
    <RequestNotice busy={busy} message={message} error={error} onRetry={()=>void refresh()} />
  </section>;
}

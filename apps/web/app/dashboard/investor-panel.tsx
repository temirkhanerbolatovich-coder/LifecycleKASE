"use client";
import { useEffect, useState, type FormEvent } from "react";

type Investor = {
  id: string; displayName: string; externalReference: string | null; countryCode: string;
  kycStatus: string; eligibilityStatus: string; eligibilityReasonCode: string | null;
  eligibilityReviewedAt: string | null; _count: { wallets: number };
  wallets: { id: string; address: string; status: string; network: string }[];
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
  SUSPENDED: "Приостановлен"
};

const REASON_LABELS: Record<string, string> = {
  DEMO_CRITERIA_MET: "Демо-критерии выполнены",
  DEMO_CRITERIA_NOT_MET: "Демо-критерии не выполнены",
  LEGACY_STATUS_IMPORT: "Перенесено из прежней версии"
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function shortAddress(address: string): string {
  return address.length > 15 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

function recordCountLabel(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder10 === 1 && remainder100 !== 11) return `${count} запись`;
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) return `${count} записи`;
  return `${count} записей`;
}

export function InvestorPanel({ role, request, signWalletMessage, activeWalletAddress }: {
  role: string;
  request: Request;
  signWalletMessage?: ((address: string, message: string) => Promise<string>) | undefined;
  activeWalletAddress?: string | undefined;
}) {
  const [items, setItems] = useState<Investor[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Загрузка реестра…");
  const [selected, setSelected] = useState("");
  const [eligibilityChoices, setEligibilityChoices] = useState<Record<string, string>>({});

  async function load(cursor?: string, signal?: AbortSignal) {
    const result = await request(`/api/v1/investors?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (!Array.isArray(result["items"])) throw new Error("Некорректный ответ реестра.");
    const rows = result["items"] as Investor[];
    setItems(previous => cursor ? [...previous, ...rows] : rows);
    setNextCursor(typeof result["nextCursor"] === "string" ? result["nextCursor"] : null);
    setMessage(rows.length === 0 && !cursor ? "Реестр пуст. Создайте тестового инвестора." : "Реестр загружен.");
  }
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    void load(undefined, abort.signal).catch((error: unknown) => {
      if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Реестр недоступен.");
    }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [request]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await request("/api/v1/investors", { method: "POST", body: JSON.stringify({
        displayName: data.get("displayName"), externalReference: data.get("externalReference"),
        countryCode: data.get("countryCode"), type: data.get("type")
      }) });
      form.reset();
      setSelected("");
      try { await load(); }
      catch { setMessage("Инвестор создан, но обновление списка не удалось. Нажмите «Обновить», не создавайте повторно."); }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Запрос не выполнен."} При потере ответа обновите список и проверьте код перед повтором.`);
    } finally { setBusy(false); }
  }
  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const address = new FormData(form).get("address");
    setBusy(true);
    try {
      await request(`/api/v1/investors/${selected}/wallets`, { method: "POST", body: JSON.stringify({ address }) });
      form.reset();
      setSelected("");
      try { await load(); }
      catch { setMessage("Кошелёк добавлен как PENDING. Обновите список; не повторяйте привязку."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось привязать кошелёк."); }
    finally { setBusy(false); }
  }
  async function refresh(cursor?: string) {
    setBusy(true);
    try { await load(cursor); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось загрузить реестр."); }
    finally { setBusy(false); }
  }
  async function decideEligibility(investorId: string) {
    const decision = eligibilityChoices[investorId];
    if (decision !== "ELIGIBLE" && decision !== "NOT_ELIGIBLE") return;
    setBusy(true);
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить решение по допуску.");
    } finally { setBusy(false); }
  }
  async function verifyWallet(investorId: string, wallet: Investor["wallets"][number]) {
    if (!signWalletMessage) return;
    setBusy(true);
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
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Не удалось подтвердить владение кошельком."} При потере ответа обновите список перед повтором.`);
    } finally { setBusy(false); }
  }
  const inputClass = "mt-1.5 w-full rounded-lg border border-[#cbd8d0] bg-white px-3 py-2.5 text-sm";
  const buttonClass = "rounded-lg border border-[#b9c9c0] px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return <section className="mt-6 border-t border-[#dbe5df] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#28744a]">Рабочий процесс</p>
        <h3 className="mt-1 text-lg font-semibold">Реестр тестовых инвесторов</h3>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-[#8a5b18]">Используйте только синтетические данные. Подтверждение кошелька не является KYC, допуском к выплатам или блокчейн-транзакцией.</p>
      </div>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void refresh()}>Обновить реестр</button>
    </div>

    {role === "ADMINISTRATOR" && <div className="mt-5 grid gap-2 sm:grid-cols-3">
      {[
        ["1", "Создайте инвестора", "Укажите тестовое имя и уникальный код."],
        ["2", "Добавьте адрес", "Привяжите публичный адрес без подтверждения."],
        ["3", "Подтвердите владение", "Переключите Phantom на этот адрес и подпишите сообщение."]
      ].map(([number, title, description]) => <div key={number} className="rounded-xl border border-[#dbe5df] bg-[#f7faf8] p-3">
        <span className="text-xs font-bold text-[#28744a]">ШАГ {number}</span>
        <p className="mt-1 text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#61746a]">{description}</p>
      </div>)}
    </div>}

    {role === "ADMINISTRATOR" && <div className="mt-5 grid gap-4 xl:grid-cols-2">
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void create(event)}>
        <div><span className="text-xs font-bold text-[#28744a]">ШАГ 1</span><h4 className="mt-1 font-semibold">Создать инвестора</h4></div>
        <label className="block text-sm">Тестовое название<input className={inputClass} name="displayName" required maxLength={200} placeholder="Demo Investor A" disabled={busy} /></label>
        <label className="block text-sm">Уникальный код<input className={inputClass} name="externalReference" required maxLength={100} placeholder="DEMO-A" disabled={busy} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Тип<select className={inputClass} name="type" disabled={busy}><option value="INDIVIDUAL">Физлицо (тест)</option><option value="INSTITUTIONAL">Организация (тест)</option></select></label>
          <label className="block text-sm">Страна<input className={inputClass} name="countryCode" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="KZ" disabled={busy} /></label>
        </div>
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy}>Создать инвестора</button>
      </form>
      <form className="space-y-3 rounded-xl border border-[#dbe5df] p-4" onSubmit={event => void attach(event)}>
        <div><span className="text-xs font-bold text-[#28744a]">ШАГ 2</span><h4 className="mt-1 font-semibold">Добавить кошелёк</h4></div>
        <p className="text-xs leading-5 text-[#61746a]">Адрес сначала получит статус «Ожидает подписи». Владение подтверждается отдельно на шаге 3.</p>
        <label className="block text-sm">Инвестор<select className={inputClass} required value={selected} disabled={busy || items.length === 0} onChange={event => setSelected(event.target.value)}><option value="">{items.length === 0 ? "Сначала создайте инвестора" : "Выберите инвестора"}</option>{items.map(investor => <option key={investor.id} value={investor.id}>{investor.displayName}</option>)}</select></label>
        <label className="block text-sm">Публичный адрес Solana<input className={`${inputClass} font-mono`} name="address" required minLength={32} maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]+" placeholder="Вставьте публичный адрес" disabled={busy || items.length === 0} /></label>
        <button className={`${buttonClass} border-[#163f2b] bg-[#163f2b] text-white`} disabled={busy || !selected}>Добавить кошелёк</button>
      </form>
    </div>}

    <div className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{role === "ADMINISTRATOR" ? "Шаг 3 · Инвесторы и подтверждение" : "Инвесторы"}</h4>
        <span className="rounded-full bg-[#eef3f0] px-2.5 py-1 text-xs font-semibold text-[#52675b]">{recordCountLabel(items.length)}</span>
      </div>
      {items.length === 0 && !busy && <div className="mt-3 rounded-xl border border-dashed border-[#cbd8d0] p-5 text-sm text-[#61746a]">Реестр пуст. Начните с шага 1.</div>}
      <ul className="mt-3 space-y-3">
        {items.map(investor => <li className="rounded-xl border border-[#dbe5df] bg-white p-4 text-sm" key={investor.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold">{investor.displayName}</p><p className="mt-1 text-xs text-[#61746a]">Код: {investor.externalReference ?? "не указан"} · Страна: {investor.countryCode}</p></div>
            <div className="flex flex-wrap gap-1.5"><span className="status-wait">KYC: {statusLabel(investor.kycStatus)}</span><span className={investor.eligibilityStatus === "ELIGIBLE" ? "status-ready" : "status-wait"}>Допуск: {statusLabel(investor.eligibilityStatus)}</span></div>
          </div>
          <p className="mt-3 text-xs font-semibold text-[#52675b]">Кошельки: {investor._count.wallets}{investor._count.wallets > 20 ? " · показаны первые 20" : ""}</p>
          {investor.wallets.map(wallet => {
            const readyToVerify = activeWalletAddress === wallet.address;
            return <div className="mt-2 rounded-lg border border-[#e3eae6] bg-[#f8faf9] p-3" key={wallet.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold" title={wallet.address}>{shortAddress(wallet.address)}</span>
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
                  onChange={event => setEligibilityChoices(previous => ({ ...previous, [investor.id]: event.target.value }))}>
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
          {investor.eligibilityStatus !== "PENDING_REVIEW" && investor.eligibilityReasonCode && <p className="mt-3 text-xs text-[#61746a]">Основание: {REASON_LABELS[investor.eligibilityReasonCode] ?? investor.eligibilityReasonCode}{investor.eligibilityReviewedAt ? ` · ${new Date(investor.eligibilityReviewedAt).toLocaleString("ru-RU")}` : ""}</p>}
        </li>)}
      </ul>
      {nextCursor && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh(nextCursor)}>Показать ещё</button>}
    </div>
    <p aria-live="polite" className="mt-4 rounded-lg bg-[#f4f7f5] px-3 py-2 text-xs leading-5 text-[#52675b]">{busy ? "Выполняется запрос…" : message}</p>
  </section>;
}

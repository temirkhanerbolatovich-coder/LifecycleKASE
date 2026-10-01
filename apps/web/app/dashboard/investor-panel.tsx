"use client";
import { useEffect, useState, type FormEvent } from "react";

type Investor = {
  id: string; displayName: string; externalReference: string | null; countryCode: string;
  kycStatus: string; eligibilityStatus: string; _count: { wallets: number };
  wallets: { id: string; address: string; status: string; network: string }[];
};
type Request = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

export function InvestorPanel({ role, request }: { role: string; request: Request }) {
  const [items, setItems] = useState<Investor[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Загрузка реестра…");
  const [selected, setSelected] = useState("");

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
  const inputClass = "mt-1 w-full rounded-lg border border-[#cbd8d0] px-3 py-2 text-sm";
  const buttonClass = "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
  return <section className="mt-6 border-t pt-5">
    <h3 className="font-semibold">Реестр тестовых инвесторов</h3>
    <p className="mt-2 text-xs text-[#8a5b18]">Только синтетические данные. KYC не проводится; добавление кошелька не подтверждает владение и не даёт права на выплаты. Публичный деплой отложен.</p>
    <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh()}>Обновить</button>
    <ul className="mt-3 space-y-3">
      {items.map(investor => <li className="rounded-lg border p-3 text-sm" key={investor.id}>
        <p className="font-semibold">{investor.displayName} · {investor.externalReference ?? "без кода"}</p>
        <p className="mt-1 text-xs">{investor.countryCode} · KYC: {investor.kycStatus} · Допуск: {investor.eligibilityStatus}</p>
        <p className="mt-1 text-xs">Кошельков: {investor._count.wallets} {investor._count.wallets > 20 ? "(показаны первые 20)" : ""}</p>
        {investor.wallets.map(wallet => <p className="mt-1 break-all text-xs" key={wallet.id}>{wallet.address} · {wallet.network} · {wallet.status}</p>)}
      </li>)}
    </ul>
    {nextCursor && <button type="button" className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void refresh(nextCursor)}>Следующая страница</button>}
    {role === "ADMINISTRATOR" && <>
      <form className="mt-5 space-y-3" onSubmit={event => void create(event)}>
        <h4 className="text-sm font-semibold">Создать тестового инвестора</h4>
        <label className="block text-sm">Название<input className={inputClass} name="displayName" required maxLength={200} placeholder="Demo Investor A" disabled={busy} /></label>
        <label className="block text-sm">Уникальный код<input className={inputClass} name="externalReference" required maxLength={100} placeholder="DEMO-A" disabled={busy} /></label>
        <label className="block text-sm">Тип<select className={inputClass} name="type" disabled={busy}><option value="INDIVIDUAL">Физическое лицо (тест)</option><option value="INSTITUTIONAL">Организация (тест)</option></select></label>
        <label className="block text-sm">Код страны<input className={inputClass} name="countryCode" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" defaultValue="KZ" disabled={busy} /></label>
        <button className={buttonClass} disabled={busy}>Создать</button>
      </form>
      {items.length > 0 && <form className="mt-5 space-y-3" onSubmit={event => void attach(event)}>
        <h4 className="text-sm font-semibold">Добавить localnet-кошелёк как PENDING</h4>
        <label className="block text-sm">Инвестор<select className={inputClass} required value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="">Выберите инвестора</option>{items.map(investor => <option key={investor.id} value={investor.id}>{investor.displayName}</option>)}</select></label>
        <label className="block text-sm">Публичный адрес<input className={inputClass} name="address" required minLength={32} maxLength={44} pattern="[1-9A-HJ-NP-Za-km-z]+" disabled={busy} /></label>
        <button className={buttonClass} disabled={busy || !selected}>Добавить без подтверждения</button>
      </form>}
    </>}
    <p aria-live="polite" className="mt-3 text-xs text-[#61746a]">{busy ? "Выполняется запрос…" : message}</p>
  </section>;
}

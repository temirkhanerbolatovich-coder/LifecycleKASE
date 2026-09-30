import Image from "next/image";
import { WalletLogin } from "./wallet-login";

type ApiState = "ready" | "unavailable";

async function apiState(): Promise<ApiState> {
  const baseUrl = process.env.API_SERVER_URL ?? process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
  try {
    const response = await fetch(new URL("/api/v1/health/ready", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "status" in result && result.status === "ready"
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

export default async function Dashboard() {
  const state = await apiState();

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#10231c]">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between border-b border-[#dbe5df] pb-7">
          <div className="flex items-center gap-3">
            <Image src="/brand/lifecyclekase-mark.png" width={44} height={44} alt="Знак LifecycleKASE" />
            <div>
              <div className="text-lg font-bold tracking-tight">LifecycleKASE</div>
              <div className="text-xs text-[#61746a]">Corporate Action Engine · прототип</div>
            </div>
          </div>
          <span className="rounded-full border border-[#d5e0d9] bg-white px-3 py-1 text-xs font-semibold text-[#455e50]">Тестовая среда</span>
        </header>

        <section className="grid gap-10 py-16 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div>
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#28744a]">Обзор платформы</p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Прозрачный жизненный цикл токенизированных ценных бумаг.</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#586c60]">Здесь будет рабочее место администратора корпоративных действий. Сейчас доступен только проверяемый статус сервиса; выпуск, снимки держателей и выплаты не открыты для пользователей.</p>
          </div>
          <div className="rounded-2xl border border-[#dbe5df] bg-white p-7 shadow-[0_14px_50px_-30px_rgba(16,35,28,0.3)]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#708278]">Состояние окружения</p>
            <div className="mt-6 flex items-center justify-between border-b border-[#e6ece8] pb-4">
              <span>Веб-приложение</span><span className="status-ready">Доступно</span>
            </div>
            <div className="mt-4 flex items-center justify-between border-b border-[#e6ece8] pb-4">
              <span>API и PostgreSQL</span><span className={state === "ready" ? "status-ready" : "status-wait"}>{state === "ready" ? "Готово" : "Недоступно"}</span>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span>Solana Devnet</span><span className="status-wait">Не подключено</span>
            </div>
            <p className="mt-6 text-xs leading-5 text-[#708278]">Проверка API отражает только доступность сервера и базы данных. Она не подтверждает готовность блокчейн-операций.</p>
          </div>
        </section>

        <section className="grid gap-5 border-t border-[#dbe5df] py-10 lg:grid-cols-[1fr_1.25fr] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#28744a]">Безопасный вход</p>
            <h2 className="mt-2 text-2xl font-semibold">Кошелёк остаётся у оператора</h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#61746a]">Приложение использует Solana Wallet Standard и просит подписать одноразовое domain-bound сообщение. Private key, seed phrase и session token не доступны JavaScript-коду приложения.</p>
          </div>
          <WalletLogin />
        </section>

        <section className="border-t border-[#dbe5df] py-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-[#28744a]">Дорожная карта</p><h2 className="mt-2 text-2xl font-semibold">Что будет доступно дальше</h2></div>
            <span className="text-sm text-[#718279]">Вход реализован; рабочие операции добавляются поэтапно</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["01", "Реестр инвесторов", "Проверенные связи инвестора и кошелька, роли и аудит изменений."],
              ["02", "Инструменты и снимки", "Выпуск, запись владельцев на дату и подтверждение снимка в сети."],
              ["03", "Корпоративные действия", "Расчёт прав, согласование и исполнение выплат с квитанциями."],
            ].map(([number, title, description]) => (
              <article key={number} className="rounded-2xl border border-[#dbe5df] bg-white p-6">
                <span className="text-sm font-semibold text-[#2b8a59]">{number}</span>
                <h3 className="mt-8 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#61746a]">{description}</p>
              </article>
            ))}
          </div>
        </section>
        <footer className="border-t border-[#dbe5df] py-7 text-xs text-[#708278]">Демонстрационный прототип · Не является торговой, расчётной или банковской системой.</footer>
      </div>
    </main>
  );
}

import Image from "next/image";
import { WalletLogin } from "./wallet-login";

type ApiState = "ready" | "unavailable";

async function apiState(): Promise<ApiState> {
  const baseUrl =
    process.env.API_SERVER_URL ?? process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(new URL("/api/v1/health/ready", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      return "unavailable";
    }

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
    <div className="dashboard-shell text-[#14291f]">
      <header className="exchange-topbar">
        <div className="dashboard-brand-row flex items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="exchange-logo-wrap">
              <Image
                src="/brand/lifecyclekase-mark.png"
                width={26}
                height={26}
                priority
                alt="LifecycleKASE"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-[-0.02em] text-white">LifecycleKASE</p>
              <p className="truncate text-xs text-[#9da6ae]">Корпоративные действия</p>
            </div>
          </div>

          <div className="dashboard-service-status flex items-center gap-3">
            <span className="exchange-env-pill">Localnet · тестовая сеть</span>
            <span className={state === "ready" ? "status-ready" : "status-wait"}>
              <span aria-hidden="true">●</span>
              {state === "ready" ? "Система доступна" : "Нет связи с API"}
            </span>
          </div>
        </div>
      </header>

      <div className="dashboard-workspace">
        <WalletLogin apiState={state} />
      </div>
      <footer className="dashboard-footer">
        KZT-Test — демонстрационный актив, не реальные деньги и не выпуск Национального банка Казахстана.
      </footer>
    </div>
  );
}

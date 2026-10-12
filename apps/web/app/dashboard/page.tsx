import { DashboardHeader, AssetDisclaimerFooter } from "./dashboard-chrome";
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
      <DashboardHeader apiState={state} />

      <div className="dashboard-workspace">
        <WalletLogin apiState={state} />
      </div>
      <AssetDisclaimerFooter />
    </div>
  );
}

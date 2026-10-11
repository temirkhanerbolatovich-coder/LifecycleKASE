"use client";

import Image from "next/image";
import { useLocale } from "./locale-context";

/** The API health check stays server-side; language changes only its displayed result. */
export function DashboardHeader({ apiState }: { apiState: "ready" | "unavailable" }) {
  const { t } = useLocale();
  return <header className="exchange-topbar">
    <div className="dashboard-brand-row flex items-center justify-between gap-4 px-4 py-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="exchange-logo-wrap"><Image src="/brand/lifecyclekase-mark.png" width={26} height={26} priority alt="LifecycleKASE" /></div>
        <div className="min-w-0"><p className="truncate text-base font-bold tracking-[-0.02em] text-white">LifecycleKASE</p>
          <p className="truncate text-xs text-[#9da6ae]">{t("financial.display.chromeActions")}</p></div>
      </div>
      <div className="dashboard-service-status flex items-center gap-3">
        <span className="exchange-env-pill">{t("financial.display.chromeLocalnet")}</span>
        <span className={apiState === "ready" ? "status-ready" : "status-wait"}><span aria-hidden="true">●</span>
          {t(apiState === "ready" ? "financial.display.chromeReady" : "financial.display.chromeUnavailable")}</span>
      </div>
    </div>
  </header>;
}

export function AssetDisclaimerFooter() {
  const { t } = useLocale();
  return <footer className="dashboard-footer">{t("financial.display.chromeDisclaimer")}</footer>;
}

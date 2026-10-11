"use client";
import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createTranslator, formatLocaleAmount, formatLocaleDate, LOCALE_COOKIE, parseLocale, translateStoredMessage, type Locale } from "./locale";

const LocaleContext = createContext<ReturnType<typeof useLocaleValue> | null>(null);
function useLocaleValue(initialLocale: Locale) {
  const [locale, updateLocale] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    const t = createTranslator(locale);
    document.title = t(window.location.pathname === "/qa" ? "common.qaTitle" : "common.operatorTitle");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", t("common.description"));
  }, [locale]);
  return useMemo(() => ({
    locale, t: createTranslator(locale),
    setLocale(next: Locale) {
      const validated = parseLocale(next);
      document.cookie = `${LOCALE_COOKIE}=${validated}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      document.documentElement.lang = validated;
      updateLocale(validated);
    },
    formatDate: (value: string | null | undefined, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, dateOnly = false) => formatLocaleDate(value, locale, timeZone, dateOnly),
    formatAmount: (value: string) => formatLocaleAmount(value, locale),
    displayMessage: (value: string) => translateStoredMessage(value, locale)
  }), [locale]);
}
export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const value = useLocaleValue(initialLocale);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider is required.");
  return value;
}

/** Preserves notice state and re-displays known application copy when the language changes. */
export function useLocalizedTextState(initialValue = ""): [string, Dispatch<SetStateAction<string>>] {
  const { displayMessage } = useLocale();
  const [source, setSource] = useState(initialValue);
  return [displayMessage(source), setSource];
}
export function LanguageSelector() {
  const { locale, setLocale, t } = useLocale();
  return <label className="flex items-center gap-2 text-xs font-medium"><span className="sr-only">{t("common.language")}</span>
    <select aria-label={t("common.language")} className="rounded-lg border border-[#68737e] bg-[#17212b] px-2 py-1.5 text-white" value={locale} onChange={event => setLocale(parseLocale(event.target.value))}>
      <option value="ru" lang="ru">Русский</option><option value="en" lang="en">English</option>
    </select>
  </label>;
}

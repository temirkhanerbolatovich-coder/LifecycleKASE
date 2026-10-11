import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { LocaleProvider } from "./dashboard/locale-context";
import { createTranslator, LOCALE_COOKIE, parseLocale } from "./dashboard/locale";
import "./globals.css";

const golos = localFont({
  src: "./fonts/GolosText-Variable.ttf",
  variable: "--font-interface",
  weight: "400 900",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(parseLocale((await cookies()).get(LOCALE_COOKIE)?.value));
  return { title: t("common.operatorTitle"), description: t("common.description") };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return <html lang={locale} className={golos.variable}><body><LocaleProvider initialLocale={locale}>{children}</LocaleProvider></body></html>;
}

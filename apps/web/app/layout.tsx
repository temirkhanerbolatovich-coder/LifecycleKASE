import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const golos = localFont({
  src: "./fonts/GolosText-Variable.ttf",
  variable: "--font-interface",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LifecycleKASE — рабочее место оператора",
  description: "Управление корпоративными действиями токенизированных инструментов",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className={golos.variable}><body>{children}</body></html>;
}

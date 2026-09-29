import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifecycleKASE — состояние платформы",
  description: "Панель состояния прототипа Corporate Action Engine",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}

import { QaWorkspace } from "./qa-workspace";
import { cookies } from "next/headers";
import { createTranslator, LOCALE_COOKIE, parseLocale } from "../dashboard/locale";

export async function generateMetadata() {
  const t = createTranslator(parseLocale((await cookies()).get(LOCALE_COOKIE)?.value));
  return { title: t("common.qaTitle") };
}

export default function QaPage() {
  return <QaWorkspace />;
}

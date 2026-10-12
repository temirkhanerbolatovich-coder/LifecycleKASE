import { coreMessages } from "./core-messages";
import { financialMessages } from "./financial-messages";
import { registryMessages } from "./registry-messages";
import { qaMessages } from "./qa-messages";
import { masterMessages } from "./master-messages";
import type { RationalMinorAmount } from "./entitlement-workflow";

export type Locale = "ru" | "en";
export const LOCALE_COOKIE = "lifecyclekase_locale";
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_FORMATS: Record<Locale, string> = { ru: "ru-RU", en: "en-GB" };
export const messages = {
  ru: { ...coreMessages.ru, ...financialMessages.ru, ...registryMessages.ru, ...qaMessages.ru, ...masterMessages.ru },
  en: { ...coreMessages.en, ...financialMessages.en, ...registryMessages.en, ...qaMessages.en, ...masterMessages.en }
};
export type MessageKey = keyof typeof messages.ru;
export type MessageValues = Record<string, string | number>;
export type Translator = (key: MessageKey, values?: MessageValues) => string;

/** A presentation preference cannot select a network, account or signing authority. */
export function parseLocale(value: unknown): Locale {
  return value === "en" || value === "ru" ? value : DEFAULT_LOCALE;
}
export function getDisplayLocale(): Locale {
  return typeof document === "undefined" ? DEFAULT_LOCALE : parseLocale(document.documentElement.lang);
}
export function createTranslator(locale: Locale): Translator {
  return (key, values = {}) => {
    const template: string = messages[locale][key];
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder);
  };
}

/** Only call this for application-owned notices, never investor names or signed messages. */
export function translateStoredMessage(value: string, locale: Locale): string {
  if (!value) return value;
  for (const key of Object.keys(messages.ru) as MessageKey[]) {
    for (const sourceLocale of ["ru", "en"] as const) {
      const source: string = messages[sourceLocale][key];
      if (source === value) return createTranslator(locale)(key);
      if (!source.includes("{")) continue;
      const names: string[] = [];
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = escaped.replace(/\\\{([A-Za-z][A-Za-z0-9_]*)\\\}/g, (_, name: string) => {
        names.push(name); return "([\\s\\S]*?)";
      });
      const match = new RegExp(`^${pattern}$`).exec(value);
      if (match) return createTranslator(locale)(key, Object.fromEntries(names.map((name, index) => [name, match[index + 1]!])));
    }
  }
  return value;
}

/** Six-decimal token units remain exact even above Number.MAX_SAFE_INTEGER. */
export function formatLocaleAmount(value: string, locale: Locale): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(createTranslator(locale)("common.invalidAmount"));
  const amount = BigInt(value);
  const integer = new Intl.NumberFormat(LOCALE_FORMATS[locale], { maximumFractionDigits: 0 }).format(amount / 1_000_000n);
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  const decimal = new Intl.NumberFormat(LOCALE_FORMATS[locale]).formatToParts(1.1).find(part => part.type === "decimal")!.value;
  return `${integer}${decimal}${fraction} KZT-Test`;
}
/** Shows fractional minor units as an exact fraction rather than rounding a rational amount. */
export function formatLocaleRationalAmount(value: RationalMinorAmount, locale: Locale): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value.numerator) || !/^[1-9][0-9]*$/.test(value.denominator)) {
    throw new Error(createTranslator(locale)("common.invalidAmount"));
  }
  const numerator = BigInt(value.numerator); const denominator = BigInt(value.denominator);
  const wholeMinor = formatLocaleAmount((numerator / denominator).toString(), locale);
  let remainder = numerator % denominator;
  if (remainder === 0n) return wholeMinor;
  let divisor = denominator; let factor = remainder;
  while (factor !== 0n) { const next = divisor % factor; divisor = factor; factor = next; }
  remainder /= divisor;
  return createTranslator(locale)("financial.coupon.fractional.minor", { amount: wholeMinor, numerator: remainder.toString(), denominator: (denominator / divisor).toString() });
}
export function formatLocaleDate(value: string | null | undefined, locale: Locale, timeZone: string, dateOnly = false): string {
  const t = createTranslator(locale);
  if (!value) return t("common.missingDate");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.unknownDate");
  return new Intl.DateTimeFormat(LOCALE_FORMATS[locale], {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" })
  }).format(date);
}

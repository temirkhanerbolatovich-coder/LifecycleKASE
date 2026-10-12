import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator, formatLocaleAmount, formatLocaleDate, formatLocaleRationalAmount, messages, parseLocale, translateStoredMessage } from "./locale";
import { getActionStatuses, getActionTypes } from "./workspace-presentation";
import { getWorkspaceSections } from "./workspace-navigation";

test("locale input is a display preference with a strict supported-language fallback", () => {
  assert.equal(parseLocale("en"), "en");
  assert.equal(parseLocale("ru"), "ru");
  for (const value of [undefined, "kk", "en-US", "../en", { locale: "en" }]) assert.equal(parseLocale(value), "ru");
});

test("both catalogs have equal keys and interpolation parameters", () => {
  assert.deepEqual(Object.keys(messages.ru).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.ru) as (keyof typeof messages.ru)[]) {
    const parameters = (value: string) => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(parameters(messages.ru[key]), parameters(messages.en[key]), key);
    assert.ok(messages.en[key].trim(), key);
    assert.doesNotMatch(messages.en[key], /[А-Яа-яЁё]/, key);
  }
});

test("six-decimal amounts are exact at zero, one minor unit and beyond safe Number range", () => {
  assert.equal(formatLocaleAmount("0", "en"), "0.00 KZT-Test");
  assert.equal(formatLocaleAmount("1", "en"), "0.000001 KZT-Test");
  assert.equal(formatLocaleAmount("1234567", "en"), "1.234567 KZT-Test");
  assert.equal(formatLocaleAmount("1234567", "ru"), "1,234567 KZT-Test");
  assert.equal(formatLocaleAmount("9223372036854775807", "en"), "9,223,372,036,854.775807 KZT-Test");
  for (const invalid of ["1.2", "1,2", "01", "-1", "1e6", ""]) assert.throws(() => formatLocaleAmount(invalid, "en"));
});

test("rational coupon totals display an exact fractional minor unit in both languages", () => {
  assert.equal(formatLocaleRationalAmount({ numerator: "35000000000000", denominator: "20000" }, "en"), "1,750.00 KZT-Test");
  assert.equal(formatLocaleRationalAmount({ numerator: "0", denominator: "20000" }, "en"), "0.00 KZT-Test");
  assert.equal(formatLocaleRationalAmount({ numerator: "15000", denominator: "10000" }, "en"), "0.000001 KZT-Test + 1/2 of a minor unit");
  assert.equal(formatLocaleRationalAmount({ numerator: "1", denominator: "3" }, "ru"), "0,00 KZT-Test + 1/3 минимальной единицы");
  assert.equal(formatLocaleRationalAmount({ numerator: "180143985094819860001", denominator: "20000" }, "en"), "9,007,199,254.740993 KZT-Test + 1/20000 of a minor unit");
  for (const value of [{ numerator: "1", denominator: "0" }, { numerator: "-1", denominator: "3" }, { numerator: "01", denominator: "3" }]) {
    assert.throws(() => formatLocaleRationalAmount(value, "en"));
  }
  assert.equal(translateStoredMessage("До удержаний; налоговый модуль не реализован", "en"), "Before deductions; the tax module is not implemented");
});

test("exact-redemption terms, allocation explanation and server gate notices translate without changing token values", () => {
  assert.equal(createTranslator("en")("financial.redemption.target.tokens"), "Target bond quantity");
  assert.equal(translateStoredMessage("После погашения", "en"), "After redemption");
  assert.match(translateStoredMessage("Точное погашение v2 отключено на сервере. Проверьте готовность программы и разрешение владельца; условия формы сохранены.", "en"), /disabled on the server/);
  assert.match(translateStoredMessage("Сумма по инвесторам точно равна цели. Остаточные облигации получают наибольшие дробные доли.", "en"), /sum exactly to the target/);
  assert.equal(translateStoredMessage("9007199254740993", "en"), "9007199254740993");
});

test("locale changes do not choose a time zone or change the original UTC value", () => {
  const iso = "2026-10-13T06:59:00Z";
  assert.match(formatLocaleDate(iso, "en", "Asia/Qyzylorda"), /11:59/);
  assert.match(formatLocaleDate(iso, "en", "UTC"), /06:59/);
  assert.match(formatLocaleDate(iso, "ru", "UTC"), /06:59/);
  assert.equal(iso, "2026-10-13T06:59:00Z");
  assert.equal(formatLocaleDate(null, "en", "UTC"), "Not specified");
});

test("saved application notices change language in both directions without changing state values", () => {
  const source = "Phantom изменил длину подготовленной транзакции (101 вместо 100); отправка остановлена.";
  const translated = translateStoredMessage(source, "en");
  assert.match(translated, /Phantom changed.*101 instead of 100/);
  assert.equal(translateStoredMessage(translated, "ru"), source);
  assert.equal(translateStoredMessage("Unknown custom error / 9B7sTest", "en"), "Unknown custom error / 9B7sTest");
  assert.match(createTranslator("en")("qa.role.changed"), /Test role changed/);
});

test("navigation and action enums change their displayed labels while preserving stable IDs", () => {
  assert.deepEqual(getWorkspaceSections("en").map(section => section.id), getWorkspaceSections("ru").map(section => section.id));
  assert.equal(getWorkspaceSections("en")[1]!.shortLabel, "Actions");
  assert.equal(getActionTypes("en")["COUPON_PAYMENT"], "Coupon");
  assert.equal(getActionStatuses("en")["DRAFT"], "Draft");
  assert.equal(getActionStatuses("ru")["DRAFT"], "Черновик");
  assert.deepEqual(Object.keys(getActionStatuses("en")), Object.keys(getActionStatuses("ru")));
});

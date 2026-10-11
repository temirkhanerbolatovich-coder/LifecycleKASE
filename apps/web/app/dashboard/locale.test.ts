import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator, formatLocaleAmount, formatLocaleDate, messages, parseLocale, translateStoredMessage } from "./locale";
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

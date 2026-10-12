# ADR-027: Locale preference without changing operator routes or transaction state

Status: Accepted
Date: 2026-10-11

## Context

The submission needs an English interface. Operators must keep their form values, reviewed plans and saved signatures when changing language. Existing bookmarks and API contracts already identify actions independently of displayed labels.

## Options considered

1. Locale-prefixed routes with a routing library. This adds routing and remounting work to an existing stateful terminal.
2. A small typed catalog and React display preference shared by the existing routes.

## Decision

Use RU/EN catalogs and a `LocaleProvider`. Read the allow-listed `lifecyclekase_locale` cookie in the root layout to produce consistent server-rendered language and metadata. A client selector updates that cookie and React context without a navigation or workspace key change. Unsupported values fall back to Russian.

Use named catalog keys for new copy. `translateStoredMessage` is a compatibility bridge for existing application-owned notices and static workflow labels. It recognizes complete known strings/templates in either language, so saved notices can change language without replacing operation state. Never apply it to investor names, decision notes, documents, signed challenges, transactions or canonical receipts. Unknown external error descriptions retain their original text; stable API codes remain available for diagnosis.

Format six-decimal settlement amounts with BigInt and Intl; never convert money to Number. Locale changes do not choose a time zone or change UTC request values. Input contracts still use a dot decimal separator.

## Consequences and risks

No new runtime dependency, API route or database migration is needed. Cookie access makes the relevant Next routes dynamic. The compatibility bridge requires catalog coverage and can preserve unfamiliar external copy in its original language. Future work should migrate new or substantially edited notices to direct keys instead of expanding ambiguous prose matching.

Kazakh is a separate reviewed release. The current provider intentionally exposes only RU/EN; draft Kazakh terminology is not represented as an approved financial translation.

## Validation and future work

Catalog parity, interpolation, large/very small amounts, time-zone independence, stored notice translation and stable navigation IDs have regression tests. Browser checks cover language persistence, form preservation, saved errors, all workspace sections and narrow viewports. Full wallet signing and a public deployment of this candidate require their own acceptance.

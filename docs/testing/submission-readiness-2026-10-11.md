# Submission candidate acceptance — 2026-10-11

Scope: application release `1e6c96dd119f32cbf01cecef028723b9134ebe4b` following the [initial full audit](../PROJECT_AUDIT_2026-10-11.md), originally based on `eb7a6025cadb45229949a7107f7e0a72c07e1058`. Local validation, successful GitHub CI, public Render/browser acceptance, owner acceptance and hackathon submission are distinct checkpoints. Historical audit counts and original recordings remain dated evidence.

## Closed implementation gates

| Gate | Result and evidence |
| --- | --- |
| Revoked operator wallet sessions | Each session read rechecks current wallet ownership, ACTIVE status, verification and revocation. Eight wallet lifecycle/ownership cases, exact expiry and HTTP recovery regressions pass. Existing `401 SESSION_INVALID` and confirmation-only UI recovery are preserved. |
| Zero-rounded coupons | Coupon zero rows receive the existing `NotEligibleZeroRounding` status. SUBMIT and on-chain FINALIZE require a positive total. All-zero API calculations remain CALCULATED/readable; mixed rows are retained and zero rows have no payment/settlement. No account layout or instruction signature changed. |
| English display path | RU/EN selector, server cookie/metadata, all seven workspace sections, registry forms, workflow panels, known notices, statuses, amount/date formatting and QA controls implemented. Unknown external descriptions and user-entered content retain their original language. |
| Narrow viewport | Removed the fixed body minimum width that caused a 15px horizontal overflow with a vertical scrollbar at 320px. Recheck: document client/scroll width **305/305**; at 390px **375/375**. Wide tables scroll within their own region. |
| Redeemed instrument presentation | A zero outstanding supply no longer displays the initial mint/distribution prompt for a REDEEMED instrument; that prompt is limited to the DRAFT stage. |
| Founder narration | User-supplied name and professional background replace the pitch introduction placeholder. Full [profile](../submission/FOUNDER_PROFILE_EN.md) and [English reviewer guide](../submission/JUDGE_README.md) prepared. |

Language changes update presentation without navigating or changing workspace keys. Existing form/API/signing guards remain. Six-decimal amounts stay BigInt-exact, including one smallest unit and the database maximum; language does not choose the operator time zone or change UTC/decimal request contracts. [ADR-027](../decisions/ADR-027-display-locales.md) records the small catalog/context choice and its compatibility bridge.

## Validation

- `npm run check` passed **350/350 Node tests**: API 139, web 83, domain 27, Solana client 54, root 47. Locale catalog parity, exact amounts, dates, saved notices, stable navigation IDs and QA zero/mixed obligations are included. Final display-only corrections were followed by another **83/83 web tests** and production web build.
- Full workspace build and typecheck passed; the closing production web build includes the DRAFT prompt guard and zero-total explanation.
- Prisma schema, repository scaffold and production dependency audit passed; **0 deployed dependency vulnerabilities** in the root graph. The separate integration-tool dependency backlog from the initial audit remains outside that claim.
- Rust formatting and locked offline tests passed: **19 tests in each of default and Devnet profiles**; Clippy with warnings denied passed for both profiles. These are 19 unique program tests, not 38 distinct tests.
- SQL guards and all four HTTP/PostgreSQL suites passed in a separate temporary PostgreSQL 17 container: snapshot persistence, investor/instrument registry, corporate actions/approval/execution/reconciliation and durable program upgrade maintenance. All 19 migrations applied. Updated regression expectations verify that all-zero SUBMIT preserves action version/audit and that revoked approver sessions fail with `401 SESSION_INVALID` before broadcasting. Synthetic RPC suites establish database/API behavior; the financial validator acceptance below is separate.
- Production fixed-origin proxy passed: Origin/body handling, Strict HttpOnly cookies, route allowlist and unknown-route isolation.
- `git diff --check` and Markdown link/fence validation passed for all **101 Markdown files**. A refreshed snapshot of **483 tracked/unignored public-source paths** passed Gitleaks 8.30.1 with fully redacted output and the unchanged, exact public-Solana-address allowlists. The initial absolute-path directory scan did not match those path-scoped exceptions; scanning from the snapshot root resolved its four known public-address false positives without widening the rules.

### Fresh live financial acceptance

Command: `scripts/test-kase-demo.ps1 -RpcPort 19070 -DatabasePort 65489`. The wrapper built the unique profile `localnet-candidate-kase-20261011-154330272`, started a disposable validator and isolated PostgreSQL database, applied all 19 migrations, and stopped its own runtime resources after success.

SBF SHA-256: `2c8b3b72a4bd210ce7a242cd9e9f413a57e53375621dbcfeb57640d51e75b688`. This candidate does not replace the accepted owner artifact or upgrade manifest.

- On-chain all-zero coupon: three skipped rows preserved; finalization and reserve rejected; complete partial-registration reset succeeds.
- On-chain mixed coupon **1 / 2 / 0 smallest units**: three registered holders, reserve total 3, two paid receipts, zero-payment rejection with unchanged state, processed count 2, final receipt and no bond burn.
- HTTP/PostgreSQL/validator three-action scenario: coupon **1,750 KZT-Test**, partial **7,000 KZT-Test** with **7 burned**, maturity **29,400 KZT-Test** including final coupon with **28 burned**. Supply **35 → 35 → 28 → 0**. Separate approval, exact saved v0 wires, immutable source accounts and canonical receipts verified.
- Insufficient burn source: API rejection and finalized program failure leave reserve, recipient, supply and receipt/settlement unchanged. Missing-history recovery and projection/audit rollback use the original signature.

[Fresh run JSON](evidence/kase-three-actions-2026-10-11.json) preserves exact canonical receipt strings and public test signatures. SHA-256 of each canonical string matches its recorded receiptHash. It is a completed disposable Localnet run; the ledger is not continuously queryable and is not a public Explorer network. Automated disposable signers do not prove physical Phantom interaction.

### Browser acceptance

Used the Codex browser against the local candidate:

- English visible copy checked in Overview, Actions, Instruments, Investors, Transactions, Audit and System; application body checks found no Cyrillic in these fresh synthetic views, apart from the intentional language choice `Русский`.
- EN → RU → EN preserved the chosen instrument, purpose text, dates and open draft form. Navigation preserved visited detail tabs. Reload preserved English metadata and language through the cookie.
- A simulated request failure displayed a recovery message; changing locale translated the already saved error without retrying the failed operation. Explicit refresh recovered the view.
- A fresh early-redemption QA draft with 1 bps completed schedule → holder capture → calculation. All three rows rounded to zero, both review controls stayed disabled and their reason remained visible. RU → EN → RU translated the calculation result and completed-step label without changing totals/state. Draft/scheduled/calculated QA buttons and inline errors now use the same catalogs. This is a simulation test, not another on-chain payment.
- Completed coupon entitlements and maturity redemption details displayed exact English sums/statuses, source and simulated-cutoff explanations. User notes remain raw content; seeded QA examples now use English text for recording.
- Mobile navigation and detail layout checked at 390 and 320px; the confirmed body overflow was corrected and measured again. No browser application errors were captured; a development Fast Refresh warning during source edits is not a production failure.
- English signed-out dashboard/login/header/disclaimer checked. Its local API was deliberately absent; `API unavailable` was expected. No wallet signature or live API availability was inferred from that screen. Native date-picker chrome follows browser/OS language and may remain Russian independently of application copy.

Proof screenshots: [overview](screenshots/release-2026-10-11/english-overview-desktop.jpg), [mobile maturity](screenshots/release-2026-10-11/english-maturity-mobile.jpg), [login](screenshots/release-2026-10-11/english-login.jpg), [zero-total explanation](screenshots/release-2026-10-11/english-zero-total.jpg). Screens are explicitly QA or signed-out UI, not new financial execution evidence.

## Remaining submission gates

1. Record and inspect the **English pitch (target 2:40)** and **separate demo (target 2:50, maximum 3:00)** with actual narration. The scripts are ready; no new narrated media is claimed. Preserve existing originals, show the Localnet/QA distinction and use the fresh exact receipts for financial claims.
2. Check the authenticated Arena fields, accepted video hosts, actual team membership, personal eligibility, prior-work disclosure and accessible processed video links. The founder profile does not determine team size or eligibility. Submit and save the actual confirmation before the official deadline.
3. After the English submission path: native financial review of Kazakh, observed tests with relevant operators, demand/pilot evidence, public-network financial acceptance and real integrations remain separate work.

Source publication and public QA are **closed**: use [application revision `1e6c96d`](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/tree/1e6c96dd119f32cbf01cecef028723b9134ebe4b) and [public QA](https://lifecyclekase-web.onrender.com/qa). [Render acceptance](../deployment/render-staging.md) records both services Live, HTTP 200 health/QA, protected 401 responses and the English signed-out coupon simulation. The initial public 404 remains historical. Default-branch merge and final hackathon submission have not occurred.

An all-zero action intentionally stays CALCULATED with its immutable evidence and cannot review, reserve or pay. The existing workflow does not revise or terminate that calculated action. A reasoned terminal “no payment required” policy is an outstanding operator improvement; it must not bypass financial guards or rewrite the snapshot. The walletless QA model follows the same zero-row and review policy while remaining explicitly synthetic.

## Current product backlog

The initial audit's EN and two confirmed defect items are implemented and the application release is published. These remaining items are separate from recording a hackathon submission:

| Priority | Work | Acceptance |
| --- | --- | --- |
| P1 | Full issuer/compliance/approver/Auditor role model and controlled operator lifecycle | Reads scoped to issuer, explicit role permissions and reasoned role/wallet changes tested end to end. |
| P1 | Investor correction, suspend/unblock/close | Audited reasons and explicit effect on active actions; no rewriting immutable holder evidence. |
| P1 | Real disposable Phantom happy, rejection, expiry and recovery paths | All three financial actions verified with actual wallet interaction; retained-owner upgrade remains a separately authorized milestone. |
| P1 | Missed-window processing, restart/reindex and unknown-signature tooling | Durable restart behavior and original-signature confirmation without replacement payments. |
| P1 | Governed pause/resume, authority/policy rotation and post-approval reserve recovery | Reviewed authority transitions and failure/recovery evidence without privilege bypass. |
| P1 | Zero-total terminal policy | Reasoned, audited no-payment outcome without falsely claiming settlement. |
| P1 | Operator UX and accessibility | Concrete next CTA, compact QA mobile controls, unsaved-field warning on role change, contextual form errors; keyboard, 200% zoom and screen-reader acceptance. |
| P1 | Kazakh translation and operator validation | Native financial review, complete critical confirmation copy, same exact values/state; 3–5 observed operator task sessions before making ease-of-use claims. |
| P2 | Public-network financial acceptance | Reviewed network deployment plus fresh finalized transaction/wallet/receipt evidence. |
| P2 | Holder/source scaling | Explicit packet/account limits, pagination and lookup tables where required; measured boundary scenarios. |
| P2 | Shared rate limits, metrics and recovery operations | Measured latency, supervised monitoring, backup/restore and deployment recovery drills. |
| P2 | SBF/validator CI and integration dependency remediation | Runtime acceptance in CI; resolve the separate integration graph's 5 high/7 moderate findings without changing accepted owner artifacts. |
| Separate pilot scope | Historical cutoff, real KYC, custody, fiat and exchange/CSD integrations | Independently scoped legal/security/integration acceptance; customer demand and willingness to pay established through evidence. |

## GitHub checkpoint

Publication check: local and remote application SHA matched `1e6c96dd119f32cbf01cecef028723b9134ebe4b`. All three jobs in [CI run 38137890172](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/actions/runs/38137890172) passed before deployment, including clean builds, repository tests, production proxy, dependency audit, migrations/HTTP database suites, Rust profiles and full-history secret scan. Draft [PR #1](https://github.com/temirkhanerbolatovich-coder/LifecycleKASE/pull/1) remains open; default `master` remains `27af655bc3b0354ad067778fed8ebd0e68c61a64`. Following documentation commits record this exact deployed application rather than another rollout.

This release is a verified prototype package with public UI QA. It does not establish real money settlement, customer adoption, KASE affiliation or retained-owner funding/execution acceptance.

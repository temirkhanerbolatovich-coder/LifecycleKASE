# Operator workspace final presentation verification — October 10, 2026

## Scope and isolation

This record follows the [earlier same-day UI acceptance](operator-workspace-ui-2026-10-10.md); its older counts and screenshots remain historical. The checkout already contained substantial uncommitted API, Solana and UI work. This pass improves the existing presentation and necessary client interactions, rather than claiming ownership or acceptance of that whole working tree. Design decisions and reference/access distinctions are in the [feature document](../features/operator-workspace-ui.md#reference-decisions).

Browser testing used a separate production Next.js build of the current web components, an intercepted synthetic API and a message-only UI Test Wallet. No owner API, PostgreSQL or RPC write was performed. No transaction signing feature was exposed by the fixture wallet. The test controls and fixture routes live in ignored `.local-*` copies, outside shipped `apps/web`. Synthetic names, statuses and receipt JSON in screenshots are UI fixtures, not financial evidence.

SHA-256 comparison against the start-of-pass snapshot found zero changes in 238 protected files covering API, Prisma, Solana program/client, environment example and web network configuration. All existing workflow `.ts` files also match that snapshot; only the presentation/date helper and its test changed among existing `.ts` files. No dependency, router, financial formula or feature flag was added. The existing selected-object/mounted-panel model was retained.

## Validation

| Check | Final result |
| --- | --- |
| `npm run test --workspace @lifecycle-kase/web` | 55 passed, zero failed |
| `npm run typecheck --workspace @lifecycle-kase/web` | Passed |
| `npm run build:web` | Passed: domain, Solana client and production Next.js web build |
| `npm run validate` | Passed: scaffold and Markdown links |
| `git diff --check` | Passed |
| Browser console errors/warnings | None captured during the inspected fixture screens |
| Protected-source hashes | 238 files unchanged from the start of this pass |

Existing workflow tests cover role/signature/byte boundaries, honest proof stages, state navigation, failed reads and no automatic POST replay. The added date regression checks missing/invalid values, named time zone and a UTC date crossing the local calendar boundary. No tests were added merely to assert CSS classes.

The binary font's cmap contains the Cyrillic/Latin/numeric characters in representative headings. It has a real 400–900 weight axis. Browser computed styles report `golos` with its generated fallback and a local font preload; page heading sizing is 32 px. Calculated contrast ratios for the actual common foreground/background tokens are: body 14.29, secondary 5.57, primary button 5.49, navigation 9.39, success 6.58, warning 6.20 and error 6.51. This token check is not a claim of a complete WCAG audit.

## Browser scenarios

| Scenario | Observed behavior |
| --- | --- |
| Login and all sections | Message-only fixture login opened Overview, Actions, Instruments, Investors, Transactions, Audit and System. |
| Search/status/sort and return | Instrument search/status/sort narrowed the loaded two-record set to one; opening the object and returning retained the controls. No-match state and reset worked. |
| Pagination | Investor list appended page two: 20 loaded records became 25, with truthful matching/loaded counts. |
| Clipboard | Issuer-address copy displayed success. Full selectable identifiers remain available. |
| Investor distinctions | Record status/type, wallet ownership, eligibility and KYC appeared separately. Pending or mismatched wallet controls were unavailable with an explanation. |
| Form failure | Synthetic rejected investor creation preserved name/code and showed actionable error text; correcting the code then succeeded. |
| Created action / failed read | Synthetic action POST succeeded and its following list GET failed. The saved object's detail opened; the UI said it was created and warned against duplicate creation. |
| Navigation with a plan | A prepared schedule plan, operation UUID and checked review survived section switching and return. The wallet without transaction features could not send. |
| Session expiry | A protected read expired the session. Same-wallet message login restored it while preserving plan/review. Request counters increased by only the two authentication POSTs; the original request was not replayed. |
| Saved unknown signature | After reload, preparing the same persisted phase restored its original UUID/signature. Send and review controls were disabled; confirmation remained available. A synthetic not-finalized response retained the signature. |
| Auditor | Registry creation and workflow mutations were absent; object facts and history remained readable with a role explanation. |
| Connection loss/recovery | Failed journal GET showed connection feedback while records remained. Explicit refresh restored the connection; fixture POST count stayed unchanged. |
| Loading | A delayed journal refresh disabled the refresh button and announced the pending request. Existing records remained visible. |
| Receipt | Completed coupon fixture displayed 3/3 payments and the existing JSON control. Clicking it reached the handler's downloaded-status message. The browser tool could not capture the download event/file, so saved-file verification remains open. |
| Keyboard | End moved the action tab selection and focus to History; Escape closed the mobile menu and returned focus to its summary. |
| Responsive | At 360, 390, 768, 1024, 1440 and 1920 px, document/body width did not exceed viewport width. Wide tables scrolled locally. Mobile long investor names, amounts and action tabs wrapped without page overflow. |
| 200% approximation | Fixture-only root CSS zoom 2 preserved access and local table scrolling. This is a reflow approximation, not native browser zoom acceptance. |

## Screenshots

All images below show the isolated synthetic stand. The extra fixture-control disclosure is a testing aid, not a production control.

| View | Desktop | Mobile |
| --- | --- | --- |
| Overview | [Overview](screenshots/operator-workspace-redesign-2026-10-10/overview-desktop.jpg) | [Overview](screenshots/operator-workspace-redesign-2026-10-10/overview-mobile.jpg) |
| Actions | [Registry](screenshots/operator-workspace-redesign-2026-10-10/actions-desktop.jpg) | [Registry](screenshots/operator-workspace-redesign-2026-10-10/actions-mobile.jpg) |
| Instruments | [Registry](screenshots/operator-workspace-redesign-2026-10-10/instruments-desktop.jpg) | [Registry](screenshots/operator-workspace-redesign-2026-10-10/instruments-mobile.jpg) |
| Investor detail | [Detail](screenshots/operator-workspace-redesign-2026-10-10/investor-detail-desktop.jpg) | [Detail](screenshots/operator-workspace-redesign-2026-10-10/investor-detail-mobile.jpg) |
| Transactions | [Journal](screenshots/operator-workspace-redesign-2026-10-10/transactions-desktop.jpg) | [Journal](screenshots/operator-workspace-redesign-2026-10-10/transactions-mobile.jpg) |
| Audit | [Journal](screenshots/operator-workspace-redesign-2026-10-10/audit-desktop.jpg) | [Journal](screenshots/operator-workspace-redesign-2026-10-10/audit-mobile.jpg) |
| System | [Settings](screenshots/operator-workspace-redesign-2026-10-10/system-desktop.jpg) | [Settings](screenshots/operator-workspace-redesign-2026-10-10/system-mobile.jpg) |
| Completed coupon | [Payments](screenshots/operator-workspace-redesign-2026-10-10/coupon-finalized-desktop.jpg) | [Payments](screenshots/operator-workspace-redesign-2026-10-10/coupon-finalized-mobile.jpg) |
| Login / logout | [Login](screenshots/operator-workspace-redesign-2026-10-10/login-desktop.jpg) | [Logout to login](screenshots/operator-workspace-redesign-2026-10-10/login-mobile.jpg) |

Additional evidence: [login](screenshots/operator-workspace-redesign-2026-10-10/login-desktop.jpg), [form failure](screenshots/operator-workspace-redesign-2026-10-10/form-error-desktop.jpg), [successful creation / failed refresh](screenshots/operator-workspace-redesign-2026-10-10/created-read-error-desktop.jpg), [unknown signature](screenshots/operator-workspace-redesign-2026-10-10/unknown-signature-desktop.jpg), [Auditor detail](screenshots/operator-workspace-redesign-2026-10-10/auditor-detail-desktop.jpg), [CSS 200%](screenshots/operator-workspace-redesign-2026-10-10/actions-200-percent.jpg).

## Unverified boundaries and separate work

Real Phantom transaction approval/rejection, account switching, actual RPC failures, retained owner confirmation, live payment/reconciliation, production deployment, native browser 200% zoom, OS reduced-motion execution, screen-reader behavior and physical receipt-file download were not accepted in this presentation pass. The reduced-motion CSS rule was reviewed; no OS preference was changed. Full backend/validator suites were not rerun for a presentation change.

The owner ledger, default-off capabilities and unresolved signed attempts remain governed by their existing acceptance gates. The UI cannot make those workflows available by itself. Global search/counts, server-filtered pagination, direct instrument/investor UUID reads and cross-device unsent-draft recovery require separately designed server work. Local UI screenshots, build success and API reachability do not prove a finalized financial result.

# Operator workspace UI acceptance — October 10, 2026

## Scope and environment

This revision updates presentation and necessary client navigation for all five operator sections. The existing checkout already contained unfinished approval, reserve and program-maintenance work. Those changes remain separate; this report does not claim that the entire working tree belongs to the UI revision.

Browser interaction used an isolated production build of the actual web components with synthetic API responses and a message-only test wallet. Every `/api/v1/` request was intercepted locally; unsupported routes failed closed. The adapter exposed no transaction signing or submission features. Fixture helpers and the preview application are ignored local artifacts and are not shipped in `apps/web`.

The retained owner API, PostgreSQL and Solana validator were not restarted or used to exercise write scenarios. Only the web process was restarted after the production build. Public exchange documentation informed the layout; authenticated exchange applications were not inspected. The [feature document](../features/operator-workspace-ui.md#reference-decisions) records the four reference adaptations and access limits.

## Automated validation

| Command | Result |
| --- | --- |
| `npm run test --workspace @lifecycle-kase/web` | 49 tests passed |
| `npm run typecheck --workspace @lifecycle-kase/web` | Passed |
| `npm run build:web` | Passed |
| `npm run validate` | Passed |
| `git diff --check` | Passed |

New behavior tests cover loaded-record search/filter/sort without mutating source records; no-match results; honest application/chain stage distinction; original unknown-attempt identity; cancelled draft stages; selected-object bookmarks; caller abort; and connection recovery without request replay. Existing workflow tests continue to cover signature/byte validation and finalized-only acceptance.

## Browser acceptance

| Scenario | Observed result |
| --- | --- |
| Login/logout | Message challenge and verification enter the fixture workspace; logout returns to login. Transaction features are absent from the test wallet. Desktop and mobile login remain usable. |
| Five sections | Overview, actions, instruments, investors and system opened on desktop and mobile; the current mobile section is visible in the menu. Escape closes the menu and restores focus to its summary. |
| Search/filter/sort | Loaded action and investor searches narrow the table; draft filter shows the matching action. A nonmatching instrument search shows an explicit empty result. Source-record ordering tests cover numeric sorting. |
| Detail and return | The first table column opens the object on mobile. Returning retains the action filter; section navigation retains the selected object and exact prepared plan/review. |
| Action evidence | The calculated fixture shows 3 holders and 1750.00 KZT-Test from the entitlement response. Registration remains current for UNKNOWN_CONFIRMATION; chain approval is blocked and execution is unavailable. Proof retains the original UUID/signature. |
| Form failure | A synthetic 409 appears beside the investor form. Name/code values remain available; the failed create produces one POST and is not replayed. |
| Connection and loading | Transport failure displays lost connection and retains values. A subsequent explicit GET clears the connection notice. A delayed GET exposes busy feedback and disables section navigation. |
| Session expiration | The workspace, reviewed plan and manually entered signature remain visible. Message login restores access without automatically resending the previous request. |
| Pending recovery | After reload, preparing the same server-persisted pending attempt restores its UUID/signature. Review is locked, sending is disabled, and confirmation remains available. |
| Permissions | An unconfirmed investor wallet explains the eligibility block. Auditor mode keeps reads available, disables FINALIZE/RESET and explains the required authority; funding preparation is absent. |
| Keyboard | Arrow navigation changes the action tab, moves focus and matches `aria-controls` to the visible panel. The entitlement region is focusable: ArrowRight changed its scroll position from 0 to 29.6 px at 390 px width. |
| Responsive widths | All five sections checked at 390 px, registries at 768 px and desktop screens at 1440 px. Tables overflow only their own region; no document-wide horizontal overflow was observed. |
| Scale | Native browser zoom shortcut did not change the browser scale, so true browser 200% is unverified. A fixture-only CSS `zoom: 2` check at 1440 px exposed and then verified fixes to toolbar minimum widths and the screen-reader label container. After the fix, document width was 1425 px within a 1440 px viewport; search remained usable. CSS zoom is partial evidence, not equivalent to native browser zoom. |

Viewport overrides and fixture scale were reset after acceptance. Reduced-motion rules were reviewed in CSS; no screen-reader or operating-system reduced-motion session was performed.

## Screenshots

These images contain **synthetic isolated fixture data**, not owner financial acceptance. Desktop uses 1440 px; mobile uses 390 px. Form/session evidence was captured during the workflow checkpoint before minor final layout adjustments.

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Login | [Desktop](screenshots/operator-workspace-ui-2026-10-10/login-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/login-mobile.png) |
| Overview | [Desktop](screenshots/operator-workspace-ui-2026-10-10/overview-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/overview-mobile.png) |
| Actions registry | [Desktop](screenshots/operator-workspace-ui-2026-10-10/actions-list-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/actions-list-mobile.png) |
| Action detail | [Desktop](screenshots/operator-workspace-ui-2026-10-10/action-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/action-mobile.png) |
| Instruments | [Desktop](screenshots/operator-workspace-ui-2026-10-10/instruments-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/instruments-mobile.png) |
| Investors | [Desktop](screenshots/operator-workspace-ui-2026-10-10/investors-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/investors-mobile.png) |
| System | [Desktop](screenshots/operator-workspace-ui-2026-10-10/system-desktop.png) | [Mobile](screenshots/operator-workspace-ui-2026-10-10/system-mobile.png) |

Additional evidence: [768 px registry](screenshots/operator-workspace-ui-2026-10-10/instruments-tablet.png), [CSS scale 200%](screenshots/operator-workspace-ui-2026-10-10/zoom-200-css.png), [no search matches](screenshots/operator-workspace-ui-2026-10-10/no-matches-desktop.png), [auditor permissions](screenshots/operator-workspace-ui-2026-10-10/auditor-action-desktop.png), [form error](screenshots/operator-workspace-ui-2026-10-10/form-error-desktop.png), [expired session](screenshots/operator-workspace-ui-2026-10-10/session-expired-desktop.png), [restored plan](screenshots/operator-workspace-ui-2026-10-10/recovered-plan-desktop.png).

## Owner and source boundary

A SHA-256 comparison against the pre-UI baseline found **119 protected files unchanged**, including API source, Prisma, Rust, Solana client source and root/web dependency manifests. No dependency was added.

The read-only owner check at **2026-10-10 07:12:08.952 UTC**, minimum finalized slot **151414**, observed the same genesis `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`, program hash `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, deployed slot 106314 and 344640 bytes. Action `464a832a-2c55-4e22-bb7a-6be93b429c78` remained UNDER_REVIEW/version 6 with three registrations and 1750000000 minor units. FINALIZE attempt `436213b5-cd0c-44f9-8fb3-9547ec91b496` remained UNKNOWN_CONFIRMATION. Funding remained PREPARED without a signature and there were no approval attempts. This is point-in-time boundary evidence; the pending attempt was not closed or retried.

After the final production web restart, the same read-only assertions passed at **07:27:30.145 UTC**, minimum finalized slot **153605**, with the same program, action and attempt values. `/dashboard`, web `/health/live`, API `/api/v1/health/live` and `/api/v1/health/ready` returned HTTP 200. Browser reload showed the actual [owner login screen](screenshots/operator-workspace-ui-2026-10-10/owner-login-final.png) without initiating Phantom login or a transaction. The isolated preview was stopped; the production web remains on `http://localhost:3000/dashboard`.

## Sidebar correction after the Chrome report

The user reported broken layout in Chrome and supplied a screenshot with an incomplete dark sidebar. The same defect was reproduced in the actual logged-in application in the available in-app browser: at 1440 px, the sidebar was 463.3 px tall while the workspace was 720 px. The sidebar itself was sticky and aligned to the grid start, leaving its background shorter than the workspace and exposing gaps during scrolling.

The correction stretches the outer sidebar to the grid height and moves sticky positioning to its inner navigation container. All five sections at 1440 px now have equal sidebar/main heights and coincident bottom edges, without horizontal document overflow. On a long action detail, after scrolling 891.2 px, the inner navigation remained at top 16 px while the sidebar background continued to the main bottom. At 390 and 768 px the sidebar remained hidden and the mobile menu remained available without document overflow. Typecheck, production build, 49 web tests, documentation validation and `git diff --check` passed; 119 protected source files remain unchanged.

Chrome was not exposed by the browser-control connection (`Browser is not available: chrome`). Therefore this is a fix based on the Chrome screenshot and live reproduction, with browser acceptance in the available in-app browser; direct Chrome acceptance remains unverified. No wallet signing was initiated.

Evidence: [corrected desktop sidebar](screenshots/operator-workspace-ui-2026-10-10/sidebar-fixed-desktop.png), [sticky navigation while scrolling](screenshots/operator-workspace-ui-2026-10-10/sidebar-fixed-scroll.png), [mobile system screen](screenshots/operator-workspace-ui-2026-10-10/sidebar-fixed-mobile.png).

After restarting only the production web process on port 3000, an actual authenticated `/dashboard#system` reload also showed sidebar and main heights of 720 px with equal bottom edges at 1440 px. HTTP `/dashboard` returned 200. [Live screenshot](screenshots/operator-workspace-ui-2026-10-10/sidebar-fixed-live.png) records this presentation check; no transaction was prepared or signed.

## Full-page shell correction

Following the user's request to remove the separate window appearance, the dashboard header and workspace no longer use the centered 1440 px container or outer margins/padding. The workspace border, rounding and shadow were removed on desktop and mobile. The app now fills the viewport through the existing shell's flex layout, with a continuous footer and full-height sidebar; the artificial 720 px workspace minimum was removed. API/authentication/navigation workflows were not changed.

The actual authenticated application was checked through read-only UI navigation in the available in-app browser. All five sections passed at 1920 px and 390 px; the system screen was also checked at 768 px and overview at 1440 px. The workspace starts at x=0 and ends at the content viewport edge, header/session gap is 0, the sidebar and main have matching bottom edges on desktop, and no document-wide horizontal overflow was observed. Computed outer border and radius are 0 px and shadow is `none`. Typecheck, production build and all 49 web tests passed; 119 protected files are unchanged. This acceptance does not claim a direct Chrome-controlled session.

Screenshots of the actual application: [overview desktop](screenshots/operator-workspace-ui-2026-10-10/fullpage-overview-desktop.png), [system at 1920 px](screenshots/operator-workspace-ui-2026-10-10/fullpage-system-desktop.png), [system mobile](screenshots/operator-workspace-ui-2026-10-10/fullpage-system-mobile.png).

## Remaining limits

- Search/filter/sort operate on loaded pages. The overview reads the latest 20 actions and shows up to six attention items, not a global queue.
- Instrument/investor bookmarks can restore only records loaded through the existing list API. No individual GET endpoint was invented.
- Navigation retains in-memory drafts and plans; full reload recovers only the selected object and pending state available from the existing server. Unsubmitted signatures and unsent form drafts are not persisted.
- Native browser zoom at 200%, assistive-technology acceptance and actual Phantom transaction signing are unverified in this UI task.
- At the preceding UI-only checkpoint payment/redemption was unavailable. The subsequent coupon slice below adds isolated execution; owner payouts and all redemptions remain unavailable. Localnet/KZT-Test fixtures, healthy HTTP endpoints and screenshots do not prove production or financial completion.

## Subsequent coupon and journal modernization

This continuation changes the relevant client/API/program as documented in [coupon acceptance](coupon-execution-2026-10-10.md); the earlier 119-file preservation comparison describes the preceding presentation-only checkpoint.

The continuous full-page shell is preserved. Overview now contains the working queue instead of duplicated module cards, metrics and tutorial boxes. Terminal actions are excluded; signed unknown attempts take priority over unsigned funding. Routine successful list reads produce no notification. The global network/demo explanation appears once; UUIDs, formulas, PDAs, review notes and repair/reset controls are revealed through details.

The seven sections include authenticated read-only Transactions and Audit, with human operation labels, loaded-record search/status/date sorting, cursor pagination and object links. After approved coupon execution becomes available, calculation/review folds and payment progress becomes primary. The exact current step is centered inside the focusable mobile progress strip and marked `aria-current=step`.

The available in-app browser checked the actual components in an isolated production build, synthetic Auditor data and a request adapter that rejects all writes. All seven sections were navigated at desktop width 1440; mobile 390 and tablet 768 checks covered overview/action, menus, selection retention, local table/progress scrolling and no document overflow. At 1440 the sidebar/main have the same bottom edge and the workspace spans x=0 to 1440. At 390 the current execution step fits inside the progress strip. The saved UNKNOWN_CONFIRMATION fixture restores the original signature, removes signing controls and disables writes for Auditor. FINALIZED shows three paid recipients and the JSON control; clicking it completes the UI callback. The browser download-event API timed out, so saving the resulting file on disk is unverified. Canonical JSON/hash/API integrity is proved separately by the real HTTP/database harness. Final browser console inspection returned no warnings/errors.

Evidence: [desktop action](screenshots/coupon-workspace-desktop-2026-10-10.jpg), [mobile action](screenshots/coupon-workspace-mobile-2026-10-10.jpg). These screenshots contain explicitly labeled synthetic data and do not claim owner financial completion. Direct Chrome control, native 200% zoom, screen readers and owner Phantom execution remain unverified.

The complete repository check passed 294 tests (54 web), type/schema validation, production web build and 51-route production proxy acceptance. Owner configuration keeps coupon execution disabled, preserves the held FINALIZE and uses the existing ledger/database.

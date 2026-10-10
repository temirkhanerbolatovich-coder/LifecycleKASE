# Operator workspace UI

## Purpose and scope

LifecycleKASE is an operator console for corporate actions. The workspace explains the selected object, confirmed stages, next step and evidence. The initial October 10, 2026 revision changed presentation and navigation, retaining the existing Next.js panels and same-origin API. The subsequent modernization adds quiet task views and read-only Transactions/Audit journals; the adjacent [coupon execution slice](coupon-execution-and-receipts.md) documents its new endpoints and protocol separately. Roles, financial formulas and retained owner state are preserved.

## Screen map and decisions

| Section | Operator task | Presentation |
| --- | --- | --- |
| Overview | Find work to continue | Compact task list from the existing paginated GET, original unknown signatures first, next-step descriptions and direct links |
| Corporate actions | Select and continue an action | Searchable table, create form, object header with dates/holders/loaded calculation total, stages and work/terms/evidence tabs |
| Instruments | Inspect an issue | Ticker/status/supply/maturity table, detail, issuer controls and existing deployment/distribution review |
| Investors | Inspect a receiver | Name/code/eligibility/KYC/wallet-count table; wallet ownership, eligibility reasons and administrative forms |
| Transactions | Inspect saved chain attempts | Latest-first bounded history, status/search, original signature and action links; no prepared-wire disclosure or submission controls |
| Audit | Inspect decisions and provenance | Latest-first bounded event/actor history with technical metadata on demand |
| System | Understand the connection | Wallet/session settings, sign-in explanation and separately disclosed privileged maintenance |

The previous workspace required scanning full record cards and mixed action controls with raw evidence. The revision adds loaded-record search and status/sort controls, separates work from history, and explains missing prerequisites near unavailable controls. Technical details needed for a transaction signature remain visible during review.

## Reference decisions

The final presentation pass on October 10, 2026 visually inspected five public references. They were selected as comparable product/interface references; no Awwwards award or authenticated application access is claimed.

| Visually inspected reference | Adopted decision | Access boundary |
| --- | --- | --- |
| [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Quiet grouped sidebar, readable hierarchy and one selected-state accent | Public article and its actual before/after interface illustrations |
| [Ramp](https://ramp.com/) | Clear primary action and compact financial typography | Public landing page, not an authenticated finance workspace |
| [Wise](https://wise.com/) | Plain language around consequential actions and amounts | Public Russian landing page |
| [Vercel](https://vercel.com/) | Restrained borders and consistent spacing | Public landing page, not its private dashboard |
| [Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics) | Task grouping and a separate place for transaction inspection | Public documentation interface and guide |

These visual observations are separate from the exchange-documentation research below. Landing-page layouts were not copied into the operational terminal. Mercury's public demo stayed in a loading state and was not used as verified interface evidence.

These are adaptations from official public guides inspected on October 10, 2026. Authenticated exchange sessions were not inspected. The Binance screenshot endpoint could not be decoded by the retrieval tool; its guide text was accessible. No trading, order-book or yield features are added.

| Official reference | Supported pattern | Adaptation |
| --- | --- | --- |
| [Binance Spot guide](https://www.binance.com/en/academy/articles/your-guide-to-binance-spot-trading) | Pair search, selected-object area, separate history | Loaded-object search and readable tables; work and proof history stay separate |
| [Bybit chart guide](https://www.bybit.com/en/help-center/article/Bybit-Trading-Chart-FAQ) | Selected pair context and information tabs | Instrument/action context above work, terms and evidence tabs |
| [OKX settings guide](https://www.okx.com/en-us/help/trading-settings-faq) | Grouped settings; consequential-action confirmations | System settings and advanced/destructive disclosure; existing explicit signing review remains required |
| [Kraken Pro guide](https://support.kraken.com/articles/kraken-pro-trading-interface-guide) | Essential ribbon, focused widgets, term explanations | Compact session ribbon, modular task surfaces, keyboard-accessible glossary and next-step guidance |

LifecycleKASE retains its own green/neutral palette, Localnet identity and corporate-action terminology. Text accompanies every status color. Exchange conventions do not determine a financial result.

The subsequent modernization applies [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): frequent actions and important signing terms stay visible; formulas, raw identifiers and completed calculation details expand on demand. [Carbon data-table guidance](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) informs consistent loaded search/status/sort and table actions. [Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics) informs task-based navigation and separate transaction inspection. These are interaction adaptations; no trading functionality or copied branding is introduced.

The overview's duplicate navigation cards, readiness/account metrics and generic tutorial cards were removed. Network and session each have one primary indicator. Successful ordinary reads no longer emit persistent "registry loaded" notices. A single footer describes KZT-Test. Errors, busy states, meaningful operation results and signer/network/receiver/amount review remain visible.

The dashboard fills the browser page: the brand header, session bar, workspace and footer form one continuous application shell. There is no centered 1440 px outer container, surrounding padding, window border, rounding or drop shadow. Flex layout fills the available viewport height instead of imposing a fixed 720 px workspace minimum. Individual task cards and tables retain their own spacing for readability.

## Navigation, lists and recovery

The existing section hash accepts an optional validated object UUID: `#actions?selected=<uuid>`. There is no second router. Desktop uses a sidebar stretched to the full workspace height, with sticky navigation inside it and Work/History/Settings groups; smaller layouts have a native expandable menu showing the current section. The continuous sidebar background avoids blank strips during scrolling. Escape closes the mobile menu. Navigation focuses the content; detail/list transitions keep filters and restore the list scroll position.

Sections mount on first visit and remain mounted. Each visited corporate-action detail also stays mounted when returning to its list or opening another action, keeping its exact plan, operation UUID, signature, review and child workflow state. Form fields remain mounted and are reset only by their existing success paths. Request errors leave values available and appear near forms and in a request notice.

Search, status and sort affect only loaded records; loaded/matching counts explain this scope. Pagination uses the existing cursor. Instrument/investor APIs have no individual GET by UUID: a bookmark restores a loaded record or explains how to return and load additional pages. Overview reads the latest 20 actions and displays up to six attention items. It does not claim a global count or exhaustive priority queue.

After a full reload, the selected action is read through its GET. Entitlement and coupon GET responses restore the original signer's saved pending UUID/status/wire/signature without POST or a wallet request. Other existing phases restore through preparing the same pending phase. A signed restored attempt permits confirmation only. Unsigned reviews, filters and unsent form drafts are not persisted across reload. A signature never received by the API cannot be restored from the server; retain its identifiers. The redesign stores no signed transactions in browser storage and never automatically resends them.

## Accurate states and failures

Planning follows the API action status or finalized scheduling evidence. Snapshot completion requires a FINALIZED snapshot. Calculation follows the stored calculation/review status. Registration requires FINALIZED CALCULATION_FINALIZE; chain approval requires FINALIZED ACTION_APPROVAL. Application APPROVED is labelled separately and does not mean on-chain approval or payment. Coupon execution requires an explicitly enabled capability; finalized payments and COUPON_FINALIZE proof complete its stages. Other execution remains unavailable. Amounts use the existing exact minor-unit formatter. After coupon approval the completed calculation folds away while payments remain primary. Zero burn columns are omitted for coupons.

PREPARED/SUBMITTED/UNKNOWN_CONFIRMATION attempts remain visible with their original UUID. Unknown signed results direct the operator to inspect proof and verify the original signature. The UI revision closes no expired attempts.

SESSION_REQUIRED/SESSION_INVALID preserve the workspace and offer message-signature login with the same wallet. Recovery does not replay requests. Transport failures report lost connection while retaining fields and plans. A successful request clears that notice; this proves that request succeeded, not every dependency or financial operation. Refresh controls perform existing GET reads. Busy, empty, no-match, request-error and permission states have separate copy. Readiness labels refer to the last page check.

## Accessibility and responsive behavior

Golos Text is loaded locally through `next/font/local`, including Cyrillic glyphs and real variable weights 400–900. Its font and SIL Open Font License are in `apps/web/app/fonts`; runtime rendering does not depend on Google Fonts or another external font service. Common tokens define page headings at 32 px (28 px on small screens), section headings at 22 px, body/table text at 15 px, secondary text at 14 px and captions/technical IDs at 13 px. Body/medium/emphasis use 400/500/600. Dates explicitly show the browser's resolved time zone, while date-only instrument dates use UTC; submission dates and six-decimal financial arithmetic remain unchanged.

The common system also defines spacing, 44 px controls, radii, semantic colors, reading/form widths, focus and motion. Controls have persistent labels and visible focus. The skip link focuses the workspace. Action tabs support arrows/Home/End, selected state and associated-panel labels. Native details retain keyboard disclosure. Control transitions take 150 ms; disclosures and panels use 200–240 ms opacity and at most 4 px movement. The reduced-motion media rule disables animations and transitions. No animated number changes or new animation dependency is used.

Primary object links replace duplicate last-column Open buttons. Numeric entitlement columns and headers align right. Required fields, cancellation without losing unsent input, nearby failure copy and loading placeholders are consistent. Full identifiers remain selectable and can be copied with explicit success/failure feedback. Signer, network, receiver and amount needed for signing stay in the visible review; raw program/genesis/PDA facts expand separately. A successful action creation followed by a failed list read opens the saved action and explicitly tells the operator to refresh without creating a duplicate.

Tables scroll within labelled, focusable regions rather than overflowing the document. Object names in the first column open details, making the main task reachable on mobile without scrolling to the final column. Long UUIDs/signatures/addresses wrap in review and evidence. Maintenance keeps the existing role, signer, capability and exact-byte checks.

The action stages form a compact horizontal strip with details only at the current stage. Its current stage is kept in view when the strip is resized or restored after navigation; this does not scroll the document. The header wraps status badges on small screens and payment actions stack below the receiver/amount.

## Verification and limits

```powershell
npm run test --workspace @lifecycle-kase/web
npm run typecheck --workspace @lifecycle-kase/web
npm run build:web
npm run validate
git diff --check
```

Tests cover loaded search, honest proof stages, bookmarks, caller cancellation and network/session failure without POST replay. The [earlier October 10 acceptance](../testing/operator-workspace-ui-2026-10-10.md) remains dated historical evidence. Current final-presentation screenshots, validation and manual boundaries are in [October 10 redesign verification](../testing/operator-workspace-redesign-2026-10-10.md). Localnet and KZT-Test remain simulated. UI evidence does not close the retained owner's pending FINALIZE attempt or replace finalized chain/database acceptance.

Global search/counts, server-side filtered pagination, direct individual instrument/investor reads and cross-device persistence of unsent reviews would require separate API/product work. This presentation pass neither adds those endpoints nor stores signing wire in browser storage.

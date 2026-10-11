# Walletless QA sandbox

Current registry publication — **2026-10-11**: API/web are Live at application commit `8ea7a42cc13b27c40fc4b3d2c4562a249a4fc02f`. The page-local model supports versioned eligibility review (`ELIGIBLE`, `NOT_ELIGIBLE`, `SUSPENDED`) and reversible verified-wallet blocking with fixed reasons, audit events and stale-version conflicts. All three CI jobs and **378 Node tests** passed; the published English registry transitions and read-only Auditor audit passed. [Registry acceptance](../testing/registry-governance-2026-10-11.md) and [deployment evidence](../deployment/render-staging.md) record the later checks; counts below refer to their earlier release.

Earlier publication — **2026-10-11, 17:08 Asia/Qyzylorda**: [public `/qa`](https://lifecyclekase-web.onrender.com/qa) returned **200** at application commit `1e6c96dd119f32cbf01cecef028723b9134ebe4b`. All three CI jobs passed; that repository check contained **350 Node tests**. Signed-out browser acceptance covered English selection, issuer/approver/Auditor switching, a complete simulated coupon workflow, read-only Auditor results and reset on reload with preserved language. [Deployment evidence and screenshots](../deployment/render-staging.md) distinguish QA from financial acceptance.

Initial validation checkpoint — **2026-10-11, before implementation/publication**: local [desktop/mobile UI checks](../testing/ui-ux-audit-2026-10-11.md), 330 tests and the production build passed; the public route returned **404**. That observation is historical. Native 200% zoom, screen readers, disk receipt downloads and real wallet/API/chain flows remain outside this browser acceptance.

The `/qa` page lets a tester exercise the operator interface without installing a wallet. It reuses the seven-section `OperatorWorkspace` and its existing forms with synthetic, browser-local data. This is an interactive UI sandbox: its payments, burns, signatures, snapshots and receipts are simulations.

Local and public implementation/browser validation are recorded above. The public `/dashboard` continues to require an authenticated operator wallet; Render's authentication configuration was preserved and public protected-route checks return `401 SESSION_REQUIRED`.

## Start and reset

Open [the published QA page](https://lifecyclekase-web.onrender.com/qa), or run `npm run dev:web` and open `http://localhost:3000/qa` locally. No API, database, RPC server or wallet extension is needed for this route.

The page starts with synthetic instruments, investors, holdings, actions, transaction history and audit events. It does not discover Wallet Standard wallets or create an API session. The request adapter answers the existing panels in memory instead of forwarding requests to `/api/v1` or Solana.

Changes belong to the current page instance. Navigation within the workspace retains them; reloading, opening a new tab or using reset starts a fresh fixture set. Reset only replaces sandbox memory. It never deletes database rows, resets a validator or changes the retained owner's state. Export the clearly marked QA state JSON before reset if it is needed with a report. Do not enter real personal or financial data.

## Roles and workflow

| QA identity | What to check |
| --- | --- |
| Issuer administrator | Create instrument/investor/action records; simulate instrument activation, schedule, snapshot, calculation, funding/reserve, payments and finalization |
| Separate approver administrator | Inspect the calculated action and simulate the distinct approver's approval after reserve |
| Auditor | Read all seven sections and inspect calculations, transaction history and audit without mutation controls |

Switching identities is a QA control. It demonstrates visible role and issuer boundaries; it is not authentication or proof of server authorization. The normal dashboard's wallet signing, exact transaction validation and server checks are unchanged.

Use the existing forms to create drafts and investor records, attach synthetic wallet addresses, change eligibility and revoke addresses. QA controls simulate wallet verification and the wallet-dependent phases. They do not produce valid signed Solana transactions or financial evidence. Unsupported operations report an error rather than falling through to the real API.

In an investor's detail card, review an existing decision or temporarily block/unblock a verified wallet. Choose a reason, inspect the full-address/decision/version confirmation and check the corresponding audit event. A blocked or suspended receiver stops the next simulated payment without consuming reserve, changing the captured snapshot or burning tokens. Restoring a wallet does not independently restore investor eligibility. Pending/unverified and terminally revoked wallets cannot be activated through temporary status controls. Auditor and QA approver identities cannot perform these registry mutations.

QA deliberately requires every positive holder to be eligible before simulated capture; the real snapshot path also retains ineligible holder evidence for supply reconciliation. QA advances time explicitly and does not reproduce the database capture lock or concurrent transaction timing. Those are covered by the isolated HTTP/PostgreSQL and snapshot tests.

For each coupon, partial-redemption and maturity-redemption action, exercise this sequence:

1. As issuer, create or open the action, schedule it, capture the synthetic snapshot and calculate entitlements.
2. Inspect holders, receiver choices, amounts and the action's stage. Use QA controls for the simulated registration/finalization stages.
3. As issuer, simulate funding and full reserve. Switch to the separate approver and approve; switch back to the issuer.
4. Simulate each of the three investor payments. Coupon has no burn; partial and maturity redemption also update the synthetic bond holdings/supply.
5. Finalize only after all required payments. Inspect the resulting simulated receipt, transaction history and audit.

Use the partial-redemption flow before maturity when checking the remaining supply. The fixtures use the prototype's 10/20/5 holder distribution. A simulated result is never a replacement for the real disposable Localnet [three-action acceptance](../testing/kase-three-actions-2026-10-10.md).

## QA checklist

Record the browser/version, viewport, build revision, selected QA identity and steps for every finding. Start a fresh fixture set before a separate test case when previous mutations could affect it.

| Area | Checks |
| --- | --- |
| Overview | Initial tasks, next-step text, action links and changes after a completed stage |
| Corporate actions | List/search/status/sort, create all three action types, validate dates and partial terms, detail tabs, stage progression, cancellation where available and receipts |
| Instruments | List/search/detail, draft creation, required fields, simulated activation, issuer-only controls and supply after redemption |
| Investors | Create/read, duplicate and invalid inputs, attach/verify synthetic wallets, eligibility changes and reasons, revocation and reasons, receiver choices |
| Transactions | Search/status/sort, action links, synthetic identifiers and clear simulation labels; no real transaction submission |
| Audit | Event order, actor identity after role switches, object links, metadata and events after mutations |
| System | QA explanation, role switch, reset/export controls and clear distinction from wallet login and chain maintenance |
| Roles | Issuer versus separate approver, Auditor read-only state, unavailable controls, explanatory errors and preserved state when switching |
| Errors | Invalid/empty form values, duplicate records, unavailable prerequisites, wrong role and out-of-order stages; no unintended mutation after failure |
| Navigation | Seven sections, list/detail return, selected-object hash, retained unsent fields and filters, keyboard focus and no accidental resubmission |
| Desktop/mobile | At least 1440 px and 390 px widths, mobile section menu, table scrolling, long IDs, form errors, stage strip, keyboard navigation and reduced motion |
| Isolation | In browser Network, no `/api/v1` or RPC requests and no wallet prompts; refresh/reset restores fixtures; export is marked as QA simulation |

The browser still fetches the web page and its static assets. The isolation check concerns application API/RPC calls, not normal page loading.

## Findings report

Include both successful checks and problems. A positive finding should name the tested scenario rather than simply saying that the interface works.

```text
LifecycleKASE QA report
Build/revision:
Browser/OS and viewport:
Route: /qa
Checked roles and scenarios:

Strengths: concrete tested behavior and why it is useful.
Problems: severity, section/role, exact steps, expected result, actual result.
Evidence: screenshot/video and exported QA JSON when relevant.
Recommendations: proposed change, user impact and priority.
Not checked: real API, authentication, wallet, database, Solana and other exclusions.
```

Never describe sandbox results as passed API/security or on-chain tests. Report a limitation separately from a reproducible UI defect.

## Configuration, validation and limits

The sandbox has no credential or authentication-disable setting. A public link grants access only to synthetic page-local data. Normal `/dashboard` requests still use the protected API and its existing origin, role and signature controls. The sandbox does not seed or write PostgreSQL and does not enable Render chain execution flags.

Run the web tests, type checking and production build, then check the browser workflow and Network isolation on desktop/mobile:

```powershell
npm run test --workspace @lifecycle-kase/web
npm run typecheck --workspace @lifecycle-kase/web
npm run build:web
npm run validate
git diff --check
```

Test/exported fixtures do not prove database persistence, concurrent writes, real authentication/authorization, session expiry, rate limits, proxy behavior, network recovery, Phantom interactions, signed-wire safety, historical holder capture, finalized Solana transactions or settlement. Those require the protected dashboard and the documented API/database/Localnet acceptance environments. Program upgrade and real financial execution remain outside this walletless QA route.

See [ADR-026](../decisions/ADR-026-walletless-qa-sandbox.md) for the isolation decision.

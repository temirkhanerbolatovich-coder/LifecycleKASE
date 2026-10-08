# Project audit — 2026-10-09

This audit separates four kinds of evidence: the current source tree, disposable test environments, the retained owner Localnet/PostgreSQL checkpoint, and the published GitHub/Render revision. A pass in one environment is not proof for another.

## Executive status

LifecycleKASE is a working Localnet pilot foundation, not a complete corporate-action MVP and not a production financial system. The repository implements authenticated operator workflows, Investor Registry controls, four-phase instrument issuance, corporate-action scheduling and snapshot registration, stored entitlement calculation/review, guarded simulated KZT-Test funding, and a feature-flagged on-chain entitlement registration workflow. The decisive settlement path is still incomplete: no owner-program entitlement upgrade, action approval authority, funded action reserve, investor payout, redemption burn, execution receipt, or full reconciliation has been accepted on the retained owner environment.

The current release candidate passed the complete JavaScript/TypeScript check, production build, Rust checks, isolated PostgreSQL tests, and a disposable old-to-new program upgrade with retained-account compatibility. The owner ledger and database were restarted without reset and read back successfully. No owner transaction, program upgrade, funding, approval, or payout was submitted during this audit.

## Evidence boundaries

| Boundary | What was verified | What it does not prove |
| --- | --- | --- |
| Current source tree | Tests, type checks, schema validation, builds, dependency audit, documentation checks | Published GitHub/Render state or owner-wallet acceptance |
| Disposable PostgreSQL/validator | Real migrations, HTTP flows, Token-2022 operations, program upgrade and exact finalized read-back | Retained owner state or production readiness |
| Owner Localnet/PostgreSQL | Current genesis, program binary, instrument/action/snapshot/calculation/funding state | Public Devnet, Render-chain integration, payment completion |
| GitHub/Render before this publication | `master`/services remained at `112bdb14edd04fd0a76f153e627e14ebb857b850`; CI run `36985707987` was successful; public health/readiness/dashboard returned HTTP 200 | The uncommitted release candidate, exact current Render SHA, authenticated wallet flows, or owner Localnet state |

## Current owner checkpoint

Read back on 2026-10-09 from the preserved owner ledger and database:

- genesis: `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF`;
- retained program: `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo`;
- deployed binary: 290136 bytes, SHA-256 `cd502cfd217036548700c334b472b544ee7275ef1585870e4268bb34492e049b`;
- LKA26R1: `ACTIVE`, supply/circulation 35, three holders with balances 10/20/5;
- coupon action `464a832a-2c55-4e22-bb7a-6be93b429c78`: application `UNDER_REVIEW`, version 6; chain Action PDA `SNAPSHOT_CREATED`;
- snapshot hash: `799e44c7a9593bea19c0364cc42fa86d690b6ef6bba49f7d5f877d15dff9b76a`, effective slot 44222;
- stored entitlements: 500/1000/250 KZT-Test, total 1750000000 minor units; no on-chain entitlement PDA recorded;
- treasury: 0; deficit: 1750000000; `budgetReady=false`;
- coupon funding: `PREPARED`, signature absent;
- all 18 migrations are applied and no migration is pending.

The retained RPC has pruned the old SCHEDULE transaction, so its exact bytes could not be re-read in this audit. The current Action PDA state and snapshot transaction remain available and consistent. Earlier dated acceptance records preserve the exact SCHEDULE evidence; it is historical evidence rather than a fresh 2026-10-09 re-verification.

## What works

1. **Operator boundary.** Domain/origin-bound wallet login, roles, session protection, rate limiting, exact operation ownership, and audited prepare/submit/confirm routes are implemented. Authentication remains configuration controlled.
2. **Investor Registry.** Administrator creation and wallet ownership/eligibility/revocation flows, Auditor read access, snapshot locking, audit immutability, and database concurrency/rollback guards pass isolated real-PostgreSQL tests.
3. **Instrument issuance.** `MINT_SETUP`, 10/20/5 `DISTRIBUTION`, `INITIALIZE`, and `ACTIVATE` passed owner Phantom/Localnet acceptance for LKA26R1. The retained instrument is ACTIVE with 35/35 supply and zero treasury bond balance.
4. **Corporate actions and snapshot.** DRAFT, SCHEDULE/CANCEL, finalized snapshot commitment, recovery, canonical aggregation, and database projection are implemented. The retained coupon has a verified `SNAPSHOT_CREATED` PDA and three captured holders totalling 35.
5. **Calculation and review.** Checked TypeScript/Rust financial formulas, persisted entitlements, versioned submit/approve/reject/revision application workflow, and audit exist. The owner coupon is intentionally still `UNDER_REVIEW`.
6. **Coupon funding preparation.** Localnet-only simulated KZT-Test budget/deficit preparation, exact Token-2022 plan, saved-attempt recovery, finalized balance proof, and audit pass disposable real-validator/HTTP/PostgreSQL acceptance. The owner plan remains unsigned.
7. **On-chain entitlement candidate.** REGISTER, RESET, and FINALIZE builders, program instructions, API/UI workflow, exact-wire recovery, and fail-closed feature flag are implemented. A disposable loader upgrade preserved an existing Action PDA byte-for-byte and the full post-upgrade suite passed.
8. **Monitoring.** The independent Telegram watchdog supports published service health, owner identity/progress, read-only aggregate checks, hourly summaries, and incident/recovery state. Initial delivery was owner-confirmed; automatic startup is not installed.

## What remains incomplete

### Priority 0 — safe owner integration

- Define and review a Phantom-compatible signing path for upgrading the retained owner program without exporting the wallet key.
- Re-check the exact owner program/buffer/authority transaction set immediately before signing.
- Upgrade only after explicit owner review; verify finalized loader state, deployed binary hash, authority, and unchanged existing PDAs.
- Enable the on-chain entitlement feature only after the upgraded owner program is independently confirmed.
- Run owner REGISTER 500/1000/250, RESET recovery if deliberately tested, re-registration, and FINALIZE with exact finalized chain/database/audit reconciliation.

### Priority 1 — governed settlement

- Add a separate approver authority and an action-specific reserve instead of treating application `APPROVED` or issuer treasury balance as payout authorization.
- Complete owner review/approval of the stored calculation.
- Complete the deferred 1750 KZT-Test owner funding signature as a distinct operation; funding is not payment.
- Implement atomic coupon payment, replay protection, eligibility/budget checks, per-entitlement/action receipts, finalized token balance read-back, and atomic database/audit projection.
- Add reconciliation that can prove planned, submitted, finalized, failed, and recovered outcomes without blind resend.

### Priority 2 — redemption and operational acceptance

- Implement early/maturity redemption asset burn and cash leg with failure-safe ordering and receipts.
- Complete remaining wrong-network/wrong-signer/cancel/lost-response/reload manual scenarios and Auditor presentation acceptance.
- Add missed-window handling and documented operator recovery.
- Add supervised monitoring only if the owner explicitly chooses automatic startup; expand RPC/database/operation metrics.

### Priority 3 — public network and production gates

- Repeat the accepted flows on public Devnet after local MVP approval, including program deployment identity and real wallet evidence.
- Replace disposable Render PostgreSQL with durable managed storage, backups, restore drills, a separate migration gate, capacity/availability monitoring, and a security review.
- Define custody, governance, KYC/AML, cash settlement, legal, KASE/CSD, and operational support boundaries before any real asset or mainnet claim.

## Validation performed

- `npm run check`: passed 238 tests (API 95, web 33, domain 27, Solana client 39, root 44), Prisma validation, type checks, and documentation validation. The final documentation pass covered 58 Markdown files.
- `npm run build`: passed with Next.js 16.4.0 after a sequential rerun avoided a concurrent build-lock collision.
- `npm run test:web:proxy`: passed.
- `docker compose config --quiet`: passed.
- Isolated PostgreSQL tests: API database, registry database, and corporate-action database suites passed against disposable databases.
- Owner database: 18 migrations applied, none pending. The generic fresh-database fixture is not valid against the populated owner database; its duplicate-fixture failure rolled back without changing owner data.
- Rust: formatting, 12 localnet tests, 12 devnet tests, and Clippy with warnings denied passed.
- Disposable validator upgrade: retained program operations, existing-PDA byte compatibility, candidate upgrade, entitlement reset/re-registration/finalization, authority/replay guards, and incomplete 34/35 coverage rejection passed.
- Root production dependency audit: zero vulnerabilities after Next.js 16.4.0. The isolated test-only legacy Solana integration graph still reports 12 advisories (5 high, 7 moderate); an incompatible forced upgrade was not applied.
- Secret review found no committed private keys, wallet seeds, tokens, or production credentials. Local monitor configuration, backups, generated artifacts, and ledgers remain ignored.

## Publication result

At the start of this audit, GitHub and Render still represented `112bdb1`. The application release was published as `800f3e1`; GitHub Actions run `37835633211` passed. The first web rollout exposed a clean-checkout dependency-order defect, so the Render web build command was corrected in `adc0cff` to build the domain and Solana client workspaces before Next.js. GitHub Actions run `37836924302` passed for that correction.

Render API deploy `dep-db3vfn7f3r2c73do5vv0` and web deploy `dep-db3vfhqd0e5s73f8kjr0` are Live on `adc0cff1d04341fbd96b76a67c7785a6439cf040`. API logs report 18 migrations and successful application of the two corporate-action/funding migrations. Public API readiness, web liveness and dashboard return HTTP 200; the newly published entitlement route returns the expected HTTP 401 `SESSION_REQUIRED` without an operator session instead of the old 404. This proves the revision, route wiring and disabled unauthenticated access. It does not prove an authenticated staging wallet flow or any owner Localnet financial operation.

## Next concrete action

After repository publication and rollout verification, prepare a reviewable Phantom-compatible owner-program upgrade procedure. Do not combine it with funding, approval, or payment. The first owner-chain acceptance after the upgrade should be entitlement REGISTER/FINALIZE with exact transaction, account, database, and audit reconciliation.

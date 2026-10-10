# Project audit — 2026-10-09

Historical audit and continuation record. Current status, fresh validation and next priorities are in the [2026-10-10 full audit](PROJECT_AUDIT_2026-10-10.md). Earlier counts, pending states and publication results below retain their original dates.

Subsequent feature continuation implements [separate approver and action reserve](features/action-approval-and-reserve.md) in a new isolated Localnet candidate: immutable authority distinct from issuer/CA, full action vault custody, pre-approval refund, RESERVED/APPROVED chain states and finalized atomic application/audit projection. [Acceptance](testing/action-approval-reserve-2026-10-09.md) separates source/fixture/browser/real-chain evidence. The retained owner artifact/manifest and UNKNOWN_CONFIRMATION FINALIZE remain unchanged; owner rollout, coupon payout/receipt and redemptions stay open. Earlier audit checkpoints below retain their historical scope.

Latest owner continuation: [partial entitlement acceptance](testing/owner-entitlements-2026-10-09.md) confirms partial REGISTER → RESET → all three REGISTER through Phantom, exact finalized wires, canonical PDAs and database/audit projection. The Action PDA is CALCULATED with three rows/1750 KZT-Test and processed=0. FINALIZE `436213b5…` expired without landing in its entire 151-block lifetime; the owner chose to retain UNKNOWN_CONFIRMATION for checking. The audit persistence defect was fixed without a migration; API build, five focused tests and the generated PostgreSQL action suite passed. Full owner finalization, funding and settlement remain open.

Later continuation implements the [missed-snapshot orchestration check](testing/snapshot-window-2026-10-09.md). It verifies finalized Clock expiry and an unchanged scheduled PDA before atomically recording application `SNAPSHOT_MISSED` and audit; stored captures/active attempts are preserved. The 264-test source check and real HTTP/PostgreSQL acceptance with controlled RPC fixtures passed. Read-only owner checks retain the upgraded candidate and original coupon/funding checkpoint. This closes one recovery subitem without closing owner REGISTER/RESET/FINALIZE or financial settlement. Earlier dated audit observations below remain historical.

This audit separates four kinds of evidence: the current source tree, disposable test environments, the retained owner Localnet/PostgreSQL checkpoint, and the published GitHub/Render revision. A pass in one environment is not proof for another.

## Executive status

LifecycleKASE is a working Localnet pilot foundation, not a complete corporate-action MVP and not a production financial system. The repository implements authenticated operator workflows, Investor Registry controls, four-phase instrument issuance, corporate-action scheduling and snapshot registration, stored entitlement calculation/review, guarded simulated KZT-Test funding, and feature-flagged on-chain entitlement and isolated approval/reserve workflows. The retained owner program upgrade, RESET and three entitlement registrations are finalized and verified. The decisive settlement path is still incomplete: owner calculation FINALIZE, owner installation/acceptance of the approval/reserve candidate, investor payout, redemption burn, execution receipt, and full reconciliation remain open.

The current release candidate passed the complete JavaScript/TypeScript check, production build, Rust checks, isolated PostgreSQL tests, and a disposable old-to-new program upgrade with retained-account compatibility. The owner ledger and database were restarted without reset and read back successfully. Later owner continuation finalized the separate EXTEND/UPGRADE transactions and verified retained state. No owner funding, approval or payout was submitted.

## Evidence boundaries

| Boundary | What was verified | What it does not prove |
| --- | --- | --- |
| Current source tree | Tests, type checks, schema validation, builds, dependency audit, documentation checks | Published GitHub/Render state or owner-wallet acceptance |
| Disposable PostgreSQL/validator | Real migrations, HTTP flows, Token-2022 operations, program upgrade and exact finalized read-back | Retained owner state or production readiness |
| Owner Localnet/PostgreSQL | Current genesis, program binary, instrument/action/snapshot/calculation/funding state | Public Devnet, Render-chain integration, payment completion |
| GitHub/Render before this publication | `master`/services remained at `112bdb14edd04fd0a76f153e627e14ebb857b850`; CI run `36985707987` was successful; public health/readiness/dashboard returned HTTP 200 | The uncommitted release candidate, exact current Render SHA, authenticated wallet flows, or owner Localnet state |

## Current owner checkpoint

The latest preserved checkpoint is recorded in [owner entitlement acceptance](testing/owner-entitlements-2026-10-09.md): at slot 132863 the upgraded candidate's Action PDA is CALCULATED, registered=3, total=1750000000 and processed=0; all three READY/unexecuted entitlement PDAs match application UNDER_REVIEW version 6. Snapshot commitment is unchanged. FINALIZE remains UNKNOWN_CONFIRMATION at the owner's request. At slot 133014, ACTIVE bond supply 35, settlement supply/treasury 0 and unsigned funding were independently checked; 19 migrations are applied. The candidate hash/authority was reverified at slot 132497. No owner payment/burn occurred.

### Initial checkpoint before owner upgrade

The following earlier read-back on 2026-10-09 is preserved as historical evidence:

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

- Accept the isolated separate approver/action reserve candidate on the preserved owner environment after governed upgrade and held FINALIZE resolution; application `APPROVED` or issuer treasury balance alone cannot authorize payout.
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

Follow-up: a bounded [quick delivery batch](testing/quick-wins-2026-10-09.md) completed current data-flow/security/testing documentation, a full-history secret CI gate, Devnet Clippy and a clean standalone web-build gate. The 238-test check, proxy, production audit, clean build and new Clippy/scanner checks passed locally. This advances engineering subitems; the financial priorities below remain pending.

Subsequent preparation: the [owner upgrade package](deployment/owner-localnet-program-upgrade.md) now includes a pinned manifest, read-only preflight and separate exact-v0 EXTEND/UPGRADE builders; [ADR-021](decisions/ADR-021-phantom-localnet-program-upgrade.md) records the actual validator's two-phase requirement. The current local check passes 244 tests, production builds and a zero-vulnerability root production audit. Fresh owner read-back still matches retained code, UNDER_REVIEW database calculation, SNAPSHOT_CREATED PDA with zero entitlement counters and unsigned PREPARED funding. The earlier SCHEDULE/REGISTER_SNAPSHOT transaction bytes have been pruned from the owner RPC; previous acceptance remains historical evidence.

Subsequent integration implements the [restricted maintenance API/dashboard](features/program-upgrade-maintenance.md), durable phase attempts/audit, exact loader-message parsing, expiry/reload recovery and a PostgreSQL business-write lock spanning both signatures. The production service passed disposable-validator/PostgreSQL EXTEND/UPGRADE, concurrent submit, lost-response, audit rollback and preserved-Action-PDA acceptance. The owner migration and capability remain unapplied/disabled. GitHub master was re-read at `27af655`; these local changes are not publication or Render evidence.

Owner continuation later on 2026-10-09 retained a fresh readable database dump, applied migration 19 to the preserved acceptance database and staged the exact candidate in buffer `HLxhbJC8W6acMXxf7Ghs1Gg9stdTSmbAitQjW7wbWSqW` under the owner Phantom authority. Strict finalized preflight at slot 102338 selected EXTEND. The retained program bytes, LKA26R1 accounts, UNDER_REVIEW calculation and unsigned funding attempt were unchanged; no maintenance row or owner-signed loader transaction existed. Authenticated Chrome/Phantom EXTEND/UPGRADE and subsequent REGISTER/RESET/FINALIZE remain open. The earlier unapplied/disabled statement above is retained as a dated integration checkpoint.

Fresh owner read-back at finalized slots 99303/99578 still shows the retained code/authority, ACTIVE circulation 35, UNDER_REVIEW coupon version 6/total 1750000000, no entitlement PDAs, zero treasury and PREPARED funding with no signature. The owner database has 18 applied migrations; the new maintenance migration has only been applied in generated test databases.

Next review buffer staging, maintenance migration/enablement and separate owner Phantom signatures. Then accept REGISTER/RESET/FINALIZE with exact transaction/account/database/audit reconciliation. Funding, approval and payment stay separate. Browser owner-wallet acceptance is not closed by tests.

Integration validation completed: 252 repository tests, schema/type checks, API/web production builds, documentation checks, zero root production dependency advisories, publishable-source Gitleaks, generated PostgreSQL negative/recovery checks and the full disposable retained-to-candidate compatibility harness. See [integration evidence and limits](features/program-upgrade-maintenance.md). The earlier 238/244-test and GitHub/Render observations remain dated history; no new deployment acceptance is claimed.

The first owner browser preparation found an over-broad maintenance guard: an older DRAFT LKA26 `INSTRUMENT_MINT_SETUP` remained `UNKNOWN_CONFIRMATION/TRANSACTION_UNAVAILABLE` even though the same-genesis RPC no longer had the signature and its blockhash had expired. A bounded, fail-closed recheck now permits only that proven cannot-land case while retaining its historical row; live, malformed, cross-genesis or otherwise ambiguous signed attempts still block maintenance. The rejected request created no maintenance or loader transaction. After the correction, the full repository check passed 253 tests (API 101, web 36, domain 27, client 42, root 47), schema/type checks and documentation validation; live read-only owner recheck allowed maintenance preparation with zero maintenance/loader rows still present.

Owner Phantom then finalized EXTEND at slot 105978 and UPGRADE at slot 106314. Finalized read-back matched candidate hash `62562a42…6ca05d`, retained the ProgramData pointer, authority and protected-account digest, consumed the buffer and marked maintenance VERIFIED. At slot 107691, LKA26R1 remained ACTIVE 35/35 and the existing Action PDA remained SNAPSHOT_CREATED with its original snapshot hash and zero entitlement counters. PostgreSQL remained UNDER_REVIEW version 6 with three CALCULATED rows totalling 1750000000 and no entitlement PDAs; funding remained PREPARED without a signature. Owner REGISTER/RESET/FINALIZE is now the next gate.

# Delivery checkpoint — 2026-10-07

This continues the dated [full audit](../PROJECT_AUDIT_2026-10-07.md). It records changes after that audit; its earlier observations are retained as history. The owner's development attachment and audit steps are combined in [the delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).

## Stage 1: recovery and funding UI

- Updated the root lockfile's transitive source-map-js from 1.2.1 to patched 1.2.2; clean install and Prisma generation completed. `npm audit --omit=dev` reports zero vulnerabilities. The isolated legacy Solana integration dependencies still have 12 findings (5 high/7 moderate); no forced incompatible upgrade was applied.
- Fixed stale unsigned funding preparation, fresh budget/version lookup, review reset for changed financial/network facts and FINALIZED signature reload. Signed/UNKNOWN attempts remain confirmation-only. Five behavioral regressions were added. Actual Phantom acceptance of the new recovery cases is still pending.
- Restarted the existing PostgreSQL container/volume and existing owner ledger without reset, issuance, snapshot recapture or program upgrade. Readiness/dashboard return 200; protected session remains 401 without login.
- Created a stopped 28 GB ledger copy `ledger-stopped-backup-20261007-stage1` beside the existing ledger. All regular files match; the copied `admin.rpc` Unix socket is a runtime object, not persisted transaction data. The restored copy has not been independently booted. Original-ledger startup/read-back passed.
- Created ignored `.local-stage1-owner-backup.dump`, SHA-256 `2B117D693557C9595445E9368042CDA86766FF6E1D6416573C634126E02BD051`. Restored it into a disposable PostgreSQL 17 container and checked 18 migrations plus the owner instrument/action state. The test container was removed; the original owner volume remains running. `.local-*` files are ignored to prevent committing owner backups and local launch helpers.

Preserved owner checkpoint:

| Fact | Observed |
| --- | --- |
| Genesis | `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF` |
| Program | `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` (retained binary) |
| Instrument | LKA26R1 ACTIVE, supply 35, holders 10/20/5 |
| Coupon action | `464a832a-2c55-4e22-bb7a-6be93b429c78`, application UNDER_REVIEW, version 6 |
| Snapshot | `799e44c7a9593bea19c0364cc42fa86d690b6ef6bba49f7d5f877d15dff9b76a`; original SCHEDULE/REGISTER_SNAPSHOT exact finalized messages verified |
| Calculations | 500/1000/250 KZT-Test, total 1750000000 minor units |
| Treasury | 0; deficit 1750000000; budgetReady=false |
| Funding | Old expired unsigned attempt `8d955803…` failed BLOCKHASH_EXPIRED through the existing recovery path; new `84805071-7904-4f84-a923-82d74490c407` PREPARED, signature null |

The controlled Localnet CLI prepared the fresh deficit using the original authenticated snapshot preparation/audit and current issuer/genesis guards. It did not sign, broadcast, approve or pay. The owner explicitly deferred the Phantom signature (“Выполню позже”). An unsigned plan may expire; its safe replacement does not repeat a payment or mint.

At the 22:47 UTC+5 read-back, finalized slot was 65040, chain block time 1791000523, wall time 1791395235. This retained ledger's clock lags roughly 4.6 days. Existing coupon execution time has passed, but new wall-clock record windows cannot be accepted on this ledger now. Use a separate reproducible accelerated demo for new scenarios; do not reset/warp the owner ledger or change financial dates to conceal the drift. Physical Windows C: free space was about 14 GB after the backup; avoid another full ledger clone without checking capacity.

Stage 1 commands passed: `npm ci --ignore-scripts`, `npm run prisma:generate`, `npm run check` (202 tests then), `npm run build`, `npm run test:web:proxy` (30 production transport routes), root dependency audit, isolated dump restore, original-ledger finalized exact-message/budget read-back. This does not prove owner funding, approval or payment.

## Stage 2: on-chain calculation candidate

Added `register_entitlement` / `finalize_calculation`, immutable investor PDA creation, checked integer formula enforcement, CA authority, duplicate/count/aggregate checks and CALCULATED → UNDER_REVIEW status. Added deterministic production client builders/decoder statuses, three Rust tests and five client tests. Added a candidate build/test profile that preserves the accepted SBF/IDL artifacts. The Devnet IDL gate now refuses older five-instruction artifacts for the updated source.

Artifact: ignored `generated/localnet-candidate/lifecycle_kase.so`, SHA-256 `90d1004a5abbdd1e15e473466743cb8bfbb6a741c6de745464f8683f7f5bdba0`. SBF/IDL build passed under the non-root WSL account. This is a Localnet artifact, not a deployed upgrade or public Devnet artifact.

Checks passed: `npm run check` (207 JavaScript/TypeScript tests), 12 Rust tests for each localnet/devnet host profile, Clippy `-D warnings` for both, Rust formatting, candidate SBF/IDL build. The disposable-validator candidate suite passed all 35 groups with zero skips using real signed v0 transactions and exact finalized read-back. It includes previous issuance/action/snapshot guards plus new registration/calculation cases. Candidate runtime did not run the optional HTTP/PostgreSQL branch; its earlier acceptance remains separate evidence.

The final full `npm run build` also passed. The owned web server was restarted from that build; local dashboard and API readiness returned 200. Documentation links/fences (54 files), changed-file whitespace, JavaScript integration syntax and both shell script syntax checks passed. No new dependency or schema migration was added for the candidate.

At this dated Stage 2 checkpoint no registration API/dashboard workflow, program upgrade, on-chain approval, reserve, payment, burn, execution receipt or reconciliation had been added. The later Stage 3 entry below records the API/dashboard addition without rewriting this historical boundary. The owner Action PDA remains SNAPSHOT_CREATED and its funding remains unsigned. See [feature](../features/on-chain-entitlement-registration.md) and [ADR-019](../decisions/ADR-019-on-chain-calculation-registration.md) for the trusted snapshot-certification boundary and immutable calculation recovery limitation.

## Stage 3: guarded registration API and dashboard — 2026-10-08

Added authenticated Localnet prepare/submit/confirm for individual entitlement registration and full calculation finalization. Preparation reconstructs the canonical finalized snapshot and stored UNDER_REVIEW calculations, checks corporate action authority, program/genesis, Action PDA counters and database-confirmed PDA totals, then persists exact unsigned v0 bytes and audit without changing application state. Confirmation accepts the original signature only, verifies the finalized message and exact Entitlement/Action PDA contents, and atomically records the PDA, operation and audit. Application approval is gated on finalized CALCULATION_FINALIZE only while the feature is enabled.

The dashboard verifies action/version, authority/signer, snapshot, amounts/counts/totals, PDA identities and exact fee payer before Phantom. It registers one row at a time, exposes finalization only after all rows have confirmed PDAs, restores saved signatures for confirmation and never performs automatic replay. `ONCHAIN_ENTITLEMENT_REGISTRATION_ENABLED` defaults to false and malformed values fail closed.

Checks passed in this stage: 93 API tests, 32 web tests, 38 Solana-client tests, API build and production web build. The tests cover fail-closed configuration, authority/version/counter guards, exact persisted facts, client-side changed-fact rejection and finalization availability. The previously recorded 35-group disposable-validator candidate acceptance remains the runtime proof for the program instructions. No owner program upgrade, owner registration, funding signature, approval, reserve, payment, burn or execution receipt was performed.

## Stage 4: partial-calculation recovery candidate — 2026-10-08

Added `reset_calculation` before UNDER_REVIEW. It accepts only the complete unique canonical PDA set represented by the Action counters, verifies authority, ownership, snapshot, unexecuted statuses and exact payment aggregate, closes every supplied Entitlement PDA to the corporate action authority, zeros calculation counters and returns the Action PDA to SNAPSHOT_CREATED. It cannot selectively delete a row, change the snapshot, run after finalization or replay. The existing CorporateAction layout is unchanged from the retained owner source; new status variants remain appended, so existing owner Instrument/Action accounts require no realloc or data migration.

API/UI RESET uses the same exact-wire prepare/submit/confirm boundary. Preparation requires database-confirmed canonical PDAs and chain/database partial counter agreement. REGISTER is blocked by active RESET/FINALIZE; RESET/FINALIZE are blocked by any unresolved calculation operation. Confirmation requires the exact finalized message, cleared Action counters, closed PDA accounts and an atomic database/audit projection. Missing on-chain registration evidence still fails closed and requires explicit reindex/reconciliation rather than guessing an investor mapping.

Built a new ignored artifact without replacing the prior candidate: `generated/localnet-candidate-reset-20261008/lifecycle_kase.so`, SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`. The real disposable-validator suite passed the retained issuance/action/snapshot guards plus partial register → reset/closed PDA → exact re-registration, incomplete reset rejection, 500/1000/250 finalization, replay/foreign/wrong-authority rejection and 34/35 coverage rejection. Owner program, ledger, database and funding were not changed.

The upgrade path itself was then tested on a second disposable run. The validator started the retained 290136-byte binary (`cd502…49b`), created ACTIVE/snapshot state, upgraded the same program ID to the 344640-byte recovery candidate (`62562…05d`), and preserved the existing SNAPSHOT_CREATED Action PDA byte-for-byte. The complete post-upgrade retained and entitlement/reset/finalization suite passed. See the [reviewable owner package](../deployment/owner-localnet-program-upgrade.md). This proves the loader transition in isolation; no owner transaction was submitted.

After the disposable run, an independent owner read-back still reported genesis `B8qep…NqhF`, finalized slot 76348, exact historical SCHEDULE/REGISTER_SNAPSHOT messages, treasury 0, deficit 1750000000, and funding PREPARED with no signature. API liveness/readiness, web liveness, and dashboard each returned HTTP 200. The deployed owner binary remains the retained `cd502…49b` artifact.

## GitHub and Render

Fresh GitHub API checks still report master `112bdb14edd04fd0a76f153e627e14ebb857b850`; latest Actions run `36985707987` is success on that SHA. Public Render API readiness and web dashboard return HTTP 200. Current local fixes/candidate are unpublished; these checks do not prove deployed SHA or local-chain financial acceptance. No deploy/push was performed in this checkpoint.

Rechecked on 2026-10-08: remote `master` is still `112bdb14edd04fd0a76f153e627e14ebb857b850`, and GitHub still reports run `36985707987` as the latest completed successful run. Render web liveness, API readiness and dashboard returned HTTP 200. Stage 3 remains local and unpublished; public health cannot prove the new routes, deployed revision or owner-chain acceptance.

## Next concrete stage

Review the completed owner upgrade package and choose a Phantom-compatible signing procedure without exporting the wallet key. Do not submit the upgrade until that procedure and the exact transaction set are reviewable and explicitly approved. In parallel, implement separate approver authority and an action-specific funded reserve before coupon execution. Retain owner funding as a separate pending signature. Coupon execution must add atomic transfer plus execution record, replay protection, current eligibility/budget checks and exact finalized DB/audit projection before any owner payout.

## 2026-10-09 audit continuation

The [current full audit](../PROJECT_AUDIT_2026-10-09.md) supersedes present-tense status without erasing this stage history. Next.js was updated to 16.4.0; the root production dependency audit is zero. The current source passes 238 JavaScript/TypeScript tests, production builds, isolated PostgreSQL tests, both Rust profiles, and a fresh disposable retained-to-candidate upgrade run with existing Action PDA byte compatibility. The owner environment was restarted without reset and still reports LKA26R1 ACTIVE, the coupon UNDER_REVIEW/SNAPSHOT_CREATED, treasury zero, and funding PREPARED without a signature. The deployed owner program remains the retained `cd502…49b` binary; no owner upgrade, entitlement registration/finalization, funding, approval, or payment was performed.

The old ACTION_SCHEDULE transaction is no longer available from the pruned retained RPC, so its exact bytes were not reverified on 2026-10-09. The current Action PDA and snapshot transaction remain consistent; the earlier exact-message result above stays dated historical evidence.

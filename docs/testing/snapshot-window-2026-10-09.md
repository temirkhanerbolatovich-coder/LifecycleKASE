# Snapshot-window continuation — 2026-10-09

This slice implements PRODUCT_REQUIREMENTS §9.1 and the database orchestration boundary in TECHNICAL_REQUIREMENTS §8/9.4. It uses the existing `SNAPSHOT_MISSED` enum and state transition; it adds no program instruction, database migration, dependency or scheduled worker. Requirements are unchanged.

## Delivered behavior

- Issuer/Administrator `snapshot/check-window` POST with expected action version; no mutations on list/detail/page load or Auditor reads.
- Separate not-started, open, finalized-time waiting, recovery-required and missed classifications.
- Automatic guarded classification when an uncaptured snapshot preparation is too late; distinct future-record-date error.
- Strict finalized Clock sysvar expiry beyond the program's inclusive 300-second boundary, pinned network/program and unchanged scheduled Action PDA at or after that slot.
- Serializable action/instrument/version checks, exclusion of stored snapshots and active attempts, atomic terminal status/version/audit and replay without duplicate events.
- Dashboard check button, terminal explanation, preserved transaction/audit history and instruction to create a future action.

The design extends the existing source-of-truth and orchestration model. A dedicated ADR is not required: the application status is already specified, and Solana remains authoritative for chain state. Full behavior and recovery limits are in the [feature document](../features/corporate-actions.md#missed-snapshot-window).

## Validation and boundaries

- `npm run check`: 264 tests (API 110, web 38, domain 27, Solana client 42, root 47), schema/type/documentation checks passed.
- Focused API and web tests passed. Cases include inclusive boundaries, shorter API grace/fast server clock, malformed/stale Clock metadata, changed/captured Action PDA, network/signer/version failure, recovery and atomic audit rollback.
- `npm run build` passed for all production workspaces. `npm run test:web:proxy` passed including the new check-window route; the normal build was restored afterward. Markdown links/fences passed for 67 files and `git diff --check` passed.
- `ACTION_TEST_DATABASE_URL` pointed to the loopback base database on port 55433; `node scripts/test-corporate-actions.mjs` created/migrated/dropped its unique `actions_test_*` database. Real HTTP/PostgreSQL checks with a controlled RPC fixture passed for authentication, roles, Origin, stale version, concurrent expiry, replay, preserved pending snapshot/signed attempt, late capture and injected audit rollback. Existing action/calculation/review/maintenance checks also passed.
- No expiry transition was executed on the retained owner database/ledger. RPC fixtures prove application handling, not a newly accepted live corporate action or wallet flow.
- Local API readiness, web liveness and dashboard returned HTTP 200 after restarting the existing local applications. The new same-origin POST returned `SESSION_REQUIRED` without a session. Authenticated owner/Auditor browser acceptance and a live-chain missed-action transition were not performed; no Rust/SBF change required a new program build. Changes remain local and are not new GitHub/Render deployment evidence.

## Retained owner observation

Read-only observation on 2026-10-09 at finalized slot 116223 confirmed the original Localnet genesis, LKA26R1 ACTIVE supply 35, coupon `464a832a-2c55-4e22-bb7a-6be93b429c78` UNDER_REVIEW version 6, three CALCULATED rows totaling 1750000000 minor units, chain SNAPSHOT_CREATED with zero registered entitlements and treasury zero. Funding remained PREPARED without a signature. Old transaction bytes remain pruned from RPC; this is account/database read-back, not a new transaction acceptance.

At finalized slot 116912, a separate read-only loader/Clock observation verified the same ProgramData address/Phantom authority, 344640-byte candidate SHA-256 `62562a427b9da9af9c7c2ac0976b073484b40bf9a48ad2b5f9af6b1d556ca05d`, and a correctly encoded finalized Clock sysvar. No owner signing, funding, approval, payment or program change occurred in this slice.

## Remaining work

Stored pending snapshots and all active attempts intentionally require existing recovery; this endpoint cannot abandon them. There is no background sweep or on-chain `SNAPSHOT_MISSED` instruction. Manual owner/Auditor browser acceptance remains separate.

The next owner gate remains partial REGISTER → RESET → all three REGISTER → FINALIZE through Phantom, followed by exact finalized account/database/audit reconciliation. Approver authority, action reserve, coupon payment/receipt and redemptions remain unfinished; owner funding stays deferred. See the [delivery checklist](../deployment/DEVNET_TO_MVP_CHECKLIST.md).

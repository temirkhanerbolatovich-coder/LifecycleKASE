# Corporate action scheduling and snapshot

Status: implemented locally on 2026-10-02. Persistent owner Phantom coupon scheduling/snapshot is accepted in the [live runbook](../testing/localnet-action-acceptance.md); remaining manual variants are separate gates. This slice schedules/cancels actions and registers a snapshot. The following [entitlement/review slice](entitlements-and-review.md) is also locally implemented; funding and on-chain payment/redemption remain pending.

## Operator flow

1. Sign in with the instrument issuer's Administrator wallet. Auditor can list/read actions and evidence.
2. In **Корпоративные действия**, create a draft for an ACTIVE instrument. Choose coupon, maturity redemption or early redemption, intent/source metadata, planned record time and execution time. Browser times are local and sent as exact UTC seconds.
3. Open the draft, prepare SCHEDULE, review its exact terms/network/signer/PDA and sign through Phantom. The draft stays DRAFT until a separate finalized check verifies the complete prepared message and the program-owned Action PDA, then becomes SCHEDULED.
4. At record time, prepare the embedded snapshot, review planned record time separately from effective finalized slot/block time/hash, sign, and confirm. Snapshot FINALIZED and action SNAPSHOT_CREATED require exact transaction and commitment read-back.
5. An untouched DRAFT may be cancelled with a reason. A SCHEDULED action requires a separate reviewed, signed CANCEL transaction and finalized PDA reconciliation. Any persisted snapshot blocks ordinary cancellation.

Creation and preparation require record time at least 60 seconds ahead, leaving time for wallet review. Record must be on/after instrument issue and on/before execution. Coupon execution must be no later than maturity; maturity redemption execution must be on/after maturity; early redemption must execute before maturity with 1–10000 bps and a positive KZT-Test price of at most six decimals. These application rules match the deployed Anchor terms and use the stricter ACTIVE prerequisite.

The capture window is configured by `SNAPSHOT_GRACE_SECONDS`, default/max 300. Preparing before record time or after the window is blocked. There is no backdating or historical holder reconstruction: DEMO_CAPTURE_SLOT records the actual finalized capture. A missed window currently returns a blocking error; automatic SNAPSHOT_MISSED transition/editing an expired draft remains unimplemented. Create a new action when dates need correction.

Finalized block time can lag the server clock. Immediately after record time, preparation can return `SNAPSHOT_SLOT_OUTSIDE_WINDOW` until the finalized capture reaches that time. Wait briefly and repeat preparation within the window; never alter the record time or relax finalized checks. The isolated HTTP/validator test waits up to 90 seconds and reports both clocks instead of assuming finalization within 12.5 seconds.

## API and persistence

All routes use the fixed same-origin proxy allowlist, `Cache-Control: no-store`, real operator sessions, Administrator mutations, Origin checks and the existing process-local mutation limiter. Session wallet must match issuer even for snapshot preparation/confirmation. Issuer authority is the signer under the existing MVP program; separate maker/checker and corporate-action delegation are future work.

| Route | Purpose |
| --- | --- |
| GET/POST `/api/v1/corporate-actions` | Bounded list / audited draft creation |
| GET `/api/v1/corporate-actions/:id` | Terms, source metadata, snapshot summary, recent transactions and audit |
| POST `/:id/prepare` | `{phase: SCHEDULE}` or `{phase: CANCEL, reason}` |
| POST `/:id/submit` | Localnet-only exact signed-byte broadcast; phase, operationId and signedTransactionBase64 |
| POST `/:id/confirm` | Phase, operationId and signature; exact finalized transaction and Action PDA reconciliation |
| POST `/:id/cancel` | Reasoned cancellation of an untouched off-chain draft |
| POST `/:id/snapshot/prepare`, `/submit`, `/confirm` | Capture/prepare, Localnet broadcast and finalized snapshot reconciliation |

Draft `requestId` is the client-generated action UUID. Repeating the exact same request returns the original action without another audit/create; different terms/creator on the same UUID are rejected. Source metadata records provenance text; selecting EXTERNAL_API or EXCHANGE_EVENT does not invoke an external integration.

Apply `20261002230000_corporate_action_operations`. It requires persisted wire/signer/network/payload for ACTION_SCHEDULE/ACTION_CANCEL and allows only one PREPARED/SUBMITTED/UNKNOWN_CONFIRMATION attempt per action and operation type, including REGISTER_SNAPSHOT. It does not discard existing records; duplicate legacy pending snapshot attempts require explicit reconciliation before migration.

Lifecycle preparation/finalization and reasoned draft cancellation use serializable transactions, action version checks and atomic actor/correlation audit. Cancel preparation and snapshot capture exclude each other. Financial amounts are bigint minor units, serialized as strings. Detail responses expose a cancellation reason without returning prepared wire/payloads; recent transaction and audit previews are bounded.

## Signing and recovery

Localnet uses `solana:signTransaction`: Phantom signs the exact v0 plan, including explicit compute budget/zero demo priority price, and the API verifies message, signer and Ed25519 signature before trusted RPC submission. Devnet uses wallet submission and remains deferred under ADR-014. Neither API nor browser stores a private key.

The browser records the signature before broadcast. A timeout/lost response or expired session never automatically retries a mutation. Same-wallet reauthentication keeps the workflow mounted; repeat only finalized confirmation. After reload, open the same action and prepare the same phase: a persisted signed attempt returns its original operation UUID/signature with another signature prompt disabled. Snapshot preparation similarly resumes its immutable capture and signed attempt, including after blockhash/window expiry, for confirmation only.

An unsigned PREPARED attempt can be replaced only after a finalized block-height expiry check and a signature-null compare-and-set. A signed attempt is never replaced because its blockhash expired or history disappeared. Unavailable finalized bytes keep UNKNOWN_CONFIRMATION and require history/state investigation. If signing succeeded but the API received no submission (for example authentication expired), preserve the signature shown in the browser; it may need manual confirmation/history investigation. Wallet cancellation/ambiguous responses disable immediate resubmission.

Untouched DRAFT cancellation is blocked while a prepared/signed schedule exists. There is no force-cancel or state-reset route. A cancelled/snapshot-bearing Action PDA cannot be scheduled/cancelled again through the application. Direct token transfers remain possible without Transfer Hook; an unknown/unverified positive holder or supply mismatch blocks capture.

## Verification

- `npm run check`: type/schema/docs checks and workspace/root unit tests.
- `npm run test:actions:database`: creates/migrates/drops a unique isolated local DB; real HTTP wallet login, role/Origin boundaries, dates/parameters, concurrent create idempotency, list/detail, reasoned draft cancellation and audit rollback. ACTIVE instrument rows in this standalone test are explicitly synthetic DB fixtures.
- Optional combined acceptance: build the API, set `ACTION_TEST_DATABASE_URL` to the explicit loopback **base** lifecycle_kase URL, then run `scripts/test-initialize-instrument.ps1 -WslUser lifecycle-dev -Profile localnet` on free isolated ports. Forward that variable through WSLENV on Windows. The harness uses only its disposable validator/admin and creates/drops another isolated DB. It runs real action SCHEDULE/CANCEL for all three types and real holder capture/snapshot submission/confirmation through HTTP/PostgreSQL. A fixed loopback relay bridges the WSL private RPC; production RPC HTTP restrictions stay intact. It never imports the owner's Phantom key or modifies the acceptance ledger/DB.
- `npm run test:web:proxy`: production web build/smoke checks all new allowlisted routes and rejection of unknown routes.

Owner Phantom/browser acceptance and persistent LKA26R1 snapshot evidence are tracked in the [Localnet action runbook](../testing/localnet-action-acceptance.md). Cancellation/lost-response manual variants remain separate gates. Public Devnet, approval, entitlements, KZT-Test funding/payment, burns/receipts and final reconciliation are not delivered by this slice.

## Isolated acceptance — 2026-10-02

Actual HTTP/PostgreSQL/Localnet acceptance passed for all three action types: schedule, cancel, exact signed-message/PDA confirmation, repeated confirm and signed-attempt resume. Snapshot capture read real token balances 10/20/5, grouped three synthetic verified investor mappings and finalized the same canonical commitment on-chain and in the database. Attempts to cancel a snapshot-bearing action or change a finalized snapshot were rejected. The generated database was dropped after verification; this evidence is not owner Phantom acceptance or a retained public-network transaction.

| Public test evidence | Value |
| --- | --- |
| Genesis | `4suDqVYuhHd1wqAPkePX1gPFgg4YhTTdSRJ38wxrikF9` |
| Instrument UUID | `d3d3d3d3-d3d3-43d3-93d3-d3d3d3d3d3d3` |
| Action UUID | `e7031edb-4639-4541-9d5c-6d907f6bcc5a` |
| Snapshot SHA-256 | `1dd05dc59f922c0fa8a659e8e06684adc1e39c540c99b318ed1456cd79d0011a` |
| Finalized signature | `3fJdGvpX6sQVQmnWpSoMvK7wj2vdQCbALj7ZdA4V44N7LPmV352vzb7HBGbtQB7KqQJYLfc41PabKpW2cBvcsGHn` |
| Planned/effective time | `2026-10-02T17:20:41.000Z` / `2026-10-02T17:20:41.000Z` |
| Effective finalized slot | `891` |
| Investors / total balance | `3` / `35` |

The first capture requests at 17:20:42 and 17:20:52 UTC saw finalized block times 17:20:27 and 17:20:38, both before record time. Bounded polling succeeded once the finalized slot reached 17:20:41. The application rejected the premature captures without creating/backdating a snapshot.

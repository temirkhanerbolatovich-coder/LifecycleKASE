# Localnet action and snapshot acceptance

Date: 2026-10-02. Persistent owner-controlled Phantom flow, separate from [isolated test evidence](../features/corporate-actions.md#isolated-acceptance--2026-10-02). The accepted [instrument issuance](localnet-instrument-acceptance.md) and ledger were preserved.

## Current persistent checkpoint

The new owner coupon snapshot is accepted by independent finalized transaction/PDA/relational inspection. Its delayed database projection was confirmed at 23:34:49 UTC+5 by the explicitly authorized controlled Localnet CLI, without importing keys, signing or resending. The Action PDA and snapshot stay immutable while application calculation/review advances. The stored coupon is UNDER_REVIEW, pending the owner's explicit decision. On 2026-10-03 an unsigned 1750 KZT-Test funding plan was prepared; owner treasury/supply remain zero and no payment/burn exists.

| Identity / term | Accepted value |
| --- | --- |
| Instrument | LKA26R1, `c9a1648f-f896-4135-bb19-63bedff119f3`, ACTIVE 35/35 |
| New action | `464a832a-2c55-4e22-bb7a-6be93b429c78`, COUPON_PAYMENT, Localnet coupon acceptance 2 |
| Issuer / original Phantom signer | `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM` |
| Localnet genesis | `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF` |
| Program / Action PDA | `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` / `2QEdxyHXkmkd7Lq6YivoG6iMmEmvUnMrgC3U9SWPZhaz` |
| Planned record / execution | `2026-10-02T18:10:00.000Z` / `2026-10-02T18:20:00.000Z` (23:10 / 23:20 UTC+5) |
| Snapshot / effective capture | `6a322373-d411-4e6f-b1b6-149925f5ef08`, FINALIZED; slot 44222, `2026-10-02T18:12:36.000Z` |
| Canonical SHA-256 | `799e44c7a9593bea19c0364cc42fa86d690b6ef6bba49f7d5f877d15dff9b76a` |
| Captured investors / wallets / supply | 3 / 3 / 35; balances 10/20/5, relational rows and canonical hash verified |
| Application / on-chain status | UNDER_REVIEW / SNAPSHOT_CREATED; no on-chain review/execution instruction |

| Phase | Attempt UUID | Exact finalized signature | Slot |
| --- | --- | --- | --- |
| SCHEDULE | `138e93ce-5885-4238-a3d5-7634bea20035` | `5VLC1i8K1vX3iTEpbtsmnUqfCpRTyms7JsifWpoQuvmx8ddhxxjXDEuF5M1b2aPdaGcARhWyuEUfidt89JE8qqgU` | 43277 |
| REGISTER_SNAPSHOT | `73bcf302-2322-47cb-927d-a3db7429128b` | `5bZ7ckNFbM39DKWhioXthYkRWBLa7SLchw76fo1PuH5tNvJn5uonA4iJZY25nMeACDtN2hfrUEG5mYSLiygkTsZc` | 44279 |

The issuer signed both original messages in Phantom. Independent checks compared the exact stored transaction messages, configured genesis, program ownership and all expected Action PDA terms/hash/slot/counts. Confirmation atomically recorded SNAPSHOT_REGISTRATION_FINALIZED with confirmationSource CONTROLLED_LOCALNET_CLI and the original authenticated preparing actor. No browser cookie, session or private key was extracted. Capture was within the original 23:10–23:15 window; later projection recovery does not backdate or replace it.

Authorized preparation used the same calculation service and existing verified recipients, then submitted UNDER_REVIEW (action version 6). Formula is balance × 1000 KZT-Test × 1000 bps / (10000 × 2), exact integer minor units, no remainder:

| Investor | Balance | Receiver | Coupon KZT-Test |
| --- | --- | --- | --- |
| `7325ad19-036b-43f3-ba60-085a5cafcbb6` | 10 | `C7WBVNAsXHfhvkoWws8pkTdLdWr5s6ZPAzWtqC7RP8EL` | 500 |
| `f90c416d-aeb3-4bf4-ae99-65ed09168ca5` | 20 | `9Cu9CMQMCJrA3VTp1wwNHqvDE8uQZZy6x2VoxzxDBG1d` | 1000 |
| `bb90b1fc-64d4-4244-b67c-181df22a967a` | 5 | `Gdkb43otf7XMKwZRzvd4tciyyUW1DWW34mBMeBKsUvGb` | 250 |
| Total | 35 | Three active verified synthetic Localnet holders | 1750 |

Calculation and SUBMIT audit explicitly record operationSource CONTROLLED_LOCALNET_CLI. Strict public-network KYC is unchanged; all three have the explicit reviewed Localnet demo policy. Preparation cannot perform APPROVE or any transfer. Owner approval, funding/execution and separate Auditor entitlement presentation remain pending. See [feature and recovery procedure](../features/entitlements-and-review.md).

### Current verification

Final local checks passed: `npm run check` (API 86, web 24, domain 27, Solana client 29, root 22; 188 total; schema/types and 48 Markdown files); both Rust profiles 9/9, Rust format/Clippy; `npm run test:web:proxy` production build/26-route transport; `npm run test:actions:database` all three entitlement/review types, zero rounding, concurrency, tampering/revoked receiver and atomic audit rollback. The combined disposable-validator HTTP/PostgreSQL harness passed real snapshot capture/registration/confirmation, coupon calculation/review and all retained 25 runtime groups. No persistent owner keys or ledger were used by these isolated tests.

Persistent read-only recheck at `2026-10-02T18:48:57Z` again verified both exact finalized messages, Action PDA SNAPSHOT_CREATED, canonical hash/relational balances and application UNDER_REVIEW version 6. Repeating controlled preparation retained the same three rows/version and exactly one calculation/one SUBMIT audit; wrong operator or genesis was rejected before calculation. Explicit owner approval and actual settlement remain pending; automated test approval is not owner approval.

## Funding preparation — 2026-10-03

Localnet budget/funding API/UI and migration 18 are implemented. Isolated real-validator/HTTP/PostgreSQL acceptance minted 1750 KZT-Test into a disposable issuer treasury, checked the exact finalized message/token delta, concurrency, prepare/confirm audit rollback, role/Origin controls, signed-attempt recovery and repeat without another mint. It left that action UNDER_REVIEW and its entitlements CALCULATED. This is independent test evidence, not a transaction on the owner's ledger.

The preserved owner database was checked at 17 migrations before applying only `20261003001000_coupon_funding_operations`; all 18 now finished. Controlled preparation saved attempt `8d955803-adbe-4004-8277-4dd1c5aea73d`, PREPARED, no signature, exact amount `1750000000` minor (1750 KZT-Test), original issuer and genesis. Settlement mint is `HgyDrHmGX6frycUDokctWddqEPTvQQoLsTMmnbVr7nrc`; treasury ATA `HmVxPK3DfwHh4YuQr59fECNWGaRDw55f7HAGyAsMkx6P`. Audit is COUPON_FUNDING_PREPARED / CONTROLLED_LOCALNET_CLI under the original authenticated issuer actor.

Independent read-only verification at `2026-10-02T19:27:54Z` (00:27:54 on October 3 UTC+5) rebuilt and matched the exact funding wire, issuer/genesis/mint/treasury/amount, database constraint, actor audit and current eligible calculations. At finalized slot 54946, mint supply and treasury were 0, deficit 1750, issuer SOL `99975370320` lamports. Required funding costs plus policy reserve were `52079080`: rent `2074080`, actual message fee `5000`, reserve `50000000`. These are observed preparation facts, not future execution cost estimates or escrow.

The action remains UNDER_REVIEW/version 6 with the same three CALCULATED entitlements. No new owner transaction was signed/broadcast, no approval/payment performed. An unsigned expired blockhash may refresh before the wallet prompt; reviewed funding amount remains 1750, with any changed amount requiring review again. After the owner signs through the dashboard, ordinary confirmation or guarded `confirm-funding` can independently finalize the exact signed attempt without resending. Owner funding signature, explicit calculation decision, separate Auditor presentation and on-chain execution/receipt remain pending. See [funding flow](../features/coupon-funding.md).

Checks for this slice: `npm run check` — 197 tests (API 90, web 25, domain 27, client 32, root 23), types/schema and 50 Markdown files; production proxy build/30 routes; standalone HTTP/PostgreSQL all three calculation/review types; combined real-validator snapshot/funding/coupon review and retained 25 runtime groups. Rust source and live program binary were not changed by funding. These additions have not been committed/pushed/deployed to Render.

## Historical missed-window action

SCHEDULE is accepted by independent finalized transaction/PDA/database inspection. A read-only recheck after 22:35 UTC+5 found no snapshot in PostgreSQL or Action PDA. Its 22:28–22:33 capture window has passed; this action cannot receive a new backdated capture. Scheduling/registration do not fund or execute a coupon.

| Identity / term | Accepted value |
| --- | --- |
| Instrument | LKA26R1, `c9a1648f-f896-4135-bb19-63bedff119f3`, ACTIVE 35/35 |
| Action | `09d229a4-4ce9-48bb-bd3d-617c693a0511`, COUPON_PAYMENT |
| Intent | Localnet coupon acceptance |
| Issuer / Phantom signer | `5Nn5WtR1dzVamAJYAheUBucFu6wUuJLbCUr2VwTTJzMM` |
| Localnet genesis | `B8qepCnZ7JrtzYcH65m3Eqc6Uwp8DPE9NMYhXberNqhF` |
| Program | `6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo` |
| Action PDA | `C4DfXkPf4kLorScRThrRZdPVtJH8NqRhgmegGC13bvgv` |
| Planned record time | `2026-10-02T17:28:00.000Z` (22:28 UTC+5) |
| Planned execution time | `2026-10-02T17:38:00.000Z` (22:38 UTC+5) |

| Phase | Attempt UUID | Finalized signature | Slot |
| --- | --- | --- | --- |
| SCHEDULE | `4be92a4e-5603-4b50-a43b-522d2483bf0e` | `Wmw7s62ZpwzHH7SHVRoZkFGFitZKGLpvNmtAifCQHBGnh53cWBuNhEyZ5Y3C4SnbRTHxbHTaxa9esubjCpdnu6s` | 37251 |

Independent read-only checks confirmed successful finalized transaction bytes exactly matching the stored unsigned plan, required issuer signer and expected genesis. The program-owned, non-executable Action PDA matched the instrument/action UUIDs, type, record/execution times, nullable redemption terms and SCHEDULED status. Snapshot/counters/amount were zero and completion absent. PostgreSQL contained one FINALIZED SCHEDULE attempt and actor audit for draft creation, preparation, submission and scheduling. No private key or session cookie was read.

## Historical owner snapshot step

For this same action, prepare the embedded snapshot after record time and finalized block time reach the record date. During this run finalized time lagged the server by approximately 15 seconds; the recommended first attempt is 22:28:20 UTC+5. Fresh capture/preparation must occur by 22:33:00 with the configured 300-second window. Review the exact network, issuer, planned/effective times, slot and hash; sign in Phantom and use the separate finalized check.

Do not schedule another action or resend SCHEDULE to complete snapshot. If snapshot signing already occurred, retain its operation UUID/signature and repeat only confirmation. A full reload can resume the persisted signed snapshot attempt through prepare, including after window/blockhash expiry for confirmation only. A missed capture window must not be backdated.

At the later audit there was no snapshot attempt/signature or payload to resume. For a fresh owner snapshot acceptance, create a new coupon action with future record time on the same ACTIVE LKA26R1 instrument. Preserve this missed action and its exact finalized SCHEDULE evidence. Automatic SNAPSHOT_MISSED transition and editing expired terms remain unimplemented; the stored status stays SCHEDULED.

## Historical validation before the new owner snapshot

`npm run check` passed: API 81/81, web 20/20, Solana client 29/29, root 18/18 and other domain/schema/type/documentation checks. Production proxy acceptance passed all 23 allowlisted routes. Isolated HTTP/PostgreSQL action tests and combined real-validator/HTTP/PostgreSQL action/snapshot acceptance passed. The complete disposable validator harness also passed the existing 25 runtime groups and the new application v0 issuance/action/snapshot checks; its temporary ledger/database were cleaned without stopping the persistent validator.

At that earlier checkpoint, the owner snapshot and Stage 7 implementation were pending. The new accepted checkpoint above supersedes those two entries; the missed-window action remains preserved. Manual cancellation/rejection/lost-response/reload variants and separate Auditor action/entitlement presentation are still open. KZT-Test funding, coupon execution, redemption burns/receipts and reconciliation remain unimplemented. No changes or new acceptance evidence have been committed/pushed/deployed to Render during this run; the earlier external audit observed `112bdb1`.

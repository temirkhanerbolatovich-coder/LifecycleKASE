# Implementation status

Last verified: 2026-09-30 (local API snapshot tests; public staging last checked 2026-09-29)

This is a repository status, not a claim that the full MVP or a production financial workflow is operational.

| Area | Current status | Evidence / limit |
|---|---|---|
| Web and HTTP service | Read-only Next.js status dashboard; NestJS health, operator wallet authentication, and administrator snapshot prepare/confirm routes | Wallet authentication is disabled by default and fixture-tested locally; no wallet UI, controlled operator provisioning, public-domain rate limiting, or broader admin/auditor workflows yet |
| Public staging | Render Blueprint deployed in separate Hobby workspace with two free Node services and disposable PostgreSQL | Health and dashboard verified on 2026-09-29 at commit `626cc32`; free DB is not durable and no real data is permitted. See [deployment record](deployment/render-staging.md) |
| Investor identity, wallet mapping, approvals, legs, receipts | Schema and PostgreSQL migration implemented | Database guards run locally; no domain API or UI flows yet |
| Snapshot-v2, investor aggregation, eligibility and leg reconciliation | Pure TypeScript contracts plus authenticated prepare/finalized-confirm API flow implemented | Unit and fixture tests pass; local on-chain commitment instruction exists, but no wallet UI/submission or real snapshot proof |
| Token-2022 holder collection | RPC collector and investor grouping implemented | Used by internal API candidate service; no live mint yet |
| Snapshot registration transaction flow | Authenticated administrator prepare route writes/resumes the snapshot and records a blockhash-bound unsigned v0 transaction attempt; confirm verifies the exact finalized message, signer, successful result and Action PDA before atomically finalizing database projections | Fixture tests pass; PostgreSQL integration was not rerun because the local database was unavailable. There is no wallet UI/submission or live-mint/live-RPC proof. Capture rejects a finalized slot before `record_at` or after capture; current-slot capture still does not prove ownership at the earlier planned `record_at`. |
| Coupon, principal and early redemption math | Pure TypeScript functions implemented | Canonical KZT-Test minor-unit vectors tested; Rust parity pending |
| Corporate-action approval states | Transition contract implemented | Authentication, on-chain approval and audit writes pending |
| KZT-Test | Specified simulated settlement asset | SIMULATED ASSET. Not issued by the National Bank of Kazakhstan. Mint and transfers pending |
| Bond, Solana program, execution receipts | Instrument initialization/activation, action scheduling/cancellation and snapshot commitment implemented and local-validator tested; activation checks a 10/20/5 distribution against supply 35 | Snapshot transaction preparation/confirmation is fixture-tested, but there is no application-side investor identity gate, wallet submission UI, payment/burn/receipt, separate administrator delegation, or Devnet deployment/signature |
| Transfer Hook, whitelist, freeze, role separation | Post-MVP options | Schema flags and role names do not enforce direct token transfers or permissions; after-snapshot transfers can make a redemption burn fail and must not be hidden by a payout. |
| Real KYC, bank settlement, digital tenge, KASE/CSD integration | Out of scope | No external integration or real-money claim |

The next product gate is wallet UI/submission plus a real Devnet snapshot proof, followed by authenticated Investor Registry management and a reviewed coupon execution vertical slice. The full MVP Definition of Done is in the [product requirements](requirements/PRODUCT_REQUIREMENTS.md).

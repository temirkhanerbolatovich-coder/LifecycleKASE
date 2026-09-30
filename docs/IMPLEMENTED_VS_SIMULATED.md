# Implementation status

Last verified: 2026-09-30 (documentation review; implementation evidence last checked 2026-09-29)

This is a repository status, not a claim that the full MVP or a production financial workflow is operational.

| Area | Current status | Evidence / limit |
|---|---|---|
| Web and HTTP service | Read-only Next.js status dashboard plus NestJS liveness and PostgreSQL readiness routes | Public status slice verified; no authentication, admin/auditor workflows, wallet, or domain HTTP routes |
| Public staging | Render Blueprint deployed in separate Hobby workspace with two free Node services and disposable PostgreSQL | Health and dashboard verified on 2026-09-29 at commit `626cc32`; free DB is not durable and no real data is permitted. See [deployment record](deployment/render-staging.md) |
| Investor identity, wallet mapping, approvals, legs, receipts | Schema and PostgreSQL migration implemented | Database guards run locally; no domain API or UI flows yet |
| Snapshot-v2, investor aggregation, eligibility and leg reconciliation | Pure TypeScript domain functions implemented | Unit tests pass; local on-chain commitment instruction exists, but no signed API flow or real snapshot proof |
| Token-2022 holder collection | RPC collector and investor grouping implemented | Used by internal API candidate service; no live mint yet |
| Snapshot preparation, pending persistence, and unsigned registration plan | Internal API joins Prisma action/wallet data with finalized RPC holders, computes snapshot-v2, writes pending rows, and reconstructs a checked Anchor instruction plan from the saved hash | Fixture tests and prior local PostgreSQL integration tests pass; no authenticated route, serialized/signable wallet transaction, finalized confirmation, or live-mint proof. Current-slot capture does not prove ownership at the earlier planned `record_at`; the effective finalized slot must be disclosed. |
| Coupon, principal and early redemption math | Pure TypeScript functions implemented | Canonical KZT-Test minor-unit vectors tested; Rust parity pending |
| Corporate-action approval states | Transition contract implemented | Authentication, on-chain approval and audit writes pending |
| KZT-Test | Specified simulated settlement asset | SIMULATED ASSET. Not issued by the National Bank of Kazakhstan. Mint and transfers pending |
| Bond, Solana program, execution receipts | Instrument initialization/activation, action scheduling/cancellation and snapshot commitment implemented and local-validator tested; activation checks a 10/20/5 distribution against supply 35 | No application-side investor identity gate, canonical snapshot transaction flow, payment/burn/receipt, separate administrator delegation, or Devnet deployment/signature |
| Transfer Hook, whitelist, freeze, role separation | Post-MVP options | Schema flags and role names do not enforce direct token transfers or permissions; after-snapshot transfers can make a redemption burn fail and must not be hidden by a payout. |
| Real KYC, bank settlement, digital tenge, KASE/CSD integration | Out of scope | No external integration or real-money claim |

The next product gate is authenticated Investor Registry management and signed snapshot registration/confirmation on-chain, followed by a reviewed coupon execution vertical slice. The full MVP Definition of Done is in the [product requirements](requirements/PRODUCT_REQUIREMENTS.md).
